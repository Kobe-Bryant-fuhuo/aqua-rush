import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { TRACK_IDS, getTrackDefinition } from '../src/game/ContentCatalog';
import { callRaceHook, captureRuntimeErrors, expectNoRuntimeErrors, readRaceDiagnostics, waitForRaceGame } from './race-test-helpers';

const EXPERIMENTAL = TRACK_IDS;

test('all three course cards are reachable and the experimental shelf is explicit', async ({ page }, info) => {
  await waitForRaceGame(page);
  await page.locator('#title-start-button').click();
  await page.locator('#mode-time-trial-button').click();
  for (const id of TRACK_IDS) {
    const card = page.locator(`#course-${id}-button`);
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeInViewport();
    await expect(card.locator('svg polygon')).toHaveAttribute('points', /,/);
    if (getTrackDefinition(id).experimental) {
      await expect(card.locator('.course-meta i')).toBeVisible();
      await expect(card).toContainText(id === 'sunken-temple' ? 'NEW' : 'Experimental');
    }
  }
  await page.locator('.course-card-grid').evaluate(node => { node.scrollTop = 0; });
  await page.screenshot({ path: `artifacts/map-expansion/course-shelf-${info.project.name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const id of EXPERIMENTAL) {
  test(`${id}: real menu and keyboard pilot finish three laps`, async ({ page }, info) => {
    test.setTimeout(90_000);
    const errors = captureRuntimeErrors(page);
    await waitForRaceGame(page);
    await page.locator('#title-start-button').click();
    await page.locator('#mode-time-trial-button').click();
    await page.locator(`#course-${id}-button`).click();
    await page.locator('#course-race-button').click();
    await page.evaluate(() => window.advanceTime!(3100));
    // Keyboard events drive the production input controller; only the fixed clock is accelerated.
    const result = await page.evaluate(() => {
      const key = (code: string, down: boolean) => document.body.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true }));
      let lastSteer = '', throttle = false;
      const captures: Array<{ lap: number; checkpoint: number; time: number }> = [];
      for (let step = 0; step < 2400; step++) {
        const d = window.__THREE_GAME_DIAGNOSTICS__!;
        if (d.state === 'finished') break;
        const target = d.track.lookAheadPosition;
        const angle = Math.atan2(target.x - d.player.position.x, -(target.z - d.player.position.z)) - d.player.heading;
        const error = Math.atan2(Math.sin(angle), Math.cos(angle));
        const steer = error > .045 ? 'KeyD' : error < -.045 ? 'KeyA' : '';
        if (steer !== lastSteer) {
          if (lastSteer) key(lastSteer, false);
          if (steer) key(steer, true);
          lastSteer = steer;
        }
        const accelerate = Math.abs(error) < .65 || d.player.speed < 9;
        if (accelerate !== throttle) { key('KeyW', accelerate); throttle = accelerate; }
        window.advanceTime!(100);
        if (step % 100 === 0) captures.push({ lap: d.player.lap, checkpoint: d.player.checkpoint, time: d.raceTime });
      }
      if (lastSteer) key(lastSteer, false);
      key('KeyW', false);
      return { diagnostics: window.__THREE_GAME_DIAGNOSTICS__!, captures };
    });
    await mkdir('artifacts/map-expansion', { recursive: true });
    await writeFile(`artifacts/map-expansion/${id}-pilot-${info.project.name}.json`, JSON.stringify(result, null, 2), 'utf8');
    await info.attach('natural-pilot', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
    expect(result.diagnostics.state, JSON.stringify(result.captures)).toBe('finished');
    expect(result.diagnostics.score).toBe(36);
    expect(result.diagnostics.recovery.count).toBe(0);
    expectNoRuntimeErrors(errors);
    await page.screenshot({ path: `artifacts/map-expansion/${id}-finish-${info.project.name}.png` });
  });
}

test('reduced motion preserves wave physics and pause freezes simulation time', async ({ page }) => {
  await waitForRaceGame(page);
  const run = (reduced: boolean) => page.evaluate((reduced) => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__!;
    hooks.selectSession('time-trial', 'breakwater');
    hooks.setReducedMotion(reduced);
    window.advanceTime!(3100);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    window.advanceTime!(2000);
    document.body.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
    return window.__THREE_GAME_DIAGNOSTICS__!;
  }, reduced);
  const normal = await run(false), reduced = await run(true);
  expect(reduced.player.position.x).toBeCloseTo(normal.player.position.x, 5);
  expect(reduced.player.position.y).toBeCloseTo(normal.player.position.y!, 5);
  expect(reduced.player.position.z).toBeCloseTo(normal.player.position.z, 5);
  await callRaceHook(page, 'setPausedForScreenshot', false);
  await page.locator('#pause-button').click();
  const before = await readRaceDiagnostics(page);
  await page.evaluate(() => window.advanceTime!(2000));
  const after = await readRaceDiagnostics(page);
  expect(after.elapsed).toBe(before.elapsed);
  expect(after.raceTime).toBe(before.raceTime);
});

test('new world kits release resources across repeated track changes', async ({ page }, info) => {
  await waitForRaceGame(page);
  const samples = [];
  for (let cycle = 0; cycle < 2; cycle++) {
    for (const id of EXPERIMENTAL) {
      await callRaceHook(page, 'selectSession', 'quick-race', id);
      await page.evaluate(() => window.advanceTime!(3100));
      const d = await readRaceDiagnostics(page);
      samples.push({ id, ...d.renderer });
      if (cycle === 0) await page.screenshot({ path: `artifacts/map-expansion/${id}-race-${info.project.name}.png` });
    }
  }
  for (let i = 0; i < EXPERIMENTAL.length; i++) {
    expect(samples[i + EXPERIMENTAL.length].geometries).toBeLessThanOrEqual(samples[i].geometries + 2);
    expect(samples[i + EXPERIMENTAL.length].textures).toBeLessThanOrEqual(samples[i].textures + 1);
  }
  await mkdir('artifacts/map-expansion', { recursive: true });
  await writeFile(`artifacts/map-expansion/resources-${info.project.name}.json`, JSON.stringify(samples, null, 2), 'utf8');
  await info.attach('world-kit-resources', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });
});
