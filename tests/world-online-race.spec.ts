import { test, expect } from '@playwright/test';
import { OnlineSimulation, type AppliedInput } from '../src/shared/OnlineSimulation';
import { TRACK_IDS } from '../src/game/ContentCatalog';
import { pilot } from './online/pilot';

test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop-chrome', 'Deterministic server simulation runs once.'));

for (const id of TRACK_IDS) test(`${id}: four human-input pilots finish the authoritative physical race`, () => {
  const players = Array.from({ length: 4 }, (_, slot) => ({ id: 'p' + slot, name: 'Pilot ' + slot, slot, ready: true, connected: true, dnf: false }));
  const simulation = new OnlineSimulation(id, players);
  const inputs = new Map<string, AppliedInput>();
  try {
    for (let tick = 1; tick <= 60 * 220 && simulation.race.phase !== 'finished'; tick++) {
      if (tick % 3 === 0) for (const [slot, racer] of simulation.snapshot().racers.entries()) {
        inputs.set(racer.id, { seq: tick, intent: pilot(simulation.track, racer, slot, simulation.elapsed) });
      }
      simulation.step(inputs);
    }
    const states = simulation.snapshot().racers.map(r => ({ ...r.race, position: r.body.position }));
    expect(states.every(r => r.finished && r.checkpointCount === 36), JSON.stringify(states)).toBe(true);
  } finally { simulation.dispose(); }
});
