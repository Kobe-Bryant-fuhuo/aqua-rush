import { expect, test, type Page } from '@playwright/test';
import { callRaceHook, readRaceDiagnostics, waitForRaceGame } from './race-test-helpers';

type BaselineState = {
  hookState: 'countdown' | 'active-play' | 'complete';
  expectedState: 'countdown' | 'racing' | 'finished';
  snapshotName: string;
};

const BASELINE_STATES: BaselineState[] = [
  { hookState: 'countdown', expectedState: 'countdown', snapshotName: 'countdown' },
  { hookState: 'active-play', expectedState: 'racing', snapshotName: 'active-play' },
  { hookState: 'complete', expectedState: 'finished', snapshotName: 'results' },
];

async function prepareBaseline(page: Page, state: BaselineState): Promise<void> {
  await waitForRaceGame(page);
  await callRaceHook(page, 'seed', 20260819);
  await callRaceHook(page, 'hideDebugUi', true);
  await callRaceHook(page, 'setReducedMotion', true);
  // Pause before changing state so no rAF update can slip between setState and
  // the later pause call. A two-call unpaused window shifted every boat/camera
  // silhouette by 4-8% depending on scheduling.
  await callRaceHook(page, 'setPausedForScreenshot', true);
  await callRaceHook(page, 'setState', state.hookState);
  await expect.poll(async () => (await readRaceDiagnostics(page)).state).toBe(state.expectedState);

  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(150);
}

for (const state of BASELINE_STATES) {
  test(`${state.snapshotName} visual baseline`, async ({ page }, testInfo) => {
    await prepareBaseline(page, state);
    await expect(page).toHaveScreenshot(`${state.snapshotName}-${testInfo.project.name}.png`, {
      animations: 'disabled',
      fullPage: true,
      maxDiffPixelRatio: 0.018,
    });
  });
}
