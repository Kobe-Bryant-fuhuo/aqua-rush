import * as THREE from 'three';
import type { RaceIntent } from '../core/InputController';
import type { WaveSurface } from '../systems/WaveSurface';

export type BoatTuning = {
  maxForwardSpeed: number;
  maxReverseSpeed: number;
  acceleration: number;
  braking: number;
  reverseAcceleration: number;
  coastDrag: number;
  turnRate: number;
  lateralGrip: number;
  driftGrip: number;
  boostAcceleration: number;
  boostedMaxSpeed: number;
  boostDrain: number;
  boostRecharge: number;
};

export const DEFAULT_PLAYER_TUNING: BoatTuning = {
  maxForwardSpeed: 25,
  maxReverseSpeed: 6,
  acceleration: 11.5,
  braking: 18,
  reverseAcceleration: 7.5,
  coastDrag: 2.1,
  turnRate: 1.72,
  lateralGrip: 5.4,
  driftGrip: 1.65,
  boostAcceleration: 14,
  boostedMaxSpeed: 33,
  boostDrain: 0.28,
  boostRecharge: 0.12,
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export class ArcadeBoat {
  readonly group = new THREE.Group();
  readonly velocity = new THREE.Vector3();
  readonly radius = 1.05;
  readonly visualRoot = new THREE.Group();

  speed = 0;
  heading = 0;
  boost = 1;
  boosting = false;

  private readonly forward = new THREE.Vector3(0, 0, -1);
  private readonly desiredVelocity = new THREE.Vector3();
  private readonly surfaceNormal = new THREE.Vector3(0, 1, 0);
  private readonly surfaceForward = new THREE.Vector3();
  private readonly surfaceRight = new THREE.Vector3();
  private readonly surfaceBack = new THREE.Vector3();
  private readonly poseMatrix = new THREE.Matrix4();
  private readonly poseQuaternion = new THREE.Quaternion();
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly ownedMaterials: THREE.Material[] = [];
  private currentSteer = 0;
  private currentThrottle = 0;

  constructor(readonly id: string, color: THREE.ColorRepresentation, model?: THREE.Object3D) {
    this.group.name = `racer-${id}`;
    this.visualRoot.name = `racer-visual-${id}`;
    this.group.add(this.visualRoot);
    this.visualRoot.add(model ?? this.createFallbackModel(color));
  }

  drive(delta: number, intent: RaceIntent, tuning: BoatTuning, enabled: boolean): void {
    const throttle = enabled ? THREE.MathUtils.clamp(intent.throttle, -1, 1) : 0;
    const steer = enabled ? THREE.MathUtils.clamp(intent.steer, -1, 1) : 0;
    const wantsBoost = enabled && intent.boost && throttle > 0.05 && this.boost > 0.005;
    this.boosting = wantsBoost;
    this.currentSteer = steer;
    this.currentThrottle = throttle;

    if (throttle > 0) {
      this.speed += tuning.acceleration * throttle * delta;
    } else if (throttle < 0) {
      if (this.speed > 0.25) this.speed += tuning.braking * throttle * delta;
      else this.speed += tuning.reverseAcceleration * throttle * delta;
    } else {
      const drag = tuning.coastDrag * delta;
      this.speed = Math.abs(this.speed) <= drag ? 0 : this.speed - Math.sign(this.speed) * drag;
    }

    if (this.boosting) {
      this.speed += tuning.boostAcceleration * delta;
      this.boost = Math.max(0, this.boost - tuning.boostDrain * delta);
    } else {
      this.boost = Math.min(1, this.boost + tuning.boostRecharge * delta);
    }

    const maxForward = this.boosting ? tuning.boostedMaxSpeed : tuning.maxForwardSpeed;
    this.speed = THREE.MathUtils.clamp(this.speed, -tuning.maxReverseSpeed, maxForward);
    const speedRatio = Math.min(1, Math.abs(this.speed) / Math.max(1, tuning.maxForwardSpeed));
    const steeringAuthority = 0.22 + speedRatio * 0.78;
    const driftTurnBonus = this.boosting ? 1.18 : 1;
    this.heading += steer * tuning.turnRate * steeringAuthority * driftTurnBonus * Math.sign(this.speed || 1) * delta;

    this.getForward(this.forward);
    this.desiredVelocity.copy(this.forward).multiplyScalar(this.speed);
    const grip = this.boosting ? tuning.driftGrip : tuning.lateralGrip;
    const gripFactor = 1 - Math.exp(-grip * delta);
    this.velocity.lerp(this.desiredVelocity, gripFactor);
    this.group.position.addScaledVector(this.velocity, delta);
  }

  updateWaterPose(delta: number, elapsed: number, waves: WaveSurface): void {
    const { x, z } = this.group.position;
    this.group.position.y = waves.getHeight(x, z, elapsed) + 0.42;
    waves.getNormal(x, z, elapsed, this.surfaceNormal);
    this.getForward(this.surfaceForward);
    this.surfaceForward.addScaledVector(this.surfaceNormal, -this.surfaceForward.dot(this.surfaceNormal)).normalize();
    this.surfaceRight.copy(this.surfaceForward).cross(this.surfaceNormal).normalize();
    this.surfaceBack.copy(this.surfaceForward).multiplyScalar(-1);
    this.poseMatrix.makeBasis(this.surfaceRight, this.surfaceNormal, this.surfaceBack);
    this.poseQuaternion.setFromRotationMatrix(this.poseMatrix);
    this.group.quaternion.slerp(this.poseQuaternion, 1 - Math.exp(-7.5 * delta));

    const targetRoll = -this.currentSteer * Math.min(0.24, Math.abs(this.speed) * 0.0095);
    const targetPitch = -this.currentThrottle * 0.055 + (this.boosting ? -0.035 : 0);
    this.visualRoot.rotation.z = THREE.MathUtils.damp(this.visualRoot.rotation.z, targetRoll, 8, delta);
    this.visualRoot.rotation.x = THREE.MathUtils.damp(this.visualRoot.rotation.x, targetPitch, 7, delta);
  }

  getForward(target = new THREE.Vector3()): THREE.Vector3 {
    return target.set(Math.sin(this.heading), 0, -Math.cos(this.heading));
  }

  applyCollision(normal: THREE.Vector3, severity: number): void {
    const inwardSpeed = this.velocity.dot(normal);
    if (inwardSpeed < 0) this.velocity.addScaledVector(normal, -inwardSpeed * 1.45);
    this.speed *= THREE.MathUtils.lerp(0.92, 0.68, THREE.MathUtils.clamp(severity, 0, 1));
    this.syncSpeedFromVelocity();
  }

  syncSpeedFromVelocity(): void {
    this.getForward(this.forward);
    this.speed = this.velocity.dot(this.forward);
  }

  reset(position: THREE.Vector3, heading: number): void {
    this.group.position.copy(position);
    this.heading = heading;
    this.speed = 0;
    this.velocity.set(0, 0, 0);
    this.boost = 1;
    this.boosting = false;
    this.currentSteer = 0;
    this.currentThrottle = 0;
    this.group.quaternion.setFromAxisAngle(WORLD_UP, heading);
    this.visualRoot.rotation.set(0, 0, 0);
  }

  dispose(): void {
    for (const geometry of this.ownedGeometries) geometry.dispose();
    for (const material of this.ownedMaterials) material.dispose();
  }

  private createFallbackModel(color: THREE.ColorRepresentation): THREE.Object3D {
    const root = new THREE.Group();
    const hullMaterial = new THREE.MeshToonMaterial({ color });
    const darkMaterial = new THREE.MeshToonMaterial({ color: '#14334b' });
    const glassMaterial = new THREE.MeshToonMaterial({ color: '#9fe8ff' });
    this.ownedMaterials.push(hullMaterial, darkMaterial, glassMaterial);

    const hullGeometry = new THREE.ConeGeometry(0.9, 3.6, 5);
    const cabinGeometry = new THREE.BoxGeometry(1.15, 0.62, 1.2);
    const bumperGeometry = new THREE.BoxGeometry(1.7, 0.18, 2.15);
    this.ownedGeometries.push(hullGeometry, cabinGeometry, bumperGeometry);

    const hull = new THREE.Mesh(hullGeometry, hullMaterial);
    hull.rotation.x = -Math.PI / 2;
    hull.rotation.y = Math.PI;
    hull.position.y = 0.1;
    hull.castShadow = true;
    root.add(hull);

    const bumper = new THREE.Mesh(bumperGeometry, darkMaterial);
    bumper.position.set(0, -0.08, 0.28);
    bumper.castShadow = true;
    root.add(bumper);

    const cabin = new THREE.Mesh(cabinGeometry, glassMaterial);
    cabin.position.set(0, 0.52, 0.35);
    cabin.castShadow = true;
    root.add(cabin);
    return root;
  }
}
