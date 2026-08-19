import { expect, type Page } from '@playwright/test';

export type RaceState = 'countdown' | 'racing' | 'finished';

export type RaceVector = {
  x: number;
  y?: number;
  z: number;
};

export type RaceRacerDiagnostics = {
  id: string;
  isPlayer: boolean;
  position: RaceVector;
  speed: number;
  lap: number;
  checkpoint: number;
  nextCheckpoint: number;
  place: number;
  finished: boolean;
};

export type RaceDiagnostics = {
  frame: number;
  elapsed: number;
  raceTime: number;
  state: RaceState;
  countdown: number;
  complete: boolean;
  finalPlacement: number | null;
  player: RaceRacerDiagnostics & {
    heading: number;
    boost: number;
    wrongWay: boolean;
    nextCheckpointPosition: RaceVector;
  };
  racers: RaceRacerDiagnostics[];
  track: {
    progress: number;
    width: number;
    checkpointCount: number;
    lookAheadPosition: RaceVector;
  };
  collisions: {
    frame: number;
    total: number;
    strongest: number;
  };
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  };
  canvas: {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    dpr: number;
  };
};

type RaceHookArgument = string | number | boolean;

export function captureRuntimeErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  return { consoleErrors, pageErrors };
}

export async function waitForRaceGame(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => {
    const raceWindow = window as unknown as {
      __THREE_GAME_DIAGNOSTICS__?: { frame?: number };
      __THREE_GAME_TEST_HOOKS__?: unknown;
    };
    return (
      (raceWindow.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5 &&
      Boolean(raceWindow.__THREE_GAME_TEST_HOOKS__)
    );
  });
}

export async function readRaceDiagnostics(page: Page): Promise<RaceDiagnostics> {
  return page.evaluate(() => {
    const diagnostics = (
      window as unknown as { __THREE_GAME_DIAGNOSTICS__?: RaceDiagnostics }
    ).__THREE_GAME_DIAGNOSTICS__;
    if (!diagnostics) throw new Error('__THREE_GAME_DIAGNOSTICS__ is not installed.');
    return diagnostics;
  });
}

export async function callRaceHook(
  page: Page,
  method: string,
  ...args: RaceHookArgument[]
): Promise<void> {
  await page.evaluate(
    ({ hookName, hookArgs }) => {
      const hooks = (
        window as unknown as {
          __THREE_GAME_TEST_HOOKS__?: Record<string, (...values: RaceHookArgument[]) => unknown>;
        }
      ).__THREE_GAME_TEST_HOOKS__;
      const hook = hooks?.[hookName];
      if (typeof hook !== 'function') {
        throw new Error(`Required race test hook is missing: ${hookName}`);
      }
      hook(...hookArgs);
    },
    { hookName: method, hookArgs: args },
  );
}

export async function loadRaceState(page: Page, state: 'countdown' | 'active-play' | 'complete') {
  await waitForRaceGame(page);
  await callRaceHook(page, 'seed', 20260819);
  await callRaceHook(page, 'hideDebugUi', true);
  await callRaceHook(page, 'setReducedMotion', false);
  await callRaceHook(page, 'setPausedForScreenshot', false);
  await callRaceHook(page, 'setState', state);

  const expectedState: RaceState =
    state === 'active-play' ? 'racing' : state === 'complete' ? 'finished' : 'countdown';
  await expect.poll(async () => (await readRaceDiagnostics(page)).state).toBe(expectedState);
}

export function expectNoRuntimeErrors(errors: ReturnType<typeof captureRuntimeErrors>): void {
  expect(errors.pageErrors, 'uncaught page errors').toEqual([]);
  expect(errors.consoleErrors, 'browser console errors').toEqual([]);
}
