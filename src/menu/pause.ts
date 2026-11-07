import { t } from '../i18n/i18n.ts';
import { menuUrl } from './session.ts';
import type { SettingsPanel } from './settings-panel.ts';

/**
 * Menu of a battle started from the main menu (`?from=menu`, wiki/design-main-menu.md):
 * Esc — pause (resume, settings, restart, to camp); end of the defence — summary and "Once more" / "To camp".
 * The game itself pauses time while `open`.
 */
export class BattleMenu {
  readonly el: HTMLDivElement;
  private state: 'pause' | 'won' | 'lost' = 'pause';
  private loot = 0;
  onRestart?: () => void;
  onLeave?: () => void;

  readonly settings: SettingsPanel;
  private readonly mapTitle: string;
  constructor(parent: HTMLElement, settings: SettingsPanel, mapTitle: string) { this.settings = settings; this.mapTitle = mapTitle;
    const el = document.createElement('div');
    el.className = 'pz';
    parent.appendChild(el);
    this.el = el;
    el.addEventListener('click', (e) => {
      switch ((e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act) {
        case 'resume': this.hide(); break;
        case 'settings': this.settings.show(); break;
        case 'restart': this.hide(); this.onRestart?.(); break;
        case 'leave': this.leave(); break;
        default: break;
      }
    });
  }

  get open(): boolean { return this.el.classList.contains('open'); }
  /** Pause (not the battle summary) — time stands still */
  get pausing(): boolean { return this.open && this.state === 'pause'; }

  pause(): void { this.state = 'pause'; this.render(); this.el.classList.add('open'); }

  /** Defence result: summary and buttons over the frozen map */
  end(won: boolean, summary: string, loot = 0): void {
    this.state = won ? 'won' : 'lost';
    this.loot = loot;
    this.render(summary);
    this.el.classList.add('open');
  }

  hide(): void { this.el.classList.remove('open'); }

  leave(): void {
    this.onLeave?.();
    window.location.href = menuUrl(true);
  }

  /** Keys while the menu is open; true — consumed */
  key(e: KeyboardEvent): boolean {
    if (this.settings.key(e)) return true;
    if (!this.open) return false;
    if (e.code === 'Escape' && this.state === 'pause') this.hide();
    else if (e.code === 'Enter' || e.code === 'KeyN') { if (this.state !== 'pause') { this.hide(); this.onRestart?.(); } }
    return true;
  }

  private render(summary = ''): void {
    const p = this.state;
    this.el.classList.toggle('end', p !== 'pause');
    this.el.classList.toggle('won', p === 'won');
    this.el.classList.toggle('lost', p === 'lost');
    const head = p === 'pause' ? t('Paused') : p === 'won' ? t('The bush held!') : t('The bush withered');
    const btns = p === 'pause'
      ? `<button class="mm-btn primary" data-act="resume">${t('Resume')} <kbd>Esc</kbd></button>
         <button class="mm-btn" data-act="settings">${t('Settings')}</button>
         <button class="mm-btn" data-act="restart">${t('Restart')}</button>
         <button class="mm-btn" data-act="leave">${t('Leave to camp')}</button>`
      : `<button class="mm-btn primary" data-act="restart">${t('Once more')} <kbd>Enter</kbd></button>
         <button class="mm-btn" data-act="leave">${t('To camp')}</button>`;
    const loot = p === 'won' ? `<p class="pz-loot">${t('Loot: +{n} raspberries to the camp', { n: this.loot })}</p>` : p === 'lost' ? `<p class="pz-loot lost">${t('Loot lost: {n} raspberries', { n: this.loot })}</p>` : '';
    this.el.innerHTML = `<div class="pz-win"><h2>${head}</h2><p>${this.mapTitle}${summary ? ` · ${summary}` : ''}</p>${loot}${btns}</div>`;
  }
}
