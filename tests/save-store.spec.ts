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
  lastSelection: { mode: 'quick-race', trackId: 'sunset-circuit' },
  timeTrial: {
    'sunset-circuit': { bestLap: null, bestTotal: null },
    'storm-reef': { bestLap: null, bestTotal: null },
  },
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
      lastSelection: { mode: 'time-trial', trackId: 'storm-reef' },
      timeTrial: {
        'sunset-circuit': { bestLap: 31.25, bestTotal: 101.5 },
        'storm-reef': { bestLap: 42.75, bestTotal: 134.2 },
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
      lastSelection: { mode: 'time-trial', trackId: 'storm-reef' },
      timeTrial: {
        'sunset-circuit': { bestLap: 33.4, bestTotal: 105.8 },
        'storm-reef': { bestLap: 45.2, bestTotal: 139.6 },
      },
    };
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(legacy));
    installWindow(storage);

    const result = new SaveStore().load();
    expect(result.storageAvailable).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.data).toEqual({ ...legacy, version: SAVE_SCHEMA_VERSION });
    expect(JSON.parse(storage.getItem(SAVE_STORAGE_KEY) ?? 'null')).toEqual(result.data);
  });

  test('storage exceptions never prevent defaults from loading', () => {
    installWindow(new ThrowingStorage());
    const result = new SaveStore().load();
    expect(result).toEqual({ data: defaultData(), storageAvailable: false, repaired: true });
  });

  test('records improve independently per course and never regress', () => {
    const store = new SaveStore();
    store.load();

    expect(store.recordTimeTrial('sunset-circuit', 32, 101)).toEqual({
      newLapRecord: true,
      newTotalRecord: true,
    });
    expect(store.recordTimeTrial('sunset-circuit', 35, 108)).toEqual({
      newLapRecord: false,
      newTotalRecord: false,
    });
    expect(store.recordTimeTrial('sunset-circuit', 30, 104)).toEqual({
      newLapRecord: true,
      newTotalRecord: false,
    });
    expect(store.recordTimeTrial('sunset-circuit', 31, 99)).toEqual({
      newLapRecord: false,
      newTotalRecord: true,
    });
    expect(store.recordTimeTrial('storm-reef', 41, 130)).toEqual({
      newLapRecord: true,
      newTotalRecord: true,
    });

    expect(store.snapshot().timeTrial).toEqual({
      'sunset-circuit': { bestLap: 30, bestTotal: 99 },
      'storm-reef': { bestLap: 41, bestTotal: 130 },
    });
  });

  test('resetRecords clears times but preserves settings and last selection', () => {
    const store = new SaveStore();
    store.load();
    store.setMuted(true);
    store.setReducedMotion(true);
    store.setSelection('time-trial', 'storm-reef');
    store.recordTimeTrial('sunset-circuit', 31, 100);
    store.recordTimeTrial('storm-reef', 42, 132);

    store.resetRecords();
    expect(store.snapshot()).toEqual({
      version: SAVE_SCHEMA_VERSION,
      settings: { muted: true, reducedMotion: true },
      lastSelection: { mode: 'time-trial', trackId: 'storm-reef' },
      timeTrial: {
        'sunset-circuit': { bestLap: null, bestTotal: null },
        'storm-reef': { bestLap: null, bestTotal: null },
      },
    });
  });
});
