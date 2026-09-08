import { WorldMechanics } from './WorldMechanics';
import * as THREE from 'three';
import { getTrackDefinition, type CheckpointDefinition, type TrackDefinition } from './ContentCatalog';

export type TrackProjection = {
  progress: number;
  distance: number;
  signedDistance: number;
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
};

export type OrientedCheckpoint = {
  definition: CheckpointDefinition;
  center: THREE.Vector3;
  normal: THREE.Vector3;
  right: THREE.Vector3;
  halfWidth: number;
  height: number;
};

export type TrackRock = {
  id: string;
  center: THREE.Vector3;
  radius: number;
  height: number;
};

export type CheckpointCrossing = {
  valid: boolean;
  direction: number;
  lateral: number;
  vertical: number;
  intersection: THREE.Vector3;
  reason: 'valid' | 'reverse' | 'side' | 'height' | 'no-crossing' | 'too-slow';
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);
/** Arcade forgiveness keeps a visually plausible near miss from dropping an otherwise clean lap. */
const CHECKPOINT_LATERAL_GRACE = 2.4;

/** Data-driven circuit with open-water navigation and directional sector planes. */
export class RaceTrack {
  readonly definition: TrackDefinition;
  readonly mechanics: WorldMechanics;
  readonly curve: THREE.CatmullRomCurve3;
  readonly halfWidth: number;
  readonly checkpoints: readonly number[];
  readonly checkpointPlanes: readonly OrientedCheckpoint[];
  readonly rocks: readonly TrackRock[];
  readonly sampleCount = 960;
  readonly points: THREE.Vector3[] = [];
  readonly tangents: THREE.Vector3[] = [];
  readonly rights: THREE.Vector3[] = [];
  readonly length: number;
  readonly worldHalfExtent = 400;

  private readonly delta = new THREE.Vector3();
  private readonly projectionPoint = new THREE.Vector3();
  private readonly projectionTangent = new THREE.Vector3();
  private readonly projectionRight = new THREE.Vector3();
  private readonly curvatureA = new THREE.Vector3();
  private readonly curvatureB = new THREE.Vector3();
  private readonly crossingDelta = new THREE.Vector3();
  private readonly crossingPoint = new THREE.Vector3();

  constructor(definition: TrackDefinition = getTrackDefinition('breakwater')) {
    this.definition = definition;
    this.halfWidth = definition.halfWidth;
    this.checkpoints = definition.checkpoints.map((checkpoint) => checkpoint.progress);
    const controlPoints = definition.controlPoints.map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.curve = new THREE.CatmullRomCurve3(controlPoints, true, 'catmullrom', 0.35);
    this.curve.arcLengthDivisions = 2200;
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

    this.checkpointPlanes = definition.checkpoints.map((checkpoint) => {
      const center = this.getPointAt(checkpoint.progress);
      const normal = this.getTangentAt(checkpoint.progress);
      const right = normal.clone().cross(WORLD_UP).normalize();
      return { definition: checkpoint, center, normal, right, halfWidth: checkpoint.halfWidth, height: checkpoint.height };
    });
    const rocks = definition.rocks.map((rock) => ({
      id: rock.id,
      center: this.getOffsetPoint(rock.progress, rock.lateralOffset),
      radius: rock.radius,
      height: rock.height,
    }));
    this.rocks = rocks;
    this.mechanics = new WorldMechanics(this);
  }

  wrapProgress(progress: number): number {
    return ((progress % 1) + 1) % 1;
  }

  /** A point on the advisory water route, with the marked bypass available after a missed jump. */
  getDrivingTarget(position: THREE.Vector3, nextCheckpoint: number, speed: number, target = new THREE.Vector3(), elapsed = 0): THREE.Vector3 {
    const projection = this.project(position);
    this.getPointAt(projection.progress + (15 + Math.min(10, Math.abs(speed) * .35)) / this.length, target);
    const checkpoint = this.getCheckpoint(nextCheckpoint);
    if (this.wrapProgress(checkpoint.definition.progress - projection.progress) * this.length < 26) {
      target.copy(checkpoint.center).addScaledVector(checkpoint.normal, 3);
    }
    for (const block of this.mechanics.blocks) {
      if (!block.onRoute || speed > 14) continue;
      const delta = block.center.clone().sub(position);
      const ahead = delta.dot(block.forward), lateral = delta.dot(block.right);
      if (ahead > -2 && ahead < 22 && Math.abs(lateral) < block.width / 2 + 2) {
        target.copy(block.center).addScaledVector(block.right, block.width / 2 + 4).addScaledVector(block.forward, -4);
      }
    }
    this.mechanics.avoidCrossing(position, speed, elapsed, target);
    return target;
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

  getCheckpoint(index: number): OrientedCheckpoint {
    const checkpoint = this.checkpointPlanes[index];
    if (!checkpoint) throw new Error(`Unknown checkpoint ${index}`);
    return checkpoint;
  }

  /** Swept segment test prevents tunnelling and rejects reverse, side and vertical misses. */
  validateCheckpointCrossing(
    checkpointIndex: number,
    previousPosition: THREE.Vector3,
    currentPosition: THREE.Vector3,
    velocity: THREE.Vector3,
  ): CheckpointCrossing {
    const gate = this.getCheckpoint(checkpointIndex);
    const previousSide = this.crossingDelta.copy(previousPosition).sub(gate.center).dot(gate.normal);
    const currentSide = this.crossingPoint.copy(currentPosition).sub(gate.center).dot(gate.normal);
    const direction = velocity.dot(gate.normal);
    const denominator = previousSide - currentSide;
    const alpha = Math.abs(denominator) > 0.00001 ? previousSide / denominator : -1;
    if (previousSide > 0.15 || currentSide < -0.15 || alpha < 0 || alpha > 1) {
      const reverse = previousSide >= -0.15 && currentSide < -0.15;
      return { valid: false, direction, lateral: Number.POSITIVE_INFINITY, vertical: Number.POSITIVE_INFINITY, intersection: this.crossingPoint.copy(currentPosition), reason: reverse ? 'reverse' : 'no-crossing' };
    }
    this.crossingPoint.copy(previousPosition).lerp(currentPosition, alpha);
    this.crossingDelta.copy(this.crossingPoint).sub(gate.center);
    const lateral = Math.abs(this.crossingDelta.dot(gate.right));
    const vertical = Math.abs(this.crossingDelta.y);
    if (direction <= 0.8) return { valid: false, direction, lateral, vertical, intersection: this.crossingPoint, reason: direction < -0.1 ? 'reverse' : 'too-slow' };
    if (lateral > gate.halfWidth + CHECKPOINT_LATERAL_GRACE) return { valid: false, direction, lateral, vertical, intersection: this.crossingPoint, reason: 'side' };
    if (vertical > gate.height) return { valid: false, direction, lateral, vertical, intersection: this.crossingPoint, reason: 'height' };
    return { valid: true, direction, lateral, vertical, intersection: this.crossingPoint, reason: 'valid' };
  }

  /** Nearest sampled centerline is advisory only; it never creates an invisible wall. */
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
