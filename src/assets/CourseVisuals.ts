import * as THREE from 'three';
import { ARCADE_PALETTE, createOutlineMesh, MaterialLibrary } from './Materials';
import type { EnvironmentPreset, TrackDefinition } from '../game/ContentCatalog';
import { WorldScenery } from './WorldScenery';
import type { RaceTrack } from '../game/Track';

export type CourseVisualOptions = {
  centerline?: readonly THREE.Vector3[];
  courseWidth?: number;
  buoySpacing?: number;
  materials?: MaterialLibrary;
  seed?: number;
  definition?: TrackDefinition;
};

type CourseSample = { position: THREE.Vector3; tangent: THREE.Vector3 };

export function createDefaultCourseCenterline(count = 72): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = (index / count) * Math.PI * 2;
    const chicane = Math.sin(t * 3 + 0.45) * 3.2 * Math.max(0, Math.sin(t));
    points.push(new THREE.Vector3(
      Math.cos(t) * 29 + chicane,
      0,
      Math.sin(t) * 19 + Math.sin(t * 2) * 2.2,
    ));
  }
  return points;
}

function sampleClosedPolyline(points: readonly THREE.Vector3[], spacing: number): CourseSample[] {
  if (points.length < 3) return [];
  const lengths: number[] = [0];
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    total += points[index].distanceTo(points[(index + 1) % points.length]);
    lengths.push(total);
  }
  const sampleCount = Math.max(12, Math.ceil(total / Math.max(2.5, spacing)));
  const samples: CourseSample[] = [];
  let segment = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const distance = (index / sampleCount) * total;
    while (segment < points.length - 1 && lengths[segment + 1] < distance) segment += 1;
    const next = (segment + 1) % points.length;
    const segmentLength = lengths[segment + 1] - lengths[segment];
    const alpha = segmentLength > 0 ? (distance - lengths[segment]) / segmentLength : 0;
    const position = points[segment].clone().lerp(points[next], alpha);
    const tangent = points[next].clone().sub(points[segment]).setY(0).normalize();
    samples.push({ position, tangent });
  }
  return samples;
}

function makeSky(environment?: EnvironmentPreset): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const material = new THREE.ShaderMaterial({
    name: 'animeGradientSky',
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      uTop: { value: new THREE.Color(environment?.skyTop ?? 0x397ac8) },
      uMid: { value: new THREE.Color(environment?.skyMid ?? 0x7bd4dd) },
      uHorizon: { value: new THREE.Color(environment?.horizon ?? 0xffdb9d) },
      uSunColor: { value: new THREE.Color(environment?.sun ?? 0xfff0a8) },
      uSunDir: { value: new THREE.Vector3(-0.5, 0.32, -0.44).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uTop, uMid, uHorizon, uSunColor, uSunDir;
      void main() {
        float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 lower = mix(uHorizon, uMid, smoothstep(0.43, 0.62, h));
        vec3 color = mix(lower, uTop, smoothstep(0.58, 0.94, h));
        float facing = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
        color += uSunColor * (pow(facing, 720.0) + pow(facing, 9.0) * 0.22);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(650, 28, 14), material);
  sky.name = 'gradientSkyDome';
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  return sky;
}

function createRacingLine(points: readonly THREE.Vector3[]): THREE.Mesh | null {
  if (points.length < 3) return null;
  const positions: number[] = [];
  const indices: number[] = [];
  const halfWidth = 0.14;
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    const tangent = next.clone().sub(previous).setY(0).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
    const point = points[index];
    const left = point.clone().addScaledVector(side, halfWidth);
    const right = point.clone().addScaledVector(side, -halfWidth);
    positions.push(left.x, 0.045, left.z, right.x, 0.045, right.z);
    const following = (index + 1) % points.length;
    indices.push(index * 2, following * 2, index * 2 + 1, index * 2 + 1, following * 2, following * 2 + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({
    color: ARCADE_PALETTE.cream,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    toneMapped: false,
  });
  const line = new THREE.Mesh(geometry, material);
  line.name = 'subtleRacingLine';
  return line;
}

/** Layered world kit: atmosphere, far islands/clouds, buoys, gates, and racing line. */
export class CourseVisuals {
  readonly root = new THREE.Group();
  private world: WorldScenery | null = null;
  readonly courseRoot = new THREE.Group();
  readonly lightRig = new THREE.Group();
  readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;

  private readonly materials: MaterialLibrary;
  private readonly ownsMaterials: boolean;
  private readonly cloudRoot = new THREE.Group();
  private readonly beaconMaterials: THREE.MeshToonMaterial[] = [];
  private ownedCourseResources: Array<THREE.BufferGeometry | THREE.Material> = [];
  private readonly environment?: EnvironmentPreset;

  constructor(options: CourseVisualOptions = {}) {
    this.root.name = 'courseVisuals';
    this.courseRoot.name = 'courseMarkers';
    this.cloudRoot.name = 'cloudLayer';
    this.lightRig.name = 'arcadeLightingRig';
    this.materials = options.materials ?? new MaterialLibrary();
    this.ownsMaterials = !options.materials;
    this.environment = options.definition?.environment;
    this.sky = makeSky(this.environment);

    this.createLighting();
    this.createCloudLayer(options.seed ?? options.definition?.seed ?? 17);
    this.createIslandLayer(options.seed ?? options.definition?.seed ?? 17);
    this.root.add(this.sky, this.cloudRoot, this.courseRoot, this.lightRig);
    this.setCourse(options.centerline ?? createDefaultCourseCenterline(), options.courseWidth ?? 8.5, options.buoySpacing ?? 18);
  }

  /** Add the world kit and fog that hides the finite 1200-unit ocean edge. */
  install(scene: THREE.Scene): void {
    const fog = this.environment?.fog ?? '#78cbd1';
    scene.background = new THREE.Color(fog);
    scene.fog = new THREE.Fog(fog, this.environment?.storm ? 180 : 240, this.environment?.storm ? 410 : 520);
    if (this.root.parent !== scene) scene.add(this.root);
  }

  setTrack(track: RaceTrack): void {
    this.clearCourse();
    const samples = sampleClosedPolyline(track.points, track.definition.buoySpacing);
    this.createBuoys(samples, track.halfWidth * 2);
    this.createCheckpointInstances(track);
    this.createVisibleRocks(track);
    this.world = new WorldScenery(track);
    this.courseRoot.add(this.world.root);
  }

  setCourse(centerline: readonly THREE.Vector3[], courseWidth = 8.5, buoySpacing = 7): void {
    this.clearCourse();
    const samples = sampleClosedPolyline(centerline, buoySpacing);
    if (samples.length === 0) return;
    this.createBuoys(samples, courseWidth);
    const line = createRacingLine(centerline);
    if (line) {
      this.courseRoot.add(line);
      this.ownedCourseResources.push(line.geometry, line.material as THREE.Material);
    }
    const gateIndices = [0, Math.floor(samples.length / 3), Math.floor((samples.length * 2) / 3)];
    gateIndices.forEach((sampleIndex, gateIndex) => {
      this.courseRoot.add(this.createCheckpointGate(samples[sampleIndex], courseWidth, gateIndex));
    });
  }

  update(elapsed: number, cameraPosition?: THREE.Vector3, simulationTime = elapsed): void {
    this.cloudRoot.rotation.y = elapsed * 0.004;
    this.world?.update(simulationTime);
    const pulse = 1.05 + Math.sin(elapsed * 4.6) * 0.3;
    this.beaconMaterials.forEach((material) => { material.emissiveIntensity = pulse; });
    if (cameraPosition) this.sky.position.copy(cameraPosition);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.clearCourse();
    this.lightRig.traverse((object) => {
      if (!(object instanceof THREE.DirectionalLight)) return;
      object.shadow.map?.dispose();
      object.shadow.map = null;
      object.shadow.mapPass?.dispose();
      object.shadow.mapPass = null;
    });
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.cloudRoot.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
    // Islands are direct children apart from the named layers.
    this.root.children.filter((child) => child.name === 'distantIslands').forEach((islands) => {
      islands.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
    });
    if (this.ownsMaterials) this.materials.dispose();
  }

  private createLighting(): void {
    const hemisphere = new THREE.HemisphereLight(0xd9fbff, 0x2c7590, 2.0);
    hemisphere.name = 'skyFill';
    const key = new THREE.DirectionalLight(0xfff2c4, 2.7);
    key.name = 'sunKey';
    key.position.set(-26, 38, -18);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 8;
    key.shadow.camera.far = 100;
    key.shadow.camera.left = -48;
    key.shadow.camera.right = 48;
    key.shadow.camera.top = 44;
    key.shadow.camera.bottom = -44;
    key.shadow.bias = -0.0008;
    const rim = new THREE.DirectionalLight(0x69e8f2, 0.9);
    rim.name = 'coolRim';
    rim.position.set(22, 15, 30);
    this.lightRig.add(hemisphere, key, rim);
  }

  private createCloudLayer(seed: number): void {
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    const material = new THREE.MeshToonMaterial({
      color: this.environment?.storm ? 0x9baab1 : ARCADE_PALETTE.cream,
      gradientMap: this.materials.gradientMap,
    });
    material.name = 'cloudPuffs';
    const cloudCount = this.environment?.storm ? 54 : 42;
    const clouds = new THREE.InstancedMesh(geometry, material, cloudCount);
    clouds.name = 'instancedCloudPuffs';
    clouds.frustumCulled = false;
    let state = seed >>> 0;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    for (let index = 0; index < cloudCount; index += 1) {
      const cluster = Math.floor(index / 6);
      const angle = (cluster / 7) * Math.PI * 2 + 0.24;
      const radius = (this.environment?.storm ? 170 : 105) + (cluster % 2) * 18;
      position.set(
        Math.cos(angle) * radius + (random() - 0.5) * 9,
        40 + random() * 11,
        Math.sin(angle) * radius + (random() - 0.5) * 9,
      );
      scale.set(3.2 + random() * 4.4, 1.2 + random() * 2.2, 1.8 + random() * 3.2);
      matrix.compose(position, quaternion, scale);
      clouds.setMatrixAt(index, matrix);
    }
    clouds.instanceMatrix.needsUpdate = true;
    this.cloudRoot.add(clouds);
  }

  private createIslandLayer(seed: number): void {
    const islands = new THREE.Group();
    islands.name = 'distantIslands';
    let state = seed >>> 0;
    const random = () => {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return state / 4294967296;
    };
    const rockMaterial = new THREE.MeshToonMaterial({ color: this.environment?.storm ? 0x334552 : 0x356b70, gradientMap: this.materials.gradientMap });
    const greenMaterial = new THREE.MeshToonMaterial({ color: this.environment?.storm ? 0x556867 : 0x66a857, gradientMap: this.materials.gradientMap });
    for (let index = 0; index < 7; index += 1) {
      const angle = (index / 7) * Math.PI * 2 + 0.18;
      // Background islands stay beyond the playable square, including expanded courses.
      const radius = (440 + (index % 3) * 13) / Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)));
      const height = 7 + random() * 9;
      const base = new THREE.Mesh(new THREE.ConeGeometry(8 + random() * 7, height, 7, 2), rockMaterial);
      base.position.set(Math.cos(angle) * radius, -height * 0.3, Math.sin(angle) * radius);
      base.rotation.y = random() * Math.PI;
      base.scale.z = 0.7 + random() * 0.65;
      base.name = `islandRock${index}`;
      const crown = new THREE.Mesh(new THREE.ConeGeometry(6 + random() * 5, height * 0.42, 7, 1), greenMaterial);
      crown.position.set(base.position.x, height * 0.16, base.position.z);
      crown.rotation.y = base.rotation.y;
      crown.scale.z = base.scale.z;
      crown.name = `islandCrown${index}`;
      islands.add(base, crown);
    }
    this.root.add(islands);
  }

  private createBuoys(samples: CourseSample[], courseWidth: number): void {
    const count = samples.length * 2;
    const bodyGeometry = new THREE.CylinderGeometry(0.18, 0.32, 1.15, 8, 1);
    const ringGeometry = new THREE.TorusGeometry(0.39, 0.105, 6, 12);
    ringGeometry.rotateX(Math.PI / 2);
    const capGeometry = new THREE.IcosahedronGeometry(0.15, 0);
    const bodyMaterial = new THREE.MeshBasicMaterial({ color: ARCADE_PALETTE.cyan, toneMapped: false });
    const ringMaterial = new THREE.MeshToonMaterial({ color: ARCADE_PALETTE.ink, gradientMap: this.materials.gradientMap });
    const beaconMaterial = new THREE.MeshToonMaterial({
      color: ARCADE_PALETTE.cream,
      emissive: new THREE.Color(ARCADE_PALETTE.cream),
      emissiveIntensity: 1.1,
      gradientMap: this.materials.gradientMap,
    });
    const body = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, count);
    const ring = new THREE.InstancedMesh(ringGeometry, ringMaterial, count);
    const beacon = new THREE.InstancedMesh(capGeometry, beaconMaterial, count);
    body.name = 'courseBuoyBodies';
    ring.name = 'courseBuoyFloats';
    beacon.name = 'courseBuoyBeacons';
    this.beaconMaterials.push(beaconMaterial);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    let cursor = 0;
    for (const sample of samples) {
      const sideVector = new THREE.Vector3(-sample.tangent.z, 0, sample.tangent.x);
      for (const side of [-1, 1]) {
        const tallBeacon = cursor % 10 === (side > 0 ? 1 : 0);
        const position = sample.position.clone().addScaledVector(sideVector, side * courseWidth * 0.5);
        position.y = tallBeacon ? 1.05 : 0.48;
        scale.set(tallBeacon ? 1.18 : 1, tallBeacon ? 2.4 : 1, tallBeacon ? 1.18 : 1);
        matrix.compose(position, quaternion, scale);
        body.setMatrixAt(cursor, matrix);
        position.y = 0.05;
        scale.set(tallBeacon ? 1.25 : 1, 1, tallBeacon ? 1.25 : 1);
        matrix.compose(position, quaternion, scale);
        ring.setMatrixAt(cursor, matrix);
        position.y = tallBeacon ? 2.55 : 1.17;
        scale.set(tallBeacon ? 1.35 : 1, tallBeacon ? 1.35 : 1, tallBeacon ? 1.35 : 1);
        matrix.compose(position, quaternion, scale);
        beacon.setMatrixAt(cursor, matrix);
        cursor += 1;
      }
    }
    body.instanceMatrix.needsUpdate = true;
    ring.instanceMatrix.needsUpdate = true;
    beacon.instanceMatrix.needsUpdate = true;
    this.courseRoot.add(body, ring, beacon);
    this.ownedCourseResources.push(bodyGeometry, ringGeometry, capGeometry, bodyMaterial, ringMaterial, beaconMaterial);
  }

  private createCheckpointGate(sample: CourseSample, width: number, index: number): THREE.Group {
    const gate = new THREE.Group();
    gate.name = index === 0 ? 'startFinishGate' : `checkpointGate${index}`;
    gate.position.copy(sample.position);
    gate.rotation.y = Math.atan2(sample.tangent.x, sample.tangent.z);
    const postGeometry = new THREE.CylinderGeometry(0.22, 0.34, 3.8, 8, 1);
    const postMaterial = index === 0 ? this.materials.kit.bodySecondary : this.materials.kit.shieldBoost;
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeometry, postMaterial);
      post.name = side < 0 ? 'gatePostLeft' : 'gatePostRight';
      post.position.set(side * width * 0.5, 1.72, 0);
      post.castShadow = true;
      gate.add(post, createOutlineMesh(post, this.materials.outline, 1.06));
    }
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-width * 0.5, 3.45, 0),
      new THREE.Vector3(-width * 0.28, 4.15, 0),
      new THREE.Vector3(0, 4.36, 0),
      new THREE.Vector3(width * 0.28, 4.15, 0),
      new THREE.Vector3(width * 0.5, 3.45, 0),
    ]);
    const archGeometry = new THREE.TubeGeometry(curve, 18, 0.22, 7, false);
    const arch = new THREE.Mesh(archGeometry, index === 0 ? this.materials.kit.hazard : this.materials.kit.bodySecondary);
    arch.name = 'gateArch';
    arch.castShadow = true;
    gate.add(arch, createOutlineMesh(arch, this.materials.outline, 1.045));
    const flagGeometry = new THREE.PlaneGeometry(1.12, 0.62);
    const flagMaterial = new THREE.MeshBasicMaterial({
      color: index === 0 ? ARCADE_PALETTE.sun : ARCADE_PALETTE.cream,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const flag = new THREE.Mesh(flagGeometry, flagMaterial);
    flag.name = 'gateSignalFlag';
    flag.position.set(0, 4.08, 0.02);
    gate.add(flag);
    this.ownedCourseResources.push(postGeometry, archGeometry, flagGeometry, flagMaterial);
    return gate;
  }

  private createCheckpointInstances(track: RaceTrack): void {
    const visible = track.checkpointPlanes.filter((checkpoint) => checkpoint.definition.visible);
    if (visible.length === 0) return;
    // Sector posts need to read from a distance without turning into cyan
    // screen wipes when the chase camera passes close beside one.
    const postGeometry = new THREE.CylinderGeometry(0.17, 0.29, 4.25, 8, 1);
    const signalGeometry = new THREE.OctahedronGeometry(.65, 0);
    const postMaterial = new THREE.MeshBasicMaterial({
      color: ARCADE_PALETTE.cyan,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      toneMapped: false,
    });
    const signalMaterial = new THREE.MeshBasicMaterial({ color: ARCADE_PALETTE.sun, side: THREE.DoubleSide, toneMapped: false });
    const posts = new THREE.InstancedMesh(postGeometry, postMaterial, visible.length * 2);
    const signals = new THREE.InstancedMesh(signalGeometry, signalMaterial, visible.length);
    posts.name = 'instancedCheckpointPosts';
    signals.name = 'instancedCheckpointSignals';
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    visible.forEach((checkpoint, index) => {
      const heading = Math.atan2(checkpoint.normal.x, checkpoint.normal.z);
      const visualHalfWidth = Math.min(checkpoint.halfWidth, 12);
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
      for (const side of [-1, 1]) {
        position.copy(checkpoint.center).addScaledVector(checkpoint.right, side * visualHalfWidth).setY(2.18);
        scale.set(1, 1, 1);
        matrix.compose(position, quaternion, scale);
        const instance = index * 2 + (side > 0 ? 1 : 0);
        posts.setMatrixAt(instance, matrix);
      }
      position.copy(checkpoint.center).setY(6.0);
      scale.set(1, 1.8, 1);
      matrix.compose(position, quaternion, scale);
      signals.setMatrixAt(index, matrix);
    });
    posts.instanceMatrix.needsUpdate = true;
    signals.instanceMatrix.needsUpdate = true;
    // Reuse the existing signal draw call as a thin high crossbar, completing the gate silhouette
    // without adding another persistent render pass.
    this.courseRoot.add(posts, signals);
    this.ownedCourseResources.push(postGeometry, signalGeometry, postMaterial, signalMaterial);
  }

  private createVisibleRocks(track: RaceTrack): void {
    if (track.rocks.length === 0) return;
    const geometry = new THREE.DodecahedronGeometry(1, 0);
    const material = new THREE.MeshToonMaterial({
      color: this.environment?.storm ? 0x293c47 : 0x496b6a,
      gradientMap: this.materials.gradientMap,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, track.definition.rocks.length);
    mesh.name = 'physicalRockHazards';
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    track.rocks.filter(rock => !rock.id.startsWith('landmark:')).forEach((rock, index) => {
      quaternion.setFromEuler(new THREE.Euler(0.12 * index, 0.73 * index, 0.08 * index));
      scale.set(rock.radius, rock.height, rock.radius * 0.8);
      matrix.compose(rock.center.clone().setY(rock.height * 0.34 - 0.4), quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    this.courseRoot.add(mesh);
    this.ownedCourseResources.push(geometry, material);
  }

  private clearCourse(): void {
    this.world?.dispose(); this.world = null;
    this.courseRoot.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
    this.courseRoot.clear();
    this.ownedCourseResources.forEach((resource) => resource.dispose());
    this.ownedCourseResources = [];
    this.beaconMaterials.length = 0;
  }
}
