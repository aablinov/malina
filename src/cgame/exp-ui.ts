import type * as THREE from 'three';
import type { MapMarker } from '../hud/automap.ts';
import { t } from '../i18n/i18n.ts';
import type { SimEvent } from '../sim/events.ts';
import { ALARM_MAX, type SimExpedition } from '../sim/expedition.ts';
import { PARCEL_TITLE } from '../expedition/parcels.ts';
import '../td/td.css';

/**
 * Expedition HUD (wiki/design-expeditions.md): the objective line with its progress, an arrow to where to go next, the seeds in
 * the bag, the balloon's countdown; banners for the mission's events, markers for the map and the hint by the F key. Reads the
 * rules (src/sim/expedition.ts — the real ones in single player, the mirror in a network battle); changes nothing
 */
export interface ExpUiHooks { banner(html: string, sec?: number): void; toast(s: string): void; heroPos(): THREE.Vector3; goal(title: string, sub: string): void; /** Dusk has fallen: the scene turns to night */ dusk?(): void }

const TITLE = { lairs: 'Burn the lairs', beacons: 'Light the beacons', bush: 'Plant the raspberry bush' } as const;
const USE_TEXT = {
  beacon: 'Light the beacon', plot: 'Plant the raspberry bush', guarded: 'Drive the guards off the plot first', chest: 'Open the Order chest', altar: 'Touch the altar',
  watchtower: 'Climb the watchtower', extract: 'Call the balloon', wait: 'The balloon will come when the objective is done',
} as const;

export class ExpUi {
  readonly el: HTMLElement;
  /** The watchtower was climbed: the whole map's sites are shown */
  revealed = false;
  private readonly sim: SimExpedition;
  private readonly seat: () => number;
  private readonly h: ExpUiHooks;
  private last = '';

  constructor(root: HTMLElement, sim: SimExpedition, seat: () => number, h: ExpUiHooks) {
    this.sim = sim; this.seat = seat; this.h = h;
    this.el = document.createElement('div');
    this.el.className = 'td-hud exp-hud';
    root.appendChild(this.el);
  }

  /** Where the squad should go now: the nearest unfinished step, then the pad */
  private target(): { x: number; z: number; label: string } | null {
    const s = this.sim, hp = this.h.heroPos();
    const near = <P extends { x: number; z: number }>(list: P[]): P | null => list.reduce<P | null>((b, p) => (!b || Math.hypot(p.x - hp.x, p.z - hp.z) < Math.hypot(b.x - hp.x, b.z - hp.z) ? p : b), null);
    if (s.primary || s.extraction.state !== 'idle') return { x: s.extraction.pos.x, z: s.extraction.pos.z, label: t('Balloon') };
    const k = s.spec.objective.kind;
    const p = k === 'lairs' ? near(s.nests.filter((n) => !n.dead).map((n) => n.pos)) : k === 'beacons' ? near(s.beacons.filter((b) => b.state !== 'lit').map((b) => b.pos)) : s.spec.objective.sites[0];
    return p ? { x: p.x, z: p.z, label: t(k === 'lairs' ? 'Lair' : k === 'beacons' ? 'Beacon' : 'Plot') } : null;
  }

  /** The hint by the F key; null — nothing to use here */
  prompt(): string | null { const u = this.sim.usable(this.seat()); return u ? t(USE_TEXT[u]) : null; }

  /** Map markers: objective sites and the pad always; lairs, points of interest and the rest — once explored or from the watchtower */
  markers(): MapMarker[] {
    const s = this.sim, always = this.revealed, out: MapMarker[] = [];
    const prime = s.spec.objective.kind;
    for (const n of s.nests) out.push({ x: n.pos.x, z: n.pos.z, icon: 'axe', dim: n.dead, always: always || prime === 'lairs' });
    for (const b of s.beacons) out.push({ x: b.pos.x, z: b.pos.z, icon: 'spark', dim: b.state === 'lit', always: true });
    if (prime === 'bush') { const p = s.spec.objective.sites[0]; out.push({ x: p.x, z: p.z, icon: 'berry', always: true }); }
    out.push({ x: s.extraction.pos.x, z: s.extraction.pos.z, icon: 'spiral', dim: !s.primary, always: true });
    for (const sd of s.sides) out.push({ x: sd.spec.x, z: sd.spec.z, icon: sd.spec.kind === 'chest' ? 'chest' : sd.spec.kind === 'horns' ? 'horn' : 'totem', dim: sd.done, always });
    for (const q of s.spec.pois) if (!s.isTaken(q.id)) out.push({ x: q.x, z: q.z, icon: q.seed ? 'soul' : 'chest', always });
    for (const g of s.seeds) out.push({ x: g.x, z: g.z, icon: 'soul', always: true });
    return out;
  }

  events(evs: readonly SimEvent[]): void {
    for (const e of evs) {
      switch (e.t) {
        case 'exp.step': if (Number(e.n) < Number(e.of)) this.h.banner(`${t(TITLE[this.sim.spec.objective.kind])}<small>${t('{n} of {total}', { n: Number(e.n), total: Number(e.of) })}</small>`, 2); break;
        case 'exp.primary': this.h.banner(`${t('Objective done')}<small>${t('Get to the pad and call the balloon')}</small>`, 3.5); break;
        case 'exp.raid': this.h.toast(t('A raid is coming!')); break;
        case 'exp.side': if (e.kind === 'watchtower') this.revealed = true; this.h.toast(t('Secondary objective done')); break;
        case 'extract.call': this.h.banner(`${t('The balloon is on its way')}<small>${t('Hold the pad for {n} s', { n: Number(e.sec) })}</small>`, 3); break;
        case 'extract.ready': this.h.banner(`${t('The balloon has landed')}<small>${t('Everyone onto the pad!')}</small>`, 3); break;
        case 'poi.take': if (e.seat === this.seat() && e.seed) this.h.toast(t('Seed found — carry it to the balloon')); break;
        case 'exp.lost': this.h.banner(t(e.why === 'bush' ? 'The bush has withered' : 'The squad has fallen'), 3); break;
        case 'horn.start': this.h.toast(t('A horn-blower! Stop him before he calls')); break;
        case 'horn.cut': this.h.toast(t('The horn is silenced')); break;
        case 'horn.call': this.h.banner(`${t('The horn has sounded')}<small>${t('Reinforcements are coming')}</small>`, 2.5); break;
        case 'exp.alarm': this.h.toast(t('Alarm {n}: the Order grows stronger', { n: Number(e.level) })); break;
        case 'exp.dusk': this.h.dusk?.(); this.h.banner(`${t('Dusk is falling')}<small>${t('The alarm grows twice as fast — time to leave')}</small>`, 4); break;
        case 'hero.totem': this.h.toast(t('A raspberry totem lifts the fallen · {n} left', { n: Number(e.left) })); break;
        case 'hero.raised': if (e.seat === this.seat()) this.h.toast(t('A teammate lifted you')); break;
        default: break;
      }
    }
  }

  update(): void {
    const s = this.sim, k = s.spec.objective.kind, hp = this.h.heroPos();
    this.h.goal(t(s.primary ? 'Leave by balloon' : TITLE[k]), s.primary ? t('Expedition') : t('{n} of {total}', { n: s.done, total: s.goal }));
    const bag = s.carriedOf(this.seat()), pad = s.extraction;
    const lines: string[] = [];
    if (pad.state === 'called') lines.push(`<div class="td-wave">${t('Balloon in')} <span>${Math.ceil(pad.t)}</span></div>`);
    else if (pad.state === 'ready') lines.push(`<div class="td-wave">${t('Boarding')} <span>${Math.ceil(pad.t)}</span></div>`);
    const down = s.downOf(this.seat());
    if (down) lines.push(`<div class="td-alarm">${down.k > 0 ? t('A teammate is lifting you') : s.totems > 0 ? t('Down · a totem in {n} s', { n: Math.ceil(down.left) }) : t('Down · no totems left')}</div>`);
    lines.push(`<div>${t('Totems')}: <span style="color:#ff8fb0">${s.totems}</span> · ${t('Alarm')}: <span style="color:#ffd15c">${'▮'.repeat(s.alarmLevel)}${'▯'.repeat(ALARM_MAX - s.alarmLevel)}</span>${s.dusk ? ` · ${t('dusk')}` : ''}</div>`);
    const kinds = s.parcels.loadout(this.seat()), cds = s.parcels.cooldowns(this.seat());
    lines.push(`<div>${kinds.map((k, i) => `<kbd>${'ZXC'[i]}</kbd> ${PARCEL_TITLE[k]}${cds[i] > 0 ? ` <span style="color:#b9c4cc">${Math.ceil(cds[i])}</span>` : ''}`).join(' · ')}</div>`);
    const tg = this.target();
    if (tg && s.state === 'play') {
      const dx = tg.x - hp.x, dz = tg.z - hp.z, d = Math.hypot(dx, dz);
      // the camera looks from (+1, ·, +1): screen right is (1, −1), up is (−1, −1)
      const deg = Math.round((Math.atan2(dx - dz, -dx - dz) * 180) / Math.PI);
      if (d > 4) lines.push(`<div>${tg.label} <i style="display:inline-block;font-style:normal;transform:rotate(${deg}deg)">↑</i> ${t('{n} m', { n: Math.round(d) })}</div>`);
    }
    if (bag.common + bag.rare + bag.golden > 0) lines.push(`<div>${t('Seeds')}: <span style="color:#8fd45a">${bag.common}</span> · <span style="color:#5ab8ff">${bag.rare}</span> · <span style="color:#ffcc3a">${bag.golden}</span></div>`);
    const html = lines.join('');
    if (html !== this.last) { this.last = html; this.el.innerHTML = html; }
  }

  /** The line of the result screen */
  summary(): string {
    const s = this.sim, b = s.bankedOf(this.seat());
    return t('{n} of {total} done, {fallen} enemies slain · seeds brought out: {c} / {r} / {g}', { n: s.done, total: s.goal, fallen: s.fallen, c: b.common, r: b.rare, g: b.golden });
  }

  dispose(): void { this.el.remove(); }
}
