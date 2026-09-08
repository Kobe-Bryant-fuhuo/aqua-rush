# Aqua Rush

Aqua Rush is a cel-shaded arcade boat racing game built with Vite, Three.js, TypeScript, and ES modules. It has three rebuilt worlds, each available locally and online: race three AI rivals in Quick Race, chase persistent per-course records in solo Time Trial, or race 2–4 friends in Online Race using a room code. All modes use three laps, directional checkpoint planes, open-water navigation, shared CPU/GPU wave truth, course interactions, and responsive desktop/mobile controls.

## Run the game

Requirements: a current Node.js release and desktop Chrome/Chromium.

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:5188>.

Production build and preview:

```bash
npm run build
npm run preview
```

The preview server uses <http://127.0.0.1:4188>.

## Online Race

For the integrated game and room server, run `npm run cf:dev` and open
<http://127.0.0.1:8787>. Choose **Online Race**, create a room, and share its
eight-character code. The host picks a course; everyone readies up before starting.

Deploy the frontend and room service together on Cloudflare with
`npx wrangler login` followed by `npm run cf:deploy`. This uses Workers Static
Assets and one Durable Object per room. See [online play and deployment](docs/online-multiplayer.md)
for setup, room rules, usage limits, and verification.

## Controls

| Input | Action |
| --- | --- |
| `W` / Up arrow | Accelerate |
| `S` / Down arrow | Brake, then reverse |
| `A` / `D` or Left / Right arrows | Steer |
| Hold `Space` while straight | Ordinary Boost |
| Hold `Space` while steering | Drift and build charge; release for a clean mini-boost |
| `P` / `Escape` | Pause or resume |
| `R` or `Enter` | Restart the race |
| `X` | Recover at the last valid sector |
| `F` | Toggle fullscreen |
| Pause / music HUD buttons | Pause/resume and mute/unmute |
| Touch stick / Boost button | Mobile steering, throttle, reverse, drift, and boost |

Drifts charge through three tiers. Release to burst and refill boost; clean ramp landings and reward gates can continue the sequence. A chain lasts ten seconds and caps at three, raising the boosted speed ceiling from 33 to 35/37 world units per second. Significant contact breaks it. Passive recharge is slower, so the next burst depends more on your driving.

In Quick Race and Online Race, stay 4–23 units behind an aligned moving rival to charge a slipstream. After 1.25 seconds, pull sideways out of the wake to receive the slingshot and boost refill. Stationary, opposing, finished and departed rivals cannot supply a draft. AI racers now spend boost and use drift releases too.

Nightfall's work barges have readable open, warning, crossing and clear phases. The center line can be obstructed; the marked right-side bypass remains open. Timing the center line gives access to an exit energy gate. See [gameplay changes and measured route choices](docs/gameplay-optimization.zh-CN.md).

Audio unlocks on the first keyboard or pointer gesture. If Web Audio is unavailable, the race continues silently.

## Game design contract

- **Player promise:** pilot the bright yellow hero boat across a large readable ocean, choosing clean lines and optional reward gates without being trapped by invisible walls.
- **Target feeling:** fast, responsive, forgiving, and competitive rather than physically realistic.
- **Primary verb:** steer a clean racing line. Secondary verbs are braking/reversing, chaining drift releases, aligning landings, drafting rivals and timing barge crossings.
- **Objective:** pass all 12 ordered directional sectors for each of three laps. Quick Race adds three rivals; Time Trial adds best-lap, best-total, PB, and new-record pressure.
- **Pressure:** distinct AI profiles, directional swell, earned boost, boat/boat contact, visible waterfront architecture, timed barge crossings, ramp landings, and optional water-level bypasses.
- **Reward:** placement or persistent record improvement, plus Boost Gates and drift-validated Drift Gates reinforced by HUD, VFX, camera, and synthesized audio.
- **Setback/retry:** collisions scrub speed instead of ending the race. The finish screen and `R`/`Enter` provide a fast full reset.
- **Skill expression:** hold the fastest line, anticipate turns, avoid contact, and spend boost where the reduced grip is manageable.
- **Non-goals:** infinite/projected-grid water, rigid-body hydrodynamics, career progression, public matchmaking, accounts, weapons, ghosts, cinematic story scenes.

Core loop:

> Choose a mode and course, accelerate across open water, follow the wave-bound guide, clear every directional sector, use optional Boost/Drift Gates, then improve placement or a persistent record before retrying or switching courses.

## Courses and modes

- **断潮坝 / Breakwater:** terraced cliffs, elevated spillways, two physical launch ramps, low seawall and a marked water-level bypass.
- **霓虹沉城 / Nightfall:** flooded building canyons, three synchronized work-barge crossings and a metro launch ramp. Signals warn before the center is obstructed; the marked right bypass remains open.
- **失落环礁 / Sunken Temple:** monumental stone arches, broken colonnades, a ramp over the ruin wall, and an optional current-assisted outside line.
- See [world rebuild design and validation](docs/world-rebuild.zh-CN.md) for mechanics, research references and limits.
- **Quick Race:** player plus KAI, MIRA, and NOX; three laps; placement results.
- **Time Trial:** player only; three laps; current/best lap, best total, PB comparison, new-record results, and versioned local persistence.
- **Online Race:** 2–4 human racers; room codes, shared countdown, authoritative results, short reconnect window, and return-to-lobby rematches. Pause affects only your controls; online races do not write Time Trial records.

The ocean is finite: roughly 800×800 units are playable and 1200×1200 are visible through near/mid/far LOD. Leaving the recommended line never causes a corridor collision, forced slowdown, or automatic teleport. Race legality comes only from ordered, back-to-front directional checkpoint crossings. Use `X` or the Pause menu Recovery action when desired.

## Architecture

- `src/core`: render loop, renderer sizing/DPR, and unified keyboard/touch input.
- `src/game`: catalog-driven content, app flow, versioned save store, directional checkpoint validation, open-water race/session rules, interactions, laps/placement, and deterministic QA hooks.
- `src/entities`: multi-point wave-following arcade boat motion, the player, and personality-driven look-ahead AI racers with avoidance and light rubber-banding.
- `src/assets`: shared toon materials, four procedural boat silhouettes, finite LOD shader ocean, wave-following guide, instanced gates/markers, procedural world kits, navigation beacon, and pooled VFX.
- `src/systems`: shared Gerstner wave truth, persistent collision separation, spring chase camera, responsive HUD, Web Audio synthesis, and diagnostics.
- `tests`: race rules, real keyboard control, AI movement, natural full-race bot checks, pause/mute behavior, 1920×1080 performance, canvas smoke tests, and truthful deterministic visual states.
- `src/shared`, `src/network`, `server`: shared headless race simulation, client prediction/interpolation, room UI and the Cloudflare Worker/Durable Object service.

The project uses custom transform-driven arcade motion and boat/rock proxies and height-aware oriented waterfront collision boxes. There is no race-corridor collision and no rigid-body physics dependency. See [TrackDefinition](docs/track-definition.md) and [save schema](docs/save-schema.md) for the stable data contracts.

## Verification

Install the Playwright Chromium runtime once if browser tests are needed:

```bash
npx playwright install chromium
```

Then run:

```bash
npm run build
npx playwright test
npm run verify:visual
```

Online checks: `npm run cf:check` validates the Worker separately, and
`npm run test:online` tests the integrated Cloudflare runtime. Full four-client
race verification is documented in [online multiplayer](docs/online-multiplayer.md#verify).

For the measured production-preview performance gate, start `npm run preview`, then run in PowerShell:

```powershell
$env:PERFORMANCE_PRODUCTION_PREVIEW='1'
$env:PLAYWRIGHT_EXTERNAL_SERVER='1'
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:4188'
npx playwright test tests/performance.spec.ts --project=desktop-chrome
```

For the long natural three-lap bot:

```powershell
$env:BOT_PLAYTEST_STEPS='1400'
$env:BOT_REQUIRE_FINISH='1'
$env:BOT_DISABLE_BOOST='1'
npx playwright test tests/bot-playtest.spec.ts --project=desktop-chrome
```

With the dev server running, canvas inspection can capture deterministic states:

```bash
npm run inspect:canvas -- --state active-play --seed 20260819 --drive-active
npm run inspect:canvas -- --mobile --state active-play --seed 20260819 --drive-active
npm run inspect:canvas -- --state complete --seed 217
```

The runtime publishes `window.__THREE_GAME_DIAGNOSTICS__` for flow/session, renderer, ocean LOD, race validation, guide/recovery, interactions, persistence, racers, collisions, input, and canvas evidence. Test-only helpers live under `window.__THREE_GAME_TEST_HOOKS__`; they do not appear in the player UI.

## Asset credits and licences

No third-party media files are used. All visible game art is created locally at runtime from Three.js geometry, canvas textures, shader code, CSS, and the system font stack. Engine, wind/water, countdown, collision, checkpoint, boost, lap, and finish audio are synthesized locally with the Web Audio API. Therefore the repository has no externally downloaded model, texture, font, music, or sound-effect attribution requirements.

Runtime/tool dependencies and the licence identifiers reported by their packages:

| Package | Purpose | Licence |
| --- | --- | --- |
| Three.js | WebGL rendering | MIT |
| lil-gui | Optional gated debug tuning | MIT |
| Vite | Development/build tooling | MIT |
| TypeScript | Type checking | Apache-2.0 |
| Playwright | Browser QA | Apache-2.0 |
| pngjs | Canvas pixel inspection | MIT |
| Wrangler | Cloudflare development and deployment | MIT OR Apache-2.0 |

These packages retain their own upstream licences in `node_modules` after installation.
