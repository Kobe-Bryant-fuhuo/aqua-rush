import * as THREE from 'three';
import type { RaceTrack } from '../game/Track';
import { createTerrain } from './WorldTerrain';

/** Instanced waterfront architecture, real ramp surfaces and synchronized moving locks. */
export class WorldScenery {
  readonly root = new THREE.Group();
  private readonly locks: THREE.InstancedMesh;
  private readonly lockLights: THREE.InstancedMesh;
  private readonly cabins: THREE.InstancedMesh;
  private readonly warningLights: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly scale = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly textures: THREE.Texture[] = [];

  constructor(private readonly track: RaceTrack) {
    this.root.name = 'authoredWorld';
    const box = new THREE.BoxGeometry(1, 1, 1);
    const night = track.definition.id === 'nightfall';
    const stone = new THREE.MeshStandardMaterial({ color: night ? 0x25364e : 0x94a7a5, roughness: .88, metalness: .1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x233b47, roughness: .8 });
    const glow = new THREE.MeshBasicMaterial({ color: night ? 0x5df4ea : 0xffa96a, toneMapped: false });
    const buildings = track.mechanics.blocks.filter(b => b.style === 'building');
    const terrain = track.mechanics.blocks.filter(b => b.style !== 'building');
    this.root.add(createTerrain(terrain));
    if (buildings.length) {
      const facade = this.facade();
      const material = new THREE.MeshStandardMaterial({ color: 0x466583, map: facade, emissiveMap: facade, emissive: 0x73dbff, emissiveIntensity: .5, roughness: .55 });
      const towers = new THREE.InstancedMesh(box, material, buildings.length);
      const roofs = new THREE.InstancedMesh(box, glow, buildings.length);
      buildings.forEach((building, index) => {
        const heading = -Math.atan2(building.forward.x, -building.forward.z);
        this.transform(building.center, heading, building.width, building.height, building.length);
        towers.setMatrixAt(index, this.matrix);
        this.point.copy(building.center).setY(building.height + .15);
        this.transform(this.point, heading, building.width + .25, .3, building.length + .25, false);
        roofs.setMatrixAt(index, this.matrix);
      });
      this.root.add(towers, roofs);
    }
    for (const ramp of track.mechanics.ramps) {
      const w = ramp.width / 2, l = ramp.length / 2, h = ramp.height;
      const shape = new THREE.BufferGeometry();
      shape.setAttribute('position', new THREE.Float32BufferAttribute([
        -w,0,l, w,0,l, -w,h,-l, w,0,l, w,h,-l, -w,h,-l,
        -w,0,l, -w,h,-l, -w,0,-l, w,0,l, w,0,-l, w,h,-l,
        -w,0,-l, -w,h,-l, w,h,-l, -w,0,-l, w,h,-l, w,0,-l,
      ], 3));
      shape.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({ color: 0xed824b, roughness: .6, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(shape, material);
      mesh.position.copy(ramp.center);
      mesh.rotation.y = -Math.atan2(ramp.forward.x, -ramp.forward.z);
      this.root.add(mesh);
      const edge = new THREE.EdgesGeometry(shape, 25);
      const outline = new THREE.LineSegments(edge, new THREE.LineBasicMaterial({ color: 0xffd7a0, toneMapped: false }));
      mesh.add(outline);
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(.8, 2.8, 3), glow);
      arrow.rotation.x = -Math.PI / 2;
      arrow.position.set(0, h + 1.5, -l);
      mesh.add(arrow);
    }
    // The megastructures cross above the reachable flight envelope; their piers are authored blocks.
    if (track.definition.id === 'sunken-temple') {
      for (const p of [.27, .61]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(29, 2.3, 8, 64), new THREE.MeshStandardMaterial({ color: 0xd6c6a2, roughness: .75, metalness: .25 }));
        ring.position.copy(track.getPointAt(p)).setY(18);
        ring.rotation.y = -track.headingAt(p);
        this.root.add(ring);
        const inset = new THREE.Mesh(new THREE.TorusGeometry(26, .25, 5, 64), glow);
        ring.add(inset);
      }
    } else {
      for (const p of track.definition.id === 'breakwater' ? [.27, .72] : [.16, .4, .69]) {
        const bridge = new THREE.Mesh(box, dark);
        bridge.position.copy(track.getPointAt(p)).setY(track.definition.id === 'breakwater' ? 40 : 19);
        bridge.scale.set(78, track.definition.id === 'breakwater' ? 7 : 2.5, 8);
        bridge.rotation.y = -track.headingAt(p);
        this.root.add(bridge);
        const strip = new THREE.Mesh(box, glow);
        strip.scale.set(1, .045, 1.025);
        strip.position.y = -.48;
        bridge.add(strip);
      }
    }
    const count = track.definition.crossings?.length ?? 0;
    this.locks = new THREE.InstancedMesh(box, stone, count);
    this.lockLights = new THREE.InstancedMesh(box, glow, count);
    this.cabins = new THREE.InstancedMesh(box, dark, count);
    this.warningLights = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1), glow, count * 2);
    this.root.add(this.locks, this.lockLights, this.cabins, this.warningLights);
    this.update(0);
  }

  update(elapsed: number): void {
    (this.track.definition.crossings ?? []).forEach((spec, i) => {
      const state = this.track.mechanics.crossing(spec, elapsed), block = state.block;
      const heading = -Math.atan2(block.forward.x, -block.forward.z);
      this.transform(block.center, heading, block.width, 2.2, block.length);
      this.locks.setMatrixAt(i, this.matrix);
      this.point.copy(block.center).setY(2.3);
      this.transform(this.point, heading, block.width + .2, .3, block.length + .2, false);
      this.lockLights.setMatrixAt(i, this.matrix);
      const color = new THREE.Color(state.phase === 'crossing' ? '#ff5e57' : state.phase === 'warning' ? '#ffd85a' : '#39e1e5');
      this.lockLights.setColorAt(i, color);
      this.point.copy(block.center).addScaledVector(block.right, -3).setY(2.8);
      this.transform(this.point, heading, 4, 1.4, 5, false);
      this.cabins.setMatrixAt(i, this.matrix);
      for (const [index, side] of [-1, 1].entries()) {
        this.point.copy(this.track.getOffsetPoint(spec.progress - .025, side * 17)).setY(5);
        this.transform(this.point, heading, .8, 1.5, .8, false);
        this.warningLights.setMatrixAt(i * 2 + index, this.matrix);
        this.warningLights.setColorAt(i * 2 + index, color);
      }
    });
    this.locks.instanceMatrix.needsUpdate = true;
    this.lockLights.instanceMatrix.needsUpdate = true;
    if (this.lockLights.instanceColor) this.lockLights.instanceColor.needsUpdate = true;
    this.cabins.instanceMatrix.needsUpdate = this.warningLights.instanceMatrix.needsUpdate = true;
    if (this.warningLights.instanceColor) this.warningLights.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.root.removeFromParent();
    const resources = new Set<THREE.BufferGeometry | THREE.Material>();
    this.root.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        if (object instanceof THREE.InstancedMesh) object.dispose();
        resources.add(object.geometry);
        (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => resources.add(m));
      }
    });
    resources.forEach(r => r.dispose()); this.textures.forEach(t => t.dispose());
  }

  private transform(center: THREE.Vector3, heading: number, w: number, h: number, l: number, grounded = true): void {
    this.quaternion.setFromAxisAngle(this.up, heading);
    this.point.copy(center); if (grounded) this.point.y = h / 2 - .2;
    this.scale.set(w, h, l); this.matrix.compose(this.point, this.quaternion, this.scale);
  }

  private facade(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0c182c'; ctx.fillRect(0, 0, 128, 256);
    for (let row = 0; row < 16; row++) for (let col = 0; col < 8; col++) {
      ctx.fillStyle = (row * 7 + col * 3) % 5 === 0 ? '#fbcba0' : (row + col) % 3 ? '#45879d' : '#172b40';
      ctx.fillRect(col * 16 + 4, row * 16 + 4, 6, 8);
    }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(texture); return texture;
  }
}
