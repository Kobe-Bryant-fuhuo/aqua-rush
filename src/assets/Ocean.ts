import * as THREE from 'three';
import { ARCADE_PALETTE } from './Materials';
import { GERSTNER_WAVE_COUNT, WaveSurface, type WaveSample } from '../systems/WaveSurface';
import { makeOceanRing } from './OceanGeometry';
import waterNormalsUrl from './textures/waternormals.jpg';

export type OceanEnvironment = Readonly<{
  water: THREE.ColorRepresentation;
  deepWater: THREE.ColorRepresentation;
  foam: THREE.ColorRepresentation;
  sun?: THREE.ColorRepresentation;
  storm?: boolean;
  sunDirection?: THREE.Vector3 | readonly [number, number, number];
}>;

export type OceanOptions = {
  size?: number;
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

function triangleCount(geometry: THREE.BufferGeometry): number {
  return Math.round((geometry.index?.count ?? geometry.getAttribute('position').count) / 3);
}

function createOceanMaterial(surface: WaveSurface, normals: THREE.Texture): THREE.ShaderMaterial {
  const waves = surface.createUniformData();
  const uniforms = {
    uTime: { value: 0 },
    uWater: { value: new THREE.Color(ARCADE_PALETTE.water) },
    uDeep: { value: new THREE.Color(ARCADE_PALETTE.deepWater) },
    uFoam: { value: new THREE.Color(ARCADE_PALETTE.foam) },
    uAtmosphere: { value: new THREE.Color('#a3e8ed') },
    uSun: { value: new THREE.Color('#fff0a8') },
    uSunDir: { value: new THREE.Vector3(-0.42, 0.82, 0.38).normalize() },
    uStorm: { value: 0 },
    uNormals: { value: normals },
    uNormalsReady: { value: 0 },
    uAmplitude: { value: waves.amplitudes.reduce((sum, a) => sum + a, 0) },
    uWaveDirection: { value: waves.directions },
    uWaveAmplitude: { value: waves.amplitudes },
    uWaveFrequency: { value: waves.frequencies },
    uWaveSpeed: { value: waves.speeds },
    uWavePhase: { value: waves.phases },
    uWaveSteepness: { value: waves.steepness },
  };
  return new THREE.ShaderMaterial({
    name: 'layeredSwellOceanShader',
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, uniforms]),
    vertexShader: `
      #define WAVE_COUNT WAVE_COUNT_VALUE
      uniform float uTime;
      uniform vec2 uWaveDirection[WAVE_COUNT];
      uniform float uWaveAmplitude[WAVE_COUNT];
      uniform float uWaveFrequency[WAVE_COUNT];
      uniform float uWaveSpeed[WAVE_COUNT];
      uniform float uWavePhase[WAVE_COUNT];
      uniform float uWaveSteepness[WAVE_COUNT];
      varying vec3 vWorldPosition;
      #include <fog_pars_vertex>

      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        float height = 0.0;
        for (int i = 0; i < WAVE_COUNT; i++) {
          float phase = dot(world.xz, uWaveDirection[i]) * uWaveFrequency[i]
            + uTime * uWaveSpeed[i] + uWavePhase[i];
          height += (sin(phase) + sin(phase * 2.0 + 0.45) * uWaveSteepness[i] * 0.085) * uWaveAmplitude[i];
        }
        world.y += height;
        vWorldPosition = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `.replace('WAVE_COUNT_VALUE', String(GERSTNER_WAVE_COUNT)),
    fragmentShader: `
      #define WAVE_COUNT WAVE_COUNT_VALUE
      uniform vec3 uWater;
      uniform vec3 uDeep;
      uniform vec3 uFoam;
      uniform vec3 uAtmosphere;
      uniform vec3 uSun;
      uniform vec3 uSunDir;
      uniform float uTime;
      uniform float uStorm;
      uniform float uAmplitude;
      uniform sampler2D uNormals;
      uniform float uNormalsReady;
      uniform vec2 uWaveDirection[WAVE_COUNT];
      uniform float uWaveAmplitude[WAVE_COUNT];
      uniform float uWaveFrequency[WAVE_COUNT];
      uniform float uWaveSpeed[WAVE_COUNT];
      uniform float uWavePhase[WAVE_COUNT];
      uniform float uWaveSteepness[WAVE_COUNT];
      varying vec3 vWorldPosition;
      #include <fog_pars_fragment>

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
          mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }

      void main() {
        // Analytic wave derivatives stay smooth even across the coarse rings.
        // CPU buoyancy and GPU displacement use the same four low-frequency waves.
        float height = 0.0;
        vec2 slope = vec2(0.0);
        for (int i = 0; i < WAVE_COUNT; i++) {
          float phase = dot(vWorldPosition.xz, uWaveDirection[i]) * uWaveFrequency[i]
            + uTime * uWaveSpeed[i] + uWavePhase[i];
          float harmonic = uWaveSteepness[i] * 0.085;
          height += (sin(phase) + sin(phase * 2.0 + 0.45) * harmonic) * uWaveAmplitude[i];
          slope += uWaveDirection[i] * uWaveAmplitude[i] * uWaveFrequency[i]
            * (cos(phase) + cos(phase * 2.0 + 0.45) * harmonic * 2.0);
        }
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        float distanceToEye = length(cameraPosition.xz - vWorldPosition.xz);
        float detailFade = 1.0 - smoothstep(45.0, 200.0, distanceToEye);
        // Two differently scaled, advected copies of the online normal-map asset.
        // Visual ripples never add extra forces or launch the hull.
        vec2 uvA = vWorldPosition.xz * 0.052 + uTime * vec2(0.014, -0.009);
        vec2 uvB = vWorldPosition.zx * 0.087 + uTime * vec2(-0.011, 0.016);
        vec2 rippleA = texture2D(uNormals, uvA).rg * 2.0 - 1.0;
        vec2 rippleB = texture2D(uNormals, uvB).gr * 2.0 - 1.0;
        vec2 ripple = (rippleA + rippleB * 0.65) * uNormalsReady;
        vec3 normal = normalize(vec3(-slope.x + ripple.x * 0.22 * detailFade, 1.0,
          -slope.y + ripple.y * 0.22 * detailFade));

        float facing = clamp(dot(normal, viewDir), 0.0, 1.0);
        float fresnel = 0.02 + 0.72 * pow(1.0 - facing, 5.0);
        float height01 = clamp(height / max(uAmplitude, 0.01) * 0.5 + 0.5, 0.0, 1.0);
        float diffuse = 0.78 + 0.22 * max(dot(normal, normalize(uSunDir)), 0.0);
        vec3 body = mix(uDeep, uWater, 0.34 + height01 * 0.4) * diffuse;
        vec3 reflected = reflect(-viewDir, normal);
        vec3 sky = mix(uAtmosphere, mix(uWater, uAtmosphere, 0.5),
          smoothstep(0.0, 0.85, reflected.y));
        vec3 color = mix(body, sky, fresnel);

        vec3 halfVector = normalize(viewDir + normalize(uSunDir));
        float sunDot = max(dot(normal, halfVector), 0.0);
        float glitter = pow(sunDot, 180.0) * 0.6 + pow(sunDot, 32.0) * 0.07;
        color += uSun * glitter * mix(0.85, 0.35, uStorm);
        // Soft turquoise transmission on the lit lip, not a white height band.
        float transmission = pow(max(dot(viewDir, -normalize(uSunDir)), 0.0), 3.0)
          * smoothstep(0.55, 0.92, height01);
        color += uWater * transmission * 0.14;

        // Sparse broken whitecaps: crest position AND small-scale breakup.
        float crest = smoothstep(0.73, 0.94, height01);
        vec2 flow = vWorldPosition.xz * vec2(0.85, 1.25) - uTime * vec2(0.13, 0.08);
        float breakup = noise(flow + ripple * 0.65);
        float foam = crest * smoothstep(0.58, 0.78, breakup)
          * mix(0.36, 0.52, uStorm) * (0.4 + detailFade * 0.6);
        color = mix(color, uFoam, foam);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `.replace('WAVE_COUNT_VALUE', String(GERSTNER_WAVE_COUNT)),
  });
}

/** A finite three-patch ocean with shared edges, smooth shading and local detail. */
export class OceanVisual {
  readonly root = new THREE.Group();
  readonly nearMesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly midMesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly farMesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
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
  private readonly centerLimit: number;
  private readonly normalTexture: THREE.Texture;
  private disposed = false;

  constructor(options?: OceanOptions);
  constructor(waveSurface: WaveSurface, options?: OceanOptions);
  constructor(optionsOrWaves: OceanOptions | WaveSurface = {}, additionalOptions: OceanOptions = {}) {
    const injected = optionsOrWaves instanceof WaveSurface ? optionsOrWaves : optionsOrWaves.waveSurface;
    const options = optionsOrWaves instanceof WaveSurface ? additionalOptions : optionsOrWaves;
    this.waveSurface = injected ?? new WaveSurface();
    this.nearSize = THREE.MathUtils.clamp(options.nearSize ?? options.size ?? 240, 180, 360);
    this.midSize = THREE.MathUtils.clamp(options.midSize ?? 660, this.nearSize + 120, 820);
    this.farSize = THREE.MathUtils.clamp(options.farSize ?? 1200, this.midSize + 240, 1400);
    this.size = this.farSize;
    this.focusSnap = THREE.MathUtils.clamp(options.focusSnap ?? 4, 1, 16);
    this.centerLimit = (this.farSize - this.nearSize) / 2;
    const edgeSegments = THREE.MathUtils.clamp(Math.round(options.nearSegments ?? options.segments ?? 96), 64, 112);
    const midRows = THREE.MathUtils.clamp(Math.round((options.midSegments ?? 32) / 4), 5, 10);
    const farRows = THREE.MathUtils.clamp(Math.round((options.farSegments ?? 12) / 3), 3, 6);
    const nearGeometry = new THREE.PlaneGeometry(this.nearSize, this.nearSize, edgeSegments, edgeSegments);
    nearGeometry.rotateX(-Math.PI / 2);
    nearGeometry.name = 'nearWaveOcean';
    const midGeometry = makeOceanRing(this.nearSize, this.midSize, edgeSegments, midRows);
    const farGeometry = makeOceanRing(this.midSize, this.farSize, edgeSegments, farRows);
    midGeometry.name = 'midWaveOceanRing';
    farGeometry.name = 'farWaveOceanRing';

    this.normalTexture = new THREE.TextureLoader().load(waterNormalsUrl, () => {
      if (this.disposed) { this.normalTexture.dispose(); return; }
      this.material.uniforms.uNormalsReady.value = 1;
    }, undefined, () => {
      // Geometric waves, lighting and procedural foam remain usable if loading fails.
      if (!this.disposed) this.material.uniforms.uNormalsReady.value = 0;
    });
    this.normalTexture.name = 'three-water-normal-r184';
    this.normalTexture.wrapS = this.normalTexture.wrapT = THREE.RepeatWrapping;
    this.normalTexture.colorSpace = THREE.NoColorSpace;
    this.normalTexture.anisotropy = 4;
    this.material = createOceanMaterial(this.waveSurface, this.normalTexture);
    // UniformsUtils clones textures: keep one owner and one upload per ocean.
    const clonedNormal = this.material.uniforms.uNormals.value as THREE.Texture;
    if (clonedNormal !== this.normalTexture) clonedNormal.dispose();
    this.material.uniforms.uNormals.value = this.normalTexture;
    this.nearMesh = new THREE.Mesh(nearGeometry, this.material);
    this.midMesh = new THREE.Mesh(midGeometry, this.material);
    this.farMesh = new THREE.Mesh(farGeometry, this.material);
    this.mesh = this.nearMesh;
    this.nearMesh.name = 'oceanNearSurface';
    this.midMesh.name = 'oceanMidSurface';
    this.farMesh.name = 'oceanFarSurface';
    // Vertex displacement is not included in the original planar bounds.
    const waveBound = this.waveSurface.waves.reduce((sum, w) => sum + w.amplitude * 1.1, 0);
    for (const mesh of [this.nearMesh, this.midMesh, this.farMesh]) {
      mesh.geometry.computeBoundingBox();
      mesh.geometry.boundingBox!.min.y = -waveBound;
      mesh.geometry.boundingBox!.max.y = waveBound;
      mesh.geometry.boundingSphere = mesh.geometry.boundingBox!.getBoundingSphere(new THREE.Sphere());
    }
    this.root.name = 'finiteLodOceanVisual';
    this.root.position.y = options.y ?? 0;
    this.root.add(this.nearMesh, this.midMesh, this.farMesh);
    const nearTriangles = triangleCount(nearGeometry), midTriangles = triangleCount(midGeometry), farTriangles = triangleCount(farGeometry);
    this.diagnostics = Object.freeze({
      drawCalls: 3 as const,
      triangles: nearTriangles + midTriangles + farTriangles,
      nearTriangles, midTriangles, farTriangles,
      nearSize: this.nearSize, midSize: this.midSize, farSize: this.farSize,
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
      (this.material.uniforms.uSun.value as THREE.Color).set(environment.sun);
      (this.material.uniforms.uAtmosphere.value as THREE.Color)
        .set(environment.sun).lerp(new THREE.Color('#a3e8ed'), 0.7);
    }
    if (environment.sunDirection instanceof THREE.Vector3) {
      (this.material.uniforms.uSunDir.value as THREE.Vector3).copy(environment.sunDirection).normalize();
    } else if (environment.sunDirection) {
      (this.material.uniforms.uSunDir.value as THREE.Vector3).set(...environment.sunDirection).normalize();
    }
    this.material.uniforms.uStorm.value = environment.storm ? 1 : 0;
  }

  update(elapsed: number, focus?: Readonly<{ x: number; z: number }>): void {
    this.currentTime = elapsed;
    this.material.uniforms.uTime.value = elapsed;
    if (!focus) return;
    const x = THREE.MathUtils.clamp(Math.round(focus.x / this.focusSnap) * this.focusSnap, -this.centerLimit, this.centerLimit);
    const z = THREE.MathUtils.clamp(Math.round(focus.z / this.focusSnap) * this.focusSnap, -this.centerLimit, this.centerLimit);
    // All rings share a center and matching boundary vertices. No overlapping
    // layers, height offsets, z-fighting, or cracks when the focus advances.
    for (const mesh of [this.nearMesh, this.midMesh, this.farMesh]) {
      mesh.position.set(x, 0, z);
    }
  }

  sampleSurface(worldX: number, worldZ: number, time = this.currentTime, targetNormal?: THREE.Vector3): WaveSample {
    const normal = targetNormal ?? this.reusableNormal;
    this.waveSurface.getNormal(worldX, worldZ, time, normal);
    return { height: this.waveSurface.getHeight(worldX, worldZ, time) + this.root.position.y, normal };
  }

  dispose(): void {
    this.disposed = true;
    this.nearMesh.geometry.dispose();
    this.midMesh.geometry.dispose();
    this.farMesh.geometry.dispose();
    this.normalTexture.dispose();
    this.material.dispose();
  }
}
