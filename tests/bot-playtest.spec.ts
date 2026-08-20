import { expect, test } from '@playwright/test';
import {
  callRaceHook,
  captureRuntimeErrors,
  expectNoRuntimeErrors,
  loadRaceState,
  readRaceDiagnostics,
  waitForRaceGame,
  type RaceDiagnostics,
} from './race-test-helpers';

const BOT_SEED = 20260819;
const STEP_MS = Number(process.env.BOT_PLAYTEST_STEP_MS ?? 100);
const BOT_STEPS = Number(process.env.BOT_PLAYTEST_STEPS ?? 140);
const REQUIRE_FINISH = process.env.BOT_REQUIRE_FINISH === '1';
const BOOST_ENABLED = process.env.BOT_DISABLE_BOOST !== '1';
const BOT_TRACK = process.env.BOT_TRACK ?? 'sunset-circuit';
const BOT_MODE = process.env.BOT_MODE ?? 'quick-race';

if (BOT_TRACK !== 'sunset-circuit' && BOT_TRACK !== 'storm-reef') {
  throw new Error(`Unsupported BOT_TRACK: ${BOT_TRACK}`);
}
if (BOT_MODE !== 'quick-race' && BOT_MODE !== 'time-trial') {
  throw new Error(`Unsupported BOT_MODE: ${BOT_MODE}`);
}

function normalizeAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function objectiveProgress(diagnostics: RaceDiagnostics): number {
  return (
    diagnostics.player.lap -
    1 +
    diagnostics.player.checkpoint / Math.max(1, diagnostics.track.checkpointCount)
  );
}

test('bot playtest: feedback steering drives real race progress without softlocks', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chrome',
    'The feedback bot exercises keyboard controls in the desktop project.',
  );
  test.setTimeout(Math.max(45_000, BOT_STEPS * STEP_MS * 2.2 + 15_000));

  const errors = captureRuntimeErrors(page);
  if (BOT_TRACK === 'sunset-circuit' && BOT_MODE === 'quick-race') {
    // Preserve the exact V2 default setup and all existing bot semantics.
    await loadRaceState(page, 'active-play');
  } else {
    await waitForRaceGame(page);
    await callRaceHook(page, 'seed', BOT_SEED);
    await callRaceHook(page, 'hideDebugUi', true);
    await callRaceHook(page, 'setReducedMotion', false);
    await callRaceHook(page, 'selectSession', BOT_MODE, BOT_TRACK);
    await page.evaluate(() => window.advanceTime?.(3_100));
    await callRaceHook(page, 'setPausedForScreenshot', false);
    await expect.poll(async () => (await readRaceDiagnostics(page)).state).toBe('racing');
  }
  const before = await readRaceDiagnostics(page);

  let previous = before;
  let distanceTravelled = 0;
  let softlockWindows = 0;
  let windowDistance = 0;
  let windowProgress = objectiveProgress(before);
  let firstCheckpointStep = -1;
  let steeringKey: 'KeyA' | 'KeyD' | null = null;
  let throttleKey: 'KeyW' | 'KeyS' | null = null;
  let boostHeld = false;
  let executedSteps = 0;

  try {
    for (let step = 0; step < BOT_STEPS; step += 1) {
      executedSteps += 1;
      const target = previous.track.lookAheadPosition;
      const dx = target.x - previous.player.position.x;
      const dz = target.z - previous.player.position.z;
      const targetHeading = Math.atan2(dx, -dz);
      const headingError = normalizeAngle(targetHeading - previous.player.heading);
      const absoluteHeadingError = Math.abs(headingError);
      const nextSteeringKey =
        headingError > 0.045 ? 'KeyD' : headingError < -0.045 ? 'KeyA' : null;
      const nextThrottleKey: 'KeyW' | 'KeyS' | null =
        absoluteHeadingError > 0.95 && Math.abs(previous.player.speed) > 7
          ? 'KeyS'
          : absoluteHeadingError > 0.58 && Math.abs(previous.player.speed) > 12
            ? null
            : 'KeyW';
      const nextBoostHeld =
        BOOST_ENABLED &&
        absoluteHeadingError < 0.1 &&
        previous.player.speed > 6 &&
        step % 90 < 18;

      if (steeringKey && steeringKey !== nextSteeringKey) {
        await page.keyboard.up(steeringKey);
      }
      if (nextSteeringKey && steeringKey !== nextSteeringKey) {
        await page.keyboard.down(nextSteeringKey);
      }
      steeringKey = nextSteeringKey;

      if (throttleKey && throttleKey !== nextThrottleKey) {
        await page.keyboard.up(throttleKey);
      }
      if (nextThrottleKey && throttleKey !== nextThrottleKey) {
        await page.keyboard.down(nextThrottleKey);
      }
      throttleKey = nextThrottleKey;

      if (boostHeld !== nextBoostHeld) {
        if (nextBoostHeld) await page.keyboard.down('Space');
        else await page.keyboard.up('Space');
        boostHeld = nextBoostHeld;
      }

      await page.waitForTimeout(STEP_MS);
      const current = await readRaceDiagnostics(page);
      const moved = Math.hypot(
        current.player.position.x - previous.player.position.x,
        current.player.position.z - previous.player.position.z,
      );
      distanceTravelled += moved;
      windowDistance += moved;

      if (
        firstCheckpointStep === -1 &&
        (current.player.checkpoint !== before.player.checkpoint ||
          current.player.lap !== before.player.lap)
      ) {
        firstCheckpointStep = step;
      }

      if ((step + 1) % 5 === 0) {
        const progress = objectiveProgress(current);
        if (windowDistance < 0.12 && progress <= windowProgress + 0.001) {
          softlockWindows += 1;
        }
        windowDistance = 0;
        windowProgress = progress;
      }

      previous = current;
      if (current.state === 'finished') break;
    }
  } finally {
    if (steeringKey) await page.keyboard.up(steeringKey);
    if (throttleKey) await page.keyboard.up(throttleKey);
    if (boostHeld) await page.keyboard.up('Space');
  }

  const after = await readRaceDiagnostics(page);
  const aiBefore = new Map(
    before.racers.filter((racer) => !racer.isPlayer).map((racer) => [racer.id, racer]),
  );
  const aiProgressed = after.racers.some((racer) => {
    if (racer.isPlayer) return false;
    const start = aiBefore.get(racer.id);
    return (
      Boolean(start) &&
      (racer.lap > (start?.lap ?? racer.lap) ||
        racer.checkpoint !== start?.checkpoint ||
        Math.hypot(
          racer.position.x - (start?.position.x ?? racer.position.x),
          racer.position.z - (start?.position.z ?? racer.position.z),
        ) > 2)
    );
  });

  const report = {
    seed: BOT_SEED,
    trackId: BOT_TRACK,
    mode: BOT_MODE,
    steps: executedSteps,
    plannedSteps: BOT_STEPS,
    boostEnabled: BOOST_ENABLED,
    framesAdvanced: after.frame - before.frame,
    raceTimeAdvanced: Number((after.raceTime - before.raceTime).toFixed(2)),
    progressBefore: Number(objectiveProgress(before).toFixed(3)),
    progressAfter: Number(objectiveProgress(after).toFixed(3)),
    lapAfter: after.player.lap,
    checkpointAfter: after.player.checkpoint,
    firstCheckpointStep,
    distanceTravelled: Number(distanceTravelled.toFixed(2)),
    softlockWindows,
    collisions: after.collisions.total - before.collisions.total,
    aiProgressed: BOT_MODE === 'time-trial' ? null : aiProgressed,
    state: after.state,
    complete: after.complete,
    finalPlacement: after.finalPlacement,
    consoleErrors: errors.consoleErrors,
    pageErrors: errors.pageErrors,
  };

  await testInfo.attach('bot-playtest-report', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  console.log(`bot playtest: ${JSON.stringify(report)}`);

  expectNoRuntimeErrors(errors);
  expect(report.framesAdvanced, 'the render/update loop must keep advancing').toBeGreaterThan(250);
  expect(report.distanceTravelled, 'feedback steering must move the player boat').toBeGreaterThan(20);
  expect(report.firstCheckpointStep, 'real keyboard input must reach a checkpoint').toBeGreaterThanOrEqual(0);
  expect(report.progressAfter, 'the player objective must progress').toBeGreaterThan(
    report.progressBefore,
  );
  expect(report.softlockWindows, 'repeated input windows produced neither motion nor progress').toBeLessThanOrEqual(4);
  if (BOT_MODE === 'quick-race') {
    expect(report.aiProgressed, 'AI opponents must progress during the bot run').toBe(true);
  } else {
    expect(after.racers, 'Time Trial must remain a solo session').toHaveLength(1);
  }
  if (REQUIRE_FINISH) {
    expect(report.state, 'extended bot run must naturally reach the finish state').toBe('finished');
    expect(report.complete).toBe(true);
    expect(report.finalPlacement).toBeGreaterThanOrEqual(1);
    expect(report.finalPlacement).toBeLessThanOrEqual(after.racers.length);
  }
});
