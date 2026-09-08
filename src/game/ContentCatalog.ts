import type { CurrentDefinition } from './CurrentField';
import type { RouteOption } from './RouteOptions';
import { validateTrackDefinition } from './TrackValidation';
import { createWorlds, type TrackId } from './WorldCatalog';
import type { BlockDefinition, RampDefinition, CrossingDefinition } from './WorldMechanics';
export type { TrackId } from './WorldCatalog';
import type { GerstnerWave } from '../systems/WaveSurface';

export type RaceMode = 'quick-race' | 'time-trial';
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

export type TrackDefinition = Readonly<{
  id: TrackId;
  experimental?: boolean;
  rulesRevision?: number;
  blocks?: readonly BlockDefinition[];
  ramps?: readonly RampDefinition[];
  crossings?: readonly CrossingDefinition[];
  currents?: readonly CurrentDefinition[];
  routes?: readonly RouteOption[];
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

export const TRACK_CATALOG = Object.freeze(createWorlds(sunsetEnvironment, stormEnvironment, sunsetWavePreset, stormWavePreset));
Object.values(TRACK_CATALOG).forEach(validateTrackDefinition);
export const TRACK_IDS = Object.freeze(Object.keys(TRACK_CATALOG) as TrackId[]);
export const ONLINE_TRACK_IDS: readonly TrackId[] = TRACK_IDS;
export function isTrackId(value: unknown): value is TrackId {
  return typeof value === 'string' && Object.hasOwn(TRACK_CATALOG, value);
}
export const isOnlineTrackId = isTrackId;
export function getTrackDefinition(id: TrackId): TrackDefinition {
  if (!isTrackId(id)) throw new Error('Unknown course: ' + id);
  return TRACK_CATALOG[id];
}
export function makeRaceConfig(mode: RaceMode, trackId: TrackId): RaceConfig {
  return { mode, trackId, totalLaps: getTrackDefinition(trackId).lapCount, aiCount: mode === 'quick-race' ? 3 : 0 };
}
