import { TRACK_IDS, type TrackId } from './ContentCatalog';

export const ACHIEVEMENTS = [
  { id: 'first-finish', name: '初航归来', description: '完成 1 场比赛', target: 1, metric: 'finishes' },
  { id: 'veteran', name: '乘风破浪', description: '累计完成 10 场比赛', target: 10, metric: 'finishes' },
  { id: 'champion', name: '领航者', description: '赢得 1 场快速竞赛或联机比赛', target: 1, metric: 'wins' },
  { id: 'explorer', name: '三海巡航', description: '在全部 3 条赛道完成比赛', target: 3, metric: 'courses' },
  { id: 'time-trialist', name: '与时间竞速', description: '完成 1 场计时赛', target: 1, metric: 'trials' },
  { id: 'drifter', name: '浪尖舞者', description: '本地比赛中累计完成 10 次漂移释放', target: 10, metric: 'drifts' },
  { id: 'landing', name: '轻盈落水', description: '本地比赛中完成 1 次精准落水', target: 1, metric: 'landings' },
  { id: 'combo', name: '一气呵成', description: '本地比赛中达到 3 连段', target: 3, metric: 'chain' },
] as const;
export type AchievementMetric = typeof ACHIEVEMENTS[number]['metric'];
export type AchievementData = { progress: Record<AchievementMetric, number>; tracks: TrackId[]; unlocked: Record<string, number> };
export function cleanAchievements(value?: Partial<AchievementData> | null): AchievementData {
  const progress = Object.fromEntries(ACHIEVEMENTS.map(a => {
    const n = value?.progress?.[a.metric];
    return [a.metric, typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? Math.min(n, 1000000) : 0];
  })) as AchievementData['progress'];
  const tracks = TRACK_IDS.filter(id => Array.isArray(value?.tracks) && value.tracks.includes(id));
  progress.courses = tracks.length;
  const unlocked: Record<string, number> = {};
  for (const a of ACHIEVEMENTS) {
    const timestamp = value?.unlocked?.[a.id];
    if (typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0) unlocked[a.id] = timestamp;
  }
  return { progress, tracks, unlocked };
}
export type AchievementEvent = { type: 'finish'; trackId: TrackId; mode: string; place: number } | { type: 'skill'; kind: number; chain: number };
export function applyAchievementEvent(data: AchievementData, event: AchievementEvent): string[] {
  if (event.type === 'finish') {
    data.progress.finishes++;
    if (event.mode === 'time-trial') data.progress.trials++;
    else if (event.place === 1) data.progress.wins++;
    if (!data.tracks.includes(event.trackId)) data.tracks.push(event.trackId);
    data.progress.courses = data.tracks.length;
  } else {
    if (event.kind === 1) data.progress.drifts++;
    if (event.kind === 2) data.progress.landings++;
    data.progress.chain = Math.max(data.progress.chain, event.chain);
  }
  const newlyUnlocked: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!data.unlocked[a.id] && data.progress[a.metric] >= a.target) {
      data.unlocked[a.id] = Date.now();
      newlyUnlocked.push(a.id);
    }
  }
  return newlyUnlocked;
}
