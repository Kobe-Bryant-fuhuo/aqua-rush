import type { WaveHandlingState } from '../entities/ArcadeBoat';

export const BOAT_NUMBERS = [
  'skillChain', 'skillTime', 'skillKind', 'skillSerial', 'skillReward', 'draftCharge', 'draftCooldown',
  'flightTime', 'flightCooldown', 'jumps', 'speed', 'heading', 'boost', 'driftCharge', 'driftQuality', 'contact',
  'landingIntensity', 'steering', 'throttle', 'currentSteer', 'currentThrottle',
  'driftDirection', 'miniBoostTimer', 'miniBoostStrength', 'verticalVelocity',
  'hullPitch', 'hullRoll', 'pitchVelocity', 'rollVelocity',
] as const;
export const BOAT_FLAGS = ['drafting', 'draftReady', 'flightActive', 'boosting', 'ordinaryBoosting', 'miniBoosting', 'drifting', 'airborne'] as const;

/** Includes hidden timers and wave feedback so a restored boat can replay inputs. */
export type BoatState = {
  position: [number, number, number];
  velocity: [number, number, number];
  quaternion: [number, number, number, number];
  visualRotation: [number, number, number];
  numbers: Record<(typeof BOAT_NUMBERS)[number], number>;
  flags: Record<(typeof BOAT_FLAGS)[number], boolean>;
  waveHandling: WaveHandlingState;
};
