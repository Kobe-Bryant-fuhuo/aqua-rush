import type { Object3D } from 'three';
import type { InputController, RaceIntent } from '../core/InputController';
import type { WaveSurface } from '../systems/WaveSurface';
import { ArcadeBoat, DEFAULT_PLAYER_TUNING, type BoatTuning } from './ArcadeBoat';

export type PlayerTuning = BoatTuning;

export class Player extends ArcadeBoat {
  private readonly intent: RaceIntent = { throttle: 0, steer: 0, boost: false };

  constructor(model?: Object3D) {
    super('player', '#ffcc32', model);
  }

  update(
    delta: number,
    elapsed: number,
    input: InputController,
    tuning: PlayerTuning = DEFAULT_PLAYER_TUNING,
    waves: WaveSurface,
    canDrive: boolean,
  ): void {
    input.readRaceIntent(this.intent);
    this.drive(delta, this.intent, tuning, canDrive);
    this.updateWaterPose(delta, elapsed, waves);
  }
}
