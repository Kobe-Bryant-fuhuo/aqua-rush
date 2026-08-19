/// <reference types="vite/client" />

type DiagnosticRacePhase = 'countdown' | 'racing' | 'finished';

interface DiagnosticRacer {
  id: string;
  isPlayer: boolean;
  position: { x: number; y: number; z: number };
  speed: number;
  heading: number;
  lap: number;
  checkpoint: number;
  nextCheckpoint: number;
  place: number;
  boost: number;
  wrongWay: boolean;
  finished: boolean;
}

interface ThreeGameDiagnostics {
  frame: number;
  elapsed: number;
  raceTime: number;
  state: DiagnosticRacePhase;
  countdown: number;
  score: number;
  targetScore: number;
  complete: boolean;
  finalPlacement: number | null;
  player: DiagnosticRacer & {
    nextCheckpointPosition: { x: number; z: number };
  };
  racers: DiagnosticRacer[];
  track: {
    progress: number;
    width: number;
    checkpointCount: number;
    nextCheckpointPosition: { x: number; z: number };
    lookAheadPosition: { x: number; z: number };
  };
  collisions: {
    frame: number;
    total: number;
    strongest: number;
  };
  input: {
    throttle: number;
    steer: number;
    boost: boolean;
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
}

interface ThreeGameTestHooks {
  seed(value: number): void;
  setState(name: 'countdown' | 'active-play' | 'complete'): void;
  restart(): void;
  advanceToCheckpoint(index?: number): void;
  completeLap(): void;
  finishRace(): void;
  setPausedForScreenshot(paused: boolean): void;
  setReducedMotion(enabled: boolean): void;
  hideDebugUi(hidden: boolean): void;
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
}
