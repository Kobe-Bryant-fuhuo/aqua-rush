import { expect, test } from '@playwright/test';
import { applyAchievementEvent, cleanAchievements } from '../src/game/Achievements';
import { SaveStore, SAVE_STORAGE_KEY } from '../src/game/SaveStore';

test('achievements distinguish trial completion from wins and unlock once', () => {
  const data = cleanAchievements();
  expect(applyAchievementEvent(data, { type: 'finish', trackId: 'breakwater', mode: 'time-trial', place: 1 })).toEqual(['first-finish', 'time-trialist']);
  expect(data.progress.wins).toBe(0);
  expect(applyAchievementEvent(data, { type: 'finish', trackId: 'nightfall', mode: 'quick-race', place: 1 })).toEqual(['champion']);
  expect(applyAchievementEvent(data, { type: 'finish', trackId: 'sunken-temple', mode: 'online', place: 2 })).toEqual(['explorer']);
  expect(applyAchievementEvent(data, { type: 'finish', trackId: 'sunken-temple', mode: 'online', place: 1 })).toEqual([]);
  expect(data.progress.courses).toBe(3);
  for (let i = 0; i < 9; i++) applyAchievementEvent(data, { type: 'skill', kind: 1, chain: 1 });
  expect(applyAchievementEvent(data, { type: 'skill', kind: 1, chain: 3 })).toEqual(['drifter', 'combo']);
  expect(applyAchievementEvent(data, { type: 'skill', kind: 2, chain: 1 })).toEqual(['landing']);
});

test('achievement saves survive reload and record reset, and migrate old data', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let raw = JSON.stringify({ version: 1, settings: { muted: true } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; },
  } } });
  try {
    const store = new SaveStore();
    expect(store.load().data.settings.muted).toBe(true);
    expect(store.snapshot().achievements.progress.finishes).toBe(0);
    store.recordAchievement({ type: 'finish', trackId: 'breakwater', mode: 'quick-race', place: 1 });
    const reloaded = new SaveStore();
    expect(reloaded.load().data.achievements.unlocked.champion).toBeGreaterThan(0);
    reloaded.resetRecords();
    expect(reloaded.snapshot().achievements.progress.finishes).toBe(1);
    expect(reloaded.recordAchievement({ type: 'finish', trackId: 'breakwater', mode: 'quick-race', place: 1 })).toEqual([]);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('malformed achievement fields are repaired', () => {
  const data = cleanAchievements(JSON.parse('{"progress":{"finishes":-1,"drifts":"10"},"tracks":["breakwater","breakwater","invalid"],"unlocked":{"champion":"bad","unknown":1}}'));
  expect(data.progress.finishes).toBe(0);
  expect(data.progress.drifts).toBe(0);
  expect(data.progress.courses).toBe(1);
  expect(data.unlocked).toEqual({});
});

test('captain log opens, fits the viewport, closes with Escape and preserves progress', async ({ page }) => {
  await page.goto('/');
  await page.locator('#achievements-button').click();
  const dialog = page.locator('#achievements-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('article')).toHaveCount(8);
  const box = await dialog.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: `test-results/achievements-${page.viewportSize()!.width}.png` });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('#achievements-button')).toBeFocused();
  await page.evaluate(key => {
    const data = JSON.parse(localStorage.getItem(key) ?? '{}');
    data.version = 1;
    data.achievements = { progress: { finishes: 1 }, tracks: ['breakwater'], unlocked: { 'first-finish': Date.now() } };
    localStorage.setItem(key, JSON.stringify(data));
  }, SAVE_STORAGE_KEY);
  await page.reload();
  await page.locator('#achievements-button').click();
  await expect(dialog.locator('[data-achievement="first-finish"]')).toHaveAttribute('data-unlocked', 'true');
});

test('race finish persists exactly once and retry counts a new race', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  await page.evaluate(() => {
    window.__THREE_GAME_TEST_HOOKS__!.setState('active-play');
    window.__THREE_GAME_TEST_HOOKS__!.finishRace();
    window.__THREE_GAME_TEST_HOOKS__!.finishRace();
  });
  await expect(page.locator('.achievement-toast')).toContainText('初航归来');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).achievements.progress.finishes, SAVE_STORAGE_KEY)).toBe(1);
  await page.evaluate(() => {
    window.__THREE_GAME_TEST_HOOKS__!.setState('active-play');
    window.__THREE_GAME_TEST_HOOKS__!.finishRace();
  });
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).achievements.progress.finishes, SAVE_STORAGE_KEY)).toBe(2);
});
