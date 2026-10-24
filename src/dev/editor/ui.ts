/**
 * Мелкие детали интерфейса редактора в духе Unreal: элементы, иконки, выпадающие и контекстные меню,
 * сетка свойств (панель «Детали»), разделители панелей. Без фреймворков — DOM и замыкания.
 */

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

/** Элемент: h('div.cls#id', { title: '…', onclick: fn }, 'текст', child) */
export function h<K extends keyof HTMLElementTagNameMap>(sel: K | `${K}.${string}` | `${K}#${string}`, attrs: Attrs = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const m = /^([a-z0-9]+)((?:[.#][\w-]+)*)$/i.exec(sel)!;
  const el = document.createElement(m[1]) as HTMLElementTagNameMap[K];
  for (const part of m[2].match(/[.#][\w-]+/g) ?? []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(k);
  return el;
}

/** Иконки — контурный SVG 16 × 16, цвет — currentColor */
const P: Record<string, string> = {
  save: '<path d="M3 2h8l2 2v10H3z M5 2v4h5V2 M5 14v-4h6v4"/>',
  play: '<path d="M5 3l8 5-8 5z" fill="currentColor"/>',
  select: '<path d="M4 2l8 7-4 .5 2.5 4.5-1.5.8-2.5-4.6L4 12z" fill="currentColor"/>',
  move: '<path d="M8 1v14M1 8h14M8 1l-2 2M8 1l2 2M8 15l-2-2M8 15l2-2M1 8l2-2M1 8l2 2M15 8l-2-2M15 8l-2 2"/>',
  rotate: '<path d="M13 8a5 5 0 1 1-2-4M11 1v3h3"/>',
  scale: '<path d="M2 14L14 2M9 2h5v5M2 9v5h5"/>',
  grid: '<path d="M2 2h12v12H2zM6 2v12M10 2v12M2 6h12M2 10h12"/>',
  angle: '<path d="M2 14h12M2 14L11 4M6 14a4 4 0 0 0-1.3-3"/>',
  camera: '<path d="M2 5h8v7H2zM10 7l4-2v7l-4-2"/>',
  eye: '<path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/>',
  eyeOff: '<path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5zM2 2l12 12"/>',
  folder: '<path d="M1 4h5l1 1.5h8V13H1z"/>',
  cube: '<path d="M8 1l6 3.5v7L8 15l-6-3.5v-7zM2 4.5L8 8l6-3.5M8 8v7"/>',
  sun: '<circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3"/>',
  sky: '<path d="M4 12a3 3 0 0 1 0-6 4 4 0 0 1 7.6-1A3 3 0 0 1 12 12z"/>',
  fog: '<path d="M2 5h12M1 8h10M4 11h11M2 14h8"/>',
  rain: '<path d="M4 9a3 3 0 0 1 0-6 4 4 0 0 1 7.6-1A3 3 0 0 1 12 9zM5 11l-1 3M8 11l-1 3M11 11l-1 3"/>',
  post: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M5 10l2-3 2 2 2-3"/>',
  light: '<path d="M6 12h4M6.5 14h3M8 2a4 4 0 0 0-2.5 7.2V11h5V9.2A4 4 0 0 0 8 2z"/>',
  spot: '<path d="M5 2h6l-1 4H6zM6 6L2 14h12L10 6"/>',
  flag: '<path d="M4 15V2M4 2h8l-2 3 2 3H4"/>',
  land: '<path d="M1 13l4-6 3 4 2-2 5 4z"/>',
  decor: '<path d="M5 14h6M8 14V6M5 6h6l-1-4H6z"/>',
  prefab: '<path d="M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z"/>',
  weapon: '<path d="M14 2l-1 4-7 7-3-3 7-7zM3 10l-1.5 4.5L6 13M4.5 11.5L2 14"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>',
  chevron: '<path d="M6 4l4 4-4 4"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  trash: '<path d="M3 4h10M6 4V2h4v2M4 4l1 10h6l1-10"/>',
  copy: '<path d="M5 5h8v9H5zM3 11V2h8"/>',
  focus: '<path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3"/><circle cx="8" cy="8" r="2"/>',
  layout1: '<rect x="2" y="2" width="12" height="12"/>',
  layout4: '<path d="M2 2h12v12H2zM8 2v12M2 8h12"/>',
  layout2: '<path d="M2 2h12v12H2zM8 2v12"/>',
  world: '<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c-3 3-3 9 0 12M8 2c3 3 3 9 0 12"/>',
  undo: '<path d="M5 3L2 6l3 3M2 6h8a4 4 0 0 1 0 8H7"/>',
  redo: '<path d="M11 3l3 3-3 3M14 6H6a4 4 0 0 0 0 8h3"/>',
  turntable: '<ellipse cx="8" cy="11" rx="6" ry="2.5"/><path d="M8 3v6M5 5l3-2 3 2"/>',
  brush: '<path d="M14 2L7 9M5 10c-2 0-3 1.5-3 4 2.5 0 4-1 4-3z"/>',
  block: '<path d="M2 5l6-3 6 3v6l-6 3-6-3zM2 5l6 3 6-3M8 8v6"/>',
  info: '<circle cx="8" cy="8" r="6"/><path d="M8 7v5M8 4.5v.5"/>',
  dot: '<circle cx="8" cy="8" r="3" fill="currentColor"/>',
};
export function icon(name: keyof typeof P | string, cls = ''): string {
  return `<svg class="ue-ic ${cls}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${P[name] ?? P.dot}</svg>`;
}

// ---------- меню ----------

export interface MenuItem {
  label?: string;
  icon?: string;
  shortcut?: string;
  action?: () => void;
  checked?: boolean | (() => boolean);
  disabled?: boolean;
  sub?: MenuItem[] | (() => MenuItem[]);
  sep?: boolean;
  /** Заголовок раздела внутри меню */
  head?: string;
}

let openMenu: HTMLElement | null = null;
export function closeMenus(): void { openMenu?.remove(); openMenu = null; document.querySelectorAll('.ue-menubtn.open').forEach((b) => b.classList.remove('open')); }
window.addEventListener('pointerdown', (e) => { if (openMenu && !openMenu.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.ue-menubtn')) closeMenus(); }, true);
window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && openMenu) { closeMenus(); e.stopPropagation(); } }, true);

function buildMenu(items: MenuItem[]): HTMLElement {
  const m = h('div.ue-menu');
  for (const it of items) {
    if (it.sep) { m.append(h('div.ue-menu-sep')); continue; }
    if (it.head) { m.append(h('div.ue-menu-head', { text: it.head })); continue; }
    const chk = typeof it.checked === 'function' ? it.checked() : it.checked;
    const row = h('div.ue-menu-item', { html: `<span class="ue-menu-ic">${chk ? '✓' : it.icon ? icon(it.icon) : ''}</span><span class="ue-menu-l">${it.label ?? ''}</span><span class="ue-menu-k">${it.shortcut ?? ''}</span>${it.sub ? `<span class="ue-menu-sub">${icon('chevron')}</span>` : ''}` });
    if (it.disabled) row.classList.add('off');
    if (it.sub) {
      let child: HTMLElement | null = null;
      row.addEventListener('pointerenter', () => {
        m.querySelectorAll(':scope > .ue-menu').forEach((c) => c.remove());
        child = buildMenu(typeof it.sub === 'function' ? it.sub() : it.sub!);
        child.style.left = `${row.offsetLeft + row.offsetWidth - 2}px`;
        child.style.top = `${row.offsetTop - 4}px`;
        m.append(child);
        fitInView(child);
      });
    } else {
      row.addEventListener('pointerenter', () => m.querySelectorAll(':scope > .ue-menu').forEach((c) => c.remove()));
      row.addEventListener('click', () => { if (it.disabled) return; closeMenus(); it.action?.(); });
    }
    m.append(row);
  }
  return m;
}
function fitInView(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  if (r.right > window.innerWidth - 4) el.style.left = `${parseFloat(el.style.left || '0') - (r.right - window.innerWidth + 8)}px`;
  if (r.bottom > window.innerHeight - 4) el.style.top = `${parseFloat(el.style.top || '0') - (r.bottom - window.innerHeight + 8)}px`;
}

/** Показать меню в точке экрана (контекстное) */
export function popupMenu(x: number, y: number, items: MenuItem[]): void {
  closeMenus();
  const m = buildMenu(items);
  m.classList.add('ue-popup');
  m.style.left = `${x}px`; m.style.top = `${y}px`;
  document.body.append(m);
  openMenu = m;
  fitInView(m);
}

/** Кнопка с выпадающим меню (строка меню, кнопки тулбара) */
export function menuButton(btn: HTMLElement, items: () => MenuItem[]): HTMLElement {
  btn.classList.add('ue-menubtn');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const was = btn.classList.contains('open');
    closeMenus();
    if (was) return;
    const r = btn.getBoundingClientRect();
    popupMenu(r.left, r.bottom + 2, items());
    btn.classList.add('open');
  });
  // меню строки: провести мышью по соседней кнопке, пока меню открыто, — открыть её
  btn.addEventListener('pointerenter', () => {
    if (!openMenu || btn.classList.contains('open') || !btn.parentElement?.querySelector('.ue-menubtn.open')) return;
    btn.click();
  });
  return btn;
}

// ---------- сетка свойств ----------

interface NumOpts { min?: number; max?: number; step?: number; /** Ползунок рядом с полем */ slider?: boolean; unit?: string; digits?: number }

/**
 * Сетка свойств как в панели Details: разделы со сворачиваемыми заголовками, строки «подпись — значение».
 * Каждая строка помнит, как прочитать значение, — refresh() обновляет поля без пересборки (не сбивает фокус).
 */
export class PropGrid {
  readonly el = h('div.ue-props');
  private readonly refreshers: (() => void)[] = [];
  private body: HTMLElement = this.el;
  /** Свёрнутые разделы — по заголовку, переживают пересборку */
  static collapsed = new Set<string>();

  clear(): void { this.el.textContent = ''; this.refreshers.length = 0; this.body = this.el; }

  section(title: string, iconName?: string): this {
    const sec = h('div.ue-sec');
    const head = h('div.ue-sec-h', { html: `${icon('chevron', 'ue-tri')}${iconName ? icon(iconName) : ''}<span>${title}</span>` });
    const body = h('div.ue-sec-b');
    if (PropGrid.collapsed.has(title)) sec.classList.add('shut');
    head.addEventListener('click', () => { sec.classList.toggle('shut'); if (sec.classList.contains('shut')) PropGrid.collapsed.add(title); else PropGrid.collapsed.delete(title); });
    sec.append(head, body);
    this.el.append(sec);
    this.body = body;
    return this;
  }

  private row(label: string, ...ctl: Node[]): HTMLElement {
    const r = h('div.ue-row', {}, h('label.ue-row-l', { text: label, title: label }), h('div.ue-row-v', {}, ...ctl));
    this.body.append(r);
    return r;
  }

  note(text: string): this { this.body.append(h('div.ue-note', { html: text })); return this; }

  num(label: string, get: () => number, set: (v: number) => void, o: NumOpts = {}): this {
    const step = o.step ?? 0.1;
    const digits = o.digits ?? (step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3);
    const inp = h('input.ue-num', { type: 'text', inputmode: 'decimal' });
    const fmt = (v: number) => (Number.isFinite(v) ? +v.toFixed(digits) : 0).toString();
    const clamp = (v: number) => Math.min(o.max ?? Infinity, Math.max(o.min ?? -Infinity, v));
    const commit = () => { const v = parseFloat(inp.value.replace(',', '.')); if (Number.isFinite(v)) set(clamp(v)); this.refresh(); };
    inp.addEventListener('change', commit);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); inp.blur(); } e.stopPropagation(); });
    dragScrub(inp, (dx) => { set(clamp(+(get() + dx * step).toFixed(digits + 1))); this.refresh(); });
    const kids: Node[] = [];
    let sl: HTMLInputElement | null = null;
    if (o.slider && o.min !== undefined && o.max !== undefined) {
      sl = h('input.ue-slider', { type: 'range', min: o.min, max: o.max, step });
      sl.addEventListener('input', () => { set(Number(sl!.value)); this.refresh(); });
      sl.addEventListener('change', () => sl!.blur());
      kids.push(sl);
    }
    kids.push(inp);
    if (o.unit) kids.push(h('span.ue-unit', { text: o.unit }));
    this.row(label, ...kids);
    this.refreshers.push(() => {
      const v = get();
      if (document.activeElement !== inp) inp.value = fmt(v);
      if (sl && document.activeElement !== sl) sl.value = String(v);
    });
    return this;
  }

  /** Три числа X/Y/Z с цветными метками, как Location/Rotation в Unreal */
  vec3(label: string, get: () => [number, number, number], set: (v: [number, number, number]) => void, o: NumOpts = {}): this {
    const step = o.step ?? 0.1;
    const digits = o.digits ?? (step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3);
    const wrap = h('div.ue-vec');
    const inps: HTMLInputElement[] = [];
    ['X', 'Y', 'Z'].forEach((ax, i) => {
      const inp = h('input.ue-num', { type: 'text', inputmode: 'decimal' });
      const put = (v: number) => { const c = get(); c[i] = v; set(c); this.refresh(); };
      inp.addEventListener('change', () => { const v = parseFloat(inp.value.replace(',', '.')); if (Number.isFinite(v)) put(v); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); e.stopPropagation(); });
      const tag = h('span.ue-ax', { class: `ue-ax ax-${ax.toLowerCase()}`, text: ax });
      dragScrub(tag, (dx) => put(+(get()[i] + dx * step).toFixed(digits + 1)));
      wrap.append(h('div.ue-vec-c', {}, tag, inp));
      inps.push(inp);
    });
    this.row(label, wrap);
    this.refreshers.push(() => { const v = get(); inps.forEach((inp, i) => { if (document.activeElement !== inp) inp.value = (+v[i].toFixed(digits)).toString(); }); });
    return this;
  }

  color(label: string, get: () => string, set: (v: string) => void): this {
    const inp = h('input.ue-color', { type: 'color' });
    const hex = h('span.ue-hex');
    inp.addEventListener('input', () => { set(inp.value); hex.textContent = inp.value; });
    this.row(label, inp, hex);
    this.refreshers.push(() => { const v = get(); if (document.activeElement !== inp) inp.value = v; hex.textContent = v; });
    return this;
  }

  bool(label: string, get: () => boolean, set: (v: boolean) => void): this {
    const inp = h('input.ue-check', { type: 'checkbox' });
    inp.addEventListener('change', () => { set(inp.checked); inp.blur(); });
    this.row(label, inp);
    this.refreshers.push(() => { inp.checked = get(); });
    return this;
  }

  select<T extends string>(label: string, options: [T, string][], get: () => T, set: (v: T) => void): this {
    const s = h('select.ue-select');
    for (const [v, t] of options) s.append(h('option', { value: v, text: t }));
    s.addEventListener('change', () => { set(s.value as T); s.blur(); });
    this.row(label, s);
    this.refreshers.push(() => { s.value = get(); });
    return this;
  }

  text(label: string, get: () => string, set: (v: string) => void, readonly = false): this {
    const inp = h('input.ue-text', { type: 'text', spellcheck: 'false', readonly });
    inp.addEventListener('input', () => set(inp.value));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); e.stopPropagation(); });
    this.row(label, inp);
    this.refreshers.push(() => { if (document.activeElement !== inp) inp.value = get(); });
    return this;
  }

  /** Строка только для чтения (тип, счётчики) */
  info(label: string, get: () => string): this {
    const v = h('span.ue-info');
    this.row(label, v);
    this.refreshers.push(() => { v.innerHTML = get(); });
    return this;
  }

  buttons(...btns: [string, () => void, string?][]): this {
    const wrap = h('div.ue-btns');
    for (const [label, fn, ic] of btns) wrap.append(h('button.ue-btn', { html: `${ic ? icon(ic) : ''}<span>${label}</span>`, onclick: (e: Event) => { fn(); (e.currentTarget as HTMLElement).blur(); } }));
    this.body.append(wrap);
    return this;
  }

  /** Произвольный элемент в разделе */
  custom(el: HTMLElement): this { this.body.append(el); return this; }

  refresh(): void { for (const r of this.refreshers) r(); }
}

/** Протянуть мышью по полю, как в Unreal: влево-вправо — меньше-больше */
function dragScrub(el: HTMLElement, onDelta: (dx: number) => void): void {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const isInput = el instanceof HTMLInputElement;
    if (isInput && document.activeElement === el) return;
    let last = e.clientX, moved = 0;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - last; last = ev.clientX; moved += Math.abs(dx);
      if (moved > 3 && dx) { onDelta(dx * (ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1)); document.body.classList.add('ue-scrub'); }
    };
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
      document.body.classList.remove('ue-scrub');
      if (isInput && moved <= 3) { el.focus(); (el as HTMLInputElement).select(); }
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
    if (isInput) e.preventDefault();
  });
}

/**
 * Разделитель между панелями: тянешь — меняется размер соседней панели (CSS-переменная на корне).
 * dir 'x' — вертикальная черта (ширина), 'y' — горизонтальная (высота); sign — в какую сторону растёт панель.
 */
export function splitter(root: HTMLElement, cssVar: string, dir: 'x' | 'y', sign: 1 | -1, min: number, max: number, onChange?: () => void): HTMLElement {
  const el = h('div', { class: `ue-split ue-split-${dir}` });
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const start = dir === 'x' ? e.clientX : e.clientY;
    const v0 = parseFloat(getComputedStyle(root).getPropertyValue(cssVar)) || 0;
    const move = (ev: PointerEvent) => {
      const d = ((dir === 'x' ? ev.clientX : ev.clientY) - start) * sign;
      root.style.setProperty(cssVar, `${Math.min(max, Math.max(min, v0 + d))}px`);
      onChange?.();
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); onChange?.(); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  });
  return el;
}
