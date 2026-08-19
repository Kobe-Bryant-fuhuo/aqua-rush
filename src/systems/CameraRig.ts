import * as THREE from 'three';
import type { ArcadeBoat } from '../entities/ArcadeBoat';

export type CameraTuning = {
  distance: number;
  height: number;
  spring: number;
  damping: number;
  lookAhead: number;
  baseFov: number;
  speedFov: number;
};

export const DEFAULT_CAMERA_TUNING: CameraTuning = {
  distance: 10.8,
  height: 5.1,
  spring: 46,
  damping: 13.5,
  lookAhead: 5.5,
  baseFov: 54,
  speedFov: 9,
};

export class CameraRig {
  private readonly desiredPosition = new THREE.Vector3();
  private readonly cameraVelocity = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly desiredLookTarget = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly springAcceleration = new THREE.Vector3();
  private trauma = 0;
  private fovPunch = 0;
  private time = 0;
  private reducedMotion = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly tuning: CameraTuning = DEFAULT_CAMERA_TUNING,
  ) {}

  snapTo(boat: ArcadeBoat): void {
    boat.getForward(this.forward);
    this.desiredPosition.copy(boat.group.position).addScaledVector(this.forward, -this.tuning.distance);
    this.desiredPosition.y += this.tuning.height;
    this.camera.position.copy(this.desiredPosition);
    this.cameraVelocity.set(0, 0, 0);
    this.lookTarget.copy(boat.group.position).addScaledVector(this.forward, this.tuning.lookAhead);
    this.lookTarget.y += 1;
    this.camera.lookAt(this.lookTarget);
    this.updateFov(0, boat.speed);
  }

  update(delta: number, elapsed: number, boat: ArcadeBoat, speedRatio: number): void {
    boat.getForward(this.forward);
    this.desiredPosition.copy(boat.group.position).addScaledVector(this.forward, -this.tuning.distance);
    this.desiredPosition.y += this.tuning.height + Math.min(1.1, Math.max(0, boat.speed) * 0.025);

    this.springAcceleration
      .copy(this.desiredPosition)
      .sub(this.camera.position)
      .multiplyScalar(this.tuning.spring)
      .addScaledVector(this.cameraVelocity, -this.tuning.damping);
    this.cameraVelocity.addScaledVector(this.springAcceleration, delta);
    this.camera.position.addScaledVector(this.cameraVelocity, delta);

    this.desiredLookTarget
      .copy(boat.group.position)
      .addScaledVector(this.forward, this.tuning.lookAhead + Math.max(0, boat.speed) * 0.11);
    this.desiredLookTarget.y += 0.7;
    this.lookTarget.lerp(this.desiredLookTarget, 1 - Math.exp(-8.5 * delta));
    this.camera.lookAt(this.lookTarget);

    this.time = elapsed;
    this.trauma = Math.max(0, this.trauma - delta * 1.45);
    if (!this.reducedMotion && this.trauma > 0) {
      const shake = this.trauma * this.trauma;
      const frequency = this.time * 31;
      this.camera.position.x += pseudoNoise(frequency, 1) * 0.38 * shake;
      this.camera.position.y += pseudoNoise(frequency, 2) * 0.28 * shake;
      this.camera.rotation.z += pseudoNoise(frequency, 3) * 0.055 * shake;
    }
    this.updateFov(delta, speedRatio);
  }

  addTrauma(amount: number): void {
    if (this.reducedMotion) return;
    this.trauma = Math.min(1, this.trauma + Math.max(0, amount));
  }

  punchFov(degrees: number): void {
    if (this.reducedMotion) return;
    this.fovPunch = Math.min(8, this.fovPunch + degrees);
  }

  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
    if (enabled) {
      this.trauma = 0;
      this.fovPunch = 0;
    }
  }

  private updateFov(delta: number, speedRatio: number): void {
    this.fovPunch *= Math.exp(-delta / 0.22);
    if (this.fovPunch < 0.001) this.fovPunch = 0;
    const nextFov = this.tuning.baseFov + THREE.MathUtils.clamp(speedRatio, 0, 1.2) * this.tuning.speedFov + this.fovPunch;
    if (Math.abs(this.camera.fov - nextFov) > 0.01) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
  }
}

function pseudoNoise(time: number, seed: number): number {
  const value = Math.sin(time * 12.9898 + seed * 78.233) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}
