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
  /** Normalized -1..1 steering intent for the compact turn indicator. */
  steering?: number;
  drifting?: boolean;
  /** Normalized 0..1 drift reward charge. */
  driftCharge?: number;
  status?: string;
};

export type RaceResult = {
  position: number;
  totalRacers: number;
  elapsed: number;
  title?: string;
};

export type HudRaceMode = 'quick-race' | 'time-trial';
export type HudTrackId = 'sunset-circuit' | 'storm-reef';
export type HudFlowState =
  | 'loading'
  | 'title'
  | 'mode-select'
  | 'track-select'
  | 'countdown'
  | 'racing'
  | 'paused'
  | 'results'
  | 'hidden';

export type HudCourseCard = {
  id: HudTrackId;
  name?: string;
  displayName?: string;
  description?: string;
  difficulty?: string;
  environmentLabel?: string;
  bestTotal?: number | null;
};

export type HudCourseSelectView = {
  mode: HudRaceMode;
  selectedTrack?: HudTrackId;
  courses?: readonly HudCourseCard[];
};

export type TimeTrialHudState = {
  currentLap: number;
  bestLap?: number | null;
  bestTotal?: number | null;
  /** Seconds relative to the best lap; negative is ahead. */
  comparisonToBest?: number | null;
};

export type V3RaceResult = {
  mode: HudRaceMode;
  courseName?: string;
  totalTime: number;
  bestLap?: number | null;
  previousBestTotal?: number | null;
  position?: number;
  totalRacers?: number;
  newLapRecord?: boolean;
  newTotalRecord?: boolean;
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

function formatOptionalTime(seconds?: number | null): string {
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
    ? formatTime(seconds)
    : '--:--.---';
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

function modeLabel(mode: HudRaceMode): string {
  return mode === 'time-trial' ? 'Time Trial' : 'Quick Race';
}

export class Hud {
  private readonly root = this.getElement('#hud');
  private readonly touchControls = this.getElement('#touch-controls');
  private readonly speedValue = this.getElement('#speed-value');
  private readonly speedFill = this.getElement('#speed-fill');
  private readonly lapValue = this.getElement('#lap-value');
  private readonly positionValue = this.getElement('#position-value');
  private readonly positionTotal = this.getElement('#position-total');
  private readonly timerLabel = this.getElement('#timer-label');
  private readonly timerValue = this.getElement('#timer-value');
  private readonly boostFill = this.getElement('#boost-fill');
  private readonly boostLabel = this.getElement('#boost-label');
  private readonly statusLine = this.getElement('#status-line');
  private readonly countdownOverlay = this.getElement('#countdown-overlay');
  private readonly countdownValue = this.getElement('#countdown-value');
  private readonly countdownKicker = this.getElement('#countdown-kicker');
  private readonly resultsOverlay = this.getElement('#results-overlay');
  private readonly resultsTitle = this.getElement('#results-title');
  private readonly resultsKicker = this.getElement('#results-kicker');
  private readonly quickRaceResults = this.getElement('#quick-race-results');
  private readonly timeTrialResults = this.getElement('#time-trial-results');
  private readonly resultPosition = this.getElement('#result-position');
  private readonly resultField = this.getElement('#result-field');
  private readonly resultTimeLabel = this.getElement('#result-time-label');
  private readonly resultTime = this.getElement('#result-time');
  private readonly resultQuickBestLap = this.getElement('#result-quick-best-lap');
  private readonly resultBestLap = this.getElement('#result-best-lap');
  private readonly resultPreviousRecord = this.getElement('#result-previous-record');
  private readonly resultRecordBanner = this.getElement('#result-record-banner');
  private readonly restartButton = this.getElement<HTMLButtonElement>('#restart-button');
  private readonly otherCourseButton = this.getElement<HTMLButtonElement>('#results-other-course-button');
  private readonly resultsMenuButton = this.getElement<HTMLButtonElement>('#results-menu-button');
  private readonly pauseButton = this.getElement<HTMLButtonElement>('#pause-button');
  private readonly muteButton = this.getElement<HTMLButtonElement>('#mute-button');
  private readonly muteIcon = this.getElement('#mute-icon');
  private readonly pauseOverlay = this.getElement('#pause-overlay');
  private readonly resumeButton = this.getElement<HTMLButtonElement>('#resume-button');
  private readonly pauseRestartButton = this.getElement<HTMLButtonElement>('#pause-restart-button');
  private readonly recoveryButton = this.getElement<HTMLButtonElement>('#pause-recovery-button');
  private readonly pauseMenuButton = this.getElement<HTMLButtonElement>('#pause-menu-button');
  private readonly reducedMotionButton = this.getElement<HTMLButtonElement>('#reduced-motion-button');
  private readonly resetRecordsButton = this.getElement<HTMLButtonElement>('#reset-records-button');
  private readonly turnFeedback = this.getElement('#turn-feedback');
  private readonly turnFeedbackLabel = this.getElement('#turn-feedback-label');
  private readonly driftChargeFill = this.getElement('#drift-charge-fill');
  private readonly timeTrialCluster = this.getElement('#time-trial-cluster');
  private readonly timeTrialCurrentLap = this.getElement('#time-trial-current-lap');
  private readonly timeTrialBestLap = this.getElement('#time-trial-best-lap');
  private readonly timeTrialDelta = this.getElement('#time-trial-delta');

  private readonly flowOverlay = this.getElement('#flow-overlay');
  private readonly titleScreen = this.getElement('#title-screen');
  private readonly modeSelectScreen = this.getElement('#mode-select-screen');
  private readonly courseSelectScreen = this.getElement('#course-select-screen');
  private readonly titleStartButton = this.getElement<HTMLButtonElement>('#title-start-button');
  private readonly quickRaceButton = this.getElement<HTMLButtonElement>('#mode-quick-race-button');
  private readonly timeTrialButton = this.getElement<HTMLButtonElement>('#mode-time-trial-button');
  private readonly modeBackButton = this.getElement<HTMLButtonElement>('#mode-back-button');
  private readonly courseBackButton = this.getElement<HTMLButtonElement>('#course-back-button');
  private readonly courseModeLabel = this.getElement('#course-mode-label');
  private readonly sunsetCourseButton = this.getElement<HTMLButtonElement>('#course-sunset-circuit-button');
  private readonly stormCourseButton = this.getElement<HTMLButtonElement>('#course-storm-reef-button');

  private restartHandler: (() => void) | null = null;
  private pauseHandler: (() => void) | null = null;
  private muteHandler: (() => void) | null = null;
  private startHandler: (() => void) | null = null;
  private modeSelectHandler: ((mode: HudRaceMode) => void) | null = null;
  private courseSelectHandler: ((trackId: HudTrackId) => void) | null = null;
  private backHandler: ((from: 'mode-select' | 'track-select') => void) | null = null;
  private recoveryHandler: (() => void) | null = null;
  private menuHandler: (() => void) | null = null;
  private reducedMotionHandler: ((enabled: boolean) => void) | null = null;
  private resetRecordsHandler: (() => void) | null = null;
  private otherCourseHandler: (() => void) | null = null;
  private currentFlow: HudFlowState = 'hidden';
  private reducedMotion = false;
  private announcementUntil = 0;
  private resetRecordsArmed = false;
  private resetRecordsTimer: number | null = null;
  private lastPosition = 1;
  private lastLap = 1;

  constructor() {
    this.restartButton.addEventListener('click', this.handleRestart);
    this.pauseRestartButton.addEventListener('click', this.handleRestart);
    this.pauseButton.addEventListener('click', this.handlePause);
    this.resumeButton.addEventListener('click', this.handlePause);
    this.muteButton.addEventListener('click', this.handleMute);
    this.titleStartButton.addEventListener('click', this.handleStart);
    this.quickRaceButton.addEventListener('click', this.handleQuickRace);
    this.timeTrialButton.addEventListener('click', this.handleTimeTrial);
    this.modeBackButton.addEventListener('click', this.handleModeBack);
    this.courseBackButton.addEventListener('click', this.handleCourseBack);
    this.sunsetCourseButton.addEventListener('click', this.handleSunsetCourse);
    this.stormCourseButton.addEventListener('click', this.handleStormCourse);
    this.recoveryButton.addEventListener('click', this.handleRecovery);
    this.pauseMenuButton.addEventListener('click', this.handleMenu);
    this.resultsMenuButton.addEventListener('click', this.handleMenu);
    this.reducedMotionButton.addEventListener('click', this.handleReducedMotion);
    this.resetRecordsButton.addEventListener('click', this.handleResetRecords);
    this.otherCourseButton.addEventListener('click', this.handleOtherCourse);
    window.addEventListener('keydown', this.handleModalKey, true);
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
    const steering = Math.max(-1, Math.min(1, state.steering ?? 0));
    const driftCharge = Math.max(0, Math.min(1, state.driftCharge ?? 0));
    this.turnFeedback.style.setProperty('--steer', String(steering));
    this.driftChargeFill.style.setProperty('--drift-charge', String(driftCharge));
    this.turnFeedback.classList.toggle('is-turning-left', steering < -0.12);
    this.turnFeedback.classList.toggle('is-turning-right', steering > 0.12);
    this.turnFeedback.classList.toggle('is-drifting', Boolean(state.drifting));
    this.turnFeedbackLabel.textContent = state.drifting
      ? driftCharge > 0.82 ? 'RELEASE!' : 'DRIFT'
      : boost < 0.2 ? 'RECHARGE' : 'GRIP';

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
    } else if (state.status && performance.now() >= this.announcementUntil) {
      this.statusLine.textContent = state.status;
      this.statusLine.dataset.tone = 'info';
    }
  }

  updateTimeTrial(state: TimeTrialHudState | null): void {
    const active = state !== null;
    this.root.classList.toggle('is-time-trial', active);
    this.timeTrialCluster.hidden = !active;
    this.timerLabel.textContent = active ? 'Session total' : 'Race time';
    if (!state) return;

    this.timeTrialCurrentLap.textContent = formatTime(state.currentLap);
    this.timeTrialBestLap.textContent = formatOptionalTime(state.bestLap);
    const delta = state.comparisonToBest;
    if (typeof delta !== 'number' || !Number.isFinite(delta)) {
      this.timeTrialDelta.textContent = '± --.---';
      this.timeTrialDelta.dataset.tone = 'neutral';
    } else {
      const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
      this.timeTrialDelta.textContent = `${sign}${Math.abs(delta).toFixed(3)}`;
      this.timeTrialDelta.dataset.tone = delta < 0 ? 'ahead' : delta > 0 ? 'behind' : 'neutral';
    }
    this.timeTrialCluster.dataset.bestTotal = formatOptionalTime(state.bestTotal);
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

  showFlow(state: HudFlowState): void {
    this.currentFlow = state;
    const visible = state === 'loading' || state === 'title' || state === 'mode-select' || state === 'track-select';
    if (state !== 'results') {
      this.resultsOverlay.hidden = true;
      this.root.classList.remove('is-finished');
    }
    if (state !== 'paused') this.pauseOverlay.hidden = true;
    if (visible) this.countdownOverlay.hidden = true;
    this.flowOverlay.hidden = !visible;
    this.titleScreen.hidden = state !== 'loading' && state !== 'title';
    this.modeSelectScreen.hidden = state !== 'mode-select';
    this.courseSelectScreen.hidden = state !== 'track-select';
    this.root.hidden = visible;
    this.touchControls.classList.toggle('is-menu-hidden', visible);
    document.body.dataset.uiState = state;

    this.titleStartButton.disabled = state === 'loading';
    this.titleStartButton.textContent = state === 'loading' ? 'Loading…' : 'Start racing';
    if (!visible) return;
    const focusTarget = state === 'title'
      ? this.titleStartButton
      : state === 'mode-select'
        ? this.quickRaceButton
        : state === 'track-select'
          ? this.getSelectedCourseButton()
          : null;
    if (focusTarget) requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
  }

  showCourseSelect(view: HudCourseSelectView = { mode: 'quick-race' }): void {
    this.courseModeLabel.textContent = modeLabel(view.mode);
    for (const course of view.courses ?? []) this.updateCourseCard(course);
    this.selectCourseCard(view.selectedTrack ?? 'sunset-circuit');
    this.showFlow('track-select');
  }

  showResults(result: RaceResult): void {
    this.showResultsV3({
      mode: 'quick-race',
      position: result.position,
      totalRacers: result.totalRacers,
      totalTime: result.elapsed,
      title: result.title,
    });
  }

  showResultsV3(result: V3RaceResult): void {
    const timeTrial = result.mode === 'time-trial';
    this.showFlow('results');
    this.resultsKicker.textContent = result.courseName
      ? `${modeLabel(result.mode)} · ${result.courseName}`
      : timeTrial ? 'Time Trial complete' : 'Race complete';
    this.resultsTitle.textContent = result.title
      ?? (timeTrial && (result.newLapRecord || result.newTotalRecord)
        ? 'NEW RECORD!'
        : !timeTrial && (result.position ?? 4) === 1 ? 'VICTORY!' : 'FINISH!');
    this.quickRaceResults.hidden = timeTrial;
    this.timeTrialResults.hidden = !timeTrial;
    this.resultTimeLabel.textContent = timeTrial ? 'Session total' : 'Final time';
    this.resultTime.textContent = formatTime(result.totalTime);
    this.resultQuickBestLap.textContent = formatOptionalTime(result.bestLap);

    if (timeTrial) {
      this.resultBestLap.textContent = formatOptionalTime(result.bestLap);
      this.resultPreviousRecord.textContent = formatOptionalTime(result.previousBestTotal);
      const newRecord = Boolean(result.newLapRecord || result.newTotalRecord);
      this.resultRecordBanner.hidden = !newRecord;
      this.resultRecordBanner.textContent = result.newTotalRecord
        ? 'New total-time record!'
        : 'New best lap!';
    } else {
      const position = Math.max(1, result.position ?? 1);
      const totalRacers = Math.max(1, result.totalRacers ?? 4);
      this.resultPosition.textContent = ordinal(position);
      this.resultField.textContent = `OF ${totalRacers} RACERS`;
      this.resultRecordBanner.hidden = true;
    }

    this.resultsOverlay.hidden = false;
    this.root.classList.add('is-finished');
    requestAnimationFrame(() => this.restartButton.focus({ preventScroll: true }));
  }

  hideResults(): void {
    this.resultsOverlay.hidden = true;
    this.root.classList.remove('is-finished');
  }

  onRestart(handler: (() => void) | null): void { this.restartHandler = handler; }
  onPause(handler: (() => void) | null): void { this.pauseHandler = handler; }
  onMute(handler: (() => void) | null): void { this.muteHandler = handler; }
  onStart(handler: (() => void) | null): void { this.startHandler = handler; }
  onModeSelect(handler: ((mode: HudRaceMode) => void) | null): void { this.modeSelectHandler = handler; }
  onCourseSelect(handler: ((trackId: HudTrackId) => void) | null): void { this.courseSelectHandler = handler; }
  onBack(handler: ((from: 'mode-select' | 'track-select') => void) | null): void { this.backHandler = handler; }
  onRecovery(handler: (() => void) | null): void { this.recoveryHandler = handler; }
  onMenu(handler: (() => void) | null): void { this.menuHandler = handler; }
  onReducedMotion(handler: ((enabled: boolean) => void) | null): void { this.reducedMotionHandler = handler; }
  onResetRecords(handler: (() => void) | null): void { this.resetRecordsHandler = handler; }
  onOtherCourse(handler: (() => void) | null): void { this.otherCourseHandler = handler; }

  setPaused(paused: boolean): void {
    const wasPaused = !this.pauseOverlay.hidden;
    this.pauseOverlay.hidden = !paused;
    this.pauseButton.setAttribute('aria-pressed', String(paused));
    this.pauseButton.setAttribute('aria-label', paused ? 'Resume race' : 'Pause race');
    this.pauseButton.querySelector('span')!.textContent = paused ? '▶' : 'Ⅱ';
    if (paused) requestAnimationFrame(() => this.resumeButton.focus({ preventScroll: true }));
    else if (wasPaused && this.pauseOverlay.contains(document.activeElement)) this.pauseButton.focus({ preventScroll: true });
  }

  setMuted(muted: boolean): void {
    this.muteButton.setAttribute('aria-pressed', String(muted));
    this.muteButton.setAttribute('aria-label', muted ? 'Unmute audio' : 'Mute audio');
    this.muteIcon.textContent = muted ? '×' : '♪';
    this.muteButton.classList.toggle('is-muted', muted);
  }

  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
    this.reducedMotionButton.setAttribute('aria-pressed', String(enabled));
    this.reducedMotionButton.querySelector('b')!.textContent = enabled ? 'On' : 'Off';
    document.body.classList.toggle('is-reduced-motion', enabled);
  }

  announce(message: string, tone: HudTone = 'info'): void {
    this.announcementUntil = performance.now() + 1_300;
    this.statusLine.textContent = message;
    this.statusLine.dataset.tone = tone;
    this.statusLine.animate(
      [{ transform: 'translate(-50%, -8px)', opacity: 0 }, { transform: 'translate(-50%, 0)', opacity: 1 }],
      { duration: 240, easing: 'ease-out' },
    );
  }

  dispose(): void {
    this.restartButton.removeEventListener('click', this.handleRestart);
    this.pauseRestartButton.removeEventListener('click', this.handleRestart);
    this.pauseButton.removeEventListener('click', this.handlePause);
    this.resumeButton.removeEventListener('click', this.handlePause);
    this.muteButton.removeEventListener('click', this.handleMute);
    this.titleStartButton.removeEventListener('click', this.handleStart);
    this.quickRaceButton.removeEventListener('click', this.handleQuickRace);
    this.timeTrialButton.removeEventListener('click', this.handleTimeTrial);
    this.modeBackButton.removeEventListener('click', this.handleModeBack);
    this.courseBackButton.removeEventListener('click', this.handleCourseBack);
    this.sunsetCourseButton.removeEventListener('click', this.handleSunsetCourse);
    this.stormCourseButton.removeEventListener('click', this.handleStormCourse);
    this.recoveryButton.removeEventListener('click', this.handleRecovery);
    this.pauseMenuButton.removeEventListener('click', this.handleMenu);
    this.resultsMenuButton.removeEventListener('click', this.handleMenu);
    this.reducedMotionButton.removeEventListener('click', this.handleReducedMotion);
    this.resetRecordsButton.removeEventListener('click', this.handleResetRecords);
    this.otherCourseButton.removeEventListener('click', this.handleOtherCourse);
    window.removeEventListener('keydown', this.handleModalKey, true);
    if (this.resetRecordsTimer !== null) window.clearTimeout(this.resetRecordsTimer);
    this.restartHandler = null;
    this.pauseHandler = null;
    this.muteHandler = null;
    this.startHandler = null;
    this.modeSelectHandler = null;
    this.courseSelectHandler = null;
    this.backHandler = null;
    this.recoveryHandler = null;
    this.menuHandler = null;
    this.reducedMotionHandler = null;
    this.resetRecordsHandler = null;
    this.otherCourseHandler = null;
  }

  private updateCourseCard(course: HudCourseCard): void {
    const prefix = course.id === 'sunset-circuit' ? 'sunset' : 'storm';
    const button = course.id === 'sunset-circuit' ? this.sunsetCourseButton : this.stormCourseButton;
    const name = course.displayName ?? course.name;
    if (name) this.getElement(`#course-${prefix}-name`).textContent = name;
    if (course.description) this.getElement(`#course-${prefix}-description`).textContent = course.description;
    const meta = button.querySelector<HTMLElement>('.course-meta');
    const difficulty = meta?.querySelector<HTMLElement>('em');
    const environment = meta?.querySelector<HTMLElement>('i');
    if (difficulty && course.difficulty) difficulty.textContent = course.difficulty;
    if (environment && course.environmentLabel) environment.textContent = course.environmentLabel;
    this.getElement(`#course-${prefix}-record`).textContent = formatOptionalTime(course.bestTotal);
  }

  private selectCourseCard(trackId: HudTrackId): void {
    for (const button of [this.sunsetCourseButton, this.stormCourseButton]) {
      const selected = button.dataset.track === trackId;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  }

  private getSelectedCourseButton(): HTMLButtonElement {
    return this.stormCourseButton.getAttribute('aria-pressed') === 'true'
      ? this.stormCourseButton
      : this.sunsetCourseButton;
  }

  private visibleModal(): HTMLElement | null {
    if (!this.flowOverlay.hidden) {
      return [this.titleScreen, this.modeSelectScreen, this.courseSelectScreen]
        .find((screen) => !screen.hidden) ?? null;
    }
    if (!this.pauseOverlay.hidden) return this.pauseOverlay;
    if (!this.resultsOverlay.hidden) return this.resultsOverlay;
    return null;
  }

  private trapFocus(event: KeyboardEvent, modal: HTMLElement): void {
    const focusable = [...modal.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private readonly handleRestart = () => { this.restartHandler?.(); };
  private readonly handlePause = () => { this.pauseHandler?.(); };
  private readonly handleMute = () => { this.muteHandler?.(); };
  private readonly handleStart = () => { this.startHandler?.(); };
  private readonly handleQuickRace = () => { this.modeSelectHandler?.('quick-race'); };
  private readonly handleTimeTrial = () => { this.modeSelectHandler?.('time-trial'); };
  private readonly handleModeBack = () => { this.backHandler?.('mode-select'); };
  private readonly handleCourseBack = () => { this.backHandler?.('track-select'); };
  private readonly handleSunsetCourse = () => {
    this.selectCourseCard('sunset-circuit');
    this.courseSelectHandler?.('sunset-circuit');
  };
  private readonly handleStormCourse = () => {
    this.selectCourseCard('storm-reef');
    this.courseSelectHandler?.('storm-reef');
  };
  private readonly handleRecovery = () => { this.recoveryHandler?.(); };
  private readonly handleMenu = () => { this.menuHandler?.(); };
  private readonly handleOtherCourse = () => { this.otherCourseHandler?.(); };
  private readonly handleReducedMotion = () => {
    this.setReducedMotion(!this.reducedMotion);
    this.reducedMotionHandler?.(this.reducedMotion);
  };
  private readonly handleResetRecords = () => {
    if (!this.resetRecordsArmed) {
      this.resetRecordsArmed = true;
      this.resetRecordsButton.textContent = 'Press again to confirm';
      this.resetRecordsButton.dataset.confirm = 'true';
      if (this.resetRecordsTimer !== null) window.clearTimeout(this.resetRecordsTimer);
      this.resetRecordsTimer = window.setTimeout(() => this.disarmResetRecords(), 4_000);
      return;
    }
    this.resetRecordsHandler?.();
    this.disarmResetRecords();
    this.announce('Time Trial records reset', 'info');
  };
  private readonly handleModalKey = (event: KeyboardEvent) => {
    const modal = this.visibleModal();
    if (!modal) return;
    if (event.code === 'Tab') this.trapFocus(event, modal);

    if (!this.flowOverlay.hidden) {
      event.stopImmediatePropagation();
      if (event.code !== 'Escape') return;
      event.preventDefault();
      if (this.currentFlow === 'track-select') this.backHandler?.('track-select');
      else if (this.currentFlow === 'mode-select') this.backHandler?.('mode-select');
      return;
    }

    if (!this.resultsOverlay.hidden) {
      event.stopImmediatePropagation();
      const activeIsButton = document.activeElement instanceof HTMLButtonElement;
      if ((event.code === 'Enter' || event.code === 'Space') && !activeIsButton) {
        event.preventDefault();
        this.restartHandler?.();
      } else if (event.code === 'Escape') {
        event.preventDefault();
        this.menuHandler?.();
      }
      return;
    }

    if (!this.pauseOverlay.hidden && (event.code === 'Escape' || event.code === 'KeyP')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.pauseHandler?.();
    }
  };

  private disarmResetRecords(): void {
    this.resetRecordsArmed = false;
    this.resetRecordsButton.textContent = 'Reset time records';
    delete this.resetRecordsButton.dataset.confirm;
    if (this.resetRecordsTimer !== null) window.clearTimeout(this.resetRecordsTimer);
    this.resetRecordsTimer = null;
  }

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing HUD element: ${selector}`);
    return element;
  }
}

export { formatTime as formatRaceTime, ordinal as formatRacePosition };
