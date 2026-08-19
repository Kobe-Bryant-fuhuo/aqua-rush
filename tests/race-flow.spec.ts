import { expect, test } from '@playwright/test';
import {
  callRaceHook,
  captureRuntimeErrors,
  expectNoRuntimeErrors,
  loadRaceState,
  readRaceDiagnostics,
} from './race-test-helpers';

test.describe('complete race flow', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'Race state flow is browser-independent.');
  });

  test('countdown gates the timer and transitions into active racing', async ({ page }) => {
    const errors = captureRuntimeErrors(page);
    await loadRaceState(page, 'countdown');

    const countdown = await readRaceDiagnostics(page);
    expect(countdown.countdown).toBeGreaterThan(0);
    expect(countdown.raceTime).toBe(0);
    await expect(page.locator('#countdown-overlay')).toBeVisible();

    await expect
      .poll(async () => (await readRaceDiagnostics(page)).state, { timeout: 6_000 })
      .toBe('racing');

    const started = await readRaceDiagnostics(page);
    expect(started.raceTime).toBeLessThan(1.5);
    await expect(page.locator('#countdown-overlay')).toBeHidden();
    expectNoRuntimeErrors(errors);
  });

  test('player controls and AI racers advance during active play', async ({ page }) => {
    const errors = captureRuntimeErrors(page);
    await loadRaceState(page, 'active-play');
    const before = await readRaceDiagnostics(page);

    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(900);
    await page.keyboard.up('KeyD');
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(250);

    const after = await readRaceDiagnostics(page);
    const playerDistance = Math.hypot(
      after.player.position.x - before.player.position.x,
      after.player.position.z - before.player.position.z,
    );
    expect(playerDistance, 'W/D should move and steer the player boat').toBeGreaterThan(0.6);
    expect(after.raceTime).toBeGreaterThan(before.raceTime);

    const aiBefore = new Map(
      before.racers.filter((racer) => !racer.isPlayer).map((racer) => [racer.id, racer]),
    );
    const aiDistance = after.racers
      .filter((racer) => !racer.isPlayer)
      .reduce((largest, racer) => {
        const previous = aiBefore.get(racer.id);
        if (!previous) return largest;
        return Math.max(
          largest,
          Math.hypot(
            racer.position.x - previous.position.x,
            racer.position.z - previous.position.z,
          ),
        );
      }, 0);
    expect(before.racers.filter((racer) => !racer.isPlayer)).toHaveLength(3);
    expect(aiDistance, 'at least one AI opponent should move along the circuit').toBeGreaterThan(0.4);
    expectNoRuntimeErrors(errors);
  });

  test('checkpoints validate order, three laps finish, and restart resets every racer', async ({ page }) => {
    const errors = captureRuntimeErrors(page);
    await loadRaceState(page, 'active-play');

    const initial = await readRaceDiagnostics(page);
    expect(initial.player.lap).toBe(1);
    expect(initial.track.checkpointCount).toBeGreaterThanOrEqual(5);

    const wrongCheckpoint =
      (initial.player.nextCheckpoint + 1) % initial.track.checkpointCount;
    await callRaceHook(page, 'advanceToCheckpoint', wrongCheckpoint);
    await page.waitForTimeout(100);
    const afterWrong = await readRaceDiagnostics(page);
    expect(afterWrong.player.nextCheckpoint, 'out-of-order checkpoint must not validate').toBe(
      initial.player.nextCheckpoint,
    );
    expect(afterWrong.player.lap).toBe(initial.player.lap);

    await callRaceHook(page, 'advanceToCheckpoint', initial.player.nextCheckpoint);
    await expect
      .poll(async () => (await readRaceDiagnostics(page)).player.nextCheckpoint)
      .not.toBe(initial.player.nextCheckpoint);

    await callRaceHook(page, 'setState', 'active-play');
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(250);
    await page.keyboard.up('KeyW');

    for (let completedLaps = 1; completedLaps <= 3; completedLaps += 1) {
      const beforeLap = await readRaceDiagnostics(page);
      await callRaceHook(page, 'completeLap');
      await expect
        .poll(async () => {
          const current = await readRaceDiagnostics(page);
          return `${current.state}:${current.player.lap}`;
        })
        .not.toBe(`${beforeLap.state}:${beforeLap.player.lap}`);

      const afterLap = await readRaceDiagnostics(page);
      if (completedLaps < 3) {
        expect(afterLap.state).toBe('racing');
        expect(afterLap.player.lap).toBe(completedLaps + 1);
      } else {
        expect(afterLap.state).toBe('finished');
        expect(afterLap.complete).toBe(true);
        expect(afterLap.player.finished).toBe(true);
        expect(afterLap.finalPlacement).toBeGreaterThanOrEqual(1);
        expect(afterLap.finalPlacement).toBeLessThanOrEqual(afterLap.racers.length);
        expect(afterLap.raceTime).toBeGreaterThan(0);
      }
    }

    await expect(page.locator('#results-overlay')).toBeVisible();
    await expect(page.locator('#results-screen')).toContainText(/finish|place|position|1st|2nd|3rd|4th/i);
    await expect(page.locator('#restart-button')).toBeVisible();
    await page.locator('#restart-button').click();

    await expect.poll(async () => (await readRaceDiagnostics(page)).state).toBe('countdown');
    const restarted = await readRaceDiagnostics(page);
    expect(restarted.player.lap).toBe(1);
    expect(restarted.player.checkpoint).toBe(0);
    expect(restarted.complete).toBe(false);
    expect(restarted.finalPlacement).toBeNull();
    expect(restarted.racers.every((racer) => !racer.finished)).toBe(true);
    await expect(page.locator('#results-overlay')).toBeHidden();
    expectNoRuntimeErrors(errors);
  });
});
