import * as THREE from 'three';
import { ARCADE_PALETTE } from './Materials';

export type WakeState = {
  position: THREE.Vector3;
  forward: THREE.Vector3;
  speed: number;
  boost?: number;
  drift?: number;
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
  side: -1 | 1;
};

type SprayParticle = {
  active: boolean;
  age: number;
  life: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
};

type StreakParticle = {
  active: boolean;
  age: number;
  life: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: number;
  width: number;
  length: number;
};

const OFFSCREEN = new THREE.Matrix4().makeScale(0, 0, 0);

function createWakeRibbonGeometry(): THREE.BufferGeometry {
  // A tapered, gently hooked ribbon. Mirroring this geometry creates the two
  // arms of a continuous-looking V wake instead of stamped rectangles.
  const positions = new Float32Array([
    -0.025, 0, -0.82, 0.025, 0, -0.82,
    0.03, 0, -0.28, 0.14, 0, -0.28,
    0.23, 0, 0.34, 0.46, 0, 0.34,
    0.52, 0, 0.92, 0.82, 0, 0.92,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex([0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5, 4, 6, 5, 5, 6, 7]);
  geometry.computeVertexNormals();
  geometry.name = 'curvedWakeRibbon';
  return geometry;
}

function createSpeedStreakGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, 0, -0.85,
    0.5, 0, -0.85,
    0.12, 0, 0.85,
    -0.12, 0, 0.85,
  ], 3));
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  geometry.computeVertexNormals();
  geometry.name = 'taperedSpeedStreak';
  return geometry;
}

/** Three-draw-call pooled wake, side spray and boost-streak system. */
export class VfxSystem {
  readonly root = new THREE.Group();

  private readonly wakeParticles: WakeParticle[];
  private readonly sprayParticles: SprayParticle[];
  private readonly streakParticles: StreakParticle[];
  private readonly wakeMesh: THREE.InstancedMesh;
  private readonly sprayPoints: THREE.Points;
  private readonly streakMesh: THREE.InstancedMesh;
  private readonly sprayPositions: Float32Array;
  private readonly sprayColors: Float32Array;
  private readonly wakeTimers = new Map<string, number>();
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly foam = new THREE.Color(ARCADE_PALETTE.foam);
  private readonly tempForward = new THREE.Vector3();
  private readonly tempSide = new THREE.Vector3();
  private readonly tempPosition = new THREE.Vector3();
  private readonly tempNormal = new THREE.Vector3();
  private wakeCursor = 0;
  private sprayCursor = 0;
  private streakCursor = 0;
  private rngState = 0x91e10da5;

  constructor(maxWake = 80, maxSpray = 96) {
    this.root.name = 'boatVfx';
    const wakeGeometry = createWakeRibbonGeometry();
    const wakeMaterial = new THREE.MeshBasicMaterial({
      color: ARCADE_PALETTE.foam,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
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
      side: 1,
    }));
    for (let index = 0; index < maxWake; index += 1) {
      this.wakeMesh.setMatrixAt(index, OFFSCREEN);
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

    const maxStreaks = Math.max(24, Math.round(maxWake * 0.5));
    const streakMaterial = new THREE.MeshBasicMaterial({
      color: ARCADE_PALETTE.cyan,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.streakMesh = new THREE.InstancedMesh(createSpeedStreakGeometry(), streakMaterial, maxStreaks);
    this.streakMesh.name = 'pooledSpeedStreaks';
    this.streakMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.streakMesh.frustumCulled = false;
    this.streakParticles = Array.from({ length: maxStreaks }, () => ({
      active: false,
      age: 0,
      life: 1,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      rotation: 0,
      width: 1,
      length: 1,
    }));
    for (let index = 0; index < maxStreaks; index += 1) {
      this.streakMesh.setMatrixAt(index, OFFSCREEN);
    }

    this.root.add(this.wakeMesh, this.sprayPoints, this.streakMesh);
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
    const forward = this.tempForward.copy(state.forward).setY(0).normalize();
    const side = this.tempSide.set(-forward.z, 0, forward.x);
    while (timer >= interval) {
      timer -= interval;
      const drift = THREE.MathUtils.clamp(state.drift ?? 0, 0, 1);
      const intensity = 0.55 + speed01 * 0.65 + (state.boost ?? 0) * 0.35 + drift * 0.18;
      this.tempPosition.copy(state.position).addScaledVector(forward, -1.28).addScaledVector(side, -0.34);
      this.spawnWake(this.tempPosition, forward, intensity, -1);
      this.tempPosition.copy(state.position).addScaledVector(forward, -1.28).addScaledVector(side, 0.34);
      this.spawnWake(this.tempPosition, forward, intensity, 1);
      if (speed01 > 0.48 && this.random() < 0.36 + speed01 * 0.26 + drift * 0.26) {
        const spraySide = this.random() < 0.5 ? -1 : 1;
        this.tempPosition.copy(state.position).addScaledVector(forward, -0.62).addScaledVector(side, spraySide * 0.72);
        this.tempNormal.copy(this.up).addScaledVector(side, spraySide * (0.42 + speed01 * 0.38 + drift * 0.45)).normalize();
        this.emitSpray(this.tempPosition, this.tempNormal, 0.22 + speed01 * 0.38);
      }
      const boost = THREE.MathUtils.clamp(state.boost ?? 0, 0, 1);
      if (speed01 > 0.72 && this.random() < 0.24 + boost * 0.58) {
        const streakSide = this.random() < 0.5 ? -1 : 1;
        this.tempPosition.copy(state.position)
          .addScaledVector(forward, -0.55 - this.random() * 1.3)
          .addScaledVector(side, streakSide * (0.72 + this.random() * 0.58));
        this.spawnStreak(this.tempPosition, forward, speed01, boost);
      }
    }
    this.wakeTimers.set(id, timer);
  }

  /** Low-level wake puff for bespoke effects or cinematic events. */
  spawnWake(position: THREE.Vector3, forward: THREE.Vector3, intensity = 1, side: -1 | 1 = 1): void {
    const particle = this.acquireWake();
    particle.active = true;
    particle.age = 0;
    particle.life = THREE.MathUtils.lerp(0.75, 1.35, THREE.MathUtils.clamp(intensity, 0, 1.6) / 1.6);
    particle.position.copy(position);
    particle.position.y += 0.035;
    particle.velocity.copy(forward).multiplyScalar(-0.18);
    particle.rotation = Math.atan2(-forward.x, -forward.z) - side * (0.13 + intensity * 0.035);
    particle.width = 0.34 + intensity * 0.18;
    particle.length = 0.62 + intensity * 0.42;
    particle.side = side;
  }

  emitSpray(position: THREE.Vector3, normal = this.up, intensity = 1): void {
    const count = Math.max(2, Math.min(14, Math.round(3 + intensity * 8)));
    for (let index = 0; index < count; index += 1) {
      const particle = this.acquireSpray();
      particle.active = true;
      particle.age = 0;
      particle.life = 0.32 + this.random() * 0.42;
      particle.position.copy(position);
      particle.position.x += (this.random() - 0.5) * 0.45;
      particle.position.z += (this.random() - 0.5) * 0.45;
      particle.velocity
        .set((this.random() - 0.5) * 2.8, 0, (this.random() - 0.5) * 2.8)
        .addScaledVector(normal, 1.6 + this.random() * 2.8);
    }
  }

  emitImpact(position: THREE.Vector3, normal = this.up, strength = 1): void {
    this.emitSpray(position, normal, THREE.MathUtils.clamp(strength * 1.65, 0.5, 1.8));
    for (let index = 0; index < 4; index += 1) {
      const angle = index * Math.PI * 0.5;
      this.tempForward.set(Math.cos(angle), 0, Math.sin(angle));
      this.tempPosition.copy(position).addScaledVector(this.tempForward, 0.18);
      this.spawnWake(this.tempPosition, this.tempForward, 0.7 + strength * 0.3, index % 2 === 0 ? -1 : 1);
    }
  }

  private spawnStreak(position: THREE.Vector3, forward: THREE.Vector3, speed01: number, boost: number): void {
    const particle = this.acquireStreak();
    particle.active = true;
    particle.age = 0;
    particle.life = 0.18 + speed01 * 0.18 + boost * 0.14;
    particle.position.copy(position);
    particle.position.y += 0.08 + this.random() * 0.07;
    particle.velocity.copy(forward).multiplyScalar(-0.8 - speed01 * 1.5);
    particle.rotation = Math.atan2(-forward.x, -forward.z);
    particle.width = 0.035 + boost * 0.045;
    particle.length = 0.75 + speed01 * 1.15 + boost * 0.72;
  }

  update(delta: number): void {
    this.updateWake(delta);
    this.updateSpray(delta);
    this.updateStreaks(delta);
  }

  dispose(): void {
    this.wakeMesh.geometry.dispose();
    (this.wakeMesh.material as THREE.Material).dispose();
    this.sprayPoints.geometry.dispose();
    (this.sprayPoints.material as THREE.Material).dispose();
    this.streakMesh.geometry.dispose();
    (this.streakMesh.material as THREE.Material).dispose();
    this.wakeTimers.clear();
  }

  private updateWake(delta: number): void {
    for (let index = 0; index < this.wakeParticles.length; index += 1) {
      const particle = this.wakeParticles[index];
      if (!particle.active) {
        this.wakeMesh.setMatrixAt(index, OFFSCREEN);
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
        particle.width * particle.side * (1 + progress * 1.55) * THREE.MathUtils.clamp(fade * 1.8, 0.04, 1),
        1,
        particle.length * (1 + progress * 1.25),
      );
      this.matrix.compose(particle.position, this.quaternion, this.scale);
      this.wakeMesh.setMatrixAt(index, this.matrix);
    }
    this.wakeMesh.instanceMatrix.needsUpdate = true;
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

  private updateStreaks(delta: number): void {
    for (let index = 0; index < this.streakParticles.length; index += 1) {
      const particle = this.streakParticles[index];
      if (!particle.active) {
        this.streakMesh.setMatrixAt(index, OFFSCREEN);
        continue;
      }
      particle.age += delta;
      if (particle.age >= particle.life) {
        particle.active = false;
        this.streakMesh.setMatrixAt(index, OFFSCREEN);
        continue;
      }
      const progress = particle.age / particle.life;
      const fade = (1 - progress) ** 1.35;
      particle.position.addScaledVector(particle.velocity, delta);
      this.quaternion.setFromAxisAngle(this.up, particle.rotation);
      this.scale.set(particle.width * (1 - progress * 0.35) * THREE.MathUtils.clamp(fade * 1.8, 0.03, 1), 1, particle.length * (1 + progress * 0.45));
      this.matrix.compose(particle.position, this.quaternion, this.scale);
      this.streakMesh.setMatrixAt(index, this.matrix);
    }
    this.streakMesh.instanceMatrix.needsUpdate = true;
  }

  private acquireWake(): WakeParticle {
    for (let offset = 0; offset < this.wakeParticles.length; offset += 1) {
      const index = (this.wakeCursor + offset) % this.wakeParticles.length;
      if (!this.wakeParticles[index].active) {
        this.wakeCursor = (index + 1) % this.wakeParticles.length;
        return this.wakeParticles[index];
      }
    }
    const particle = this.wakeParticles[this.wakeCursor];
    this.wakeCursor = (this.wakeCursor + 1) % this.wakeParticles.length;
    return particle;
  }

  private acquireSpray(): SprayParticle {
    for (let offset = 0; offset < this.sprayParticles.length; offset += 1) {
      const index = (this.sprayCursor + offset) % this.sprayParticles.length;
      if (!this.sprayParticles[index].active) {
        this.sprayCursor = (index + 1) % this.sprayParticles.length;
        return this.sprayParticles[index];
      }
    }
    const particle = this.sprayParticles[this.sprayCursor];
    this.sprayCursor = (this.sprayCursor + 1) % this.sprayParticles.length;
    return particle;
  }

  private acquireStreak(): StreakParticle {
    for (let offset = 0; offset < this.streakParticles.length; offset += 1) {
      const index = (this.streakCursor + offset) % this.streakParticles.length;
      if (!this.streakParticles[index].active) {
        this.streakCursor = (index + 1) % this.streakParticles.length;
        return this.streakParticles[index];
      }
    }
    const particle = this.streakParticles[this.streakCursor];
    this.streakCursor = (this.streakCursor + 1) % this.streakParticles.length;
    return particle;
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
