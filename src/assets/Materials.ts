import * as THREE from 'three';

/** Shared palette used by the world and the DOM HUD. Keep these roles stable. */
export const ARCADE_PALETTE = {
  ink: 0x11233a,
  deepWater: 0x116b93,
  water: 0x26b7c9,
  foam: 0xf8fff2,
  sun: 0xffd85a,
  coral: 0xff5e57,
  cyan: 0x39e1e5,
  lime: 0xb9ef59,
  cream: 0xfff3d7,
  violet: 0x6955c9,
} as const;

export type ToonMaterialRole =
  | 'bodyPrimary'
  | 'bodySecondary'
  | 'trim'
  | 'hazard'
  | 'reward'
  | 'shieldBoost'
  | 'glass'
  | 'emissiveSignal'
  | 'groundContact'
  | 'decalDark'
  | 'decalLight';

export type ToonMaterialKit = Record<ToonMaterialRole, THREE.Material>;

/**
 * Three hard luminance bands. Nearest filtering is important: linear filtering
 * turns the intended graphic cel step back into a soft Lambert gradient.
 */
export function createToonGradientTexture(bands = 3): THREE.DataTexture {
  const count = Math.max(2, Math.min(4, Math.round(bands)));
  const values = count === 2 ? [74, 232] : count === 3 ? [56, 148, 255] : [42, 110, 184, 255];
  const texture = new THREE.DataTexture(new Uint8Array(values), values.length, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  texture.name = `toon-gradient-${count}-band`;
  return texture;
}

function toon(
  color: THREE.ColorRepresentation,
  gradientMap: THREE.Texture,
  options: Partial<THREE.MeshToonMaterialParameters> = {},
): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap, ...options });
}

/** A compact, reusable material library instead of scattered one-off colors. */
export class MaterialLibrary {
  readonly gradientMap = createToonGradientTexture(3);
  readonly outline = new THREE.MeshBasicMaterial({
    color: ARCADE_PALETTE.ink,
    side: THREE.BackSide,
    toneMapped: false,
  });

  readonly kit: ToonMaterialKit;

  constructor(primary: THREE.ColorRepresentation = ARCADE_PALETTE.sun) {
    this.outline.name = 'cel-outline';
    this.kit = {
      bodyPrimary: toon(primary, this.gradientMap),
      bodySecondary: toon(ARCADE_PALETTE.cream, this.gradientMap),
      trim: toon(ARCADE_PALETTE.ink, this.gradientMap),
      hazard: toon(ARCADE_PALETTE.coral, this.gradientMap, {
        emissive: new THREE.Color(0x5a1115),
        emissiveIntensity: 0.2,
      }),
      reward: toon(ARCADE_PALETTE.lime, this.gradientMap, {
        emissive: new THREE.Color(0x284b12),
        emissiveIntensity: 0.32,
      }),
      shieldBoost: toon(ARCADE_PALETTE.cyan, this.gradientMap, {
        emissive: new THREE.Color(0x075464),
        emissiveIntensity: 0.48,
      }),
      glass: toon(0x7fe7ed, this.gradientMap, {
        transparent: true,
        opacity: 0.7,
        emissive: new THREE.Color(0x0b3f57),
        emissiveIntensity: 0.25,
        depthWrite: false,
      }),
      emissiveSignal: toon(ARCADE_PALETTE.cyan, this.gradientMap, {
        emissive: new THREE.Color(ARCADE_PALETTE.cyan),
        emissiveIntensity: 1.4,
      }),
      groundContact: toon(0x173b4e, this.gradientMap),
      decalDark: new THREE.MeshBasicMaterial({ color: ARCADE_PALETTE.ink, toneMapped: false }),
      decalLight: new THREE.MeshBasicMaterial({ color: ARCADE_PALETTE.cream, toneMapped: false }),
    };

    for (const [name, material] of Object.entries(this.kit)) material.name = name;
  }

  /** Create a palette-safe racer color while keeping the shared toon ramp. */
  createRacerPaint(color: THREE.ColorRepresentation): THREE.MeshToonMaterial {
    const material = toon(color, this.gradientMap);
    material.name = 'racerPaint';
    return material;
  }

  dispose(): void {
    this.gradientMap.dispose();
    this.outline.dispose();
    const unique = new Set(Object.values(this.kit));
    unique.forEach((material) => material.dispose());
  }
}

/**
 * Build a cheap inverted-hull outline that shares the source geometry.
 * Attach it beside its source mesh; do not use it as a collision object.
 */
export function createOutlineMesh(
  source: THREE.Mesh,
  material: THREE.Material,
  scale = 1.035,
): THREE.Mesh {
  const outline = new THREE.Mesh(source.geometry, material);
  outline.name = `${source.name || 'mesh'}Outline`;
  outline.position.copy(source.position);
  outline.quaternion.copy(source.quaternion);
  outline.scale.copy(source.scale).multiplyScalar(scale);
  outline.renderOrder = source.renderOrder - 1;
  outline.castShadow = false;
  outline.receiveShadow = false;
  return outline;
}
