import type { GerstnerWave } from './WaveSurface';

export type SeaStateId = 'fair' | 'breezy' | 'rough' | 'storm';

// Racing defaults: broad, low swells; tiny chop belongs in the normal map.
export const FAIR_WAVES: readonly GerstnerWave[] = [
  { directionX: 0.9404, directionZ: 0.3401, amplitude: 0.48, frequency: 0.09, speed: 0.78, phase: 0.2, steepness: 0.42 },
  { directionX: -0.2899, directionZ: 0.9571, amplitude: 0.22, frequency: 0.15, speed: 1.02, phase: 1.8, steepness: 0.36 },
  { directionX: 0.6606, directionZ: -0.7507, amplitude: 0.085, frequency: 0.25, speed: 1.35, phase: 3.1, steepness: 0.25 },
  { directionX: -0.8321, directionZ: -0.5547, amplitude: 0.035, frequency: 0.4, speed: 1.6, phase: 4.35, steepness: 0.18 },
];

export const BREEZY_WAVES: readonly GerstnerWave[] = [
  { directionX: 0.9848, directionZ: 0.1736, amplitude: 0.62, frequency: 0.09, speed: 0.86, phase: 0.6, steepness: 0.46 },
  { directionX: -0.1736, directionZ: 0.9848, amplitude: 0.32, frequency: 0.15, speed: 1.1, phase: 2.1, steepness: 0.4 },
  { directionX: 0.7071, directionZ: -0.7071, amplitude: 0.12, frequency: 0.25, speed: 1.42, phase: 3.6, steepness: 0.3 },
  { directionX: -0.9135, directionZ: -0.4067, amplitude: 0.05, frequency: 0.39, speed: 1.72, phase: 5, steepness: 0.2 },
];

// Preserve the September 8 heavy-sea tuning intact for the future weather system.
// Neither preset is selected by a race course by default.
export const ROUGH_WAVES: readonly GerstnerWave[] = [
  { directionX: 0.9404, directionZ: 0.3401, amplitude: 1.05, frequency: 0.12, speed: 1.12, phase: 0.2, steepness: 0.56 },
  { directionX: -0.2899, directionZ: 0.9571, amplitude: 0.65, frequency: 0.2, speed: 1.4, phase: 1.8, steepness: 0.46 },
  { directionX: 0.6606, directionZ: -0.7507, amplitude: 0.32, frequency: 0.32, speed: 1.78, phase: 3.1, steepness: 0.34 },
  { directionX: -0.8321, directionZ: -0.5547, amplitude: 0.18, frequency: 0.48, speed: 2.12, phase: 4.35, steepness: 0.22 },
];

export const STORM_WAVES: readonly GerstnerWave[] = [
  { directionX: 0.9848, directionZ: 0.1736, amplitude: 1.6, frequency: 0.115, speed: 1.22, phase: 0.6, steepness: 0.66 },
  { directionX: -0.1736, directionZ: 0.9848, amplitude: 1.0, frequency: 0.19, speed: 1.52, phase: 2.1, steepness: 0.6 },
  { directionX: 0.7071, directionZ: -0.7071, amplitude: 0.5, frequency: 0.31, speed: 1.92, phase: 3.6, steepness: 0.44 },
  { directionX: -0.9135, directionZ: -0.4067, amplitude: 0.26, frequency: 0.46, speed: 2.32, phase: 5, steepness: 0.3 },
];

export const SEA_STATES: Readonly<Record<SeaStateId, readonly GerstnerWave[]>> = {
  fair: FAIR_WAVES,
  breezy: BREEZY_WAVES,
  rough: ROUGH_WAVES,
  storm: STORM_WAVES,
};
