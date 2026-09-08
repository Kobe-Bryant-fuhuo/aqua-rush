import { expect, test } from '@playwright/test';
import { RaceTrack } from '../../src/game/Track';
import { getTrackDefinition } from '../../src/game/ContentCatalog';
import type { RoomSnapshot, ServerMessage } from '../../src/shared/OnlineProtocol';
import { Peer } from './Peer';
import { pilot } from './pilot';

for (const trackId of ['breakwater', 'nightfall', 'sunken-temple'] as const) {
  test(`four real socket clients naturally finish ${trackId} and rematch`, async ({ request, baseURL }, testInfo) => {
    test.skip(process.env.ONLINE_FULL_RACE !== '1' || testInfo.project.name !== 'desktop-chrome', 'Opt-in real-time full-race verification.');
    test.setTimeout(240_000);
    const response = await request.post('/api/rooms');
    expect(response.status()).toBe(201);
    const { code } = await response.json() as { code: string };
    const peers: Peer[] = [];
    const ids: string[] = [];
    const track = new RaceTrack(getTrackDefinition(trackId));
    let matchId = '';
    let latest: RoomSnapshot | null = null;
    let finishedResolve: (state: RoomSnapshot) => void = () => {};
    const finished = new Promise<RoomSnapshot>((resolve) => { finishedResolve = resolve; });
    try {
      for (let slot = 0; slot < 4; slot += 1) {
        const peer = new Peer(baseURL!, code, `Captain ${slot + 1}`);
        peers.push(peer);
        const welcome = await peer.wait((message) => message.type === 'welcome');
        if (welcome.type !== 'welcome') throw new Error('Missing seat');
        ids.push(welcome.playerId);
        let sequence = 0;
        peer.socket.addEventListener('message', (event: MessageEvent<string>) => {
          const message = JSON.parse(event.data) as ServerMessage;
          if (message.type !== 'state') return;
          if (slot === 0) latest = message;
          if (message.phase === 'loading') {
            matchId = message.matchId;
            peer.send({ type: 'loaded', matchId });
          }
          const racer = message.race?.racers.find((entry) => entry.id === welcome.playerId);
          if (message.phase === 'racing' && racer && !racer.race.finished) {
            peer.send({ type: 'input', matchId, seq: ++sequence, ...pilot(track, racer, slot, message.race!.elapsed) });
          }
          if (message.phase === 'results' && slot === 0) finishedResolve(message);
        });
      }
      peers[0].send({ type: 'track', trackId });
      await peers[0].wait((message) => message.type === 'state' && message.trackId === trackId && message.players.length === 4);
      for (const peer of peers) peer.send({ type: 'ready', ready: true });
      await peers[0].wait((message) => message.type === 'state' && message.players.every((player) => player.ready));
      peers[0].send({ type: 'start' });
      const result = await Promise.race([
        finished,
        new Promise<never>((_, reject) => {
          const timeout = setTimeout(() => reject(new Error(`Full race timed out: ${JSON.stringify(latest)}`)), 220_000);
          void finished.then(() => clearTimeout(timeout));
        }),
      ]);
      expect(result.players.every((player) => !player.dnf)).toBe(true);
      expect(result.race!.racers.every((racer) => racer.race.finished && racer.race.checkpointCount === 36)).toBe(true);
      for (const peer of peers) {
        const same = await peer.wait((message): message is RoomSnapshot => message.type === 'state' && message.phase === 'results');
        expect(same.race!.racers.map((racer) => [racer.id, racer.race.place, racer.race.finishTime]))
          .toEqual(result.race!.racers.map((racer) => [racer.id, racer.race.place, racer.race.finishTime]));
      }
      await testInfo.attach(`${trackId}-results`, { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
      peers[0].send({ type: 'rematch' });
      const lobby = await peers[0].wait((message): message is RoomSnapshot => message.type === 'state' && message.phase === 'lobby' && message.matchId === '' && message.players.length === 4);
      expect(lobby.players.every((player) => !player.ready)).toBe(true);
      for (const peer of peers) peer.send({ type: 'ready', ready: true });
      await peers[0].wait((message) => message.type === 'state' && message.phase === 'lobby' && message.players.every((player) => player.ready));
      peers[0].send({ type: 'start' });
      const next = await peers[0].wait((message): message is RoomSnapshot => message.type === 'state'
        && message.matchId !== result.matchId && !!message.race?.events.some((entry) => 'type' in entry.event && entry.event.type === 'countdown'));
      expect(next.race!.events.length).toBeGreaterThan(0);
    } finally { for (const peer of peers) peer.close(); }
  });
}
