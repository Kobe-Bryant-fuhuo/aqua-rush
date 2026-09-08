import * as THREE from 'three';
import { CurrentField } from '../game/CurrentField';
import { routeCurve } from '../game/RouteOptions';
import type { RaceTrack } from '../game/Track';
import type { WaveSurface } from '../systems/WaveSurface';

const COLORS = { safe: 0x48eaff, risk: 0xffd34f, current: 0xcd83ff };
type Marker = { point: THREE.Vector3; heading: number; zone?: number; angle?: number; radius?: number };

/** Route choices and current vectors remain legible before the driver commits. */
export class CourseFeatureVisuals {
  readonly root = new THREE.Group();
  private readonly batches: Array<{ mesh: THREE.InstancedMesh; markers: Marker[] }> = [];
  private readonly currents: CurrentField;
  private readonly matrix = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3(1.6, 1, 1.6);
  private readonly position = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(track: RaceTrack, private readonly waves: WaveSurface) {
    this.root.name = 'harborRouteChoices';
    this.currents = new CurrentField(track);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -.7,0,.6, 0,0,-.9, 0,0,.15, 0,0,-.9, .7,0,.6, 0,0,.15,
    ], 3));
    for (const route of track.definition.routes ?? []) {
      const curve = routeCurve(track, route);
      const count = Math.ceil(curve.getLength() / 4.5);
      const markers = Array.from({ length: count + 1 }, (_, i) => {
        const tangent = curve.getTangentAt(i / count);
        return { point: curve.getPointAt(i / count), heading: Math.atan2(tangent.x, -tangent.z) };
      });
      this.addBatch(geometry, COLORS[route.kind], markers);

    }
    this.currents.zones.forEach((zone, zoneIndex) => {
      const markers: Marker[] = [];
      for (const radius of [15, 22, 29]) {
        for (let i = 0; i < 22; i++) markers.push({
          point: new THREE.Vector3(), heading: 0, zone: zoneIndex, angle: i / 22 * Math.PI * 2, radius,
        });
      }
      this.addBatch(geometry, COLORS.current, markers);
      const ring = new THREE.Mesh(new THREE.RingGeometry(zone.innerRadius, zone.outerRadius, 64),
        new THREE.MeshBasicMaterial({ color: COLORS.current, transparent: true, opacity: .13, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(zone.center).setY(.55);
      this.root.add(ring);
    });
    if (!this.batches.length) geometry.dispose();
  }

  update(elapsed: number, reducedMotion: boolean): void {
    for (const { mesh, markers } of this.batches) {
      markers.forEach((marker, index) => {
        this.position.copy(marker.point);
        let heading = marker.heading;
        if (marker.zone !== undefined) {
          const zone = this.currents.zones[marker.zone];
          const angle = marker.angle! + (reducedMotion ? 0 : elapsed * zone.speed * Math.sin(Math.PI * (marker.radius! - zone.innerRadius) / (zone.outerRadius - zone.innerRadius)) ** 2 / marker.radius! * zone.spin);
          this.position.set(zone.center.x + Math.cos(angle) * marker.radius!, 0, zone.center.z + Math.sin(angle) * marker.radius!);
          this.currents.sample(this.position, this.velocity);
          heading = Math.atan2(this.velocity.x, -this.velocity.z);
        }
        this.position.y = this.waves.getHeight(this.position.x, this.position.z, elapsed) + .22;
        this.rotation.setFromAxisAngle(this.up, -heading);
        this.matrix.compose(this.position, this.rotation, this.scale);
        mesh.setMatrixAt(index, this.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    const resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
    this.root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object instanceof THREE.InstancedMesh) object.dispose();
      resources.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        resources.add(material);
        if (material instanceof THREE.MeshBasicMaterial && material.map) resources.add(material.map);
      }
    });
    resources.forEach(resource => resource.dispose());
  }

  private addBatch(geometry: THREE.BufferGeometry, color: number, markers: Marker[]): void {
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false }), markers.length);
    mesh.frustumCulled = false;
    this.batches.push({ mesh, markers });
    this.root.add(mesh);
  }

}
