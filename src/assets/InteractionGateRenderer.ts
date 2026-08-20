import * as THREE from 'three';
import type { InteractionState } from '../game/InteractionSystem';
import type { RaceTrack } from '../game/Track';

type GateInstance = { stateId: string; postStart: number; signalIndex: number };

/** Four fixed draw-call batches for both V3 interaction families. */
export class InteractionGateRenderer {
  readonly root = new THREE.Group();

  private readonly boostPosts: THREE.InstancedMesh;
  private readonly boostSignals: THREE.InstancedMesh;
  private readonly driftPosts: THREE.InstancedMesh;
  private readonly driftSignals: THREE.InstancedMesh;
  private readonly boostInstances: GateInstance[] = [];
  private readonly driftInstances: GateInstance[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly cyan = new THREE.Color('#39e1e5');
  private readonly yellow = new THREE.Color('#ffd85a');
  private readonly coral = new THREE.Color('#ff5e57');
  private readonly success = new THREE.Color('#fff4cf');
  private readonly cooldown = new THREE.Color('#315a68');
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly position = new THREE.Vector3();

  constructor(track: RaceTrack) {
    this.root.name = 'interactionGateRenderer';
    const boostDefs = track.definition.interactions.filter((gate) => gate.kind === 'boost-gate');
    const driftDefs = track.definition.interactions.filter((gate) => gate.kind === 'drift-gate');
    const postGeometry = new THREE.CylinderGeometry(0.22, 0.42, 3.1, 7, 1);
    const boostSignalGeometry = new THREE.TorusGeometry(1, 0.16, 6, 24, Math.PI);
    const driftSignalGeometry = new THREE.ConeGeometry(0.5, 1.6, 3, 1);
    const boostPostMaterial = new THREE.MeshBasicMaterial({ color: this.cyan, toneMapped: false });
    const boostSignalMaterial = new THREE.MeshBasicMaterial({ color: this.cyan, toneMapped: false });
    const driftPostMaterial = new THREE.MeshBasicMaterial({ color: this.yellow, toneMapped: false });
    const driftSignalMaterial = new THREE.MeshBasicMaterial({ color: this.yellow, toneMapped: false });
    this.boostPosts = new THREE.InstancedMesh(postGeometry, boostPostMaterial, Math.max(1, boostDefs.length * 2));
    this.boostSignals = new THREE.InstancedMesh(boostSignalGeometry, boostSignalMaterial, Math.max(1, boostDefs.length));
    this.driftPosts = new THREE.InstancedMesh(postGeometry, driftPostMaterial, Math.max(1, driftDefs.length * 2));
    this.driftSignals = new THREE.InstancedMesh(driftSignalGeometry, driftSignalMaterial, Math.max(1, driftDefs.length));
    this.boostPosts.count = boostDefs.length * 2;
    this.boostSignals.count = boostDefs.length;
    this.driftPosts.count = driftDefs.length * 2;
    this.driftSignals.count = driftDefs.length;
    this.geometries.push(postGeometry, boostSignalGeometry, driftSignalGeometry);
    this.materials.push(boostPostMaterial, boostSignalMaterial, driftPostMaterial, driftSignalMaterial);
    this.populate(track, boostDefs.map((definition) => definition.id), this.boostPosts, this.boostSignals, this.boostInstances, false);
    this.populate(track, driftDefs.map((definition) => definition.id), this.driftPosts, this.driftSignals, this.driftInstances, true);
    this.root.add(this.boostPosts, this.boostSignals, this.driftPosts, this.driftSignals);
  }

  update(states: readonly InteractionState[], elapsed: number): void {
    this.updateFamily(states, this.boostInstances, this.boostPosts, this.boostSignals, this.cyan, elapsed);
    this.updateFamily(states, this.driftInstances, this.driftPosts, this.driftSignals, this.yellow, elapsed);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
  }

  private populate(
    track: RaceTrack,
    ids: string[],
    posts: THREE.InstancedMesh,
    signals: THREE.InstancedMesh,
    output: GateInstance[],
    drift: boolean,
  ): void {
    const up = new THREE.Vector3(0, 1, 0);
    ids.forEach((id, index) => {
      const definition = track.definition.interactions.find((gate) => gate.id === id)!;
      const center = track.getOffsetPoint(definition.progress, definition.lateralOffset);
      const tangent = track.getTangentAt(definition.progress);
      const right = tangent.clone().cross(up).normalize();
      this.quaternion.setFromAxisAngle(up, Math.atan2(tangent.x, tangent.z));
      for (const side of [-1, 1]) {
        this.position.copy(center).addScaledVector(right, side * definition.halfWidth).setY(1.25);
        this.scale.set(drift ? 1.2 : 1, 1, 1);
        this.matrix.compose(this.position, this.quaternion, this.scale);
        posts.setMatrixAt(index * 2 + (side > 0 ? 1 : 0), this.matrix);
      }
      this.position.copy(center).setY(drift ? 2.7 : 2.85);
      this.scale.set(definition.halfWidth * (drift ? 0.85 : 1), definition.halfWidth * (drift ? 0.85 : 1), 1);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      signals.setMatrixAt(index, this.matrix);
      output.push({ stateId: id, postStart: index * 2, signalIndex: index });
    });
    posts.instanceMatrix.needsUpdate = true;
    signals.instanceMatrix.needsUpdate = true;
  }

  private updateFamily(
    states: readonly InteractionState[],
    instances: readonly GateInstance[],
    posts: THREE.InstancedMesh,
    signals: THREE.InstancedMesh,
    readyColor: THREE.Color,
    elapsed: number,
  ): void {
    let familyColor = readyColor;
    for (const instance of instances) {
      const state = states.find((candidate) => candidate.id === instance.stateId);
      const color = !state || state.phase === 'cooldown'
        ? this.cooldown
        : state.outcome === 'failure'
          ? this.coral
          : state.phase === 'feedback' && state.outcome === 'success'
            ? this.success
          : readyColor;
      if (state?.phase === 'feedback') {
        familyColor = color;
        break;
      }
    }
    const pulse = 0.82 + Math.sin(elapsed * 8) * 0.18;
    (posts.material as THREE.MeshBasicMaterial).color.copy(familyColor).multiplyScalar(pulse);
    (signals.material as THREE.MeshBasicMaterial).color.copy(familyColor).multiplyScalar(pulse);
  }
}
