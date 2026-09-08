import * as THREE from 'three';
import type { WorldBlock } from '../game/WorldMechanics';

/** A solid waterline with stepped, faceted upper cliffs; no decoration intrudes into the race lane. */
export function createTerrain(blocks: readonly WorldBlock[]): THREE.Group {
  const root = new THREE.Group();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const rock = new THREE.CylinderGeometry(.36, .7, 1, 7, 3);
  const material = new THREE.MeshStandardMaterial({ roughness: .95, flatShading: true });
  const pieces: { center: THREE.Vector3; heading: number; size: number[]; color: string; crag?: boolean }[] = [];
  for (const [i, block] of blocks.entries()) {
    const heading = -Math.atan2(block.forward.x, -block.forward.z);
    const add = (x: number, y: number, z: number, size: number[], color: string, crag = false) => {
      const center = block.center.clone().addScaledVector(block.right, x).addScaledVector(block.forward, z).setY(y);
      pieces.push({ center, heading, size, color, crag });
    };
    const { width: w, length: l, height: h, style } = block;
    if (style === 'cliff') {
      add(0, .7, 0, [w, 2.4, l], '#475e60');
      for (let tier = 0; tier < 3; tier++) {
        const scale = 1 - tier * .18;
        add(0, h * (.18 + tier * .24), 0, [w * scale, h * .35, l * scale], tier === 2 ? '#526d55' : tier === 1 ? '#77867a' : '#5c706b');
        add(w * .11, h * (.35 + tier * .24), -l * .09, [w * scale * .8, h * .37, l * scale * .8], '#8b9582', true);
      }
      // Small windswept crowns read as vegetation without a separate foliage texture.
      add(-w * .12, h * .97, l * .08, [w * .42, h * .16, l * .4], '#345d4d', true);
    } else if (style === 'ruin' && !block.onRoute) {
      add(0, 1, 0, [w, 3, l], '#7c897d');
      for (const side of [-1, 1]) {
        add(side * w * .32, h / 2, 0, [w * .26, h, l * .62], '#baa988');
        add(side * w * .32, h + .4, 0, [w * .32, .8, l * .68], '#e0cbaa');
        for (let band = 1; band < 4; band++) add(side * w * .32, h * band / 4, 0, [w * .28, .28, l * .64], '#756f60');
      }
      add(0, h * .77, 0, [w * .9, h * .14, l * .55], '#c4b08c');
    } else {
      add(0, h / 2 - .2, 0, [w, h, l], '#728c96');
      add(0, h - .1, 0, [w, .35, l], '#b7c7c4');
      for (const side of [-1, 1]) {
        add(side * (w / 2 - .14), h * .48, 0, [.3, .45, l], i % 2 ? '#db9260' : '#d5c995');
      }
    }
  }
  const dummy = new THREE.Object3D();
  for (const crag of [false, true]) {
    const group = pieces.filter(piece => Boolean(piece.crag) === crag);
    if (!group.length) continue;
    const mesh = new THREE.InstancedMesh(crag ? rock : box, material, group.length);
    group.forEach((piece, i) => {
      dummy.position.copy(piece.center); dummy.rotation.set(0, piece.heading, 0);
      dummy.scale.set(piece.size[0], piece.size[1], piece.size[2]); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, new THREE.Color(piece.color));
    });
    root.add(mesh);
  }
  if (!pieces.some(p => p.crag)) rock.dispose();
  return root;
}
