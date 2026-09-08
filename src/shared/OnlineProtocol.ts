import type { RaceIntent } from './RaceIntent';
import { isOnlineTrackId, type TrackId } from '../game/ContentCatalog';
import type { InteractionEvent, InteractionState } from '../game/InteractionSystem';
import type { RaceEvent, RacerRaceState, RacePhase } from '../game/RaceManager';
import type { BoatState } from './BoatState';

export const PROTOCOL_VERSION = 5;
export const SIMULATION_STEP = 1 / 60;
export const SNAPSHOT_INTERVAL_MS = 50;
export const MAX_PLAYERS = 4;
export const RECONNECT_MS = 15_000;
export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;
export const NEUTRAL_INPUT: RaceIntent = { throttle: 0, steer: 0, boost: false };

export type RoomPhase = 'lobby' | 'loading' | 'countdown' | 'racing' | 'results';
export type RoomPlayer = {
  id: string;
  name: string;
  slot: number;
  ready: boolean;
  connected: boolean;
  dnf: boolean;
};
export type RaceSnapshot = {
  tick: number;
  elapsed: number;
  phase: RacePhase;
  countdown: number;
  raceTime: number;
  remaining: number | null;
  racers: Array<{ id: string; ack: number; recovery: number; dnf: boolean; body: BoatState; race: RacerRaceState }>;
  gates: Array<Omit<InteractionState, 'center'> & { center: [number, number, number] }>;
  events: Array<{ id: number; event: RaceEvent | InteractionEvent }>;
};
export type RoomSnapshot = {
  type: 'state';
  code: string;
  hostId: string;
  trackId: TrackId;
  matchId: string;
  phase: RoomPhase;
  players: RoomPlayer[];
  race: RaceSnapshot | null;
};
export type ClientMessage =
  | { type: 'join'; version: number; name: string; token?: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'track'; trackId: TrackId }
  | { type: 'start' }
  | { type: 'loaded'; matchId: string }
  | ({ type: 'input'; matchId: string; seq: number } & RaceIntent)
  | { type: 'recover'; matchId: string }
  | { type: 'rematch' }
  | { type: 'leave' }
  | { type: 'ping'; sentAt: number };
export type ServerMessage = RoomSnapshot
  | { type: 'welcome'; playerId: string; token: string; version: number }
  | { type: 'error'; message: string; fatal?: boolean }
  | { type: 'pong'; sentAt: number };

/** Validate untrusted messages before they reach the room state machine. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'string' || raw.length > 1024) return null;
  let value: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    value = parsed as Record<string, unknown>;
  } catch { return null; }
  const finite = (key: string, min: number, max: number) =>
    typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= min && value[key] <= max;
  const match = () => typeof value.matchId === 'string' && value.matchId.length <= 64;
  switch (value.type) {
    case 'join':
      if (value.version !== PROTOCOL_VERSION || typeof value.name !== 'string' ||
          value.name.trim().length < 1 || value.name.length > 20 || /[\p{Cc}\p{Cf}]/u.test(value.name) ||
          (value.token !== undefined && (typeof value.token !== 'string' || value.token.length > 64))) return null;
      return { type: 'join', version: PROTOCOL_VERSION, name: value.name.trim(), token: value.token as string | undefined };
    case 'ready': return typeof value.ready === 'boolean' ? { type: 'ready', ready: value.ready } : null;
    case 'track': return isOnlineTrackId(value.trackId)
      ? { type: 'track', trackId: value.trackId } : null;
    case 'start': case 'rematch': case 'leave': return { type: value.type };
    case 'loaded': case 'recover': return match() ? { type: value.type, matchId: value.matchId as string } : null;
    case 'input':
      return match() && finite('seq', 1, Number.MAX_SAFE_INTEGER) && Number.isInteger(value.seq) &&
        finite('throttle', -1, 1) && finite('steer', -1, 1) && typeof value.boost === 'boolean'
        ? { type: 'input', matchId: value.matchId as string, seq: value.seq as number,
          throttle: value.throttle as number, steer: value.steer as number, boost: value.boost } : null;
    case 'ping': return finite('sentAt', 0, Number.MAX_SAFE_INTEGER) ? { type: 'ping', sentAt: value.sentAt as number } : null;
    default: return null;
  }
}
