import { menuUrl } from './session.ts';
import type { SettingsPanel } from './settings-panel.ts';

/**
 * Меню боя, пришедшего из главного меню (`?from=menu`, wiki/design-main-menu.md):
 * Esc — пауза (продолжить, настройки, заново, в лагерь); конец обороны — итог и «Ещё раз» / «В лагерь».
 * Игра сама ставит время на паузу, пока `open`.
 */
export class BattleMenu {
  readonly el: HTMLDivElement;
  private state: 'pause' | 'won' | 'lost' = 'pause';
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
  /** Пауза (не итог боя) — время стоит */
  get pausing(): boolean { return this.open && this.state === 'pause'; }

  pause(): void { this.state = 'pause'; this.render(); this.el.classList.add('open'); }

  /** Итог обороны: сводка и кнопки поверх замершей карты */
  end(won: boolean, summary: string): void {
    this.state = won ? 'won' : 'lost';
    this.render(summary);
    this.el.classList.add('open');
  }

  hide(): void { this.el.classList.remove('open'); }

  leave(): void {
    this.onLeave?.();
    window.location.href = menuUrl(true);
  }

  /** Клавиши, пока меню открыто; true — съедено */
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
    const head = p === 'pause' ? 'Пауза' : p === 'won' ? 'Куст отбит!' : 'Куст засох';
    const btns = p === 'pause'
      ? `<button class="mm-btn primary" data-act="resume">Продолжить <kbd>Esc</kbd></button>
         <button class="mm-btn" data-act="settings">Настройки</button>
         <button class="mm-btn" data-act="restart">Начать заново</button>
         <button class="mm-btn" data-act="leave">Выйти в лагерь</button>`
      : `<button class="mm-btn primary" data-act="restart">Ещё раз <kbd>Enter</kbd></button>
         <button class="mm-btn" data-act="leave">В лагерь</button>`;
    this.el.innerHTML = `<div class="pz-win"><h2>${head}</h2><p>${this.mapTitle}${summary ? ` · ${summary}` : ''}</p>${btns}</div>`;
  }
}
