import type { GerstnerWave } from '../systems/WaveSurface';

export type RaceMode = 'quick-race' | 'time-trial';
export type TrackId = 'sunset-circuit' | 'storm-reef';
export type InteractionKind = 'boost-gate' | 'drift-gate';

export type WavePreset = Readonly<{
  id: string;
  waves: readonly GerstnerWave[];
  visualStrength: number;
}>;

export type EnvironmentPreset = Readonly<{
  id: string;
  label: string;
  water: string;
  deepWater: string;
  foam: string;
  fog: string;
  skyTop: string;
  skyMid: string;
  horizon: string;
  sun: string;
  exposure: number;
  storm: boolean;
  ambiencePreset: 'sunset-marina' | 'storm-squall';
}>;

export type CheckpointDefinition = Readonly<{
  id: string;
  progress: number;
  halfWidth: number;
  height: number;
  visible: boolean;
  role: 'sector' | 'anti-cut' | 'finish';
}>;

export type InteractionDefinition = Readonly<{
  id: string;
  kind: InteractionKind;
  progress: number;
  lateralOffset: number;
  halfWidth: number;
  cooldown: number;
  reward: number;
}>;

export type RockHazardDefinition = Readonly<{
  id: string;
  progress: number;
  lateralOffset: number;
  radius: number;
  height: number;
}>;

export type SpawnSlotDefinition = Readonly<{
  progress: number;
  lane: number;
}>;

export type TimeTrialTargets = Readonly<{
  gold: number;
  silver: number;
  bronze: number;
}>;

export type LandmarkDefinition = Readonly<{
  id: string;
  progress: number;
  lateralOffset: number;
}>;

export type TrackDefinition = Readonly<{
  id: TrackId;
  name: string;
  displayName: string;
  subtitle: string;
  description: string;
  difficulty: 'Breezy' | 'Technical';
  seed: number;
  halfWidth: number;
  width: number;
  buoySpacing: number;
  lapCount: 3;
  spawnGrid: readonly SpawnSlotDefinition[];
  markerPreset: 'sunset-race' | 'storm-warning';
  environmentKit: 'sunset-harbor' | 'storm-reef';
  landmarks: readonly LandmarkDefinition[];
  timeTrialTargets: TimeTrialTargets;
  controlPoints: readonly Readonly<[number, number]>[];
  checkpoints: readonly CheckpointDefinition[];
  interactions: readonly InteractionDefinition[];
  rocks: readonly RockHazardDefinition[];
  environment: EnvironmentPreset;
  environmentPreset: EnvironmentPreset;
  waves: WavePreset;
  wavePreset: WavePreset;
  ai: Readonly<{
    lookAheadScale: number;
    speedScale: number;
    preferredLines: readonly number[];
  }>;
}>;

export type RaceConfig = Readonly<{
  mode: RaceMode;
  trackId: TrackId;
  totalLaps: 3;
  aiCount: 0 | 3;
}>;

const SUNSET_WAVES: readonly GerstnerWave[] = [
  { directionX: 0.9404, directionZ: 0.3401, amplitude: 0.28, frequency: 0.095, speed: 0.82, phase: 0.2, steepness: 0.56 },
  { directionX: -0.2899, directionZ: 0.9571, amplitude: 0.17, frequency: 0.16, speed: 1.08, phase: 1.8, steepness: 0.46 },
  { directionX: 0.6606, directionZ: -0.7507, amplitude: 0.1, frequency: 0.285, speed: 1.48, phase: 3.1, steepness: 0.34 },
  { directionX: -0.8321, directionZ: -0.5547, amplitude: 0.065, frequency: 0.42, speed: 1.82, phase: 4.35, steepness: 0.22 },
] as const;

const STORM_WAVES: readonly GerstnerWave[] = [
  { directionX: 0.9848, directionZ: 0.1736, amplitude: 0.48, frequency: 0.082, speed: 1.04, phase: 0.6, steepness: 0.66 },
  { directionX: -0.1736, directionZ: 0.9848, amplitude: 0.32, frequency: 0.135, speed: 1.27, phase: 2.1, steepness: 0.6 },
  { directionX: 0.7071, directionZ: -0.7071, amplitude: 0.18, frequency: 0.245, speed: 1.62, phase: 3.6, steepness: 0.44 },
  { directionX: -0.9135, directionZ: -0.4067, amplitude: 0.1, frequency: 0.39, speed: 2.02, phase: 5.0, steepness: 0.3 },
] as const;

const sunsetEnvironment: EnvironmentPreset = {
  id: 'sunset',
  label: 'Golden-hour island circuit',
  water: '#168eaf',
  deepWater: '#07516d',
  foam: '#fff3d7',
  fog: '#f2b778',
  skyTop: '#397ac8',
  skyMid: '#7bd4dd',
  horizon: '#ffdb9d',
  sun: '#fff0a8',
  exposure: 1.04,
  storm: false,
  ambiencePreset: 'sunset-marina',
};

const stormEnvironment: EnvironmentPreset = {
  id: 'storm',
  label: 'Cold squall over volcanic reef',
  water: '#17647d',
  deepWater: '#082e46',
  foam: '#cdeff1',
  fog: '#6f8290',
  skyTop: '#27394d',
  skyMid: '#536b78',
  horizon: '#8da0a4',
  sun: '#b9d6d6',
  exposure: 0.9,
  storm: true,
  ambiencePreset: 'storm-squall',
};

const sunsetWavePreset: WavePreset = { id: 'sunset-swell', waves: SUNSET_WAVES, visualStrength: 1 };
const stormWavePreset: WavePreset = { id: 'storm-cross-swell', waves: STORM_WAVES, visualStrength: 1.55 };

const standardSpawnGrid: readonly SpawnSlotDefinition[] = [
  { progress: 0.982, lane: -1.45 },
  { progress: 0.979, lane: 1.4 },
  { progress: 0.969, lane: -1.4 },
  { progress: 0.966, lane: 1.35 },
];

const checkpointSet = (width: number): readonly CheckpointDefinition[] => [
  { id: 'sector-01', progress: 0.075, halfWidth: width, height: 5.5, visible: false, role: 'anti-cut' },
  { id: 'sector-02', progress: 0.155, halfWidth: width * 0.88, height: 5.5, visible: true, role: 'sector' },
  { id: 'sector-03', progress: 0.235, halfWidth: width, height: 5.5, visible: false, role: 'anti-cut' },
  { id: 'sector-04', progress: 0.32, halfWidth: width * 0.9, height: 5.5, visible: true, role: 'sector' },
  { id: 'sector-05', progress: 0.405, halfWidth: width, height: 5.5, visible: false, role: 'anti-cut' },
  { id: 'sector-06', progress: 0.49, halfWidth: width * 0.92, height: 5.5, visible: true, role: 'sector' },
  { id: 'sector-07', progress: 0.575, halfWidth: width, height: 5.5, visible: false, role: 'anti-cut' },
  { id: 'sector-08', progress: 0.66, halfWidth: width * 0.9, height: 5.5, visible: true, role: 'sector' },
  { id: 'sector-09', progress: 0.745, halfWidth: width, height: 5.5, visible: false, role: 'anti-cut' },
  { id: 'sector-10', progress: 0.83, halfWidth: width * 0.88, height: 5.5, visible: true, role: 'sector' },
  { id: 'sector-11', progress: 0.915, halfWidth: width, height: 5.5, visible: false, role: 'anti-cut' },
  { id: 'finish', progress: 0, halfWidth: width, height: 6, visible: true, role: 'finish' },
];

export const TRACK_CATALOG: Readonly<Record<TrackId, TrackDefinition>> = {
  'sunset-circuit': {
    id: 'sunset-circuit',
    name: 'Sunset Circuit',
    displayName: 'Sunset Circuit',
    subtitle: 'Golden water. Wide racing lines.',
    description: 'Fast island sweepers, a lighthouse turn and forgiving open-water shortcuts that still demand every sector.',
    difficulty: 'Breezy',
    seed: 217,
    halfWidth: 8.4,
    width: 16.8,
    buoySpacing: 20,
    lapCount: 3,
    spawnGrid: standardSpawnGrid,
    markerPreset: 'sunset-race',
    environmentKit: 'sunset-harbor',
    landmarks: [
      { id: 'sunset-lighthouse', progress: 0.62, lateralOffset: 54 },
      { id: 'sunset-spectators', progress: 0.72, lateralOffset: -46 },
    ],
    timeTrialTargets: { gold: 66, silver: 74, bronze: 86 },
    controlPoints: [[-8, -58], [27, -59], [52, -48], [64, -22], [58, 8], [39, 27], [14, 21], [-5, 31], [13, 44], [-2, 57], [-31, 55], [-55, 39], [-64, 12], [-59, -23], [-39, -51]],
    checkpoints: checkpointSet(12.5),
    interactions: [
      { id: 'sun-boost-east', kind: 'boost-gate', progress: 0.22, lateralOffset: 1.8, halfWidth: 3.3, cooldown: 7, reward: 0.42 },
      { id: 'sun-drift-north', kind: 'drift-gate', progress: 0.52, lateralOffset: -1.5, halfWidth: 3.5, cooldown: 7, reward: 0.55 },
      { id: 'sun-boost-home', kind: 'boost-gate', progress: 0.86, lateralOffset: -1.1, halfWidth: 3.2, cooldown: 7, reward: 0.36 },
    ],
    rocks: [
      { id: 'sun-rock-1', progress: 0.34, lateralOffset: 19, radius: 3.2, height: 3.8 },
      { id: 'sun-rock-2', progress: 0.69, lateralOffset: -22, radius: 4.1, height: 4.8 },
    ],
    environment: sunsetEnvironment,
    environmentPreset: sunsetEnvironment,
    waves: sunsetWavePreset,
    wavePreset: sunsetWavePreset,
    ai: { lookAheadScale: 1, speedScale: 1, preferredLines: [1.4, -1.4, 0.15] },
  },
  'storm-reef': {
    id: 'storm-reef',
    name: 'Storm Reef',
    displayName: 'Storm Reef',
    subtitle: 'Cross-swell. Razor channel. Risk pays.',
    description: 'A technical reef run through a hairpin, rocky fast channel, broad storm sweeper and closing chicane.',
    difficulty: 'Technical',
    seed: 903,
    halfWidth: 9.2,
    width: 18.4,
    buoySpacing: 24,
    lapCount: 3,
    spawnGrid: standardSpawnGrid,
    markerPreset: 'storm-warning',
    environmentKit: 'storm-reef',
    landmarks: [
      { id: 'reef-rock-arch', progress: 0.56, lateralOffset: 38 },
      { id: 'reef-wrecks', progress: 0.78, lateralOffset: -52 },
    ],
    timeTrialTargets: { gold: 100, silver: 112, bronze: 128 },
    controlPoints: [[-12, -82], [34, -85], [74, -67], [88, -28], [66, -5], [35, -17], [18, 5], [52, 30], [78, 57], [43, 78], [3, 68], [-20, 44], [-55, 66], [-88, 42], [-78, 5], [-94, -28], [-61, -60]],
    checkpoints: checkpointSet(13.8),
    interactions: [
      { id: 'reef-boost-channel', kind: 'boost-gate', progress: 0.18, lateralOffset: 2.4, halfWidth: 3.1, cooldown: 8, reward: 0.46 },
      { id: 'reef-drift-hairpin', kind: 'drift-gate', progress: 0.4, lateralOffset: -1.7, halfWidth: 3.4, cooldown: 8, reward: 0.62 },
      { id: 'reef-risk-boost', kind: 'boost-gate', progress: 0.7, lateralOffset: 6.4, halfWidth: 2.6, cooldown: 9, reward: 0.58 },
      { id: 'reef-drift-chicane', kind: 'drift-gate', progress: 0.9, lateralOffset: 0.8, halfWidth: 3.2, cooldown: 8, reward: 0.56 },
    ],
    rocks: [
      { id: 'reef-rock-1', progress: 0.12, lateralOffset: 10.5, radius: 4.4, height: 6.2 },
      { id: 'reef-rock-2', progress: 0.2, lateralOffset: -11, radius: 5.1, height: 7.4 },
      { id: 'reef-rock-3', progress: 0.43, lateralOffset: 12, radius: 4.8, height: 6.7 },
      { id: 'reef-rock-4', progress: 0.68, lateralOffset: 9.5, radius: 3.7, height: 5.2 },
      { id: 'reef-rock-5', progress: 0.72, lateralOffset: 3.3, radius: 3.2, height: 4.8 },
      { id: 'reef-rock-6', progress: 0.93, lateralOffset: -10.8, radius: 4.5, height: 6.5 },
    ],
    environment: stormEnvironment,
    environmentPreset: stormEnvironment,
    waves: stormWavePreset,
    wavePreset: stormWavePreset,
    ai: { lookAheadScale: 1.08, speedScale: 0.97, preferredLines: [1.2, -1.7, 0.4] },
  },
} as const;

export function getTrackDefinition(id: TrackId): TrackDefinition {
  return TRACK_CATALOG[id];
}

export const TRACK_IDS = Object.freeze(Object.keys(TRACK_CATALOG) as TrackId[]);

export function makeRaceConfig(mode: RaceMode, trackId: TrackId): RaceConfig {
  return { mode, trackId, totalLaps: getTrackDefinition(trackId).lapCount, aiCount: mode === 'quick-race' ? 3 : 0 };
}
