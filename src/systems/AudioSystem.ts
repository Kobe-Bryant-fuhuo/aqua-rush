type WebkitWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

/**
 * Small fault-tolerant Web Audio synth. The game has no downloaded audio files,
 * so every cue works offline and carries no third-party licence requirement.
 */
export class AudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineOscillator: OscillatorNode | null = null;
  private engineHarmonic: OscillatorNode | null = null;
  private ambienceGain: GainNode | null = null;
  private ambienceSource: AudioBufferSourceNode | null = null;
  private unlocked = false;
  private muted = false;

  private readonly requestUnlock = () => {
    void this.unlock();
  };

  constructor() {
    window.addEventListener('pointerdown', this.requestUnlock, { once: true });
    window.addEventListener('keydown', this.requestUnlock, { once: true });
  }

  async unlock(): Promise<void> {
    if (this.unlocked) {
      await this.context?.resume();
      return;
    }

    try {
      const AudioContextClass =
        window.AudioContext || (window as WebkitWindow).webkitAudioContext;
      if (!AudioContextClass) return;

      const context = new AudioContextClass();
      this.context = context;
      this.master = context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.68;
      this.master.connect(context.destination);

      this.createEngineBed(context);
      this.createOceanBed(context);
      await context.resume();
      this.unlocked = true;
    } catch (error) {
      console.warn('Audio unavailable; continuing silently.', error);
    }
  }

  updateEngine(speed01: number, boost: boolean, _delta: number): void {
    const context = this.runningContext();
    if (!context || !this.engineGain || !this.engineOscillator || !this.engineHarmonic) return;
    const speed = Math.min(1.2, Math.max(0, speed01));
    const now = context.currentTime;
    const fundamental = 48 + speed * 102 + (boost ? 18 : 0);
    this.engineOscillator.frequency.setTargetAtTime(fundamental, now, 0.045);
    this.engineHarmonic.frequency.setTargetAtTime(fundamental * 1.5, now, 0.06);
    this.engineGain.gain.setTargetAtTime(0.035 + speed * 0.095 + (boost ? 0.025 : 0), now, 0.08);
    this.ambienceGain?.gain.setTargetAtTime(0.025 + speed * 0.045, now, 0.18);
  }

  countdown(tick: number): void {
    this.tone(300 + Math.max(0, tick) * 42, 0.11, 0.09, 'square');
  }

  startSignal(): void {
    this.chord([440, 660, 880], 0.32, 0.08, 'sawtooth');
  }

  collision(severity = 0.5): void {
    const amount = Math.min(1, Math.max(0.1, severity));
    this.noiseBurst(0.07 + amount * 0.12, 0.05 + amount * 0.12, 180 + amount * 260);
    this.tone(95 - amount * 25, 0.14, 0.06 + amount * 0.06, 'sawtooth', 45);
  }

  checkpoint(): void {
    this.chord([540, 810], 0.12, 0.055, 'triangle');
  }

  lap(lapNumber: number): void {
    const root = 440 + lapNumber * 35;
    this.chord([root, root * 1.25, root * 1.5], 0.28, 0.07, 'triangle');
  }

  finish(place: number): void {
    const root = place === 1 ? 392 : place <= 3 ? 349 : 294;
    [0, 0.13, 0.26, 0.42].forEach((delay, index) => {
      window.setTimeout(() => {
        this.chord([root * (1 + index * 0.125), root * 1.5], 0.3, 0.075, 'triangle');
      }, delay * 1000);
    });
  }

  boost(): void {
    this.noiseBurst(0.22, 0.07, 1200);
    this.tone(170, 0.18, 0.045, 'sawtooth', 420);
  }

  driftBoost(charge = 0.5): void {
    const amount = Math.min(1, Math.max(0.15, charge));
    this.noiseBurst(0.12 + amount * 0.1, 0.035 + amount * 0.04, 900 + amount * 700);
    this.tone(210 + amount * 70, 0.16 + amount * 0.08, 0.045 + amount * 0.025, 'triangle', 460 + amount * 220);
  }

  interaction(kind: 'boost-gate' | 'drift-gate', success: boolean): void {
    if (!success) {
      this.tone(150, 0.13, 0.045, 'square', 92);
      return;
    }
    if (kind === 'boost-gate') {
      this.noiseBurst(0.18, 0.05, 1450);
      this.chord([620, 930], 0.2, 0.055, 'triangle');
    } else {
      this.chord([420, 630, 840], 0.24, 0.052, 'sawtooth');
    }
  }

  landing(intensity = 0.5): void {
    const amount = Math.min(1, Math.max(0.1, intensity));
    this.noiseBurst(0.05 + amount * 0.08, 0.025 + amount * 0.045, 520 + amount * 420);
    this.tone(88 - amount * 14, 0.09, 0.025 + amount * 0.025, 'sine', 54);
  }

  reset(): void {
    const context = this.runningContext();
    if (!context) return;
    this.engineGain?.gain.setTargetAtTime(0.025, context.currentTime, 0.06);
    this.ambienceGain?.gain.setTargetAtTime(0.025, context.currentTime, 0.08);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.context || !this.master) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.68, this.context.currentTime, 0.025);
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }


  isMuted(): boolean {
    return this.muted;
  }

  async setPaused(paused: boolean): Promise<void> {
    if (!this.context) return;
    try {
      if (paused && this.context.state === 'running') await this.context.suspend();
      else if (!paused && this.context.state === 'suspended') await this.context.resume();
    } catch {
      // Audio suspension is advisory; gameplay pause must remain reliable.
    }
  }

  dispose(): void {
    window.removeEventListener('pointerdown', this.requestUnlock);
    window.removeEventListener('keydown', this.requestUnlock);
    try {
      this.engineOscillator?.stop();
      this.engineHarmonic?.stop();
      this.ambienceSource?.stop();
    } catch {
      // Nodes may already be stopped if the page was suspended during teardown.
    }
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.engineGain = null;
    this.ambienceGain = null;
  }

  private createEngineBed(context: AudioContext): void {
    if (!this.master) return;
    const engineGain = context.createGain();
    const lowPass = context.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.value = 620;
    lowPass.Q.value = 1.8;
    engineGain.gain.value = 0.025;
    engineGain.connect(lowPass).connect(this.master);

    const fundamental = context.createOscillator();
    fundamental.type = 'sawtooth';
    fundamental.frequency.value = 48;
    fundamental.connect(engineGain);
    fundamental.start();

    const harmonic = context.createOscillator();
    const harmonicGain = context.createGain();
    harmonic.type = 'triangle';
    harmonic.frequency.value = 72;
    harmonicGain.gain.value = 0.38;
    harmonic.connect(harmonicGain).connect(engineGain);
    harmonic.start();

    this.engineGain = engineGain;
    this.engineOscillator = fundamental;
    this.engineHarmonic = harmonic;
  }

  private createOceanBed(context: AudioContext): void {
    if (!this.master) return;
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const samples = buffer.getChannelData(0);
    let state = 0x5eaf00d;
    let smoothed = 0;
    for (let i = 0; i < samples.length; i += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const white = (state / 0xffffffff) * 2 - 1;
      smoothed += (white - smoothed) * 0.045;
      samples[i] = smoothed * 0.82 + white * 0.18;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 680;
    filter.Q.value = 0.45;
    const gain = context.createGain();
    gain.gain.value = 0.025;
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
    this.ambienceSource = source;
    this.ambienceGain = gain;
  }

  private runningContext(): AudioContext | null {
    if (!this.context || this.context.state !== 'running') return null;
    return this.context;
  }

  private tone(
    startFrequency: number,
    duration: number,
    volume: number,
    type: OscillatorType,
    endFrequency = startFrequency,
  ): void {
    const context = this.runningContext();
    if (!context || !this.master) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, startFrequency), now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  private chord(frequencies: number[], duration: number, volume: number, type: OscillatorType): void {
    const perVoice = volume / Math.max(1, frequencies.length);
    frequencies.forEach((frequency) => this.tone(frequency, duration, perVoice, type, frequency * 1.015));
  }

  private noiseBurst(duration: number, volume: number, cutoff: number): void {
    const context = this.runningContext();
    if (!context || !this.master) return;
    const length = Math.ceil(context.sampleRate * duration);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let state = 0xc0111de;
    for (let i = 0; i < length; i += 1) {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      data[i] = ((state / 0xffffffff) * 2 - 1) * (1 - i / length);
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
  }
}
