import { setVolume } from '../audio';
import { setMusicVolume } from '../music';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './settings';

/**
 * Окно настроек — одно и в главном меню, и на паузе в бою (wiki/design-main-menu.md).
 * Громкость применяется сразу; остальное отдаётся в onChange — игра сама решает, что поменять на ходу.
 */
export class SettingsPanel {
  readonly el: HTMLDivElement;
  settings: Settings = loadSettings();
  onChange?: (s: Settings) => void;
  onClose?: () => void;

  constructor(parent: HTMLElement) {
    const el = document.createElement('div');
    el.className = 'mm-settings';
    el.innerHTML = `<div class="mm-win">
      <h2>Настройки</h2>
      <section><h3>Звук</h3>
        <label class="mm-row"><span>Общая громкость</span><input type="range" min="0" max="100" step="5" data-k="volume"><b data-v="volume"></b></label>
        <label class="mm-row"><span>Музыка</span><input type="range" min="0" max="100" step="5" data-k="music"><b data-v="music"></b></label>
      </section>
      <section><h3>Графика</h3>
        <label class="mm-row"><span>Качество</span><select data-k="quality"><option value="high">Высокое</option><option value="low">Быстрое</option></select></label>
        <label class="mm-row"><span>Постобработка и свечение</span><input type="checkbox" data-k="postFX"></label>
        <label class="mm-row"><span>Тени</span><input type="checkbox" data-k="shadows"></label>
      </section>
      <section><h3>Игра</h3>
        <label class="mm-row"><span>Подсказка по управлению в начале боя</span><input type="checkbox" data-k="help"></label>
      </section>
      <p class="mm-note">Качество применяется со следующего боя.</p>
      <div class="mm-win-btns"><button class="mm-btn small" data-act="reset">По умолчанию</button><button class="mm-btn small primary" data-act="close">Готово <kbd>Esc</kbd></button></div>
    </div>`;
    parent.appendChild(el);
    this.el = el;
    el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement;
      const k = t.dataset.k as keyof Settings | undefined;
      if (!k) return;
      const s = this.settings as unknown as Record<string, unknown>;
      if (t instanceof HTMLInputElement && t.type === 'checkbox') s[k] = t.checked;
      else if (t instanceof HTMLInputElement && t.type === 'range') s[k] = Number(t.value) / 100;
      else s[k] = t.value;
      this.commit();
    });
    el.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'close') this.hide();
      if (act === 'reset') { this.settings = { ...DEFAULT_SETTINGS }; this.commit(); }
      if (e.target === el) this.hide();
    });
    applyAudio(this.settings);
  }

  get open(): boolean { return this.el.classList.contains('open'); }

  show(): void { this.settings = loadSettings(); this.sync(); this.el.classList.add('open'); }

  hide(): void {
    if (!this.open) return;
    this.el.classList.remove('open');
    this.onClose?.();
  }

  /** Клавиши, пока окно открыто; true — съедено */
  key(e: KeyboardEvent): boolean {
    if (!this.open) return false;
    if (e.code === 'Escape' || e.code === 'Enter') this.hide();
    return true;
  }

  private commit(): void {
    saveSettings(this.settings);
    applyAudio(this.settings);
    this.sync();
    this.onChange?.(this.settings);
  }

  private sync(): void {
    const s = this.settings as unknown as Record<string, unknown>;
    for (const inp of this.el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]')) {
      const v = s[inp.dataset.k ?? ''];
      if (inp instanceof HTMLInputElement && inp.type === 'checkbox') inp.checked = Boolean(v);
      else if (inp instanceof HTMLInputElement && inp.type === 'range') inp.value = String(Math.round(Number(v) * 100));
      else inp.value = String(v);
    }
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-v]')) b.textContent = `${Math.round(Number(s[b.dataset.v ?? '']) * 100)}%`;
  }
}

/** Громкость из настроек — в звук и музыку */
export function applyAudio(s: Settings): void {
  setVolume(s.volume);
  setMusicVolume(s.music);
}
