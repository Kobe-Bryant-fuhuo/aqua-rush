import * as THREE from 'three';
import { ARCADE_PALETTE, createOutlineMesh, MaterialLibrary } from './Materials';

export type BoatModelOptions = {
  color?: THREE.ColorRepresentation;
  number?: number;
  outlineScale?: number;
  materials?: MaterialLibrary;
  /** Visual identity only. Collision and handling remain owned by ArcadeBoat. */
  profile?: BoatProfile;
};

export type BoatProfile = 'hero' | 'kai' | 'mira' | 'nox';

export type BoatAnimationState = {
  speed?: number;
  boost?: number;
  turn?: number;
  throttle?: number;
  drift?: number;
  airborne?: number | boolean;
  landing?: number;
  finished?: boolean;
};

export type BoatModelDiagnostics = {
  meshes: number;
  geometries: number;
  materials: number;
  triangles: number;
};

type HullSection = { z: number; width: number; top: number; bottom: number };

type ProfileShape = {
  hullWidth: number;
  hullLength: number;
  deckWidth: number;
  canopyScale: readonly [number, number, number];
  finScale: readonly [number, number];
  engineSpread: number;
  riderLean: number;
};

const PROFILE_SHAPES: Record<BoatProfile, ProfileShape> = {
  hero: {
    hullWidth: 1,
    hullLength: 1,
    deckWidth: 1,
    canopyScale: [1, 1, 1],
    finScale: [1, 1],
    engineSpread: 1,
    riderLean: 0.06,
  },
  // KAI: planted, broad and visibly armoured.
  kai: {
    hullWidth: 1.14,
    hullLength: 0.98,
    deckWidth: 1.13,
    canopyScale: [1.08, 0.91, 0.9],
    finScale: [1.22, 1.22],
    engineSpread: 1.16,
    riderLean: 0.13,
  },
  // MIRA: narrow long-line hydroplane silhouette.
  mira: {
    hullWidth: 0.9,
    hullLength: 1.1,
    deckWidth: 0.86,
    canopyScale: [0.84, 0.86, 1.32],
    finScale: [0.78, 0.78],
    engineSpread: 0.83,
    riderLean: 0.1,
  },
  // NOX: deliberately asymmetric stabilisers make the outline twitchy/readable.
  nox: {
    hullWidth: 1.02,
    hullLength: 0.94,
    deckWidth: 0.98,
    canopyScale: [0.94, 1.04, 0.92],
    finScale: [1.38, 0.72],
    engineSpread: 1.02,
    riderLean: 0.18,
  },
};

function createTaperedHullGeometry(): THREE.BufferGeometry {
  const sections: HullSection[] = [
    { z: -2.22, width: 0.06, top: 0.2, bottom: 0.02 },
    { z: -1.38, width: 0.62, top: 0.42, bottom: -0.2 },
    { z: -0.18, width: 0.92, top: 0.52, bottom: -0.34 },
    { z: 1.18, width: 0.76, top: 0.45, bottom: -0.27 },
    { z: 1.62, width: 0.58, top: 0.31, bottom: -0.12 },
  ];
  const positions: number[] = [];
  const indices: number[] = [];

  for (const section of sections) {
    positions.push(
      -section.width, section.top, section.z,
      section.width, section.top, section.z,
      -section.width * 0.72, section.bottom, section.z,
      section.width * 0.72, section.bottom, section.z,
    );
  }

  for (let section = 0; section < sections.length - 1; section += 1) {
    const a = section * 4;
    const b = (section + 1) * 4;
    // Deck, port, starboard, and keel panels. Intentional facets catch toon bands.
    indices.push(
      a, b + 1, a + 1, a, b, b + 1,
      a, a + 2, b + 2, a, b + 2, b,
      a + 1, b + 3, a + 3, a + 1, b + 1, b + 3,
      a + 2, a + 3, b + 3, a + 2, b + 3, b + 2,
    );
  }
  indices.push(0, 1, 3, 0, 3, 2);
  const end = (sections.length - 1) * 4;
  indices.push(end, end + 3, end + 1, end, end + 2, end + 3);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.name = 'authoredTaperedHull';
  return geometry;
}

function createFinGeometry(side: -1 | 1): THREE.BufferGeometry {
  const x0 = 0.64 * side;
  const x1 = 1.26 * side;
  const positions = [
    x0, 0.25, 0.2,
    x1, 0.2, 0.78,
    x0, 0.25, 1.22,
    x0, 0.12, 0.2,
    x1, 0.1, 0.78,
    x0, 0.12, 1.22,
  ];
  const indices = [
    0, 1, 2, 5, 4, 3,
    0, 3, 4, 0, 4, 1,
    1, 4, 5, 1, 5, 2,
    2, 5, 3, 2, 3, 0,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.name = side < 0 ? 'portHydroFin' : 'starboardHydroFin';
  return geometry;
}

function makeNumberBadge(value: number): THREE.Group {
  const badge = new THREE.Group();
  badge.name = 'racerNumberBadge';
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return badge;
  context.fillStyle = '#fff3d7';
  context.beginPath();
  context.roundRect(10, 10, 108, 108, 24);
  context.fill();
  context.strokeStyle = '#11233a';
  context.lineWidth = 12;
  context.stroke();
  context.fillStyle = '#11233a';
  context.font = '900 70px Arial Black, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(String(Math.max(0, value) % 100).padStart(2, '0'), 64, 65);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.52), material);
  plate.name = 'numberDecal';
  plate.rotation.x = -Math.PI / 2;
  plate.position.set(0, 0.742, 0.24);
  badge.add(plate);
  badge.userData.dispose = () => {
    plate.geometry.dispose();
    material.dispose();
    texture.dispose();
  };
  return badge;
}

/** Authored cel-shaded racer. Natural forward direction is local -Z. */
export class BoatModel {
  readonly root = new THREE.Group();
  readonly collision: THREE.Mesh;
  readonly profile: BoatProfile;
  readonly wakeSockets = {
    left: new THREE.Object3D(),
    right: new THREE.Object3D(),
    center: new THREE.Object3D(),
  };
  readonly bowSpraySocket = new THREE.Object3D();
  readonly diagnostics: BoatModelDiagnostics;

  private readonly ownedGeometries = new Set<THREE.BufferGeometry>();
  private readonly ownedMaterials = new Set<THREE.Material>();
  private readonly library: MaterialLibrary;
  private readonly ownsLibrary: boolean;
  private readonly engineMaterial: THREE.MeshToonMaterial;
  private readonly engineCores: THREE.Mesh[] = [];
  private readonly riderRoot = new THREE.Group();
  private readonly riderTorso = new THREE.Group();
  private readonly riderHead = new THREE.Group();
  private readonly riderLeftArm = new THREE.Group();
  private readonly riderRightArm = new THREE.Group();
  private readonly riderLeftLeg = new THREE.Group();
  private readonly riderRightLeg = new THREE.Group();
  private readonly riderBasePosition = new THREE.Vector3();
  private riderTurn = 0;
  private riderThrottle = 0;
  private riderDrift = 0;
  private riderAirborne = 0;
  private riderLanding = 0;
  private riderFinish = 0;
  private riderLeanBase = 0;
  private boostAmount = 0;

  constructor(options: BoatModelOptions = {}) {
    this.root.name = 'celBoat';
    this.profile = options.profile ?? 'hero';
    const shape = PROFILE_SHAPES[this.profile];
    this.library = options.materials ?? new MaterialLibrary();
    this.ownsLibrary = !options.materials;
    const paint = this.library.createRacerPaint(options.color ?? ARCADE_PALETTE.sun);
    this.ownedMaterials.add(paint);
    this.engineMaterial = (this.library.kit.emissiveSignal as THREE.MeshToonMaterial).clone();
    this.engineMaterial.name = 'boatEngineSignal';
    this.ownedMaterials.add(this.engineMaterial);
    const outlineScale = options.outlineScale ?? 1.04;

    const hull = this.mesh(createTaperedHullGeometry(), paint, 'mainHull');
    hull.scale.set(shape.hullWidth, 1, shape.hullLength);
    hull.castShadow = true;
    hull.receiveShadow = true;
    this.root.add(hull, createOutlineMesh(hull, this.library.outline, outlineScale));

    const deckGeometry = new THREE.BoxGeometry(1.28, 0.16, 1.95, 2, 1, 3);
    deckGeometry.translate(0, 0.55, 0.18);
    const deck = this.mesh(deckGeometry, this.library.kit.bodySecondary, 'deckShell');
    deck.scale.x = shape.deckWidth;
    deck.castShadow = true;
    this.root.add(deck, createOutlineMesh(deck, this.library.outline, 1.045));

    const canopyGeometry = new THREE.SphereGeometry(0.55, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.56);
    canopyGeometry.scale(0.82, 0.56, 1.18);
    canopyGeometry.translate(0, 0.62, -0.15);
    const canopy = this.mesh(canopyGeometry, this.library.kit.glass, 'cockpitGlass');
    canopy.scale.set(...shape.canopyScale);
    canopy.castShadow = true;
    this.root.add(canopy, createOutlineMesh(canopy, this.library.outline, 1.045));

    const trimGeometry = new THREE.BoxGeometry(0.12, 0.07, 2.5);
    trimGeometry.translate(0, 0.62, -0.25);
    const centerTrim = this.mesh(trimGeometry, this.library.kit.trim, 'centerKeelTrim');
    this.root.add(centerTrim);

    for (const side of [-1, 1] as const) {
      const fin = this.mesh(createFinGeometry(side), paint, side < 0 ? 'portFin' : 'starboardFin');
      const finScale = side < 0 ? shape.finScale[0] : shape.finScale[1];
      fin.scale.set(finScale, 1, this.profile === 'mira' ? 1.18 : 1);
      fin.castShadow = true;
      this.root.add(fin, createOutlineMesh(fin, this.library.outline, 1.025));

      const engineGeometry = new THREE.CylinderGeometry(0.24, 0.31, 0.82, 10, 1);
      engineGeometry.rotateX(Math.PI / 2);
      engineGeometry.translate(side * 0.63, 0.37, 1.17);
      const engine = this.mesh(engineGeometry, this.library.kit.trim, side < 0 ? 'leftEngine' : 'rightEngine');
      engine.position.x = side * 0.63 * (shape.engineSpread - 1);
      engine.castShadow = true;
      this.root.add(engine, createOutlineMesh(engine, this.library.outline, 1.045));

      const coreGeometry = new THREE.CircleGeometry(0.17, 12);
      const core = this.mesh(coreGeometry, this.engineMaterial, side < 0 ? 'leftEngineCore' : 'rightEngineCore');
      core.position.set(side * 0.63 * shape.engineSpread, 0.37, 1.595);
      this.root.add(core);
      this.engineCores.push(core);
    }

    const railCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.58, 0.62, -0.75),
      new THREE.Vector3(-0.72, 0.66, 0.12),
      new THREE.Vector3(-0.61, 0.6, 0.98),
    ]);
    for (const side of [-1, 1] as const) {
      const curve = side < 0
        ? railCurve
        : new THREE.CatmullRomCurve3(railCurve.points.map((point) => new THREE.Vector3(-point.x, point.y, point.z)));
      const rail = this.mesh(new THREE.TubeGeometry(curve, 12, 0.035, 5, false), this.library.kit.decalLight, side < 0 ? 'portRail' : 'starboardRail');
      this.root.add(rail);
    }

    this.addProfileSilhouette(this.profile, paint);
    this.createRider(paint, shape.riderLean);

    const badge = makeNumberBadge(options.number ?? 7);
    this.root.add(badge);

    const collisionGeometry = new THREE.BoxGeometry(1.65, 0.7, 3.35);
    const collisionMaterial = new THREE.MeshBasicMaterial({ visible: false });
    this.ownedGeometries.add(collisionGeometry);
    this.ownedMaterials.add(collisionMaterial);
    this.collision = new THREE.Mesh(collisionGeometry, collisionMaterial);
    this.collision.name = 'collisionProxy';
    this.collision.position.y = 0.18;
    this.root.add(this.collision);

    this.wakeSockets.left.position.set(-0.52, -0.08, 1.54);
    this.wakeSockets.right.position.set(0.52, -0.08, 1.54);
    this.wakeSockets.center.position.set(0, -0.1, 1.72);
    this.bowSpraySocket.position.set(0, -0.02, -1.7);
    this.wakeSockets.left.name = 'wakeSocketLeft';
    this.wakeSockets.right.name = 'wakeSocketRight';
    this.wakeSockets.center.name = 'wakeSocketCenter';
    this.bowSpraySocket.name = 'bowSpraySocket';
    this.root.add(this.wakeSockets.left, this.wakeSockets.right, this.wakeSockets.center, this.bowSpraySocket);

    this.diagnostics = this.measureDiagnostics();
  }

  private addProfileSilhouette(profile: BoatProfile, paint: THREE.Material): void {
    if (profile === 'kai') {
      for (const side of [-1, 1] as const) {
        const pod = this.mesh(new THREE.BoxGeometry(0.34, 0.34, 1.42, 1, 1, 2), paint, side < 0 ? 'kaiPortArmor' : 'kaiStarboardArmor');
        pod.position.set(side * 0.92, 0.4, 0.32);
        pod.rotation.z = side * 0.08;
        pod.castShadow = true;
        this.root.add(pod, createOutlineMesh(pod, this.library.outline, 1.055));
      }
      const ram = this.mesh(new THREE.ConeGeometry(0.42, 0.86, 4), this.library.kit.trim, 'kaiRamBow');
      ram.rotation.x = -Math.PI / 2;
      ram.rotation.y = Math.PI / 4;
      ram.position.set(0, 0.22, -2.34);
      this.root.add(ram, createOutlineMesh(ram, this.library.outline, 1.06));
      const spoiler = this.mesh(new THREE.BoxGeometry(2.05, 0.12, 0.28), this.library.kit.trim, 'kaiRearSpoiler');
      spoiler.position.set(0, 0.79, 1.16);
      this.root.add(spoiler, createOutlineMesh(spoiler, this.library.outline, 1.055));
    } else if (profile === 'mira') {
      const nose = this.mesh(new THREE.ConeGeometry(0.2, 1.05, 5), paint, 'miraNeedleBow');
      nose.rotation.x = -Math.PI / 2;
      nose.position.set(0, 0.36, -2.35);
      this.root.add(nose, createOutlineMesh(nose, this.library.outline, 1.055));
      const dorsal = this.mesh(new THREE.BoxGeometry(0.08, 0.58, 0.86), this.library.kit.trim, 'miraDorsalFin');
      dorsal.position.set(0, 0.82, 1.02);
      dorsal.rotation.x = -0.18;
      this.root.add(dorsal, createOutlineMesh(dorsal, this.library.outline, 1.07));
      for (const side of [-1, 1] as const) {
        const foil = this.mesh(new THREE.BoxGeometry(0.54, 0.055, 0.16), this.library.kit.decalLight, side < 0 ? 'miraPortFoil' : 'miraStarboardFoil');
        foil.position.set(side * 0.72, 0.3, -0.62);
        this.root.add(foil);
      }
    } else if (profile === 'nox') {
      const portBoom = this.mesh(new THREE.BoxGeometry(0.24, 0.2, 1.7), paint, 'noxLongPortBoom');
      portBoom.position.set(-1.05, 0.36, 0.32);
      portBoom.rotation.z = -0.07;
      this.root.add(portBoom, createOutlineMesh(portBoom, this.library.outline, 1.06));
      const starboardBlade = this.mesh(new THREE.BoxGeometry(0.5, 0.08, 0.2), this.library.kit.trim, 'noxShortStarboardBlade');
      starboardBlade.position.set(0.82, 0.56, -0.38);
      starboardBlade.rotation.y = 0.22;
      this.root.add(starboardBlade, createOutlineMesh(starboardBlade, this.library.outline, 1.06));
      const antenna = this.mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.92, 6), this.library.kit.trim, 'noxOffsetAntenna');
      antenna.position.set(-0.38, 1.08, 0.58);
      antenna.rotation.z = -0.16;
      this.root.add(antenna);
      const antennaTip = this.mesh(new THREE.OctahedronGeometry(0.11, 0), this.engineMaterial, 'noxAntennaSignal');
      antennaTip.position.set(-0.45, 1.55, 0.58);
      this.root.add(antennaTip);
    }
  }

  private createRider(paint: THREE.Material, lean: number): void {
    this.riderLeanBase = lean;
    this.riderRoot.name = `${this.profile}Rider`;
    this.riderRoot.position.set(0, 0.95, 0.08);
    this.riderBasePosition.copy(this.riderRoot.position);
    this.riderTorso.name = 'riderBodyPivot';
    this.riderHead.name = 'riderHeadPivot';
    this.riderLeftArm.name = 'riderLeftArmPivot';
    this.riderRightArm.name = 'riderRightArmPivot';
    this.riderLeftLeg.name = 'riderLeftLegPivot';
    this.riderRightLeg.name = 'riderRightLegPivot';

    const torsoGeometry = new THREE.BoxGeometry(0.46, 0.52, 0.28, 1, 2, 1);
    torsoGeometry.translate(0, 0.23, 0);
    const torso = this.mesh(torsoGeometry, paint, 'riderBody');
    torso.castShadow = true;
    this.riderTorso.add(torso, createOutlineMesh(torso, this.library.outline, 1.075));

    this.riderHead.position.set(0, 0.64, -0.04);
    const helmet = this.mesh(new THREE.IcosahedronGeometry(0.235, 1), this.library.kit.bodySecondary, 'riderHead');
    helmet.scale.set(1, 1.06, 0.94);
    helmet.castShadow = true;
    const helmetOutline = createOutlineMesh(helmet, this.library.outline, 1.085);
    const visor = this.mesh(new THREE.BoxGeometry(0.34, 0.1, 0.08), this.library.kit.glass, 'riderVisor');
    visor.position.set(0, 0.015, -0.205);
    this.riderHead.add(helmet, helmetOutline, visor);

    const armGeometry = new THREE.CylinderGeometry(0.06, 0.085, 0.43, 6, 1);
    armGeometry.translate(0, -0.18, 0);
    const legGeometry = new THREE.CylinderGeometry(0.075, 0.1, 0.46, 6, 1);
    legGeometry.translate(0, -0.19, 0);
    for (const [pivot, side, geometry, name] of [
      [this.riderLeftArm, -1, armGeometry, 'riderLeftArm'],
      [this.riderRightArm, 1, armGeometry, 'riderRightArm'],
      [this.riderLeftLeg, -1, legGeometry, 'riderLeftLeg'],
      [this.riderRightLeg, 1, legGeometry, 'riderRightLeg'],
    ] as const) {
      const isArm = geometry === armGeometry;
      pivot.position.set(side * (isArm ? 0.28 : 0.16), isArm ? 0.43 : 0.06, isArm ? -0.02 : 0.09);
      const limb = this.mesh(geometry, isArm ? paint : this.library.kit.trim, name);
      limb.castShadow = true;
      pivot.add(limb);
      if (isArm) this.riderTorso.add(pivot);
      else this.riderRoot.add(pivot);
    }

    const bars = this.mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6), this.library.kit.trim, 'riderHandlebars');
    bars.rotation.z = Math.PI / 2;
    bars.position.set(0, 0.12, -0.38);
    this.riderRoot.add(bars);
    this.riderTorso.add(this.riderHead);
    this.riderRoot.add(this.riderTorso);
    this.root.add(this.riderRoot);
  }

  /**
   * Smooth visual state. The numeric form is retained for V1 callers; V2 can
   * pass steering/drift/water-contact state without coupling the model to physics.
   */
  update(delta: number, elapsed: number, state?: BoatAnimationState): void;
  update(delta: number, elapsed: number, speed?: number, boost?: number): void;
  update(
    delta: number,
    elapsed: number,
    speedOrState: number | BoatAnimationState = 0,
    legacyBoost = 0,
  ): void {
    const isLegacy = typeof speedOrState === 'number';
    const state = isLegacy ? undefined : speedOrState;
    const speed = isLegacy ? speedOrState : (state?.speed ?? 0);
    const boost = isLegacy ? legacyBoost : (state?.boost ?? 0);
    const airborneState = state?.airborne;
    const airborne = typeof airborneState === 'boolean' ? Number(airborneState) : (airborneState ?? 0);
    this.boostAmount = THREE.MathUtils.damp(this.boostAmount, THREE.MathUtils.clamp(boost, 0, 1), 10, delta);
    const pulse = 1 + Math.sin(elapsed * 18) * 0.08 * this.boostAmount;
    for (const core of this.engineCores) core.scale.setScalar(1 + this.boostAmount * 0.45 * pulse);
    this.engineMaterial.emissiveIntensity = 1.1 + this.boostAmount * 1.8 + Math.min(speed / 90, 0.25);

    this.riderTurn = THREE.MathUtils.damp(this.riderTurn, THREE.MathUtils.clamp(state?.turn ?? 0, -1, 1), 12, delta);
    this.riderThrottle = THREE.MathUtils.damp(this.riderThrottle, THREE.MathUtils.clamp(state?.throttle ?? speed / 24, -1, 1), 7, delta);
    this.riderDrift = THREE.MathUtils.damp(this.riderDrift, THREE.MathUtils.clamp(state?.drift ?? 0, 0, 1), 10, delta);
    this.riderAirborne = THREE.MathUtils.damp(this.riderAirborne, THREE.MathUtils.clamp(airborne, 0, 1), 8, delta);
    this.riderLanding = THREE.MathUtils.damp(this.riderLanding, THREE.MathUtils.clamp(state?.landing ?? 0, 0, 1), 15, delta);
    this.riderFinish = THREE.MathUtils.damp(this.riderFinish, state?.finished ? 1 : 0, 5, delta);

    const steerLean = -this.riderTurn * (0.24 + this.riderDrift * 0.14);
    const speedBob = Math.sin(elapsed * (7 + Math.min(speed, 30) * 0.13)) * Math.min(speed / 28, 1) * 0.018;
    this.riderRoot.position.y = this.riderBasePosition.y + speedBob + this.riderAirborne * 0.045 - this.riderLanding * 0.08;
    this.riderRoot.rotation.x = -this.riderLeanBase - this.riderThrottle * 0.12 + this.riderAirborne * 0.15;
    this.riderRoot.rotation.z = steerLean;
    this.riderTorso.rotation.y = this.riderTurn * 0.08;
    this.riderTorso.scale.set(1 + this.riderLanding * 0.05, 1 - this.riderLanding * 0.12, 1);
    this.riderHead.rotation.z = -steerLean * 0.42;
    this.riderHead.rotation.y = -this.riderTurn * 0.16 + Math.sin(elapsed * 6) * 0.22 * this.riderFinish;
    this.riderLeftArm.rotation.x = -0.68 - this.riderThrottle * 0.12 + this.riderAirborne * 0.28;
    this.riderLeftArm.rotation.z = -0.18 - this.riderTurn * 0.16;
    this.riderRightArm.rotation.x = THREE.MathUtils.lerp(-0.68 - this.riderThrottle * 0.12, -2.65, this.riderFinish);
    this.riderRightArm.rotation.z = THREE.MathUtils.lerp(0.18 - this.riderTurn * 0.16, 0.45 + Math.sin(elapsed * 9) * 0.3, this.riderFinish);
    this.riderLeftLeg.rotation.x = 0.2 + this.riderAirborne * 0.25 - this.riderLanding * 0.2;
    this.riderRightLeg.rotation.x = 0.2 + this.riderAirborne * 0.18 - this.riderLanding * 0.2;
  }

  dispose(): void {
    this.root.traverse((object) => {
      const dispose = object.userData.dispose as (() => void) | undefined;
      dispose?.();
    });
    this.ownedGeometries.forEach((geometry) => geometry.dispose());
    this.ownedMaterials.forEach((material) => material.dispose());
    if (this.ownsLibrary) this.library.dispose();
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material, name: string): THREE.Mesh {
    this.ownedGeometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    return mesh;
  }

  private measureDiagnostics(): BoatModelDiagnostics {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    let meshes = 0;
    let triangles = 0;
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object === this.collision) return;
      meshes += 1;
      geometries.add(object.geometry);
      const source = Array.isArray(object.material) ? object.material : [object.material];
      source.forEach((material) => materials.add(material));
      triangles += object.geometry.index
        ? object.geometry.index.count / 3
        : (object.geometry.getAttribute('position')?.count ?? 0) / 3;
    });
    return { meshes, geometries: geometries.size, materials: materials.size, triangles: Math.round(triangles) };
  }
}

export function createBoatModel(options: BoatModelOptions = {}): BoatModel {
  return new BoatModel(options);
}
