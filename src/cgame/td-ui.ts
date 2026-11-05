import type * as THREE from 'three';
import type { MapMarker } from '../hud/automap.ts';
import { t } from '../i18n/i18n.ts';
import { MOBS } from '../mobs/roster.ts';
import type { SimEvent } from '../sim/events.ts';
import { isChief, type SimPad, type SimTd } from '../sim/td.ts';
import type { SimTower } from '../sim/tower.ts';
import type { SimWall } from '../sim/wall.ts';
import { voice } from '../spell-audio.ts';
import { menuKey, SELL_BACK, TOWERS, type TowerKind } from '../td/towers.ts';
import '../td/td.css';

/** Wall bar colour in the HUD */
const wallBarColor = (k: number): string => k > 0.5 ? '#9ad87a' : k > 0.25 ? '#ffd25a' : '#ff6a5a';

/**
 * Pad menu and Bush Defence HUD (wiki/design-tower-defence.md) — the DOM part of the view: reads SimTd, sends player actions
 * as `sim.command(seat, …)` commands. Wave banners, tower alarms and hints come from simulation events (`events`)
 * and the `sim.onToast` / `sim.onAlarm` hooks. Models and sparks belong to src/cgame/views/td-view.ts and src/cgame/effects.ts
 */

export interface TdUiHooks {
  toast(s: string): void;
  banner(html: string, sec?: number): void;
  quiet(): boolean;
  heroPos(): THREE.Vector3;
  /** Before and after a command: the treasury mirror (profile raspberries) and the simulation treasury agree */
  sync?(): void;
  /** Living enemies on the map (the HUD line during a wave) */
  alive?(): number;
}

/** Tower in trouble: what is wrong and how long to keep showing the signal, s */
export interface Alarm { why: 'hurt' | 'frozen' | 'ruin'; t: number }
const ALARM_TEXT: Record<Alarm['why'], string> = { hurt: t('Tower under attack'), frozen: t('Tower frozen'), ruin: t('Tower destroyed') };
/** Tower hunters are marked in the next-wave card */
const HUNTERS = new Set(['gnawer', 'frostling']);

export class TdUi {
  readonly menuEl: HTMLDivElement;
  readonly hudEl: HTMLDivElement;
  /** Pad whose menu is open */
  menuPad: SimPad | null = null;
  /** Towers in trouble: a signal in the HUD and on the map */
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

  /** Prompt at the bottom: what F does at this pad */
  prompt(p: SimPad): string { return p.tower ? p.tower.ruined ? t('Ruins: {title} · repair', { title: p.tower.title }) : t('Tower: {title}', { title: p.tower.title }) : t('Build a tower'); }
  wallPrompt(w: SimWall): string { return t(w.dead ? 'Rebuild: {title} · {cost} raspberries' : 'Repair: {title} · {cost} raspberries', { title: t(w.title).toLowerCase(), cost: this.sim.repairCost(w) }); }

  // ---------- pad menu ----------
  openMenu(p: SimPad): void { this.menuPad = p; this.menuHtml = ''; this.menuEl.classList.remove('hidden'); this.renderMenu(); }
  closeMenu(): void { this.menuPad = null; this.menuEl.classList.add('hidden'); }

  /** Key while the menu is open: digits — choose, Esc — close. true — handled */
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

  /** Menu action as a simulation command; build and sell close the menu */
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
      html = `<div class="td-head">${t('Pad · raspberries {n}', { n: berries })}</div>` + this.sim.kinds.map((k: TowerKind, i) => {
        const d = TOWERS[k], ok = berries >= d.cost;
        return `<button class="td-card${ok ? '' : ' off'}" data-act="build:${k}"><kbd>${menuKey(i)}</kbd><i style="background:${d.color}"></i><b>${d.title}</b><small>${d.hint} · ${t('{n} m', { n: d.range })}</small><em class="${ok ? 'ok' : ''}">${t('{n} raspberries', { n: d.cost })}</em></button>`;
      }).join('');
    } else if (p.tower.ruined) {
      const tw = p.tower, cost = tw.repairCost, ok = berries >= cost;
      html = `<div class="td-head">${t('Ruins: {title} · raspberries {n}', { title: tw.title, n: berries })}</div>`
        + `<button class="td-card${ok ? '' : ' off'}" data-act="repair"><kbd>1</kbd><i style="background:${tw.def.color}"></i><b>${t('Repair')}</b><small>${t('fires again, same level')}</small><em class="${ok ? 'ok' : ''}">${t('{n} raspberries', { n: cost })}</em></button>`;
    } else {
      const tw = p.tower, next = tw.nextCost, back = Math.round(tw.spent * SELL_BACK), ok = next !== null && berries >= next;
      html = `<div class="td-head">${t('{title} · damage {dmg} · {range} m · raspberries {n}', { title: tw.title, dmg: tw.dmg, range: tw.range, n: berries })}</div>`
        + `<button class="td-card${next === null || !ok ? ' off' : ''}" data-act="upgrade"><kbd>1</kbd><i style="background:${tw.def.color}"></i><b>${next === null ? t('Maxed out') : t('Upgrade to {lvl}', { lvl: ['I', 'II', 'III'][tw.level] })}</b><small>${next === null ? t('it does not get better') : t('more damage and range')}</small><em class="${ok ? 'ok' : ''}">${next === null ? '—' : t('{n} raspberries', { n: next })}</em></button>`
        + `<button class="td-card" data-act="sell"><kbd>2</kbd><i style="background:#9ad87a"></i><b>${t('Sell')}</b><small>${t('the pad is freed')}</small><em class="sell">+${t('{n} raspberries', { n: back })}</em></button>`;
    }
    if (html !== this.menuHtml) { this.menuHtml = html; this.menuEl.innerHTML = html; }
  }

  // ---------- alarms ----------
  /** A tower is being gnawed, frozen or broken: signal the player */
  private alarm(tw: SimTower, why: Alarm['why']): void {
    if (why === 'ruin') this.h.toast(t('Tower destroyed: {title} — F at the ruins to repair', { title: tw.title }));
    const was = this.alarms.get(tw);
    this.alarms.set(tw, { why: was?.why === 'ruin' && why !== 'ruin' ? 'ruin' : why, t: why === 'ruin' ? 8 : 4 });
    // the alarm beep — no more than once per 2 s, and only when the tower is far from the hero
    const hp = this.h.heroPos();
    if (this.alarmBeep <= 0 && Math.hypot(tw.pos.x - hp.x, tw.pos.z - hp.z) > 8 && !this.h.quiet()) {
      this.alarmBeep = 2;
      voice({ type: 'square', f: 880, f1: 660, dur: 0.12, vol: 0.04, lp: 2500 });
      voice({ type: 'square', f: 880, f1: 660, dur: 0.12, vol: 0.04, lp: 2500, delay: 0.18 });
    }
  }

  /** Markers of towers in trouble for the minimap and the map (src/hud/automap.ts) */
  get alarmMarkers(): MapMarker[] {
    return [...this.alarms].map(([t, a]) => ({ x: t.pos.x, z: t.pos.z, icon: a.why === 'frozen' ? 'icerain' : 'axe', always: true }));
  }

  /** Alarm line in the HUD: the freshest trouble, the arrow shows where to run (screen direction of the camera) */
  private alarmLine(): string {
    let best: [SimTower, Alarm] | null = null;
    for (const e of this.alarms) if (!best || e[1].t > best[1].t) best = e;
    if (!best) return '';
    const [tw, a] = best, hp = this.h.heroPos(), dx = tw.pos.x - hp.x, dz = tw.pos.z - hp.z, d = Math.hypot(dx, dz);
    // the camera looks from (+1, ·, +1): screen right is (1, −1), up is (−1, −1)
    const deg = Math.round((Math.atan2(dx - dz, -dx - dz) * 180) / Math.PI);
    return `<div class="td-alarm ${a.why}">${ALARM_TEXT[a.why]}: ${tw.title} <i style="transform:rotate(${deg}deg)">↑</i> ${t('{n} m', { n: Math.round(d) })}</div>`;
  }

  // ---------- events ----------
  /** Banners from world step events (wave started, beaten, victory, defeat, mini-boss, breach) */
  events(evs: readonly SimEvent[]): void {
    const sim = this.sim, rest = sim.spec.rest ?? 20;
    for (const e of evs) {
      switch (e.t) {
        case 'wave.start': this.h.banner(`${t('Wave {n} of {total}', { n: e.wave as number, total: e.of as number })}<small>${t((e.title as string) || 'The Order marches on the bush')}</small>`, 2.5); break;
        case 'wave.won': this.h.banner(`${t('Wave {n} beaten', { n: e.wave as number })}<small>${t('+{n} raspberries · next in {s} s · G — now', { n: e.n as number, s: rest })}</small>`, 3); break;
        case 'wave.early': if (e.seat === this.seat) this.h.toast(t('Wave ahead of time: +{n} raspberries', { n: e.n as number })); break;
        case 'td.won': this.closeMenu(); this.h.banner(`${t('The bush is saved!')}<small>${t('All waves of the Order are broken · N — play again')}</small>`, 6); break;
        case 'td.lost': this.closeMenu(); this.h.banner(`${t('The bush withered')}<small>${t('The Order reached the raspberries · N — try again')}</small>`, 5); break;
        case 'td.reset': this.closeMenu(); this.alarms.clear(); break;
        case 'chief': this.h.banner(`${t('A mini-boss is coming!')}<small>${t(String(e.title))} · ${t(String(e.lane)).toLowerCase()}</small>`, 3); break;
        case 'wall.break': this.h.banner(`${e.kind === 'gate' ? t('Gate broken') : t('Wall breached')}!<small>${t(String(e.title))} · ${t('enemies are coming in · F at the wall — repair')}</small>`, 3); break;
      }
    }
  }

  // ---------- frame ----------
  update(dt: number): void {
    this.alarmBeep -= dt;
    const sim = this.sim;
    for (const [t, a] of this.alarms) {
      a.t -= dt;
      // the freeze ended, the ruins were repaired or sold — the signal is cleared
      if (a.t <= 0 || !sim.towers.includes(t) || (a.why === 'frozen' && t.frozen <= 0) || (a.why === 'ruin' && !t.ruined)) this.alarms.delete(t);
    }
    if (this.menuPad) {
      // walked away from the pad — the menu closes
      const hp = this.h.heroPos(), p = this.menuPad.pos;
      if (Math.hypot(hp.x - p.x, hp.z - p.z) > 3.2) this.closeMenu();
      else this.renderMenu();
    }
    this.renderHud();
  }

  /** Next-wave card: who and how many, tower hunters and the mini-boss marked separately */
  private wavePreview(): string {
    const sim = this.sim, w = sim.waves[sim.wave];
    if (!w) return '';
    const chip = (k: string, n: number): string => {
      const cls = isChief(k) ? 'chief' : HUNTERS.has(k) ? 'hunter' : '';
      const mark = isChief(k) ? '♛ ' : k === 'frostling' ? '❄ ' : k === 'gnawer' ? '⚠ ' : '';
      return `<span class="${cls}">${mark}${MOBS[k]?.title ?? k}${isChief(k) ? '' : ` ×${n}`}</span>`;
    };
    return `<div class="td-preview"><b>${w.title ? t(w.title) : t('Wave {n}', { n: sim.wave + 1 })}:</b> ${sim.preview().map(({ kind, n }) => chip(kind, n)).join('')}</div>`;
  }

  renderHud(): void {
    const sim = this.sim, b = sim.bush, k = Math.max(0, b.hp / b.maxHp), n = sim.waves.length;
    const head = sim.state === 'lost' ? t('The bush withered') : sim.state === 'won' ? t('The bush is saved!') : n ? `${t('Wave {n} of {total}', { n: `<span>${sim.wave}</span>`, total: n })}${sim.players > 1 ? ` · ${t('players {n}', { n: sim.players })}` : ''}` : t('Bush Defence · towers {n} of {total}', { n: `<span>${sim.towers.length}</span>`, total: sim.pads.length });
    const from = sim.nextLanes?.map((l) => t(l.title).toLowerCase()).join(', ') ?? '';
    const running = sim.waveRunning;
    const sub = sim.state !== 'play' || !n ? '' : running ? t('enemies on the map {n}', { n: this.alive() }) : sim.wave >= n ? '' : t('next in {s} s — {from} · <kbd>G</kbd> now (+{bonus})', { s: Math.ceil(sim.next), from, bonus: sim.earlyBonus });
    const walls = sim.walls.length ? `<div class="td-walls">${sim.walls.map((w) => `<span class="${w.dead ? 'dead' : ''}" title="${t(w.title)}"><b>${w.kind === 'gate' ? '⌂' : t(w.title).slice(0, 1)}</b><i style="width:${(w.k * 100).toFixed(0)}%;background:${wallBarColor(w.k)}"></i></span>`).join('')}</div>` : '';
    const preview = sim.state === 'play' && !running ? this.wavePreview() : '';
    const html = `<div class="td-wave">${head}</div>${sub ? `<div class="td-next">${sub}</div>` : ''}${preview}${this.alarmLine()}<div class="td-bush"><i style="width:${(k * 100).toFixed(1)}%"></i></div><div class="td-bush-t">${t('raspberry bush {hp} / {max}', { hp: Math.ceil(b.hp), max: b.maxHp })}</div>${walls}`;
    if (html !== this.hudHtml) { this.hudHtml = html; this.hudEl.innerHTML = html; }
    this.hudEl.classList.toggle('lost', sim.state === 'lost');
    this.hudEl.classList.toggle('won', sim.state === 'won');
  }

  private alive(): number { return this.h.alive?.() ?? 0; }
}
