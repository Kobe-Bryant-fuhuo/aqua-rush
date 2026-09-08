import { cleanAchievements, applyAchievementEvent, type AchievementData, type AchievementEvent } from './Achievements';
import { TRACK_IDS, isTrackId, getTrackDefinition, type RaceMode, type TrackId } from './ContentCatalog';

export const SAVE_SCHEMA_VERSION = 1 as const;
export const SAVE_STORAGE_KEY = 'aqua-rush-v3';

export type TimeTrialRecord = {
  rulesRevision?: number;
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
  achievements: AchievementData;
  archivedTimeTrial?: Record<string, TimeTrialRecord>;
};

export type SaveLoadResult = {
  data: SaveData;
  storageAvailable: boolean;
  repaired: boolean;
};

const defaults = (): SaveData => ({
  version: SAVE_SCHEMA_VERSION,
  achievements: cleanAchievements(),
  settings: { muted: false, reducedMotion: false },
  lastSelection: { mode: 'quick-race', trackId: 'breakwater' },
  timeTrial: Object.fromEntries(TRACK_IDS.map(id => [id, emptyRecord(id)])) as SaveData['timeTrial'],
});

function emptyRecord(id: TrackId): TimeTrialRecord {
  const revision = getTrackDefinition(id).rulesRevision;
  return { bestLap: null, bestTotal: null, ...(revision ? { rulesRevision: revision } : {}) };
}

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
      const archived: Record<string, TimeTrialRecord> = {};
      const legacy = parsed.timeTrial as Record<string, TimeTrialRecord> | undefined;
      for (const id of ['sunset-circuit', 'storm-reef', 'neon-leviathan', 'caldera-throat', 'storm-needle']) {
        for (const revision of [1, 2]) {
          const key = id + '@' + revision, record = parsed.archivedTimeTrial?.[key];
          if (record) archived[key] = { bestLap: positiveTime(record.bestLap), bestTotal: positiveTime(record.bestTotal), rulesRevision: revision };
        }
        const record = legacy?.[id];
        if (record) {
          const revision = record.rulesRevision === 2 ? 2 : 1;
          archived[id + '@' + revision] = { bestLap: positiveTime(record.bestLap), bestTotal: positiveTime(record.bestTotal), rulesRevision: revision };
          repaired = true;
        }
      }
      const timeTrial = Object.fromEntries(TRACK_IDS.map(id => {
        const revision = getTrackDefinition(id).rulesRevision ?? 1;
        for (let previous = 1; previous < revision; previous++) {
          const key = id + '@' + previous, record = parsed.archivedTimeTrial?.[key];
          if (record) archived[key] = { bestLap: positiveTime(record.bestLap), bestTotal: positiveTime(record.bestTotal), rulesRevision: previous };
        }
        const stored = parsed.timeTrial?.[id];
        const storedRevision = stored?.rulesRevision ?? 1;
        if (stored && storedRevision !== revision) {
          if (Number.isSafeInteger(storedRevision) && storedRevision > 0 && storedRevision < revision) {
            archived[id + '@' + storedRevision] = { bestLap: positiveTime(stored.bestLap), bestTotal: positiveTime(stored.bestTotal), rulesRevision: storedRevision };
          }
          repaired = true;
          return [id, emptyRecord(id)];
        }
        return [id, { ...emptyRecord(id), bestLap: positiveTime(stored?.bestLap), bestTotal: positiveTime(stored?.bestTotal) }];
      })) as SaveData['timeTrial'];
      {
        const mode = parsed.lastSelection?.mode === 'time-trial' ? 'time-trial' : 'quick-race';
        const trackId = isTrackId(parsed.lastSelection?.trackId) ? parsed.lastSelection.trackId : 'breakwater';
        this.data = {
          version: SAVE_SCHEMA_VERSION,
          settings: {
            muted: Boolean(parsed.settings?.muted),
            reducedMotion: Boolean(parsed.settings?.reducedMotion),
          },
          lastSelection: { mode, trackId },
          timeTrial,
          achievements: cleanAchievements(parsed.achievements),
          ...(Object.keys(archived).length ? { archivedTimeTrial: archived } : {}),
        };
      }
    } catch {
      repaired = true;
      this.data = defaults();
    }
    if (repaired) this.flush();
    return { data: this.snapshot(), storageAvailable: this.storageAvailable, repaired };
  }

  get available(): boolean { return this.storageAvailable; }

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
    const newLapRecord = Number.isFinite(bestLap) && bestLap > 0 && (record.bestLap === null || bestLap < record.bestLap);
    const newTotalRecord = Number.isFinite(total) && total > 0 && (record.bestTotal === null || total < record.bestTotal);
    if (newLapRecord) record.bestLap = bestLap;
    if (newTotalRecord) record.bestTotal = total;
    if (newLapRecord || newTotalRecord) this.flush();
    return { newLapRecord, newTotalRecord };
  }

  recordAchievement(event: AchievementEvent): string[] {
    const unlocked = applyAchievementEvent(this.data.achievements, event);
    this.flush();
    return unlocked;
  }

  resetRecords(): void {
    this.data.timeTrial = defaults().timeTrial;
    delete this.data.archivedTimeTrial;
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
