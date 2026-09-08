import { mkdir, writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { callRaceHook, captureRuntimeErrors, expectNoRuntimeErrors, readRaceDiagnostics, waitForRaceGame } from './race-test-helpers';

for (const trackId of ['breakwater', 'nightfall'] as const) {
  test(trackId + ' has a calm detailed ocean during real throttle input', async ({ page }, info) => {
    test.setTimeout(60000);
    const directory = 'artifacts/ocean-refresh/' + info.project.name;
    await mkdir(directory, { recursive: true });
    const errors = captureRuntimeErrors(page);
    const texture = page.waitForResponse(response => response.url().includes('waternormals') && response.status() === 200);
    await waitForRaceGame(page);
    await texture;
    await callRaceHook(page, 'setPausedForScreenshot', true);
    await callRaceHook(page, 'hideDebugUi', true);
    await callRaceHook(page, 'selectSession', 'time-trial', trackId);
    await page.evaluate(() => window.advanceTime?.(3100));
    await page.keyboard.down('KeyW');
    const samples = [];
    for (let i = 0; i < 80; i++) {
      await page.evaluate(() => window.advanceTime?.(100));
      const d = await readRaceDiagnostics(page);
      samples.push({ time: d.elapsed, ...d.player });
      if (i === 29 || i === 59) {
        await page.screenshot({ path: directory + '/' + trackId + '-' + (i + 1) + '.png', scale: 'css' });
      }
    }
    await page.keyboard.up('KeyW');
    await writeFile(directory + '/' + trackId + '.json', JSON.stringify(samples, null, 2));
    expect(samples.filter(s => s.airborne).length / samples.length).toBeLessThan(0.2);
    const ys = samples.map(s => s.position.y ?? 0);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.2);
    expectNoRuntimeErrors(errors);
  });
}
