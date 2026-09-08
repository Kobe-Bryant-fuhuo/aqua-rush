import { OnlineSimulation, type AppliedInput } from '../src/shared/OnlineSimulation';
import { MAX_PLAYERS, NEUTRAL_INPUT, RECONNECT_MS, SIMULATION_STEP,
  type ClientMessage, type RoomPlayer, type RoomSnapshot, type RoomPhase } from '../src/shared/OnlineProtocol';
import { isOnlineTrackId, type TrackId } from '../src/game/ContentCatalog';

type Member = RoomPlayer & {
  token: string;
  loaded: boolean;
  disconnectedAt: number;
  lastSeenAt: number;
  lastInputAt: number;
  input: AppliedInput;
};

/** Transport-independent room rules; callers supply time for deterministic tests. */
export class RoomSession {
  readonly members = new Map<string, Member>();
  phase: RoomPhase = 'lobby';
  trackId: TrackId = 'breakwater';
  hostId = '';
  matchId = '';
  simulation: OnlineSimulation | null = null;
  closed = false;
  private phaseAt: number;
  private lastActivity: number;
  private lastTick: number;
  private accumulator = 0;

  constructor(readonly code: string, now: number, private readonly uuid = () => crypto.randomUUID() as string) {
    this.phaseAt = this.lastActivity = this.lastTick = now;
  }

  join(name: string, token: string | undefined, now: number): { playerId: string; token: string } {
    if (this.closed) throw new Error('This room has expired. Create a new room.');
    if (token) {
      const member = [...this.members.values()].find((entry) => entry.token === token);
      if (!member || member.dnf || now - member.disconnectedAt >= RECONNECT_MS) {
        throw new Error('Your seat expired. Return to the lobby and join a new race.');
      }
      if (member.connected) throw new Error('This seat is already connected.');
      member.connected = true;
      member.lastSeenAt = now;
      member.input.intent = { ...NEUTRAL_INPUT };
      this.transferHost();
      return { playerId: member.id, token: member.token };
    }
    if (this.phase !== 'lobby') throw new Error('This race has already started.');
    if (this.members.size >= MAX_PLAYERS) throw new Error('This room is full (4 racers).');
    const slot = [0, 1, 2, 3].find((candidate) => ![...this.members.values()].some((member) => member.slot === candidate))!;
    const id = this.uuid();
    const member: Member = {
      id, name, slot, token: this.uuid(), ready: false, connected: true, dnf: false,
      loaded: false, disconnectedAt: 0, lastSeenAt: now, lastInputAt: 0,
      input: { intent: { ...NEUTRAL_INPUT }, seq: 0 },
    };
    this.members.set(id, member);
    this.lastActivity = now;
    this.transferHost();
    return { playerId: id, token: member.token };
  }

  dispatch(id: string, message: Exclude<ClientMessage, { type: 'join' }>, now: number): string | null {
    const member = this.members.get(id);
    if (!member?.connected || this.closed) return 'You are no longer in this room.';
    member.lastSeenAt = now;
    if (message.type === 'ping') return null;
    if (message.type !== 'input') this.lastActivity = now;
    switch (message.type) {
      case 'ready':
        if (this.phase !== 'lobby') return 'Ready is only available in the lobby.';
        member.ready = message.ready;
        return null;
      case 'track':
        if (!isOnlineTrackId(message.trackId)) return 'Course unavailable online.';
        if (id !== this.hostId || this.phase !== 'lobby') return 'Only the host can choose a course in the lobby.';
        if (this.trackId === message.trackId) return null;
        this.trackId = message.trackId;
        for (const entry of this.members.values()) entry.ready = false;
        return null;
      case 'start':
        if (id !== this.hostId || this.phase !== 'lobby') return 'Only the host can start from the lobby.';
        if (this.members.size < 2 || [...this.members.values()].some((entry) => !entry.ready || !entry.connected)) {
          return 'At least two connected racers must all be ready.';
        }
        this.simulation?.dispose();
        this.simulation = new OnlineSimulation(this.trackId, this.players());
        this.matchId = this.uuid();
        this.phase = 'loading';
        this.phaseAt = now;
        for (const entry of this.members.values()) {
          entry.loaded = false;
          entry.input = { intent: { ...NEUTRAL_INPUT }, seq: 0 };
        }
        return null;
      case 'loaded':
        if (message.matchId !== this.matchId || this.phase !== 'loading') return null;
        member.loaded = true;
        if ([...this.members.values()].every((entry) => entry.loaded && entry.connected)) {
          this.phase = 'countdown';
          this.lastTick = now;
          this.accumulator = 0;
        }
        return null;
      case 'input':
        if (message.matchId !== this.matchId || member.dnf || (this.phase !== 'racing' && this.phase !== 'countdown')) return null;
        if (message.seq <= member.input.seq || message.seq - member.input.seq > 240) return null;
        member.input = { intent: { throttle: message.throttle, steer: message.steer, boost: message.boost }, seq: message.seq };
        member.lastInputAt = now;
        return null;
      case 'recover':
        if (message.matchId === this.matchId && this.phase === 'racing') this.simulation?.recover(id);
        return null;
      case 'rematch':
        if (id !== this.hostId || this.phase !== 'results') return 'Only the host can return everyone to the lobby after the race.';
        for (const member of this.members.values()) {
          if (!member.connected) this.members.delete(member.id);
        }
        this.returnToLobby(now);
        return null;
      case 'leave':
        this.disconnect(id, now, true);
        return null;
    }
  }

  disconnect(id: string, now: number, intentional = false): void {
    const member = this.members.get(id);
    if (!member || !member.connected) return;
    member.connected = false;
    member.ready = false;
    member.disconnectedAt = now;
    member.input.intent = { ...NEUTRAL_INPUT };
    if (this.phase === 'loading') this.returnToLobby(now);
    if (intentional) {
      if (this.phase === 'lobby') this.members.delete(id);
      else if (!this.simulation?.race.getState(id).finished) {
        member.dnf = true;
        this.simulation?.dnf.add(id);
      }
    }
    this.transferHost();
  }

  advance(now: number): void {
    if (this.closed) return;
    for (const member of [...this.members.values()]) {
      if (member.connected && now - member.lastSeenAt > 10_000) this.disconnect(member.id, now);
      if (!member.connected && now - member.disconnectedAt >= RECONNECT_MS) {
        if (this.phase === 'lobby') this.members.delete(member.id);
        else if (!this.simulation?.race.getState(member.id).finished) {
          member.dnf = true;
          this.simulation?.dnf.add(member.id);
        }
      }
    }
    if (this.phase === 'loading' && now - this.phaseAt >= 30_000) this.returnToLobby(now);
    if ((this.phase === 'lobby' || this.phase === 'results') && now - this.lastActivity >= 300_000) this.closed = true;
    if (this.members.size === 0 || [...this.members.values()].every((entry) => !entry.connected && now - entry.disconnectedAt >= RECONNECT_MS)) {
      this.closed = true;
    }
    if (this.closed) { this.simulation?.dispose(); return; }
    if ((this.phase === 'countdown' || this.phase === 'racing') && this.simulation) {
      // Bound catch-up after runtime stalls so one delayed room cannot monopolize the isolate.
      this.accumulator += Math.min(0.25, Math.max(0, (now - this.lastTick) / 1000));
      const inputs = new Map<string, AppliedInput>();
      for (const member of this.members.values()) {
        inputs.set(member.id, { seq: member.input.seq, intent: member.connected && now - member.lastInputAt < 250
          ? member.input.intent : NEUTRAL_INPUT });
      }
      while (this.accumulator + 1e-9 >= SIMULATION_STEP) {
        this.simulation.step(inputs);
        this.accumulator -= SIMULATION_STEP;
      }
      this.phase = this.simulation.race.phase === 'finished' ? 'results' : this.simulation.race.phase;
      for (const id of this.simulation.dnf) {
        const member = this.members.get(id);
        if (member) member.dnf = true;
      }
      if (this.phase === 'results') this.lastActivity = now;
    }
    this.lastTick = now;
  }

  snapshot(): RoomSnapshot {
    return {
      type: 'state', code: this.code, hostId: this.hostId, trackId: this.trackId, matchId: this.matchId,
      phase: this.phase, players: this.players(), race: this.simulation?.snapshot() ?? null,
    };
  }

  private players(): RoomPlayer[] {
    return [...this.members.values()].map(({ id, name, slot, ready, connected, dnf }) => ({ id, name, slot, ready, connected, dnf }));
  }

  private transferHost(): void {
    if (!this.members.get(this.hostId)?.connected) {
      this.hostId = [...this.members.values()].find((member) => member.connected)?.id ?? '';
    }
  }

  private returnToLobby(now: number): void {
    this.simulation?.dispose();
    this.simulation = null;
    this.phase = 'lobby';
    this.matchId = '';
    this.lastActivity = now;
    for (const member of this.members.values()) {
      member.ready = false;
      member.dnf = false;
      member.loaded = false;
    }
    this.transferHost();
  }
}
