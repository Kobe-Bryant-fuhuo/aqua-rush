import GUI from 'lil-gui';
import type { BoatTuning } from '../entities/ArcadeBoat';
import type { CameraTuning } from './CameraRig';

export type DebugTuning = BoatTuning & CameraTuning & {
  exposure: number;
  maxDpr: number;
};

export class DebugTools {
  private gui: GUI | null = null;

  constructor(tuning: DebugTuning, onChange: () => void) {
    const enabled = new URLSearchParams(window.location.search).has('debug');
    if (!enabled) return;

    this.gui = new GUI({ title: 'Game tuning' });
    this.gui.add(tuning, 'maxForwardSpeed', 14, 38, 0.25);
    this.gui.add(tuning, 'acceleration', 5, 22, 0.1);
    this.gui.add(tuning, 'turnRate', 0.8, 2.8, 0.02);
    this.gui.add(tuning, 'lateralGrip', 1, 10, 0.1);
    this.gui.add(tuning, 'boostAcceleration', 4, 24, 0.1);
    this.gui.add(tuning, 'distance', 6, 16, 0.1);
    this.gui.add(tuning, 'height', 2.5, 9, 0.1);
    this.gui.add(tuning, 'spring', 15, 85, 1);
    this.gui.add(tuning, 'maxDpr', 1, 2, 0.25).onChange(onChange);
    this.gui.add(tuning, 'exposure', 0.6, 1.8, 0.01).onChange(onChange);
  }

  setHidden(hidden: boolean): void {
    if (!this.gui) return;
    if (hidden) this.gui.hide();
    else this.gui.show();
  }

  dispose(): void {
    this.gui?.destroy();
    this.gui = null;
  }
}
