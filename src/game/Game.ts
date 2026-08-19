import * as THREE from 'three';
import { createBoatModel, type BoatModel } from '../assets/BoatModel';
import { CourseVisuals } from '../assets/CourseVisuals';
import { ARCADE_PALETTE, MaterialLibrary } from '../assets/Materials';
import { OceanVisual } from '../assets/Ocean';
import { VfxSystem } from '../assets/VfxSystem';
import { InputController } from '../core/InputController';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { AIRacer } from '../entities/AIRacer';
import { ArcadeBoat, DEFAULT_PLAYER_TUNING } from '../entities/ArcadeBoat';
import { Player } from '../entities/Player';
import { AudioSystem } from '../systems/AudioSystem';
import { CameraRig, DEFAULT_CAMERA_TUNING } from '../systems/CameraRig';
import { CollisionSystem, type CollisionResult } from '../systems/CollisionSystem';
import { DebugTools, type DebugTuning } from '../systems/DebugTools';
import { Hud } from '../systems/Hud';
import { WaveSurface } from '../systems/WaveSurface';
import { createSeededRandom } from '../utils/random';
import { RaceManager, type RaceEvent, type RacerFrame } from './RaceManager';
import { RaceTrack } from './Track';

const AI_CONFIG = [
  { id: 'coral', name: 'KAI', color: ARCADE_PALETTE.coral, laneOffset: 1.45, speedScale: 0.98, steeringScale: 1.05, lookAhead: 0.034 },
  { id: 'cyan', name: 'MIRA', color: ARCADE_PALETTE.cyan, laneOffset: -1.45, speedScale: 1.015, steeringScale: 0.96, lookAhead: 0.041 },
  { id: 'violet', name: 'NOX', color: ARCADE_PALETTE.violet, laneOffset: 0.15, speedScale: 0.965, steeringScale: 1.1, lookAhead: 0.031 },
] as const;

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(54, 1, 0.1, 260);
  private readonly track = new RaceTrack();
  private readonly waves = new WaveSurface();
  private readonly materials = new MaterialLibrary();
  private readonly ocean = new OceanVisual({ size: 270, segments: 112 });
  private readonly course = new CourseVisuals({
    centerline: this.track.points,
    courseWidth: this.track.halfWidth * 2,
    buoySpacing: 8.5,
    materials: this.materials,
    seed: 217,
  });
  private readonly vfx = new VfxSystem(104, 120);
  private readonly input: InputController;
  private readonly audio = new AudioSystem();
  private readonly hud = new Hud();
  private readonly collision = new CollisionSystem();
  private readonly boatModels = new Map<string, BoatModel>();
  private readonly player: Player;
  private readonly aiRacers: AIRacer[];
  private readonly boats: ArcadeBoat[];
  private readonly race: RaceManager;
  private readonly cameraRig: CameraRig;
  private readonly debugTools: DebugTools;
  private readonly loop: Loop;
  private readonly tuning: DebugTuning = {
    ...DEFAULT_PLAYER_TUNING,
    ...DEFAULT_CAMERA_TUNING,
    exposure: 1.04,
    maxDpr: 1.6,
  };
  private readonly racerFrames: RacerFrame[] = [];
  private readonly initialProgress = new Map<string, number>();
  private readonly forward = new THREE.Vector3();
  private readonly nextCheckpointPosition = new THREE.Vector3();
  private readonly playerLookAheadPosition = new THREE.Vector3();
  private readonly rng = createSeededRandom(217);

  private frame = 0;
  private elapsed = 0;
  private pausedForScreenshot = false;
  private reducedMotion = false;
  private lastBoosting = false;
  private collisionCooldown = 0;
  private collisionTotal = 0;
  private collisionFrame: CollisionResult = { count: 0, strongest: 0 };
  private lastCountdownPresentation: number | 'GO' | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.renderer.toneMappingExposure = this.tuning.exposure;
    this.renderer.shadowMap.autoUpdate = true;

    const playerModel = this.makeBoatModel('player', ARCADE_PALETTE.sun, 7);
    this.player = new Player(playerModel.root);
    this.aiRacers = AI_CONFIG.map((config, index) => {
      const model = this.makeBoatModel(config.id, config.color, index + 1);
      return new AIRacer(config.id, config.color, config, model.root);
    });
    this.boats = [this.player, ...this.aiRacers];

    this.race = new RaceManager([
      { id: this.player.id, name: 'YOU', isPlayer: true },
      ...AI_CONFIG.map((config) => ({ id: config.id, name: config.name, isPlayer: false })),
    ]);
    this.cameraRig = new CameraRig(this.camera, this.tuning);

    const stick = this.getElement('#touch-stick');
    const knob = this.getElement('#touch-knob');
    const boostButton = this.getElement('#dash-button');
    boostButton.textContent = 'BOOST';
    this.input = new InputController(stick, knob, boostButton);

    this.debugTools = new DebugTools(this.tuning, () => {
      this.renderer.toneMappingExposure = this.tuning.exposure;
      resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    });
    this.loop = new Loop(
      (delta) => this.update(delta),
      () => this.render(),
    );

    this.createScene();
    this.resetRace();
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    this.installRestartControl();
    this.installTestHooks();
    this.publishDiagnostics();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.audio.dispose();
    this.hud.dispose();
    this.debugTools.dispose();
    for (const boat of this.boats) boat.dispose();
    for (const model of this.boatModels.values()) model.dispose();
    this.course.dispose();
    this.ocean.dispose();
    this.vfx.dispose();
    this.materials.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  private update(delta: number): void {
    this.frame += 1;
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    if (this.pausedForScreenshot) {
      this.publishDiagnostics();
      return;
    }

    this.elapsed += delta;
    this.collisionCooldown = Math.max(0, this.collisionCooldown - delta);
    if (this.input.consumeRestart()) this.resetRace();
    const visualElapsed = this.reducedMotion ? 0 : this.elapsed;
    const canRace = this.race.phase === 'racing';

    // Explicit order: input -> boat simulation -> collision -> race rules -> VFX -> camera -> HUD.
    this.player.update(delta, visualElapsed, this.input, this.tuning, this.waves, canRace && !this.race.getState(this.player.id).finished);
    const playerScore = this.race.raceScore(this.player.id);
    for (const racer of this.aiRacers) {
      const state = this.race.getState(racer.id);
      racer.update(
        delta,
        visualElapsed,
        this.track,
        this.waves,
        this.race.raceScore(racer.id),
        playerScore,
        canRace && !state.finished,
      );
    }

    this.collisionFrame = canRace ? this.collision.resolve(this.boats, this.track) : { count: 0, strongest: 0 };
    if (this.collisionFrame.count > 0) {
      this.collisionTotal += this.collisionFrame.count;
      if (this.collisionCooldown <= 0) {
        this.collisionCooldown = 0.16;
        this.audio.collision(this.collisionFrame.strongest);
        this.cameraRig.addTrauma(0.18 + this.collisionFrame.strongest * 0.34);
        this.vfx.emitImpact(this.player.group.position, undefined, this.collisionFrame.strongest);
      }
    }

    this.collectRacerFrames();
    this.race.update(delta, this.racerFrames, this.track);
    this.handleRaceEvents(this.race.consumeEvents());
    this.updatePresentation(delta, visualElapsed);
    this.updateHud();
    this.publishDiagnostics();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private createScene(): void {
    this.course.install(this.scene);
    this.scene.add(this.ocean.root, this.vfx.root);
    for (const boat of this.boats) this.scene.add(boat.group);
  }

  private resetRace(): void {
    this.elapsed = 0;
    this.lastBoosting = false;
    this.collisionCooldown = 0;
    this.collisionFrame = { count: 0, strongest: 0 };
    this.collisionTotal = 0;
    this.lastCountdownPresentation = null;
    const grid = [
      { boat: this.player, progress: 0.982, lane: -1.45 },
      { boat: this.aiRacers[0], progress: 0.979, lane: 1.4 },
      { boat: this.aiRacers[1], progress: 0.969, lane: -1.4 },
      { boat: this.aiRacers[2], progress: 0.966, lane: 1.35 },
    ];
    this.initialProgress.clear();
    for (const spawn of grid) {
      const position = this.track.getOffsetPoint(spawn.progress, spawn.lane);
      position.y = this.waves.getHeight(position.x, position.z, 0) + 0.42;
      spawn.boat.reset(position, this.track.headingAt(spawn.progress));
      spawn.boat.updateWaterPose(1, 0, this.waves);
      this.initialProgress.set(spawn.boat.id, spawn.progress);
    }
    this.race.reset(this.initialProgress);
    this.audio.reset();
    this.hud.hideResults();
    this.cameraRig.snapTo(this.player);
    this.collectRacerFrames();
    this.updateHud();
  }

  private collectRacerFrames(): void {
    this.racerFrames.length = 0;
    for (const boat of this.boats) {
      this.racerFrames.push({ id: boat.id, position: boat.group.position, velocity: boat.velocity });
    }
  }

  private updatePresentation(delta: number, visualElapsed: number): void {
    this.ocean.update(visualElapsed);
    this.course.update(visualElapsed, this.camera.position);
    for (const boat of this.boats) {
      const model = this.boatModels.get(boat.id);
      model?.update(delta, visualElapsed, Math.abs(boat.speed), boat.boosting ? 1 : 0);
      boat.getForward(this.forward);
      this.vfx.updateBoatWake(
        boat.id,
        { position: boat.group.position, forward: this.forward, speed: Math.abs(boat.speed), boost: boat.boosting ? 1 : 0 },
        delta,
      );
    }
    this.vfx.update(delta);

    if (this.player.boosting && !this.lastBoosting) {
      this.audio.boost();
      this.cameraRig.punchFov(4.5);
    }
    this.lastBoosting = this.player.boosting;
    const speedRatio = Math.max(0, this.player.speed) / this.tuning.maxForwardSpeed;
    this.audio.updateEngine(speedRatio, this.player.boosting, delta);
    this.cameraRig.update(delta, visualElapsed, this.player, speedRatio);
  }

  private handleRaceEvents(events: RaceEvent[]): void {
    for (const event of events) {
      if (event.type === 'countdown') this.audio.countdown(event.tick);
      else if (event.type === 'start') {
        this.audio.startSignal();
      }
      else if (event.type === 'checkpoint' && event.racerId === this.player.id) this.audio.checkpoint();
      else if (event.type === 'lap' && event.racerId === this.player.id) {
        this.audio.lap(event.lap);
        this.cameraRig.punchFov(2.5);
      } else if (event.type === 'player-finish') {
        this.audio.finish(event.place);
        this.hud.showResults({ position: event.place, elapsed: event.time, totalRacers: this.boats.length });
      }
    }
  }

  private updateHud(): void {
    const playerState = this.race.getState(this.player.id);
    const countdownPresentation = this.race.phase === 'countdown'
      ? Math.ceil(this.race.countdown)
      : null;
    if (countdownPresentation !== this.lastCountdownPresentation) {
      this.hud.setCountdown(countdownPresentation);
      this.lastCountdownPresentation = countdownPresentation;
    }
    const status = playerState.wrongWay
      ? 'WRONG WAY — TURN AROUND'
      : this.race.phase === 'finished'
        ? 'RACE COMPLETE'
        : this.player.boosting
          ? 'BOOSTING!'
          : 'HOLD THE RACING LINE';
    this.hud.updateRace({
      speed: Math.max(0, this.player.speed),
      lap: playerState.displayLap,
      totalLaps: this.race.totalLaps,
      position: playerState.place,
      totalRacers: this.boats.length,
      elapsed: this.race.raceTime,
      boost: this.player.boost,
      status,
    });
  }

  private installRestartControl(): void {
    this.hud.onRestart(() => this.resetRace());
  }

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        // VFX and any later spawn variance share the same deterministic seed contract.
        void this.rng;
        this.vfx.seed(value);
      },
      setState: (name) => {
        this.resetRace();
        if (name === 'active-play') {
          this.collectRacerFrames();
          this.race.startImmediately(this.racerFrames, this.track);
        } else if (name === 'complete') {
          this.race.debugFinish(this.player.id);
          this.handleRaceEvents(this.race.consumeEvents());
        }
      },
      restart: () => this.resetRace(),
      advanceToCheckpoint: (index) => {
        const state = this.race.getState(this.player.id);
        const requested = index === undefined ? state.nextCheckpoint : Math.floor(index);
        if (requested === state.nextCheckpoint) this.race.debugPassNextCheckpoint(this.player.id);
        this.handleRaceEvents(this.race.consumeEvents());
        this.updateHud();
        this.publishDiagnostics();
      },
      completeLap: () => {
        this.race.debugCompleteLap(this.player.id);
        this.handleRaceEvents(this.race.consumeEvents());
        this.updateHud();
        this.publishDiagnostics();
      },
      finishRace: () => {
        this.race.debugFinish(this.player.id);
        this.handleRaceEvents(this.race.consumeEvents());
        this.updateHud();
        this.publishDiagnostics();
      },
      setPausedForScreenshot: (paused) => {
        this.pausedForScreenshot = paused;
      },
      setReducedMotion: (enabled) => {
        this.reducedMotion = enabled;
        this.cameraRig.setReducedMotion(enabled);
      },
      hideDebugUi: (hidden) => this.debugTools.setHidden(hidden),
    };
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    const playerState = this.race.getState(this.player.id);
    const targetProgress = this.track.checkpoints[playerState.nextCheckpoint];
    this.track.getPointAt(targetProgress, this.nextCheckpointPosition);
    this.track.getPointAt((playerState.progress + 0.034) % 1, this.playerLookAheadPosition);
    const racers = this.race.getAllStates().map((state) => {
      const boat = this.boats.find((candidate) => candidate.id === state.id);
      if (!boat) throw new Error(`Missing boat for racer ${state.id}`);
      return {
        id: state.id,
        isPlayer: state.isPlayer,
        position: { x: boat.group.position.x, y: boat.group.position.y, z: boat.group.position.z },
        speed: boat.speed,
        heading: boat.heading,
        lap: state.displayLap,
        checkpoint: state.checkpointCount,
        nextCheckpoint: state.nextCheckpoint,
        place: state.place,
        boost: boat.boost,
        wrongWay: state.wrongWay,
        finished: state.finished,
      };
    });
    const playerDiagnostic = racers.find((racer) => racer.isPlayer);
    if (!playerDiagnostic) return;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      raceTime: this.race.raceTime,
      state: this.race.phase,
      countdown: this.race.countdown,
      score: playerState.checkpointCount,
      targetScore: this.race.totalLaps * this.track.checkpoints.length,
      complete: this.race.phase === 'finished',
      finalPlacement: this.race.finalPlacement,
      player: {
        ...playerDiagnostic,
        nextCheckpointPosition: { x: this.nextCheckpointPosition.x, z: this.nextCheckpointPosition.z },
      },
      racers,
      track: {
        progress: playerState.progress,
        width: this.track.halfWidth * 2,
        checkpointCount: this.track.checkpoints.length,
        nextCheckpointPosition: { x: this.nextCheckpointPosition.x, z: this.nextCheckpointPosition.z },
        lookAheadPosition: { x: this.playerLookAheadPosition.x, z: this.playerLookAheadPosition.z },
      },
      collisions: {
        frame: this.collisionFrame.count,
        total: this.collisionTotal,
        strongest: this.collisionFrame.strongest,
      },
      input: this.input.snapshot(),
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: Math.min(window.devicePixelRatio || 1, this.tuning.maxDpr),
      },
    };
  }

  private makeBoatModel(id: string, color: THREE.ColorRepresentation, number: number): BoatModel {
    const model = createBoatModel({ color, number, materials: this.materials });
    this.boatModels.set(id, model);
    return model;
  }

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }
}
