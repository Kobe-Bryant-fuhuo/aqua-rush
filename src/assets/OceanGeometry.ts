import * as THREE from 'three';

/** Square annulus with exactly the same edge vertices as its adjacent patch.
 * One sheet of water per x/z point: coarse geometry cannot poke through a
 * second overlapping ocean. Perimeter resolution stays shared between rings.
 */
export function makeOceanRing(innerSize: number, outerSize: number, edgeSegments: number, radialSegments: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let side = 0; side < 4; side++) {
    const base = positions.length / 3;
    for (let row = 0; row <= radialSegments; row++) {
      const t = row / radialSegments;
      const half = THREE.MathUtils.lerp(innerSize, outerSize, t * t) / 2;
      for (let column = 0; column <= edgeSegments; column++) {
        const u = -half + (column / edgeSegments) * half * 2;
        if (side === 0) positions.push(u, 0, -half);
        if (side === 1) positions.push(half, 0, u);
        if (side === 2) positions.push(-u, 0, half);
        if (side === 3) positions.push(-half, 0, -u);
      }
    }
    for (let row = 0; row < radialSegments; row++) {
      for (let column = 0; column < edgeSegments; column++) {
        const a = base + row * (edgeSegments + 1) + column;
        const b = a + edgeSegments + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
