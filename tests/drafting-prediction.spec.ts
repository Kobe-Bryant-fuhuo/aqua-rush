import { test, expect } from '@playwright/test';
import { OnlineSimulation, type AppliedInput } from '../src/shared/OnlineSimulation';
import { OnlinePrediction } from '../src/network/OnlinePrediction';
import { SIMULATION_STEP, type ClientMessage, type RaceSnapshot } from '../src/shared/OnlineProtocol';

test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop-chrome', 'Shared prediction runs once.'));

for (const delay of [0, 50, 100]) test(`draft charge and pullout reconcile with ${delay * 2}ms RTT`, () => {
  const players = ['follower', 'leader'].map((id, slot) => ({ id, slot, name: id, ready: true, connected: true, dnf: false }));
  const simulation = new OnlineSimulation('breakwater', players);
  const tangent = simulation.track.getTangentAt(0), origin = simulation.track.getPointAt(0);
  for (const [index, id] of ['follower', 'leader'].entries()) {
    const boat = simulation.boats.get(id)!;
    boat.reset(origin.clone().addScaledVector(tangent, -24 + index * 12), simulation.track.headingAt(0));
    boat.speed = 22; boat.velocity.copy(tangent).multiplyScalar(22); boat.boost = .1;
  }
  simulation.race.startImmediately([...simulation.boats.values()].map(boat => ({ id: boat.id, position: boat.group.position, velocity: boat.velocity })), simulation.track);
  let tick = 0, now = 0;
  const halfTrip = Math.round(delay / (SIMULATION_STEP * 1000));
  const inputQueue: Array<{ tick: number; message: Extract<ClientMessage, { type: 'input' }> }> = [];
  const snapshotQueue: Array<{ tick: number; snapshot: RaceSnapshot }> = [];
  const inputs = new Map<string, AppliedInput>();
  const prediction = new OnlinePrediction('follower', 'breakwater', 'draft-race', message => {
    if (message.type === 'input') inputQueue.push({ tick: tick + halfTrip, message });
  }, () => now);
  prediction.receive(simulation.snapshot());
  const corrections: number[] = [];
  let charged = false, rewarded = false;
  try {
    for (tick = 1; tick <= 220; tick++) {
      now = tick * SIMULATION_STEP * 1000;
      prediction.update(SIMULATION_STEP, { throttle: 1, steer: tick > 120 && tick < 155 ? .7 : 0, boost: false }, true);
      for (const pending of inputQueue.filter(entry => entry.tick <= tick)) {
        inputs.set('follower', { seq: pending.message.seq, intent: pending.message });
      }
      while (inputQueue[0]?.tick <= tick) inputQueue.shift();
      inputs.set('leader', { seq: tick, intent: { throttle: 1, steer: 0, boost: false } });
      simulation.step(inputs);
      charged ||= simulation.boats.get('follower')!.draftReady;
      rewarded ||= simulation.boats.get('follower')!.skillKind === 4;
      if (tick % 3 === 0) snapshotQueue.push({ tick: tick + halfTrip + (tick % 9 === 0 ? 1 : 0), snapshot: simulation.snapshot() });
      for (let i = snapshotQueue.length - 1; i >= 0; i--) if (snapshotQueue[i].tick <= tick) {
        prediction.receive(snapshotQueue[i].snapshot);
        if (tick > 20) corrections.push(prediction.correction);
        snapshotQueue.splice(i, 1);
      }
    }
    expect(charged).toBe(true); expect(rewarded).toBe(true);
    corrections.sort((a,b) => a-b);
    expect(corrections[Math.floor(corrections.length * .95)]).toBeLessThan(2);
    prediction.receive(simulation.snapshot());
    expect(prediction.body('follower')!.numbers.skillKind).toBe(4);
  } finally { prediction.dispose(); simulation.dispose(); }
});

test('a departed racer cannot charge a predicted draft from its last velocity', () => {
  const players = ['follower', 'leader'].map((id, slot) => ({ id, slot, name: id, ready: true, connected: true, dnf: false }));
  const simulation = new OnlineSimulation('breakwater', players);
  const follower = simulation.boats.get('follower')!, leader = simulation.boats.get('leader')!;
  follower.reset(simulation.track.getPointAt(0), 0); follower.speed = 22; follower.velocity.set(0, 0, -22);
  leader.reset(follower.group.position.clone().setZ(follower.group.position.z - 12), 0); leader.velocity.set(0, 0, -22);
  simulation.race.startImmediately([...simulation.boats.values()].map(boat => ({ id: boat.id, position: boat.group.position, velocity: boat.velocity })), simulation.track);
  simulation.dnf.add('leader');
  const prediction = new OnlinePrediction('follower', 'breakwater', 'draft-race', () => {}, () => 0);
  try {
    prediction.receive(simulation.snapshot());
    for (let i = 0; i < 120; i++) prediction.update(SIMULATION_STEP, { throttle: 1, steer: 0, boost: false }, true);
    expect(prediction.body('follower')!.numbers.draftCharge).toBe(0);
  } finally { prediction.dispose(); simulation.dispose(); }
});
