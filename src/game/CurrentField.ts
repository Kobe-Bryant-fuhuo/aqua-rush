import { Vector3 } from 'three';
import type { RaceTrack } from './Track';

export type CurrentDefinition = Readonly<{
  id: string;
  progress: number;
  lateralOffset: number;
  innerRadius: number;
  outerRadius: number;
  speed: number;
  spin: -1 | 1;
}>;

export type CurrentZone = CurrentDefinition & { center: Vector3 };

/** Steady, bounded tangential flow. The core and outer edge exert no force. */
export class CurrentField {
  readonly zones: readonly CurrentZone[];

  constructor(track: RaceTrack) {
    this.zones = (track.definition.currents ?? []).map(spec => ({
      ...spec, center: track.getOffsetPoint(spec.progress, spec.lateralOffset),
    }));
  }

  sample(position: Readonly<{ x: number; z: number }>, target = new Vector3()): Vector3 {
    target.set(0, 0, 0);
    for (const zone of this.zones) {
      const x = position.x - zone.center.x, z = position.z - zone.center.z;
      const radius = Math.hypot(x, z);
      if (radius <= zone.innerRadius || radius >= zone.outerRadius) continue;
      const band = (radius - zone.innerRadius) / (zone.outerRadius - zone.innerRadius);
      const speed = zone.speed * Math.sin(Math.PI * band) ** 2 * zone.spin;
      target.x -= z / radius * speed;
      target.z += x / radius * speed;
    }
    // Overlapping authored fields cannot accidentally stack into an uncontrollable jet.
    return target.clampLength(0, 10);
  }
}
