import * as THREE from 'three';
import { ARCADE_PALETTE } from './Materials';

export type WakeState = {
  position: THREE.Vector3;
  forward: THREE.Vector3;
  speed: number;
  boost?: number;
};

type WakeParticle = {
  active: boolean;
  age: number;
  life: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: number;
  width: number;
  length: number;
};

type SprayParticle = {
  active: boolean;
  age: number;
  life: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
};

const OFFSCREEN = new THREE.Matrix4().makeScale(0, 0, 0);

/** Two-draw-call pooled wake and spray system. */
export class VfxSystem {
  readonly root = new THREE.Group();

  private readonly wakeParticles: WakeParticle[];
  private readonly sprayParticles: SprayParticle[];
  private readonly wakeMesh: THREE.InstancedMesh;
  private readonly sprayPoints: THREE.Points;
  private readonly sprayPositions: Float32Array;
  private readonly sprayColors: Float32Array;
  private readonly wakeTimers = new Map<string, number>();
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly foam = new THREE.Color(ARCADE_PALETTE.foam);
  private rngState = 0x91e10da5;

  constructor(maxWake = 80, maxSpray = 96) {
    this.root.name = 'boatVfx';
    const wakeGeometry = new THREE.PlaneGeometry(1, 1.8);
    wakeGeometry.rotateX(-Math.PI / 2);
    const wakeMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: false,
    });
    this.wakeMesh = new THREE.InstancedMesh(wakeGeometry, wakeMaterial, maxWake);
    this.wakeMesh.name = 'pooledWake';
    this.wakeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.wakeMesh.frustumCulled = false;
    this.wakeParticles = Array.from({ length: maxWake }, () => ({
      active: false,
      age: 0,
      life: 1,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      rotation: 0,
      width: 1,
      length: 1,
    }));
    for (let index = 0; index < maxWake; index += 1) {
      this.wakeMesh.setMatrixAt(index, OFFSCREEN);
      this.wakeMesh.setColorAt(index, new THREE.Color(0x000000));
    }

    this.sprayPositions = new Float32Array(maxSpray * 3);
    this.sprayColors = new Float32Array(maxSpray * 3);
    this.sprayPositions.fill(-999);
    const sprayGeometry = new THREE.BufferGeometry();
    sprayGeometry.setAttribute('position', new THREE.BufferAttribute(this.sprayPositions, 3).setUsage(THREE.DynamicDrawUsage));
    sprayGeometry.setAttribute('color', new THREE.BufferAttribute(this.sprayColors, 3).setUsage(THREE.DynamicDrawUsage));
    const sprayMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0.88,
      size: 0.13,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.sprayPoints = new THREE.Points(sprayGeometry, sprayMaterial);
    this.sprayPoints.name = 'pooledSpray';
    this.sprayPoints.frustumCulled = false;
    this.sprayParticles = Array.from({ length: maxSpray }, () => ({
      active: false,
      age: 0,
      life: 1,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
    }));

    this.root.add(this.wakeMesh, this.sprayPoints);
  }

  seed(value: number): void {
    this.rngState = value >>> 0 || 1;
  }

  /** High-level wake call. Pass a stable id once per frame for each visible boat. */
  updateBoatWake(id: string, state: WakeState, delta: number): void {
    if (state.speed < 1.5) {
      this.wakeTimers.set(id, 0);
      return;
    }
    let timer = (this.wakeTimers.get(id) ?? 0) + delta;
    const speed01 = THREE.MathUtils.clamp(state.speed / 26, 0, 1);
    const interval = THREE.MathUtils.lerp(0.16, 0.05, speed01);
    const forward = state.forward.clone().setY(0).normalize();
    const side = new THREE.Vector3(-forward.z, 0, forward.x);
    while (timer >= interval) {
      timer -= interval;
      const intensity = 0.55 + speed01 * 0.65 + (state.boost ?? 0) * 0.35;
      this.spawnWake(state.position.clone().addScaledVector(side, -0.38), forward, intensity);
      this.spawnWake(state.position.clone().addScaledVector(side, 0.38), forward, intensity);
      if (speed01 > 0.48 && this.random() < 0.36 + speed01 * 0.26) {
        this.emitSpray(state.position, this.up, 0.25 + speed01 * 0.4);
      }
    }
    this.wakeTimers.set(id, timer);
  }

  /** Low-level wake puff for bespoke effects or cinematic events. */
  spawnWake(position: THREE.Vector3, forward: THREE.Vector3, intensity = 1): void {
    const particle = this.wakeParticles.find((candidate) => !candidate.active) ?? this.wakeParticles[0];
    particle.active = true;
    particle.age = 0;
    particle.life = THREE.MathUtils.lerp(0.75, 1.35, THREE.MathUtils.clamp(intensity, 0, 1.6) / 1.6);
    particle.position.copy(position);
    particle.position.y += 0.035;
    particle.velocity.copy(forward).multiplyScalar(-0.18);
    particle.rotation = Math.atan2(forward.x, forward.z);
    particle.width = 0.22 + intensity * 0.16;
    particle.length = 0.48 + intensity * 0.35;
  }

  emitSpray(position: THREE.Vector3, normal = this.up, intensity = 1): void {
    const count = Math.max(2, Math.min(14, Math.round(3 + intensity * 8)));
    for (let index = 0; index < count; index += 1) {
      const particle = this.sprayParticles.find((candidate) => !candidate.active);
      if (!particle) return;
      particle.active = true;
      particle.age = 0;
      particle.life = 0.32 + this.random() * 0.42;
      particle.position.copy(position);
      particle.position.x += (this.random() - 0.5) * 0.45;
      particle.position.z += (this.random() - 0.5) * 0.45;
      particle.velocity
        .copy(normal)
        .multiplyScalar(1.6 + this.random() * 2.8)
        .add(new THREE.Vector3((this.random() - 0.5) * 2.8, 0, (this.random() - 0.5) * 2.8));
    }
  }

  emitImpact(position: THREE.Vector3, normal = this.up, strength = 1): void {
    this.emitSpray(position, normal, THREE.MathUtils.clamp(strength * 1.65, 0.5, 1.8));
    for (let index = 0; index < 4; index += 1) {
      const direction = new THREE.Vector3(Math.cos(index * Math.PI * 0.5), 0, Math.sin(index * Math.PI * 0.5));
      this.spawnWake(position.clone().addScaledVector(direction, 0.18), direction, 0.7 + strength * 0.3);
    }
  }

  update(delta: number): void {
    this.updateWake(delta);
    this.updateSpray(delta);
  }

  dispose(): void {
    this.wakeMesh.geometry.dispose();
    (this.wakeMesh.material as THREE.Material).dispose();
    this.sprayPoints.geometry.dispose();
    (this.sprayPoints.material as THREE.Material).dispose();
    this.wakeTimers.clear();
  }

  private updateWake(delta: number): void {
    for (let index = 0; index < this.wakeParticles.length; index += 1) {
      const particle = this.wakeParticles[index];
      if (!particle.active) {
        this.wakeMesh.setMatrixAt(index, OFFSCREEN);
        this.wakeMesh.setColorAt(index, new THREE.Color(0x000000));
        continue;
      }
      particle.age += delta;
      if (particle.age >= particle.life) {
        particle.active = false;
        this.wakeMesh.setMatrixAt(index, OFFSCREEN);
        continue;
      }
      const progress = particle.age / particle.life;
      const fade = (1 - progress) ** 1.7;
      particle.position.addScaledVector(particle.velocity, delta);
      particle.position.y += delta * 0.012;
      this.quaternion.setFromAxisAngle(this.up, particle.rotation);
      this.scale.set(
        particle.width * (1 + progress * 2.1),
        1,
        particle.length * (1 + progress * 1.45),
      );
      this.matrix.compose(particle.position, this.quaternion, this.scale);
      this.wakeMesh.setMatrixAt(index, this.matrix);
      this.wakeMesh.setColorAt(index, this.foam.clone().multiplyScalar(0.22 + fade * 0.78));
    }
    this.wakeMesh.instanceMatrix.needsUpdate = true;
    if (this.wakeMesh.instanceColor) this.wakeMesh.instanceColor.needsUpdate = true;
  }

  private updateSpray(delta: number): void {
    const positionAttribute = this.sprayPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colorAttribute = this.sprayPoints.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let index = 0; index < this.sprayParticles.length; index += 1) {
      const particle = this.sprayParticles[index];
      const offset = index * 3;
      if (!particle.active) {
        this.sprayPositions[offset] = -999;
        this.sprayPositions[offset + 1] = -999;
        this.sprayPositions[offset + 2] = -999;
        this.sprayColors[offset] = 0;
        this.sprayColors[offset + 1] = 0;
        this.sprayColors[offset + 2] = 0;
        continue;
      }
      particle.age += delta;
      if (particle.age >= particle.life) {
        particle.active = false;
        continue;
      }
      particle.velocity.y -= 7.2 * delta;
      particle.position.addScaledVector(particle.velocity, delta);
      const fade = (1 - particle.age / particle.life) ** 1.4;
      this.sprayPositions[offset] = particle.position.x;
      this.sprayPositions[offset + 1] = particle.position.y;
      this.sprayPositions[offset + 2] = particle.position.z;
      this.sprayColors[offset] = this.foam.r * fade;
      this.sprayColors[offset + 1] = this.foam.g * fade;
      this.sprayColors[offset + 2] = this.foam.b * fade;
    }
    positionAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
  }

  private random(): number {
    let x = this.rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x >>> 0;
    return this.rngState / 4294967296;
  }
}
