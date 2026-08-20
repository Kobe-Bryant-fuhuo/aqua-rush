import type { RaceMode, TrackId } from './ContentCatalog';

export const SAVE_SCHEMA_VERSION = 1 as const;
export const SAVE_STORAGE_KEY = 'aqua-rush-v3';

export type TimeTrialRecord = {
  bestLap: number | null;
  bestTotal: number | null;
};

export type SaveData = {
  version: typeof SAVE_SCHEMA_VERSION;
  settings: {
    muted: boolean;
    reducedMotion: boolean;
  };
  lastSelection: {
    mode: RaceMode;
    trackId: TrackId;
  };
  timeTrial: Record<TrackId, TimeTrialRecord>;
};

export type SaveLoadResult = {
  data: SaveData;
  storageAvailable: boolean;
  repaired: boolean;
};

const defaults = (): SaveData => ({
  version: SAVE_SCHEMA_VERSION,
  settings: { muted: false, reducedMotion: false },
  lastSelection: { mode: 'quick-race', trackId: 'sunset-circuit' },
  timeTrial: {
    'sunset-circuit': { bestLap: null, bestTotal: null },
    'storm-reef': { bestLap: null, bestTotal: null },
  },
});

function positiveTime(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export class SaveStore {
  private data: SaveData = defaults();
  private storageAvailable = true;

  load(): SaveLoadResult {
    let repaired = false;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(SAVE_STORAGE_KEY);
    } catch {
      this.storageAvailable = false;
      this.data = defaults();
      return { data: this.snapshot(), storageAvailable: false, repaired: true };
    }
    if (!raw) {
      this.data = defaults();
      return { data: this.snapshot(), storageAvailable: true, repaired: false };
    }
    try {
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      if (parsed.version !== SAVE_SCHEMA_VERSION) repaired = true;
      {
        const mode = parsed.lastSelection?.mode === 'time-trial' ? 'time-trial' : 'quick-race';
        const trackId = parsed.lastSelection?.trackId === 'storm-reef' ? 'storm-reef' : 'sunset-circuit';
        const sunset = parsed.timeTrial?.['sunset-circuit'];
        const storm = parsed.timeTrial?.['storm-reef'];
        this.data = {
          version: SAVE_SCHEMA_VERSION,
          settings: {
            muted: Boolean(parsed.settings?.muted),
            reducedMotion: Boolean(parsed.settings?.reducedMotion),
          },
          lastSelection: { mode, trackId },
          timeTrial: {
            'sunset-circuit': { bestLap: positiveTime(sunset?.bestLap), bestTotal: positiveTime(sunset?.bestTotal) },
            'storm-reef': { bestLap: positiveTime(storm?.bestLap), bestTotal: positiveTime(storm?.bestTotal) },
          },
        };
      }
    } catch {
      repaired = true;
      this.data = defaults();
    }
    if (repaired) this.flush();
    return { data: this.snapshot(), storageAvailable: this.storageAvailable, repaired };
  }

  snapshot(): SaveData {
    return JSON.parse(JSON.stringify(this.data)) as SaveData;
  }

  setSelection(mode: RaceMode, trackId: TrackId): void {
    this.data.lastSelection = { mode, trackId };
    this.flush();
  }

  setMuted(muted: boolean): void {
    this.data.settings.muted = muted;
    this.flush();
  }

  setReducedMotion(reducedMotion: boolean): void {
    this.data.settings.reducedMotion = reducedMotion;
    this.flush();
  }

  recordTimeTrial(trackId: TrackId, bestLap: number, total: number): { newLapRecord: boolean; newTotalRecord: boolean } {
    const record = this.data.timeTrial[trackId];
    const newLapRecord = bestLap > 0 && (record.bestLap === null || bestLap < record.bestLap);
    const newTotalRecord = total > 0 && (record.bestTotal === null || total < record.bestTotal);
    if (newLapRecord) record.bestLap = bestLap;
    if (newTotalRecord) record.bestTotal = total;
    if (newLapRecord || newTotalRecord) this.flush();
    return { newLapRecord, newTotalRecord };
  }

  resetRecords(): void {
    this.data.timeTrial = defaults().timeTrial;
    this.flush();
  }

  private flush(): void {
    if (!this.storageAvailable) return;
    try {
      window.localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      this.storageAvailable = false;
    }
  }
}
