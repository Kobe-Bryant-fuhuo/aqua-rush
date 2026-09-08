# Online Race on Cloudflare

Online Race adds friend rooms for 2–4 players on Breakwater, Nightfall, and Sunken Temple. Protocol v5 includes skill-chain and drafting state, departed-racer flags, graded landings and timed barge crossings; deploy frontend and Worker together.
Quick Race and Time Trial continue to work without a network service. Online
results never update local Time Trial records.

## Play

1. Open the same deployed game URL on each device.
2. Choose **Start racing → Online Race**, enter a nickname, and create a room.
3. Share the eight-character room code. Friends enter it under **Join room**.
4. The host selects the course. Everyone presses **Ready**, then the host starts.
5. All clients load the course before a shared countdown begins.

Opening or refreshing the URL always shows the **Start racing** main menu. A saved
room does not connect automatically. To restore a seat within its reconnect
window, choose **Start racing → Online Race → Join room**; the previous nickname
and room code are prefilled. Connection interruptions during an open online
session still retry automatically.

Keyboard and touch controls are shared with the single-player game. Pause opens
your own menu; the race keeps running. R/Enter cannot restart a live online race.
X requests recovery at the last legal sector without advancing progress or
refilling boost. The host can return everyone to the lobby after final results.

## Run locally

Use a Node.js version supported by the pinned Vite and Wrangler dependencies.

```sh
npm ci
npx playwright install chromium
npm run cf:dev
```

Open `http://127.0.0.1:8787`. This builds the frontend and runs the actual Worker
and Durable Objects runtime locally. Open separate browser profiles or devices
for different players. The ordinary `npm run dev` still serves the standalone
game at port 5188; use `cf:dev` for the integrated room service.

## Deploy

The application uses **Workers Static Assets + a Worker + SQLite-backed Durable
Objects**, all on one origin. A VPS, Pages project, external database, Colyseus
server, and CORS configuration are unnecessary for this deployment.

```sh
npx wrangler login
npx wrangler whoami
npm run cf:deploy
```

Wrangler prints the public HTTPS URL. WebSocket connections automatically use WSS
on that origin. The committed Worker name is `aqua-rush-online`; choose a distinct
name before deploying another copy. If your login has multiple accounts, select
the intended account through Wrangler or `CLOUDFLARE_ACCOUNT_ID`. Do not commit
tokens or local `.dev.vars` files.

`wrangler.jsonc` declares the room namespace, first SQLite class migration, static
asset binding, request rate limits, and sampled observability. A `/api/health`
request confirms the deployed protocol version. Future deployments may interrupt
in-memory matches; finish active races before deploying an update.

## Architecture

- `server/worker.ts` serves the API and routes each code to its own Durable Object.
- `server/RaceRoom.ts` owns WebSockets, bounded message rates, scheduling and cleanup.
- `server/RoomSession.ts` owns membership, readiness, loading, host management,
  reconnection and phase transitions independently of the transport.
- `src/shared/OnlineSimulation.ts` runs the existing `ArcadeBoat`, wave, collision,
  interaction and checkpoint rules without geometry or a renderer. Three.js
  transform/math objects are reused deliberately; no second physics engine exists.
- `src/network` handles connection recovery, the lobby, client prediction and
  remote interpolation. `Game` maps network racer IDs to local visual objects.
  Slot colours and boat models remain consistent across players.

Simulation runs at a fixed 60 Hz with snapshots sent every 50 ms. Clients send
sequenced controls, never authoritative positions, finish claims or frame deltas.
The server chooses how many simulation steps run. Message arrival cannot postpone
the simulation timer. Catch-up after a runtime stall is bounded to 250 ms per tick.
Ordinary commands are coalesced into a 50 ms update; rejected commands do not
broadcast, and unchanged snapshots are suppressed. Membership joins still send
an immediate state. Race events are sent once over the ordered WebSocket stream;
reconnection restores the full race state without replaying old effects.

The local boat predicts the shared motion rules, restores acknowledged snapshots
and replays unacknowledged inputs. Small corrections blend visually; recovery and
large corrections snap to server truth. Other boats use a continuous buffered
playback clock with 100–250 ms of adaptive jitter protection, including smooth
boat attitude and recovery boundaries. See [remote smoothness](online-smoothness.md)
for the measured comparison and diagnostic procedure. Full
state includes drift/boost timers, vertical velocity and wave feedback. Collisions
and gate rewards are authoritative; prediction does not replay reward events.

## Room rules and limits

- Rooms hold at most four racers; no public matchmaking, mid-race joining or AI fill.
- Seat tokens travel in WebSocket messages, not URL query strings or public state.
  They live in session storage for refresh recovery; expired seats are rejected.
- Disconnects clear controls and retain the seat for 15 seconds. Unfinished racers
  become DNF after that deadline; finished results remain valid. Host management
  transfers to a connected player without moving the simulation.
- A disconnect while loading cancels the start and returns everyone to the lobby,
  preserving the disconnected seat until its 15-second deadline. Explicit leavers
  release their lobby seat immediately. Starting again requires everyone ready.
- Opponent departures, disconnections and reconnections show a named notice in the
  lobby/race panel and the race HUD. The notice persists through ordinary snapshots;
  when all opponents have left, the remaining racer is told they can finish or leave.
- A ten-second heartbeat gap marks a connection lost; stale driving input becomes
  neutral after 250 ms. Browser blur and visibility changes release controls.
- Loading times out after 30 seconds. After the first finish, remaining racers have
  60 seconds; the whole race is limited to ten minutes of simulation time.
- Idle lobbies/results close after five minutes. A room has a one-hour wall-clock
  lifetime; metadata and its alarm are reclaimed. Matches do not survive a Worker
  restart, deployment, or runtime eviction. Clients show a reconnect/expiry message.
- Anonymous creation is limited to ten requests per minute per IP, and connections
  to sixty. Individual sockets allow ninety small messages per second. These are
  abuse controls, not global capacity or spending caps.

Standard WebSockets and active simulation keep a room in memory. Cloudflare meters
its duration and requests; do not assume that an ongoing match can hibernate or
that usage is unlimited. SQLite-backed Durable Objects work on the Free plan,
whose quotas reject further operations when exhausted. Check your account's
current usage before a public launch; this project does not upgrade your plan.

See [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
and [WebSocket lifecycle](https://developers.cloudflare.com/durable-objects/examples/websocket-server/).

## Verify

```sh
npm run build
npm run cf:check
npx playwright test
npm run test:online
```

For real-time four-client races on both tracks, run in PowerShell:

```powershell
$env:ONLINE_FULL_RACE='1'
npx playwright test -c playwright.online.config.ts tests/online/full-race.spec.ts --project=desktop-chrome
```

When testing against an already-running server, set `PLAYWRIGHT_EXTERNAL_SERVER=1`
and optionally `PLAYWRIGHT_BASE_URL` to its URL. Use an isolated deployment: these
tests create and join actual rooms. The full-race test sends ordinary controls
through four WebSockets and compares every client's final standings before a rematch.

Core tests use a controlled clock for room boundaries and 50/100/200 ms RTT with
jitter. Browser tests cover two contexts, local pause, refresh reconnection,
host departure, same-origin enforcement and timer progress during message traffic.
`window.__AQUA_ONLINE__` exposes diagnostics without seat tokens; modifying a local
diagnostic or single-player test hook cannot change server race truth.
