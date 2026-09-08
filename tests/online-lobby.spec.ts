import { expect, test } from '@playwright/test';
import { OnlineSimulation } from '../src/shared/OnlineSimulation';
import type { RoomSnapshot } from '../src/shared/OnlineProtocol';

test('departed finishers keep their time in live standings and results without a reconnect warning', async ({ page }) => {
  const players = ['Finisher', 'Racer'].map((name, slot) => ({ id: name, name, slot, connected: true, ready: true, dnf: false }));
  const simulation = new OnlineSimulation('breakwater', players);
  const snapshot: RoomSnapshot = { type: 'state', code: 'ABCDEFGH', hostId: 'Finisher', trackId: 'breakwater',
    matchId: 'race', phase: 'racing', players, race: simulation.snapshot() };
  simulation.dispose();
  const finisher = snapshot.race!.racers.find((entry) => entry.id === 'Finisher')!;
  finisher.race.finished = true;
  finisher.race.finishTime = 42.25;
  await page.route('**/review-lobby', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
  await page.goto('/review-lobby');
  await page.evaluate(async (state) => {
    // Exercise the actual DOM view with controlled server snapshots.
    const path = '/src/network/OnlineLobby.ts';
    const { OnlineLobby } = await import(/* @vite-ignore */ path);
    const noop = () => {};
    const lobby = new OnlineLobby({ connect: noop, ready: noop, start: noop, track: noop, rematch: noop, leave: noop }, noop);
    (window as unknown as { reviewLobby: typeof lobby }).reviewLobby = lobby;
    lobby.update(state, 'Racer', true, 0);
    const departed = structuredClone(state);
    departed.players[0].connected = false;
    departed.hostId = 'Racer';
    lobby.update(departed, 'Racer', true, 0);
  }, snapshot);
  await expect(page.locator('#online-standings li').filter({ hasText: 'Finisher' })).toContainText('42.25s');
  await expect(page.locator('#online-race-notice')).toContainText('Their result is saved');
  await expect(page.locator('#online-race-status')).not.toContainText('reconnecting');
  await page.evaluate((state) => {
    state.players[0].connected = false;
    state.phase = 'results';
    (window as unknown as { reviewLobby: { update: (snapshot: RoomSnapshot, id: string, connected: boolean, rtt: number) => void } })
      .reviewLobby.update(state, 'Racer', true, 0);
  }, snapshot);
  await expect(page.locator('#online-players li').filter({ hasText: 'Finisher' })).toContainText('42.25s');
  await expect(page.locator('#online-players')).not.toContainText('Reconnecting');
});
