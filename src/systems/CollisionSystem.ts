import * as THREE from 'three';
import type { ArcadeBoat } from '../entities/ArcadeBoat';
import type { RaceTrack } from '../game/Track';

export type CollisionResult = {
  count: number;
  strongest: number;
};

/** Boat/rock collision with only an extreme finite-world safety bound; the race corridor is never solid. */
export class CollisionSystem {
  private readonly normal = new THREE.Vector3();
  private readonly relativeVelocity = new THREE.Vector3();
  private readonly pairCooldowns = new Map<string, number>();
  private readonly trackCooldowns = new Map<string, number>();
  private previousPairContacts = new Set<string>();
  private previousTrackContacts = new Set<string>();

  resolve(boats: ArcadeBoat[], track: RaceTrack): CollisionResult {
    let count = 0;
    let strongest = 0;
    const currentPairContacts = new Set<string>();
    const currentTrackContacts = new Set<string>();

    this.tickCooldowns(this.pairCooldowns);
    this.tickCooldowns(this.trackCooldowns);

    for (const boat of boats) {
      const extent = track.worldHalfExtent;
      const outsideX = Math.abs(boat.group.position.x) - extent;
      const outsideZ = Math.abs(boat.group.position.z) - extent;
      if (outsideX > 0 || outsideZ > 0) {
        const useX = outsideX > outsideZ;
        this.normal.set(
          useX ? -Math.sign(boat.group.position.x) : 0,
          0,
          useX ? 0 : -Math.sign(boat.group.position.z),
        );
        const outside = Math.max(outsideX, outsideZ);
        boat.group.position.addScaledVector(this.normal, outside + 0.05);
        boat.applyCollision(this.normal, 0.82);
        count += 1;
        strongest = Math.max(strongest, 0.82);
      }

      for (const rock of track.rocks) {
        const dx = boat.group.position.x - rock.center.x;
        const dz = boat.group.position.z - rock.center.z;
        const minimum = boat.radius + rock.radius;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq >= minimum * minimum) continue;
        const key = `${boat.id}:${rock.id}`;
        currentTrackContacts.add(key);
        const distance = Math.sqrt(Math.max(distanceSq, 0.000001));
        this.normal.set(dx / distance, 0, dz / distance);
        const overlap = minimum - distance;
        boat.group.position.addScaledVector(this.normal, overlap + 0.025);
        const impactSpeed = Math.max(0, -boat.velocity.dot(this.normal));
        const severity = THREE.MathUtils.clamp(overlap * 0.18 + impactSpeed * 0.075, 0.08, 1);
        const isNewContact = !this.previousTrackContacts.has(key);
        const cooldown = this.trackCooldowns.get(key) ?? 0;
        if (isNewContact && cooldown <= 0 && (impactSpeed > 2.4 || overlap > 0.46)) {
          boat.applyCollision(this.normal, severity);
          this.trackCooldowns.set(key, 60);
          count += 1;
          strongest = Math.max(strongest, severity);
        }
      }
    }

    for (let aIndex = 0; aIndex < boats.length; aIndex += 1) {
      for (let bIndex = aIndex + 1; bIndex < boats.length; bIndex += 1) {
        const a = boats[aIndex];
        const b = boats[bIndex];
        const pairKey = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
        const dx = a.group.position.x - b.group.position.x;
        const dz = a.group.position.z - b.group.position.z;
        const minDistance = a.radius + b.radius;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq >= minDistance * minDistance) continue;

        currentPairContacts.add(pairKey);

        const distance = Math.sqrt(Math.max(distanceSq, 0.000001));
        if (distanceSq < 0.000001) this.normal.set(aIndex % 2 === 0 ? 1 : -1, 0, 0);
        else this.normal.set(dx / distance, 0, dz / distance);
        const overlap = minDistance - distance;
        a.group.position.addScaledVector(this.normal, overlap * 0.51);
        b.group.position.addScaledVector(this.normal, -overlap * 0.51);
        this.relativeVelocity.copy(a.velocity).sub(b.velocity);
        const closingSpeed = Math.max(0, -this.relativeVelocity.dot(this.normal));
        const severity = THREE.MathUtils.clamp(closingSpeed / 14 + overlap * 0.22, 0.08, 1);
        const isNewContact = !this.previousPairContacts.has(pairKey);
        const cooldown = this.pairCooldowns.get(pairKey) ?? 0;
        if (isNewContact && cooldown <= 0 && (closingSpeed > 1.8 || overlap > 0.38)) {
          a.applyCollision(this.normal, severity);
          this.normal.multiplyScalar(-1);
          b.applyCollision(this.normal, severity);
          this.pairCooldowns.set(pairKey, 36);
          count += 1;
          strongest = Math.max(strongest, severity);
        } else if (closingSpeed > 0) {
          const softImpulse = closingSpeed * 0.18;
          a.velocity.addScaledVector(this.normal, softImpulse);
          b.velocity.addScaledVector(this.normal, -softImpulse);
          a.syncSpeedFromVelocity();
          b.syncSpeedFromVelocity();
        }
      }
    }

    this.previousPairContacts = currentPairContacts;
    this.previousTrackContacts = currentTrackContacts;
    return { count, strongest };
  }

  private tickCooldowns(cooldowns: Map<string, number>): void {
    for (const [key, frames] of cooldowns) {
      if (frames <= 1) cooldowns.delete(key);
      else cooldowns.set(key, frames - 1);
    }
  }
}
