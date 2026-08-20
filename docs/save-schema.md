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
    trackId: 'sunset-circuit' | 'storm-reef';
  };
  timeTrial: {
    'sunset-circuit': { bestLap: number | null; bestTotal: number | null };
    'storm-reef': { bestLap: number | null; bestTotal: number | null };
  };
};
```

Times are positive finite seconds. A result replaces a stored time only when it is lower. Course records are independent.

## Failure handling

- Missing storage loads safe defaults.
- Malformed JSON loads defaults and, when storage is usable, repairs the stored value.
- Older schemas preserve recognized valid settings, selection, and records, then write version 1.
- Unknown modes/tracks and invalid/non-positive times fall back per field.
- If `localStorage` access throws, the game remains playable with in-memory defaults and reports `save.available=false` in diagnostics.
- Reset Records clears only Time Trial times; mute, reduced-motion, and last selection remain.

Automated coverage is in `tests/save-store.spec.ts`.
