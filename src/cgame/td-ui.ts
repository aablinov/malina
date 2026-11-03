import type * as THREE from 'three';
import type { MapMarker } from '../hud/automap';
import { MOBS } from '../mobs/roster';
import type { SimEvent } from '../sim/events.ts';
import { isChief, type SimPad, type SimTd } from '../sim/td.ts';
import type { SimTower } from '../sim/tower.ts';
import type { SimWall } from '../sim/wall.ts';
import { voice } from '../spell-audio';
import { menuKey, SELL_BACK, TOWERS, type TowerKind } from '../td/towers';
import '../td/td.css';

/** Цвет полосы стены в HUD */
const wallBarColor = (k: number): string => k > 0.5 ? '#9ad87a' : k > 0.25 ? '#ffd25a' : '#ff6a5a';

/**
 * Меню площадки и HUD «Обороны куста» (wiki/design-tower-defence.md) — DOM-часть вида: читает SimTd, действия игрока
 * шлёт командами `sim.command(seat, …)`. Баннеры волн, тревоги башен и подсказки — по событиям симуляции (`events`)
 * и крючкам `sim.onToast` / `sim.onAlarm`. Модели и искры — у src/cgame/views/td-view.ts и src/cgame/effects.ts
 */

export interface TdUiHooks {
  toast(s: string): void;
  banner(html: string, sec?: number): void;
  quiet(): boolean;
  heroPos(): THREE.Vector3;
  /** Перед командой и после: зеркало казны (малина профиля) и казна симуляции сходятся */
  sync?(): void;
  /** Живых врагов на карте (строка HUD во время волны) */
  alive?(): number;
}

/** Башня в беде: что с ней и сколько ещё показывать сигнал, с */
export interface Alarm { why: 'hurt' | 'frozen' | 'ruin'; t: number }
const ALARM_TEXT: Record<Alarm['why'], string> = { hurt: 'Башню грызут', frozen: 'Башню заморозили', ruin: 'Башня разрушена' };
/** Охотники на башни — в карточке следующей волны с пометкой */
const HUNTERS = new Set(['gnawer', 'frostling']);

export class TdUi {
  readonly menuEl: HTMLDivElement;
  readonly hudEl: HTMLDivElement;
  /** Площадка, чьё меню открыто */
  menuPad: SimPad | null = null;
  /** Башни в беде: сигнал в HUD и на карте */
  readonly alarms = new Map<SimTower, Alarm>();
  private alarmBeep = 0;
  private menuHtml = '';
  private hudHtml = '';
  private readonly sim: SimTd;
  private readonly seat: number;
  private readonly h: TdUiHooks;

  constructor(parent: HTMLElement, sim: SimTd, seat: number, h: TdUiHooks) {
    this.sim = sim;
    this.seat = seat;
    this.h = h;
    this.menuEl = document.createElement('div');
    this.menuEl.className = 'td-menu hidden';
    this.menuEl.addEventListener('mousedown', (e) => e.stopPropagation());
    this.menuEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (b) this.act(b.dataset.act!);
    });
    parent.appendChild(this.menuEl);
    this.hudEl = document.createElement('div');
    this.hudEl.className = 'td-hud';
    parent.appendChild(this.hudEl);
    sim.onToast = (s, text) => { if (s === this.seat) h.toast(text); };
    sim.onAlarm = (t, why) => this.alarm(t, why);
  }

  dispose(): void {
    this.menuEl.remove();
    this.hudEl.remove();
    if (this.sim.onToast) this.sim.onToast = null;
    if (this.sim.onAlarm) this.sim.onAlarm = null;
  }

  get berries(): number { return this.sim.berries(this.seat); }
  get menuOpen(): boolean { return this.menuPad !== null; }

  /** Подсказка внизу: что сделает F у этой площадки */
  prompt(p: SimPad): string { return p.tower ? p.tower.ruined ? `Руины: ${p.tower.title} · починить` : `Башня: ${p.tower.title}` : 'Построить башню'; }
  wallPrompt(w: SimWall): string { return `${w.dead ? 'Отстроить' : 'Починить'}: ${w.title.toLowerCase()} · ${this.sim.repairCost(w)} малины`; }

  // ---------- меню площадки ----------
  openMenu(p: SimPad): void { this.menuPad = p; this.menuHtml = ''; this.menuEl.classList.remove('hidden'); this.renderMenu(); }
  closeMenu(): void { this.menuPad = null; this.menuEl.classList.add('hidden'); }

  /** Клавиша при открытом меню: цифры — выбор, Esc — закрыть. true — обработана */
  key(e: KeyboardEvent): boolean {
    const p = this.menuPad;
    if (!p) return false;
    if (e.code === 'Escape' || e.code === 'KeyF') { this.closeMenu(); return true; }
    if (!e.code.startsWith('Digit')) return false;
    const n = e.code.slice(5);
    if (p.tower?.ruined) { if (n === '1') this.act('repair'); return true; }
    if (p.tower) { if (n === '1') this.act('upgrade'); else if (n === '2') this.act('sell'); return true; }
    const kind = this.sim.kinds.find((_, i) => menuKey(i) === n);
    if (kind) this.act(`build:${kind}`);
    return true;
  }

  /** Действие из меню — командой симуляции; постройка и продажа закрывают меню */
  act(a: string): void {
    const p = this.menuPad;
    if (!p) return;
    if (a === 'close') { this.closeMenu(); return; }
    this.h.sync?.();
    const ok = this.sim.command(this.seat, { t: 'td', a, pad: p.index });
    this.h.sync?.();
    if (ok && (a.startsWith('build:') || a === 'sell')) this.closeMenu();
    if (this.menuPad) this.renderMenu();
  }

  renderMenu(): void {
    const p = this.menuPad;
    if (!p) return;
    const berries = this.berries;
    let html: string;
    if (!p.tower) {
      html = `<div class="td-head">Площадка · малина ${berries}</div>` + this.sim.kinds.map((k: TowerKind, i) => {
        const d = TOWERS[k], ok = berries >= d.cost;
        return `<button class="td-card${ok ? '' : ' off'}" data-act="build:${k}"><kbd>${menuKey(i)}</kbd><i style="background:${d.color}"></i><b>${d.title}</b><small>${d.hint} · ${d.range} м</small><em class="${ok ? 'ok' : ''}">${d.cost} малины</em></button>`;
      }).join('');
    } else if (p.tower.ruined) {
      const t = p.tower, cost = t.repairCost, ok = berries >= cost;
      html = `<div class="td-head">Руины: ${t.title} · малина ${berries}</div>`
        + `<button class="td-card${ok ? '' : ' off'}" data-act="repair"><kbd>1</kbd><i style="background:${t.def.color}"></i><b>Починить</b><small>снова стреляет, уровень прежний</small><em class="${ok ? 'ok' : ''}">${cost} малины</em></button>`;
    } else {
      const t = p.tower, next = t.nextCost, back = Math.round(t.spent * SELL_BACK), ok = next !== null && berries >= next;
      html = `<div class="td-head">${t.title} · урон ${t.dmg} · ${t.range} м · малина ${berries}</div>`
        + `<button class="td-card${next === null || !ok ? ' off' : ''}" data-act="upgrade"><kbd>1</kbd><i style="background:${t.def.color}"></i><b>${next === null ? 'Предел' : `Улучшить до ${['I', 'II', 'III'][t.level]}`}</b><small>${next === null ? 'лучше не бывает' : 'урон и дальность выше'}</small><em class="${ok ? 'ok' : ''}">${next === null ? '—' : `${next} малины`}</em></button>`
        + `<button class="td-card" data-act="sell"><kbd>2</kbd><i style="background:#9ad87a"></i><b>Продать</b><small>площадка освободится</small><em class="sell">+${back} малины</em></button>`;
    }
    if (html !== this.menuHtml) { this.menuHtml = html; this.menuEl.innerHTML = html; }
  }

  // ---------- тревоги ----------
  /** Башню грызут, заморозили или сломали: сигнал игроку */
  private alarm(t: SimTower, why: Alarm['why']): void {
    if (why === 'ruin') this.h.toast(`Башня разрушена: ${t.title} — F у руин, чтобы починить`);
    const was = this.alarms.get(t);
    this.alarms.set(t, { why: was?.why === 'ruin' && why !== 'ruin' ? 'ruin' : why, t: why === 'ruin' ? 8 : 4 });
    // тревожный сигнал — не чаще раза в 2 с, и только когда башня далеко от героя
    const hp = this.h.heroPos();
    if (this.alarmBeep <= 0 && Math.hypot(t.pos.x - hp.x, t.pos.z - hp.z) > 8 && !this.h.quiet()) {
      this.alarmBeep = 2;
      voice({ type: 'square', f: 880, f1: 660, dur: 0.12, vol: 0.04, lp: 2500 });
      voice({ type: 'square', f: 880, f1: 660, dur: 0.12, vol: 0.04, lp: 2500, delay: 0.18 });
    }
  }

  /** Метки башен в беде для мини-карты и карты (src/hud/automap.ts) */
  get alarmMarkers(): MapMarker[] {
    return [...this.alarms].map(([t, a]) => ({ x: t.pos.x, z: t.pos.z, icon: a.why === 'frozen' ? 'icerain' : 'axe', always: true }));
  }

  /** Строка тревоги в HUD: самая свежая беда, стрелка — куда бежать (экранное направление камеры) */
  private alarmLine(): string {
    let best: [SimTower, Alarm] | null = null;
    for (const e of this.alarms) if (!best || e[1].t > best[1].t) best = e;
    if (!best) return '';
    const [t, a] = best, hp = this.h.heroPos(), dx = t.pos.x - hp.x, dz = t.pos.z - hp.z, d = Math.hypot(dx, dz);
    // камера смотрит из (+1, ·, +1): вправо на экране — (1, −1), вверх — (−1, −1)
    const deg = Math.round((Math.atan2(dx - dz, -dx - dz) * 180) / Math.PI);
    return `<div class="td-alarm ${a.why}">${ALARM_TEXT[a.why]}: ${t.title} <i style="transform:rotate(${deg}deg)">↑</i> ${Math.round(d)} м</div>`;
  }

  // ---------- события ----------
  /** Баннеры по событиям шага мира (волна пошла, отбита, победа, поражение, мини-босс, пролом) */
  events(evs: readonly SimEvent[]): void {
    const sim = this.sim, rest = sim.spec.rest ?? 20;
    for (const e of evs) {
      switch (e.t) {
        case 'wave.start': this.h.banner(`Волна ${e.wave} из ${e.of}<small>${(e.title as string) || 'Орден идёт к кусту'}</small>`, 2.5); break;
        case 'wave.won': this.h.banner(`Волна ${e.wave} отбита<small>+${e.n} малины · следующая через ${rest} с · G — сейчас</small>`, 3); break;
        case 'wave.early': if (e.seat === this.seat) this.h.toast(`Волна раньше срока: +${e.n} малины`); break;
        case 'td.won': this.closeMenu(); this.h.banner('Куст отбит!<small>Все волны Ордена разбиты · N — сыграть снова</small>', 6); break;
        case 'td.lost': this.closeMenu(); this.h.banner('Куст засох<small>Орден добрался до малины · N — попробовать снова</small>', 5); break;
        case 'td.reset': this.closeMenu(); this.alarms.clear(); break;
        case 'chief': this.h.banner(`Идёт мини-босс!<small>${e.title} · ${String(e.lane).toLowerCase()}</small>`, 3); break;
        case 'wall.break': this.h.banner(`${e.kind === 'gate' ? 'Ворота разбиты' : 'Стена проломлена'}!<small>${e.title} · враги идут внутрь · F у стены — починить</small>`, 3); break;
      }
    }
  }

  // ---------- кадр ----------
  update(dt: number): void {
    this.alarmBeep -= dt;
    const sim = this.sim;
    for (const [t, a] of this.alarms) {
      a.t -= dt;
      // заморозка кончилась, руины починили или продали — сигнал снят
      if (a.t <= 0 || !sim.towers.includes(t) || (a.why === 'frozen' && t.frozen <= 0) || (a.why === 'ruin' && !t.ruined)) this.alarms.delete(t);
    }
    if (this.menuPad) {
      // ушёл от площадки — меню закрывается
      const hp = this.h.heroPos(), p = this.menuPad.pos;
      if (Math.hypot(hp.x - p.x, hp.z - p.z) > 3.2) this.closeMenu();
      else this.renderMenu();
    }
    this.renderHud();
  }

  /** Карточка следующей волны: кто и сколько, охотники на башни и мини-босс — отдельно */
  private wavePreview(): string {
    const sim = this.sim, w = sim.waves[sim.wave];
    if (!w) return '';
    const chip = (k: string, n: number): string => {
      const cls = isChief(k) ? 'chief' : HUNTERS.has(k) ? 'hunter' : '';
      const mark = isChief(k) ? '♛ ' : k === 'frostling' ? '❄ ' : k === 'gnawer' ? '⚠ ' : '';
      return `<span class="${cls}">${mark}${MOBS[k]?.title ?? k}${isChief(k) ? '' : ` ×${n}`}</span>`;
    };
    return `<div class="td-preview"><b>${w.title ?? `Волна ${sim.wave + 1}`}:</b> ${sim.preview().map(({ kind, n }) => chip(kind, n)).join('')}</div>`;
  }

  renderHud(): void {
    const sim = this.sim, b = sim.bush, k = Math.max(0, b.hp / b.maxHp), n = sim.waves.length;
    const head = sim.state === 'lost' ? 'Куст засох' : sim.state === 'won' ? 'Куст отбит!' : n ? `Волна <span>${sim.wave}</span> из ${n}${sim.players > 1 ? ` · игроков ${sim.players}` : ''}` : `Оборона куста · башен <span>${sim.towers.length}</span> из ${sim.pads.length}`;
    const from = sim.nextLanes?.map((l) => l.title.toLowerCase()).join(', ') ?? '';
    const running = sim.waveRunning;
    const sub = sim.state !== 'play' || !n ? '' : running ? `врагов на карте ${this.alive()}` : sim.wave >= n ? '' : `следующая через ${Math.ceil(sim.next)} с — ${from} · <kbd>G</kbd> сейчас (+${sim.earlyBonus})`;
    const walls = sim.walls.length ? `<div class="td-walls">${sim.walls.map((w) => `<span class="${w.dead ? 'dead' : ''}" title="${w.title}"><b>${w.kind === 'gate' ? '⌂' : w.title.slice(0, 1)}</b><i style="width:${(w.k * 100).toFixed(0)}%;background:${wallBarColor(w.k)}"></i></span>`).join('')}</div>` : '';
    const preview = sim.state === 'play' && !running ? this.wavePreview() : '';
    const html = `<div class="td-wave">${head}</div>${sub ? `<div class="td-next">${sub}</div>` : ''}${preview}${this.alarmLine()}<div class="td-bush"><i style="width:${(k * 100).toFixed(1)}%"></i></div><div class="td-bush-t">куст малины ${Math.ceil(b.hp)} / ${b.maxHp}</div>${walls}`;
    if (html !== this.hudHtml) { this.hudHtml = html; this.hudEl.innerHTML = html; }
    this.hudEl.classList.toggle('lost', sim.state === 'lost');
    this.hudEl.classList.toggle('won', sim.state === 'won');
  }

  private alive(): number { return this.h.alive?.() ?? 0; }
}
