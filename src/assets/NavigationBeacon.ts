import * as THREE from 'three';

/** One-call off-course beacon pointing at the next legal checkpoint. */
export class NavigationBeacon {
  readonly root = new THREE.Group();
  private readonly material = new THREE.MeshBasicMaterial({ color: '#39e1e5', transparent: true, opacity: 0.88, toneMapped: false });
  private readonly geometry = new THREE.ConeGeometry(0.8, 3.4, 4, 1, true);
  private readonly mesh = new THREE.Mesh(this.geometry, this.material);

  constructor() {
    this.root.name = 'offCourseRecoveryBeacon';
    this.mesh.name = 'recoveryBeaconArrow';
    this.mesh.rotation.z = Math.PI;
    this.root.add(this.mesh);
    this.root.visible = false;
  }

  update(elapsed: number, target: THREE.Vector3, visible: boolean): void {
    this.root.visible = visible;
    if (!visible) return;
    this.root.position.copy(target);
    this.root.position.y = 5.2 + Math.sin(elapsed * 3.2) * 0.45;
    this.root.rotation.y = elapsed * 0.65;
    this.material.opacity = 0.68 + Math.sin(elapsed * 5.4) * 0.2;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
