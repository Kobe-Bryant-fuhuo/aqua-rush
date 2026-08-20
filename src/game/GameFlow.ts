import type { RaceMode, TrackId } from './ContentCatalog';

export type AppState = 'loading' | 'title' | 'mode-select' | 'track-select' | 'countdown' | 'racing' | 'paused' | 'results';

export type GameFlowSnapshot = Readonly<{
  state: AppState;
  mode: RaceMode;
  trackId: TrackId;
}>;

export class GameFlow {
  private current: GameFlowSnapshot;

  constructor(mode: RaceMode = 'quick-race', trackId: TrackId = 'sunset-circuit') {
    this.current = { state: 'loading', mode, trackId };
  }

  get snapshot(): GameFlowSnapshot {
    return this.current;
  }

  transition(state: AppState): GameFlowSnapshot {
    this.current = { ...this.current, state };
    return this.current;
  }

  selectMode(mode: RaceMode): GameFlowSnapshot {
    this.current = { ...this.current, mode, state: 'track-select' };
    return this.current;
  }

  selectTrack(trackId: TrackId): GameFlowSnapshot {
    this.current = { ...this.current, trackId };
    return this.current;
  }
}
