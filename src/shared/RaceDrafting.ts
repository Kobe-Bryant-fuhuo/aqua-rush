import type { Vector3 } from 'three';
import type { ArcadeBoat } from '../entities/ArcadeBoat';

export type DraftRival = { id: string; position: Vector3; velocity: Vector3 };

/** Follow a moving rival, then leave the wake to spend the earned slingshot. No proximity points. */
export function updateDrafting(delta: number, boat: ArcadeBoat, rivals: readonly DraftRival[], enabled: boolean): void {
  const eligible = enabled && !boat.flightActive && boat.speed > 12 && boat.draftCooldown === 0;
  const fx = Math.sin(boat.heading), fz = -Math.cos(boat.heading);
  boat.drafting = eligible && rivals.some(rival => {
    if (rival.id === boat.id || rival.velocity.lengthSq() < 144 || Math.abs(rival.position.y - boat.group.position.y) > 1.5) return false;
    const dx = rival.position.x - boat.group.position.x, dz = rival.position.z - boat.group.position.z;
    const ahead = dx * fx + dz * fz, across = Math.abs(dx * -fz + dz * fx);
    const agreement = (rival.velocity.x * fx + rival.velocity.z * fz) / rival.velocity.length();
    return ahead > 4 && ahead < 23 && across < 2.8 && agreement > .9;
  });
  if (!eligible) { boat.draftCharge = 0; boat.draftReady = false; return; }
  if (boat.drafting) {
    boat.draftCharge = Math.min(1.25, boat.draftCharge + delta);
    boat.draftReady = boat.draftCharge >= 1.25;
  } else if (boat.draftReady) {
    boat.rewardSkill(4, .16);
    boat.grantMiniBoost(.8);
    boat.draftCharge = 0; boat.draftReady = false; boat.draftCooldown = 4;
  } else boat.draftCharge = Math.max(0, boat.draftCharge - delta * 1.5);
}
