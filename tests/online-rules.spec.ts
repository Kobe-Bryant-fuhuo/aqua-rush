import { expect, test } from '@playwright/test';
import { ArcadeBoat, DEFAULT_PLAYER_TUNING } from '../src/entities/ArcadeBoat';
import { RoomSession } from '../server/RoomSession';
import { OnlineSimulation } from '../src/shared/OnlineSimulation';
import { NEUTRAL_INPUT, parseClientMessage, PROTOCOL_VERSION, SIMULATION_STEP, type RoomPlayer } from '../src/shared/OnlineProtocol';

const players: RoomPlayer[] = [0, 1, 2, 3].map((slot) => ({
  id: `racer-${slot}`, name: `Racer ${slot}`, slot, ready: true, connected: true, dnf: false,
}));
function room() {
  let id = 0;
  return new RoomSession('ABCDEFGH', 0, () => `id-${++id}`);
}
function start(session: RoomSession) {
  const a = session.join('First', undefined, 0);
  const b = session.join('Second', undefined, 0);
  session.dispatch(a.playerId, { type: 'ready', ready: true }, 0);
  session.dispatch(b.playerId, { type: 'ready', ready: true }, 0);
  expect(session.dispatch(a.playerId, { type: 'start' }, 0)).toBeNull();
  session.dispatch(a.playerId, { type: 'loaded', matchId: session.matchId }, 0);
  session.dispatch(b.playerId, { type: 'loaded', matchId: session.matchId }, 0);
  return { a, b };
}
function crossNext(simulation: OnlineSimulation, id: string) {
  const boat = simulation.boats.get(id)!;
  const plane = simulation.track.getCheckpoint(simulation.race.getState(id).nextCheckpoint);
  boat.group.position.copy(plane.center).addScaledVector(plane.normal, -2);
  boat.velocity.copy(plane.normal).multiplyScalar(10);
  simulation.race.synchronizeFrame({ id, position: boat.group.position, velocity: boat.velocity }, simulation.track);
  boat.group.position.addScaledVector(plane.normal, 4);
  simulation.race.update(SIMULATION_STEP, [{ id, position: boat.group.position, velocity: boat.velocity }], simulation.track);
}

test('room enforces capacity, host ownership and ready/loading barriers without leaking seat tokens', () => {
  const session = room();
  const seats = players.map((player) => session.join(player.name, undefined, 0));
  expect(() => session.join('Fifth', undefined, 0)).toThrow('full');
  expect(session.dispatch(seats[1].playerId, { type: 'start' }, 0)).toContain('host');
  expect(session.dispatch(seats[0].playerId, { type: 'start' }, 0)).toContain('ready');
  for (const seat of seats) session.dispatch(seat.playerId, { type: 'ready', ready: true }, 0);
  session.dispatch(seats[0].playerId, { type: 'track', trackId: 'breakwater' }, 0);
  expect(session.snapshot().players.every((player) => player.ready)).toBe(true);
  session.dispatch(seats[0].playerId, { type: 'track', trackId: 'nightfall' }, 0);
  expect(session.snapshot().players.every((player) => !player.ready)).toBe(true);
  for (const seat of seats) session.dispatch(seat.playerId, { type: 'ready', ready: true }, 0);
  session.dispatch(seats[0].playerId, { type: 'start' }, 0);
  expect(session.phase).toBe('loading');
  for (const seat of seats.slice(0, 3)) session.dispatch(seat.playerId, { type: 'loaded', matchId: session.matchId }, 0);
  expect(session.phase).toBe('loading');
  session.dispatch(seats[3].playerId, { type: 'loaded', matchId: session.matchId }, 0);
  expect(session.phase).toBe('countdown');
  for (const seat of seats) expect(JSON.stringify(session.snapshot())).not.toContain(seat.token);
  session.simulation?.dispose();
});

test('disconnect transfers lobby management, preserves the seat briefly and never transfers it to an invalid token', () => {
  const session = room();
  const { a, b } = start(session);
  session.disconnect(a.playerId, 100);
  expect(session.hostId).toBe(b.playerId);
  expect(() => session.join('Intruder', 'wrong-token', 200)).toThrow('expired');
  expect(session.join('Ignored rename', a.token, 200).playerId).toBe(a.playerId);
  expect(session.hostId).toBe(b.playerId);
  session.disconnect(a.playerId, 300);
  session.dispatch(b.playerId, { type: 'ping', sentAt: 15_300 }, 15_300);
  session.advance(15_300);
  expect(session.snapshot().players.find((player) => player.id === a.playerId)?.dnf).toBe(true);
  expect(() => session.join('First', a.token, 15_301)).toThrow('expired');
  session.simulation?.dispose();
});

test('old-match and duplicate inputs cannot advance simulation or overwrite controls', () => {
  const session = room();
  const { a } = start(session);
  const input = { type: 'input' as const, matchId: session.matchId, seq: 1, throttle: 1, steer: 0, boost: false };
  session.dispatch(a.playerId, input, 0);
  session.dispatch(a.playerId, { ...input, throttle: -1 }, 0);
  session.dispatch(a.playerId, { ...input, seq: 2, throttle: -1, matchId: 'old-race' }, 0);
  for (let i = 0; i < 100; i += 1) session.dispatch(a.playerId, input, 0);
  expect(session.simulation?.tick).toBe(0);
  expect(session.members.get(a.playerId)?.input.intent.throttle).toBe(1);
  session.advance(50);
  expect(session.simulation?.tick).toBe(3);
  expect(session.simulation?.snapshot().racers.find((racer) => racer.id === a.playerId)?.ack).toBe(1);
  session.simulation?.dispose();
});

test('protocol rejects malformed, non-finite and forged position/finish messages', () => {
  const input = { type: 'input', matchId: 'race', seq: 1, throttle: 1, steer: 0, boost: false };
  expect(parseClientMessage(JSON.stringify(input))).toEqual(input);
  for (const payload of [null, [], { ...input, steer: 2 }, { ...input, seq: 0.5 },
    { ...input, throttle: null }, { type: 'finish', position: 1 }, { type: 'position', x: 100 },
    { type: 'join', version: PROTOCOL_VERSION + 1, name: 'Captain' },
    { type: 'join', version: PROTOCOL_VERSION, name: '\u0000Captain' }]) {
    expect(parseClientMessage(JSON.stringify(payload))).toBeNull();
  }
  expect(parseClientMessage('{"type":"input","matchId":"a","seq":1,"throttle":1e999,"steer":0,"boost":false}')).toBeNull();
});

test('headless state restoration reproduces drifting and wave feedback without registering an AI neighbour', () => {
  const count = ArcadeBoat.getActiveBoats().size;
  const simulation = new OnlineSimulation('nightfall', players.slice(0, 2));
  const boat = simulation.boats.get(players[0].id)!;
  const clone = new ArcadeBoat('clone', '#ffcc32', null);
  const intent = { throttle: 1, steer: 0.68, boost: true };
  for (let step = 0; step < 180; step += 1) {
    boat.drive(SIMULATION_STEP, intent, DEFAULT_PLAYER_TUNING, true);
    boat.updateWaterPose(SIMULATION_STEP, step * SIMULATION_STEP, simulation.waves);
  }
  expect(boat.drifting).toBe(true);
  clone.restoreState(boat.captureState());
  for (let step = 180; step < 240; step += 1) {
    for (const racer of [boat, clone]) {
      racer.drive(SIMULATION_STEP, { ...intent, boost: false }, DEFAULT_PLAYER_TUNING, true);
      racer.updateWaterPose(SIMULATION_STEP, step * SIMULATION_STEP, simulation.waves);
    }
  }
  expect(clone.captureState()).toEqual(boat.captureState());
  expect(ArcadeBoat.getActiveBoats().size).toBe(count);
  clone.dispose();
  simulation.dispose();
});

for (const track of ['breakwater', 'nightfall'] as const) {
  test(`${track}: four racers complete legal three-lap crossings without the first finisher ending the match`, () => {
    const simulation = new OnlineSimulation(track, players);
    simulation.race.startImmediately([...simulation.boats.values()].map((boat) => ({ id: boat.id, position: boat.group.position, velocity: boat.velocity })), simulation.track);
    for (let checkpoint = 0; checkpoint < 36; checkpoint += 1) crossNext(simulation, players[0].id);
    simulation.step(new Map());
    expect(simulation.race.phase).toBe('racing');
    expect(simulation.snapshot().remaining).toBe(60);
    expect(simulation.race.getState(players[1].id).checkpointCount).toBe(0);
    for (const player of players.slice(1)) {
      for (let checkpoint = 0; checkpoint < 36; checkpoint += 1) crossNext(simulation, player.id);
    }
    simulation.step(new Map());
    const result = simulation.snapshot();
    expect(result.phase).toBe('finished');
    expect(result.racers.map((racer) => racer.race.place)).toEqual([1, 2, 3, 4]);
    expect(result.racers.every((racer) => racer.race.checkpointCount === 36 && racer.race.finished)).toBe(true);
    simulation.dispose();
  });
}

test('recovery neither refills boost nor grants checkpoints and is rate limited', () => {
  const simulation = new OnlineSimulation('breakwater', players.slice(0, 2));
  simulation.race.startImmediately([], simulation.track);
  const boat = simulation.boats.get(players[0].id)!;
  boat.boost = 0.12;
  expect(simulation.recover(boat.id)).toBe(true);
  expect(boat.boost).toBe(0.12);
  expect(simulation.race.getState(boat.id).checkpointCount).toBe(0);
  expect(simulation.recover(boat.id)).toBe(false);
  simulation.step(new Map([[boat.id, { intent: NEUTRAL_INPUT, seq: 1 }]]));
  expect(simulation.race.getState(boat.id).checkpointCount).toBe(0);
  simulation.dispose();
});

test('loading and idle rooms time out under a controlled clock', () => {
  const session = room();
  const a = session.join('A', undefined, 0);
  const b = session.join('B', undefined, 0);
  for (const seat of [a, b]) session.dispatch(seat.playerId, { type: 'ready', ready: true }, 0);
  session.dispatch(a.playerId, { type: 'start' }, 0);
  for (const seat of [a, b]) session.dispatch(seat.playerId, { type: 'ping', sentAt: 30_000 }, 30_000);
  session.advance(30_000);
  expect(session.phase).toBe('lobby');
  expect(session.simulation).toBeNull();
  for (const seat of [a, b]) session.dispatch(seat.playerId, { type: 'ping', sentAt: 330_000 }, 330_000);
  session.advance(330_000);
  expect(session.closed).toBe(true);
});

test('loading cancellation preserves reconnectable seats, but explicit departures and expired seats are removed', () => {
  const session = room();
  const a = session.join('A', undefined, 0);
  const b = session.join('B', undefined, 0);
  const begin = (host: string, now: number) => {
    for (const seat of [a, b]) session.dispatch(seat.playerId, { type: 'ready', ready: true }, now);
    expect(session.dispatch(host, { type: 'start' }, now)).toBeNull();
    expect(session.phase).toBe('loading');
  };
  begin(a.playerId, 0);
  session.disconnect(a.playerId, 100);
  expect(session.phase).toBe('lobby');
  expect(session.snapshot().players).toHaveLength(2);
  expect(session.snapshot().players.every((player) => !player.ready)).toBe(true);
  expect(session.join('A', a.token, 200).playerId).toBe(a.playerId);
  begin(b.playerId, 300);
  session.disconnect(a.playerId, 400);
  session.dispatch(b.playerId, { type: 'ping', sentAt: 15_400 }, 15_400);
  session.advance(15_400);
  expect(() => session.join('A', a.token, 15_400)).toThrow('expired');
  expect(session.snapshot().players).toHaveLength(1);
  const c = session.join('C', undefined, 15_400);
  for (const seat of [b, c]) session.dispatch(seat.playerId, { type: 'ready', ready: true }, 15_400);
  session.dispatch(b.playerId, { type: 'start' }, 15_400);
  session.disconnect(c.playerId, 15_401, true);
  expect(session.phase).toBe('lobby');
  expect(session.snapshot().players).toHaveLength(1);
});

test('a finisher keeps the recorded result after leaving or losing connection', () => {
  const session = room();
  const { a, b } = start(session);
  const simulation = session.simulation!;
  simulation.race.startImmediately([], simulation.track);
  session.phase = 'racing';
  for (let checkpoint = 0; checkpoint < 36; checkpoint += 1) crossNext(simulation, a.playerId);
  session.disconnect(a.playerId, 100, true);
  session.dispatch(b.playerId, { type: 'ping', sentAt: 16_000 }, 16_000);
  session.advance(16_000);
  expect(session.snapshot().players.find((player) => player.id === a.playerId)?.dnf).toBe(false);
  expect(simulation.race.getState(a.playerId).finished).toBe(true);
  simulation.dispose();
});
