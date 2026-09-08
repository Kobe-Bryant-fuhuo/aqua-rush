import { CourseFeatureVisuals } from '../assets/CourseFeatureVisuals';
import { CurrentField } from './CurrentField';
import { updateDrafting } from '../shared/RaceDrafting';
import * as THREE from 'three';
import { createBoatModel, type BoatModel, type BoatProfile } from '../assets/BoatModel';
import { CourseVisuals } from '../assets/CourseVisuals';
import { GuideLineRenderer, type GuideInteractionTone } from '../assets/GuideLineRenderer';
import { InteractionGateRenderer } from '../assets/InteractionGateRenderer';
import { NavigationBeacon } from '../assets/NavigationBeacon';
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
import { getTrackDefinition, makeRaceConfig, TRACK_IDS, type RaceConfig, type RaceMode, type TrackId } from './ContentCatalog';
import { GameFlow, type AppState } from './GameFlow';
import { InteractionSystem, type InteractionEvent } from './InteractionSystem';
import { RaceManager, type RaceEvent, type RacerFrame } from './RaceManager';
import { SaveStore, SAVE_SCHEMA_VERSION, type SaveData } from './SaveStore';
import { RaceTrack } from './Track';
import { OnlineController } from '../network/OnlineController';
import { NEUTRAL_INPUT, type RoomPhase, type RoomSnapshot } from '../shared/OnlineProtocol';

const AI_CONFIG = [
  { id: 'coral', name: 'KAI', color: ARCADE_PALETTE.coral, modelProfile: 'kai', personality: 'aggressive', laneOffset: 1.45, speedScale: 0.98, steeringScale: 1.05, lookAhead: 14.28 },
  { id: 'cyan', name: 'MIRA', color: ARCADE_PALETTE.cyan, modelProfile: 'mira', personality: 'clean', laneOffset: -1.45, speedScale: 1.015, steeringScale: 0.96, lookAhead: 17.22 },
  { id: 'violet', name: 'NOX', color: ARCADE_PALETTE.violet, modelProfile: 'nox', personality: 'erratic', laneOffset: 0.15, speedScale: 0.965, steeringScale: 1.1, lookAhead: 13.02 },
] as const;

type SessionRecordResult = { newLapRecord: boolean; newTotalRecord: boolean; previousBestTotal: number | null };

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(54, 1, 0.1, 900);
  private readonly materials = new MaterialLibrary();
  private readonly vfx = new VfxSystem(104, 120);
  private readonly input: InputController;
  private readonly audio = new AudioSystem();
  private readonly hud = new Hud();
  private readonly collision = new CollisionSystem();
  private readonly boatModels = new Map<string, BoatModel>();
  private readonly player: Player;
  private readonly aiRacers: AIRacer[];
  private readonly allBoats: ArcadeBoat[];
  private readonly originalBoatModels: BoatModel[];
  private readonly online: OnlineController;
  private readonly onlineBoats = new Map<string, ArcadeBoat>();
  private onlineEventSequence = 0;
  private onlinePhase: RoomPhase | null = null;
  private activeBoats: ArcadeBoat[] = [];
  private race!: RaceManager;
  private track!: RaceTrack;
  private waves!: WaveSurface;
  private ocean!: OceanVisual;
  private course!: CourseVisuals;
  private courseFeatures!: CourseFeatureVisuals;
  private guide!: GuideLineRenderer;
  private interactions!: InteractionSystem;
  private interactionVisuals!: InteractionGateRenderer;
  private navigationBeacon!: NavigationBeacon;
  private readonly cameraRig: CameraRig;
  private readonly debugTools: DebugTools;
  private readonly loop: Loop;
  private readonly saveStore = new SaveStore();
  private saveData!: SaveData;
  private saveAvailable = true;
  private readonly flow = new GameFlow();
  private config: RaceConfig = makeRaceConfig('quick-race', 'breakwater');
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
  private readonly recoveryPosition = new THREE.Vector3();
  private readonly rng = createSeededRandom(217);

  private frame = 0;
  private elapsed = 0;
  private pausedForScreenshot = false;
  private paused = false;
  private reducedMotion = false;
  private lastBoosting = false;
  private lastMiniBoosting = false;
  private lastSkillSerial = 0;
  private readonly lastLandingByBoat = new Map<string, number>();
  private collisionCooldown = 0;
  private collisionTotal = 0;
  private collisionFrame: CollisionResult = { count: 0, strongest: 0 };
  private lastCountdownPresentation: number | 'GO' | null = null;
  private stationaryDuration = 0;
  private recoveryCount = 0;
  private lastRecoveryReason: string | null = null;
  private lastEvent: { type: string; entityId?: string; outcome?: string } | null = null;
  private eventSequence = 0;
  private readonly handleFullscreen = (event: KeyboardEvent) => {
    if (event.code !== 'KeyF' || event.repeat) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, select, textarea')) return;
    event.preventDefault();
    if (document.fullscreenElement) void document.exitFullscreen();
    else void this.canvas.requestFullscreen();
  };

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    const loaded = this.saveStore.load();
    this.saveData = loaded.data;
    this.saveAvailable = loaded.storageAvailable;
    this.reducedMotion = loaded.data.settings.reducedMotion;
    this.audio.setMuted(loaded.data.settings.muted);

    const playerModel = this.makeBoatModel('player', ARCADE_PALETTE.sun, 7, 'hero');
    this.player = new Player(playerModel.root);
    this.aiRacers = AI_CONFIG.map((profile, index) => {
      const model = this.makeBoatModel(profile.id, profile.color, index + 1, profile.modelProfile);
      return new AIRacer(profile.id, profile.color, profile, model.root);
    });
    this.allBoats = [this.player, ...this.aiRacers];
    this.originalBoatModels = this.allBoats.map((boat) => this.boatModels.get(boat.id)!);
    this.allBoats.forEach((boat) => this.scene.add(boat.group));
    this.scene.add(this.vfx.root);

    const stick = this.getElement('#touch-stick');
    const knob = this.getElement('#touch-knob');
    const boostButton = this.getElement('#dash-button');
    boostButton.textContent = 'BOOST';
    this.input = new InputController(stick, knob, boostButton);
    this.cameraRig = new CameraRig(this.camera, this.tuning);
    this.cameraRig.setReducedMotion(this.reducedMotion);
    this.debugTools = new DebugTools(this.tuning, () => {
      this.renderer.toneMappingExposure = this.tuning.exposure;
      resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    });
    this.loop = new Loop((delta) => this.update(delta), () => this.render());

    this.installHudControls();
    window.addEventListener('keydown', this.handleFullscreen);
    this.configureTrack(this.saveData.lastSelection.trackId);
    this.configureRace(this.saveData.lastSelection.mode);
    this.resetRace(false);
    this.renderer.toneMappingExposure = this.track.definition.environment.exposure;
    this.hud.setMuted(this.audio.isMuted());
    this.hud.setReducedMotion(this.reducedMotion);
    this.flow.selectTrack(this.config.trackId);
    this.setFlow('title');
    this.installTestHooks();
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    this.publishDiagnostics();
    this.online = new OnlineController({
      enter: () => { this.pausedForScreenshot = false; this.setPaused(false); this.setFlow('title'); },
      leave: () => {
        this.restoreBoatModels();
        this.onlineBoats.clear();
        this.onlinePhase = null;
        this.configureTrack(this.saveData.lastSelection.trackId);
        this.configureRace(this.saveData.lastSelection.mode);
        this.resetRace(false);
        this.setFlow('title');
      },
      prepare: (snapshot, playerId) => this.prepareOnlineRace(snapshot, playerId),
      snapshot: (snapshot) => this.applyOnlineSnapshot(snapshot),
      notice: (message) => this.hud.announce(message, 'info'),
    });
  }

  start(): void {
    this.loop.start();
  }

  /** Deterministic fixed-step bridge used by the packaged web-game client. */
  advanceTime(milliseconds: number): void {
    if (this.online?.active) return;
    const steps = THREE.MathUtils.clamp(Math.round(Math.max(0, milliseconds) / (1000 / 60)), 1, 600);
    this.pausedForScreenshot = false;
    for (let step = 0; step < steps; step += 1) this.update(1 / 60);
    this.render();
    this.pausedForScreenshot = true;
    this.publishDiagnostics();
  }

  renderGameToText(): string {
    const diagnostics = window.__THREE_GAME_DIAGNOSTICS__;
    if (!diagnostics) return JSON.stringify({ mode: 'loading' });
    return JSON.stringify({
      coordinateSystem: 'world X right, Y up, -Z forward; positions are world units',
      mode: diagnostics.flow?.state ?? diagnostics.state,
      racePhase: diagnostics.state,
      selection: diagnostics.session,
      paused: this.paused || this.pausedForScreenshot,
      raceTime: diagnostics.raceTime,
      objective: {
        checkpointsPassed: diagnostics.score,
        targetCheckpoints: diagnostics.targetScore,
        lap: diagnostics.player.lap,
        place: diagnostics.player.place,
      },
      player: {
        position: diagnostics.player.position,
        speed: diagnostics.player.speed,
        heading: diagnostics.player.heading,
        boost: diagnostics.player.boost,
        nextCheckpoint: diagnostics.player.nextCheckpointPosition,
      },
      guide: diagnostics.guide,
      recovery: diagnostics.recovery,
      interactions: diagnostics.interactions,
      rivals: diagnostics.racers
        .filter((racer) => !racer.isPlayer)
        .map((racer) => ({ id: racer.id, position: racer.position, speed: racer.speed, place: racer.place })),
      collisions: diagnostics.collisions,
      input: diagnostics.input,
      complete: diagnostics.complete,
    });
  }

  dispose(): void {
    this.loop.stop();
    this.online.dispose();
    window.removeEventListener('keydown', this.handleFullscreen);
    this.input.dispose();
    this.audio.dispose();
    this.hud.dispose();
    this.debugTools.dispose();
    this.allBoats.forEach((boat) => boat.dispose());
    this.originalBoatModels.forEach((model) => model.dispose());
    this.disposeTrackVisuals();
    this.vfx.dispose();
    this.materials.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
    window.render_game_to_text = undefined;
    window.advanceTime = undefined;
  }

  private update(delta: number): void {
    this.frame += 1;
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    if (this.online?.active) { this.updateOnline(delta); return; }
    if (this.pausedForScreenshot) {
      this.publishDiagnostics();
      return;
    }
    if (!this.paused) this.elapsed += delta;
    const visualElapsed = this.reducedMotion ? 0 : this.elapsed;
    this.ocean.update(this.elapsed, this.player.group.position);
    this.course.update(visualElapsed, this.camera.position, this.elapsed);

    if (this.isMenuFlow()) {
      this.updateMenuPreview(delta);
      this.guide.root.visible = false;
      this.navigationBeacon.root.visible = false;
      this.publishDiagnostics();
      return;
    }

    if (this.input.consumeRestart()) this.resetRace();
    if (this.input.consumePause() && this.race.phase !== 'finished') this.setPaused(!this.paused);
    if (this.input.consumeRecovery()) this.recoverPlayer('explicit');
    if (this.paused) {
      this.updateHud();
      this.publishDiagnostics();
      return;
    }

    this.collisionCooldown = Math.max(0, this.collisionCooldown - delta);
    const canRace = this.race.phase === 'racing';
    this.player.update(delta, this.elapsed, this.input, this.tuning, this.waves, canRace && !this.race.getState(this.player.id).finished);
    const playerScore = this.race.raceScore(this.player.id);
    for (const racer of this.aiRacers) {
      if (!this.activeBoats.includes(racer)) continue;
      const state = this.race.getState(racer.id);
      racer.update(
        delta,
        this.elapsed,
        this.track,
        this.waves,
        this.race.raceScore(racer.id),
        playerScore,
        state.nextCheckpoint,
        canRace && !state.finished,
      );
    }

    this.collisionFrame = canRace ? this.collision.resolve(this.activeBoats, this.track, this.elapsed) : { count: 0, strongest: 0 };
    const draftRivals = this.activeBoats.filter(boat => !this.race.getState(boat.id).finished)
      .map(boat => ({ id: boat.id, position: boat.group.position, velocity: boat.velocity }));
    for (const boat of this.activeBoats) updateDrafting(delta, boat, draftRivals, canRace && !this.race.getState(boat.id).finished);
    this.handleCollisions();
    this.interactions.update(delta, this.activeBoats.filter(boat => !this.race.getState(boat.id).finished), canRace, id => this.race.getState(id).lap);
    this.handleInteractionEvents(this.interactions.consumeEvents());
    this.collectRacerFrames();
    this.race.update(delta, this.racerFrames, this.track);
    this.handleRaceEvents(this.race.consumeEvents());
    this.updateRecoveryEligibility(delta);
    this.updatePresentation(delta, visualElapsed);
    this.updateHud();
    this.publishDiagnostics();
  }

  private updateMenuPreview(delta: number): void {
    const focus = this.track.getPointAt(.22);
    const angle = this.reducedMotion ? .6 : .6 + Math.sin(this.elapsed * .08) * .25;
    this.camera.position.set(focus.x + Math.cos(angle) * 130, 80, focus.z + Math.sin(angle) * 120);
    this.camera.lookAt(focus.x - 10, 6, focus.z);
    this.camera.fov = 52; this.camera.updateProjectionMatrix();
    this.courseFeatures.update(this.elapsed, this.reducedMotion);
    for (const boat of this.activeBoats) boat.updateWaterPose(delta, this.elapsed, this.waves);
    this.ocean.update(this.elapsed, focus);
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private restoreBoatModels(): void {
    for (const boat of this.allBoats) boat.visualRoot.clear();
    this.allBoats.forEach((boat, index) => {
      const model = this.originalBoatModels[index];
      boat.visualRoot.add(model.root);
      this.boatModels.set(boat.id, model);
    });
  }

  private prepareOnlineRace(snapshot: RoomSnapshot, playerId: string): void {
    this.setPaused(false);
    this.configureTrack(snapshot.trackId);
    this.config = makeRaceConfig('quick-race', snapshot.trackId);
    this.onlineBoats.clear();
    // The camera keeps its local player object. Network IDs and model slots remain
    // stable across clients; the map is only a rendering adapter, never race identity.
    const players = [...snapshot.players].sort((a, b) => a.id === playerId ? -1 : b.id === playerId ? 1 : a.slot - b.slot);
    this.activeBoats = this.allBoats.slice(0, players.length);
    for (const boat of this.allBoats) { boat.visualRoot.clear(); boat.group.visible = false; }
    players.forEach((player, index) => {
      const boat = this.allBoats[index];
      const model = this.originalBoatModels[player.slot];
      boat.visualRoot.add(model.root);
      boat.group.visible = true;
      this.boatModels.set(boat.id, model);
      this.onlineBoats.set(player.id, boat);
      const state = snapshot.race?.racers.find((entry) => entry.id === player.id);
      if (state) boat.restoreState(state.body);
    });
    this.race = new RaceManager(players.map((player, index) => ({
      id: this.allBoats[index].id, name: player.name, isPlayer: player.id === playerId,
    })));
    this.onlineEventSequence = Math.max(0, ...snapshot.race!.events.map((entry) => entry.id));
    this.onlinePhase = null;
    this.lastCountdownPresentation = null;
    this.lastBoosting = this.lastMiniBoosting = false;
    this.lastLandingByBoat.clear();
    this.audio.reset();
    this.hud.hideResults();
    this.hud.updateTimeTrial(null);
    this.cameraRig.snapTo(this.player);
  }

  private applyOnlineSnapshot(snapshot: RoomSnapshot): void {
    const race = snapshot.race;
    if (!race) {
      if (this.onlinePhase !== 'lobby') { this.setPaused(false); this.setFlow('title'); }
      this.onlinePhase = 'lobby';
      return;
    }
    const wasFinished = this.race.getState(this.player.id).finished;
    const racers = race.racers.flatMap((entry) => {
      const boat = this.onlineBoats.get(entry.id);
      return boat ? [{ ...entry.race, id: boat.id, isPlayer: boat === this.player }] : [];
    });
    this.race.applyRemoteState(race.phase, race.countdown, race.raceTime, racers);
    this.interactions.applyRemoteStates(race.gates.map((gate) => ({ ...gate, center: new THREE.Vector3(...gate.center) })));
    if (this.onlinePhase !== snapshot.phase) {
      if (snapshot.phase === 'results') this.setPaused(false);
      if (!this.paused) this.setFlow(snapshot.phase === 'results' ? 'results' : snapshot.phase === 'racing' ? 'racing' : 'countdown');
      this.onlinePhase = snapshot.phase;
    }
    if (!wasFinished && this.race.getState(this.player.id).finished) {
      this.audio.finish(this.race.getState(this.player.id).place);
      this.hud.announce('FINISHED — WAITING FOR OTHER RACERS', 'info');
    }
    for (const entry of race.events) {
      if (entry.id <= this.onlineEventSequence) continue;
      this.onlineEventSequence = entry.id;
      const event = entry.event;
      if ('gateId' in event) {
        const boat = this.onlineBoats.get(event.racerId);
        if (boat) this.handleInteractionEvents([{ ...event, racerId: boat.id }]);
      } else if (event.type === 'start') this.audio.startSignal();
      else if ('racerId' in event) {
        const boat = this.onlineBoats.get(event.racerId);
        if (boat) this.handleRaceEvents([{ ...event, racerId: boat.id }]);
      } else if (event.type === 'countdown') this.audio.countdown(event.tick);
    }
  }

  private updateOnline(delta: number): void {
    const snapshot = this.online.latest;
    if (this.input.consumeRestart()) this.online.rematch();
    if (this.input.consumePause() && snapshot?.phase === 'racing') this.setPaused(!this.paused);
    if (this.input.consumeRecovery()) this.online.recover();
    if (!snapshot?.race || !this.online.prediction) { this.publishDiagnostics(); return; }
    const self = snapshot.players.find((player) => player.id === this.online.connection.playerId);
    const canDrive = snapshot.phase === 'racing' && !this.paused && !self?.dnf &&
      !this.race.getState(this.player.id).finished && this.online.connection.connected && !document.hidden;
    this.input.setRaceInputEnabled(canDrive);
    this.online.update(delta, canDrive ? this.input.snapshot() : NEUTRAL_INPUT);
    this.elapsed = this.online.prediction.elapsed;
    const visualElapsed = this.reducedMotion ? 0 : this.elapsed;
    for (const [id, boat] of this.onlineBoats) {
      const body = this.online.prediction.body(id);
      if (body) boat.restoreState(body);
      boat.group.visible = !snapshot.players.find((player) => player.id === id)?.dnf;
    }
    this.ocean.update(this.elapsed, this.player.group.position);
    this.course.update(visualElapsed, this.camera.position, this.elapsed);
    this.updatePresentation(delta, visualElapsed);
    this.updateHud();
    this.publishDiagnostics();
  }

  private configureTrack(trackId: TrackId): void {
    this.disposeTrackVisuals();
    const definition = getTrackDefinition(trackId);
    this.track = new RaceTrack(definition);
    this.hud.setMinimap(this.track);
    const currents = new CurrentField(this.track);
    for (const boat of this.allBoats) { boat.currentField = currents; boat.worldMechanics = this.track.mechanics; }
    this.waves = new WaveSurface(definition.waves.waves);
    this.ocean = new OceanVisual(this.waves, { nearSize: 280, nearSegments: 96, midSize: 680, midSegments: 32, farSize: 1200, farSegments: 12 });
    this.ocean.applyEnvironment({
      water: definition.environment.water,
      deepWater: definition.environment.deepWater,
      foam: definition.environment.foam,
      sun: definition.environment.sun,
      storm: definition.environment.storm,
    });
    this.course = new CourseVisuals({ definition, centerline: this.track.points, courseWidth: this.track.halfWidth * 2, buoySpacing: definition.buoySpacing, materials: this.materials, seed: definition.seed });
    this.course.install(this.scene);
    this.course.setTrack(this.track);
    this.courseFeatures = new CourseFeatureVisuals(this.track, this.waves);
    this.scene.add(this.courseFeatures.root);
    this.guide = new GuideLineRenderer(this.track, this.waves, { aheadDistance: 160, behindDistance: 22, segments: 112, width: 1.65, surfaceOffset: 0.28 });
    this.interactions = new InteractionSystem(this.track);
    this.interactionVisuals = new InteractionGateRenderer(this.track);
    this.navigationBeacon = new NavigationBeacon();
    this.scene.add(this.ocean.root, this.guide.root, this.interactionVisuals.root, this.navigationBeacon.root);
    this.config = makeRaceConfig(this.config.mode, trackId);
    this.renderer.toneMappingExposure = definition.environment.exposure;
  }

  private disposeTrackVisuals(): void {
    this.course?.dispose();
    this.courseFeatures?.dispose();
    this.ocean?.root.removeFromParent();
    this.ocean?.dispose();
    this.guide?.root.removeFromParent();
    this.guide?.dispose();
    this.interactionVisuals?.dispose();
    this.navigationBeacon?.dispose();
  }

  private configureRace(mode: RaceMode): void {
    this.config = makeRaceConfig(mode, this.config.trackId);
    this.activeBoats = mode === 'quick-race' ? this.allBoats : [this.player];
    for (const boat of this.allBoats) boat.group.visible = this.activeBoats.includes(boat);
    this.race = new RaceManager([
      { id: this.player.id, name: 'YOU', isPlayer: true },
      ...(mode === 'quick-race' ? AI_CONFIG.map((profile) => ({ id: profile.id, name: profile.name, isPlayer: false })) : []),
    ]);
  }

  private startSession(mode: RaceMode, trackId: TrackId): void {
    if (this.online?.active) return;
    if (trackId !== this.config.trackId) this.configureTrack(trackId);
    this.configureRace(mode);
    this.saveStore.setSelection(mode, trackId);
    this.saveData = this.saveStore.snapshot();
    this.resetRace();
  }

  private resetRace(updateFlow = true): void {
    if (this.online?.active) { this.online.rematch(); return; }
    this.setPaused(false);
    this.elapsed = 0;
    this.lastBoosting = false;
    this.lastMiniBoosting = false;
    this.lastLandingByBoat.clear();
    this.collisionCooldown = 0;
    this.collisionFrame = { count: 0, strongest: 0 };
    this.collisionTotal = 0;
    this.stationaryDuration = 0;
    this.recoveryCount = 0;
    this.lastRecoveryReason = null;
    this.lastCountdownPresentation = null;
    const grid = this.track.definition.spawnGrid.map((slot, index) => ({
      boat: this.allBoats[index],
      ...slot,
    }));
    this.initialProgress.clear();
    for (const spawn of grid) {
      const position = this.track.getOffsetPoint(spawn.progress, spawn.lane);
      position.y = this.waves.getHeight(position.x, position.z, 0) + 0.42;
      spawn.boat.reset(position, this.track.headingAt(spawn.progress));
      spawn.boat.updateWaterPose(1, 0, this.waves);
      if (this.activeBoats.includes(spawn.boat)) this.initialProgress.set(spawn.boat.id, spawn.progress);
    }
    this.race.reset(this.initialProgress);
    this.interactions.reset();
    this.audio.reset();
    this.hud.hideResults();
    this.hud.updateTimeTrial(this.config.mode === 'time-trial' ? this.timeTrialHudState() : null);
    this.cameraRig.snapTo(this.player);
    this.collectRacerFrames();
    if (updateFlow) this.setFlow('countdown');
    this.updateHud();
  }

  private collectRacerFrames(): void {
    this.racerFrames.length = 0;
    for (const boat of this.activeBoats) this.racerFrames.push({ id: boat.id, position: boat.group.position, velocity: boat.velocity });
  }

  private updatePresentation(delta: number, visualElapsed: number): void {
    this.courseFeatures.update(this.elapsed, this.reducedMotion);
    const playerState = this.race.getState(this.player.id);
    const projection = this.track.project(this.player.group.position);
    this.guide.root.visible = true;
    this.guide.update(this.elapsed, {
      progress: playerState.progress,
      offRoute: projection.distance,
      wrongWay: playerState.wrongWay,
      interactionTone: this.nearestInteractionTone(playerState.progress),
      widthScale: projection.distance > 48 ? 1.55 : 1,
    });
    const nextCheckpoint = this.track.getCheckpoint(playerState.nextCheckpoint);
    const checkpointDistance = this.player.group.position.distanceTo(nextCheckpoint.center);
    this.navigationBeacon.update(this.elapsed, nextCheckpoint.center, projection.distance > 45 || checkpointDistance < 120);
    const interactionStates = this.interactions.getStates(this.online?.active ? this.online.connection.playerId : this.player.id, this.race.getState(this.player.id).lap);
    this.interactionVisuals.update(interactionStates, this.elapsed);

    for (const boat of this.activeBoats) {
      const state = this.race.getState(boat.id);
      this.boatModels.get(boat.id)?.update(delta, visualElapsed, {
        speed: Math.abs(boat.speed),
        boost: boat.ordinaryBoosting ? 1 : boat.miniBoosting ? 0.68 : 0,
        turn: boat.steering,
        throttle: boat.throttle,
        drift: boat.drifting ? Math.max(0.4, boat.driftQuality) : 0,
        airborne: boat.airborne,
        landing: boat.landingIntensity,
        finished: state.finished,
      });
      boat.getForward(this.forward);
      this.vfx.updateBoatWake(boat.id, {
        position: boat.group.position,
        forward: this.forward,
        speed: boat.flightActive ? 0 : Math.abs(boat.speed),
        boost: boat.boosting ? 1 : 0,
        drift: boat.drifting ? Math.max(0.35, boat.driftQuality) : 0,
      }, delta);
      const previousLanding = this.lastLandingByBoat.get(boat.id) ?? 0;
      if (boat.landingIntensity > 0.18 && boat.landingIntensity > previousLanding + 0.08) {
        this.vfx.emitSpray(boat.group.position, undefined, 0.25 + boat.landingIntensity * 0.7);
        if (boat === this.player) {
          this.audio.landing(boat.landingIntensity);
          this.cameraRig.addTrauma(0.07 + boat.landingIntensity * 0.14);
          this.hud.announce('WAVE LANDING!', 'boost');
          this.recordEvent('landing', boat.id);
        }
      }
      this.lastLandingByBoat.set(boat.id, boat.landingIntensity);
    }
    this.vfx.update(delta);
    if (this.player.boosting && !this.lastBoosting) {
      this.audio.boost();
      this.cameraRig.punchFov(4.5);
      this.recordEvent('boost', this.player.id);
    }
    if (this.player.miniBoosting && !this.lastMiniBoosting) {
      this.audio.driftBoost(Math.max(0.2, this.player.driftQuality));
      this.cameraRig.punchFov(3.2);
      this.recordEvent('drift-boost', this.player.id);
    }
    this.lastBoosting = this.player.boosting;
    this.lastMiniBoosting = this.player.miniBoosting;
    const speedRatio = Math.max(0, this.player.speed) / this.tuning.maxForwardSpeed;
    this.audio.updateEngine(speedRatio, this.player.boosting, delta);
    this.cameraRig.update(delta, visualElapsed, this.player, speedRatio);
  }

  private handleCollisions(): void {
    if (this.collisionFrame.count <= 0) return;
    this.collisionTotal += this.collisionFrame.count;
    if (this.collisionCooldown > 0) return;
    this.collisionCooldown = 0.16;
    this.audio.collision(this.collisionFrame.strongest);
    this.cameraRig.addTrauma(0.18 + this.collisionFrame.strongest * 0.34);
    this.vfx.emitImpact(this.player.group.position, undefined, this.collisionFrame.strongest);
    this.hud.announce('HULL IMPACT!', 'warning');
    this.recordEvent('collision', this.player.id);
  }

  private handleInteractionEvents(events: InteractionEvent[]): void {
    for (const event of events) {
      if (event.racerId !== this.player.id) continue;
      const success = event.outcome === 'success';
      this.audio.interaction(event.kind, success);
      this.vfx.emitSpray(this.player.group.position, undefined, success ? 0.9 : 0.34);
      this.hud.announce(
        event.kind === 'boost-gate'
          ? 'BOOST GATE — ENERGY RESTORED!'
          : success ? 'DRIFT GATE — MINI BOOST!' : 'DRIFT REQUIRED',
        success ? 'boost' : 'warning',
      );
      if (success) this.cameraRig.punchFov(event.kind === 'boost-gate' ? 4.2 : 3.4);
      this.recordEvent(event.kind, event.racerId, event.outcome);
    }
  }

  private handleRaceEvents(events: RaceEvent[]): void {
    for (const event of events) {
      if (event.type === 'countdown') this.audio.countdown(event.tick);
      else if (event.type === 'start') {
        this.audio.startSignal();
        this.setFlow('racing');
      } else if (event.type === 'checkpoint' && event.racerId === this.player.id) {
        this.audio.checkpoint();
        this.recordEvent('checkpoint', event.racerId);
      } else if (event.type === 'lap' && event.racerId === this.player.id) {
        this.audio.lap(event.lap);
        this.cameraRig.punchFov(2.5);
        this.recordEvent('lap', event.racerId);
      } else if (event.type === 'player-finish') {
        this.audio.finish(event.place);
        this.showResults(event.place, event.time);
        this.recordEvent('finish', this.player.id);
      }
    }
  }

  private showResults(place: number, totalTime: number): void {
    const playerState = this.race.getState(this.player.id);
    const result = this.recordTimeTrialIfNeeded(playerState.bestLap, totalTime);
    this.hud.showResultsV3({
      mode: this.config.mode,
      courseName: this.track.definition.name,
      totalTime,
      bestLap: playerState.bestLap,
      previousBestTotal: result.previousBestTotal,
      position: place,
      totalRacers: this.activeBoats.length,
      newLapRecord: result.newLapRecord,
      newTotalRecord: result.newTotalRecord,
    });
    this.flow.transition('results');
    this.input.setRaceInputEnabled(false);
  }

  private recordTimeTrialIfNeeded(bestLap: number | null, totalTime: number): SessionRecordResult {
    const previous = this.saveData.timeTrial[this.config.trackId];
    if (this.config.mode !== 'time-trial' || bestLap === null) {
      return { newLapRecord: false, newTotalRecord: false, previousBestTotal: previous.bestTotal };
    }
    const previousBestTotal = previous.bestTotal;
    const records = this.saveStore.recordTimeTrial(this.config.trackId, bestLap, totalTime);
    this.saveData = this.saveStore.snapshot();
    return { ...records, previousBestTotal };
  }

  private updateHud(): void {
    const state = this.race.getState(this.player.id);
    if (this.player.skillSerial !== this.lastSkillSerial) {
      this.lastSkillSerial = this.player.skillSerial;
      if (this.player.skillSerial > 0) {
        const skillName = ['', '漂移释放', '精准落水', '抢门成功', '尾流超车'][this.player.skillKind] ?? '技巧';
        this.hud.announce(skillName + ' / 连段 ×' + this.player.skillChain, 'boost');
      }
    }
    const countdown = this.race.phase === 'countdown' && this.flow.snapshot.state === 'countdown' ? Math.ceil(this.race.countdown) : null;
    if (countdown !== this.lastCountdownPresentation) {
      this.hud.setCountdown(countdown);
      this.lastCountdownPresentation = countdown;
    }
    const projection = this.track.project(this.player.group.position);
    const status = state.wrongWay
      ? 'WRONG WAY — FOLLOW THE CORAL FLOW'
      : projection.distance > 55
        ? 'OPEN WATER — GUIDE BEACON AHEAD · X TO RECOVER'
        : this.race.phase === 'finished'
          ? 'SESSION COMPLETE'
          : this.player.draftReady ? '尾流蓄满 · 拉出超车！'
          : this.player.drifting
            ? this.player.driftCharge >= .4 ? '漂移蓄满 · 松开增压键！' : '按住增压键 · 保持漂移'
            : this.player.skillTime > 8
              ? (['', '漂移', '精准落水', '抢门', '尾流超车'][this.player.skillKind] ?? '技巧') + '连段 ×' + this.player.skillChain
            : this.player.miniBoosting
              ? 'DRIFT BURST!'
              : this.player.ordinaryBoosting
                ? 'BOOSTING!'
                : 'FOLLOW THE FLOW';
    const currentStrength = this.player.waterCurrent.length();
    const nextRamp = this.track.mechanics.ramps.find(ramp => this.track.forwardDistance(projection.progress, ramp.progress) < .075);
    const nextLock = this.track.definition.crossings?.find(lock => this.track.forwardDistance(projection.progress, lock.progress) < .09);
    const crossing = nextLock ? this.track.mechanics.crossing(nextLock, this.elapsed) : null;
    const crossingTitle = crossing?.phase === 'warning' ? '横渡预警 / ' + crossing.remaining.toFixed(1) + ' s'
      : crossing?.phase === 'crossing' ? '作业船横渡 / 右侧绕行' : '中线开放 / 留意黄灯';
    const title = this.player.flightActive ? 'AIRTIME / ' + this.player.flightTime.toFixed(1) + ' s'
      : this.player.flightCooldown > .3 ? '落水接力 / BOOST'
      : currentStrength > 1 ? '借流中 / 顺着水纹出弯'
      : nextRamp ? '前方跳台 / 稳住船头'
      : nextLock ? crossingTitle : this.player.draftReady ? '尾流蓄满 / 拉出超车'
      : this.player.drafting ? '尾流蓄力 / ' + Math.floor(this.player.draftCharge / 1.25 * 100) + '%' : '';
    this.hud.updateCourseFeature(title, this.player.flightActive ? '空中可微调方向，准备落水'
      : currentStrength > 1 ? '提前反打修正，外侧可绕行' : nextRamp ? '保持速度飞跃；落水前摆正船头'
      : nextLock ? '估算到达时间，右侧青色水道始终开放' : '跟住同向对手，蓄满后侧移获得增压');
    const mapTarget = this.track.getCheckpoint(state.nextCheckpoint).center;
    this.hud.updateMinimap(this.player.group.position.x, this.player.group.position.z, mapTarget.x, mapTarget.z);
    this.hud.updateRace({
      speed: Math.max(0, currentStrength > 0 ? this.player.velocity.length() : this.player.speed),
      lap: state.displayLap,
      totalLaps: this.race.totalLaps,
      position: state.place,
      totalRacers: this.activeBoats.length,
      elapsed: this.race.raceTime,
      boost: this.player.boost,
      steering: this.player.steering,
      drifting: this.player.drifting,
      driftCharge: this.player.driftCharge,
      skillChain: this.player.skillChain, draftCharge: this.player.draftCharge, draftReady: this.player.draftReady,
      status,
    });
    this.hud.updateTimeTrial(this.config.mode === 'time-trial' ? this.timeTrialHudState() : null);
  }

  private timeTrialHudState() {
    const state = this.race.getState(this.player.id);
    const record = this.saveData.timeTrial[this.config.trackId];
    return {
      currentLap: state.currentLapTime,
      bestLap: state.bestLap ?? record.bestLap,
      bestTotal: record.bestTotal,
      comparisonToBest: record.bestLap === null ? null : state.currentLapTime - record.bestLap,
    };
  }

  private updateRecoveryEligibility(delta: number): void {
    const state = this.race.getState(this.player.id);
    if (this.race.phase === 'racing' && Math.abs(this.player.speed) < 0.65) this.stationaryDuration += delta;
    else this.stationaryDuration = Math.max(0, this.stationaryDuration - delta * 2);
    if (state.distanceFromTrack > 85 && this.stationaryDuration > 4) this.hud.announce('RECOVERY AVAILABLE — PRESS X', 'warning');
  }

  private recoverPlayer(reason: 'explicit' | 'trapped' | 'severe'): void {
    if (this.online?.active) { this.online.recover(); return; }
    if (this.isMenuFlow() || this.race.phase === 'finished') return;
    const state = this.race.getState(this.player.id);
    const lastIndex = (state.nextCheckpoint - 1 + this.track.checkpointPlanes.length) % this.track.checkpointPlanes.length;
    const checkpoint = this.track.getCheckpoint(lastIndex);
    this.recoveryPosition.copy(checkpoint.center).addScaledVector(checkpoint.normal, 2.2);
    this.recoveryPosition.y = this.waves.getHeight(this.recoveryPosition.x, this.recoveryPosition.z, this.elapsed) + 0.42;
    const remainingBoost = this.player.boost;
    this.player.reset(this.recoveryPosition, Math.atan2(checkpoint.normal.x, -checkpoint.normal.z));
    this.player.boost = remainingBoost;
    this.player.updateWaterPose(1, this.elapsed, this.waves);
    this.race.synchronizeFrame({ id: this.player.id, position: this.player.group.position, velocity: this.player.velocity }, this.track);
    this.cameraRig.snapTo(this.player);
    this.stationaryDuration = 0;
    this.recoveryCount += 1;
    this.lastRecoveryReason = reason;
    this.hud.announce('RECOVERED AT LAST VALID SECTOR', 'info');
    this.recordEvent('recovery', this.player.id, reason);
  }

  private nearestInteractionTone(progress: number): GuideInteractionTone {
    let closest = 1;
    let tone: GuideInteractionTone = 'normal';
    for (const gate of this.track.definition.interactions) {
      const distance = this.track.forwardDistance(progress, gate.progress);
      if (distance < closest && distance < 0.16) {
        closest = distance;
        tone = gate.kind === 'boost-gate' ? 'boost' : 'drift';
      }
    }
    return tone;
  }

  private setPaused(paused: boolean): void {
    this.paused = paused;
    this.hud.setPaused(paused);
    void this.audio.setPaused(paused);
    if (paused) {
      this.online?.prediction?.releaseInput();
      this.flow.transition('paused');
      this.input.setRaceInputEnabled(false);
    } else if (this.flow.snapshot.state === 'paused') {
      this.flow.transition(this.race.phase === 'countdown' ? 'countdown' : 'racing');
      this.input.setRaceInputEnabled(true);
    }
  }

  private setFlow(state: AppState): void {
    this.flow.transition(state);
    this.hud.showFlow(state);
    const ownsInput = state === 'countdown' || state === 'racing';
    this.input.setRaceInputEnabled(ownsInput);
    if (state !== 'results') this.hud.hideResults();
  }

  private isMenuFlow(): boolean {
    const state = this.flow.snapshot.state;
    return state === 'loading' || state === 'title' || state === 'mode-select' || state === 'track-select' || state === 'results';
  }

  private installHudControls(): void {
    this.hud.onRestart(() => this.resetRace());
    this.hud.onPause(() => { if (this.race.phase !== 'finished') this.setPaused(!this.paused); });
    this.hud.onMute(() => {
      const muted = this.audio.toggleMuted();
      this.hud.setMuted(muted);
      this.saveStore.setMuted(muted);
      this.saveData = this.saveStore.snapshot();
    });
    this.hud.onStart(() => this.setFlow('mode-select'));
    this.hud.onModeSelect((mode) => {
      this.flow.selectMode(mode);
      this.showCourseSelection(mode, this.config.trackId);
    });
    this.hud.onCoursePreview(id => {
      this.flow.selectTrack(id); this.configureTrack(id);
      this.allBoats.forEach((boat, i) => { const slot = this.track.definition.spawnGrid[i]; boat.reset(this.track.getOffsetPoint(slot.progress, slot.lane), this.track.headingAt(slot.progress)); });
    });
    this.hud.onCourseSelect((trackId) => this.startSession(this.flow.snapshot.mode, trackId));
    this.hud.onBack((from) => this.setFlow(from === 'track-select' ? 'mode-select' : 'title'));
    this.hud.onRecovery(() => this.recoverPlayer('explicit'));
    this.hud.onMenu(() => {
      if (this.online.active) { this.online.leave(); return; }
      this.setPaused(false);
      this.setFlow('title');
    });
    this.hud.onReducedMotion((enabled) => {
      this.reducedMotion = enabled;
      this.cameraRig.setReducedMotion(enabled);
      this.saveStore.setReducedMotion(enabled);
      this.saveData = this.saveStore.snapshot();
    });
    this.hud.onResetRecords(() => {
      this.saveStore.resetRecords();
      this.saveData = this.saveStore.snapshot();
      this.hud.announce('TIME TRIAL RECORDS RESET', 'info');
    });
    this.hud.onOtherCourse(() => {
      if (this.online.active) return;
      const other = TRACK_IDS[(TRACK_IDS.indexOf(this.config.trackId) + 1) % TRACK_IDS.length];
      this.showCourseSelection(this.config.mode, other);
    });
  }

  private showCourseSelection(mode: RaceMode, selectedTrack: TrackId): void {
    this.flow.selectMode(mode);
    this.flow.selectTrack(selectedTrack);
    this.hud.showCourseSelect({
      mode,
      selectedTrack,
      courses: TRACK_IDS.map((id) => {
        const definition = getTrackDefinition(id);
        return {
          id,
          name: definition.name,
          description: definition.description,
          difficulty: definition.difficulty,
          environmentLabel: definition.environment.label,
          bestTotal: this.saveData.timeTrial[id].bestTotal,
        };
      }),
    });
    this.input.setRaceInputEnabled(false);
  }

  private installTestHooks(): void {
    window.render_game_to_text = () => this.renderGameToText();
    window.advanceTime = (milliseconds: number) => this.advanceTime(milliseconds);
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => { void this.rng; this.vfx.seed(value); },
      setState: (name) => {
        this.startSession('quick-race', 'breakwater');
        if (name === 'active-play') {
          this.collectRacerFrames();
          this.race.startImmediately(this.racerFrames, this.track);
          this.setFlow('racing');
        } else if (name === 'complete') {
          this.collectRacerFrames();
          this.race.startImmediately(this.racerFrames, this.track);
          this.setFlow('racing');
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
      setPausedForScreenshot: (paused) => { this.pausedForScreenshot = paused; },
      setReducedMotion: (enabled) => {
        this.reducedMotion = enabled;
        this.cameraRig.setReducedMotion(enabled);
        this.hud.setReducedMotion(enabled);
      },
      hideDebugUi: (hidden) => this.debugTools.setHidden(hidden),
      selectSession: (mode, trackId) => this.startSession(mode, trackId),
      recover: () => this.recoverPlayer('explicit'),
      setPlayerKinematics: (x, y, z, vx, vy, vz) => {
        this.player.group.position.set(x, y, z);
        this.player.velocity.set(vx, vy, vz);
        this.player.syncSpeedFromVelocity();
        // Deterministic QA staging must move the chase camera with the boat;
        // otherwise a valid production collision/gate event is captured from
        // the previous location while the spring camera catches up.
        this.cameraRig.snapTo(this.player);
      },
    };
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    const playerState = this.race.getState(this.player.id);
    const targetCheckpoint = this.track.getCheckpoint(playerState.nextCheckpoint);
    this.nextCheckpointPosition.copy(targetCheckpoint.center);
    // Look ahead along the visible guide: aiming directly at a distant sector can cut through a bank.
    this.track.getDrivingTarget(this.player.group.position, playerState.nextCheckpoint, this.player.speed, this.playerLookAheadPosition, this.elapsed);
    const racers = this.race.getAllStates().map((state) => {
      const boat = this.activeBoats.find((candidate) => candidate.id === state.id);
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
        ordinaryBoosting: boat.ordinaryBoosting,
        miniBoosting: boat.miniBoosting,
        drifting: boat.drifting,
        driftCharge: boat.driftCharge,
        driftQuality: boat.driftQuality,
        contact: boat.contact,
        airborne: boat.airborne,
        flightActive: boat.flightActive, flightTime: boat.flightTime, jumps: boat.jumps,
        skillChain: boat.skillChain, skillKind: boat.skillKind, skillSerial: boat.skillSerial, draftCharge: boat.draftCharge, draftReady: boat.draftReady,
        landingIntensity: boat.landingIntensity,
        steering: boat.steering,
        throttle: boat.throttle,
        wrongWay: state.wrongWay,
        finished: state.finished,
      };
    });
    const playerDiagnostic = racers.find((racer) => racer.isPlayer);
    if (!playerDiagnostic) return;
    const projection = this.track.project(this.player.group.position);
    const offRouteState = projection.distance > 90 ? 'severe' : projection.distance > 45 ? 'significant' : projection.distance > 18 ? 'mild' : 'on-route';
    const interactionStates = this.interactions.getStates(this.online?.active ? this.online.connection.playerId : this.player.id, this.race.getState(this.player.id).lap);
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
      player: { ...playerDiagnostic, nextCheckpointPosition: { x: this.nextCheckpointPosition.x, z: this.nextCheckpointPosition.z } },
      racers,
      track: {
        progress: playerState.progress,
        width: this.track.halfWidth * 2,
        checkpointCount: this.track.checkpoints.length,
        nextCheckpointPosition: { x: this.nextCheckpointPosition.x, z: this.nextCheckpointPosition.z },
        lookAheadPosition: { x: this.playerLookAheadPosition.x, z: this.playerLookAheadPosition.z },
        distanceFromRoute: projection.distance,
        offRouteState,
        worldSize: 800,
        checkpoints: this.track.checkpointPlanes.map((checkpoint, index) => ({
          index,
          position: { x: checkpoint.center.x, y: checkpoint.center.y, z: checkpoint.center.z },
          forward: { x: checkpoint.normal.x, y: checkpoint.normal.y, z: checkpoint.normal.z },
          lateral: { x: checkpoint.right.x, y: checkpoint.right.y, z: checkpoint.right.z },
          halfWidth: checkpoint.halfWidth,
          height: checkpoint.height,
          visible: checkpoint.definition.visible,
          finish: checkpoint.definition.role === 'finish',
        })),
      },
      flow: {
        state: this.flow.snapshot.state,
        inputOwner: this.flow.snapshot.state === 'paused' ? 'pause' : this.isMenuFlow() ? 'menu' : 'race',
      },
      session: {
        mode: this.config.mode,
        trackId: this.config.trackId,
        trackName: this.track.definition.name,
        racerCount: this.activeBoats.length,
        currentLapTime: playerState.currentLapTime,
        bestLap: playerState.bestLap ?? this.saveData.timeTrial[this.config.trackId].bestLap,
        bestTotal: this.saveData.timeTrial[this.config.trackId].bestTotal,
      },
      validation: {
        expectedIndex: playerState.nextCheckpoint,
        acceptedCount: this.race.validation.accepted,
        rejectedCount: this.race.validation.rejected,
        lastReason: this.race.validation.lastReason,
        lastIndex: this.race.validation.lastIndex,
      },
      guide: {
        state: playerState.wrongWay ? 'wrong-way' : projection.distance > 45 ? 'return' : this.nearestInteractionTone(playerState.progress),
        brightestAheadStart: 80,
        brightestAheadEnd: 160,
        beaconVisible: projection.distance > 45 || this.player.group.position.distanceTo(targetCheckpoint.center) < 120,
      },
      recovery: {
        eligible: projection.distance > 55 || this.stationaryDuration > 4,
        lastValidCheckpoint: (playerState.nextCheckpoint - 1 + this.track.checkpoints.length) % this.track.checkpoints.length,
        count: this.recoveryCount,
        lastReason: this.lastRecoveryReason,
      },
      interactions: {
        gates: interactionStates.map((gate) => ({
          id: gate.id,
          type: gate.kind,
          phase: gate.phase,
          outcome: gate.outcome,
          cooldownRemaining: gate.cooldownRemaining,
          activationCount: gate.activationCount,
          failureCount: gate.failureCount,
        })),
      },
      save: { schemaVersion: SAVE_SCHEMA_VERSION, available: this.saveAvailable },
      events: { sequence: this.eventSequence, last: this.lastEvent },
      collisions: { frame: this.collisionFrame.count, total: this.collisionTotal, strongest: this.collisionFrame.strongest },
      gameplay: {
        paused: this.paused,
        muted: this.audio.isMuted(),
        physics: { engine: 'custom-transform-arcade', timestep: 'variable-clamped-0.05s', boatColliders: this.activeBoats.length, checkpointSensors: this.track.checkpoints.length, ccdBodies: 0 },
        ai: this.aiRacers.filter((racer) => this.activeBoats.includes(racer)).map((racer) => ({ id: racer.id, personality: racer.personality, avoidanceStrength: racer.avoidanceStrength })),
      },
      input: this.input.snapshot(),
      renderer: { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures },
      ocean: this.ocean.diagnostics,
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: Math.min(window.devicePixelRatio || 1, this.tuning.maxDpr),
      },
    };
  }

  private recordEvent(type: string, entityId?: string, outcome?: string): void {
    this.eventSequence += 1;
    this.lastEvent = { type, entityId, outcome };
  }

  private makeBoatModel(id: string, color: THREE.ColorRepresentation, number: number, profile: BoatProfile): BoatModel {
    const model = createBoatModel({ color, number, profile, materials: this.materials });
    this.boatModels.set(id, model);
    return model;
  }

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }
}
