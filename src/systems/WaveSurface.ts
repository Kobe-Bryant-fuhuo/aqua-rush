import * as THREE from 'three';
import { FAIR_WAVES } from './SeaStatePresets';

export type WaveSample = {
  height: number;
  normal: THREE.Vector3;
};

export type GerstnerWave = Readonly<{
  directionX: number;
  directionZ: number;
  amplitude: number;
  frequency: number;
  speed: number;
  phase: number;
  steepness: number;
}>;

/** One authored wave field used by both the CPU boat pose and the GPU ocean. */
export const GERSTNER_WAVES = FAIR_WAVES;

export const GERSTNER_WAVE_COUNT = GERSTNER_WAVES.length;

export type WaveUniformData = {
  directions: THREE.Vector2[];
  amplitudes: number[];
  frequencies: number[];
  speeds: number[];
  phases: number[];
  steepness: number[];
};

/** Shared deterministic height/normal contract for ocean visuals and boat pose. */
export class WaveSurface {
  readonly waves: readonly GerstnerWave[];

  constructor(waves: readonly GerstnerWave[] = GERSTNER_WAVES) {
    if (waves.length !== GERSTNER_WAVE_COUNT) {
      throw new Error(`WaveSurface requires exactly ${GERSTNER_WAVE_COUNT} Gerstner layers.`);
    }
    this.waves = waves;
  }

  getHeight(x: number, z: number, elapsed: number): number {
    let height = 0;
    for (const wave of this.waves) {
      const phase = this.phaseAt(wave, x, z, elapsed);
      height += Math.sin(phase) * wave.amplitude;
      height += Math.sin(phase * 2 + 0.45) * wave.amplitude * wave.steepness * 0.085;
    }
    return height;
  }

  getNormal(x: number, z: number, elapsed: number, target = new THREE.Vector3()): THREE.Vector3 {
    let derivativeX = 0;
    let derivativeZ = 0;
    for (const wave of this.waves) {
      const phase = this.phaseAt(wave, x, z, elapsed);
      const primarySlope = Math.cos(phase) * wave.amplitude * wave.frequency;
      const harmonicSlope =
        Math.cos(phase * 2 + 0.45) * wave.amplitude * wave.steepness * 0.085 * wave.frequency * 2;
      const slope = primarySlope + harmonicSlope;
      derivativeX += slope * wave.directionX;
      derivativeZ += slope * wave.directionZ;
    }
    return target.set(-derivativeX, 1, -derivativeZ).normalize();
  }

  sample(x: number, z: number, elapsed: number, normalTarget = new THREE.Vector3()): WaveSample {
    return {
      height: this.getHeight(x, z, elapsed),
      normal: this.getNormal(x, z, elapsed, normalTarget),
    };
  }

  /** Shader uniforms are built from the exact same immutable wave definitions. */
  createUniformData(): WaveUniformData {
    return {
      directions: this.waves.map((wave) => new THREE.Vector2(wave.directionX, wave.directionZ)),
      amplitudes: this.waves.map((wave) => wave.amplitude),
      frequencies: this.waves.map((wave) => wave.frequency),
      speeds: this.waves.map((wave) => wave.speed),
      phases: this.waves.map((wave) => wave.phase),
      steepness: this.waves.map((wave) => wave.steepness),
    };
  }

  private phaseAt(wave: GerstnerWave, x: number, z: number, elapsed: number): number {
    return (x * wave.directionX + z * wave.directionZ) * wave.frequency + elapsed * wave.speed + wave.phase;
  }
}
