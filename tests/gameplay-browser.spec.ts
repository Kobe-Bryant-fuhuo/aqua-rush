import { test, expect } from '@playwright/test';
import { waitForRaceGame, callRaceHook, captureRuntimeErrors, expectNoRuntimeErrors } from './race-test-helpers';

for (const scenario of ['skills', 'crossing'] as const) test(`${scenario}: ordinary keyboard driving exposes the new decision and original UI`, async ({ page }, info) => {
  test.setTimeout(45_000);
  const errors = captureRuntimeErrors(page);
  await waitForRaceGame(page);
  await callRaceHook(page, 'setPausedForScreenshot', true);
  await callRaceHook(page, 'selectSession', 'quick-race', scenario === 'skills' ? 'breakwater' : 'nightfall');
  await page.evaluate(() => window.advanceTime!(3100));
  const result = await page.evaluate(scenario => {
    const key = (code: string, down: boolean) => document.body.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
    let lastSteer = '', held = false, heldFor = 0, driftSeen = false;
    key('KeyW', true);
    for (let step = 0; step < 1000; step++) {
      const d = window.__THREE_GAME_DIAGNOSTICS__!;
      driftSeen ||= d.player.skillKind === 1;
      const title = document.querySelector('#course-feature strong')?.textContent ?? '';
      if ((scenario === 'skills' && driftSeen && (d.player.skillChain ?? 0) >= 2) || (scenario === 'crossing' && title.includes('横渡'))) {
        key('KeyW', false); key('Space', false); if (lastSteer) key(lastSteer, false);
        return { success: true, title, driftSeen, player: d.player };
      }
      const target = d.track.lookAheadPosition;
      const angle = Math.atan2(target.x - d.player.position.x, -(target.z - d.player.position.z)) - d.player.heading;
      const error = Math.atan2(Math.sin(angle), Math.cos(angle));
      const steer = error > .04 ? 'KeyD' : error < -.04 ? 'KeyA' : '';
      if (steer !== lastSteer) { if (lastSteer) key(lastSteer, false); if (steer) key(steer, true); lastSteer = steer; }
      heldFor = held ? heldFor + .1 : 0;
      const nextHeld: boolean = scenario === 'skills' && !d.player.flightActive && d.player.speed > 12 &&
        (held ? (d.player.driftCharge ?? 0) < .32 && heldFor < 1.1 : Math.abs(error) > .15 && Math.abs(error) < .65);
      if (nextHeld !== held) { key('Space', nextHeld); held = nextHeld; }
      window.advanceTime!(100);
    }
    key('KeyW', false); key('Space', false); if (lastSteer) key(lastSteer, false);
    return { success: false, title: '', driftSeen, player: window.__THREE_GAME_DIAGNOSTICS__!.player };
  }, scenario);
  expect(result.success, JSON.stringify(result)).toBe(true);
  if (scenario === 'skills') await expect(page.locator('#skill-chain-label')).toHaveText(/×[23]/);
  else await expect(page.locator('#course-feature')).toContainText('右侧');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sun').trim())).toBe('#ffd85a');
  await page.screenshot({ path: `artifacts/gameplay-${scenario}-${info.project.name}.png` });
  expectNoRuntimeErrors(errors);
});
