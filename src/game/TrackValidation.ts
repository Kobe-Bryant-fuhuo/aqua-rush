import type { TrackDefinition } from './ContentCatalog';

/** Fail at content registration, before a malformed course reaches saves or a race. */
export function validateTrackDefinition(track: TrackDefinition): void {
  const fail = (message: string): never => { throw new Error(`${track.id}: ${message}`); };
  const positive = (value: number) => Number.isFinite(value) && value > 0;
  const progress = (value: number) => Number.isFinite(value) && value >= 0 && value < 1;
  const unique = (entries: readonly { id: string }[]) => new Set(entries.map(e => e.id)).size === entries.length;
  if (!positive(track.halfWidth) || track.width !== track.halfWidth * 2 || !positive(track.buoySpacing)) fail('invalid course width/spacing');
  if (track.controlPoints.length < 4 || track.controlPoints.some(p => p.length !== 2 || p.some(v => !Number.isFinite(v) || Math.abs(v) > 350))) fail('control points outside world');
  if (track.lapCount !== 3 || track.spawnGrid.length !== 4 || track.spawnGrid.some(s => !progress(s.progress) || !Number.isFinite(s.lane) || Math.abs(s.lane) > track.halfWidth)) fail('invalid spawn grid');
  if (track.checkpoints.length !== 12 || !unique(track.checkpoints)) fail('expected 12 unique checkpoints');
  let last = 0;
  for (const [index, gate] of track.checkpoints.entries()) {
    if (!progress(gate.progress) || !positive(gate.halfWidth) || gate.halfWidth > 30 || !positive(gate.height)) fail('invalid checkpoint');
    if (index === track.checkpoints.length - 1) {
      if (gate.role !== 'finish' || gate.progress !== 0) fail('finish must close the ordered lap');
    } else {
      if (gate.progress <= last || gate.role === 'finish') fail('unordered checkpoints');
      last = gate.progress;
    }
  }
  for (const entries of [track.interactions, track.rocks, track.blocks ?? [], track.ramps ?? []]) {
    if (!unique(entries)) fail('duplicate content IDs');
    if (entries.some(e => !progress(e.progress) || !Number.isFinite(e.lateralOffset))) fail('invalid content anchor');
  }
  if (track.interactions.some(g => !positive(g.halfWidth) || !positive(g.cooldown) || !positive(g.reward) || g.reward > 1)) fail('invalid reward');
  if (track.rocks.some(r => !positive(r.radius) || !positive(r.height))) fail('invalid rock');
  if ([...(track.blocks ?? []), ...(track.ramps ?? [])].some(b => !positive(b.width) || !positive(b.length) || !positive(b.height))) fail('invalid world dimensions');
  if (track.ramps?.some(r => !positive(r.launch))) fail('invalid launch');
  if (track.crossings?.some(g => !progress(g.progress) || !positive(g.period) || !Number.isFinite(g.offset))) fail('invalid lock');
  if (!positive(track.ai.lookAheadScale) || !positive(track.ai.speedScale)) fail('invalid AI tuning');
  if (track.currents?.some(c => !progress(c.progress) || !Number.isFinite(c.lateralOffset) ||
    !positive(c.innerRadius) || !positive(c.outerRadius) || c.innerRadius >= c.outerRadius ||
    !positive(c.speed) || c.speed > 10 || (c.spin !== 1 && c.spin !== -1))) fail('invalid current');
  if (track.routes?.some(r => r.anchors.length < 2 || r.anchors.some(([p, offset], i) =>
    !progress(p) || !Number.isFinite(offset) || (i > 0 && p <= r.anchors[i - 1][0])))) fail('invalid optional route');
  const { gold, silver, bronze } = track.timeTrialTargets;
  if (!positive(gold) || !(gold < silver && silver < bronze) || !positive(bronze)) fail('invalid time targets');
}
