import type { WorldMechanics } from '../game/WorldMechanics';
import type { CurrentField } from '../game/CurrentField';
import * as THREE from 'three';
import type { RaceIntent } from '../shared/RaceIntent';
import type { WaveSurface } from '../systems/WaveSurface';
import { BOAT_FLAGS, BOAT_NUMBERS, type BoatState } from '../shared/BoatState';

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
  driftGrip: 3,
  boostAcceleration: 14,
  boostedMaxSpeed: 33,
  boostDrain: 0.28,
  boostRecharge: 0.04,
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WAVE_ALONG_ACCELERATION = 10;
const WAVE_LATERAL_ACCELERATION = 7.5;

export type WaveHandlingState = {
  /** Positive when the bow is climbing a wave. */
  forwardSlope: number;
  /** Positive when the starboard side is higher than port. */
  crossSlope: number;
  /** Signed acceleration along the hull's forward axis. */
  alongAcceleration: number;
  /** Signed acceleration along the hull's starboard axis. */
  lateralAcceleration: number;
  /** Current contact/slope multiplier applied to steering. */
  steeringAuthority: number;
  /** Current contact/slope multiplier applied to lateral grip. */
  gripScale: number;
};

export class ArcadeBoat {
  currentField: CurrentField | null = null;
  worldMechanics: WorldMechanics | null = null;
  flightActive = false;
  flightTime = 0;
  flightCooldown = 0;
  jumps = 0;
  skillChain = 0;
  skillTime = 0;
  skillKind = 0;
  skillSerial = 0;
  skillReward = 0;
  draftCharge = 0;
  draftCooldown = 0;
  drafting = false;
  draftReady = false;
  private readonly flightEuler = new THREE.Euler();
  private readonly rampDelta = new THREE.Vector3();
  readonly waterCurrent = new THREE.Vector3();
  readonly previousPosition = new THREE.Vector3();
  private static readonly activeBoats = new Set<ArcadeBoat>();

  readonly group = new THREE.Group();
  readonly velocity = new THREE.Vector3();
  readonly radius = 1.05;
  readonly visualRoot = new THREE.Group();
  readonly waveHandling: WaveHandlingState = {
    forwardSlope: 0,
    crossSlope: 0,
    alongAcceleration: 0,
    lateralAcceleration: 0,
    steeringAuthority: 1,
    gripScale: 1,
  };

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
  private readonly planarRight = new THREE.Vector3(1, 0, 0);
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

  /** A null model runs the same simulation without geometry or global AI registration. */
  constructor(readonly id: string, color: THREE.ColorRepresentation, model?: THREE.Object3D | null) {
    this.group.name = `racer-${id}`;
    this.visualRoot.name = `racer-visual-${id}`;
    this.group.add(this.visualRoot);
    if (model !== null) {
      this.visualRoot.add(model ?? this.createFallbackModel(color));
      ArcadeBoat.activeBoats.add(this);
    }
  }

  static getActiveBoats(): ReadonlySet<ArcadeBoat> {
    return ArcadeBoat.activeBoats;
  }

  drive(delta: number, intent: RaceIntent, tuning: BoatTuning, enabled: boolean): void {
    this.previousPosition.copy(this.group.position);
    if (enabled) {
      this.skillTime = Math.max(0, this.skillTime - delta);
      this.draftCooldown = Math.max(0, this.draftCooldown - delta);
      if (this.skillTime === 0) this.skillChain = 0;
    }
    if (enabled && this.currentField) this.currentField.sample(this.group.position, this.waterCurrent);
    else this.waterCurrent.set(0, 0, 0);
    const throttle = enabled ? THREE.MathUtils.clamp(intent.throttle, -1, 1) : 0;
    const steer = enabled ? THREE.MathUtils.clamp(intent.steer, -1, 1) : 0;
    const boostHeld = enabled && intent.boost && throttle > 0.05;
    const speedRatio = Math.min(1, Math.abs(this.speed) / Math.max(1, tuning.maxForwardSpeed));
    const canStartDrift = boostHeld && !this.flightActive && Math.abs(steer) > 0.3 && speedRatio > 0.28;
    if (this.flightActive && this.drifting) { this.drifting = false; this.driftCharge = this.driftQuality = 0; }
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
        this.driftCharge = Math.min(1, this.driftCharge + (0.2 + this.driftQuality * 0.45) * delta);
      } else {
        this.driftCharge = Math.max(0, this.driftCharge - 0.42 * delta);
      }
    } else if (this.drifting && !boostHeld) {
      if (this.driftCharge >= 0.16) {
        const tier = this.driftCharge >= .7 ? 3 : this.driftCharge >= .4 ? 2 : 1;
        this.grantMiniBoost(.3 + tier * .22);
        if (enabled && this.speed > 10) this.rewardSkill(1, .055 + tier * .045);
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
      const poorDriftTax = THREE.MathUtils.lerp(1.2, 0.15, this.driftQuality);
      this.speed -= Math.sign(this.speed || 1) * poorDriftTax * delta;
    }

    // Wave slopes exchange speed with the hull instead of merely tilting its
    // render transform. The low-speed gate keeps an unattended boat near its
    // grid slot while preserving a clear effect at racing speed.
    if (enabled) this.speed += this.waveHandling.alongAcceleration * delta;

    const chainHeadroom = Math.max(0, this.skillChain - 1) * 2;
    const maxForward = this.boosting ? tuning.boostedMaxSpeed + chainHeadroom : tuning.maxForwardSpeed;
    this.speed = THREE.MathUtils.clamp(this.speed, -tuning.maxReverseSpeed, maxForward);
    const postAccelerationSpeedRatio = Math.min(1, Math.abs(this.speed) / Math.max(1, tuning.maxForwardSpeed));
    const baseSteeringAuthority = (0.58 + postAccelerationSpeedRatio * 0.42) * (1 - postAccelerationSpeedRatio * 0.13);
    const steeringAuthority = baseSteeringAuthority * this.waveHandling.steeringAuthority;
    const driftTurnBonus = this.drifting ? 1.3 : this.boosting ? 0.94 : 1;
    this.heading += steer * tuning.turnRate * steeringAuthority * driftTurnBonus * Math.sign(this.speed || 1) * delta;

    this.getForward(this.forward);
    this.planarRight.copy(this.forward).cross(WORLD_UP).normalize();
    this.desiredVelocity.copy(this.forward).multiplyScalar(this.speed).add(this.waterCurrent);
    const highSpeedGrip = tuning.lateralGrip * (1 + postAccelerationSpeedRatio * 0.18);
    const grip = (this.drifting ? tuning.driftGrip : highSpeedGrip) * this.waveHandling.gripScale;
    const gripFactor = 1 - Math.exp(-grip * delta);
    this.velocity.lerp(this.desiredVelocity, gripFactor);
    if (enabled) {
      this.velocity.addScaledVector(this.planarRight, this.waveHandling.lateralAcceleration * delta);
    }
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
    const forwardSlope = (bowHeight - sternHeight) / (bowDistance * 2);
    const crossSlope = (starboardHeight - portHeight) / (halfBeam * 2);

    const wasAirborne = this.airborne && !this.flightActive;
    const descentSpeed = Math.max(0, -this.verticalVelocity);
    const dt = Math.min(delta, 0.05);
    this.flightCooldown = Math.max(0, this.flightCooldown - dt);
    if (this.flightActive) {
      this.flightTime += dt;
      this.verticalVelocity -= 16 * dt;
      this.group.position.y += this.verticalVelocity * dt;
      if (this.group.position.y <= targetWaterY && this.verticalVelocity < 0) {
        this.flightActive = false; this.airborne = false;
        this.group.position.y = targetWaterY; this.verticalVelocity = 0;
        this.landingIntensity = .9; this.flightCooldown = 1.2; this.jumps++;
        const alignment = this.velocity.lengthSq() > 1 ? this.getForward(this.surfaceForward).dot(this.velocity.clone().normalize()) : 0;
        const clean = alignment > .94 && Math.abs(this.currentSteer) < .4;
        this.grantMiniBoost(clean ? .85 : .3);
        if (clean) this.rewardSkill(2, .18);
        else { this.speed *= .86; this.velocity.multiplyScalar(.86); }
      } else {
        this.contact = 0; this.airborne = true;
        this.waveHandling.alongAcceleration = this.waveHandling.lateralAcceleration = 0;
        this.waveHandling.steeringAuthority = .7; this.waveHandling.gripScale = .3;
        this.group.quaternion.setFromEuler(this.flightEuler.set(Math.atan2(this.verticalVelocity, Math.max(8, Math.abs(this.speed))), -this.heading, -this.currentSteer * .08));
        return;
      }
    }
    if (!this.flightActive && this.flightCooldown === 0) for (const ramp of this.worldMechanics?.ramps ?? []) {
      this.rampDelta.copy(this.group.position).sub(ramp.center);
      const along = this.rampDelta.dot(ramp.forward), across = this.rampDelta.dot(ramp.right);
      const previousAlong = this.rampDelta.copy(this.previousPosition).sub(ramp.center).dot(ramp.forward);
      if (Math.abs(across) > ramp.width / 2) continue;
      if (along >= -ramp.length / 2 && along <= ramp.length / 2) {
        const height = (along / ramp.length + .5) * ramp.height + .42;
        this.group.position.y = Math.max(targetWaterY, height);
        this.verticalVelocity = 0; this.contact = 1; this.airborne = false;
        this.waveHandling.alongAcceleration = this.waveHandling.lateralAcceleration = 0;
        this.waveHandling.steeringAuthority = this.waveHandling.gripScale = 1;
        this.group.quaternion.setFromEuler(this.flightEuler.set(Math.atan2(ramp.height, ramp.length), -this.heading, 0));
        return;
      }
      if (previousAlong <= ramp.length / 2 && previousAlong >= -ramp.length / 2 && along > ramp.length / 2 && this.velocity.dot(ramp.forward) > 1) {
        this.flightActive = true; this.flightTime = 0; this.airborne = true; this.contact = 0;
        this.group.position.y = Math.max(targetWaterY, ramp.height + .42);
        this.verticalVelocity = ramp.launch * Math.min(1, Math.max(.15, this.speed / 18));
        return;
      }
    }
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
        THREE.MathUtils.clamp(descentSpeed * 0.24 + Math.abs(this.speed) * 0.012, 0.12, 1),
      );
      // A hard, off-camber landing now costs momentum and nudges the bow down
      // the cross-slope. This makes landing choice matter without taking
      // control away from an arcade player.
      const retention = THREE.MathUtils.lerp(0.97, 0.84, this.landingIntensity);
      this.speed *= retention;
      this.velocity.multiplyScalar(retention);
      this.heading -= THREE.MathUtils.clamp(crossSlope * this.landingIntensity * 0.3, -0.055, 0.055);
    }

    const speedCoupling = THREE.MathUtils.smoothstep(Math.abs(this.speed), 0.6, 10);
    const contactCoupling = THREE.MathUtils.clamp(this.contact, 0, 1);
    const slopeSeverity = THREE.MathUtils.clamp(
      Math.abs(forwardSlope) * 2.4 + Math.abs(crossSlope) * 2,
      0,
      0.58,
    );
    const targetAlongAcceleration = -forwardSlope * WAVE_ALONG_ACCELERATION * contactCoupling * speedCoupling;
    const targetLateralAcceleration = -crossSlope * WAVE_LATERAL_ACCELERATION * contactCoupling * speedCoupling;
    const targetSteeringAuthority = THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(0.32, 1, contactCoupling) * (1 - slopeSeverity * 0.24),
      0.28,
      1,
    );
    const targetGripScale = THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(0.18, 1, contactCoupling) * (1 - slopeSeverity * 0.38),
      0.16,
      1,
    );
    this.waveHandling.forwardSlope = THREE.MathUtils.damp(this.waveHandling.forwardSlope, forwardSlope, 9, dt);
    this.waveHandling.crossSlope = THREE.MathUtils.damp(this.waveHandling.crossSlope, crossSlope, 9, dt);
    this.waveHandling.alongAcceleration = THREE.MathUtils.damp(
      this.waveHandling.alongAcceleration,
      targetAlongAcceleration,
      7,
      dt,
    );
    this.waveHandling.lateralAcceleration = THREE.MathUtils.damp(
      this.waveHandling.lateralAcceleration,
      targetLateralAcceleration,
      7,
      dt,
    );
    this.waveHandling.steeringAuthority = THREE.MathUtils.damp(
      this.waveHandling.steeringAuthority,
      targetSteeringAuthority,
      12,
      dt,
    );
    this.waveHandling.gripScale = THREE.MathUtils.damp(this.waveHandling.gripScale, targetGripScale, 12, dt);

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
    if (severity >= .16) {
      this.skillChain = 0; this.skillTime = 0;
      this.draftReady = false; this.draftCharge = 0; this.draftCooldown = Math.max(1, this.draftCooldown);
    }
    const inwardSpeed = this.velocity.dot(normal);
    if (inwardSpeed < 0) this.velocity.addScaledVector(normal, -inwardSpeed * 1.45);
    this.speed *= THREE.MathUtils.lerp(0.92, 0.68, THREE.MathUtils.clamp(severity, 0, 1));
    this.syncSpeedFromVelocity();
  }

  restoreBoost(amount: number): void {
    this.boost = THREE.MathUtils.clamp(this.boost + Math.max(0, amount), 0, 1);
  }

  /** Successful driving feeds usable boost; a clean sequence increases the refill, capped at three. */
  rewardSkill(kind: 1 | 2 | 3 | 4, refill: number): void {
    this.skillChain = Math.min(3, this.skillChain + 1);
    this.skillTime = 10;
    this.skillKind = kind;
    this.skillSerial++;
    this.skillReward = refill + (this.skillChain - 1) * .04;
    this.restoreBoost(this.skillReward);
  }

  grantMiniBoost(strength: number): void {
    const normalized = THREE.MathUtils.clamp(strength, 0, 1);
    if (this.miniBoostTimer <= 0 && this.speed > 5) this.speed = Math.min(33, this.speed + 3 + normalized * 3);
    this.miniBoostStrength = this.miniBoostTimer > 0 ? Math.max(this.miniBoostStrength, normalized) : normalized;
    this.miniBoostTimer = Math.max(this.miniBoostTimer, THREE.MathUtils.lerp(0.45, 1.2, normalized));
  }

  syncSpeedFromVelocity(): void {
    this.getForward(this.forward);
    this.speed = this.velocity.dot(this.forward) - this.waterCurrent.dot(this.forward);
  }

  reset(position: THREE.Vector3, heading: number): void {
    this.group.position.copy(position);
    this.previousPosition.copy(position);
    this.heading = heading;
    this.flightActive = false; this.flightTime = 0; this.flightCooldown = 0; this.jumps = 0;
    this.skillChain = this.skillTime = this.skillKind = this.skillSerial = this.skillReward = 0;
    this.draftCharge = this.draftCooldown = 0; this.drafting = this.draftReady = false;
    this.speed = 0;
    this.velocity.set(0, 0, 0);
    this.waterCurrent.set(0, 0, 0);
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
    this.waveHandling.forwardSlope = 0;
    this.waveHandling.crossSlope = 0;
    this.waveHandling.alongAcceleration = 0;
    this.waveHandling.lateralAcceleration = 0;
    this.waveHandling.steeringAuthority = 1;
    this.waveHandling.gripScale = 1;
    this.currentSteer = 0;
    this.currentThrottle = 0;
    this.group.quaternion.setFromAxisAngle(WORLD_UP, heading);
    this.visualRoot.rotation.set(0, 0, 0);
  }

  captureState(): BoatState {
    return {
      position: this.group.position.toArray(),
      velocity: this.velocity.toArray(),
      quaternion: this.group.quaternion.toArray(),
      visualRotation: [this.visualRoot.rotation.x, this.visualRoot.rotation.y, this.visualRoot.rotation.z],
      numbers: Object.fromEntries(BOAT_NUMBERS.map((key) => [key, this[key]])) as BoatState['numbers'],
      flags: Object.fromEntries(BOAT_FLAGS.map((key) => [key, this[key]])) as BoatState['flags'],
      waveHandling: { ...this.waveHandling },
    };
  }

  restoreState(state: BoatState): void {
    this.group.position.fromArray(state.position);
    if (this.currentField) this.currentField.sample(this.group.position, this.waterCurrent);
    else this.waterCurrent.set(0, 0, 0);
    this.velocity.fromArray(state.velocity);
    this.group.quaternion.fromArray(state.quaternion);
    this.visualRoot.rotation.set(...state.visualRotation);
    for (const key of BOAT_NUMBERS) this[key] = state.numbers[key];
    for (const key of BOAT_FLAGS) this[key] = state.flags[key];
    Object.assign(this.waveHandling, state.waveHandling);
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
