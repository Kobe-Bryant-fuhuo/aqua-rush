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
};

export class AIRacer extends ArcadeBoat {
  private readonly intent: RaceIntent = { throttle: 1, steer: 0, boost: false };
  private readonly target = new THREE.Vector3();
  private readonly toTarget = new THREE.Vector3();
  private readonly tuning: BoatTuning;

  constructor(
    id: string,
    color: THREE.ColorRepresentation,
    readonly profile: AIRacerProfile,
    model?: Object3D,
  ) {
    super(id, color, model);
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
    canDrive: boolean,
  ): void {
    const projection = track.project(this.group.position);
    const lookAhead = this.profile.lookAhead + Math.min(0.025, Math.abs(this.speed) * 0.00075);
    track.getOffsetPoint(projection.progress + lookAhead, this.profile.laneOffset, this.target);
    this.toTarget.copy(this.target).sub(this.group.position).setY(0);
    const desiredHeading = Math.atan2(this.toTarget.x, -this.toTarget.z);
    const headingError = Math.atan2(Math.sin(desiredHeading - this.heading), Math.cos(desiredHeading - this.heading));
    this.intent.steer = THREE.MathUtils.clamp(headingError * 2.35, -1, 1);

    const curvature = track.curvatureAt(projection.progress + lookAhead * 0.65);
    const cornerThrottle = THREE.MathUtils.clamp(1.06 - curvature * 0.011, 0.67, 1);
    const rubberBand = THREE.MathUtils.clamp((playerRaceScore - ownRaceScore) * 0.085, -0.055, 0.115);
    this.intent.throttle = THREE.MathUtils.clamp(cornerThrottle + rubberBand, 0.58, 1);
    this.intent.boost = playerRaceScore - ownRaceScore > 0.22 && curvature < 20;

    const originalMax = this.tuning.maxForwardSpeed;
    this.tuning.maxForwardSpeed = originalMax * (1 + rubberBand);
    this.drive(delta, this.intent, this.tuning, canDrive);
    this.tuning.maxForwardSpeed = originalMax;
    this.updateWaterPose(delta, elapsed, waves);
  }
}
