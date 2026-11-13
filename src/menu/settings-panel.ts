import { setVolume } from '../audio.ts';
import { LANG, setLang, t, type Lang } from '../i18n/i18n.ts';
import { setMusicVolume } from '../music.ts';
import { TUTORIAL } from '../tutorial/tutorial.ts';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './settings.ts';

/**
 * Settings window — the same one in the main menu and on pause in battle (wiki/design-main-menu.md).
 * Volume applies at once; the rest goes to onChange — the game decides what to change on the fly.
 * Language is not part of Settings: it lives in localStorage `malina.lang` (src/i18n/i18n.ts) and a change reloads the page.
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
      <h2>${t('Settings')}</h2>
      <section><h3>${t('Sound')}</h3>
        <label class="mm-row"><span>${t('Master volume')}</span><input type="range" min="0" max="100" step="5" data-k="volume"><b data-v="volume"></b></label>
        <label class="mm-row"><span>${t('Music')}</span><input type="range" min="0" max="100" step="5" data-k="music"><b data-v="music"></b></label>
      </section>
      <section><h3>${t('Graphics')}</h3>
        <label class="mm-row"><span>${t('Quality')}</span><select data-k="quality"><option value="high">${t('High')}</option><option value="low">${t('Fast')}</option></select></label>
        <label class="mm-row"><span>${t('Post-processing and glow')}</span><input type="checkbox" data-k="postFX"></label>
        <label class="mm-row"><span>${t('Shadows')}</span><input type="checkbox" data-k="shadows"></label>
      </section>
      <section><h3>${t('Game')}</h3>
        <label class="mm-row"><span>${t('Controls hint at the start of a battle')}</span><input type="checkbox" data-k="help"></label>
        <label class="mm-row"><span>${t('Hint cards for new mechanics')}</span><button type="button" class="mm-btn small" data-act="tut-reset">${t('Show again')}</button><input type="checkbox" data-tut></label>
        <label class="mm-row"><span>${t('Language')}</span><select data-lang><option value="en">English</option><option value="ru">Русский</option></select></label>
      </section>
      <p class="mm-note">${t('Quality applies from the next battle. Changing the language reloads the page.')}</p>
      <div class="mm-win-btns"><button class="mm-btn small" data-act="reset">${t('Defaults')}</button><button class="mm-btn small primary" data-act="close">${t('Done')} <kbd>Esc</kbd></button></div>
    </div>`;
    parent.appendChild(el);
    this.el = el;
    el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement;
      if (t instanceof HTMLSelectElement && t.dataset.lang !== undefined) {
        const l = t.value as Lang;
        if (l !== LANG) { setLang(l); location.reload(); }
        return;
      }
      if (t instanceof HTMLInputElement && t.dataset.tut !== undefined) { TUTORIAL.setOff(!t.checked); return; }
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
      if (act === 'tut-reset') { e.preventDefault(); TUTORIAL.reset(); TUTORIAL.setOff(false); this.sync(); (e.target as HTMLElement).closest('button')!.textContent = t('Hints will show again'); }
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

  /** Keys while the window is open; true — consumed */
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
    const lang = this.el.querySelector<HTMLSelectElement>('[data-lang]');
    if (lang) lang.value = LANG;
    const tut = this.el.querySelector<HTMLInputElement>('[data-tut]');
    if (tut) tut.checked = !TUTORIAL.off;
  }
}

/** Volume from the settings → sound and music */
export function applyAudio(s: Settings): void {
  setVolume(s.volume);
  setMusicVolume(s.music);
}
