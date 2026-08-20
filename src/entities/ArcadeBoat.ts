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
  private static readonly activeBoats = new Set<ArcadeBoat>();

  readonly group = new THREE.Group();
  readonly velocity = new THREE.Vector3();
  readonly radius = 1.05;
  readonly visualRoot = new THREE.Group();

  speed = 0;
  heading = 0;
  boost = 1;
  boosting = false;
  ordinaryBoosting = false;
  miniBoosting = false;
  drifting = false;
  driftCharge = 0;
  driftQuality = 0;
  contact = 1;
  airborne = false;
  landingIntensity = 0;
  steering = 0;
  throttle = 0;

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
  private driftDirection = 0;
  private miniBoostTimer = 0;
  private miniBoostStrength = 0;
  private verticalVelocity = 0;

  constructor(readonly id: string, color: THREE.ColorRepresentation, model?: THREE.Object3D) {
    this.group.name = `racer-${id}`;
    this.visualRoot.name = `racer-visual-${id}`;
    this.group.add(this.visualRoot);
    this.visualRoot.add(model ?? this.createFallbackModel(color));
    ArcadeBoat.activeBoats.add(this);
  }

  static getActiveBoats(): ReadonlySet<ArcadeBoat> {
    return ArcadeBoat.activeBoats;
  }

  drive(delta: number, intent: RaceIntent, tuning: BoatTuning, enabled: boolean): void {
    const throttle = enabled ? THREE.MathUtils.clamp(intent.throttle, -1, 1) : 0;
    const steer = enabled ? THREE.MathUtils.clamp(intent.steer, -1, 1) : 0;
    const boostHeld = enabled && intent.boost && throttle > 0.05;
    const speedRatio = Math.min(1, Math.abs(this.speed) / Math.max(1, tuning.maxForwardSpeed));
    const canStartDrift = boostHeld && Math.abs(steer) > 0.3 && speedRatio > 0.28;
    if (!this.drifting && canStartDrift) {
      this.drifting = true;
      this.driftDirection = Math.sign(steer) || 1;
      this.driftCharge = 0;
    }

    if (this.drifting && boostHeld) {
      const steerAgreement = Math.sign(steer || this.driftDirection) === this.driftDirection;
      const steerSweetSpot = 1 - Math.min(1, Math.abs(Math.abs(steer) - 0.68) / 0.68);
      this.driftQuality = steerAgreement
        ? THREE.MathUtils.clamp(steerSweetSpot * (0.35 + speedRatio * 0.65), 0, 1)
        : 0;
      if (steerAgreement && Math.abs(steer) > 0.2) {
        this.driftCharge = Math.min(1, this.driftCharge + (0.1 + this.driftQuality * 0.32) * delta);
      } else {
        this.driftCharge = Math.max(0, this.driftCharge - 0.42 * delta);
      }
    } else if (this.drifting && !boostHeld) {
      if (this.driftCharge >= 0.16) {
        this.miniBoostStrength = THREE.MathUtils.smoothstep(this.driftCharge, 0.1, 1);
        this.miniBoostTimer = THREE.MathUtils.lerp(0.22, 0.78, this.miniBoostStrength);
      } else {
        // A cancelled drift costs momentum instead of becoming a free sharper turn.
        this.speed *= 0.9;
        this.velocity.multiplyScalar(0.9);
      }
      this.drifting = false;
      this.driftCharge = 0;
      this.driftQuality = 0;
    }

    this.miniBoostTimer = Math.max(0, this.miniBoostTimer - delta);
    this.miniBoosting = enabled && this.miniBoostTimer > 0;
    this.ordinaryBoosting = boostHeld && !this.drifting && this.boost > 0.005;
    this.boosting = this.ordinaryBoosting || this.miniBoosting;
    this.currentSteer = steer;
    this.currentThrottle = throttle;
    this.steering = steer;
    this.throttle = throttle;

    if (throttle > 0) {
      this.speed += tuning.acceleration * throttle * delta;
    } else if (throttle < 0) {
      if (this.speed > 0.25) this.speed += tuning.braking * throttle * delta;
      else this.speed += tuning.reverseAcceleration * throttle * delta;
    } else {
      const drag = tuning.coastDrag * delta;
      this.speed = Math.abs(this.speed) <= drag ? 0 : this.speed - Math.sign(this.speed) * drag;
    }

    if (this.ordinaryBoosting) {
      this.speed += tuning.boostAcceleration * delta;
      this.boost = Math.max(0, this.boost - tuning.boostDrain * delta);
    } else {
      const rechargeScale = this.drifting ? 0.35 : 1;
      this.boost = Math.min(1, this.boost + tuning.boostRecharge * rechargeScale * delta);
    }
    if (this.miniBoosting) {
      this.speed += tuning.boostAcceleration * (0.6 + this.miniBoostStrength * 0.62) * delta;
    }
    if (this.drifting) {
      const poorDriftTax = THREE.MathUtils.lerp(1.9, 0.35, this.driftQuality);
      this.speed -= Math.sign(this.speed || 1) * poorDriftTax * delta;
    }

    const maxForward = this.boosting ? tuning.boostedMaxSpeed : tuning.maxForwardSpeed;
    this.speed = THREE.MathUtils.clamp(this.speed, -tuning.maxReverseSpeed, maxForward);
    const postAccelerationSpeedRatio = Math.min(1, Math.abs(this.speed) / Math.max(1, tuning.maxForwardSpeed));
    const steeringAuthority = (0.58 + postAccelerationSpeedRatio * 0.42) * (1 - postAccelerationSpeedRatio * 0.13);
    const driftTurnBonus = this.drifting ? 1.3 : this.boosting ? 0.94 : 1;
    this.heading += steer * tuning.turnRate * steeringAuthority * driftTurnBonus * Math.sign(this.speed || 1) * delta;

    this.getForward(this.forward);
    this.desiredVelocity.copy(this.forward).multiplyScalar(this.speed);
    const highSpeedGrip = tuning.lateralGrip * (1 + postAccelerationSpeedRatio * 0.18);
    const grip = this.drifting ? tuning.driftGrip : highSpeedGrip;
    const gripFactor = 1 - Math.exp(-grip * delta);
    this.velocity.lerp(this.desiredVelocity, gripFactor);
    this.group.position.addScaledVector(this.velocity, delta);
  }

  updateWaterPose(delta: number, elapsed: number, waves: WaveSurface): void {
    const { x, z } = this.group.position;
    this.getForward(this.surfaceForward);
    this.surfaceRight.copy(this.surfaceForward).cross(WORLD_UP).normalize();
    const bowDistance = 1.48;
    const halfBeam = 0.72;
    const bowHeight = waves.getHeight(x + this.surfaceForward.x * bowDistance, z + this.surfaceForward.z * bowDistance, elapsed);
    const sternHeight = waves.getHeight(x - this.surfaceForward.x * bowDistance, z - this.surfaceForward.z * bowDistance, elapsed);
    const portHeight = waves.getHeight(x - this.surfaceRight.x * halfBeam, z - this.surfaceRight.z * halfBeam, elapsed);
    const starboardHeight = waves.getHeight(x + this.surfaceRight.x * halfBeam, z + this.surfaceRight.z * halfBeam, elapsed);
    const centerHeight = waves.getHeight(x, z, elapsed);
    const targetWaterY = (centerHeight * 2 + bowHeight + sternHeight + portHeight + starboardHeight) / 6 + 0.42;

    const wasAirborne = this.airborne;
    const dt = Math.min(delta, 0.05);
    if (delta > 0.15 || !Number.isFinite(this.group.position.y)) {
      this.group.position.y = targetWaterY;
      this.verticalVelocity = 0;
      this.contact = 1;
      this.airborne = false;
    } else {
      const gap = this.group.position.y - targetWaterY;
      if (gap < 0.14) {
        this.verticalVelocity += (targetWaterY - this.group.position.y) * 34 * dt;
        this.verticalVelocity *= Math.exp(-5.2 * dt);
      } else {
        this.verticalVelocity -= 7.8 * dt;
      }
      this.verticalVelocity = THREE.MathUtils.clamp(this.verticalVelocity, -4.2, 3.4);
      this.group.position.y += this.verticalVelocity * dt;
      if (this.group.position.y < targetWaterY - 0.12) {
        this.group.position.y = targetWaterY - 0.12;
        this.verticalVelocity = Math.max(0, this.verticalVelocity * -0.16);
      }
      const resolvedGap = this.group.position.y - targetWaterY;
      this.contact = 1 - THREE.MathUtils.smoothstep(resolvedGap, 0.045, 0.34);
      this.airborne = this.contact < 0.25;
    }

    this.landingIntensity = THREE.MathUtils.damp(this.landingIntensity, 0, 5.5, dt);
    if (wasAirborne && !this.airborne) {
      this.landingIntensity = Math.max(
        this.landingIntensity,
        THREE.MathUtils.clamp(Math.max(0, -this.verticalVelocity) * 0.24 + Math.abs(this.speed) * 0.012, 0.12, 1),
      );
    }

    // Bow/stern and port/starboard baselines produce stable pitch and roll.
    this.surfaceForward.set(
      this.surfaceForward.x * bowDistance * 2,
      bowHeight - sternHeight,
      this.surfaceForward.z * bowDistance * 2,
    ).normalize();
    this.surfaceRight.set(
      this.surfaceRight.x * halfBeam * 2,
      starboardHeight - portHeight,
      this.surfaceRight.z * halfBeam * 2,
    ).normalize();
    this.surfaceNormal.crossVectors(this.surfaceRight, this.surfaceForward).normalize();
    this.surfaceRight.crossVectors(this.surfaceForward, this.surfaceNormal).normalize();
    this.surfaceBack.copy(this.surfaceForward).multiplyScalar(-1);
    this.poseMatrix.makeBasis(this.surfaceRight, this.surfaceNormal, this.surfaceBack);
    this.poseQuaternion.setFromRotationMatrix(this.poseMatrix);
    this.group.quaternion.slerp(this.poseQuaternion, 1 - Math.exp(-7.5 * delta));

    const targetRoll = -this.currentSteer * Math.min(this.drifting ? 0.34 : 0.22, Math.abs(this.speed) * 0.0095);
    const targetPitch = -this.currentThrottle * 0.052 + (this.boosting ? -0.032 : 0) + (this.airborne ? -0.025 : 0);
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

  restoreBoost(amount: number): void {
    this.boost = THREE.MathUtils.clamp(this.boost + Math.max(0, amount), 0, 1);
  }

  grantMiniBoost(strength: number): void {
    const normalized = THREE.MathUtils.clamp(strength, 0, 1);
    this.miniBoostStrength = Math.max(this.miniBoostStrength, normalized);
    this.miniBoostTimer = Math.max(this.miniBoostTimer, THREE.MathUtils.lerp(0.28, 0.88, normalized));
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
    this.ordinaryBoosting = false;
    this.miniBoosting = false;
    this.drifting = false;
    this.driftCharge = 0;
    this.driftQuality = 0;
    this.contact = 1;
    this.airborne = false;
    this.landingIntensity = 0;
    this.steering = 0;
    this.throttle = 0;
    this.driftDirection = 0;
    this.miniBoostTimer = 0;
    this.miniBoostStrength = 0;
    this.verticalVelocity = 0;
    this.currentSteer = 0;
    this.currentThrottle = 0;
    this.group.quaternion.setFromAxisAngle(WORLD_UP, heading);
    this.visualRoot.rotation.set(0, 0, 0);
  }

  dispose(): void {
    ArcadeBoat.activeBoats.delete(this);
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
