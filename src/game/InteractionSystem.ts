import * as THREE from 'three';
import type { ArcadeBoat } from '../entities/ArcadeBoat';
import type { InteractionDefinition, InteractionKind } from './ContentCatalog';
import type { RaceTrack } from './Track';

export type InteractionPhase = 'ready' | 'feedback' | 'cooldown';
export type InteractionOutcome = 'none' | 'success' | 'failure';

export type InteractionState = {
  id: string;
  kind: InteractionKind;
  center: THREE.Vector3;
  phase: InteractionPhase;
  outcome: InteractionOutcome;
  cooldownRemaining: number;
  activationCount: number;
  failureCount: number;
};

export type InteractionEvent = {
  gateId: string;
  racerId: string;
  kind: InteractionKind;
  outcome: Exclude<InteractionOutcome, 'none'>;
};

type GateRuntime = InteractionState & {
  definition: InteractionDefinition;
  overlap: Set<string>;
  feedbackRemaining: number;
};

/** Production interaction truth. Visuals only consume snapshots from this system. */
export class InteractionSystem {
  private readonly gates: GateRuntime[];
  private readonly events: InteractionEvent[] = [];
  private readonly delta = new THREE.Vector3();

  constructor(track: RaceTrack) {
    this.gates = track.definition.interactions.map((definition) => ({
      id: definition.id,
      kind: definition.kind,
      definition,
      center: track.getOffsetPoint(definition.progress, definition.lateralOffset),
      phase: 'ready',
      outcome: 'none',
      cooldownRemaining: 0,
      activationCount: 0,
      failureCount: 0,
      overlap: new Set<string>(),
      feedbackRemaining: 0,
    }));
  }

  reset(): void {
    this.events.length = 0;
    for (const gate of this.gates) {
      gate.phase = 'ready';
      gate.outcome = 'none';
      gate.cooldownRemaining = 0;
      gate.feedbackRemaining = 0;
      gate.activationCount = 0;
      gate.failureCount = 0;
      gate.overlap.clear();
    }
  }

  update(deltaSeconds: number, boats: readonly ArcadeBoat[], enabled: boolean): void {
    for (const gate of this.gates) {
      gate.cooldownRemaining = Math.max(0, gate.cooldownRemaining - deltaSeconds);
      gate.feedbackRemaining = Math.max(0, gate.feedbackRemaining - deltaSeconds);
      if (gate.feedbackRemaining > 0) gate.phase = 'feedback';
      else if (gate.cooldownRemaining > 0) gate.phase = 'cooldown';
      else {
        gate.phase = 'ready';
        gate.outcome = 'none';
      }
      const insideNow = new Set<string>();
      for (const boat of boats) {
        this.delta.copy(boat.group.position).sub(gate.center);
        const inside = Math.abs(this.delta.y) <= 4.5 && this.delta.x * this.delta.x + this.delta.z * this.delta.z <= gate.definition.halfWidth * gate.definition.halfWidth;
        if (!inside) continue;
        insideNow.add(boat.id);
        if (!enabled || gate.overlap.has(boat.id) || gate.cooldownRemaining > 0) continue;
        const success = gate.kind === 'boost-gate' || (boat.drifting && boat.driftQuality >= 0.28);
        gate.outcome = success ? 'success' : 'failure';
        gate.feedbackRemaining = 0.62;
        gate.cooldownRemaining = gate.definition.cooldown;
        if (success) {
          gate.activationCount += 1;
          if (gate.kind === 'boost-gate') boat.restoreBoost(gate.definition.reward);
          else boat.grantMiniBoost(gate.definition.reward);
        } else {
          gate.failureCount += 1;
        }
        this.events.push({ gateId: gate.id, racerId: boat.id, kind: gate.kind, outcome: success ? 'success' : 'failure' });
      }
      gate.overlap = insideNow;
    }
  }

  consumeEvents(): InteractionEvent[] {
    return this.events.splice(0, this.events.length);
  }

  getStates(): InteractionState[] {
    return this.gates.map((gate) => ({
      id: gate.id,
      kind: gate.kind,
      center: gate.center.clone(),
      phase: gate.phase,
      outcome: gate.outcome,
      cooldownRemaining: gate.cooldownRemaining,
      activationCount: gate.activationCount,
      failureCount: gate.failureCount,
    }));
  }
}
