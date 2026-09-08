import { test, expect } from '@playwright/test';
import { TRACK_IDS, getTrackDefinition } from '../src/game/ContentCatalog';
import { RaceTrack } from '../src/game/Track';
import { waitForRaceGame, callRaceHook, captureRuntimeErrors, expectNoRuntimeErrors } from './race-test-helpers';

test('rebuilt worlds preview, select and launch through the new interface', async ({ page }, info) => {
  const errors = captureRuntimeErrors(page);
  await waitForRaceGame(page);
  await page.screenshot({ path: `artifacts/rebuild-title-${info.project.name}.png` });
  await page.locator('#title-start-button').click();
  await page.locator('#mode-quick-race-button').click();
  for (const id of TRACK_IDS) {
    await page.locator(`#course-${id}-button`).click();
    await expect(page.locator('#course-detail')).toBeVisible();
    await page.screenshot({ path: `artifacts/rebuild-preview-${id}-${info.project.name}.png` });
  }
  await page.locator('#course-breakwater-button').click();
  await page.locator('#course-race-button').click();
  await page.evaluate(() => window.advanceTime!(3100));
  await page.screenshot({ path: `artifacts/rebuild-race-${info.project.name}.png` });
  expectNoRuntimeErrors(errors);
});

test('a real throttle approach produces a visible jump in each world', async ({ page }, info) => {
  test.setTimeout(60_000);
  await waitForRaceGame(page);
  await callRaceHook(page, 'setPausedForScreenshot', true);
  for (const id of TRACK_IDS) {
    await callRaceHook(page, 'selectSession', 'time-trial', id);
    await page.evaluate(() => window.advanceTime!(3100));
    const ramp = new RaceTrack(getTrackDefinition(id)).mechanics.ramps[0];
    const airborne = await page.evaluate(({ center, forward, length }) => {
      const key = (code: string, down: boolean) => document.body.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
      let previous = '';
      key('KeyW', true);
      for (let step = 0; step < 700; step++) {
        const d = window.__THREE_GAME_DIAGNOSTICS__!;
        if (d.player.flightActive && (d.player.flightTime ?? 0) > .3) {
          key('KeyW', false); if (previous) key(previous, false); return true;
        }
        let target = d.track.lookAheadPosition;
        const dx = d.player.position.x - center.x, dz = d.player.position.z - center.z;
        const along = dx * forward.x + dz * forward.z;
        if (Math.hypot(dx, dz) < 45 && along < length / 2 + 4) {
          const aim = along < -length / 2 - 4 ? -length / 2 : length / 2 + 12;
          target = { x: center.x + forward.x * aim, z: center.z + forward.z * aim };
        }
        const angle = Math.atan2(target.x - d.player.position.x, -(target.z - d.player.position.z)) - d.player.heading;
        const error = Math.atan2(Math.sin(angle), Math.cos(angle));
        const next = error > .05 ? 'KeyD' : error < -.05 ? 'KeyA' : '';
        if (next !== previous) { if (previous) key(previous, false); if (next) key(next, true); previous = next; }
        window.advanceTime!(100);
      }
      key('KeyW', false); if (previous) key(previous, false); return false;
    }, { center: { x: ramp.center.x, z: ramp.center.z }, forward: { x: ramp.forward.x, z: ramp.forward.z }, length: ramp.length });
    expect(airborne, id + ' should reach a jump through ordinary controls').toBe(true);
    await page.screenshot({ path: `artifacts/rebuild-jump-${id}-${info.project.name}.png` });
  }
});
