import { CatmullRomCurve3 } from 'three';
import type { RaceTrack } from './Track';

export type RouteOption = Readonly<{
  id: string;
  label: string;
  hint: string;
  kind: 'safe' | 'risk' | 'current';
  anchors: readonly (readonly [progress: number, lateralOffset: number])[];
}>;

/** Optional lines share the same ordered checkpoints; they never award race progress. */
export function routeCurve(track: RaceTrack, route: RouteOption): CatmullRomCurve3 {
  const curve = new CatmullRomCurve3(route.anchors.map(([p, offset]) => track.getOffsetPoint(p, offset)));
  curve.arcLengthDivisions = 400;
  return curve;
}
