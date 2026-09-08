import { expect, test } from '@playwright/test';
import * as THREE from 'three';
import { RaceTrack } from '../src/game/Track';
import { getTrackDefinition, TRACK_IDS, type TrackId } from '../src/game/ContentCatalog';
import { CurrentField } from '../src/game/CurrentField';
import { routeCurve } from '../src/game/RouteOptions';
import { ArcadeBoat, DEFAULT_PLAYER_TUNING } from '../src/entities/ArcadeBoat';
import { CollisionSystem } from '../src/systems/CollisionSystem';
import { WaveSurface } from '../src/systems/WaveSurface';

test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop-chrome', 'Shared physics only needs one runtime.'));
const track = () => new RaceTrack(getTrackDefinition('sunken-temple'));

test('flow is bounded, tangential and smooth at both edges with an escapable core', () => {
  const field = new CurrentField(track()), zone = field.zones[0];
  for (const radius of [0, zone.innerRadius, zone.outerRadius, zone.outerRadius + 10]) {
    expect(field.sample({ x: zone.center.x + radius, z: zone.center.z }).length()).toBe(0);
  }
  for (let i = 1; i < 200; i++) {
    const radius = zone.innerRadius + (zone.outerRadius - zone.innerRadius) * i / 200;
    const direction = new THREE.Vector3(Math.cos(i), 0, Math.sin(i));
    const flow = field.sample(zone.center.clone().addScaledVector(direction, radius));
    expect(flow.length()).toBeLessThanOrEqual(zone.speed + 1e-9);
    expect(flow.dot(direction)).toBeCloseTo(0, 8);
  }
});

test('a current changes ground motion, not the speed limit through water, and countdown remains stationary', () => {
  const field = new CurrentField(track()), zone = field.zones[0];
  const position = zone.center.clone().add(new THREE.Vector3(0, 0, 22));
  const direction = field.sample(position).normalize();
  const boats = [new ArcadeBoat('flow', 'white', null), new ArcadeBoat('still', 'white', null)];
  try {
    boats[0].currentField = field;
    boats.forEach(b => b.reset(position, Math.atan2(direction.x, -direction.z)));
    boats[0].drive(1 / 60, { throttle: 0, steer: 0, boost: false }, DEFAULT_PLAYER_TUNING, false);
    expect(boats[0].group.position.distanceTo(position)).toBe(0);
    boats.forEach(b => { b.speed = 25; b.velocity.copy(direction).multiplyScalar(25); });
    for (let i = 0; i < 60; i++) for (const b of boats) {
      b.drive(1 / 60, { throttle: 1, steer: 0, boost: false }, DEFAULT_PLAYER_TUNING, true);
    }
    expect(boats[0].group.position.clone().sub(boats[1].group.position).dot(direction)).toBeGreaterThan(3);
    expect(boats[0].speed).toBe(boats[1].speed);
    const restored = new ArcadeBoat('restored', 'white', null);
    restored.currentField = field;
    restored.restoreState(boats[0].captureState());
    expect(restored.waterCurrent.toArray()).toEqual(field.sample(restored.group.position).toArray());
    const intent = { throttle: 1, steer: .2, boost: false };
    restored.drive(1 / 60, intent, DEFAULT_PLAYER_TUNING, true);
    boats[0].drive(1 / 60, intent, DEFAULT_PLAYER_TUNING, true);
    expect(restored.group.position.distanceTo(boats[0].group.position)).toBeLessThan(1e-8);
    restored.dispose();
  } finally { boats.forEach(b => b.dispose()); }
});

test('all optional lines have physical clearance and cross each encountered sector forwards', () => {
  const course = track();
  for (const route of course.definition.routes!) {
    const curve = routeCurve(course, route);
    const points = curve.getSpacedPoints(500);
    for (const rock of course.rocks) {
      expect(Math.min(...points.map(point => point.distanceTo(rock.center))), `${route.id}: ${rock.id}`).toBeGreaterThan(rock.radius + 1.05);
    }
    const start = route.anchors[0][0], end = route.anchors.at(-1)![0];
    course.checkpointPlanes.forEach((gate, index) => {
      if (gate.definition.progress <= start || gate.definition.progress >= end) return;
      let valid = false;
      for (let i = 1; i < points.length; i++) {
        const velocity = points[i].clone().sub(points[i - 1]).normalize().multiplyScalar(20);
        if (course.validateCheckpointCrossing(index, points[i - 1], points[i], velocity).valid) valid = true;
      }
      expect(valid, `${route.id}: sector ${index}`).toBe(true);
    });
  }
});

function driveRoute(id: string, currents: boolean, courseId: TrackId = 'sunken-temple') {
  const course = new RaceTrack(getTrackDefinition(courseId)), route = course.definition.routes!.find(r => r.id === id)!;
  const curve = routeCurve(course, route), points = curve.getSpacedPoints(300);
  const boat = new ArcadeBoat('pilot', 'white', null);
  const waves = new WaveSurface(course.definition.waves.waves), collisions = new CollisionSystem();
  boat.currentField = currents ? new CurrentField(course) : null;
  boat.worldMechanics = course.mechanics;
  const tangent = curve.getTangentAt(0);
  boat.reset(points[0], Math.atan2(tangent.x, -tangent.z));
  boat.speed = 20; boat.velocity.copy(tangent).multiplyScalar(20);
  let time = 0, contacts = 0, maxFlow = 0;
  try {
    for (let tick = 0; tick < 2400; tick++) {
      let nearest = 0, distance = Infinity;
      points.forEach((p, i) => { const d = p.distanceToSquared(boat.group.position); if (d < distance) { distance = d; nearest = i; } });
      if (nearest >= 298) break;
      const target = points[Math.min(300, nearest + Math.ceil(10 / curve.getLength() * 300))];
      const angle = Math.atan2(target.x - boat.group.position.x, -(target.z - boat.group.position.z)) - boat.heading;
      const error = Math.atan2(Math.sin(angle), Math.cos(angle));
      boat.drive(1 / 60, { throttle: Math.abs(error) > .7 && boat.speed > 9 ? -.25 : 1, steer: THREE.MathUtils.clamp(error * 2, -1, 1), boost: false }, DEFAULT_PLAYER_TUNING, true);
      boat.updateWaterPose(1 / 60, time, waves);
      contacts += collisions.resolve([boat], course, time).count;
      maxFlow = Math.max(maxFlow, boat.waterCurrent.length());
      time += 1 / 60;
    }
    return { time, contacts, maxFlow, distance: boat.group.position.distanceTo(points.at(-1)!) };
  } finally { boat.dispose(); }
}

test('ordinary steering completes every marked water bypass without collision or teleport', () => {
  for (const courseId of TRACK_IDS) for (const route of getTrackDefinition(courseId).routes ?? []) {
    if (route.kind !== 'safe') continue;
    const result = driveRoute(route.id, true, courseId);
    expect(result.contacts, JSON.stringify({ id: route.id, ...result })).toBe(0);
    expect(result.distance).toBeLessThan(4);
    expect(result.time).toBeLessThan(20);
  }
});

test('following the current line produces a measurable advantage over the same line without flow', () => {
  const flow = driveRoute('temple-current', true), still = driveRoute('temple-current', false);
  console.log('Current line comparison:', { flow, still, saved: still.time - flow.time });
  expect(flow.maxFlow).toBeGreaterThan(6);
  expect(flow.distance).toBeLessThan(4);
  expect(flow.contacts).toBe(0);
  expect(still.time - flow.time).toBeGreaterThan(.3);
});
