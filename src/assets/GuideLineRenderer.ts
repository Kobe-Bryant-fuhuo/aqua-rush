import * as THREE from 'three';
import type { RaceTrack } from '../game/Track';
import { GERSTNER_WAVE_COUNT, type WaveSurface } from '../systems/WaveSurface';
import { ARCADE_PALETTE } from './Materials';

export type GuideInteractionTone = 'normal' | 'boost' | 'drift';

export type GuideLineState = Readonly<{
  progress: number;
  /** World-space distance from the legal route. */
  offRoute: number;
  wrongWay: boolean;
  interactionTone?: GuideInteractionTone;
  /** Allows the caller to narrow the line for mobile or widen it in recovery. */
  widthScale?: number;
}>;

export type GuideLineOptions = Readonly<{
  segments?: number;
  aheadDistance?: number;
  behindDistance?: number;
  width?: number;
  surfaceOffset?: number;
}>;

const NORMAL_COLOR = new THREE.Color(0xc5ffff);
const BOOST_COLOR = new THREE.Color(ARCADE_PALETTE.cyan);
const DRIFT_COLOR = new THREE.Color(ARCADE_PALETTE.sun).lerp(new THREE.Color(ARCADE_PALETTE.coral), 0.28);
const WRONG_WAY_COLOR = new THREE.Color(ARCADE_PALETTE.coral);

/** One-call, fixed-capacity guide ribbon displaced by the same wave truth as the ocean. */
export class GuideLineRenderer {
  readonly root = new THREE.Group();
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly material: THREE.ShaderMaterial;
  readonly drawCalls = 1;

  private readonly track: RaceTrack;
  private readonly segments: number;
  private readonly aheadDistance: number;
  private readonly behindDistance: number;
  private readonly baseWidth: number;
  private readonly positions: Float32Array;
  private readonly positionAttribute: THREE.BufferAttribute;
  private readonly point = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly side = new THREE.Vector3();

  constructor(track: RaceTrack, waveSurface: WaveSurface, options: GuideLineOptions = {}) {
    this.track = track;
    this.segments = THREE.MathUtils.clamp(Math.round(options.segments ?? 96), 48, 160);
    this.aheadDistance = THREE.MathUtils.clamp(options.aheadDistance ?? 140, 80, 180);
    this.behindDistance = THREE.MathUtils.clamp(options.behindDistance ?? 18, 6, 32);
    this.baseWidth = THREE.MathUtils.clamp(options.width ?? 0.42, 0.18, 0.9);
    this.root.name = 'waveFollowingGuideLine';

    this.positions = new Float32Array((this.segments + 1) * 2 * 3);
    const distances = new Float32Array((this.segments + 1) * 2);
    const alphas = new Float32Array((this.segments + 1) * 2);
    const indices = new Uint16Array(this.segments * 6);
    const span = this.aheadDistance + this.behindDistance;
    for (let index = 0; index <= this.segments; index += 1) {
      const alpha = index / this.segments;
      const distance = -this.behindDistance + span * alpha;
      const visibility = distance < 0
        ? THREE.MathUtils.smoothstep(distance, -this.behindDistance, 0) * 0.42
        : THREE.MathUtils.lerp(
            0.46,
            1,
            THREE.MathUtils.smoothstep(distance, 58, 88)
              * (1 - THREE.MathUtils.smoothstep(distance, this.aheadDistance - 18, this.aheadDistance)),
          );
      const vertex = index * 2;
      distances[vertex] = distance;
      distances[vertex + 1] = distance;
      alphas[vertex] = visibility;
      alphas[vertex + 1] = visibility;
      if (index < this.segments) {
        const offset = index * 6;
        indices[offset] = vertex;
        indices[offset + 1] = vertex + 2;
        indices[offset + 2] = vertex + 1;
        indices[offset + 3] = vertex + 1;
        indices[offset + 4] = vertex + 2;
        indices[offset + 5] = vertex + 3;
      }
    }

    const geometry = new THREE.BufferGeometry();
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttribute);
    geometry.setAttribute('aDistance', new THREE.BufferAttribute(distances, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.name = 'fixedCapacityGuideRibbon';
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 500);

    const waves = waveSurface.createUniformData();
    this.material = new THREE.ShaderMaterial({
      name: 'waveFollowingGuideShader',
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: NORMAL_COLOR.clone() },
        uVisibility: { value: 0.84 },
        uSurfaceOffset: { value: options.surfaceOffset ?? 0.09 },
        uWaveDirection: { value: waves.directions },
        uWaveAmplitude: { value: waves.amplitudes },
        uWaveFrequency: { value: waves.frequencies },
        uWaveSpeed: { value: waves.speeds },
        uWavePhase: { value: waves.phases },
        uWaveSteepness: { value: waves.steepness },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uSurfaceOffset;
        uniform vec2 uWaveDirection[${GERSTNER_WAVE_COUNT}];
        uniform float uWaveAmplitude[${GERSTNER_WAVE_COUNT}];
        uniform float uWaveFrequency[${GERSTNER_WAVE_COUNT}];
        uniform float uWaveSpeed[${GERSTNER_WAVE_COUNT}];
        uniform float uWavePhase[${GERSTNER_WAVE_COUNT}];
        uniform float uWaveSteepness[${GERSTNER_WAVE_COUNT}];
        attribute float aDistance;
        attribute float aAlpha;
        varying float vDistance;
        varying float vAlpha;

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
          vec4 world = modelMatrix * vec4(position, 1.0);
          world.y += oceanHeight(world.xz) + uSurfaceOffset;
          vDistance = aDistance;
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uVisibility;
        varying float vDistance;
        varying float vAlpha;

        void main() {
          float flow = fract(vDistance * 0.085 - uTime * 1.15);
          float arrow = smoothstep(0.08, 0.2, flow) * (1.0 - smoothstep(0.62, 0.84, flow));
          float spine = 0.46 + arrow * 0.54;
          float alpha = vAlpha * uVisibility * spine;
          if (alpha < 0.025) discard;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'courseGuideRibbon';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.root.add(this.mesh);
    this.update(0, { progress: 0, offRoute: 0, wrongWay: false });
  }

  update(elapsed: number, state: GuideLineState): void {
    const widthScale = THREE.MathUtils.clamp(state.widthScale ?? 1, 0.55, 1.8);
    const halfWidth = this.baseWidth * widthScale * 0.5;
    const span = this.aheadDistance + this.behindDistance;
    for (let index = 0; index <= this.segments; index += 1) {
      const distance = -this.behindDistance + span * (index / this.segments);
      const progress = this.track.wrapProgress(state.progress + distance / this.track.length);
      const samplePosition = progress * this.track.sampleCount;
      const sampleIndex = Math.floor(samplePosition) % this.track.sampleCount;
      const nextSampleIndex = (sampleIndex + 1) % this.track.sampleCount;
      const sampleAlpha = samplePosition - Math.floor(samplePosition);
      this.point.copy(this.track.points[sampleIndex]).lerp(this.track.points[nextSampleIndex], sampleAlpha);
      this.tangent.copy(this.track.tangents[sampleIndex]).lerp(this.track.tangents[nextSampleIndex], sampleAlpha).normalize();
      this.side.set(-this.tangent.z, 0, this.tangent.x);
      const vertex = index * 6;
      this.positions[vertex] = this.point.x + this.side.x * halfWidth;
      this.positions[vertex + 1] = 0;
      this.positions[vertex + 2] = this.point.z + this.side.z * halfWidth;
      this.positions[vertex + 3] = this.point.x - this.side.x * halfWidth;
      this.positions[vertex + 4] = 0;
      this.positions[vertex + 5] = this.point.z - this.side.z * halfWidth;
    }
    this.positionAttribute.needsUpdate = true;
    this.material.uniforms.uTime.value = elapsed;
    const deviation = THREE.MathUtils.clamp((state.offRoute - 18) / 52, 0, 1);
    this.material.uniforms.uVisibility.value = state.wrongWay ? 1 : THREE.MathUtils.lerp(0.78, 1, deviation);
    const tone = state.wrongWay
      ? WRONG_WAY_COLOR
      : state.interactionTone === 'boost'
        ? BOOST_COLOR
        : state.interactionTone === 'drift'
          ? DRIFT_COLOR
          : NORMAL_COLOR;
    (this.material.uniforms.uColor.value as THREE.Color).copy(tone);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
