import { HERO, resetTuning, SWORD, tuningJSON } from '../tuning.ts';
import { t } from '../i18n/i18n.ts';

/**
 * F1 — the parameters panel. Sliders edit the objects from tuning.ts directly, changes apply at once.
 */

const LABELS: Record<string, string> = {
  hp: t('Health'), radius: t('Radius, m'),
  walk: t('Walk, m/s'), attackMove: t('While striking ×'), accel: t('Acceleration, m/s²'), decel: t('Deceleration, m/s²'), turnRate: t('Turn rate'),
  gravity: t('Gravity, m/s²'), airControl: t('Air control'), arrive: t('Click: arrived within, m'),
  rollDist: t('Dodge roll, m'), rollTime: t('Dodge roll, s'), rollIframes: t('Invulnerability, s'), rollCd: t('Dodge roll: cooldown, s'),
  step: t('Step, m'),
  comboWindow: t('Combo window, s'), chainFrom: t('Next strike from fraction'), finisherCd: t('Pause after the finisher, s'), hitStop: t('Hit stop, s'), shockR: t('Finisher wave, m'),
  dmg: t('Damage'), time: t('Duration, s'), windup: t('Wind-up, fraction'), strike: t('Strike, fraction'), range: t('Range, m'), arc: t('Arc, °'), lunge: t('Lunge, m'), knock: t('Knockback'),
};

const INT_KEYS = new Set(['hp', 'dmg']);

function rangeFor(key: string, v: number): [number, number, number] {
  if (INT_KEYS.has(key)) return [1, Math.max(10, Math.ceil(v * 3)), 1];
  if (key === 'attackMove' || key === 'airControl' || key === 'chainFrom' || key === 'windup' || key === 'strike') return [0, 1, 0.01];
  if (key === 'arc') return [10, 360, 1];
  const max = v <= 0 ? 1 : v < 1 ? 1 : v * 3;
  const step = max <= 1 ? 0.01 : max <= 10 ? 0.05 : max <= 50 ? 0.1 : 1;
  return [0, +max.toFixed(2), step];
}

type NumObj = Record<string, number>;

export class Panel {
  readonly el: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly extra: HTMLDivElement;
  private inputs: { obj: NumObj; key: string; input: HTMLInputElement; out: HTMLElement }[] = [];

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'pg-panel hidden';
    this.el.innerHTML = `<div class="pg-head"><b>${t('Parameters')}</b><span>F1</span></div>
      <div class="pg-btns"><button data-a="copy">${t('Copy JSON')}</button><button data-a="reset">${t('Reset')}</button></div>`;
    this.extra = document.createElement('div');
    this.extra.className = 'pg-extra';
    this.body = document.createElement('div');
    this.el.append(this.extra, this.body);
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).dataset.a;
      if (a === 'copy') void this.copy(e.target as HTMLButtonElement);
      if (a === 'reset') { resetTuning(); this.rebuild(); }
    });
    // keys must not reach the game while a field has focus
    this.el.addEventListener('keydown', (e) => { if (!e.code.startsWith('F')) e.stopPropagation(); });
  }

  get open(): boolean { return !this.el.classList.contains('hidden'); }
  toggle(): void { this.el.classList.toggle('hidden'); if (this.open) this.rebuild(); }

  /** Block with buttons and toggles that the playground fills */
  get controls(): HTMLDivElement { return this.extra; }

  rebuild(): void {
    this.inputs = [];
    this.body.innerHTML = '';
    this.section(t('Hero'), HERO as unknown as NumObj);
    this.section(t('Sword: combo'), SWORD as unknown as NumObj);
    const names = [t('Strike 1: from the left'), t('Strike 2: from the right'), t('Strike 3: overhead (finisher)')];
    SWORD.swings.forEach((s, i) => this.section(names[i], s as unknown as NumObj));
  }

  /** Refresh the numbers if they were changed not by a slider */
  sync(): void {
    for (const it of this.inputs) {
      const v = it.obj[it.key];
      if (document.activeElement !== it.input && Number(it.input.value) !== v) { it.input.value = String(v); it.out.textContent = fmt(v); }
    }
  }

  private section(title: string, obj: NumObj, only?: string[]): void {
    const sec = document.createElement('details');
    sec.open = title === t('Hero') || title === t('Sword: combo');
    sec.innerHTML = `<summary>${title}</summary>`;
    for (const key of only ?? Object.keys(obj)) {
      const v = obj[key];
      if (typeof v !== 'number') continue;
      const [min, max, step] = rangeFor(key, v);
      const row = document.createElement('label');
      row.className = 'pg-row';
      row.innerHTML = `<span>${LABELS[key] ?? key}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${v}"><output>${fmt(v)}</output>`;
      const input = row.querySelector('input') as HTMLInputElement;
      const out = row.querySelector('output') as HTMLElement;
      input.addEventListener('input', () => { obj[key] = Number(input.value); out.textContent = fmt(obj[key]); });
      // double-click on the number — enter an exact value
      out.addEventListener('dblclick', () => {
        const s = window.prompt(LABELS[key] ?? key, String(obj[key]));
        if (s === null || Number.isNaN(Number(s))) return;
        obj[key] = Number(s); input.max = String(Math.max(Number(input.max), obj[key])); input.value = s; out.textContent = fmt(obj[key]);
      });
      sec.appendChild(row);
      this.inputs.push({ obj, key, input, out });
    }
    this.body.appendChild(sec);
  }

  private async copy(btn: HTMLButtonElement): Promise<void> {
    const json = tuningJSON();
    let ok = false;
    try { await navigator.clipboard.writeText(json); ok = true; } catch { /* no clipboard access */ }
    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = json; document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }
    btn.textContent = ok ? t('Copied ✓') : t('Failed — see the console');
    if (!ok) console.log(json);
    setTimeout(() => { btn.textContent = t('Copy JSON'); }, 1400);
  }
}

const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, ''));

/** Helpers for the toggles block */
export function button(parent: HTMLElement, text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.addEventListener('click', onClick);
  parent.appendChild(b);
  return b;
}

export function toggle(parent: HTMLElement, text: string, get: () => boolean, set: (v: boolean) => void): () => void {
  const l = document.createElement('label');
  l.className = 'pg-check';
  l.innerHTML = `<input type="checkbox"><span>${text}</span>`;
  const i = l.querySelector('input') as HTMLInputElement;
  i.checked = get();
  i.addEventListener('change', () => set(i.checked));
  parent.appendChild(l);
  return () => { i.checked = get(); };
}

export function select<T extends string>(parent: HTMLElement, text: string, options: [T, string][], get: () => T, set: (v: T) => void): () => void {
  const l = document.createElement('label');
  l.className = 'pg-select';
  l.innerHTML = `<span>${text}</span><select>${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`;
  const s = l.querySelector('select') as HTMLSelectElement;
  s.value = get();
  s.addEventListener('change', () => set(s.value as T));
  parent.appendChild(l);
  return () => { s.value = get(); };
}
