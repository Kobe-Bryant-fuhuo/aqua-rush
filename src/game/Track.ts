import * as THREE from 'three';

export type TrackProjection = {
  progress: number;
  distance: number;
  signedDistance: number;
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Authored closed circuit: a fast southern straight, broad eastern sweep,
 * offset S-bends through the north, then a tighter western return.
 */
export class RaceTrack {
  readonly curve: THREE.CatmullRomCurve3;
  readonly halfWidth = 7.25;
  readonly checkpoints = [0.12, 0.28, 0.43, 0.58, 0.73, 0.88, 0] as const;
  readonly sampleCount = 720;
  readonly points: THREE.Vector3[] = [];
  readonly tangents: THREE.Vector3[] = [];
  readonly rights: THREE.Vector3[] = [];
  readonly length: number;

  private readonly delta = new THREE.Vector3();
  private readonly projectionPoint = new THREE.Vector3();
  private readonly projectionTangent = new THREE.Vector3();
  private readonly projectionRight = new THREE.Vector3();
  private readonly curvatureA = new THREE.Vector3();
  private readonly curvatureB = new THREE.Vector3();

  constructor() {
    const controlPoints = [
      new THREE.Vector3(-8, 0, -58),
      new THREE.Vector3(27, 0, -59),
      new THREE.Vector3(52, 0, -48),
      new THREE.Vector3(64, 0, -22),
      new THREE.Vector3(58, 0, 8),
      new THREE.Vector3(39, 0, 27),
      new THREE.Vector3(14, 0, 21),
      new THREE.Vector3(-5, 0, 31),
      new THREE.Vector3(13, 0, 44),
      new THREE.Vector3(-2, 0, 57),
      new THREE.Vector3(-31, 0, 55),
      new THREE.Vector3(-55, 0, 39),
      new THREE.Vector3(-64, 0, 12),
      new THREE.Vector3(-59, 0, -23),
      new THREE.Vector3(-39, 0, -51),
    ];
    this.curve = new THREE.CatmullRomCurve3(controlPoints, true, 'catmullrom', 0.35);
    this.curve.arcLengthDivisions = 1800;
    this.length = this.curve.getLength();

    for (let index = 0; index < this.sampleCount; index += 1) {
      const progress = index / this.sampleCount;
      const point = this.curve.getPointAt(progress);
      const tangent = this.curve.getTangentAt(progress).setY(0).normalize();
      const right = tangent.clone().cross(WORLD_UP).normalize();
      this.points.push(point);
      this.tangents.push(tangent);
      this.rights.push(right);
    }
  }

  wrapProgress(progress: number): number {
    return ((progress % 1) + 1) % 1;
  }

  getPointAt(progress: number, target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.curve.getPointAt(this.wrapProgress(progress)));
  }

  getTangentAt(progress: number, target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.curve.getTangentAt(this.wrapProgress(progress))).setY(0).normalize();
  }

  getRightAt(progress: number, target = new THREE.Vector3()): THREE.Vector3 {
    this.getTangentAt(progress, target);
    return target.cross(WORLD_UP).normalize();
  }

  getOffsetPoint(progress: number, lateralOffset: number, target = new THREE.Vector3()): THREE.Vector3 {
    this.getPointAt(progress, target);
    this.getRightAt(progress, this.projectionRight);
    return target.addScaledVector(this.projectionRight, lateralOffset);
  }

  /** Nearest sampled centerline point; stable and cheap for four racers. */
  project(position: THREE.Vector3): TrackProjection {
    let bestIndex = 0;
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    for (let index = 0; index < this.sampleCount; index += 1) {
      const point = this.points[index];
      const dx = position.x - point.x;
      const dz = position.z - point.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestIndex = index;
      }
    }

    this.projectionPoint.copy(this.points[bestIndex]);
    this.projectionTangent.copy(this.tangents[bestIndex]);
    this.projectionRight.copy(this.rights[bestIndex]);
    this.delta.copy(position).sub(this.projectionPoint).setY(0);
    const signedDistance = this.delta.dot(this.projectionRight);
    return {
      progress: bestIndex / this.sampleCount,
      distance: Math.sqrt(bestDistanceSq),
      signedDistance,
      point: this.projectionPoint.clone(),
      tangent: this.projectionTangent.clone(),
      right: this.projectionRight.clone(),
    };
  }

  curvatureAt(progress: number, sampleSpan = 0.012): number {
    this.getTangentAt(progress - sampleSpan, this.curvatureA);
    this.getTangentAt(progress + sampleSpan, this.curvatureB);
    return this.curvatureA.angleTo(this.curvatureB) / (sampleSpan * 2);
  }

  forwardDistance(fromProgress: number, toProgress: number): number {
    return this.wrapProgress(toProgress - fromProgress);
  }

  headingAt(progress: number): number {
    const tangent = this.getTangentAt(progress, this.projectionTangent);
    return Math.atan2(tangent.x, -tangent.z);
  }
}
