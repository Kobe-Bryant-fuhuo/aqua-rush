import { expect, test } from '@playwright/test';
import { OnlinePrediction } from '../src/network/OnlinePrediction';
import { OnlineSimulation } from '../src/shared/OnlineSimulation';
import { SnapshotInterpolation } from '../src/network/SnapshotInterpolation';
import { NEUTRAL_INPUT, type RaceSnapshot } from '../src/shared/OnlineProtocol';

function movingSnapshots() {
  const players = ['self', 'remote'].map((id, slot) => ({ id, name: id, slot, ready: true, connected: true, dnf: false }));
  const simulation = new OnlineSimulation('breakwater', players);
  const template = simulation.snapshot();
  simulation.dispose();
  return (milliseconds: number): RaceSnapshot => {
    const snapshot = structuredClone(template);
    snapshot.tick = Math.round(milliseconds * .06);
    snapshot.elapsed = milliseconds / 1000;
    snapshot.phase = 'racing';
    const body = snapshot.racers.find((racer) => racer.id === 'remote')!.body;
    body.position = [snapshot.elapsed * 10, 0, 0];
    body.velocity = [10, 0, 0];
    body.visualRotation = [snapshot.elapsed * .1, 0, 0];
    return snapshot;
  };
}

for (const hz of [60, 144]) for (const pattern of ['jitter', 'bursts'] as const) {
  test(`remote motion stays continuous through ${pattern} at ${hz} Hz`, async ({}, testInfo) => {
    const make = movingSnapshots();
    let now = 0;
    const prediction = new OnlinePrediction('self', 'breakwater', 'match', () => {}, () => now);
    const queue: Array<{ at: number; snapshot: RaceSnapshot }> = [];
    let delivery = 0;
    for (let stamp = 0; stamp <= 6000; stamp += 50) {
      const jitter = (pattern === 'jitter' ? [0, 35, 5, 25, 0, 15] : [0, 130, 80, 30, 0, 0])[(stamp / 50) % 6];
      delivery = Math.max(delivery, stamp + 50 + jitter);
      queue.push({ at: delivery, snapshot: make(stamp) });
    }
    const jumps: number[] = [];
    const poseJumps: number[] = [];
    const steps: number[] = [];
    let previousX: number | undefined;
    try {
      for (let frame = 0; frame < hz * 6; frame++) {
        now = frame * 1000 / hz;
        prediction.update(1 / hz, NEUTRAL_INPUT, true);
        while (queue[0]?.at <= now) {
          const before = prediction.body('remote');
          prediction.receive(queue.shift()!.snapshot);
          const after = prediction.body('remote')!;
          if (now > 1000 && before) {
            jumps.push(Math.abs(after.position[0] - before.position[0]));
            poseJumps.push(Math.abs(after.visualRotation[0] - before.visualRotation[0]));
          }
        }
        const x = prediction.body('remote')?.position[0];
        if (now > 1000 && x !== undefined && previousX !== undefined) steps.push(x - previousX);
        previousX = x;
      }
      const metrics = { hz, pattern, maxArrivalJump: Math.max(...jumps), maxPoseArrivalJump: Math.max(...poseJumps),
        stalledFrames: steps.filter((step) => step < .00001).length,
        maxFrameDistance: Math.max(...steps), expectedFrameDistance: 10 / hz };
      await testInfo.attach('remote-smoothness', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
      console.log(JSON.stringify(metrics));
      expect(metrics.maxArrivalJump, 'packet arrival must not move the render timeline').toBeLessThan(.00001);
      expect(metrics.maxPoseArrivalJump, 'boat roll/pitch must use the same buffered timeline').toBeLessThan(.00001);
      expect(metrics.stalledFrames, 'ordinary jitter must not freeze a moving opponent').toBe(0);
      expect(metrics.maxFrameDistance).toBeLessThan(10 / hz * 1.15);
    } finally { prediction.dispose(); }
  });
}

test('remote interpolation holds on starvation, restores after suspension and rejects old snapshots', () => {
  const make = movingSnapshots();
  const buffer = new SnapshotInterpolation();
  for (let now = 0; now <= 500; now += 10) {
    if (now % 50 === 0) buffer.receive(make(now), now);
    buffer.update(now);
  }
  expect(buffer.body('remote', 1500)!.position[0]).toBe(5);
  expect(buffer.body('remote', 2500)!.position[0]).toBe(5);
  expect(buffer.diagnostics(2500).starvedMs).toBeGreaterThan(0);
  buffer.receive(make(2500), 2500);
  expect(buffer.body('remote', 2500)!.position[0]).toBe(25);
  buffer.receive(make(100), 2501);
  expect(buffer.body('remote', 2501)!.position[0]).toBe(25);
  expect(buffer.body('missing', 2501)).toBeNull();
});

test('a long queued WebSocket backlog resynchronizes instead of replaying seconds of stale motion', () => {
  const make = movingSnapshots();
  const buffer = new SnapshotInterpolation();
  for (let now = 0; now <= 500; now += 50) {
    buffer.receive(make(now), now);
    buffer.update(now);
  }
  buffer.update(2990);
  for (let stamp = 550; stamp <= 3000; stamp += 50) buffer.receive(make(stamp), 3000);
  const position = buffer.body('remote', 3001)!.position[0];
  expect(position).toBeGreaterThanOrEqual(27.5);
  expect(position).toBeLessThanOrEqual(30);
  expect(buffer.diagnostics(3001).bufferedMs).toBeLessThanOrEqual(250);
});

test('remote recovery teleports once at its buffered timestamp without interpolating across the course', () => {
  const make = movingSnapshots();
  const buffer = new SnapshotInterpolation();
  const displayed: number[] = [];
  for (let now = 0; now <= 1600; now += 10) {
    if (now % 50 === 0) {
      const snapshot = make(now);
      if (now >= 1000) {
        const remote = snapshot.racers.find((racer) => racer.id === 'remote')!;
        remote.recovery = 1;
        remote.body.position[0] = 999;
        remote.body.velocity[0] = 0;
      }
      buffer.receive(snapshot, now);
    }
    displayed.push(buffer.body('remote', now)!.position[0]);
  }
  expect(displayed.every((x) => x <= 10 || x === 999)).toBe(true);
  expect(displayed.at(-1)).toBe(999);
  expect(displayed.filter((x, index) => x === 999 && displayed[index - 1] !== 999)).toHaveLength(1);
});

test('remote pose interpolates the shortest rotation without mutating authoritative snapshots', () => {
  const make = movingSnapshots();
  const buffer = new SnapshotInterpolation();
  const snapshots: RaceSnapshot[] = [];
  for (let stamp = 0; stamp <= 200; stamp += 50) {
    const snapshot = make(stamp);
    const body = snapshot.racers.find((racer) => racer.id === 'remote')!.body;
    const yaw = stamp < 150 ? Math.PI - .1 : -Math.PI + .1;
    body.numbers.heading = yaw;
    body.visualRotation[2] = yaw;
    body.quaternion = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
    snapshots.push(snapshot);
    buffer.receive(snapshot, stamp);
    buffer.update(stamp);
  }
  const original = structuredClone(snapshots);
  const body = buffer.body('remote', 220)!;
  expect(Math.abs(body.numbers.heading)).toBeGreaterThan(3);
  expect(Math.abs(body.visualRotation[2])).toBeGreaterThan(3);
  expect(Math.hypot(...body.quaternion)).toBeCloseTo(1, 8);
  expect(Math.abs(body.quaternion[1])).toBeGreaterThan(.99);
  expect(snapshots).toEqual(original);
});
