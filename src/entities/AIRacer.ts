import * as THREE from 'three';
import type { Object3D } from 'three';
import type { RaceIntent } from '../core/InputController';
import type { RaceTrack } from '../game/Track';
import type { WaveSurface } from '../systems/WaveSurface';
import { ArcadeBoat, DEFAULT_PLAYER_TUNING, type BoatTuning } from './ArcadeBoat';

export type AIRacerProfile = {
  laneOffset: number;
  speedScale: number;
  steeringScale: number;
  lookAhead: number;
  personality?: AIRacerPersonality;
};

export type AIRacerPersonality = 'aggressive' | 'clean' | 'erratic';

export class AIRacer extends ArcadeBoat {
  private readonly intent: RaceIntent = { throttle: 1, steer: 0, boost: false };
  private readonly target = new THREE.Vector3();
  private readonly toTarget = new THREE.Vector3();
  private readonly aiForward = new THREE.Vector3();
  private readonly toOther = new THREE.Vector3();
  private readonly otherForward = new THREE.Vector3();
  private readonly tuning: BoatTuning;
  readonly personality: AIRacerPersonality;
  readonly avoidanceStrength: number;

  constructor(
    id: string,
    color: THREE.ColorRepresentation,
    readonly profile: AIRacerProfile,
    model?: Object3D,
  ) {
    super(id, color, model);
    this.personality = profile.personality ?? (id === 'coral' ? 'aggressive' : id === 'cyan' ? 'clean' : 'erratic');
    this.avoidanceStrength = this.personality === 'clean' ? 1.25 : this.personality === 'aggressive' ? 0.68 : 0.9;
    this.tuning = {
      ...DEFAULT_PLAYER_TUNING,
      maxForwardSpeed: DEFAULT_PLAYER_TUNING.maxForwardSpeed * profile.speedScale,
      boostedMaxSpeed: DEFAULT_PLAYER_TUNING.boostedMaxSpeed * 0.9 * profile.speedScale,
      turnRate: DEFAULT_PLAYER_TUNING.turnRate * profile.steeringScale,
      boostDrain: 0,
      boostRecharge: 0,
    };
  }

  update(
    delta: number,
    elapsed: number,
    track: RaceTrack,
    waves: WaveSurface,
    ownRaceScore: number,
    playerRaceScore: number,
    nextCheckpointIndex: number,
    canDrive: boolean,
  ): void {
    const projection = track.project(this.group.position);
    const personalityLookAhead = this.personality === 'clean' ? 1.12 : this.personality === 'aggressive' ? 0.9 : 0.98;
    const lookAhead =
      this.profile.lookAhead * personalityLookAhead * track.definition.ai.lookAheadScale + Math.min(0.025, Math.abs(this.speed) * 0.00075);
    const lineVariation = this.personality === 'erratic'
      ? Math.sin(elapsed * 0.72 + this.id.length * 1.91) * 0.95
      : this.personality === 'aggressive'
        ? Math.sin(elapsed * 0.24 + 0.7) * 0.16
        : 0;
    const avoidanceOffset = this.calculateAvoidanceOffset(projection.right);
    const preferenceIndex = this.id === 'coral' ? 0 : this.id === 'cyan' ? 1 : 2;
    const authoredLane = track.definition.ai.preferredLines[preferenceIndex] ?? this.profile.laneOffset;
    const desiredLane = THREE.MathUtils.clamp(
      authoredLane + lineVariation + avoidanceOffset,
      -track.halfWidth * 0.62,
      track.halfWidth * 0.62,
    );
    track.getOffsetPoint(projection.progress + lookAhead, desiredLane, this.target);
    // The racing line remains the default, but the next legal sensor becomes
    // the short-range aim point. This prevents a spline projection ambiguity
    // near Sunset's crossing-like S-bend from making AI loop past one hidden
    // sector forever, while retaining personalities and authored lanes over
    // the rest of the course.
    const expectedCheckpoint = track.getCheckpoint(nextCheckpointIndex);
    const checkpointDelta = (expectedCheckpoint.definition.progress - projection.progress + 1) % 1;
    if (checkpointDelta < 0.14) this.target.copy(expectedCheckpoint.center);
    this.toTarget.copy(this.target).sub(this.group.position).setY(0);
    const desiredHeading = Math.atan2(this.toTarget.x, -this.toTarget.z);
    const headingError = Math.atan2(Math.sin(desiredHeading - this.heading), Math.cos(desiredHeading - this.heading));
    const targetSteer = THREE.MathUtils.clamp(
      headingError * (this.personality === 'clean' ? 2.05 : this.personality === 'aggressive' ? 2.52 : 2.68),
      -1,
      1,
    );
    this.intent.steer = THREE.MathUtils.damp(
      this.intent.steer,
      targetSteer,
      this.personality === 'clean' ? 7.2 : this.personality === 'aggressive' ? 10.5 : 5.8,
      delta,
    );

    const curvature = track.curvatureAt(projection.progress + lookAhead * 0.65);
    const cornerCaution = this.personality === 'clean' ? 0.0125 : this.personality === 'aggressive' ? 0.0095 : 0.0115;
    const cornerFloor = this.personality === 'clean' ? 0.65 : this.personality === 'aggressive' ? 0.72 : 0.62;
    const cornerThrottle = THREE.MathUtils.clamp(1.06 - curvature * cornerCaution, cornerFloor, 1);
    const rubberBand = THREE.MathUtils.clamp((playerRaceScore - ownRaceScore) * 0.085, -0.055, 0.115);
    const rhythm = this.personality === 'erratic' ? Math.sin(elapsed * 1.17 + 2.4) * 0.045 : 0;
    const aggression = this.personality === 'aggressive' ? 0.035 : this.personality === 'clean' ? -0.01 : 0;
    this.intent.throttle = THREE.MathUtils.clamp((cornerThrottle + rubberBand + rhythm + aggression) * track.definition.ai.speedScale, 0.54, 1);
    const deficit = playerRaceScore - ownRaceScore;
    const boostThreshold = this.personality === 'aggressive' ? 0.1 : this.personality === 'clean' ? 0.34 : 0.2;
    const erraticBoostWindow = this.personality !== 'erratic' || Math.sin(elapsed * 0.91 + 1.2) > -0.25;
    this.intent.boost = deficit > boostThreshold && curvature < 18 && erraticBoostWindow;

    const originalMax = this.tuning.maxForwardSpeed;
    this.tuning.maxForwardSpeed = originalMax * (1 + rubberBand);
    this.drive(delta, this.intent, this.tuning, canDrive);
    this.tuning.maxForwardSpeed = originalMax;
    this.updateWaterPose(delta, elapsed, waves);
  }

  private calculateAvoidanceOffset(trackRight: THREE.Vector3): number {
    let offset = 0;
    this.getForward(this.aiForward);
    for (const other of ArcadeBoat.getActiveBoats()) {
      if (other === this) continue;
      this.toOther.copy(other.group.position).sub(this.group.position).setY(0);
      const distanceSq = this.toOther.lengthSq();
      if (distanceSq > 81 || distanceSq < 0.0001) continue;

      const forwardDistance = this.toOther.dot(this.aiForward);
      if (forwardDistance < -1.25 || forwardDistance > 9) continue;
      other.getForward(this.otherForward);
      const closingBias = THREE.MathUtils.clamp(
        (this.velocity.dot(this.aiForward) - other.velocity.dot(this.aiForward)) / 16 + 0.28,
        0.15,
        1,
      );
      const lateralDistance = this.toOther.dot(trackRight);
      const deterministicSide = this.id < other.id ? -1 : 1;
      const passSide = Math.abs(lateralDistance) < 0.3 ? deterministicSide : -Math.sign(lateralDistance);
      const proximity = 1 - THREE.MathUtils.clamp(Math.sqrt(distanceSq) / 9, 0, 1);
      const headingCompatibility = THREE.MathUtils.clamp((this.aiForward.dot(this.otherForward) + 1) * 0.5, 0.2, 1);
      offset += passSide * proximity * closingBias * headingCompatibility * 3.2 * this.avoidanceStrength;
    }
    return THREE.MathUtils.clamp(offset, -2.5, 2.5);
  }
}
