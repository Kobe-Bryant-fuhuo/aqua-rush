import { CurrentField } from '../src/game/CurrentField';
import { expect, test } from '@playwright/test';
import * as THREE from 'three';
import { TRACK_IDS, getTrackDefinition, isTrackId, isOnlineTrackId } from '../src/game/ContentCatalog';
import { validateTrackDefinition } from '../src/game/TrackValidation';
import { RaceTrack } from '../src/game/Track';
import { RaceManager } from '../src/game/RaceManager';
import { InteractionSystem } from '../src/game/InteractionSystem';
import { ArcadeBoat } from '../src/entities/ArcadeBoat';
import { AIRacer } from '../src/entities/AIRacer';
import { CollisionSystem } from '../src/systems/CollisionSystem';
import { WaveSurface } from '../src/systems/WaveSurface';
import { parseClientMessage } from '../src/shared/OnlineProtocol';

test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop-chrome', 'Headless rules run once.'));

test('content rejects invalid geometry and keeps concept maps out of both catalogs', () => {
  const base = getTrackDefinition('sunken-temple');
  expect(() => validateTrackDefinition({ ...base, controlPoints: [[Infinity, 0]] })).toThrow();
  expect(() => validateTrackDefinition({ ...base, checkpoints: [...base.checkpoints].reverse() })).toThrow();
  expect(() => validateTrackDefinition({ ...base, interactions: [base.interactions[0], base.interactions[0]] })).toThrow();
  for (const id of ['sunset-circuit', 'storm-reef', 'neon-leviathan', 'caldera-throat', 'storm-needle', 'tidal-roulette', 'shipbreaker', 'skyfall-spillway', '__proto__']) {
    expect(isTrackId(id)).toBe(false);
    expect(isOnlineTrackId(id)).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: 'track', trackId: id }))).toBeNull();
  }
  for (const id of TRACK_IDS.filter(id => getTrackDefinition(id).experimental && !isOnlineTrackId(id))) {
    expect(parseClientMessage(JSON.stringify({ type: 'track', trackId: id }))).toBeNull();
  }
});

test('swept rewards are independent per racer and legal lap, even after recovery', () => {
  const track = new RaceTrack();
  const system = new InteractionSystem(track);
  const gate = track.definition.interactions[0];
  const center = track.getOffsetPoint(gate.progress, gate.lateralOffset);
  const normal = track.getTangentAt(gate.progress);
  const boats = ['a', 'b'].map(id => new ArcadeBoat(id, '#ffffff', null));
  let lap = 0;
  const sweep = () => {
    for (const boat of boats) {
      boat.previousPosition.copy(center).addScaledVector(normal, -10);
      boat.group.position.copy(center).addScaledVector(normal, 10);
      boat.boost = .1;
    }
    system.update(1 / 60, boats, true, () => lap);
  };
  try {
    sweep();
    expect(system.consumeEvents().map(e => e.racerId)).toEqual(['a', 'b']);
    expect(boats.every(b => b.boost > .1)).toBe(true);
    expect(system.getStates('a', lap)[0].phase).toBe('feedback');
    expect(system.getStates('spectator', lap)[0].phase).toBe('ready');
    const remote = new InteractionSystem(track);
    remote.applyRemoteStates(system.getStates());
    expect(remote.getStates('a', lap)[0].phase).toBe('feedback');
    expect(remote.getStates('a', lap + 1)[0].phase).toBe('ready');
    boats.forEach(b => b.reset(center, 0));
    sweep();
    expect(system.consumeEvents()).toHaveLength(0);
    lap++;
    sweep();
    expect(system.consumeEvents()).toHaveLength(2);
    system.reset();
    sweep();
    expect(system.consumeEvents()).toHaveLength(2);
  } finally { boats.forEach(b => b.dispose()); }
});

test('failed drift can retry after personal cooldown without stealing another racer reward', () => {
  const track = new RaceTrack();
  const system = new InteractionSystem(track);
  const definition = track.definition.interactions.find(g => g.kind === 'drift-gate')!;
  const center = track.getOffsetPoint(definition.progress, definition.lateralOffset);
  const boat = new ArcadeBoat('retry', '#ffffff', null);
  try {
    boat.reset(center, 0);
    system.update(1 / 60, [boat], true, () => 0);
    expect(system.consumeEvents()[0].outcome).toBe('failure');
    boat.reset(center.clone().addScalar(20), 0);
    system.update(definition.cooldown + .1, [boat], true, () => 0);
    expect(system.getStates(boat.id, 0).find(g => g.id === definition.id)!.phase).toBe('ready');
    boat.reset(center, 0);
    boat.drifting = true;
    boat.driftQuality = .5;
    system.update(1 / 60, [boat], true, () => 0);
    expect(system.consumeEvents()[0].outcome).toBe('success');
  } finally { boat.dispose(); }
});

for (const id of TRACK_IDS) {
  test(`${id}: three AI naturally complete all 36 sectors with collisions enabled`, () => {
    const track = new RaceTrack(getTrackDefinition(id));
    const profiles = [
      { id: 'coral', personality: 'aggressive' as const, laneOffset: 1.45, speedScale: .98, steeringScale: 1.05, lookAhead: 14.28 },
      { id: 'cyan', personality: 'clean' as const, laneOffset: -1.45, speedScale: 1.015, steeringScale: .96, lookAhead: 17.22 },
      { id: 'violet', personality: 'erratic' as const, laneOffset: .15, speedScale: .965, steeringScale: 1.1, lookAhead: 13.02 },
    ];
    const boats = profiles.map(p => new AIRacer(p.id, '#ffffff', p, new THREE.Group()));
    const waves = new WaveSurface(track.definition.waves.waves);
    const race = new RaceManager(boats.map(b => ({ id: b.id, name: b.id, isPlayer: false })));
    const interactions = new InteractionSystem(track);
    const collisions = new CollisionSystem();
    const frames = () => boats.map(b => ({ id: b.id, position: b.group.position, velocity: b.velocity }));
    const initial = new Map<string, number>();
    const currents = new CurrentField(track);
    boats.forEach(boat => { boat.currentField = currents; boat.worldMechanics = track.mechanics; });
    boats.forEach((boat, i) => {
      const slot = track.definition.spawnGrid[i];
      boat.reset(track.getOffsetPoint(slot.progress, slot.lane), track.headingAt(slot.progress));
      initial.set(boat.id, slot.progress);
    });
    race.reset(initial);
    race.startImmediately(frames(), track);
    try {
      for (let tick = 0; tick < 60 * 240 && !race.getAllStates().every(s => s.finished); tick++) {
        for (const boat of boats) {
          const state = race.getState(boat.id);
          boat.update(1 / 60, tick / 60, track, waves, race.raceScore(boat.id), race.raceScore('coral'), state.nextCheckpoint, !state.finished);
        }
        collisions.resolve(boats, track, tick / 60);
        interactions.update(1 / 60, boats.filter(b => !race.getState(b.id).finished), true, id => race.getState(id).lap);
        interactions.consumeEvents();
        race.update(1 / 60, frames(), track);
        race.consumeEvents();
      }
      for (const state of race.getAllStates()) {
        expect(state, `${id}: ${JSON.stringify(state)}`).toMatchObject({ finished: true, lap: 3, checkpointCount: 36 });
      }
    } finally { boats.forEach(b => b.dispose()); }
  });

  test(`${id}: spawn, recovery and new scenery leave a navigable center line`, () => {
    const track = new RaceTrack(getTrackDefinition(id));
    for (const slot of track.definition.spawnGrid) {
      const point = track.getOffsetPoint(slot.progress, slot.lane);
      for (const rock of track.rocks) expect(point.distanceTo(rock.center)).toBeGreaterThan(rock.radius + 1.05);
    }
    for (const gate of track.checkpointPlanes) {
      const point = gate.center.clone().addScaledVector(gate.normal, 2.2);
      for (const rock of track.rocks) expect(point.distanceTo(rock.center)).toBeGreaterThan(rock.radius + 1.05);
    }
    for (const rock of track.rocks.filter(r => r.id.startsWith('landmark:'))) {
      expect(track.project(rock.center).distance).toBeGreaterThan(rock.radius + 3);
      expect(Math.max(Math.abs(rock.center.x), Math.abs(rock.center.z)) + rock.radius).toBeLessThan(track.worldHalfExtent);
    }
  });
}
