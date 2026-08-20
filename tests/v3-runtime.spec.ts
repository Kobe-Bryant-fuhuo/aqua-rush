import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { getTrackDefinition, type RaceMode, type TrackId } from '../src/game/ContentCatalog';
import { RaceTrack } from '../src/game/Track';
import {
  callRaceHook,
  captureRuntimeErrors,
  expectNoRuntimeErrors,
  readRaceDiagnostics,
  waitForRaceGame,
  type RaceDiagnostics,
  type RaceVector,
} from './race-test-helpers';

const MODES: readonly RaceMode[] = ['quick-race', 'time-trial'];
const TRACKS: readonly TrackId[] = ['sunset-circuit', 'storm-reef'];

async function advanceGame(page: Page, milliseconds: number): Promise<void> {
  await page.evaluate((duration) => {
    if (typeof window.advanceTime !== 'function') throw new Error('window.advanceTime is missing');
    window.advanceTime(duration);
  }, milliseconds);
}

async function startThroughMenus(page: Page, mode: RaceMode, trackId: TrackId): Promise<RaceDiagnostics> {
  await waitForRaceGame(page);
  await callRaceHook(page, 'hideDebugUi', true);
  await callRaceHook(page, 'setReducedMotion', false);

  await expect(page.locator('#title-screen')).toBeVisible();
  await page.locator('#title-start-button').click();
  await expect.poll(async () => (await readRaceDiagnostics(page)).flow.state).toBe('mode-select');
  await page.locator(`#mode-${mode}-button`).click();
  await expect.poll(async () => (await readRaceDiagnostics(page)).flow.state).toBe('track-select');
  await page.locator(`#course-${trackId}-button`).click();

  await expect.poll(async () => (await readRaceDiagnostics(page)).flow.state).toBe('countdown');
  await advanceGame(page, 3_100);
  const diagnostics = await readRaceDiagnostics(page);
  expect(diagnostics.flow.state).toBe('racing');
  expect(diagnostics.state).toBe('racing');
  return diagnostics;
}

function planarDistance(a: RaceVector, b: RaceVector): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function interactionGate(trackId: TrackId, kind: 'boost-gate' | 'drift-gate') {
  const definition = getTrackDefinition(trackId);
  const interaction = definition.interactions.find((candidate) => candidate.kind === kind);
  if (!interaction) throw new Error(`${trackId} is missing ${kind}`);
  const track = new RaceTrack(definition);
  return {
    definition: interaction,
    center: track.getOffsetPoint(interaction.progress, interaction.lateralOffset),
  };
}

function findOpenWaterPoint(trackId: TrackId): { x: number; y: number; z: number; distance: number } {
  const track = new RaceTrack(getTrackDefinition(trackId));
  let best: { x: number; y: number; z: number; distance: number; error: number } | null = null;
  for (let sample = 0; sample < 100; sample += 1) {
    const progress = sample / 100;
    for (const side of [-1, 1]) {
      const candidate = track.getOffsetPoint(progress, side * 180);
      if (Math.abs(candidate.x) >= track.worldHalfExtent - 20 || Math.abs(candidate.z) >= track.worldHalfExtent - 20) continue;
      const distance = track.project(candidate).distance;
      if (distance < 155 || distance > 195) continue;
      const error = Math.abs(distance - 175);
      if (!best || error < best.error) best = { x: candidate.x, y: candidate.y, z: candidate.z, distance, error };
    }
  }
  if (!best) throw new Error(`${trackId} has no safe 155-195 unit open-water QA point`);
  return best;
}

async function prepareTimeTrial(page: Page, trackId: TrackId): Promise<RaceDiagnostics> {
  await waitForRaceGame(page);
  await callRaceHook(page, 'seed', 20260820);
  await callRaceHook(page, 'hideDebugUi', true);
  await callRaceHook(page, 'setReducedMotion', false);
  await callRaceHook(page, 'selectSession', 'time-trial', trackId);
  await advanceGame(page, 3_100);
  await callRaceHook(page, 'setPausedForScreenshot', false);
  const diagnostics = await readRaceDiagnostics(page);
  expect(diagnostics.state).toBe('racing');
  expect(diagnostics.racers).toHaveLength(1);
  return diagnostics;
}

async function movePlayerIntoGate(
  page: Page,
  center: { x: number; y: number; z: number },
  halfWidth: number,
  heading: number,
  speed: number,
): Promise<void> {
  const forward = { x: Math.sin(heading), z: -Math.cos(heading) };
  const approach = halfWidth + 0.12;
  await callRaceHook(
    page,
    'setPlayerKinematics',
    center.x - forward.x * approach,
    center.y,
    center.z - forward.z * approach,
    forward.x * speed,
    0,
    forward.z * speed,
  );
  await page.keyboard.down('KeyW');
  try {
    await advanceGame(page, 180);
  } finally {
    await page.keyboard.up('KeyW');
  }
}

test.describe('V3 runtime product contracts', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'Runtime contract matrix is exercised once on desktop.');
  });

  for (const mode of MODES) {
    for (const trackId of TRACKS) {
      test(`real menus start ${mode} on ${trackId}`, async ({ page }) => {
        const errors = captureRuntimeErrors(page);
        const diagnostics = await startThroughMenus(page, mode, trackId);
        expect(diagnostics.session).toMatchObject({
          mode,
          trackId,
          racerCount: mode === 'quick-race' ? 4 : 1,
        });
        expect(diagnostics.flow.inputOwner).toBe('race');
        expect(diagnostics.track.checkpointCount).toBe(12);
        expect(diagnostics.racers).toHaveLength(mode === 'quick-race' ? 4 : 1);
        expectNoRuntimeErrors(errors);
      });
    }
  }

  for (const trackId of TRACKS) {
    test(`all three AI racers naturally complete ${trackId}`, async ({ page }) => {
      const errors = captureRuntimeErrors(page);
      await waitForRaceGame(page);
      await callRaceHook(page, 'seed', 20260820);
      await callRaceHook(page, 'hideDebugUi', true);
      await callRaceHook(page, 'setReducedMotion', true);
      await callRaceHook(page, 'setPausedForScreenshot', true);
      await callRaceHook(page, 'selectSession', 'quick-race', trackId);
      await advanceGame(page, 3_100);

      // Keep the player safely in ordinary open water so it cannot block the
      // start grid or end the session while the production AI runs all laps.
      await callRaceHook(page, 'setPlayerKinematics', 210, 0, 210, 0, 0, 0);
      let diagnostics = await readRaceDiagnostics(page);
      for (let chunk = 0; chunk < 24; chunk += 1) {
        await advanceGame(page, 10_000);
        diagnostics = await readRaceDiagnostics(page);
        if (diagnostics.racers.filter((racer) => !racer.isPlayer).every((racer) => racer.finished)) break;
      }

      const rivals = diagnostics.racers.filter((racer) => !racer.isPlayer);
      console.log(`${trackId} AI completion: ${JSON.stringify(rivals.map((racer) => ({ id: racer.id, lap: racer.lap, checkpoint: racer.checkpoint, finished: racer.finished, position: racer.position })))}`);
      expect(rivals).toHaveLength(3);
      expect(rivals.every((racer) => racer.finished), `${trackId} AI must finish without debug checkpoint hooks`).toBe(true);
      expect(rivals.every((racer) => racer.checkpoint === 36 && racer.lap === 3)).toBe(true);
      expectNoRuntimeErrors(errors);
    });
  }

  test('open water remains drivable 150-200 units off route and explicit recovery preserves progress', async ({ page }) => {
    const errors = captureRuntimeErrors(page);
    await prepareTimeTrial(page, 'sunset-circuit');
    const staged = findOpenWaterPoint('sunset-circuit');
    await callRaceHook(page, 'setPlayerKinematics', staged.x, staged.y, staged.z, 0, 0, 0);
    await advanceGame(page, 34);
    const beforeDrive = await readRaceDiagnostics(page);
    expect(beforeDrive.track.distanceFromRoute).toBeGreaterThanOrEqual(150);
    expect(beforeDrive.track.distanceFromRoute).toBeLessThanOrEqual(200);
    expect(beforeDrive.recovery.eligible).toBe(true);
    expect(beforeDrive.guide.state).toBe('return');
    expect(beforeDrive.guide.beaconVisible).toBe(true);

    await callRaceHook(page, 'setPausedForScreenshot', false);
    await page.keyboard.down('KeyW');
    try {
      await advanceGame(page, 1_250);
    } finally {
      await page.keyboard.up('KeyW');
    }
    const explored = await readRaceDiagnostics(page);
    const explorationMovement = planarDistance(beforeDrive.player.position, explored.player.position);
    expect(explorationMovement, 'real throttle must still move the player in open water').toBeGreaterThan(1.5);
    expect(explorationMovement, 'ordinary deviation must not teleport the player').toBeLessThan(40);
    expect(explored.track.distanceFromRoute).toBeGreaterThan(140);
    expect(explored.collisions.total - beforeDrive.collisions.total, 'the course corridor is not a collider').toBe(0);
    expect(explored.recovery.count).toBe(0);

    const lapBeforeRecovery = explored.player.lap;
    const nextBeforeRecovery = explored.player.nextCheckpoint;
    await callRaceHook(page, 'recover');
    await advanceGame(page, 34);
    const recovered = await readRaceDiagnostics(page);
    expect(recovered.recovery.count).toBe(1);
    expect(recovered.recovery.lastReason).toBe('explicit');
    expect(recovered.player.lap).toBe(lapBeforeRecovery);
    expect(recovered.player.nextCheckpoint).toBe(nextBeforeRecovery);
    expect(recovered.track.distanceFromRoute).toBeLessThan(5);
    expect(recovered.events.last).toMatchObject({ type: 'recovery', outcome: 'explicit' });
    expectNoRuntimeErrors(errors);
  });

  test('Boost Gate runs ready to success feedback, cooldown, and ready without overlap retrigger', async ({ page }) => {
    const errors = captureRuntimeErrors(page);
    let diagnostics = await prepareTimeTrial(page, 'sunset-circuit');
    const gate = interactionGate('sunset-circuit', 'boost-gate');
    const gateBefore = diagnostics.interactions.gates.find((candidate) => candidate.id === gate.definition.id);
    expect(gateBefore).toMatchObject({ phase: 'ready', outcome: 'none', activationCount: 0 });

    await page.keyboard.down('KeyW');
    await page.keyboard.down('Space');
    await advanceGame(page, 1_100);
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyW');
    diagnostics = await readRaceDiagnostics(page);
    const boostBeforeGate = diagnostics.player.boost;

    await callRaceHook(page, 'setPausedForScreenshot', false);
    await movePlayerIntoGate(page, gate.center, gate.definition.halfWidth, diagnostics.player.heading, Math.max(9, diagnostics.player.speed));
    diagnostics = await readRaceDiagnostics(page);
    const activated = diagnostics.interactions.gates.find((candidate) => candidate.id === gate.definition.id);
    expect(activated).toMatchObject({ phase: 'feedback', outcome: 'success', activationCount: 1, failureCount: 0 });
    expect(diagnostics.player.boost).toBeGreaterThan(boostBeforeGate + 0.2);
    expect(diagnostics.events.last).toMatchObject({ type: 'boost-gate', outcome: 'success' });

    await advanceGame(page, 250);
    const overlap = (await readRaceDiagnostics(page)).interactions.gates.find((candidate) => candidate.id === gate.definition.id);
    expect(overlap?.activationCount, 'remaining inside a gate cannot repeatedly reward').toBe(1);

    await callRaceHook(page, 'setPlayerKinematics', gate.center.x + 20, gate.center.y, gate.center.z + 20, 0, 0, 0);
    await advanceGame(page, 700);
    const cooling = (await readRaceDiagnostics(page)).interactions.gates.find((candidate) => candidate.id === gate.definition.id);
    expect(cooling?.phase).toBe('cooldown');
    expect(cooling?.cooldownRemaining).toBeGreaterThan(0);

    await advanceGame(page, (gate.definition.cooldown + 0.2) * 1_000);
    const ready = (await readRaceDiagnostics(page)).interactions.gates.find((candidate) => candidate.id === gate.definition.id);
    expect(ready).toMatchObject({ phase: 'ready', outcome: 'none', activationCount: 1 });
    expectNoRuntimeErrors(errors);
  });

  test('Drift Gate reports failure without drift and success during a real drift', async ({ page }) => {
    const errors = captureRuntimeErrors(page);
    let diagnostics = await prepareTimeTrial(page, 'storm-reef');
    const gate = interactionGate('storm-reef', 'drift-gate');

    await callRaceHook(page, 'setPlayerKinematics', gate.center.x, gate.center.y, gate.center.z, 0, 0, 0);
    await advanceGame(page, 34);
    diagnostics = await readRaceDiagnostics(page);
    const failed = diagnostics.interactions.gates.find((candidate) => candidate.id === gate.definition.id);
    expect(failed).toMatchObject({ phase: 'feedback', outcome: 'failure', activationCount: 0, failureCount: 1 });
    expect(diagnostics.events.last).toMatchObject({ type: 'drift-gate', outcome: 'failure' });

    // Reset only the session/gate lifecycle, then create a real production
    // drift using keyboard input before entering the staged gate position.
    diagnostics = await prepareTimeTrial(page, 'storm-reef');
    await page.keyboard.down('KeyW');
    await advanceGame(page, 1_700);
    await page.keyboard.down('KeyD');
    await page.keyboard.down('Space');
    await advanceGame(page, 650);
    diagnostics = await readRaceDiagnostics(page);
    expect(diagnostics.player.drifting).toBe(true);
    expect(diagnostics.player.driftQuality).toBeGreaterThanOrEqual(0.28);

    const forward = { x: Math.sin(diagnostics.player.heading), z: -Math.cos(diagnostics.player.heading) };
    const eventSequenceBeforeSuccess = diagnostics.events.sequence;
    await callRaceHook(
      page,
      'setPlayerKinematics',
      gate.center.x - forward.x * Math.max(0.15, gate.definition.halfWidth - 0.1),
      gate.center.y,
      gate.center.z - forward.z * Math.max(0.15, gate.definition.halfWidth - 0.1),
      forward.x * Math.max(9, diagnostics.player.speed),
      0,
      forward.z * Math.max(9, diagnostics.player.speed),
    );
    await advanceGame(page, 100);
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyD');
    await page.keyboard.up('KeyW');

    diagnostics = await readRaceDiagnostics(page);
    const succeeded = diagnostics.interactions.gates.find((candidate) => candidate.id === gate.definition.id);
    expect(succeeded).toMatchObject({ phase: 'feedback', outcome: 'success', activationCount: 1, failureCount: 0 });
    expect(diagnostics.events.sequence).toBeGreaterThan(eventSequenceBeforeSuccess);
    expect(diagnostics.player.miniBoosting).toBe(true);
    expectNoRuntimeErrors(errors);
  });

  test('repeated real-menu course switching keeps renderer resources within a stable envelope', async ({ page }, testInfo: TestInfo) => {
    const errors = captureRuntimeErrors(page);
    await waitForRaceGame(page);
    const samples: Array<{ trackId: TrackId; geometries: number; textures: number; calls: number }> = [];

    for (let cycle = 0; cycle < 6; cycle += 1) {
      const trackId = TRACKS[cycle % TRACKS.length];
      await expect(page.locator('#title-screen')).toBeVisible();
      await page.locator('#title-start-button').click();
      await page.locator('#mode-time-trial-button').click();
      await page.locator(`#course-${trackId}-button`).click();
      await advanceGame(page, 3_200);
      const active = await readRaceDiagnostics(page);
      samples.push({ trackId, ...active.renderer });

      await callRaceHook(page, 'setPausedForScreenshot', false);
      await page.locator('#pause-button').click();
      await expect(page.locator('#pause-overlay')).toBeVisible();
      await page.locator('#pause-menu-button').click();
      await expect(page.locator('#title-screen')).toBeVisible();
    }

    await testInfo.attach('track-switch-resource-samples', {
      body: JSON.stringify(samples, null, 2),
      contentType: 'application/json',
    });
    console.log(`track switch resources: ${JSON.stringify(samples)}`);
    for (const trackId of TRACKS) {
      const trackSamples = samples.filter((sample) => sample.trackId === trackId);
      const baseline = trackSamples[0];
      const last = trackSamples.at(-1);
      expect(last?.geometries, `${trackId} geometry memory must not grow each switch`).toBeLessThanOrEqual(baseline.geometries + 2);
      expect(last?.textures, `${trackId} texture memory must not grow each switch`).toBeLessThanOrEqual(baseline.textures + 1);
      expect(Math.max(...trackSamples.map((sample) => sample.geometries)) - Math.min(...trackSamples.map((sample) => sample.geometries))).toBeLessThanOrEqual(3);
    }
    expectNoRuntimeErrors(errors);
  });
});
