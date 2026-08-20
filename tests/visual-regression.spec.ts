import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import {
  prepareTruthfulVisualState,
  type RaceDiagnostics,
  type TruthfulVisualEvidence,
  type TruthfulVisualState,
} from './race-test-helpers';

type BaselineState = {
  visualState: TruthfulVisualState;
  expectedState: 'countdown' | 'racing' | 'finished';
  snapshotName: string;
};

const BASELINE_STATES: BaselineState[] = [
  { visualState: 'countdown', expectedState: 'countdown', snapshotName: 'countdown' },
  { visualState: 'active-play', expectedState: 'racing', snapshotName: 'active-play' },
  { visualState: 'results', expectedState: 'finished', snapshotName: 'results' },
];

async function prepareBaseline(page: Page, state: BaselineState): Promise<TruthfulVisualEvidence> {
  const evidence = await prepareTruthfulVisualState(page, state.visualState);
  expect(evidence.captured.state).toBe(state.expectedState);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(150);
  return evidence;
}

function pixelDifferenceRatio(first: Buffer, second: Buffer): number {
  const a = PNG.sync.read(first);
  const b = PNG.sync.read(second);
  expect({ width: a.width, height: a.height }).toEqual({ width: b.width, height: b.height });

  let changed = 0;
  const total = a.width * a.height;
  for (let offset = 0; offset < a.data.length; offset += 4) {
    const delta =
      Math.abs(a.data[offset] - b.data[offset]) +
      Math.abs(a.data[offset + 1] - b.data[offset + 1]) +
      Math.abs(a.data[offset + 2] - b.data[offset + 2]);
    if (delta > 24) changed += 1;
  }
  return changed / total;
}

function movementBetween(a: RaceDiagnostics, b: RaceDiagnostics): number {
  return Math.hypot(
    a.player.position.x - b.player.position.x,
    a.player.position.z - b.player.position.z,
  );
}

for (const state of BASELINE_STATES) {
  test(`${state.snapshotName} visual baseline`, async ({ page }, testInfo) => {
    const evidence = await prepareBaseline(page, state);
    await testInfo.attach(`${state.snapshotName}-diagnostics`, {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
    await expect(page).toHaveScreenshot(`${state.snapshotName}-${testInfo.project.name}.png`, {
      animations: 'disabled',
      fullPage: true,
      maxDiffPixelRatio: 0.018,
    });
  });
}

test('countdown, active play, and results are diagnostically and visibly distinct', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'One viewport is sufficient for state-truth assertions.');
  test.setTimeout(30_000);

  const countdown = await prepareTruthfulVisualState(page, 'countdown');
  const countdownPixels = await page.screenshot({ fullPage: true });
  const active = await prepareTruthfulVisualState(page, 'active-play');
  const activePixels = await page.screenshot({ fullPage: true });
  const results = await prepareTruthfulVisualState(page, 'results');
  const resultsPixels = await page.screenshot({ fullPage: true });

  expect(countdown.captured.state).toBe('countdown');
  expect(active.captured.state).toBe('racing');
  expect(results.captured.state).toBe('finished');
  expect(active.captured.raceTime).toBeGreaterThan(countdown.captured.raceTime + 2);
  expect(results.captured.raceTime).toBeGreaterThan(active.captured.raceTime + 0.35);
  expect(movementBetween(countdown.captured, active.captured)).toBeGreaterThan(2);
  expect(movementBetween(active.captured, results.captured)).toBeGreaterThan(0.5);
  expect(active.captured.player.speed).toBeGreaterThan(countdown.captured.player.speed + 2);
  expect(results.captured.player.speed).toBeGreaterThan(2);

  const countdownToActive = pixelDifferenceRatio(countdownPixels, activePixels);
  const activeToResults = pixelDifferenceRatio(activePixels, resultsPixels);
  expect(countdownToActive, 'active racing pixels should differ materially from the start grid').toBeGreaterThan(0.03);
  expect(activeToResults, 'results overlay and finish state should differ materially from active racing').toBeGreaterThan(0.008);

  await testInfo.attach('visual-state-truth-report', {
    body: JSON.stringify(
      {
        diagnostics: { countdown, active, results },
        pixelDifferenceRatio: { countdownToActive, activeToResults },
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});
