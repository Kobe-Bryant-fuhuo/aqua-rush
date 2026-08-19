import * as THREE from 'three';
import type { ArcadeBoat } from '../entities/ArcadeBoat';
import type { RaceTrack } from '../game/Track';

export type CollisionResult = {
  count: number;
  strongest: number;
};

/** Lightweight deterministic circle/track collision for transform-driven boats. */
export class CollisionSystem {
  private readonly normal = new THREE.Vector3();
  private readonly correction = new THREE.Vector3();

  resolve(boats: ArcadeBoat[], track: RaceTrack): CollisionResult {
    let count = 0;
    let strongest = 0;

    for (const boat of boats) {
      const projection = track.project(boat.group.position);
      const allowed = track.halfWidth - boat.radius * 0.35;
      const outside = Math.abs(projection.signedDistance) - allowed;
      if (outside <= 0) continue;

      const side = Math.sign(projection.signedDistance) || 1;
      this.normal.copy(projection.right).multiplyScalar(-side);
      this.correction.copy(this.normal).multiplyScalar(outside + 0.025);
      boat.group.position.add(this.correction);
      const severity = THREE.MathUtils.clamp(outside * 0.28 + Math.abs(boat.velocity.dot(this.normal)) * 0.08, 0.08, 1);
      boat.applyCollision(this.normal, severity);
      count += 1;
      strongest = Math.max(strongest, severity);
    }

    for (let aIndex = 0; aIndex < boats.length; aIndex += 1) {
      for (let bIndex = aIndex + 1; bIndex < boats.length; bIndex += 1) {
        const a = boats[aIndex];
        const b = boats[bIndex];
        const dx = a.group.position.x - b.group.position.x;
        const dz = a.group.position.z - b.group.position.z;
        const minDistance = a.radius + b.radius;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq >= minDistance * minDistance) continue;

        const distance = Math.sqrt(Math.max(distanceSq, 0.000001));
        if (distanceSq < 0.000001) this.normal.set(aIndex % 2 === 0 ? 1 : -1, 0, 0);
        else this.normal.set(dx / distance, 0, dz / distance);
        const overlap = minDistance - distance;
        a.group.position.addScaledVector(this.normal, overlap * 0.51);
        b.group.position.addScaledVector(this.normal, -overlap * 0.51);
        const relativeSpeed = Math.abs(a.velocity.dot(this.normal) - b.velocity.dot(this.normal));
        const severity = THREE.MathUtils.clamp(relativeSpeed / 15 + overlap * 0.25, 0.12, 1);
        a.applyCollision(this.normal, severity);
        b.applyCollision(this.normal.clone().multiplyScalar(-1), severity);
        count += 1;
        strongest = Math.max(strongest, severity);
      }
    }
    return { count, strongest };
  }
}
