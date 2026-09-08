# Aqua Rush V3 save schema

Storage key: `aqua-rush-v3`<br>
Current version: `1`

```ts
type SaveData = {
  version: 1;
  settings: {
    muted: boolean;
    reducedMotion: boolean;
  };
  lastSelection: {
    mode: 'quick-race' | 'time-trial';
    trackId: TrackId; // Three rebuilt worlds.
  };
  timeTrial: Record<TrackId, { bestLap: number | null; bestTotal: number | null; rulesRevision?: number }>;
  archivedTimeTrial?: Record<string, { bestLap: number | null; bestTotal: number | null; rulesRevision?: number }>;
};
```

Times are positive finite seconds. A result replaces a stored time only when it is lower. Course records are independent. The rebuilt worlds start with empty records. Settings are retained. Times from the five retired course IDs are archived under their original ID and rules revision; they cannot appear in the new world rankings.

## Failure handling

- Missing storage loads safe defaults.
- Malformed JSON loads defaults and, when storage is usable, repairs the stored value.
- Older schemas preserve recognized valid settings, selection, and records, then write version 1.
- Unknown modes/tracks and invalid/non-positive times fall back per field.
- If `localStorage` access throws, the game remains playable with in-memory defaults and reports `save.available=false` in diagnostics.
- Reset Records clears only Time Trial times; mute, reduced-motion, and last selection remain.

Automated coverage is in `tests/save-store.spec.ts`.

## Revised course records

The optional `archivedTimeTrial` dictionary retains retired records such as `neon-leviathan@2` and `sunset-circuit@1`. Reloading does not re-archive or overwrite new world records. Reset Records clears current and archived times.

All three current worlds use rules revision 2 after the skill-chain, drafting and crossing changes. Their previous revision-1 PBs are archived under `breakwater@1`, `nightfall@1` and `sunken-temple@1`; settings and course selection remain intact.
