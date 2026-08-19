# Aqua Rush

Aqua Rush is a small, complete cel-shaded arcade boat racing game built with Vite, Three.js, TypeScript, and ES modules. It contains one three-lap circuit, a player boat, three AI rivals, ordered checkpoint validation, a race countdown, live position/lap/time/boost HUD, results, and instant restart.

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
| Hold `Space` | Boost with looser drift grip |
| `R` or `Enter` | Restart the race |
| Touch stick / Boost button | Mobile steering, throttle, reverse, and boost |

Audio unlocks on the first keyboard or pointer gesture. If Web Audio is unavailable, the race continues silently.

## Game design contract

- **Player promise:** pilot a bright anime-inspired racing boat through a compact, readable ocean circuit.
- **Target feeling:** fast, responsive, forgiving, and competitive rather than physically realistic.
- **Primary verb:** steer a clean racing line. Secondary verbs are braking/reversing and timing drift-boost bursts.
- **Objective:** pass seven ordered checkpoints for each of three laps and finish ahead of three rivals.
- **Pressure:** distinct AI pace profiles, a boost resource, boat/boat contact, course boundaries, a fast straight, a wide turn, an S bend, and a tighter turn.
- **Reward:** improved placement and a lower final race time, reinforced by HUD, VFX, camera, and audio feedback.
- **Setback/retry:** collisions scrub speed instead of ending the race. The finish screen and `R`/`Enter` provide a fast full reset.
- **Skill expression:** hold the fastest line, anticipate turns, avoid contact, and spend boost where the reduced grip is manageable.
- **Non-goals:** infinite water, rigid-body hydrodynamics, advanced foam/depth rendering, minimap, split times, upgrades, online play, and multiple courses.

Core loop:

> Accelerate, steer, and boost to clear ordered checkpoints while AI rivals and course geometry create pressure; clean lines improve placement and time, while collisions cost speed before a quick finish/restart loop.

## Track plan

The closed Catmull-Rom circuit starts on a readable straight under the start gate. It opens into a wide recovery turn, introduces a chicane/S bend, and then tightens before returning to the line. Paired buoys define the legal corridor, checkpoint gates communicate progress, the racing-line strip previews the route, and islands/clouds/fog hide the finite ocean edge.

## Architecture

- `src/core`: render loop, renderer sizing/DPR, and unified keyboard/touch input.
- `src/game`: game orchestration, closed track projection, race phase, checkpoints, laps, placement, and deterministic QA hooks.
- `src/entities`: shared arcade boat motion, the player, and look-ahead AI racers with light rubber-banding.
- `src/assets`: shared toon materials, authored procedural boats, shader ocean, world/course kit, and pooled VFX.
- `src/systems`: wave sampling, collision response, spring chase camera, HUD, Web Audio synthesis, and diagnostics.
- `tests`: race rules, real keyboard control, AI movement, bot progress/softlock checks, canvas smoke tests, and deterministic visual states.

The project uses custom transform-driven arcade motion and simple collision proxies. No rigid-body physics dependency is required.

## Verification

Install the Playwright Chromium runtime once if browser tests are needed:

```bash
npx playwright install chromium
```

Then run:

```bash
npm run build
npx playwright test tests/race-flow.spec.ts --project=desktop-chrome
npx playwright test tests/bot-playtest.spec.ts --project=desktop-chrome
npm run verify:visual
```

With the dev server running, canvas inspection can capture deterministic states:

```bash
npm run inspect:canvas -- --state active-play --seed 217
npm run inspect:canvas -- --mobile --state active-play --seed 217
npm run inspect:canvas -- --state complete --seed 217
```

The runtime publishes `window.__THREE_GAME_DIAGNOSTICS__` for renderer, race, racer, collision, input, canvas, and progress evidence. Test-only state helpers live under `window.__THREE_GAME_TEST_HOOKS__`; they do not appear in the player UI.

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
