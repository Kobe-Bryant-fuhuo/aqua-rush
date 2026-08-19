export type RaceHudState = {
  /** World speed; defaults to converting units/s to km/h with speedScale=3.6. */
  speed: number;
  speedScale?: number;
  maxDisplaySpeed?: number;
  lap: number;
  totalLaps: number;
  position: number;
  totalRacers: number;
  elapsed: number;
  /** Normalized 0..1. */
  boost: number;
  status?: string;
};

export type RaceResult = {
  position: number;
  totalRacers: number;
  elapsed: number;
  title?: string;
};

export type HudTone = 'info' | 'boost' | 'warning' | 'success';

function formatTime(seconds: number, milliseconds = true): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60).toString().padStart(2, '0');
  const wholeSeconds = Math.floor(safe % 60).toString().padStart(2, '0');
  if (!milliseconds) return `${minutes}:${wholeSeconds}`;
  const millis = Math.floor((safe % 1) * 1000).toString().padStart(3, '0');
  return `${minutes}:${wholeSeconds}.${millis}`;
}

function ordinal(position: number): string {
  const safe = Math.max(1, Math.round(position));
  const modulo100 = safe % 100;
  const suffix = modulo100 >= 11 && modulo100 <= 13
    ? 'TH'
    : safe % 10 === 1
      ? 'ST'
      : safe % 10 === 2
        ? 'ND'
        : safe % 10 === 3
          ? 'RD'
          : 'TH';
  return `${safe}${suffix}`;
}

export class Hud {
  private readonly root = this.getElement('#hud');
  private readonly speedValue = this.getElement('#speed-value');
  private readonly speedFill = this.getElement('#speed-fill');
  private readonly lapValue = this.getElement('#lap-value');
  private readonly positionValue = this.getElement('#position-value');
  private readonly positionTotal = this.getElement('#position-total');
  private readonly timerValue = this.getElement('#timer-value');
  private readonly boostFill = this.getElement('#boost-fill');
  private readonly boostLabel = this.getElement('#boost-label');
  private readonly statusLine = this.getElement('#status-line');
  private readonly countdownOverlay = this.getElement('#countdown-overlay');
  private readonly countdownValue = this.getElement('#countdown-value');
  private readonly countdownKicker = this.getElement('#countdown-kicker');
  private readonly resultsOverlay = this.getElement('#results-overlay');
  private readonly resultsTitle = this.getElement('#results-title');
  private readonly resultPosition = this.getElement('#result-position');
  private readonly resultField = this.getElement('#result-field');
  private readonly resultTime = this.getElement('#result-time');
  private readonly restartButton = this.getElement<HTMLButtonElement>('#restart-button');

  private restartHandler: (() => void) | null = null;
  private lastPosition = 1;
  private lastLap = 1;

  constructor() {
    this.restartButton.addEventListener('click', this.handleRestart);
    window.addEventListener('keydown', this.handleResultKey);
  }

  updateRace(state: RaceHudState): void {
    const speedScale = state.speedScale ?? 3.6;
    const speedKph = Math.max(0, Math.round(state.speed * speedScale));
    const maxSpeed = Math.max(1, state.maxDisplaySpeed ?? 120);
    const boost = Math.max(0, Math.min(1, state.boost));
    const lap = Math.max(1, Math.min(state.totalLaps, Math.round(state.lap)));
    const position = Math.max(1, Math.min(state.totalRacers, Math.round(state.position)));

    this.speedValue.textContent = Math.min(speedKph, 999).toString().padStart(3, '0');
    this.speedFill.style.setProperty('--speed', String(Math.min(speedKph / maxSpeed, 1)));
    this.lapValue.textContent = `${lap} / ${Math.max(1, Math.round(state.totalLaps))}`;
    this.positionValue.textContent = ordinal(position);
    this.positionTotal.textContent = `/ ${Math.max(1, Math.round(state.totalRacers))}`;
    this.timerValue.textContent = formatTime(state.elapsed);
    this.boostFill.style.setProperty('--boost', String(boost));
    this.boostLabel.textContent = boost > 0.22 ? `${Math.round(boost * 100)}%` : 'Charge';
    this.root.classList.toggle('is-boosting', boost > 0.82);

    if (position !== this.lastPosition) {
      this.positionValue.animate(
        [{ transform: 'translateY(6px)', opacity: 0.3 }, { transform: 'translateY(0)', opacity: 1 }],
        { duration: 220, easing: 'cubic-bezier(.2,.9,.2,1)' },
      );
      this.lastPosition = position;
    }
    if (lap !== this.lastLap) {
      this.announce(`Lap ${lap} of ${state.totalLaps}`, 'success');
      this.lastLap = lap;
    } else if (state.status) {
      this.statusLine.textContent = state.status;
    }
  }

  setCountdown(value: number | 'GO' | null): void {
    if (value === null) {
      this.countdownOverlay.hidden = true;
      this.countdownOverlay.classList.remove('is-go');
      return;
    }
    const isGo = value === 'GO' || value <= 0;
    this.countdownOverlay.hidden = false;
    this.countdownOverlay.classList.toggle('is-go', isGo);
    this.countdownKicker.textContent = isGo ? 'Full throttle' : 'Get ready';
    this.countdownValue.textContent = isGo ? 'GO!' : String(Math.max(1, Math.ceil(value)));
    this.countdownValue.animate(
      [{ transform: 'scale(1.45)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
      { duration: 280, easing: 'cubic-bezier(.16,1,.3,1)' },
    );
  }

  showResults(result: RaceResult): void {
    this.resultsTitle.textContent = result.title ?? (result.position === 1 ? 'VICTORY!' : 'FINISH!');
    this.resultPosition.textContent = ordinal(result.position);
    this.resultField.textContent = `OF ${Math.max(1, result.totalRacers)} RACERS`;
    this.resultTime.textContent = formatTime(result.elapsed);
    this.resultsOverlay.hidden = false;
    this.root.classList.add('is-finished');
    requestAnimationFrame(() => this.restartButton.focus({ preventScroll: true }));
  }

  hideResults(): void {
    this.resultsOverlay.hidden = true;
    this.root.classList.remove('is-finished');
  }

  onRestart(handler: (() => void) | null): void {
    this.restartHandler = handler;
  }

  announce(message: string, tone: HudTone = 'info'): void {
    this.statusLine.textContent = message;
    this.statusLine.dataset.tone = tone;
    this.statusLine.animate(
      [{ transform: 'translate(-50%, -8px)', opacity: 0 }, { transform: 'translate(-50%, 0)', opacity: 1 }],
      { duration: 240, easing: 'ease-out' },
    );
  }

  dispose(): void {
    this.restartButton.removeEventListener('click', this.handleRestart);
    window.removeEventListener('keydown', this.handleResultKey);
    this.restartHandler = null;
  }

  private readonly handleRestart = () => {
    this.restartHandler?.();
  };

  private readonly handleResultKey = (event: KeyboardEvent) => {
    if (this.resultsOverlay.hidden || (event.code !== 'Enter' && event.code !== 'Space')) return;
    event.preventDefault();
    this.restartHandler?.();
  };

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing HUD element: ${selector}`);
    return element;
  }
}

export { formatTime as formatRaceTime, ordinal as formatRacePosition };
