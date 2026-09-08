import * as THREE from 'three';
import type { ArcadeBoat } from '../entities/ArcadeBoat';
import type { InteractionDefinition, InteractionKind } from './ContentCatalog';
import type { RaceTrack } from './Track';

export type InteractionPhase = 'ready' | 'feedback' | 'cooldown';
export type InteractionOutcome = 'none' | 'success' | 'failure';

export type GateClaim = {
  cooldownRemaining: number;
  racerId: string;
  lap: number;
  outcome: Exclude<InteractionOutcome, 'none'>;
  feedbackRemaining: number;
};

export type InteractionState = {
  claims: GateClaim[];
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

type GateRuntime = Omit<InteractionState, 'claims'> & {
  definition: InteractionDefinition;
  overlap: Set<string>;
  claimByRacer: Map<string, GateClaim>;
  feedbackRemaining: number;
};

/** Production interaction truth. Visuals only consume snapshots from this system. */
export class InteractionSystem {
  private readonly gates: GateRuntime[];
  private readonly events: InteractionEvent[] = [];
  private readonly delta = new THREE.Vector3();
  private readonly segment = new THREE.Vector3();
  private readonly closest = new THREE.Vector3();

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
      claimByRacer: new Map<string, GateClaim>(),
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
      gate.claimByRacer.clear();
    }
  }

  update(deltaSeconds: number, boats: readonly ArcadeBoat[], enabled: boolean, lapFor: (racerId: string) => number): void {
    for (const gate of this.gates) {
      for (const claim of gate.claimByRacer.values()) {
        claim.feedbackRemaining = Math.max(0, claim.feedbackRemaining - deltaSeconds);
        claim.cooldownRemaining = Math.max(0, claim.cooldownRemaining - deltaSeconds);
      }
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
        if (inside) insideNow.add(boat.id);
        // Sweep the actual physics segment, so fast boats cannot skip a narrow reward.
        this.segment.copy(boat.group.position).sub(boat.previousPosition);
        const lengthSq = this.segment.lengthSq();
        const alpha = lengthSq > 0 ? THREE.MathUtils.clamp(
          this.closest.copy(gate.center).sub(boat.previousPosition).dot(this.segment) / lengthSq, 0, 1) : 0;
        this.closest.copy(boat.previousPosition).addScaledVector(this.segment, alpha).sub(gate.center);
        const crossed = Math.abs(this.closest.y) <= 4.5 &&
          this.closest.x ** 2 + this.closest.z ** 2 <= gate.definition.halfWidth ** 2;
        const lap = lapFor(boat.id);
        const previousClaim = gate.claimByRacer.get(boat.id);
        const unavailable = previousClaim?.lap === lap && (previousClaim.outcome === 'success' || previousClaim.cooldownRemaining > 0);
        if ((!inside && !crossed) || !enabled || gate.overlap.has(boat.id) || unavailable) continue;
        const success = gate.kind === 'boost-gate' || (boat.drifting && boat.driftQuality >= 0.28);
        gate.outcome = success ? 'success' : 'failure';
        gate.claimByRacer.set(boat.id, { racerId: boat.id, lap, outcome: gate.outcome, feedbackRemaining: .62, cooldownRemaining: gate.definition.cooldown });
        gate.feedbackRemaining = 0.62;
        gate.cooldownRemaining = gate.definition.cooldown;
        if (success) {
          gate.activationCount += 1;
          if (gate.kind === 'boost-gate') boat.restoreBoost(gate.definition.reward);
          else boat.grantMiniBoost(gate.definition.reward);
          boat.rewardSkill(3, gate.kind === 'drift-gate' ? .08 : 0);
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

  getStates(racerId?: string, lap?: number): InteractionState[] {
    return this.gates.map((gate) => {
      const claim = racerId === undefined ? undefined : gate.claimByRacer.get(racerId);
      const claimed = claim !== undefined && claim.lap === lap && (claim.outcome === 'success' || claim.cooldownRemaining > 0);
      return {
        claims: [...gate.claimByRacer.values()].map(claim => ({ ...claim })),
        id: gate.id,
        kind: gate.kind,
        center: gate.center.clone(),
        phase: racerId === undefined ? gate.phase : claimed ? (claim.feedbackRemaining > 0 ? 'feedback' : 'cooldown') : 'ready',
        outcome: racerId === undefined ? gate.outcome : claimed ? claim.outcome : 'none',
        cooldownRemaining: racerId === undefined ? gate.cooldownRemaining : claimed ? claim.cooldownRemaining : 0,
        activationCount: gate.activationCount,
        failureCount: gate.failureCount,
      };
    });
  }

  /** Presentation-only state from the authoritative room; no rewards are granted here. */
  applyRemoteStates(states: InteractionState[]): void {
    for (const state of states) {
      const gate = this.gates.find((entry) => entry.id === state.id);
      if (gate) {
        const { claims, ...presentation } = state;
        Object.assign(gate, presentation);
        gate.claimByRacer = new Map(claims.map(claim => [claim.racerId, { ...claim }]));
      }
    }
  }
}
