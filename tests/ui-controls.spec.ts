import { expect, test } from '@playwright/test';
import {
  captureRuntimeErrors,
  expectNoRuntimeErrors,
  loadRaceState,
  readRaceDiagnostics,
} from './race-test-helpers';

test('pause/resume and mute controls reflect real game state', async ({ page }, testInfo) => {
  const errors = captureRuntimeErrors(page);
  await loadRaceState(page, 'active-play');
  const pauseButton = page.locator('#pause-button');
  const muteButton = page.locator('#mute-button');

  await expect(pauseButton).toBeVisible();
  await expect(muteButton).toBeVisible();
  for (const button of [pauseButton, muteButton]) {
    const box = await button.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(42);
    expect(box?.height).toBeGreaterThanOrEqual(40);
  }

  await pauseButton.click();
  await expect(page.locator('#pause-overlay')).toBeVisible();
  await expect.poll(async () => (await readRaceDiagnostics(page)).gameplay.paused).toBe(true);
  const pausedAt = (await readRaceDiagnostics(page)).raceTime;
  await page.waitForTimeout(400);
  expect((await readRaceDiagnostics(page)).raceTime).toBeCloseTo(pausedAt, 3);

  const pausedScreenshot = await page.screenshot({ fullPage: true });
  await testInfo.attach(`${testInfo.project.name}-pause`, {
    body: pausedScreenshot,
    contentType: 'image/png',
  });

  await page.locator('#resume-button').click();
  await expect(page.locator('#pause-overlay')).toBeHidden();
  await expect.poll(async () => (await readRaceDiagnostics(page)).gameplay.paused).toBe(false);
  await expect.poll(async () => (await readRaceDiagnostics(page)).raceTime).toBeGreaterThan(pausedAt + 0.1);

  await muteButton.click();
  await expect(muteButton).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await readRaceDiagnostics(page)).gameplay.muted).toBe(true);
  await muteButton.click();
  await expect(muteButton).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await readRaceDiagnostics(page)).gameplay.muted).toBe(false);

  // Keyboard pause uses the same intent path as the HUD button.
  await page.keyboard.press('KeyP');
  await expect(page.locator('#pause-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-overlay')).toBeHidden();
  expectNoRuntimeErrors(errors);
});
