import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { RaceTrack } from '../../src/game/Track';
import { getTrackDefinition } from '../../src/game/ContentCatalog';
import type { ServerMessage } from '../../src/shared/OnlineProtocol';
import { Peer } from './Peer';
import { pilot } from './pilot';

for (const opponents of [1, 3]) test(`${opponents} opponents render smoothly with delayed real WebSocket snapshots`, async ({ page, baseURL }, testInfo) => {
  test.skip(process.env.ONLINE_SMOOTHNESS !== '1' || testInfo.project.name !== 'desktop-chrome', 'Opt-in production rendering measurement.');
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let delivery = 0;
  let messageIndex = 0;
  await page.routeWebSocket('**/api/rooms/*', (socket) => {
    const server = socket.connectToServer();
    server.onMessage((raw) => {
      // Preserve WebSocket order while varying arrival intervals independently
      // of the real server's simulation and the browser's render frames.
      const now = performance.now();
      delivery = Math.max(delivery, now + 50 + [0, 35, 5, 25][messageIndex++ % 4]);
      const timer = setTimeout(() => { timers.delete(timer); socket.send(raw); }, delivery - now);
      timers.add(timer);
    });
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.locator('#title-start-button').click();
  await page.locator('#mode-online-button').click();
  await page.locator('#online-create').click();
  await expect(page.locator('#online-room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{8}$/);
  const code = await page.locator('#online-room-code').innerText();
  const peers: Peer[] = [];
  const track = new RaceTrack(getTrackDefinition('breakwater'));
  try {
    for (let slot = 1; slot <= opponents; slot++) {
      const peer = new Peer(baseURL!, code, `Moving opponent ${slot}`);
      peers.push(peer);
      const welcome = await peer.wait((message) => message.type === 'welcome');
      if (welcome.type !== 'welcome') throw new Error('Missing seat');
      let sequence = 0;
      peer.socket.addEventListener('message', (event: MessageEvent<string>) => {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type !== 'state') return;
        if (message.phase === 'loading') peer.send({ type: 'loaded', matchId: message.matchId });
        const racer = message.race?.racers.find((entry) => entry.id === welcome.playerId);
        if (message.phase === 'racing' && racer) peer.send({ type: 'input', matchId: message.matchId,
          seq: ++sequence, ...pilot(track, racer, slot, message.race!.elapsed) });
      });
      peer.send({ type: 'ready', ready: true });
    }
    await page.locator('#online-ready').click();
    await page.locator('#online-start').click();
    await page.waitForFunction(() => window.__AQUA_ONLINE__?.state.phase === 'racing'
      && window.__THREE_GAME_DIAGNOSTICS__?.racers.some((racer) => !racer.isPlayer && racer.speed > 7));
    const report = await page.evaluate(async () => {
      const gl = document.querySelector<HTMLCanvasElement>('#game-canvas')!.getContext('webgl2')!;
      const extension = gl.getExtension('WEBGL_debug_renderer_info');
      const gpu = extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      const samples: Array<{ frameMs: number; tick: number; racers: Array<{ distance: number; speed: number }> }> = [];
      const started = performance.now();
      let lastTime = started;
      let lastPositions = new Map(window.__THREE_GAME_DIAGNOSTICS__!.racers.map((racer) => [racer.id, racer.position]));
      await new Promise<void>((resolve) => {
        const sample = (now: number) => {
          const racers = window.__THREE_GAME_DIAGNOSTICS__!.racers.filter((entry) => !entry.isPlayer);
          const state = window.__AQUA_ONLINE__!.state.race!;
          samples.push({ frameMs: now - lastTime, tick: state.tick, racers: racers.map((racer) => {
            // Diagnostics use local visual IDs; place maps to the same server
            // racer, while previous positions must survive standings reordering.
            const remote = state.racers.find((entry) => entry.race.place === racer.place)!;
            const previous = lastPositions.get(racer.id)!;
            return { distance: Math.hypot(racer.position.x - previous.x, racer.position.z - previous.z),
              speed: Math.hypot(remote.body.velocity[0], remote.body.velocity[2]) };
          }) });
          lastTime = now;
          lastPositions = new Map(racers.map((racer) => [racer.id, racer.position]));
          if (now - started >= 8000) resolve();
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      const frames = samples.slice(1);
      const moving = frames.flatMap((frame) => frame.racers).filter((racer) => racer.speed > 5);
      const sorted = frames.map((frame) => frame.frameMs).sort((a, b) => a - b);
      return { gpu, frames: frames.length, movingFrames: moving.length,
        p95FrameMs: sorted[Math.floor(sorted.length * .95)],
        stalledMovingFrames: moving.filter((frame) => frame.distance < .00001).length,
        averageFps: 1000 / (frames.reduce((sum, frame) => sum + frame.frameMs, 0) / frames.length),
        interpolation: window.__AQUA_ONLINE__!.interpolation, samples: frames };
    });
    await mkdir('artifacts', { recursive: true });
    await writeFile(`artifacts/online-smoothness-${process.env.SMOOTHNESS_LABEL ?? 'current'}-${opponents}.json`, JSON.stringify(report, null, 2), 'utf8');
    const { samples: _samples, ...summary } = report;
    console.log(JSON.stringify(summary));
    await testInfo.attach('online-smoothness', { body: JSON.stringify(summary, null, 2), contentType: 'application/json' });
    expect(errors).toEqual([]);
    expect(report.movingFrames).toBeGreaterThan(200);
    expect(report.stalledMovingFrames / report.movingFrames).toBeLessThan(.01);
  } finally {
    for (const peer of peers) peer.close();
    for (const timer of timers) clearTimeout(timer);
    await page.close();
  }
});
