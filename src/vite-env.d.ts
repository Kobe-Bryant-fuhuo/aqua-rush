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
  ordinaryBoosting: boolean;
  miniBoosting: boolean;
  drifting: boolean;
  driftCharge: number;
  driftQuality: number;
  contact: number;
  airborne: boolean;
  landingIntensity: number;
  steering: number;
  throttle: number;
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
    distanceFromRoute: number;
    offRouteState: string;
    worldSize: number;
    checkpoints: Array<{
      index: number;
      position: { x: number; y: number; z: number };
      forward: { x: number; y: number; z: number };
      lateral: { x: number; y: number; z: number };
      halfWidth: number;
      height: number;
      visible: boolean;
      finish: boolean;
    }>;
  };
  flow: { state: string; inputOwner: 'menu' | 'race' | 'pause' };
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
      phase: string;
      outcome: string;
      cooldownRemaining: number;
      activationCount: number;
      failureCount: number;
    }>;
  };
  save: { schemaVersion: number; available: boolean };
  events: { sequence: number; last: { type: string; entityId?: string; outcome?: string } | null };
  collisions: {
    frame: number;
    total: number;
    strongest: number;
  };
  gameplay: {
    paused: boolean;
    muted: boolean;
    physics: {
      engine: string;
      timestep: string;
      boatColliders: number;
      checkpointSensors: number;
      ccdBodies: number;
    };
    ai: Array<{ id: string; personality: string; avoidanceStrength: number }>;
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
  ocean: {
    drawCalls: 3;
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
  selectSession(mode: 'quick-race' | 'time-trial', trackId: 'sunset-circuit' | 'storm-reef'): void;
  recover(): void;
  setPlayerKinematics(x: number, y: number, z: number, vx: number, vy: number, vz: number): void;
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
  render_game_to_text?: () => string;
  advanceTime?: (milliseconds: number) => void;
}
