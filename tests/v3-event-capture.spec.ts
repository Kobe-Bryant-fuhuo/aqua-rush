import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { getTrackDefinition, type TrackId } from '../src/game/ContentCatalog';
import { RaceTrack } from '../src/game/Track';
import {
  callRaceHook,
  captureRuntimeErrors,
  expectNoRuntimeErrors,
  readRaceDiagnostics,
  waitForRaceGame,
  type RaceDiagnostics,
} from './race-test-helpers';

const outputDirectory = path.resolve(process.cwd(), 'artifacts/final-v3/events');

async function advanceGame(page: Page, milliseconds: number): Promise<void> {
  await page.evaluate((duration) => window.advanceTime?.(duration), milliseconds);
}

async function startTimeTrial(page: Page, trackId: TrackId): Promise<RaceDiagnostics> {
  await callRaceHook(page, 'setPausedForScreenshot', true);
  await callRaceHook(page, 'selectSession', 'time-trial', trackId);
  await advanceGame(page, 3_100);
  const diagnostics = await readRaceDiagnostics(page);
  expect(diagnostics.state).toBe('racing');
  expect(diagnostics.racers).toHaveLength(1);
  return diagnostics;
}

function interactionGate(trackId: TrackId, kind: 'boost-gate' | 'drift-gate') {
  const definition = getTrackDefinition(trackId);
  const gate = definition.interactions.find((candidate) => candidate.kind === kind);
  if (!gate) throw new Error(`${trackId} is missing ${kind}`);
  const track = new RaceTrack(definition);
  return { gate, center: track.getOffsetPoint(gate.progress, gate.lateralOffset) };
}

async function capture(page: Page, name: string): Promise<RaceDiagnostics> {
  await callRaceHook(page, 'setPausedForScreenshot', true);
  const diagnostics = await readRaceDiagnostics(page);
  await page.screenshot({ path: path.join(outputDirectory, `${name}.png`) });
  await writeFile(path.join(outputDirectory, `${name}.json`), JSON.stringify(diagnostics, null, 2), 'utf8');
  return diagnostics;
}

test('capture production collision, drift, landing and gate feedback', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Evidence is captured once on desktop.');
  await mkdir(outputDirectory, { recursive: true });
  const errors = captureRuntimeErrors(page);
  await waitForRaceGame(page);
  await callRaceHook(page, 'seed', 20260820);
  await callRaceHook(page, 'hideDebugUi', true);
  await callRaceHook(page, 'setReducedMotion', false);

  // The hook only stages a deterministic position; the production rock
  // collision, separation, event, audio and VFX paths perform the impact.
  let diagnostics = await startTimeTrial(page, 'storm-reef');
  const stormDefinition = getTrackDefinition('storm-reef');
  const stormTrack = new RaceTrack(stormDefinition);
  const rock = stormDefinition.rocks[0];
  const rockCenter = stormTrack.getOffsetPoint(rock.progress, rock.lateralOffset);
  const collisionSequence = diagnostics.events.sequence;
  await callRaceHook(page, 'setPlayerKinematics', rockCenter.x - rock.radius * 0.35, 0, rockCenter.z, 14, 0, 0);
  await advanceGame(page, 17);
  await expect(page.locator('#status-line')).toContainText('HULL IMPACT');
  await page.waitForTimeout(260);
  diagnostics = await capture(page, 'collision');
  expect(diagnostics.events.sequence).toBeGreaterThan(collisionSequence);
  expect(diagnostics.events.last?.type).toBe('collision');

  // Consume boost through real keyboard input, then cross a production Boost
  // Gate so its feedback state and restored meter are visible together.
  diagnostics = await startTimeTrial(page, 'sunset-circuit');
  await page.keyboard.down('KeyW');
  await page.keyboard.down('Space');
  await advanceGame(page, 1_100);
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyW');
  const boostBefore = (await readRaceDiagnostics(page)).player.boost;
  const boostGate = interactionGate('sunset-circuit', 'boost-gate');
  const boostForward = { x: Math.sin(diagnostics.player.heading), z: -Math.cos(diagnostics.player.heading) };
  await callRaceHook(
    page,
    'setPlayerKinematics',
    boostGate.center.x - boostForward.x * (boostGate.gate.halfWidth + 0.1),
    0,
    boostGate.center.z - boostForward.z * (boostGate.gate.halfWidth + 0.1),
    boostForward.x * 18,
    0,
    boostForward.z * 18,
  );
  await page.keyboard.down('KeyW');
  await advanceGame(page, 180);
  await page.keyboard.up('KeyW');
  diagnostics = await capture(page, 'boost-gate');
  expect(diagnostics.player.boost).toBeGreaterThan(boostBefore + 0.2);
  expect(diagnostics.interactions.gates.find((gate) => gate.id === boostGate.gate.id)).toMatchObject({
    phase: 'feedback',
    outcome: 'success',
  });

  // Build an actual drift with keyboard controls, capture it, then enter the
  // Drift Gate while the production drift state remains valid.
  diagnostics = await startTimeTrial(page, 'storm-reef');
  await page.keyboard.down('KeyW');
  await advanceGame(page, 1_700);
  await page.keyboard.down('KeyD');
  await page.keyboard.down('Space');
  await advanceGame(page, 650);
  diagnostics = await capture(page, 'drift');
  expect(diagnostics.player.drifting).toBe(true);
  expect(diagnostics.player.driftQuality).toBeGreaterThanOrEqual(0.28);

  const driftGate = interactionGate('storm-reef', 'drift-gate');
  const driftForward = { x: Math.sin(diagnostics.player.heading), z: -Math.cos(diagnostics.player.heading) };
  await callRaceHook(
    page,
    'setPlayerKinematics',
    driftGate.center.x - driftForward.x * Math.max(0.15, driftGate.gate.halfWidth - 0.1),
    0,
    driftGate.center.z - driftForward.z * Math.max(0.15, driftGate.gate.halfWidth - 0.1),
    driftForward.x * Math.max(12, diagnostics.player.speed),
    0,
    driftForward.z * Math.max(12, diagnostics.player.speed),
  );
  await advanceGame(page, 100);
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyW');
  diagnostics = await capture(page, 'drift-gate');
  expect(diagnostics.interactions.gates.find((gate) => gate.id === driftGate.gate.id)).toMatchObject({
    phase: 'feedback',
    outcome: 'success',
  });

  // Landing is captured from the real Storm Reef wave/contact solver. A fast
  // boat is advanced in fixed 100 ms bursts until airborne -> contact occurs.
  diagnostics = await startTimeTrial(page, 'storm-reef');
  const heading = diagnostics.player.heading;
  await callRaceHook(page, 'setPlayerKinematics', diagnostics.player.position.x, diagnostics.player.position.y ?? 0, diagnostics.player.position.z, Math.sin(heading) * 31, 0, -Math.cos(heading) * 31);
  await page.keyboard.down('KeyW');
  let landed = false;
  for (let step = 0; step < 180; step += 1) {
    await advanceGame(page, 100);
    diagnostics = await readRaceDiagnostics(page);
    if ((diagnostics.player.landingIntensity ?? 0) > 0.18) {
      landed = true;
      break;
    }
  }
  await page.keyboard.up('KeyW');
  expect(landed, 'Storm Reef should naturally exercise airborne-to-contact feedback').toBe(true);
  diagnostics = await capture(page, 'landing');
  expect(diagnostics.player.landingIntensity ?? 0).toBeGreaterThan(0.18);

  expectNoRuntimeErrors(errors);
});
