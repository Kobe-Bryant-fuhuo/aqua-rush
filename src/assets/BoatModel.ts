import * as THREE from 'three';
import { ARCADE_PALETTE, createOutlineMesh, MaterialLibrary } from './Materials';

export type BoatModelOptions = {
  color?: THREE.ColorRepresentation;
  number?: number;
  outlineScale?: number;
  materials?: MaterialLibrary;
};

export type BoatModelDiagnostics = {
  meshes: number;
  geometries: number;
  materials: number;
  triangles: number;
};

type HullSection = { z: number; width: number; top: number; bottom: number };

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
  private boostAmount = 0;

  constructor(options: BoatModelOptions = {}) {
    this.root.name = 'celBoat';
    this.library = options.materials ?? new MaterialLibrary();
    this.ownsLibrary = !options.materials;
    const paint = this.library.createRacerPaint(options.color ?? ARCADE_PALETTE.sun);
    this.ownedMaterials.add(paint);
    this.engineMaterial = (this.library.kit.emissiveSignal as THREE.MeshToonMaterial).clone();
    this.engineMaterial.name = 'boatEngineSignal';
    this.ownedMaterials.add(this.engineMaterial);
    const outlineScale = options.outlineScale ?? 1.04;

    const hull = this.mesh(createTaperedHullGeometry(), paint, 'mainHull');
    hull.castShadow = true;
    hull.receiveShadow = true;
    this.root.add(hull, createOutlineMesh(hull, this.library.outline, outlineScale));

    const deckGeometry = new THREE.BoxGeometry(1.28, 0.16, 1.95, 2, 1, 3);
    deckGeometry.translate(0, 0.55, 0.18);
    const deck = this.mesh(deckGeometry, this.library.kit.bodySecondary, 'deckShell');
    deck.castShadow = true;
    this.root.add(deck, createOutlineMesh(deck, this.library.outline, 1.045));

    const canopyGeometry = new THREE.SphereGeometry(0.55, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.56);
    canopyGeometry.scale(0.82, 0.56, 1.18);
    canopyGeometry.translate(0, 0.62, -0.15);
    const canopy = this.mesh(canopyGeometry, this.library.kit.glass, 'cockpitGlass');
    canopy.castShadow = true;
    this.root.add(canopy, createOutlineMesh(canopy, this.library.outline, 1.045));

    const trimGeometry = new THREE.BoxGeometry(0.12, 0.07, 2.5);
    trimGeometry.translate(0, 0.62, -0.25);
    const centerTrim = this.mesh(trimGeometry, this.library.kit.trim, 'centerKeelTrim');
    this.root.add(centerTrim);

    for (const side of [-1, 1] as const) {
      const fin = this.mesh(createFinGeometry(side), paint, side < 0 ? 'portFin' : 'starboardFin');
      fin.castShadow = true;
      this.root.add(fin, createOutlineMesh(fin, this.library.outline, 1.025));

      const engineGeometry = new THREE.CylinderGeometry(0.24, 0.31, 0.82, 10, 1);
      engineGeometry.rotateX(Math.PI / 2);
      engineGeometry.translate(side * 0.63, 0.37, 1.17);
      const engine = this.mesh(engineGeometry, this.library.kit.trim, side < 0 ? 'leftEngine' : 'rightEngine');
      engine.castShadow = true;
      this.root.add(engine, createOutlineMesh(engine, this.library.outline, 1.045));

      const coreGeometry = new THREE.CircleGeometry(0.17, 12);
      const core = this.mesh(coreGeometry, this.engineMaterial, side < 0 ? 'leftEngineCore' : 'rightEngineCore');
      core.position.set(side * 0.63, 0.37, 1.595);
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

  /** Smooth visual state; call from the render update with speed in world units/s. */
  update(delta: number, elapsed: number, speed = 0, boost = 0): void {
    this.boostAmount = THREE.MathUtils.damp(this.boostAmount, THREE.MathUtils.clamp(boost, 0, 1), 10, delta);
    const pulse = 1 + Math.sin(elapsed * 18) * 0.08 * this.boostAmount;
    for (const core of this.engineCores) core.scale.setScalar(1 + this.boostAmount * 0.45 * pulse);
    this.engineMaterial.emissiveIntensity = 1.1 + this.boostAmount * 1.8 + Math.min(speed / 90, 0.25);
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
