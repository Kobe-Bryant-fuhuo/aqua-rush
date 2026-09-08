import { expect, test } from '@playwright/test';
import { MathUtils, CatmullRomCurve3 } from 'three';
import { ArcadeBoat, DEFAULT_PLAYER_TUNING } from '../src/entities/ArcadeBoat';
import { RaceTrack } from '../src/game/Track';
import { getTrackDefinition, type TrackId } from '../src/game/ContentCatalog';
import { InteractionSystem } from '../src/game/InteractionSystem';
import { CurrentField } from '../src/game/CurrentField';
import { routeCurve } from '../src/game/RouteOptions';
import { WaveSurface } from '../src/systems/WaveSurface';
import { CollisionSystem } from '../src/systems/CollisionSystem';

test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop-chrome', 'Deterministic driving comparison runs once.'));

function driveLine(id: TrackId, start: number, end: number, skilled: boolean, initialTime = 0, bypass = false) {
  const track = new RaceTrack(getTrackDefinition(id));
  const route = track.definition.routes?.find(r => r.id === 'east-crossing-bypass');
  const curve = bypass && route ? routeCurve(track, route)
    : new CatmullRomCurve3(Array.from({ length: 120 }, (_, i) => track.getPointAt(start + (end - start) * i / 119)));
  const points = curve.getSpacedPoints(400), length = curve.getLength();
  const finish = points.at(-1)!, finishNormal = curve.getTangentAt(1);
  const boat = new ArcadeBoat('line-pilot', 'white', null);
  const waves = new WaveSurface(track.definition.waves.waves), collisions = new CollisionSystem(), interactions = new InteractionSystem(track);
  boat.worldMechanics = track.mechanics; boat.currentField = new CurrentField(track);
  const tangent = curve.getTangentAt(0);
  boat.reset(points[0], Math.atan2(tangent.x, -tangent.z)); boat.speed = 22; boat.velocity.copy(tangent).multiplyScalar(22); boat.boost = .12;
  let time = 0, contacts = 0, drifts = 0, previousSkill = 0, peakChain = 0, maxSpeed = 0;
  let furthest = 0;
  const observedSkills = new Set<number>();
  try {
    for (let tick = 0; tick < 60 * 75; tick++) {
      let nearest = 0, distance = Infinity;
      points.forEach((point, i) => {
        if (i < furthest - 15 || i > furthest + 35) return;
        const d = point.distanceToSquared(boat.group.position);
        if (d < distance) { distance = d; nearest = i; }
      });
      furthest = Math.max(furthest, nearest);
      if (furthest > 390 && boat.group.position.distanceTo(finish) < 10 && boat.group.position.clone().sub(finish).dot(finishNormal) >= 0) break;
      const target = points[Math.min(400, nearest + Math.ceil(12 / length * 400))];
      const desired = skilled && boat.flightActive && boat.flightTime > .65
        ? Math.atan2(boat.velocity.x, -boat.velocity.z) : Math.atan2(target.x - boat.group.position.x, -(target.z - boat.group.position.z));
      const angle = desired - boat.heading;
      const error = Math.atan2(Math.sin(angle), Math.cos(angle));
      const steer = MathUtils.clamp(error * 2.2, -1, 1);
      const progress = start + (end - start) * nearest / 400;
      const driftZone = track.definition.interactions.some(gate => gate.kind === 'drift-gate' &&
        Math.min(track.forwardDistance(progress, gate.progress), track.forwardDistance(gate.progress, progress)) < .035);
      const drift = boat.drifting ? Math.abs(error) > .12 && boat.driftCharge < .5 : driftZone && Math.abs(error) > .21 && Math.abs(error) < .65;
      const burst = Math.abs(error) < .12 && boat.boost > .24;
      boat.drive(1 / 60, { throttle: Math.abs(error) > .75 && boat.speed > 10 ? -.25 : 1, steer, boost: burst || (skilled && drift && boat.speed > 13) }, DEFAULT_PLAYER_TUNING, true);
      boat.updateWaterPose(1 / 60, initialTime + time, waves);
      contacts += collisions.resolve([boat], track, initialTime + time).count;
      interactions.update(1 / 60, [boat], true, () => 0); interactions.consumeEvents();
      if (boat.skillSerial !== previousSkill) {
        if (boat.skillKind === 1) drifts++;
        observedSkills.add(boat.skillKind); previousSkill = boat.skillSerial;
      }
      peakChain = Math.max(peakChain, boat.skillChain); maxSpeed = Math.max(maxSpeed, boat.speed);
      time += 1 / 60;
    }
    return { time, contacts, drifts, peakChain, maxSpeed, skills: [...observedSkills], jumps: boat.jumps, distance: boat.group.position.distanceTo(points.at(-1)!) };
  } finally { boat.dispose(); }
}

test('the first dam sequence links drift, ramp and clean landing through ordinary input', () => {
  const basic = driveLine('breakwater', .06, .32, false);
  const skilled = driveLine('breakwater', .06, .32, true);
  console.log('Dam sequence comparison', { basic, skilled, saved: basic.time - skilled.time });
  expect(skilled.distance).toBeLessThan(4);
  expect(skilled.drifts).toBeGreaterThan(0);
  expect(skilled.peakChain).toBeGreaterThanOrEqual(2);
  expect(skilled.contacts).toBe(0);
  expect(skilled.skills).toEqual(expect.arrayContaining([1, 2, 3]));
});

test('crossing choices expose a timed short line and a physically open bypass', () => {
  const bypass = driveLine('nightfall', .155, .265, false, 6, true);
  const open = driveLine('nightfall', .155, .265, false, 0);
  const late = driveLine('nightfall', .155, .265, false, 6);
  console.log('Crossing route comparison', { bypass, open, late });
  expect(bypass.distance).toBeLessThan(4);
  expect(bypass.contacts).toBe(0);
  expect(open.distance).toBeLessThan(4);
  expect(late.distance).toBeLessThan(4);
  expect(bypass.time - open.time).toBeGreaterThan(.3);
  expect(late.time - open.time).toBeGreaterThan(1);
});

test('a full dam lap rewards linking skills and spending the earned boost', () => {
  const basic = driveLine('breakwater', 0, 1, false), skilled = driveLine('breakwater', 0, 1, true);
  console.log('Full lap comparison', { basic, skilled, saved: basic.time - skilled.time });
  expect(skilled.distance).toBeLessThan(4);
  expect(skilled.drifts).toBeGreaterThanOrEqual(2);
  expect(skilled.time).toBeLessThan(basic.time);
  expect(basic.time - skilled.time).toBeGreaterThan(.35);
});
