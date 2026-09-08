import { CurrentField } from '../game/CurrentField';
import { updateDrafting } from './RaceDrafting';
import { ArcadeBoat, DEFAULT_PLAYER_TUNING } from '../entities/ArcadeBoat';
import type { RaceIntent } from './RaceIntent';
import { getTrackDefinition, type TrackId } from '../game/ContentCatalog';
import { RaceTrack } from '../game/Track';
import { RaceManager } from '../game/RaceManager';
import { InteractionSystem } from '../game/InteractionSystem';
import { CollisionSystem } from '../systems/CollisionSystem';
import { WaveSurface } from '../systems/WaveSurface';
import { NEUTRAL_INPUT, SIMULATION_STEP, type RaceSnapshot, type RoomPlayer } from './OnlineProtocol';

export type AppliedInput = { intent: RaceIntent; seq: number };

/** Shared arcade rules run headlessly: Object3D is a transform, never a renderer. */
export class OnlineSimulation {
  readonly boats = new Map<string, ArcadeBoat>();
  readonly race: RaceManager;
  readonly track: RaceTrack;
  readonly waves: WaveSurface;
  readonly interactions: InteractionSystem;
  readonly dnf = new Set<string>();
  private readonly collisions = new CollisionSystem();
  private readonly acknowledgements = new Map<string, number>();
  private readonly recoveries = new Map<string, number>();
  private readonly lastRecovery = new Map<string, number>();
  private readonly events: RaceSnapshot['events'] = [];
  private eventSequence = 0;
  private firstFinish: number | null = null;
  tick = 0;

  constructor(trackId: TrackId, players: RoomPlayer[]) {
    const definition = getTrackDefinition(trackId);
    this.track = new RaceTrack(definition);
    this.waves = new WaveSurface(definition.waves.waves);
    this.interactions = new InteractionSystem(this.track);
    // No local player on the server: an individual finish must not end the match.
    this.race = new RaceManager(players.map((p) => ({ id: p.id, name: p.name, isPlayer: false })));
    const progress = new Map<string, number>();
    const currents = new CurrentField(this.track);
    for (const player of players) {
      const boat = new ArcadeBoat(player.id, '#ffcc32', null);
      boat.currentField = currents; boat.worldMechanics = this.track.mechanics;
      const slot = definition.spawnGrid[player.slot];
      const position = this.track.getOffsetPoint(slot.progress, slot.lane);
      boat.reset(position, this.track.headingAt(slot.progress));
      boat.updateWaterPose(1, 0, this.waves);
      this.boats.set(player.id, boat);
      progress.set(player.id, slot.progress);
    }
    this.race.reset(progress);
  }

  get elapsed(): number { return this.tick * SIMULATION_STEP; }

  step(inputs: ReadonlyMap<string, AppliedInput>): void {
    if (this.race.phase === 'finished') return;
    this.tick += 1;
    const racing = this.race.phase === 'racing';
    const active: ArcadeBoat[] = [];
    for (const [id, boat] of this.boats) {
      if (this.dnf.has(id)) continue;
      const input = inputs.get(id);
      this.acknowledgements.set(id, input?.seq ?? this.acknowledgements.get(id) ?? 0);
      const driving = racing && !this.race.getState(id).finished;
      boat.drive(SIMULATION_STEP, input?.intent ?? NEUTRAL_INPUT, DEFAULT_PLAYER_TUNING, driving);
      boat.updateWaterPose(SIMULATION_STEP, this.elapsed, this.waves);
      active.push(boat);
    }
    if (racing) this.collisions.resolve(active, this.track, this.elapsed);
    const rivals = active.filter(boat => !this.race.getState(boat.id).finished)
      .map(boat => ({ id: boat.id, position: boat.group.position, velocity: boat.velocity }));
    for (const boat of active) updateDrafting(SIMULATION_STEP, boat, rivals, racing && !this.race.getState(boat.id).finished);
    this.interactions.update(SIMULATION_STEP, active.filter((boat) => !this.race.getState(boat.id).finished), racing, id => this.race.getState(id).lap);
    this.race.update(SIMULATION_STEP, active.map((boat) => ({
      id: boat.id, position: boat.group.position, velocity: boat.velocity,
    })), this.track);
    for (const event of [...this.race.consumeEvents(), ...this.interactions.consumeEvents()]) {
      this.events.push({ id: ++this.eventSequence, event });
    }
    if (this.events.length > 64) this.events.splice(0, this.events.length - 64);
    const states = this.race.getAllStates();
    if (this.firstFinish === null && states.some((state) => state.finished)) this.firstFinish = this.race.raceTime;
    if (states.every((state) => state.finished || this.dnf.has(state.id)) || this.race.raceTime >= 600 ||
        (this.firstFinish !== null && this.race.raceTime - this.firstFinish >= 60)) {
      for (const state of states) if (!state.finished) this.dnf.add(state.id);
      this.race.phase = 'finished';
    }
  }

  recover(id: string): boolean {
    const boat = this.boats.get(id);
    if (!boat || this.race.phase !== 'racing' || this.dnf.has(id) || this.race.getState(id).finished ||
        this.elapsed - (this.lastRecovery.get(id) ?? -10) < 2) return false;
    const state = this.race.getState(id);
    const checkpoint = this.track.getCheckpoint((state.nextCheckpoint + this.track.checkpointPlanes.length - 1) % this.track.checkpointPlanes.length);
    const position = checkpoint.center.clone().addScaledVector(checkpoint.normal, 2.2);
    // Recovery is positional; it cannot refill boost or advance checkpoint progress.
    const boost = boat.boost;
    boat.reset(position, Math.atan2(checkpoint.normal.x, -checkpoint.normal.z));
    boat.boost = boost;
    boat.updateWaterPose(1, this.elapsed, this.waves);
    this.race.synchronizeFrame({ id, position: boat.group.position, velocity: boat.velocity }, this.track);
    this.lastRecovery.set(id, this.elapsed);
    this.recoveries.set(id, (this.recoveries.get(id) ?? 0) + 1);
    return true;
  }

  snapshot(): RaceSnapshot {
    const states = this.race.getAllStates().sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return (a.finishTime ?? 0) - (b.finishTime ?? 0);
      if (this.dnf.has(a.id) !== this.dnf.has(b.id)) return this.dnf.has(a.id) ? 1 : -1;
      if (a.checkpointCount !== b.checkpointCount) return b.checkpointCount - a.checkpointCount;
      const target = this.track.checkpoints[a.nextCheckpoint];
      return this.track.forwardDistance(a.progress, target) - this.track.forwardDistance(b.progress, target);
    });
    return {
      tick: this.tick, elapsed: this.elapsed, phase: this.race.phase, countdown: this.race.countdown,
      raceTime: this.race.raceTime,
      remaining: this.firstFinish === null ? null : Math.max(0, 60 - this.race.raceTime + this.firstFinish),
      racers: states.map((race, index) => ({
        id: race.id, ack: this.acknowledgements.get(race.id) ?? 0,
        recovery: this.recoveries.get(race.id) ?? 0,
        dnf: this.dnf.has(race.id),
        body: this.boats.get(race.id)!.captureState(), race: { ...race, place: index + 1 },
      })),
      gates: this.interactions.getStates().map((gate) => ({ ...gate, center: gate.center.toArray() })),
      events: [...this.events],
    };
  }

  dispose(): void {
    for (const boat of this.boats.values()) boat.dispose();
    this.boats.clear();
  }
}
