import { CurrentField } from '../game/CurrentField';
import { updateDrafting } from '../shared/RaceDrafting';
import { RaceTrack } from '../game/Track';
import { Vector3 } from 'three';
import { SnapshotInterpolation } from './SnapshotInterpolation';
import { ArcadeBoat, DEFAULT_PLAYER_TUNING } from '../entities/ArcadeBoat';
import { getTrackDefinition, type TrackId } from '../game/ContentCatalog';
import { WaveSurface } from '../systems/WaveSurface';
import { CollisionSystem } from '../systems/CollisionSystem';
import type { BoatState } from '../shared/BoatState';
import type { RaceIntent } from '../shared/RaceIntent';
import { NEUTRAL_INPUT, SIMULATION_STEP, type ClientMessage, type RaceSnapshot } from '../shared/OnlineProtocol';

type PredictedInput = { seq: number; intent: RaceIntent };

export class OnlinePrediction {
  private readonly boat = new ArcadeBoat('prediction', '#ffcc32', null);
  private readonly waves: WaveSurface;
  private readonly track: RaceTrack;
  private readonly collisions = new CollisionSystem();
  private readonly pending: PredictedInput[] = [];
  private readonly correctionOffset = new Vector3();
  readonly interpolation = new SnapshotInterpolation();
  private latest: RaceSnapshot | null = null;
  private receivedAt = 0;
  private sequence = 0;
  private accumulator = 0;
  private recovery = -1;
  private predictedElapsed = 0;
  correction = 0;

  constructor(private readonly playerId: string, trackId: TrackId, private readonly matchId: string,
    private readonly send: (message: ClientMessage) => void, private readonly now = () => performance.now()) {
    this.waves = new WaveSurface(getTrackDefinition(trackId).waves.waves);
    this.track = new RaceTrack(getTrackDefinition(trackId));
    this.boat.currentField = new CurrentField(this.track); this.boat.worldMechanics = this.track.mechanics;
  }

  receive(snapshot: RaceSnapshot, now = this.now()): void {
    if (this.latest && snapshot.tick <= this.latest.tick) return;
    const self = snapshot.racers.find((racer) => racer.id === this.playerId);
    if (!self) return;
    this.interpolation.receive(snapshot, now);
    const initialized = this.latest !== null;
    const oldPosition = this.boat.group.position.clone();
    const recovered = this.recovery !== self.recovery;
    this.recovery = self.recovery;
    this.latest = snapshot;
    this.receivedAt = now;
    this.boat.restoreState(self.body);
    this.sequence = Math.max(this.sequence, self.ack);
    const remaining = recovered ? [] : this.pending.filter((input) => input.seq > self.ack);
    this.pending.splice(0, this.pending.length, ...remaining);
    this.predictedElapsed = snapshot.elapsed;
    for (const input of this.pending) this.simulate(input.intent);
    this.correction = oldPosition.distanceTo(this.boat.group.position);
    if (!initialized || recovered || this.correction > 5) this.correctionOffset.set(0, 0, 0);
    else this.correctionOffset.add(oldPosition.sub(this.boat.group.position));
  }

  update(delta: number, intent: RaceIntent, connected: boolean): void {
    if (!this.latest) return;
    this.interpolation.update(this.now());
    this.correctionOffset.multiplyScalar(Math.exp(-12 * delta));
    if (!connected || this.now() - this.receivedAt > 500 || this.latest.phase === 'finished') return;
    this.accumulator += Math.min(delta, 0.1);
    while (this.accumulator >= SIMULATION_STEP) {
      this.accumulator -= SIMULATION_STEP;
      const input = { seq: ++this.sequence, intent: { ...intent } };
      this.pending.push(input);
      if (this.pending.length > 120) this.pending.shift();
      this.simulate(input.intent);
      if (this.sequence % 3 === 0) this.send({ type: 'input', matchId: this.matchId, ...input.intent, seq: input.seq });
    }
  }

  /** Clear held controls immediately when opening a menu or losing browser focus. */
  releaseInput(): void {
    this.sequence += 1;
    this.send({ type: 'input', matchId: this.matchId, seq: this.sequence, ...NEUTRAL_INPUT });
  }

  body(id: string, now = this.now()): BoatState | null {
    if (id === this.playerId) {
      const state = this.boat.captureState();
      state.position = new Vector3(...state.position).add(this.correctionOffset).toArray();
      return state;
    }
    return this.interpolation.body(id, now);
  }

  get elapsed(): number { return this.predictedElapsed; }
  dispose(): void { this.boat.dispose(); }

  private simulate(intent: RaceIntent): void {
    this.predictedElapsed += SIMULATION_STEP;
    const self = this.latest?.racers.find((racer) => racer.id === this.playerId);
    if (self?.dnf) return;
    this.boat.drive(SIMULATION_STEP, intent, DEFAULT_PLAYER_TUNING, this.latest?.phase === 'racing' && !self?.race.finished);
    this.boat.updateWaterPose(SIMULATION_STEP, this.predictedElapsed, this.waves);
    if (this.latest?.phase === 'racing' && !self?.race.finished) this.collisions.resolve([this.boat], this.track, this.predictedElapsed);
    const rivals = (this.latest?.racers ?? []).filter(racer => racer.id !== this.playerId && !racer.race.finished && !racer.dnf).map(racer => {
      const velocity = new Vector3(...racer.body.velocity);
      return { id: racer.id, velocity, position: new Vector3(...racer.body.position)
        .addScaledVector(velocity, Math.min(.25, this.predictedElapsed - this.latest!.elapsed)) };
    });
    updateDrafting(SIMULATION_STEP, this.boat, rivals, this.latest?.phase === 'racing' && !self?.race.finished);
  }
}
