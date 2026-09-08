import { TRACK_IDS, getTrackDefinition } from '../src/game/ContentCatalog';
import { expect, test } from '@playwright/test';
import {
  SAVE_SCHEMA_VERSION,
  SAVE_STORAGE_KEY,
  SaveStore,
  type SaveData,
} from '../src/game/SaveStore';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

class ThrowingStorage extends MemoryStorage {
  override getItem(): string | null {
    throw new Error('storage unavailable');
  }

  override setItem(): void {
    throw new Error('storage unavailable');
  }
}

const defaultData = (): SaveData => ({
  version: SAVE_SCHEMA_VERSION,
  settings: { muted: false, reducedMotion: false },
  lastSelection: { mode: 'quick-race', trackId: 'breakwater' },
  timeTrial: Object.fromEntries(TRACK_IDS.map(id => [id, { bestLap: null, bestTotal: null, ...(getTrackDefinition(id).rulesRevision ? { rulesRevision: getTrackDefinition(id).rulesRevision } : {}) }])) as SaveData['timeTrial'],
});

let originalWindowDescriptor: PropertyDescriptor | undefined;

function installWindow(storage: Storage): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: storage },
  });
}

test.describe('V3 versioned SaveStore contract', () => {
  test.beforeAll(() => {
    originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  });

  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'The pure storage contract only needs one JavaScript runtime.',
    );
    installWindow(new MemoryStorage());
  });

  test.afterAll(() => {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
  });

  test('missing save loads safe defaults', () => {
    const result = new SaveStore().load();
    expect(result).toEqual({ data: defaultData(), storageAvailable: true, repaired: false });
  });

  test('valid current save round-trips without repair', () => {
    const storage = new MemoryStorage();
    const valid: SaveData = {
      version: SAVE_SCHEMA_VERSION,
      settings: { muted: true, reducedMotion: true },
      lastSelection: { mode: 'time-trial', trackId: 'nightfall' },
      timeTrial: {
        ...defaultData().timeTrial,
        'breakwater': { bestLap: 31.25, bestTotal: 101.5, rulesRevision: 2 },
        'nightfall': { bestLap: 42.75, bestTotal: 134.2, rulesRevision: 2 },
      },
    };
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(valid));
    installWindow(storage);

    expect(new SaveStore().load()).toEqual({
      data: valid,
      storageAvailable: true,
      repaired: false,
    });
  });

  test('malformed JSON is repaired while usable storage remains available', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_STORAGE_KEY, '{not-json');
    installWindow(storage);

    const result = new SaveStore().load();
    expect(result).toEqual({ data: defaultData(), storageAvailable: true, repaired: true });
    expect(JSON.parse(storage.getItem(SAVE_STORAGE_KEY) ?? 'null')).toEqual(defaultData());
  });

  test('legacy schema migrates known valid fields and writes the current version', () => {
    const storage = new MemoryStorage();
    const legacy = {
      version: 0,
      settings: { muted: true, reducedMotion: true },
      lastSelection: { mode: 'time-trial', trackId: 'nightfall' },
      timeTrial: {
        'breakwater': { bestLap: 33.4, bestTotal: 105.8, rulesRevision: 2 },
        'nightfall': { bestLap: 45.2, bestTotal: 139.6, rulesRevision: 2 },
      },
    };
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(legacy));
    installWindow(storage);

    const result = new SaveStore().load();
    expect(result.storageAvailable).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.data).toEqual({ ...legacy, version: SAVE_SCHEMA_VERSION, timeTrial: { ...defaultData().timeTrial, ...legacy.timeTrial } });
    expect(JSON.parse(storage.getItem(SAVE_STORAGE_KEY) ?? 'null')).toEqual(result.data);
  });

  test('storage exceptions never prevent defaults from loading', () => {
    installWindow(new ThrowingStorage());
    const result = new SaveStore().load();
    expect(result).toEqual({ data: defaultData(), storageAvailable: false, repaired: true });
  });

  test('previous handling records are archived and new records persist independently', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify({
      version: 1,
      settings: { muted: true, reducedMotion: false },
      lastSelection: { mode: 'time-trial', trackId: 'nightfall' },
      timeTrial: {
        'breakwater': { bestLap: 30, bestTotal: 96 },
        'nightfall': { bestLap: 42, bestTotal: 130 },
        'sunken-temple': { bestLap: 35, bestTotal: 105 },
      },
    }));
    installWindow(storage);
    const store = new SaveStore();
    const data = store.load().data;
    expect(data.timeTrial).toEqual(defaultData().timeTrial);
    expect(data.archivedTimeTrial?.['breakwater@1']).toMatchObject({ bestLap: 30, bestTotal: 96 });
    expect(data.archivedTimeTrial?.['sunken-temple@1']).toMatchObject({ bestLap: 35, bestTotal: 105 });
    expect(data.timeTrial['sunken-temple']).toMatchObject({ bestLap: null, bestTotal: null });
    store.setSelection('time-trial', 'sunken-temple');
    store.recordTimeTrial('sunken-temple', 34, 106);
    store.recordTimeTrial('sunken-temple', NaN, Infinity);
    const reloaded = new SaveStore().load().data;
    expect(reloaded.lastSelection.trackId).toBe('sunken-temple');
    expect(reloaded.settings.muted).toBe(true);
    expect(reloaded.timeTrial['sunken-temple']).toMatchObject({ bestLap: 34, bestTotal: 106 });
    expect(reloaded.timeTrial['nightfall']).toEqual(defaultData().timeTrial['nightfall']);
    expect(reloaded.archivedTimeTrial?.['nightfall@1']).toMatchObject({ bestLap: 42, bestTotal: 130 });
  });

  test('records improve independently per course and never regress', () => {
    const store = new SaveStore();
    store.load();

    expect(store.recordTimeTrial('breakwater', 32, 101)).toEqual({
      newLapRecord: true,
      newTotalRecord: true,
    });
    expect(store.recordTimeTrial('breakwater', 35, 108)).toEqual({
      newLapRecord: false,
      newTotalRecord: false,
    });
    expect(store.recordTimeTrial('breakwater', 30, 104)).toEqual({
      newLapRecord: true,
      newTotalRecord: false,
    });
    expect(store.recordTimeTrial('breakwater', 31, 99)).toEqual({
      newLapRecord: false,
      newTotalRecord: true,
    });
    expect(store.recordTimeTrial('nightfall', 41, 130)).toEqual({
      newLapRecord: true,
      newTotalRecord: true,
    });

    expect(store.snapshot().timeTrial).toEqual({
      ...defaultData().timeTrial,
      'breakwater': { bestLap: 30, bestTotal: 99, rulesRevision: 2 },
      'nightfall': { bestLap: 41, bestTotal: 130, rulesRevision: 2 },
    });
  });

  test('resetRecords clears times but preserves settings and last selection', () => {
    const store = new SaveStore();
    store.load();
    store.setMuted(true);
    store.setReducedMotion(true);
    store.setSelection('time-trial', 'nightfall');
    store.recordTimeTrial('breakwater', 31, 100);
    store.recordTimeTrial('nightfall', 42, 132);

    store.resetRecords();
    expect(store.snapshot()).toEqual({
      version: SAVE_SCHEMA_VERSION,
      settings: { muted: true, reducedMotion: true },
      lastSelection: { mode: 'time-trial', trackId: 'nightfall' },
      timeTrial: defaultData().timeTrial,
    });
  });

  test('retired world records are archived once and cannot compete with rebuilt course times', () => {
    const storage = new MemoryStorage();
    const old = defaultData();
    Object.assign(old.timeTrial, { 'neon-leviathan': { bestLap: 32, bestTotal: 100, rulesRevision: 2 }, 'sunset-circuit': { bestLap: 30, bestTotal: 90 } });
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(old));
    installWindow(storage);
    const store = new SaveStore();
    const loaded = store.load();
    expect(loaded.data.timeTrial['sunken-temple']).toEqual(defaultData().timeTrial['sunken-temple']);
    expect(loaded.data.archivedTimeTrial?.['neon-leviathan@2']).toMatchObject({ bestLap: 32, bestTotal: 100 });
    expect(loaded.data.archivedTimeTrial?.['sunset-circuit@1']).toMatchObject({ bestLap: 30, bestTotal: 90 });
    expect(Object.keys(loaded.data.timeTrial)).toEqual(TRACK_IDS);
    store.recordTimeTrial('sunken-temple', 40, 130);
    const reload = new SaveStore().load();
    expect(reload.data.timeTrial['sunken-temple'].bestTotal).toBe(130);
    expect(reload.data.archivedTimeTrial?.['neon-leviathan@2'].bestTotal).toBe(100);
    expect(reload.repaired).toBe(false);
  });
});
