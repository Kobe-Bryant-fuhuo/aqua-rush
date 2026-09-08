import { expect, test } from '@playwright/test';
import * as THREE from 'three';
import { ArcadeBoat, DEFAULT_PLAYER_TUNING } from '../src/entities/ArcadeBoat';
import { SEA_STATES } from '../src/systems/SeaStatePresets';
import { WaveSurface } from '../src/systems/WaveSurface';

test.describe('rough sea dynamics', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'desktop-chrome', 'Deterministic simulation runs once.');
  });

  for (const trackId of ['rough', 'storm'] as const) {
    test(trackId + ': natural launches, heavy re-entry and stable buoyancy', () => {
      const waves = new WaveSurface(SEA_STATES[trackId]);
      const boat = new ArcadeBoat('rough-sea', 0xffffff, null);
      boat.reset(new THREE.Vector3(), 0);
      boat.updateWaterPose(1, 0, waves);
      let airFrames = 0, launches = 0, landings = 0, longestFlight = 0, flight = 0;
      let maxImpact = 0, maxPitch = 0, maxRoll = 0, maxClearance = 0, minDepth = 0;
      for (let step = 1; step <= 1800; step += 1) {
        const wasAirborne = boat.airborne;
        boat.drive(1 / 60, { throttle: 1, steer: 0, boost: false }, DEFAULT_PLAYER_TUNING, true);
        boat.updateWaterPose(1 / 60, step / 60, waves);
        const state = boat.captureState();
        expect(state.position.every(Number.isFinite)).toBe(true);
        const clearance = boat.group.position.y - waves.getHeight(boat.group.position.x, boat.group.position.z, step / 60) - 0.42;
        maxClearance = Math.max(maxClearance, clearance);
        minDepth = Math.min(minDepth, clearance);
        maxPitch = Math.max(maxPitch, Math.abs(state.numbers.hullPitch));
        maxRoll = Math.max(maxRoll, Math.abs(state.numbers.hullRoll));
        if (boat.airborne) { airFrames++; flight++; }
        else { longestFlight = Math.max(longestFlight, flight); flight = 0; }
        if (!wasAirborne && boat.airborne) launches++;
        if (wasAirborne && !boat.airborne && boat.landingIntensity > 0.2) landings++;
        maxImpact = Math.max(maxImpact, boat.landingIntensity);
      }
      console.log(trackId, { launches, landings, airFrames, longestFlight, maxImpact, maxPitch, maxRoll, maxClearance, minDepth, speed: boat.speed });
      expect(launches).toBeGreaterThan(2);
      expect(landings).toBeGreaterThan(2);
      expect(longestFlight / 60).toBeGreaterThan(0.2);
      expect(airFrames / 1800).toBeLessThan(0.65);
      expect(maxClearance).toBeGreaterThan(0.45);
      expect(maxImpact).toBeGreaterThan(0.45);
      expect(maxPitch).toBeGreaterThan(0.15);
      expect(maxRoll).toBeGreaterThan(0.1);
      expect(minDepth).toBeGreaterThan(-1.5);
      boat.dispose();
    });
  }

  test('airborne motion obeys gravity and cannot accelerate or corner like a car', () => {
    const flat = new WaveSurface(new WaveSurface().waves.map(w => ({ ...w, amplitude: 0 })));
    const boat = new ArcadeBoat('freefall', 0xffffff, null);
    boat.reset(new THREE.Vector3(0, 5, 0), 0);
    boat.speed = 20;
    boat.velocity.set(0, 0, -20);
    boat.airborne = true;
    boat.contact = 0;
    for (let step = 1; step <= 24; step++) {
      boat.drive(1 / 60, { throttle: 1, steer: 1, boost: true }, DEFAULT_PLAYER_TUNING, true);
      boat.updateWaterPose(1 / 60, step / 60, flat);
    }
    expect(boat.group.position.y).toBeCloseTo(5 - 0.5 * 12.5 * 0.4 ** 2, 1);
    expect(Math.abs(boat.velocity.x)).toBeLessThan(0.1);
    expect(boat.speed).toBeLessThan(20.3);
    expect(boat.airborne).toBe(true);
    boat.dispose();
  });
});
