import { expect, test, type Page } from '@playwright/test';
import type { RoomSnapshot } from '../../src/shared/OnlineProtocol';
import { Peer } from './Peer';

test('Cloudflare room owns simulation, supports real socket reconnection and survives host departure', async ({ request, baseURL }) => {
  const response = await request.post('/api/rooms');
  expect(response.status()).toBe(201);
  const { code } = await response.json() as { code: string };
  const a = new Peer(baseURL!, code, 'Host');
  await a.wait((message) => message.type === 'welcome');
  const b = new Peer(baseURL!, code, 'Guest');
  let resumed: Peer | null = null;
  try {
    const welcomeA = await a.wait((message) => message.type === 'welcome');
    const welcomeB = await b.wait((message) => message.type === 'welcome');
    if (welcomeA.type !== 'welcome' || welcomeB.type !== 'welcome') throw new Error('Missing welcome');
    const state = (peer: Peer, predicate: (state: RoomSnapshot) => boolean) => peer.wait((message): message is RoomSnapshot => message.type === 'state' && predicate(message));
    await state(a, (snapshot) => snapshot.players.length === 2);
    b.send({ type: 'start' });
    expect((await b.wait((message) => message.type === 'error')).type).toBe('error');
    a.send({ type: 'ready', ready: true });
    b.send({ type: 'ready', ready: true });
    await state(a, (snapshot) => snapshot.players.every((player) => player.ready));
    a.send({ type: 'start' });
    const loading = await state(a, (snapshot) => snapshot.phase === 'loading');
    a.send({ type: 'loaded', matchId: loading.matchId });
    b.send({ type: 'loaded', matchId: loading.matchId });
    const started = await state(a, (snapshot) => snapshot.phase === 'racing');
    const startX = started.race!.racers.find((racer) => racer.id === welcomeA.playerId)!.body.position;
    let sequence = 0;
    const inputTimer = setInterval(() => a.send({ type: 'input', matchId: started.matchId, seq: ++sequence, throttle: 1, steer: 0, boost: false }), 50);
    try {
      await state(b, (snapshot) => {
        const position = snapshot.race?.racers.find((racer) => racer.id === welcomeA.playerId)?.body.position;
        return !!position && Math.hypot(position[0] - startX[0], position[2] - startX[2]) > 2;
      });
    } finally { clearInterval(inputTimer); }
    const tickBeforeSpam = (await state(a, (snapshot) => snapshot.phase === 'racing')).race!.tick;
    const messageTimer = setInterval(() => b.send({ type: 'ready', ready: false }), 20);
    try {
      await state(a, (snapshot) => (snapshot.race?.tick ?? 0) > tickBeforeSpam + 60);
    } finally { clearInterval(messageTimer); }
    a.close(false);
    await state(b, (snapshot) => snapshot.hostId === welcomeB.playerId && !snapshot.players.find((player) => player.id === welcomeA.playerId)?.connected);
    resumed = new Peer(baseURL!, code, 'Host', welcomeA.token);
    const restored = await resumed.wait((message) => message.type === 'welcome');
    expect(restored.type === 'welcome' && restored.playerId).toBe(welcomeA.playerId);
    await state(resumed, (snapshot) => snapshot.matchId === started.matchId && snapshot.phase === 'racing');
    resumed.close();
    const remaining = await state(b, (snapshot) => !!snapshot.players.find((player) => player.id === welcomeA.playerId)?.dnf);
    expect(remaining.phase).toBe('racing');
    expect(remaining.hostId).toBe(welcomeB.playerId);
  } finally { a.close(); b.close(); resumed?.close(); }
});

test('foreign origins cannot create rooms or open room sockets', async ({ request }) => {
  const create = await request.post('/api/rooms', { headers: { Origin: 'https://unrelated.example' } });
  expect(create.status()).toBe(403);
  // Send a complete handshake: the production edge rejects malformed upgrades
  // before the Worker's origin guard gets a chance to inspect the request.
  const connect = await request.get('/api/rooms/ABCDEFGH', { headers: {
    Origin: 'https://unrelated.example', Upgrade: 'websocket', Connection: 'Upgrade',
    'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
  } });
  expect(connect.status()).toBe(403);
});

async function openOnline(page: Page, name: string) {
  await page.goto('/');
  await page.locator('#title-start-button').click();
  await page.locator('#mode-online-button').click();
  await page.locator('#online-name').fill(name);
}

test('two browsers race, pause locally and explicitly rejoin the same seat after refresh', async ({ page, browser, baseURL }) => {
  const guest = await browser.newPage({ baseURL, viewport: { width: 960, height: 640 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  guest.on('pageerror', (error) => errors.push(error.message));
  try {
    await openOnline(page, 'Yellow Captain');
    await page.locator('#online-create').click();
    await expect(page.locator('#online-room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{8}$/);
    const code = await page.locator('#online-room-code').innerText();
    await openOnline(guest, 'Reef Rider');
    await guest.locator('#online-code').fill(code);
    await guest.locator('#online-join').click();
    await expect(page.locator('#online-players li')).toHaveCount(2);
    await expect(guest.locator('#online-track')).toBeDisabled();
    await page.locator('#online-track').selectOption('nightfall');
    await expect(guest.locator('#online-track')).toHaveValue('nightfall');
    await page.screenshot({ path: `artifacts/online-lobby-${page.viewportSize()?.width}.png` });
    await page.locator('#online-ready').click();
    await guest.locator('#online-ready').click();
    await expect(page.locator('#online-start')).toBeEnabled();
    await page.locator('#online-start').click();
    await page.waitForFunction(() => window.__AQUA_ONLINE__?.state.phase === 'racing');
    await guest.waitForFunction(() => window.__AQUA_ONLINE__?.state.phase === 'racing');
    const started = await page.evaluate(() => window.__AQUA_ONLINE__!.state);
    const self = started.players.find((player) => player.name === 'Yellow Captain')!;
    const initial = started.race!.racers.find((racer) => racer.id === self.id)!.body.position;
    await page.keyboard.down('KeyW');
    await page.waitForFunction(({ id, initial }) => {
      const position = window.__AQUA_ONLINE__?.state.race?.racers.find((racer) => racer.id === id)?.body.position;
      return position && Math.hypot(position[0] - initial[0], position[2] - initial[2]) > 2;
    }, { id: self.id, initial });
    await page.keyboard.up('KeyW');
    await page.keyboard.press('KeyP');
    await expect(page.locator('#pause-overlay')).toBeVisible();
    const pausedTick = await page.evaluate(() => window.__AQUA_ONLINE__!.state.race!.tick);
    await guest.waitForFunction((tick) => window.__AQUA_ONLINE__!.state.race!.tick > tick + 30, pausedTick);
    await page.keyboard.press('KeyR');
    expect(await page.evaluate(() => window.__AQUA_ONLINE__!.state.matchId)).toBe(started.matchId);
    await page.keyboard.press('KeyP');
    await page.screenshot({ path: `artifacts/online-race-${page.viewportSize()?.width}.png` });
    await page.reload();
    await expect(page.locator('#title-screen')).toBeVisible();
    await expect(page.locator('#online-panel')).toBeHidden();
    await page.locator('#title-start-button').click();
    await page.locator('#mode-online-button').click();
    await expect(page.locator('#online-code')).toHaveValue(code);
    await page.locator('#online-join').click();
    await page.waitForFunction((matchId) => window.__AQUA_ONLINE__?.connected && window.__AQUA_ONLINE__.state.matchId === matchId, started.matchId);
    const resumed = await page.evaluate(() => window.__AQUA_ONLINE__!.state);
    expect(resumed.players.find((player) => player.name === 'Yellow Captain')?.id).toBe(self.id);
    expect(resumed.race!.tick).toBeGreaterThan(pausedTick);
    await expect(guest.locator('#online-race-notice')).toContainText('Yellow Captain reconnected.');
    await expect(guest.locator('#online-race-notice')).toBeVisible();
    expect(errors).toEqual([]);
    await page.locator('#online-race-leave').click();
    await expect(page.locator('#title-start-button')).toBeVisible();
    await guest.locator('#online-race-leave').click();
  } finally { await guest.close(); }
});

test('waiting for another racer to load never sends driving inputs', async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'The loading protocol is independent of viewport.');
  let inputs = 0;
  page.on('websocket', (socket) => socket.on('framesent', (event) => {
    if (typeof event.payload === 'string' && JSON.parse(event.payload).type === 'input') inputs += 1;
  }));
  await openOnline(page, 'Waiting host');
  await page.locator('#online-create').click();
  await expect(page.locator('#online-room-code')).toHaveText(/^[A-HJ-NP-Z2-9]{8}$/);
  const code = await page.locator('#online-room-code').innerText();
  const peer = new Peer(baseURL!, code, 'Slow loader');
  try {
    await peer.wait((message) => message.type === 'welcome');
    peer.send({ type: 'ready', ready: true });
    await page.locator('#online-ready').click();
    await page.locator('#online-start').click();
    const loading = await peer.wait((message): message is RoomSnapshot => message.type === 'state' && message.phase === 'loading');
    const frame = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.frame);
    await page.waitForFunction((frame) => window.__THREE_GAME_DIAGNOSTICS__!.frame > frame + 300, frame);
    expect(inputs).toBe(0);
    peer.send({ type: 'loaded', matchId: loading.matchId });
    await page.waitForFunction(() => window.__AQUA_ONLINE__?.state.phase === 'racing');
    await page.keyboard.down('KeyW');
    await page.waitForFunction(() => window.__AQUA_ONLINE__!.state.race!.racers.some((racer) => racer.body.numbers.speed > 3));
    await page.keyboard.up('KeyW');
    await page.locator('#online-race-leave').click();
  } finally { peer.close(); }
});
