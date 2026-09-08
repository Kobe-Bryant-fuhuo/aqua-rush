import { expect, test } from '@playwright/test';
import * as THREE from 'three';
import { ArcadeBoat, DEFAULT_PLAYER_TUNING } from '../src/entities/ArcadeBoat';
import { getTrackDefinition } from '../src/game/ContentCatalog';
import { WaveSurface } from '../src/systems/WaveSurface';
import { makeOceanRing } from '../src/assets/OceanGeometry';
import { ROUGH_WAVES, STORM_WAVES } from '../src/systems/SeaStatePresets';

test.describe('racing sea state and seamless geometry', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'desktop-chrome', 'Pure simulation only runs once.');
  });

  for (const trackId of ['breakwater', 'nightfall'] as const) {
    test(trackId + ' keeps normal cruising mostly on the water with visible heave', () => {
      const waves = new WaveSurface(getTrackDefinition(trackId).waves.waves);
      expect(waves.waves).not.toBe(ROUGH_WAVES);
      expect(waves.waves).not.toBe(STORM_WAVES);
      for (const heading of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        const boat = new ArcadeBoat('cruise', 0xffffff, null);
        boat.reset(new THREE.Vector3(), heading);
        boat.updateWaterPose(1, 0, waves);
        let airFrames = 0, maxPitch = 0, maxRoll = 0, minY = Infinity, maxY = -Infinity;
        for (let frame = 1; frame <= 1800; frame++) {
          boat.drive(1 / 60, { throttle: 1, steer: 0, boost: false }, DEFAULT_PLAYER_TUNING, true);
          boat.updateWaterPose(1 / 60, frame / 60, waves);
          airFrames += Number(boat.airborne);
          const state = boat.captureState();
          maxPitch = Math.max(maxPitch, Math.abs(state.numbers.hullPitch));
          maxRoll = Math.max(maxRoll, Math.abs(state.numbers.hullRoll));
          minY = Math.min(minY, boat.group.position.y);
          maxY = Math.max(maxY, boat.group.position.y);
          expect(Number.isFinite(boat.group.position.y)).toBe(true);
        }
        console.log({ trackId, heading, airFraction: airFrames / 1800, maxPitch, maxRoll, heave: maxY - minY });
        expect(airFrames / 1800).toBeLessThan(0.15);
        expect(maxPitch).toBeLessThan(0.4);
        expect(maxRoll).toBeLessThan(0.35);
        expect(maxY - minY).toBeGreaterThan(0.35);
        boat.dispose();
      }
    });
  }

  test('LOD rings have no overlapping interior and share exact boundary vertices', () => {
    const near = new THREE.PlaneGeometry(240, 240, 96, 96).rotateX(-Math.PI / 2);
    const mid = makeOceanRing(240, 680, 96, 8);
    const far = makeOceanRing(680, 1200, 96, 4);
    const boundary = (g: THREE.BufferGeometry, half: number) => {
      const p = g.getAttribute('position');
      const result = new Set<string>();
      for (let i = 0; i < p.count; i++) {
        if (Math.abs(Math.max(Math.abs(p.getX(i)), Math.abs(p.getZ(i))) - half) < 0.001)
          result.add(p.getX(i).toFixed(3) + ':' + p.getZ(i).toFixed(3));
      }
      return [...result].sort();
    };
    expect(boundary(near, 120)).toEqual(boundary(mid, 120));
    expect(boundary(mid, 340)).toEqual(boundary(far, 340));
    for (const [geometry, inner] of [[mid, 120], [far, 340]] as const) {
      const p = geometry.getAttribute('position');
      const index = geometry.index!;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      let minRadius = Infinity, minUpArea = Infinity;
      for (let i = 0; i < index.count; i += 3) {
        a.fromBufferAttribute(p, index.getX(i));
        b.fromBufferAttribute(p, index.getX(i + 1));
        c.fromBufferAttribute(p, index.getX(i + 2));
        const center = a.clone().add(b).add(c).multiplyScalar(1 / 3);
        minRadius = Math.min(minRadius, Math.max(Math.abs(center.x), Math.abs(center.z)));
        minUpArea = Math.min(minUpArea, b.sub(a).cross(c.sub(a)).y);
      }
      expect(minRadius).toBeGreaterThanOrEqual(inner);
      expect(minUpArea).toBeGreaterThan(0);
    }
    near.dispose(); mid.dispose(); far.dispose();
  });
});
