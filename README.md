# Aqua Rush

Aqua Rush V3 is a complete cel-shaded arcade boat racing game built with Vite, Three.js, TypeScript, and ES modules. It has exactly two courses and two modes: race three rivals in Quick Race, or chase persistent per-course records in solo Time Trial. Both modes use three laps, directional checkpoint planes, open-water navigation, shared CPU/GPU wave truth, course interactions, responsive desktop/mobile UI, pause/recovery, results, and fast retry.

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

Audio unlocks on the first keyboard or pointer gesture. If Web Audio is unavailable, the race continues silently.

## Game design contract

- **Player promise:** pilot the bright yellow hero boat across a large readable ocean, choosing clean lines and optional reward gates without being trapped by invisible walls.
- **Target feeling:** fast, responsive, forgiving, and competitive rather than physically realistic.
- **Primary verb:** steer a clean racing line. Secondary verbs are braking/reversing and timing drift-boost bursts.
- **Objective:** pass all 12 ordered directional sectors for each of three laps. Quick Race adds three rivals; Time Trial adds best-lap, best-total, PB, and new-record pressure.
- **Pressure:** distinct AI profiles, directional swell, a boost resource, boat/boat contact, visible rocks, Storm Reef's channel/hairpin/chicane, and choosing whether a reward line is worth the risk.
- **Reward:** placement or persistent record improvement, plus Boost Gates and drift-validated Drift Gates reinforced by HUD, VFX, camera, and synthesized audio.
- **Setback/retry:** collisions scrub speed instead of ending the race. The finish screen and `R`/`Enter` provide a fast full reset.
- **Skill expression:** hold the fastest line, anticipate turns, avoid contact, and spend boost where the reduced grip is manageable.
- **Non-goals:** infinite/projected-grid water, rigid-body hydrodynamics, career progression, online play, weapons, ghosts, cinematic story scenes, or more than two courses.

Core loop:

> Choose a mode and course, accelerate across open water, follow the wave-bound guide, clear every directional sector, use optional Boost/Drift Gates, then improve placement or a persistent record before retrying or switching courses.

## Courses and modes

- **Sunset Circuit:** warm sunset water, green islands, a lighthouse, spectator boats, flags, broad sweepers, and forgiving optional lines.
- **Storm Reef:** cold overcast water, stronger cross-swell, rocky channel, hairpin, broad sweeper, closing chicane, rock arch, warning lights, wreck silhouettes, and a risky reward line.
- **Quick Race:** player plus KAI, MIRA, and NOX; three laps; placement results.
- **Time Trial:** player only; three laps; current/best lap, best total, PB comparison, new-record results, and versioned local persistence.

The ocean is finite: roughly 800×800 units are playable and 1200×1200 are visible through near/mid/far LOD. Leaving the recommended line never causes a corridor collision, forced slowdown, or automatic teleport. Race legality comes only from ordered, back-to-front directional checkpoint crossings. Use `X` or the Pause menu Recovery action when desired.

## Architecture

- `src/core`: render loop, renderer sizing/DPR, and unified keyboard/touch input.
- `src/game`: catalog-driven content, app flow, versioned save store, directional checkpoint validation, open-water race/session rules, interactions, laps/placement, and deterministic QA hooks.
- `src/entities`: multi-point wave-following arcade boat motion, the player, and personality-driven look-ahead AI racers with avoidance and light rubber-banding.
- `src/assets`: shared toon materials, four procedural boat silhouettes, finite LOD shader ocean, wave-following guide, instanced gates/markers, two world kits, navigation beacon, and pooled VFX.
- `src/systems`: shared Gerstner wave truth, persistent collision separation, spring chase camera, responsive HUD, Web Audio synthesis, and diagnostics.
- `tests`: race rules, real keyboard control, AI movement, natural full-race bot checks, pause/mute behavior, 1920×1080 performance, canvas smoke tests, and truthful deterministic visual states.

The project uses custom transform-driven arcade motion and simple boat/visible-rock proxies. There is no race-corridor collision and no rigid-body physics dependency. See [TrackDefinition](docs/track-definition.md) and [save schema](docs/save-schema.md) for the stable data contracts.

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

These packages retain their own upstream licences in `node_modules` after installation.
