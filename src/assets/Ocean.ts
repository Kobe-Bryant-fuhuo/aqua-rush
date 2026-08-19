import * as THREE from 'three';
import { ARCADE_PALETTE } from './Materials';

export type OceanOptions = {
  size?: number;
  segments?: number;
  waterColor?: THREE.ColorRepresentation;
  deepColor?: THREE.ColorRepresentation;
  foamColor?: THREE.ColorRepresentation;
  y?: number;
};

export type WaveSample = {
  height: number;
  normal: THREE.Vector3;
};

function waveHeight(x: number, z: number, time: number): number {
  return (
    Math.sin((x * 0.94 + z * 0.34) * 0.105 + time * 0.88 + 0.2) * 0.22 +
    Math.sin((x * -0.29 + z * 0.96) * 0.18 + time * 1.22 + 1.8) * 0.14 +
    Math.sin((x * 0.66 + z * -0.75) * 0.31 + time * 1.65 + 3.1) * 0.08
  );
}

function waveDerivatives(x: number, z: number, time: number): { dx: number; dz: number } {
  const first = Math.cos((x * 0.94 + z * 0.34) * 0.105 + time * 0.88 + 0.2) * 0.22 * 0.105;
  const second = Math.cos((x * -0.29 + z * 0.96) * 0.18 + time * 1.22 + 1.8) * 0.14 * 0.18;
  const third = Math.cos((x * 0.66 + z * -0.75) * 0.31 + time * 1.65 + 3.1) * 0.08 * 0.31;
  return {
    dx: first * 0.94 + second * -0.29 + third * 0.66,
    dz: first * 0.34 + second * 0.96 + third * -0.75,
  };
}

/** Finite shader ocean whose far edge is intended to sit inside scene fog. */
export class OceanVisual {
  readonly root = new THREE.Group();
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly material: THREE.ShaderMaterial;
  readonly size: number;

  private currentTime = 0;
  private readonly reusableNormal = new THREE.Vector3();

  constructor(options: OceanOptions = {}) {
    this.size = options.size ?? 260;
    const segments = THREE.MathUtils.clamp(Math.round(options.segments ?? 128), 16, 192);
    const geometry = new THREE.PlaneGeometry(this.size, this.size, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    geometry.name = 'finiteWaveOcean';

    this.material = new THREE.ShaderMaterial({
      name: 'celOceanShader',
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uWater: { value: new THREE.Color(options.waterColor ?? ARCADE_PALETTE.water) },
          uDeep: { value: new THREE.Color(options.deepColor ?? ARCADE_PALETTE.deepWater) },
          uFoam: { value: new THREE.Color(options.foamColor ?? ARCADE_PALETTE.foam) },
          uSunDir: { value: new THREE.Vector3(-0.42, 0.82, 0.38).normalize() },
        },
      ]),
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vOceanNormal;
        varying vec3 vWorldPosition;
        varying float vHeight;
        #include <fog_pars_vertex>

        float oceanHeight(vec2 p) {
          return sin(dot(p, vec2(0.94, 0.34)) * 0.105 + uTime * 0.88 + 0.2) * 0.22
            + sin(dot(p, vec2(-0.29, 0.96)) * 0.18 + uTime * 1.22 + 1.8) * 0.14
            + sin(dot(p, vec2(0.66, -0.75)) * 0.31 + uTime * 1.65 + 3.1) * 0.08;
        }

        void main() {
          vec3 transformed = position;
          float h = oceanHeight(position.xz);
          float epsilon = 0.32;
          float hx = oceanHeight(position.xz + vec2(epsilon, 0.0));
          float hz = oceanHeight(position.xz + vec2(0.0, epsilon));
          transformed.y += h;
          vOceanNormal = normalize(vec3(h - hx, epsilon, h - hz));
          vHeight = h;
          vec4 world = modelMatrix * vec4(transformed, 1.0);
          vWorldPosition = world.xyz;
          vec4 mvPosition = viewMatrix * world;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uWater;
        uniform vec3 uDeep;
        uniform vec3 uFoam;
        uniform vec3 uSunDir;
        uniform float uTime;
        varying vec3 vOceanNormal;
        varying vec3 vWorldPosition;
        varying float vHeight;
        #include <fog_pars_fragment>

        void main() {
          vec3 normal = normalize(vOceanNormal);
          vec3 viewDir = normalize(cameraPosition - vWorldPosition);
          float light = clamp(dot(normal, normalize(uSunDir)) * 0.5 + 0.5, 0.0, 1.0);
          float band = floor(light * 3.0) / 2.0;
          float depthMix = clamp(0.35 + vHeight * 0.46, 0.0, 1.0);
          vec3 color = mix(uDeep, uWater, depthMix) * mix(0.72, 1.12, band);
          float fresnel = pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 3.0);
          color = mix(color, vec3(0.64, 0.91, 0.93), fresnel * 0.34);

          float crest = smoothstep(0.43, 0.67, vHeight);
          float ribbons = smoothstep(0.72, 0.92,
            sin(vWorldPosition.x * 0.33 + vWorldPosition.z * 0.19 + uTime * 0.8) * 0.5 + 0.5);
          color = mix(color, uFoam, crest * ribbons * 0.72);
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'oceanSurface';
    this.mesh.position.y = options.y ?? 0;
    this.mesh.receiveShadow = true;
    this.root.name = 'oceanVisual';
    this.root.add(this.mesh);
  }

  /** Set absolute animation time so pausing and deterministic screenshots are easy. */
  update(elapsed: number): void {
    this.currentTime = elapsed;
    this.material.uniforms.uTime.value = elapsed;
  }

  /** CPU mirror of the shader waves for visual pitch/roll or spray placement. */
  sampleSurface(worldX: number, worldZ: number, time = this.currentTime, targetNormal?: THREE.Vector3): WaveSample {
    const localX = worldX - this.root.position.x - this.mesh.position.x;
    const localZ = worldZ - this.root.position.z - this.mesh.position.z;
    const derivatives = waveDerivatives(localX, localZ, time);
    const normal = targetNormal ?? this.reusableNormal.clone();
    normal.set(-derivatives.dx, 1, -derivatives.dz).normalize();
    return {
      height: waveHeight(localX, localZ, time) + this.root.position.y + this.mesh.position.y,
      normal,
    };
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
