import * as THREE from 'three';
import { ARCADE_PALETTE } from './Materials';
import { GERSTNER_WAVE_COUNT, WaveSurface, type WaveSample } from '../systems/WaveSurface';

export type OceanEnvironment = Readonly<{
  water: THREE.ColorRepresentation;
  deepWater: THREE.ColorRepresentation;
  foam: THREE.ColorRepresentation;
  sun?: THREE.ColorRepresentation;
  storm?: boolean;
  sunDirection?: THREE.Vector3 | readonly [number, number, number];
}>;

export type OceanOptions = {
  /** Legacy alias for nearSize. */
  size?: number;
  /** Legacy alias for nearSegments. */
  segments?: number;
  nearSize?: number;
  nearSegments?: number;
  midSize?: number;
  midSegments?: number;
  farSize?: number;
  farSegments?: number;
  focusSnap?: number;
  waterColor?: THREE.ColorRepresentation;
  deepColor?: THREE.ColorRepresentation;
  foamColor?: THREE.ColorRepresentation;
  y?: number;
  waveSurface?: WaveSurface;
};

export type OceanDiagnostics = Readonly<{
  drawCalls: 3;
  triangles: number;
  nearTriangles: number;
  midTriangles: number;
  farTriangles: number;
  nearSize: number;
  midSize: number;
  farSize: number;
}>;

const DEFAULT_NEAR_SIZE = 270;
const DEFAULT_MID_SIZE = 660;
const DEFAULT_FAR_SIZE = 1200;
const DEFAULT_NEAR_SEGMENTS = 104;
const DEFAULT_MID_SEGMENTS = 36;
const DEFAULT_FAR_SEGMENTS = 12;

function makeWaterPlane(size: number, segments: number, name: string, yOffset: number): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, yOffset, 0);
  geometry.name = name;
  return geometry;
}

function triangleCount(geometry: THREE.BufferGeometry): number {
  return Math.round(geometry.index
    ? geometry.index.count / 3
    : (geometry.getAttribute('position')?.count ?? 0) / 3);
}

function makeWaveUniforms(waveSurface: WaveSurface): Record<string, THREE.IUniform> {
  const waves = waveSurface.createUniformData();
  return {
    uTime: { value: 0 },
    uWater: { value: new THREE.Color(ARCADE_PALETTE.water) },
    uDeep: { value: new THREE.Color(ARCADE_PALETTE.deepWater) },
    uFoam: { value: new THREE.Color(ARCADE_PALETTE.foam) },
    uAtmosphere: { value: new THREE.Color(0xa3e8ed) },
    uSunDir: { value: new THREE.Vector3(-0.42, 0.82, 0.38).normalize() },
    uStorm: { value: 0 },
    uWaveDirection: { value: waves.directions },
    uWaveAmplitude: { value: waves.amplitudes },
    uWaveFrequency: { value: waves.frequencies },
    uWaveSpeed: { value: waves.speeds },
    uWavePhase: { value: waves.phases },
    uWaveSteepness: { value: waves.steepness },
  };
}

function createOceanMaterial(waveSurface: WaveSurface): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'celFiniteLodOceanShader',
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      makeWaveUniforms(waveSurface),
    ]),
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec2 uWaveDirection[${GERSTNER_WAVE_COUNT}];
      uniform float uWaveAmplitude[${GERSTNER_WAVE_COUNT}];
      uniform float uWaveFrequency[${GERSTNER_WAVE_COUNT}];
      uniform float uWaveSpeed[${GERSTNER_WAVE_COUNT}];
      uniform float uWavePhase[${GERSTNER_WAVE_COUNT}];
      uniform float uWaveSteepness[${GERSTNER_WAVE_COUNT}];
      varying vec3 vOceanNormal;
      varying vec3 vWorldPosition;
      varying float vHeight;
      #include <fog_pars_vertex>

      float oceanHeight(vec2 worldPosition) {
        float height = 0.0;
        for (int index = 0; index < ${GERSTNER_WAVE_COUNT}; index += 1) {
          float phase = dot(worldPosition, uWaveDirection[index]) * uWaveFrequency[index]
            + uTime * uWaveSpeed[index] + uWavePhase[index];
          height += sin(phase) * uWaveAmplitude[index];
          height += sin(phase * 2.0 + 0.45) * uWaveAmplitude[index] * uWaveSteepness[index] * 0.085;
        }
        return height;
      }

      void main() {
        vec4 baseWorld = modelMatrix * vec4(position, 1.0);
        float h = oceanHeight(baseWorld.xz);
        float epsilon = 0.32;
        float hx = oceanHeight(baseWorld.xz + vec2(epsilon, 0.0));
        float hz = oceanHeight(baseWorld.xz + vec2(0.0, epsilon));
        vec3 transformed = position;
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
      uniform vec3 uAtmosphere;
      uniform vec3 uSunDir;
      uniform float uTime;
      uniform float uStorm;
      varying vec3 vOceanNormal;
      varying vec3 vWorldPosition;
      varying float vHeight;
      #include <fog_pars_fragment>

      void main() {
        vec3 normal = normalize(vOceanNormal);
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        float light = clamp(dot(normal, normalize(uSunDir)) * 0.5 + 0.5, 0.0, 1.0);
        float band = floor(light * 3.0) / 2.0;
        float depthMix = clamp(0.35 + vHeight * mix(0.46, 0.32, uStorm), 0.0, 1.0);
        vec3 color = mix(uDeep, uWater, depthMix) * mix(0.72, 1.12, band);
        float fresnel = pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), mix(3.0, 2.35, uStorm));
        color = mix(color, uAtmosphere, fresnel * mix(0.34, 0.26, uStorm));

        float crest = smoothstep(mix(0.43, 0.5, uStorm), mix(0.67, 0.78, uStorm), vHeight);
        float ribbons = smoothstep(0.72, 0.92,
          sin(vWorldPosition.x * 0.33 + vWorldPosition.z * 0.19 + uTime * 0.8) * 0.5 + 0.5);
        color = mix(color, uFoam, crest * ribbons * mix(0.72, 0.86, uStorm));
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

/**
 * Three-layer finite ocean. Coarse layers overlap below the near layer so
 * snapped LOD movement never opens a gap. Displacement is evaluated in world
 * space from one WaveSurface, keeping moving patches and CPU samples in phase.
 */
export class OceanVisual {
  readonly root = new THREE.Group();
  readonly nearMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly midMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly farMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** Compatibility alias for the original single ocean mesh. */
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly material: THREE.ShaderMaterial;
  readonly size: number;
  readonly nearSize: number;
  readonly midSize: number;
  readonly farSize: number;
  readonly diagnostics: OceanDiagnostics;

  private currentTime = 0;
  private readonly reusableNormal = new THREE.Vector3();
  private readonly waveSurface: WaveSurface;
  private readonly focusSnap: number;
  private readonly nearCenterLimit: number;
  private readonly midCenterLimit: number;

  constructor(options?: OceanOptions);
  constructor(waveSurface: WaveSurface, options?: OceanOptions);
  constructor(optionsOrWaves: OceanOptions | WaveSurface = {}, additionalOptions: OceanOptions = {}) {
    const injectedWaves = optionsOrWaves instanceof WaveSurface ? optionsOrWaves : optionsOrWaves.waveSurface;
    const options = optionsOrWaves instanceof WaveSurface ? additionalOptions : optionsOrWaves;
    this.waveSurface = injectedWaves ?? new WaveSurface();
    this.nearSize = THREE.MathUtils.clamp(options.nearSize ?? options.size ?? DEFAULT_NEAR_SIZE, 180, 360);
    this.midSize = THREE.MathUtils.clamp(options.midSize ?? DEFAULT_MID_SIZE, this.nearSize + 120, 820);
    this.farSize = THREE.MathUtils.clamp(options.farSize ?? DEFAULT_FAR_SIZE, this.midSize + 240, 1400);
    this.size = this.farSize;
    this.focusSnap = THREE.MathUtils.clamp(options.focusSnap ?? 4, 1, 16);
    this.nearCenterLimit = Math.max(0, (this.farSize - this.nearSize) * 0.5);
    this.midCenterLimit = Math.max(0, (this.farSize - this.midSize) * 0.5);

    const nearSegments = THREE.MathUtils.clamp(
      Math.round(options.nearSegments ?? options.segments ?? DEFAULT_NEAR_SEGMENTS),
      64,
      112,
    );
    const midSegments = THREE.MathUtils.clamp(Math.round(options.midSegments ?? DEFAULT_MID_SEGMENTS), 20, 40);
    const farSegments = THREE.MathUtils.clamp(Math.round(options.farSegments ?? DEFAULT_FAR_SEGMENTS), 8, 16);
    const nearGeometry = makeWaterPlane(this.nearSize, nearSegments, 'nearWaveOcean', 0);
    const midGeometry = makeWaterPlane(this.midSize, midSegments, 'midWaveOcean', -0.028);
    const farGeometry = makeWaterPlane(this.farSize, farSegments, 'farWaveOcean', -0.056);

    this.material = createOceanMaterial(this.waveSurface);
    this.nearMesh = new THREE.Mesh(nearGeometry, this.material);
    this.midMesh = new THREE.Mesh(midGeometry, this.material);
    this.farMesh = new THREE.Mesh(farGeometry, this.material);
    this.mesh = this.nearMesh;
    this.nearMesh.name = 'oceanNearSurface';
    this.midMesh.name = 'oceanMidSurface';
    this.farMesh.name = 'oceanFarSurface';
    this.nearMesh.renderOrder = -3;
    this.midMesh.renderOrder = -2;
    this.farMesh.renderOrder = -1;
    this.nearMesh.receiveShadow = true;
    this.midMesh.receiveShadow = true;
    this.farMesh.receiveShadow = false;
    this.root.name = 'finiteLodOceanVisual';
    this.root.position.y = options.y ?? 0;
    this.root.add(this.nearMesh, this.midMesh, this.farMesh);

    const nearTriangles = triangleCount(nearGeometry);
    const midTriangles = triangleCount(midGeometry);
    const farTriangles = triangleCount(farGeometry);
    this.diagnostics = Object.freeze({
      drawCalls: 3 as const,
      triangles: nearTriangles + midTriangles + farTriangles,
      nearTriangles,
      midTriangles,
      farTriangles,
      nearSize: this.nearSize,
      midSize: this.midSize,
      farSize: this.farSize,
    });

    this.applyEnvironment({
      water: options.waterColor ?? ARCADE_PALETTE.water,
      deepWater: options.deepColor ?? ARCADE_PALETTE.deepWater,
      foam: options.foamColor ?? ARCADE_PALETTE.foam,
    });
  }

  applyEnvironment(environment: OceanEnvironment): void {
    (this.material.uniforms.uWater.value as THREE.Color).set(environment.water);
    (this.material.uniforms.uDeep.value as THREE.Color).set(environment.deepWater);
    (this.material.uniforms.uFoam.value as THREE.Color).set(environment.foam);
    if (environment.sun !== undefined) {
      (this.material.uniforms.uAtmosphere.value as THREE.Color).set(environment.sun).lerp(new THREE.Color(0xa3e8ed), 0.42);
    }
    if (environment.sunDirection instanceof THREE.Vector3) {
      (this.material.uniforms.uSunDir.value as THREE.Vector3).copy(environment.sunDirection).normalize();
    } else if (environment.sunDirection) {
      (this.material.uniforms.uSunDir.value as THREE.Vector3).set(...environment.sunDirection).normalize();
    }
    this.material.uniforms.uStorm.value = environment.storm ? 1 : 0;
  }

  /** Set absolute time and optionally follow a focus while remaining inside the finite far plane. */
  update(elapsed: number, focus?: Readonly<{ x: number; z: number }>): void {
    this.currentTime = elapsed;
    this.material.uniforms.uTime.value = elapsed;
    if (!focus) return;
    const snappedX = Math.round(focus.x / this.focusSnap) * this.focusSnap;
    const snappedZ = Math.round(focus.z / this.focusSnap) * this.focusSnap;
    this.nearMesh.position.x = THREE.MathUtils.clamp(snappedX, -this.nearCenterLimit, this.nearCenterLimit);
    this.nearMesh.position.z = THREE.MathUtils.clamp(snappedZ, -this.nearCenterLimit, this.nearCenterLimit);
    this.midMesh.position.x = THREE.MathUtils.clamp(snappedX, -this.midCenterLimit, this.midCenterLimit);
    this.midMesh.position.z = THREE.MathUtils.clamp(snappedZ, -this.midCenterLimit, this.midCenterLimit);
  }

  /** CPU mirror of the exact world-space shader waves used by every LOD layer. */
  sampleSurface(worldX: number, worldZ: number, time = this.currentTime, targetNormal?: THREE.Vector3): WaveSample {
    const normal = targetNormal ?? this.reusableNormal;
    this.waveSurface.getNormal(worldX, worldZ, time, normal);
    return {
      height: this.waveSurface.getHeight(worldX, worldZ, time) + this.root.position.y,
      normal,
    };
  }

  dispose(): void {
    this.nearMesh.geometry.dispose();
    this.midMesh.geometry.dispose();
    this.farMesh.geometry.dispose();
    this.material.dispose();
  }
}
