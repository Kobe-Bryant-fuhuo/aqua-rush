import * as THREE from 'three';

export type WaveSample = {
  height: number;
  normal: THREE.Vector3;
};

type Wave = {
  directionX: number;
  directionZ: number;
  amplitude: number;
  frequency: number;
  speed: number;
  phase: number;
};

/** Shared deterministic height/normal contract for ocean visuals and boat pose. */
export class WaveSurface {
  private readonly waves: Wave[] = [
    { directionX: 1, directionZ: 0, amplitude: 0.34, frequency: 0.085, speed: 0.85, phase: 0 },
    { directionX: 0, directionZ: 1, amplitude: 0.24, frequency: 0.11, speed: -0.58, phase: 0 },
    { directionX: 1, directionZ: 1, amplitude: 0.18, frequency: 0.045, speed: 0.32, phase: 0 },
  ];

  getHeight(x: number, z: number, elapsed: number): number {
    let height = 0;
    for (const wave of this.waves) {
      const phase = (x * wave.directionX + z * wave.directionZ) * wave.frequency + elapsed * wave.speed + wave.phase;
      height += Math.sin(phase) * wave.amplitude;
    }
    return height;
  }

  getNormal(x: number, z: number, elapsed: number, target = new THREE.Vector3()): THREE.Vector3 {
    let derivativeX = 0;
    let derivativeZ = 0;
    for (const wave of this.waves) {
      const phase = (x * wave.directionX + z * wave.directionZ) * wave.frequency + elapsed * wave.speed + wave.phase;
      const slope = Math.cos(phase) * wave.amplitude * wave.frequency;
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
}
