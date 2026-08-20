import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  callRaceHook,
  captureRuntimeErrors,
  expectNoRuntimeErrors,
  prepareTruthfulVisualState,
  readRaceDiagnostics,
} from './race-test-helpers';

test('captures truthful active-race and pause delivery artifacts', async ({ page }, testInfo) => {
  const errors = captureRuntimeErrors(page);
  const outputDir = path.resolve('artifacts', 'final-v2');
  const target = testInfo.project.name.startsWith('mobile') ? 'mobile' : 'desktop';
  await mkdir(outputDir, { recursive: true });

  const evidence = await prepareTruthfulVisualState(page, 'active-play');
  await page.screenshot({ path: path.join(outputDir, `${target}-active-play.png`) });

  await callRaceHook(page, 'setPausedForScreenshot', false);
  await page.locator('#pause-button').click();
  await expect(page.locator('#pause-overlay')).toBeVisible();
  await expect.poll(async () => (await readRaceDiagnostics(page)).gameplay.paused).toBe(true);
  const paused = await readRaceDiagnostics(page);
  await page.screenshot({ path: path.join(outputDir, `${target}-pause.png`) });

  await writeFile(
    path.join(outputDir, `${target}-diagnostics.json`),
    `${JSON.stringify({ active: evidence.captured, movement: evidence.movement, paused }, null, 2)}\n`,
    'utf8',
  );
  expectNoRuntimeErrors(errors);
});
