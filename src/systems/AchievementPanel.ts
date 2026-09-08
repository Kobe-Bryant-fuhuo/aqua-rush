import { ACHIEVEMENTS, type AchievementData } from '../game/Achievements';

export class AchievementPanel {
  private readonly dialog = document.createElement('dialog');
  private readonly toast = document.createElement('div');
  private readonly button = document.createElement('button');
  private timer?: number;
  private readonly queue: string[] = [];
  constructor(private readonly snapshot: () => AchievementData, private readonly storageAvailable: () => boolean) {
    this.button.className = 'menu-quiet';
    this.button.id = 'achievements-button';
    this.button.type = 'button';
    this.button.textContent = '◇ 航海成就';
    document.querySelector('#title-start-button')!.after(this.button);
    this.dialog.id = 'achievements-dialog';
    this.dialog.className = 'achievement-dialog';
    this.dialog.setAttribute('aria-labelledby', 'achievements-heading');
    this.dialog.addEventListener('keydown', event => event.stopPropagation());
    this.dialog.addEventListener('close', () => this.button.focus({ preventScroll: true }));
    this.button.onclick = () => { this.render(); this.dialog.showModal(); };
    this.toast.className = 'achievement-toast';
    this.toast.setAttribute('role', 'status');
    this.toast.setAttribute('aria-live', 'polite');
    this.toast.hidden = true;
    document.body.append(this.dialog, this.toast);
  }
  private render(): void {
    const data = this.snapshot();
    this.dialog.innerHTML = `<header><div><span class="flow-eyebrow">CAPTAIN'S LOG</span><h2 id="achievements-heading">航海成就</h2></div><button type="button" class="menu-quiet" aria-label="关闭成就">关闭 ×</button></header><p>${Object.keys(data.unlocked).length} / ${ACHIEVEMENTS.length} 已解锁 · ${this.storageAvailable() ? '进度保存在此浏览器' : '存储不可用，进度仅本次有效'}</p><div class="achievement-list">${ACHIEVEMENTS.map(a => {
      const unlocked = Boolean(data.unlocked[a.id]);
      const progress = Math.min(a.target, data.progress[a.metric]);
      return `<article data-achievement="${a.id}" data-unlocked="${unlocked}"><span class="achievement-emblem" aria-hidden="true">${unlocked ? '◆' : '◇'}</span><div><h3>${a.name}<small>${unlocked ? '已解锁' : `${progress} / ${a.target}`}</small></h3><p>${a.description}</p><progress aria-label="${a.name}进度" max="${a.target}" value="${unlocked ? a.target : progress}"></progress></div></article>`;
    }).join('')}</div>`;
    this.dialog.querySelector('button')!.onclick = () => this.dialog.close();
  }
  notify(ids: string[]): void {
    this.queue.push(...ids);
    if (this.dialog.open) this.render();
    if (!this.timer) this.next();
  }
  private next(): void {
    const id = this.queue.shift();
    if (!id) { this.toast.hidden = true; this.timer = undefined; return; }
    const achievement = ACHIEVEMENTS.find(a => a.id === id)!;
    this.toast.textContent = `◆ 成就解锁 · ${achievement.name}`;
    this.toast.hidden = false;
    this.timer = window.setTimeout(() => this.next(), 3200);
  }
  dispose(): void {
    window.clearTimeout(this.timer);
    this.dialog.remove(); this.toast.remove(); this.button.remove();
  }
}
