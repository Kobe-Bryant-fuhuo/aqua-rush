import { test, expect } from '@playwright/test';
import { ArcadeBoat, DEFAULT_PLAYER_TUNING } from '../src/entities/ArcadeBoat';
import { TRACK_IDS, getTrackDefinition } from '../src/game/ContentCatalog';
import { RaceTrack } from '../src/game/Track';
import { WaveSurface } from '../src/systems/WaveSurface';
import { CollisionSystem } from '../src/systems/CollisionSystem';

test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop-chrome', 'Pure simulation runs once.'));

for (const id of TRACK_IDS) test(`${id}: ramp launches, air state replays and landing awards exactly one boost`, () => {
  const track = new RaceTrack(getTrackDefinition(id));
  const ramp = track.mechanics.ramps[0];
  const waves = new WaveSurface(track.definition.waves.waves);
  const boat = new ArcadeBoat('jumper', '#ffffff', null);
  const restored = new ArcadeBoat('replay', '#ffffff', null);
  const collisions = new CollisionSystem();
  boat.worldMechanics = restored.worldMechanics = track.mechanics;
  boat.reset(ramp.center.clone().addScaledVector(ramp.forward, -ramp.length / 2 - 10), track.headingAt(ramp.progress));
  boat.speed = 23; boat.velocity.copy(ramp.forward).multiplyScalar(23);
  let peak = 0, airborneFrames = 0, replaying = false, landingBoost = false;
  try {
    for (let tick = 1; tick <= 240; tick++) {
      const intent = { throttle: 1, steer: 0, boost: false };
      boat.drive(1 / 60, intent, DEFAULT_PLAYER_TUNING, true);
      boat.updateWaterPose(1 / 60, tick / 60, waves);
      collisions.resolve([boat], track, tick / 60);
      if (replaying) {
        restored.drive(1 / 60, intent, DEFAULT_PLAYER_TUNING, true);
        restored.updateWaterPose(1 / 60, tick / 60, waves);
        collisions.resolve([restored], track, tick / 60);
        expect(restored.captureState()).toEqual(boat.captureState());
      }
      if (boat.flightActive) {
        airborneFrames++; peak = Math.max(peak, boat.group.position.y);
        if (!replaying && boat.flightTime > .3) { restored.restoreState(boat.captureState()); replaying = true; }
      }
      if (boat.jumps === 1) { landingBoost = boat.captureState().numbers.miniBoostTimer > 0; break; }
    }
    expect(replaying).toBe(true);
    expect(airborneFrames).toBeGreaterThan(45);
    expect(peak).toBeGreaterThan(5);
    expect(boat.jumps).toBe(1);
    expect(landingBoost).toBe(true);
    boat.reset(track.getPointAt(0), track.headingAt(0));
    expect(boat.flightActive).toBe(false);
    expect(boat.jumps).toBe(0);
  } finally { boat.dispose(); restored.dispose(); }
});

test('a warned crossing blocks the racing line while the marked outside lane remains passable', () => {
  const track = new RaceTrack(getTrackDefinition('nightfall'));
  const boat = new ArcadeBoat('test', '#ffffff', null);
  const collisions = new CollisionSystem();
  try {
    for (let time = 0; time < 22; time += .25) {
      for (const gate of track.definition.crossings!) {
        const center = track.getOffsetPoint(gate.progress, 17);
        boat.reset(center, track.headingAt(gate.progress));
        collisions.resolve([boat], track, time);
        expect(boat.group.position.x).toBeCloseTo(center.x, 8);
        expect(boat.group.position.z).toBeCloseTo(center.z, 8);
      }
    }
    const spec = track.definition.crossings![0], crossingTime = spec.period * .625 - spec.offset;
    expect(track.mechanics.crossing(spec, spec.period * .3 - spec.offset).phase).toBe('warning');
    const block = track.mechanics.crossing(spec, crossingTime).block;
    expect(block.center.distanceTo(track.getPointAt(spec.progress))).toBeLessThan(.001);
    boat.reset(block.center, track.headingAt(block.progress));
    collisions.resolve([boat], track, crossingTime);
    expect(boat.group.position.distanceTo(block.center)).toBeGreaterThan(boat.radius);
    boat.reset(block.center.clone().setY(block.height + 2), 0);
    collisions.resolve([boat], track, crossingTime);
    expect(boat.group.position.x).toBeCloseTo(block.center.x, 8);
    expect(boat.group.position.z).toBeCloseTo(block.center.z, 8);
  } finally { boat.dispose(); }
});
