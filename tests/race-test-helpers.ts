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
  ordinaryBoosting?: boolean;
  miniBoosting?: boolean;
  drifting?: boolean;
  driftCharge?: number;
  driftQuality?: number;
  contact?: number;
  airborne?: boolean;
  landingIntensity?: number;
  steering?: number;
  throttle?: number;
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
    nextCheckpointPosition: RaceVector;
    distanceFromRoute: number;
    offRouteState: string;
    worldSize: number;
    checkpoints: Array<{
      index: number;
      position: Required<RaceVector>;
      forward: Required<RaceVector>;
      lateral: Required<RaceVector>;
      halfWidth: number;
      height: number;
      visible: boolean;
      finish: boolean;
    }>;
  };
  flow: {
    state: string;
    inputOwner: 'menu' | 'race' | 'pause';
  };
  session: {
    mode: 'quick-race' | 'time-trial';
    trackId: 'sunset-circuit' | 'storm-reef';
    trackName: string;
    racerCount: number;
    currentLapTime: number;
    bestLap: number | null;
    bestTotal: number | null;
  };
  validation: {
    expectedIndex: number;
    acceptedCount: number;
    rejectedCount: number;
    lastReason: string | null;
    lastIndex: number | null;
  };
  guide: {
    state: string;
    brightestAheadStart: number;
    brightestAheadEnd: number;
    beaconVisible: boolean;
  };
  recovery: {
    eligible: boolean;
    lastValidCheckpoint: number;
    count: number;
    lastReason: string | null;
  };
  interactions: {
    gates: Array<{
      id: string;
      type: 'boost-gate' | 'drift-gate';
      phase: 'ready' | 'feedback' | 'cooldown';
      outcome: 'none' | 'success' | 'failure';
      cooldownRemaining: number;
      activationCount: number;
      failureCount: number;
    }>;
  };
  save: {
    schemaVersion: number;
    available: boolean;
  };
  events: {
    sequence: number;
    last: { type: string; entityId?: string; outcome?: string } | null;
  };
  collisions: {
    frame: number;
    total: number;
    strongest: number;
  };
  gameplay: {
    paused: boolean;
    muted: boolean;
  };
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  };
  ocean: {
    drawCalls: number;
    triangles: number;
    nearTriangles: number;
    midTriangles: number;
    farTriangles: number;
    nearSize: number;
    midSize: number;
    farSize: number;
  };
  canvas: {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    dpr: number;
  };
};

export type TruthfulVisualState = 'countdown' | 'active-play' | 'results';

export type TruthfulVisualEvidence = {
  state: TruthfulVisualState;
  start: RaceDiagnostics;
  captured: RaceDiagnostics;
  movement: number;
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

function planarDistance(a: RaceVector, b: RaceVector): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

async function advanceGameTime(page: Page, milliseconds: number): Promise<void> {
  await page.evaluate((duration) => {
    if (typeof window.advanceTime !== 'function') {
      throw new Error('Required deterministic window.advanceTime hook is missing.');
    }
    window.advanceTime(duration);
  }, milliseconds);
}

/**
 * Drives a repeatable, representative racing line with trusted Playwright
 * keyboard events. Race-time gates keep the captured boat pose materially more
 * stable than wall-clock sleeps while still exercising the production input
 * path for 2-4 seconds.
 */
export async function driveRepresentativeRace(
  page: Page,
  durationSeconds: number,
): Promise<{ start: RaceDiagnostics; captured: RaceDiagnostics; movement: number }> {
  expect(durationSeconds, 'truthful screenshot input should run for 2-4 seconds').toBeGreaterThanOrEqual(2);
  expect(durationSeconds, 'truthful screenshot input should run for 2-4 seconds').toBeLessThanOrEqual(4);

  const start = await readRaceDiagnostics(page);
  let advancedSeconds = 0;
  const advanceTo = async (ratio: number) => {
    const nextSeconds = durationSeconds * ratio;
    await advanceGameTime(page, (nextSeconds - advancedSeconds) * 1000);
    advancedSeconds = nextSeconds;
  };

  await page.keyboard.down('KeyW');
  try {
    await page.keyboard.down('KeyD');
    await advanceTo(0.22);
    await page.keyboard.up('KeyD');

    await page.keyboard.down('Space');
    await advanceTo(0.38);
    await page.keyboard.up('Space');

    await advanceTo(0.54);
    await page.keyboard.down('KeyA');
    await advanceTo(0.74);
    await page.keyboard.up('KeyA');

    await page.keyboard.down('Space');
    await advanceTo(0.9);
    await page.keyboard.up('Space');
    await advanceTo(1);
  } finally {
    await page.keyboard.up('KeyD');
    await page.keyboard.up('KeyA');
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyW');
  }

  const captured = await readRaceDiagnostics(page);
  expect(captured.raceTime - start.raceTime).toBeGreaterThanOrEqual(durationSeconds - 0.05);
  return {
    start,
    captured,
    movement: planarDistance(start.player.position, captured.player.position),
  };
}

/**
 * Prepares screenshot states that truthfully represent their label. In
 * particular, active play and results are reached only after real keyboard
 * input has moved the player and advanced the race timer.
 */
export async function prepareTruthfulVisualState(
  page: Page,
  state: TruthfulVisualState,
): Promise<TruthfulVisualEvidence> {
  await waitForRaceGame(page);
  await callRaceHook(page, 'seed', 20260819);
  await callRaceHook(page, 'hideDebugUi', true);
  await callRaceHook(page, 'setReducedMotion', false);
  await callRaceHook(page, 'setPausedForScreenshot', true);

  if (state === 'countdown') {
    await callRaceHook(page, 'setState', 'countdown');
    const captured = await readRaceDiagnostics(page);
    expect(captured.state).toBe('countdown');
    expect(captured.raceTime).toBe(0);
    expect(captured.racers.every((racer) => Math.abs(racer.speed) < 0.05)).toBe(true);
    return { state, start: captured, captured, movement: 0 };
  }

  await callRaceHook(page, 'setState', 'active-play');
  const run = await driveRepresentativeRace(page, state === 'active-play' ? 2.65 : 3.35);

  expect(run.movement, `${state} capture must show a boat that genuinely raced`).toBeGreaterThan(2);
  expect(run.captured.player.speed, `${state} capture must retain a nonzero racing speed`).toBeGreaterThan(2);
  expect(run.captured.raceTime, `${state} capture must have nonzero race time`).toBeGreaterThan(2);

  if (state === 'results') {
    await callRaceHook(page, 'finishRace');
  }
  await callRaceHook(page, 'setPausedForScreenshot', true);
  const captured = await readRaceDiagnostics(page);
  expect(captured.state).toBe(state === 'results' ? 'finished' : 'racing');
  expect(captured.raceTime).toBeGreaterThan(2);

  return { state, start: run.start, captured, movement: run.movement };
}

export function expectNoRuntimeErrors(errors: ReturnType<typeof captureRuntimeErrors>): void {
  expect(errors.pageErrors, 'uncaught page errors').toEqual([]);
  expect(errors.consoleErrors, 'browser console errors').toEqual([]);
}
