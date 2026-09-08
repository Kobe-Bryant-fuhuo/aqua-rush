import type { RaceSnapshot } from '../../src/shared/OnlineProtocol';
import type { RaceIntent } from '../../src/shared/RaceIntent';
import { RaceTrack } from '../../src/game/Track';
import { Vector3 } from 'three';

/** The same checkpoint feedback strategy as the existing keyboard playtest. */
export function pilot(track: RaceTrack, racer: RaceSnapshot['racers'][number], slot: number, elapsed = 0): RaceIntent {
  const [x, , z] = racer.body.position;
  const target = track.getDrivingTarget(new Vector3(...racer.body.position), racer.race.nextCheckpoint, racer.body.numbers.speed, undefined, elapsed);
  target.addScaledVector(track.project(new Vector3(x, 0, z)).right, (slot - 1.5) * .5);
  const desired = Math.atan2(target.x - x, -(target.z - z));
  const headingError = Math.atan2(Math.sin(desired - racer.body.numbers.heading), Math.cos(desired - racer.body.numbers.heading));
  const speed = Math.abs(racer.body.numbers.speed);
  return {
    steer: Math.max(-1, Math.min(1, headingError * 2.2)),
    throttle: Math.abs(headingError) > .95 && speed > 7 ? -1 : Math.abs(headingError) > .58 && speed > 12 ? 0 : 1,
    boost: false,
  };
}
