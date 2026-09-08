import { Vector3 } from 'three';
import type { RaceTrack } from './Track';
import { routeCurve } from './RouteOptions';

export type RampDefinition = Readonly<{ id: string; progress: number; lateralOffset: number; width: number; length: number; height: number; launch: number }>;
export type BlockDefinition = Readonly<{ id: string; progress: number; lateralOffset: number; width: number; length: number; height: number; onRoute?: boolean; style: 'cliff' | 'building' | 'concrete' | 'ruin' }>;
export type CrossingDefinition = Readonly<{ id: string; progress: number; period: number; offset: number }>;
export type WorldBlock = BlockDefinition & { center: Vector3; forward: Vector3; right: Vector3 };
export type WorldRamp = RampDefinition & { center: Vector3; forward: Vector3; right: Vector3 };
export type CrossingState = { block: WorldBlock; phase: 'open' | 'warning' | 'crossing' | 'clear'; remaining: number };

export class WorldMechanics {
  readonly ramps: WorldRamp[];
  readonly blocks: WorldBlock[];
  constructor(readonly track: RaceTrack) {
    const transform = (spec: { progress: number; lateralOffset: number }) => ({
      center: track.getOffsetPoint(spec.progress, spec.lateralOffset),
      forward: track.getTangentAt(spec.progress), right: track.getRightAt(spec.progress),
    });
    this.ramps = (track.definition.ramps ?? []).map(spec => ({ ...spec, ...transform(spec) }));
    const clearWater = [...track.points, ...(track.definition.routes ?? []).filter(route => route.kind === 'safe').flatMap(route => routeCurve(track, route).getSpacedPoints(48))];
    this.blocks = (track.definition.blocks ?? []).map(spec => ({ ...spec, ...transform(spec) })).filter(block => {
      if (block.onRoute) return true;
      const radius = Math.hypot(block.width, block.length) / 2;
      if (Math.min(...clearWater.map(p => p.distanceTo(block.center))) <= radius + 5) return false;
      // Flight carries momentum past a bend. Keep its landing fan clear as well as the water route.
      return this.ramps.every(ramp => {
        const offset = block.center.clone().sub(ramp.center);
        const along = offset.dot(ramp.forward), across = Math.abs(offset.dot(ramp.right));
        return along < -radius || along > 65 + radius || across > ramp.width / 2 + radius + 12;
      });
    });
  }

  /** A working barge sweeps the racing line after a full warning phase; the right bypass remains open. */
  crossing(spec: CrossingDefinition, time: number): CrossingState {
    const clock = ((time + spec.offset) % spec.period + spec.period) % spec.period;
    const phaseIndex = Math.floor(clock / spec.period * 4);
    const local = (clock / spec.period * 4) % 1;
    const lateralOffset = phaseIndex === 2 ? -26 + 26 * Math.sin(local * Math.PI) : -26;
    return {
      phase: (['open', 'warning', 'crossing', 'clear'] as const)[phaseIndex],
      remaining: spec.period / 4 * (1 - local),
      block: { id: spec.id, progress: spec.progress, lateralOffset, width: 14, length: 9, height: 3.5, style: 'concrete',
        center: this.track.getOffsetPoint(spec.progress, lateralOffset),
        forward: this.track.getTangentAt(spec.progress), right: this.track.getRightAt(spec.progress) },
    };
  }

  crossings(time: number): WorldBlock[] {
    return (this.track.definition.crossings ?? []).map(spec => this.crossing(spec, time).block);
  }

  avoidCrossing(position: Vector3, speed: number, time: number, target: Vector3): void {
    for (const spec of this.track.definition.crossings ?? []) {
      const center = this.track.getPointAt(spec.progress), forward = this.track.getTangentAt(spec.progress);
      const ahead = center.clone().sub(position).dot(forward);
      if (ahead < -7 || ahead > 65 || center.distanceTo(position) > 70) continue;
      const eta = time + Math.max(0, ahead) / Math.max(10, Math.abs(speed));
      const blocked = [-.6, 0, .6].some(margin => this.crossing(spec, eta + margin).block.lateralOffset > -10);
      if (blocked || (ahead < 12 && this.crossing(spec, time).block.lateralOffset > -12)) {
        target.copy(center).addScaledVector(this.track.getRightAt(spec.progress), 17).addScaledVector(forward, 7);
      }
    }
  }
}
