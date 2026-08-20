import { expect, test } from '@playwright/test';
import {
  callRaceHook,
  captureRuntimeErrors,
  driveRepresentativeRace,
  expectNoRuntimeErrors,
  readRaceDiagnostics,
  waitForRaceGame,
} from './race-test-helpers';

const visualOptions = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
  maxDiffPixelRatio: 0.018,
};

async function prepareSession(
  page: Parameters<typeof waitForRaceGame>[0],
  mode: 'quick-race' | 'time-trial',
  trackId: 'sunset-circuit' | 'storm-reef',
) {
  await waitForRaceGame(page);
  await callRaceHook(page, 'hideDebugUi', true);
  await callRaceHook(page, 'setReducedMotion', false);
  // Keep the realtime RAF loop frozen around every fixed-step advance. Without
  // this, the countdown poll can leak a few wall-clock frames and make the AI,
  // camera and wake pools land in different screenshot poses.
  await callRaceHook(page, 'setPausedForScreenshot', true);
  await callRaceHook(page, 'selectSession', mode, trackId);
  await page.evaluate(() => window.advanceTime?.(3_100));
  await expect.poll(async () => (await readRaceDiagnostics(page)).state).toBe('racing');
  const evidence = await driveRepresentativeRace(page, 2.35);
  await callRaceHook(page, 'setPausedForScreenshot', true);
  return evidence;
}

test.describe('V3 course and mode visual baselines', () => {
  for (const trackId of ['sunset-circuit', 'storm-reef'] as const) {
    for (const mode of ['quick-race', 'time-trial'] as const) {
      test(`${trackId} ${mode} truthful desktop`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-chrome', 'Desktop content matrix is captured once.');
        const errors = captureRuntimeErrors(page);
        const evidence = await prepareSession(page, mode, trackId);
        expect(evidence.movement).toBeGreaterThan(2);
        const diagnostics = await readRaceDiagnostics(page);
        expect(diagnostics.session.trackId).toBe(trackId);
        expect(diagnostics.session.mode).toBe(mode);
        expect(diagnostics.racers).toHaveLength(mode === 'quick-race' ? 4 : 1);
        await expect(page).toHaveScreenshot(`${trackId}-${mode}-desktop.png`, visualOptions);
        expectNoRuntimeErrors(errors);
      });
    }
  }

  test('title mode and course menus remain visually distinct', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'Menu matrix is captured once.');
    const errors = captureRuntimeErrors(page);
    await waitForRaceGame(page);
    await expect(page).toHaveScreenshot('v3-title-desktop.png', visualOptions);
    await page.locator('#title-start-button').click();
    await expect(page.locator('#mode-select-screen')).toBeVisible();
    await expect(page).toHaveScreenshot('v3-mode-select-desktop.png', visualOptions);
    await page.locator('#mode-quick-race-button').click();
    await expect(page.locator('#course-select-screen')).toBeVisible();
    await expect(page).toHaveScreenshot('v3-course-select-desktop.png', visualOptions);
    expectNoRuntimeErrors(errors);
  });

  test('mobile portrait Storm Reef race keeps the driving corridor clear', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', 'Mobile layout is captured in the mobile project.');
    const errors = captureRuntimeErrors(page);
    await page.setViewportSize({ width: 390, height: 664 });
    await prepareSession(page, 'quick-race', 'storm-reef');
    await expect(page).toHaveScreenshot('storm-reef-mobile-portrait.png', visualOptions);
    expectNoRuntimeErrors(errors);
  });

  test('mobile short landscape Sunset Time Trial remains readable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', 'Mobile layout is captured in the mobile project.');
    const errors = captureRuntimeErrors(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await prepareSession(page, 'time-trial', 'sunset-circuit');
    await expect(page).toHaveScreenshot('sunset-time-trial-mobile-landscape.png', visualOptions);
    expectNoRuntimeErrors(errors);
  });
});
