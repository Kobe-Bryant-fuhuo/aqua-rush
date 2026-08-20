import { expect, test } from '@playwright/test';
import * as THREE from 'three';
import {
  TRACK_CATALOG,
  TRACK_IDS,
  getTrackDefinition,
  makeRaceConfig,
} from '../src/game/ContentCatalog';
import { RaceManager, type RacerFrame } from '../src/game/RaceManager';
import { RaceTrack } from '../src/game/Track';

const EXPECTED_TRACK_IDS = ['sunset-circuit', 'storm-reef'] as const;

test.describe('V3 content and directional checkpoint contracts', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'Pure data and geometry contracts only need one JavaScript runtime.',
    );
  });

  test('catalog contains exactly two complete courses and exactly two interaction families', () => {
    expect([...TRACK_IDS].sort()).toEqual([...EXPECTED_TRACK_IDS].sort());
    expect(Object.keys(TRACK_CATALOG).sort()).toEqual([...EXPECTED_TRACK_IDS].sort());

    const interactionFamilies = new Set<string>();
    for (const trackId of EXPECTED_TRACK_IDS) {
      const definition = getTrackDefinition(trackId);
      expect(definition.id).toBe(trackId);
      expect(definition.displayName).toBe(definition.name);
      expect(definition.width).toBe(definition.halfWidth * 2);
      expect(definition.lapCount).toBe(3);
      expect(definition.spawnGrid).toHaveLength(4);
      expect(new Set(definition.spawnGrid.map((slot) => `${slot.progress}:${slot.lane}`)).size).toBe(4);
      expect(definition.markerPreset).toMatch(/race|warning/);
      expect(definition.landmarks.length).toBeGreaterThanOrEqual(2);
      expect(definition.environmentPreset).toBe(definition.environment);
      expect(definition.wavePreset).toBe(definition.waves);
      expect(definition.environment.ambiencePreset).toMatch(/sunset|storm/);
      expect(definition.timeTrialTargets.gold).toBeLessThan(definition.timeTrialTargets.silver);
      expect(definition.timeTrialTargets.silver).toBeLessThan(definition.timeTrialTargets.bronze);
      expect(definition.controlPoints.length).toBeGreaterThanOrEqual(12);
      expect(definition.checkpoints, `${trackId} must have the locked 12-sector lap`).toHaveLength(12);
      expect(new Set(definition.checkpoints.map((checkpoint) => checkpoint.id)).size).toBe(12);
      expect(definition.checkpoints.filter((checkpoint) => checkpoint.visible)).toHaveLength(6);
      expect(definition.checkpoints.at(-1)).toMatchObject({ role: 'finish', progress: 0 });
      expect(definition.checkpoints.slice(0, -1).some((checkpoint) => checkpoint.role === 'anti-cut')).toBe(true);
      expect(definition.interactions.length).toBeGreaterThanOrEqual(2);
      for (const interaction of definition.interactions) interactionFamilies.add(interaction.kind);

      expect(makeRaceConfig('quick-race', trackId)).toEqual({
        mode: 'quick-race',
        trackId,
        totalLaps: 3,
        aiCount: 3,
      });
      expect(makeRaceConfig('time-trial', trackId)).toEqual({
        mode: 'time-trial',
        trackId,
        totalLaps: 3,
        aiCount: 0,
      });
    }

    expect([...interactionFamilies].sort()).toEqual(['boost-gate', 'drift-gate']);
  });

  for (const trackId of EXPECTED_TRACK_IDS) {
    test(`${trackId}: oriented gate accepts only a legal swept crossing`, () => {
      const track = new RaceTrack(getTrackDefinition(trackId));
      const gate = track.getCheckpoint(0);
      const legalVelocity = gate.normal.clone().multiplyScalar(8);

      const behind = gate.center.clone().addScaledVector(gate.normal, -2);
      const ahead = gate.center.clone().addScaledVector(gate.normal, 2);
      const legal = track.validateCheckpointCrossing(0, behind, ahead, legalVelocity);
      expect(legal).toMatchObject({ valid: true, reason: 'valid' });
      expect(legal.direction).toBeGreaterThan(0.8);
      expect(legal.lateral).toBeLessThan(0.01);
      expect(legal.vertical).toBeLessThan(0.01);

      const reverse = track.validateCheckpointCrossing(
        0,
        ahead,
        behind,
        gate.normal.clone().multiplyScalar(-8),
      );
      expect(reverse).toMatchObject({ valid: false, reason: 'reverse' });

      const outside = gate.right.clone().multiplyScalar(gate.halfWidth + 0.5);
      const side = track.validateCheckpointCrossing(
        0,
        behind.clone().add(outside),
        ahead.clone().add(outside),
        legalVelocity,
      );
      expect(side).toMatchObject({ valid: false, reason: 'side' });
      expect(side.lateral).toBeGreaterThan(gate.halfWidth);

      const above = new THREE.Vector3(0, gate.height + 0.5, 0);
      const vertical = track.validateCheckpointCrossing(
        0,
        behind.clone().add(above),
        ahead.clone().add(above),
        legalVelocity,
      );
      expect(vertical).toMatchObject({ valid: false, reason: 'height' });
      expect(vertical.vertical).toBeGreaterThan(gate.height);

      const noCrossing = track.validateCheckpointCrossing(
        0,
        gate.center.clone().addScaledVector(gate.normal, -4),
        gate.center.clone().addScaledVector(gate.normal, -1),
        legalVelocity,
      );
      expect(noCrossing).toMatchObject({ valid: false, reason: 'no-crossing' });

      const tooSlow = track.validateCheckpointCrossing(
        0,
        behind,
        ahead,
        gate.normal.clone().multiplyScalar(0.5),
      );
      expect(tooSlow).toMatchObject({ valid: false, reason: 'too-slow' });
    });

    test(`${trackId}: race manager rejects an out-of-order gate and accepts the complete ordered three-lap route`, () => {
      const track = new RaceTrack(getTrackDefinition(trackId));
      const race = new RaceManager([{ id: 'player', name: 'YOU', isPlayer: true }]);
      const firstPosition = track.getPointAt(0.02);
      const frame: RacerFrame = {
        id: 'player',
        position: firstPosition.clone(),
        velocity: track.getTangentAt(0.02).multiplyScalar(8),
      };
      race.startImmediately([frame], track);
      race.consumeEvents();

      const laterGate = track.getCheckpoint(1);
      frame.position.copy(laterGate.center).addScaledVector(laterGate.normal, -2);
      frame.velocity.copy(laterGate.normal).multiplyScalar(8);
      race.update(1 / 60, [frame], track);
      frame.position.copy(laterGate.center).addScaledVector(laterGate.normal, 2);
      race.update(1 / 60, [frame], track);
      expect(race.getState('player')).toMatchObject({ nextCheckpoint: 0, checkpointCount: 0, lap: 0 });

      // Restart the real session at a stable point immediately after the finish
      // plane, then follow the authored curve in small legal swept segments.
      const initialProgress = new Map<string, number>([['player', 0.02]]);
      race.reset(initialProgress);
      frame.position.copy(track.getPointAt(0.02));
      frame.velocity.copy(track.getTangentAt(0.02)).multiplyScalar(8);
      race.startImmediately([frame], track);
      race.consumeEvents();

      const stepsPerLap = 480;
      const laps = 3;
      for (let step = 1; step <= stepsPerLap * laps && race.phase !== 'finished'; step += 1) {
        const progress = 0.02 + step / stepsPerLap;
        const nextPosition = track.getPointAt(progress);
        frame.velocity.copy(nextPosition).sub(frame.position).normalize().multiplyScalar(8);
        frame.position.copy(nextPosition);
        race.update(1 / 60, [frame], track);
      }

      const finished = race.getState('player');
      expect(finished.finished).toBe(true);
      expect(finished.lap).toBe(3);
      expect(finished.checkpointCount).toBe(track.checkpointPlanes.length * 3);
      expect(finished.nextCheckpoint).toBe(0);
      expect(race.phase).toBe('finished');
      expect(race.validation.accepted).toBe(track.checkpointPlanes.length * 3);
    });
  }
});
