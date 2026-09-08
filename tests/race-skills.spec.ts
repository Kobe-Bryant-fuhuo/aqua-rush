import { test, expect } from '@playwright/test';
import { Vector3 } from 'three';
import { ArcadeBoat, DEFAULT_PLAYER_TUNING } from '../src/entities/ArcadeBoat';
import { updateDrafting } from '../src/shared/RaceDrafting';

test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop-chrome', 'Shared rules run once.'));

function racer(id = 'pilot') {
  const boat = new ArcadeBoat(id, 'white', null);
  boat.reset(new Vector3(), 0); boat.speed = 24; boat.velocity.set(0, 0, -24); boat.boost = .1;
  return boat;
}

test('a sustained drift earns usable boost on release, chains, and a collision breaks the sequence', () => {
  const boat = racer();
  try {
    for (let repetition = 0; repetition < 2; repetition++) {
      for (let tick = 0; tick < 65; tick++) boat.drive(1 / 60, { throttle: 1, steer: repetition ? -.68 : .68, boost: true }, DEFAULT_PLAYER_TUNING, true);
      const fuel = boat.boost;
      boat.drive(1 / 60, { throttle: 1, steer: 0, boost: false }, DEFAULT_PLAYER_TUNING, true);
      expect(boat.boost - fuel).toBeGreaterThan(.14);
      expect(boat.skillChain).toBe(repetition + 1);
      expect(boat.miniBoosting).toBe(true);
    }
    boat.applyCollision(new Vector3(1, 0, 0), .5);
    expect(boat.skillChain).toBe(0);
    expect(boat.draftReady).toBe(false);
  } finally { boat.dispose(); }
});

test('tapping drift cannot farm a refill and idle recovery is slower than active driving rewards', () => {
  const boat = racer();
  try {
    for (let tick = 0; tick < 60; tick++) boat.drive(1 / 60, { throttle: 1, steer: .7, boost: tick % 2 === 0 }, DEFAULT_PLAYER_TUNING, true);
    expect(boat.skillSerial).toBe(0);
    expect(boat.boost).toBeLessThan(.15);
    boat.flightActive = true; boat.drifting = true; boat.driftCharge = .6;
    boat.drive(1 / 60, { throttle: 1, steer: .7, boost: true }, DEFAULT_PLAYER_TUNING, true);
    expect(boat.drifting).toBe(false);
    expect(boat.driftCharge).toBe(0);
    expect(boat.skillSerial).toBe(0);
  } finally { boat.dispose(); }
});

test('three clean skills cap the stronger boost and the advantage expires with the chain', () => {
  const boat = racer();
  try {
    for (let i = 0; i < 5; i++) boat.rewardSkill(1, .18);
    expect(boat.skillChain).toBe(3);
    for (let i = 0; i < 90; i++) boat.drive(1 / 60, { throttle: 1, steer: 0, boost: true }, DEFAULT_PLAYER_TUNING, true);
    expect(boat.speed).toBeCloseTo(37, 5);
    for (let i = 0; i < 601; i++) boat.drive(1 / 60, { throttle: 1, steer: 0, boost: false }, DEFAULT_PLAYER_TUNING, true);
    expect(boat.skillChain).toBe(0);
    boat.boost = 1;
    for (let i = 0; i < 90; i++) boat.drive(1 / 60, { throttle: 1, steer: 0, boost: true }, DEFAULT_PLAYER_TUNING, true);
    expect(boat.speed).toBeCloseTo(33, 5);
  } finally { boat.dispose(); }
});

test('drafting requires a moving aligned rival, earns a charge, and pays out only on exit', () => {
  const boat = racer();
  const rival = { id: 'leader', position: new Vector3(0, 0, -12), velocity: new Vector3(0, 0, -24) };
  try {
    for (let tick = 0; tick < 80; tick++) updateDrafting(1 / 60, boat, [rival], true);
    expect(boat.draftReady).toBe(true);
    expect(boat.skillChain).toBe(0);
    expect(boat.boost).toBe(.1);
    boat.group.position.x = 5;
    updateDrafting(1 / 60, boat, [rival], true);
    expect(boat.skillKind).toBe(4);
    expect(boat.boost).toBeCloseTo(.26, 6);
    expect(boat.captureState().numbers.miniBoostTimer).toBeGreaterThan(.7);
    for (let tick = 0; tick < 100; tick++) updateDrafting(1 / 60, boat, [rival], true);
    expect(boat.skillSerial).toBe(1);
    boat.reset(new Vector3(), 0);
    expect(boat.skillChain).toBe(0);
    expect(boat.draftCharge).toBe(0);
  } finally { boat.dispose(); }
});

test('opposing, stationary, airborne and disabled racers do not provide a draft', () => {
  const boat = racer();
  try {
    for (const velocity of [new Vector3(), new Vector3(0, 0, 20)]) {
      updateDrafting(2, boat, [{ id: 'other', position: new Vector3(0, 0, -10), velocity }], true);
      expect(boat.draftReady).toBe(false);
    }
    updateDrafting(2, boat, [{ id: 'other', position: new Vector3(0, 4, -10), velocity: new Vector3(0, 0, -20) }], true);
    expect(boat.draftCharge).toBe(0);
    updateDrafting(2, boat, [{ id: 'other', position: new Vector3(0, 0, -10), velocity: new Vector3(0, 0, -20) }], false);
    expect(boat.draftCharge).toBe(0);
  } finally { boat.dispose(); }
});

test('a restored partial draft and skill timer replay the same future inputs', () => {
  const boat = racer(), restored = racer('restored');
  const rival = { id: 'other', position: new Vector3(0, 0, -12), velocity: new Vector3(0, 0, -24) };
  try {
    boat.rewardSkill(1, .1);
    updateDrafting(.8, boat, [rival], true);
    restored.restoreState(boat.captureState());
    for (let tick = 0; tick < 50; tick++) {
      for (const b of [boat, restored]) {
        b.drive(1 / 60, { throttle: 1, steer: tick > 30 ? .7 : 0, boost: false }, DEFAULT_PLAYER_TUNING, true);
        updateDrafting(1 / 60, b, [rival], true);
      }
      expect(restored.captureState()).toEqual(boat.captureState());
      rival.position.z -= 24 / 60;
    }
  } finally { boat.dispose(); restored.dispose(); }
});
