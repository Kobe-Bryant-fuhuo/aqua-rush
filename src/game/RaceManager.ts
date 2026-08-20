import * as THREE from 'three';
import type { RaceTrack } from './Track';

export type RacePhase = 'countdown' | 'racing' | 'finished';

export type RacerRegistration = {
  id: string;
  name: string;
  isPlayer: boolean;
};

export type RacerFrame = {
  id: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
};

export type RacerRaceState = RacerRegistration & {
  lap: number;
  displayLap: number;
  nextCheckpoint: number;
  checkpointCount: number;
  progress: number;
  distanceFromTrack: number;
  place: number;
  finished: boolean;
  finishTime: number | null;
  wrongWay: boolean;
  currentLapTime: number;
  bestLap: number | null;
  lastLap: number | null;
};

export type RaceEvent =
  | { type: 'countdown'; tick: number }
  | { type: 'start' }
  | { type: 'checkpoint'; racerId: string; checkpoint: number }
  | { type: 'lap'; racerId: string; lap: number }
  | { type: 'racer-finish'; racerId: string; place: number }
  | { type: 'player-finish'; place: number; time: number }
  | { type: 'wrong-way'; racerId: string };

type InternalRaceState = RacerRaceState & {
  previousProgress: number;
  previousPosition: THREE.Vector3;
  wrongWayDuration: number;
  lapStartedAt: number;
};

export type CheckpointValidationStats = {
  accepted: number;
  rejected: number;
  lastReason: string | null;
  lastIndex: number | null;
};

export class RaceManager {
  readonly totalLaps = 3;
  phase: RacePhase = 'countdown';
  countdown = 3;
  raceTime = 0;
  finalPlacement: number | null = null;
  readonly validation: CheckpointValidationStats = { accepted: 0, rejected: 0, lastReason: null, lastIndex: null };

  private readonly states = new Map<string, InternalRaceState>();
  private readonly events: RaceEvent[] = [];
  private readonly tangent = new THREE.Vector3();
  private lastCountdownTick = 4;
  private checkpointCount = 12;

  constructor(registrations: RacerRegistration[]) {
    for (const registration of registrations) {
      this.states.set(registration.id, this.createState(registration, 0));
    }
  }

  reset(initialProgress: ReadonlyMap<string, number>): void {
    this.phase = 'countdown';
    this.countdown = 3;
    this.raceTime = 0;
    this.finalPlacement = null;
    this.events.length = 0;
    this.lastCountdownTick = 4;
    this.validation.accepted = 0;
    this.validation.rejected = 0;
    this.validation.lastReason = null;
    this.validation.lastIndex = null;
    for (const [id, oldState] of this.states) {
      const progress = initialProgress.get(id) ?? 0;
      this.states.set(id, this.createState(oldState, progress));
    }
  }

  startImmediately(frames: RacerFrame[], track: RaceTrack): void {
    this.checkpointCount = track.checkpointPlanes.length;
    this.phase = 'racing';
    this.countdown = 0;
    this.raceTime = 0;
    for (const frame of frames) {
      const state = this.states.get(frame.id);
      if (!state) continue;
      const projection = track.project(frame.position);
      state.progress = projection.progress;
      state.previousProgress = projection.progress;
      state.distanceFromTrack = projection.distance;
      state.previousPosition.copy(frame.position);
    }
    this.events.push({ type: 'start' });
  }

  update(delta: number, frames: RacerFrame[], track: RaceTrack): void {
    this.checkpointCount = track.checkpointPlanes.length;
    if (this.phase === 'countdown') {
      this.countdown = Math.max(0, this.countdown - delta);
      const tick = Math.ceil(this.countdown);
      if (tick > 0 && tick < this.lastCountdownTick) {
        this.lastCountdownTick = tick;
        this.events.push({ type: 'countdown', tick });
      }
      if (this.countdown <= 0) {
        this.phase = 'racing';
        for (const frame of frames) {
          const state = this.states.get(frame.id);
          if (!state) continue;
          const progress = track.project(frame.position).progress;
          state.progress = progress;
          state.previousProgress = progress;
          state.previousPosition.copy(frame.position);
        }
        this.events.push({ type: 'start' });
      }
      this.updateProjections(frames, track, false, delta);
      this.updatePlacements();
      return;
    }

    if (this.phase === 'finished') return;
    this.raceTime += delta;
    this.updateProjections(frames, track, true, delta);
    this.updatePlacements();

    const player = [...this.states.values()].find((state) => state.isPlayer);
    if (player?.finished) {
      this.finalPlacement = player.place;
      this.phase = 'finished';
      this.events.push({ type: 'player-finish', place: player.place, time: this.raceTime });
    }
  }

  getState(id: string): RacerRaceState {
    const state = this.states.get(id);
    if (!state) throw new Error(`Unknown racer: ${id}`);
    return { ...state };
  }

  getAllStates(): RacerRaceState[] {
    return [...this.states.values()]
      .sort((a, b) => a.place - b.place)
      .map((state) => ({ ...state }));
  }

  raceScore(id: string): number {
    const state = this.states.get(id);
    if (!state) return 0;
    return state.lap + state.progress;
  }

  consumeEvents(): RaceEvent[] {
    return this.events.splice(0, this.events.length);
  }

  synchronizeFrame(frame: RacerFrame, track: RaceTrack): void {
    const state = this.states.get(frame.id);
    if (!state) return;
    const projection = track.project(frame.position);
    state.progress = projection.progress;
    state.previousProgress = projection.progress;
    state.previousPosition.copy(frame.position);
    state.distanceFromTrack = projection.distance;
  }

  /** Deterministic QA helper: advances only the required checkpoint sequence. */
  debugPassNextCheckpoint(id: string): void {
    const state = this.states.get(id);
    if (!state || state.finished) return;
    this.passCheckpoint(state);
    this.updatePlacements();
    if (state.isPlayer && state.finished) {
      this.finalPlacement = state.place;
      this.phase = 'finished';
      this.events.push({ type: 'player-finish', place: state.place, time: this.raceTime });
    }
  }

  debugCompleteLap(id: string): void {
    const state = this.states.get(id);
    if (!state || state.finished) return;
    const remaining = this.checkpointCount - state.nextCheckpoint;
    for (let step = 0; step < remaining; step += 1) this.passCheckpoint(state);
    this.updatePlacements();
    if (state.isPlayer && state.finished) {
      this.finalPlacement = state.place;
      this.phase = 'finished';
      this.events.push({ type: 'player-finish', place: state.place, time: this.raceTime });
    }
  }

  debugFinish(id: string): void {
    const state = this.states.get(id);
    if (!state || state.finished) return;
    let safety = this.totalLaps * this.checkpointCount + 1;
    while (!state.finished && safety > 0) {
      this.passCheckpoint(state);
      safety -= 1;
    }
    this.updatePlacements();
    if (state.isPlayer) {
      this.finalPlacement = state.place;
      this.phase = 'finished';
      this.events.push({ type: 'player-finish', place: state.place, time: this.raceTime });
    }
  }

  private updateProjections(frames: RacerFrame[], track: RaceTrack, validate: boolean, delta: number): void {
    for (const frame of frames) {
      const state = this.states.get(frame.id);
      if (!state) continue;
      const projection = track.project(frame.position);
      state.progress = projection.progress;
      state.distanceFromTrack = projection.distance;
      state.currentLapTime = Math.max(0, this.raceTime - state.lapStartedAt);

      track.getTangentAt(projection.progress, this.tangent);
      const forwardVelocity = frame.velocity.dot(this.tangent);
      if (Math.abs(forwardVelocity) > 1.5 && forwardVelocity < -0.8) {
        state.wrongWayDuration += delta;
      } else {
        state.wrongWayDuration = Math.max(0, state.wrongWayDuration - delta * 2.5);
      }
      const nowWrongWay = state.wrongWayDuration > 0.65;
      if (nowWrongWay && !state.wrongWay) this.events.push({ type: 'wrong-way', racerId: state.id });
      state.wrongWay = nowWrongWay;

      if (validate && !state.finished) {
        const stepDistance = state.previousPosition.distanceTo(frame.position);
        if (stepDistance <= 18) {
          const crossing = track.validateCheckpointCrossing(state.nextCheckpoint, state.previousPosition, frame.position, frame.velocity);
          if (crossing.valid) {
            this.validation.accepted += 1;
            this.validation.lastReason = 'accepted';
            this.validation.lastIndex = state.nextCheckpoint;
            this.passCheckpoint(state);
          } else if (crossing.reason !== 'no-crossing') {
            this.validation.rejected += 1;
            this.validation.lastReason = crossing.reason;
            this.validation.lastIndex = state.nextCheckpoint;
          }
        } else {
          this.validation.rejected += 1;
          this.validation.lastReason = 'teleport';
          this.validation.lastIndex = state.nextCheckpoint;
        }
      }
      state.previousProgress = projection.progress;
      state.previousPosition.copy(frame.position);
    }
  }

  private passCheckpoint(state: InternalRaceState): void {
    if (state.finished) return;
    const checkpoint = state.nextCheckpoint;
    state.checkpointCount += 1;
    state.nextCheckpoint += 1;
    this.events.push({ type: 'checkpoint', racerId: state.id, checkpoint });
    if (state.nextCheckpoint < this.checkpointCount) return;

    state.nextCheckpoint = 0;
    state.lap += 1;
    state.lastLap = Math.max(0, this.raceTime - state.lapStartedAt);
    state.bestLap = state.bestLap === null ? state.lastLap : Math.min(state.bestLap, state.lastLap);
    state.lapStartedAt = this.raceTime;
    state.displayLap = Math.min(this.totalLaps, state.lap + 1);
    this.events.push({ type: 'lap', racerId: state.id, lap: state.lap });
    if (state.lap >= this.totalLaps) {
      state.finished = true;
      state.finishTime = this.raceTime;
      state.displayLap = this.totalLaps;
      this.updatePlacements();
      this.events.push({ type: 'racer-finish', racerId: state.id, place: state.place });
    }
  }

  private updatePlacements(): void {
    const ordered = [...this.states.values()].sort((a, b) => {
      if (a.finished && b.finished) return (a.finishTime ?? 0) - (b.finishTime ?? 0);
      if (a.finished) return -1;
      if (b.finished) return 1;
      const aScore = a.lap + a.progress;
      const bScore = b.lap + b.progress;
      return bScore - aScore;
    });
    ordered.forEach((state, index) => {
      state.place = index + 1;
    });
  }

  private createState(registration: RacerRegistration, progress: number): InternalRaceState {
    return {
      ...registration,
      lap: 0,
      displayLap: 1,
      nextCheckpoint: 0,
      checkpointCount: 0,
      progress,
      previousProgress: progress,
      distanceFromTrack: 0,
      place: 1,
      finished: false,
      finishTime: null,
      wrongWay: false,
      wrongWayDuration: 0,
      currentLapTime: 0,
      bestLap: null,
      lastLap: null,
      previousPosition: new THREE.Vector3(),
      lapStartedAt: 0,
    };
  }
}
