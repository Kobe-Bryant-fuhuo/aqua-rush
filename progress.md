Original prompt: 按提示升级游戏（依据 `C:/Users/HONOR/.codex/attachments/2aaabc66-5e25-4c3c-bbc3-044949bc3727/pasted-text.txt`，将现有 Aqua Rush Three.js MVP 升级为可信、可测、可发布的 V2 精修原型）。

## 2026-08-20 baseline audit

- `npm run build`: pass.
- Existing Playwright suite: 12 passed, 4 intentional mobile skips.
- Short bot: 21 collisions, progress 0.571, no softlocks/errors.
- Natural full race: finished in 559 steps / 64.0 race seconds, 108 collisions, no softlocks/errors.
- Desktop active render: 103 calls, 58,608 triangles, 77 geometries, 7 textures.
- Mobile active render: 96 calls, 58,448 triangles, 72 geometries, 7 textures.
- Confirmed defects: GPU ocean and CPU boat pose use different wave functions; active-play baseline freezes a zero-speed player at the start; opponents share one silhouette; mobile HUD is oversized.
- Credential probes: TRIPO/GEMINI/ELEVENLABS all `MISSING`; use coherent procedural/runtime synthesis fallback and retain blocker evidence.

## Current work

- Added HUD pause/mute controls, pause overlay, steering/drift indicator, and keyboard P/Escape pause intent.
- Added audio pause/mute wiring; build passes after the UI integration.
- Parallel milestones in progress: shared water/handling/collision/AI, opponent+rider+VFX identity, truthful visual/performance QA.
- Shared four-layer wave truth, multi-point hull pose, drift-release mini boost, AI personalities/avoidance, pair cooldowns, three opponent silhouettes, riders, and pooled VFX are implemented. Natural no-boost bot verification finished in 542 steps with 39 collisions and no softlocks/errors.
- Packaged web-game client initially could not resolve the project-local Playwright package from the external skill directory; added `scripts/workspace-playwright-loader.mjs` as an exact dependency bridge for that client.
- Packaged client completed a deterministic keyboard drive and produced `artifacts/web-game-v2/shot-0.png` plus matching text state. The first wall-clock visual compare exposed 18-21% active-state drift; visual input segments now use real keyboard events plus fixed-step `window.advanceTime`.
- V2 runtime integration is complete: shared four-wave truth, five-point hull pose, ordinary Boost vs drift-charge/release mini-boost, persistent collision separation, three AI personalities/avoidance profiles, three rival silhouettes, animated riders, and pooled V-shaped wake/side spray/boost streaks.
- HUD pause/mute, P/Escape pause, frozen timer, steering/drift charge feedback, safe-area mobile layout, and 44px action targets are verified on desktop and mobile.
- Final truthful screenshots show 2.63s race time, 90 km/h, 36+ units of player movement, visible rival movement/wakes, and a nonzero results time. Pause screenshots and diagnostics are under `artifacts/final-v2/`.
- 1920x1080 production preview performance: 60.05 FPS average, p95/p99 16.8ms, 45 calls, 56,644 triangles, 117 geometries, 7 textures, hardware Intel Arc GPU, no errors.
- Final full suite before artifact-capture addition: 15 passed / 7 intentional skips. Artifact capture: 2/2 passed. Natural no-Boost full race: 541 steps, 62.1s, 1,290.25 units, 30 collisions versus baseline 108, zero softlocks/errors.
- Truthful canvas inspector: desktop 157 calls / edgeDensity .150; mobile 88 calls / edgeDensity .217; both hardware rendered and within budget.

## TODO

- Complete: independent fresh-eyes scorecard reconciled conservatively; no premium/AAA claim.
- Complete: README/final report updated, report audit passed, final build passed, final full suite 17 passed / 7 intentional skips.
- Remaining only: final diff hygiene and handoff.

## 2026-08-20 Aqua Rush V3 upgrade

- Source brief: `C:/Users/HONOR/.codex/attachments/6d98a283-4d21-4a9f-937f-b58f7f3c7741/pasted-text.txt`.
- Locked scope: exactly two courses (Sunset Circuit and Storm Reef), exactly two modes (Quick Race and Time Trial), three laps, open-water navigation, directional checkpoint planes, finite large ocean, persistent time-trial records, and two interaction families (Boost Gate and Drift Gate).
- Delivery target: production-feature / medium / refactor-open, preserving the dirty verified V2 worktree and its deterministic QA hooks. No AAA claim and no out-of-scope online, career, weapons, ghosts, rigid hydrodynamics, or infinite-ocean work.
- Asset credential probes remain `MISSING` for Tripo, Gemini, and ElevenLabs, so V3 uses coherent procedural/runtime synthesis and existing generated WebAudio assets.
- Milestone 0 baseline re-verification and read-only architecture/visual/test audits are in progress. Central track/checkpoint/wave/save contracts remain owned by the main integration path.
- Milestone 0 locked: build PASS; original suite 17 passed/7 intentional skips; 60.09 FPS, p95 16.8ms, p99 16.9ms; short bot 9 collisions/0 softlocks; natural three-lap bot 63.0s/29 collisions/0 errors.
- Central V3 contracts implemented: exactly two catalogued tracks/modes, 12 oriented sectors per track, environment/wave/AI/rock/interaction data, GameFlow, versioned SaveStore, real swept checkpoint validation, and open-water collision with only visible rocks/extreme world bounds.
- V3 contract suite: 12/12 passed, including both tracks' legal/reverse/side/vertical/low-speed gates, real ordered 36-sector completion, missing/malformed/legacy/unavailable storage, independent records, and reset preference preservation.
- Main runtime integrated: title/mode/course/countdown/racing/pause/results; Quick Race 4 racers; Time Trial 1 racer with persistent records; explicit recovery; Boost/Drift Gate truth/audio/VFX/HUD; expanded diagnostics and legacy hooks preserved. Old race-flow 3/3 and UI desktop/mobile 2/2 pass.
- Finite near/mid/far 1200 ocean, injected per-course shared wave truth, one-call forward guide ribbon, off-route beacon, batched checkpoints, selective standard/tall/hazard markers, visible physical rocks, lighthouse/spectators/flags, rock arch/warnings/wrecks, and two instanced interaction families are implemented.
- Official develop-web-game client exercised and visually inspected mode select, course select, Sunset Quick Race, Storm Reef Quick Race, and Sunset Time Trial with matching text diagnostics and no captured runtime errors. Follow-up visual fixes removed black instanced marker walls and screen-wide checkpoint bars.
- Documentation added for TrackDefinition, save schema, V3 brief, controls, courses, architecture, and performance budgets.
- V3 production runtime complete: actual menu 2×2 matrix, open-water drive/recovery, Boost and Drift Gate lifecycle, event captures, and repeated course-switch resource stability all pass. Six switches hold textures at 7 and geometries at 112/113.
- Natural production bots complete both requested play shapes: Sunset Quick Race in 63.37s with 0 softlocks/8 contacts; Storm Time Trial in 98.63s with 0 softlocks/9 rock contacts. Both pass all 36 directed sectors and finish. All three AI rivals also naturally finish all 36 sectors on both courses.
- Final production performance: 60.04 FPS, average 16.655ms, p95 16.8ms, p99 17.5ms, 0 frames above 25ms. Mobile Canvas is 84 calls/38,828 triangles, below the 120-call/120k normal budget.
- Final production suite: 47 passed / 37 intentional cross-project skips / 0 failed. V3 visual compare is stable after freezing the realtime RAF around deterministic fixed-step capture.
- Final event screenshots and diagnostics cover collision, real drift, natural landing, Boost Gate and Drift Gate. Release report is `artifacts/final-report-v3.md`; director report audit passes.
- Independent fresh-eyes review scored visuals 1.67/3 and is retained without inflation. Follow-up reduced/translucent checkpoint posts and persistent collision/landing/gate messages address the highest-readability notes; no premium/AAA claim.
- Current TODO: final diff hygiene and handoff only.
