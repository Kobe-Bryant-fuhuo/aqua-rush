import * as THREE from 'three';

export type RaceIntent = {
  throttle: number;
  steer: number;
  boost: boolean;
};

type PointerState = {
  active: boolean;
  id: number | null;
  centerX: number;
  centerY: number;
  radius: number;
};

/** Collects keyboard/touch state and exposes game-facing intents. */
export class InputController {
  private readonly keys = new Set<string>();
  private readonly pointer = new THREE.Vector2();
  private readonly movement = new THREE.Vector2();
  private readonly pointerState: PointerState = {
    active: false,
    id: null,
    centerX: 0,
    centerY: 0,
    radius: 1,
  };

  private boostDown = false;
  private restartQueued = false;
  private pauseQueued = false;
  private recoveryQueued = false;
  private raceInputEnabled = true;

  private readonly onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (this.raceInputEnabled && !event.repeat && (event.code === 'KeyP' || event.code === 'Escape')) {
      this.pauseQueued = true;
    }
    if (target?.closest('button, a, input, select, textarea') || !this.raceInputEnabled) return;
    if (
      event.code === 'Space' ||
      event.code.startsWith('Arrow') ||
      event.code === 'KeyW' ||
      event.code === 'KeyA' ||
      event.code === 'KeyS' ||
      event.code === 'KeyD'
    ) {
      event.preventDefault();
    }
    this.keys.add(event.code);
    if (event.code === 'Space') this.boostDown = true;
    if (!event.repeat && (event.code === 'KeyR' || event.code === 'Enter')) {
      this.restartQueued = true;
    }
    if (!event.repeat && event.code === 'KeyX') this.recoveryQueued = true;
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
    if (event.code === 'Space') this.boostDown = false;
  };

  private readonly onBlur = () => {
    this.keys.clear();
    this.boostDown = false;
    this.pointerState.active = false;
    this.pointerState.id = null;
    this.pointer.set(0, 0);
    this.updateKnob();
  };

  private readonly onStickDown = (event: PointerEvent) => {
    event.preventDefault();
    const rect = this.stick.getBoundingClientRect();
    this.pointerState.active = true;
    this.pointerState.id = event.pointerId;
    this.pointerState.centerX = rect.left + rect.width / 2;
    this.pointerState.centerY = rect.top + rect.height / 2;
    this.pointerState.radius = Math.max(1, rect.width * 0.42);
    try {
      this.stick.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic browser tests do not always provide a capturable pointer id.
    }
    this.updatePointer(event.clientX, event.clientY);
  };

  private readonly onStickMove = (event: PointerEvent) => {
    if (!this.pointerState.active || event.pointerId !== this.pointerState.id) return;
    event.preventDefault();
    this.updatePointer(event.clientX, event.clientY);
  };

  private readonly onStickUp = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerState.id) return;
    event.preventDefault();
    this.pointerState.active = false;
    this.pointerState.id = null;
    this.pointer.set(0, 0);
    this.updateKnob();
  };

  private readonly onBoostDown = (event: PointerEvent) => {
    event.preventDefault();
    this.boostDown = true;
  };

  private readonly onBoostUp = (event: PointerEvent) => {
    event.preventDefault();
    this.boostDown = false;
  };

  constructor(
    private readonly stick: HTMLElement,
    private readonly knob: HTMLElement,
    private readonly boostButton: HTMLElement,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.stick.addEventListener('pointerdown', this.onStickDown);
    this.stick.addEventListener('pointermove', this.onStickMove);
    this.stick.addEventListener('pointerup', this.onStickUp);
    this.stick.addEventListener('pointercancel', this.onStickUp);
    this.boostButton.addEventListener('pointerdown', this.onBoostDown);
    this.boostButton.addEventListener('pointerup', this.onBoostUp);
    this.boostButton.addEventListener('pointercancel', this.onBoostUp);
    this.boostButton.addEventListener('pointerleave', this.onBoostUp);
  }

  readRaceIntent(target: RaceIntent): RaceIntent {
    let throttle = 0;
    let steer = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) throttle += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) throttle -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) steer -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) steer += 1;

    target.throttle = THREE.MathUtils.clamp(throttle - this.pointer.y, -1, 1);
    target.steer = THREE.MathUtils.clamp(steer + this.pointer.x, -1, 1);
    target.boost = this.boostDown;
    return target;
  }

  /** Kept for simple smoke tests and diagnostic tools that expect a 2D vector. */
  readMovement(target: THREE.Vector2): THREE.Vector2 {
    this.movement.set(0, 0);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.movement.x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.movement.x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.movement.y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.movement.y += 1;
    target.copy(this.movement).add(this.pointer);
    if (target.lengthSq() > 1) target.normalize();
    return target;
  }

  isBoostHeld(): boolean {
    return this.boostDown;
  }

  consumeRestart(): boolean {
    const queued = this.restartQueued;
    this.restartQueued = false;
    return queued;
  }

  consumePause(): boolean {
    const queued = this.pauseQueued;
    this.pauseQueued = false;
    return queued;
  }

  consumeRecovery(): boolean {
    const queued = this.recoveryQueued;
    this.recoveryQueued = false;
    return queued;
  }

  setRaceInputEnabled(enabled: boolean): void {
    this.raceInputEnabled = enabled;
    if (!enabled) {
      this.keys.clear();
      this.boostDown = false;
      this.pointer.set(0, 0);
      this.updateKnob();
    }
  }

  snapshot(): RaceIntent {
    return this.readRaceIntent({ throttle: 0, steer: 0, boost: false });
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.stick.removeEventListener('pointerdown', this.onStickDown);
    this.stick.removeEventListener('pointermove', this.onStickMove);
    this.stick.removeEventListener('pointerup', this.onStickUp);
    this.stick.removeEventListener('pointercancel', this.onStickUp);
    this.boostButton.removeEventListener('pointerdown', this.onBoostDown);
    this.boostButton.removeEventListener('pointerup', this.onBoostUp);
    this.boostButton.removeEventListener('pointercancel', this.onBoostUp);
    this.boostButton.removeEventListener('pointerleave', this.onBoostUp);
  }

  private updatePointer(clientX: number, clientY: number): void {
    const dx = clientX - this.pointerState.centerX;
    const dy = clientY - this.pointerState.centerY;
    this.pointer.set(dx / this.pointerState.radius, dy / this.pointerState.radius);
    if (this.pointer.lengthSq() > 1) this.pointer.normalize();
    this.updateKnob();
  }

  private updateKnob(): void {
    const distance = 38;
    this.knob.style.transform = `translate(calc(-50% + ${this.pointer.x * distance}px), calc(-50% + ${this.pointer.y * distance}px))`;
  }
}
