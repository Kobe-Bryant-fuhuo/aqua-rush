# Aqua Rush V3 design brief

## Product target

Production-feature, medium scope, refactor-open. V3 is a complete browser arcade racer, not an AAA claim and not an infinite-content platform.

## Core loop

Choose Quick Race or Time Trial → choose Sunset Circuit or Storm Reef → clear the countdown → steer/boost/drift across open water → pass 12 directional sectors per lap → choose optional Boost/Drift Gate lines → complete three laps → compare placement or records → retry, switch course, or return to menu.

## Level plan

Sunset Circuit teaches broad lines, readable turns, and optional rewards in warm high-contrast scenery. Storm Reef raises the skill floor with cross-swell airtime, a hairpin, rocky fast channel, wide sweeper, closing chicane, and a riskier outer reward line. Both allow 150–250 units of harmless exploration outside the suggested line.

## Feedback grammar

- Cyan: navigation and Boost Gate energy.
- Yellow/coral: drift opportunity, wrong way, risk, or failed Drift Gate.
- White wake/spray: speed and water contact.
- Camera FOV punch, pooled spray, WebAudio cue, HUD announcement: reward success.
- Stronger guide plus next-sector beacon: off-route recovery information, never autosteer.

## Technical-art budget

- Finite ocean: 1200×1200 visible, near/mid/far, about 25–32k triangles, three calls.
- Mobile normal: ≤120 calls; VFX-heavy: ≤150 calls; ≤120k triangles.
- Desktop 1920×1080: ≥58 average FPS, p95 ≤18ms, p99 ≤22ms, no persistent >25ms run.
- Course checkpoints, markers, interaction families, spectators/wrecks/warnings use instancing or shared materials.
- VFX and guide buffers are fixed-capacity; track-owned resources are disposed when switching.
