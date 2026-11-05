import { t } from '../i18n/i18n.ts';
import { iconImg, iconURL } from '../icons.ts';
import { itemDef, MAX_SOULS, xpToNext, type Profile } from '../items.ts';
import { AutoMap, type MapMarker, type MapView } from './automap.ts';
import './hud.css';

/**
 * HUD like in Minecraft Dungeons (wiki/design-inventory.md): a dark bar at the bottom centre —
 * enchantment points, inventory (I), three artifacts (1, 2, 3) with the souls bar under them, a big health heart
 * with lives, potion (E), map (M), dodge roll (Space), arrows in a hexagon (RMB), raspberries on the right; under the right
 * half — the experience bar with the level. Top left — active effects, top right — the goal and the mini-map.
 * Map (src/hud/automap.ts): mini-map in the corner, Tab — translucent over the game (like Diablo II), M — full (like MCD).
 * Display only: the numbers come from the profile (src/items.ts) and from the scene (HudState) every frame.
 */

export interface HudBuff { icon: string; name: string; /** Remaining, s */ t?: number; count?: number; color?: string }

export interface HudState {
  hp: number;
  maxHp: number;
  lives: number;
  /** Cooldowns: remaining, s, and full duration */
  potion: [number, number];
  roll: [number, number];
  artifacts: [number, number][];
  /** The artifact is active now (the totem stands, the boots run) */
  active: boolean[];
  buffs: HudBuff[];
  /** Weapon art (Q): meter 0..1, title, temper colour, weapon icon; active — running now */
  spec?: { title: string; meter: number; color: string; icon: string; active: boolean };
  /** Aura: meter 0..1, flare remaining, s; null — the slot is empty */
  aura?: { icon: string; title: string; meter: number; flare: number; color: string } | null;
}

const cdText = (t: number): string => (t <= 0 ? '' : t < 1 ? t.toFixed(1) : String(Math.ceil(t)));

export class Hud {
  readonly el: HTMLDivElement;
  private readonly cache = new Map<string, string>();
  private mapEl: HTMLDivElement;
  private automap: AutoMap | null = null;
  /** Map over the game (Tab) */
  overlay = false;
  private bannerT = 0;
  /** Raspberries on the previous frame — so the counter bumps when some were added */
  private berriesShown = Infinity;
  onInventory?: () => void;
  onMap?: () => void;
  onArtifact?: (i: number) => void;
  onPotion?: () => void;
  onAura?: () => void;
  onSpecial?: () => void;

  private readonly profile: Profile;
  constructor(parent: HTMLElement, profile: Profile) { this.profile = profile;
    const el = document.createElement('div');
    el.className = 'hud';
    const slot = (cls: string, key: string, inner = ''): string =>
      `<div class="hud-slot ${cls}">${inner}<div class="hud-cd"></div><span class="hud-cdn"></span><kbd>${key}</kbd></div>`;
    el.innerHTML = `
      <div class="hud-buffs" data-id="buffs"></div>
      <div class="hud-goal"><b data-id="goal"></b><i data-id="goalSub"></i></div>
      <div class="hud-banner" data-id="banner"></div>
      <div class="hud-bar">
        <div class="hud-plate"></div>
        <div class="hud-points" title="${t('Enchantment points')}">${iconImg('spiral')}<b data-id="points">0</b></div>
        ${slot('hud-inv', 'I', iconImg('chest')).replace('class="hud-slot', `data-act="inv" title="${t('Inventory (I)')}" class="hud-slot`)}
        <div class="hud-arts">
          <div class="hud-artrow">${[0, 1, 2].map((i) => slot(`hud-art`, String(i + 1), '<img class="px hud-ico" alt="" draggable="false"><span class="hud-plus">+</span>').replace('class="hud-slot', `data-act="art${i}" class="hud-slot`)).join('')}${slot('hud-aura', 'R', '<div class="hud-aurafill"></div><img class="px hud-ico" alt="" draggable="false"><span class="hud-plus">+</span>').replace('class="hud-slot', 'data-act="aura" class="hud-slot')}</div>
          <div class="hud-souls" title="${t('Souls')}">${iconImg('soul')}<div class="hud-track"><div class="hud-fill" data-id="souls"></div></div></div>
        </div>
        <div class="hud-heart" title="${t('Health')}">
          <div class="hud-heart-frame"><div class="hud-heart-in">
            <div class="hud-heart-icon"><img class="px hud-heart-bg" src="${iconURL('heart')}" alt="">
            <div class="hud-heart-clip" data-id="hpClip"><img class="px" src="${iconURL('heart')}" alt=""></div></div>
          </div></div>
          <div class="hud-lives"><b data-id="lives">3</b>${iconImg('heart')}</div>
          <div class="hud-hpn" data-id="hpN"></div>
        </div>
        <div class="hud-right">
          <div class="hud-row">
            ${slot('hud-potion', 'E', iconImg('potion')).replace('class="hud-slot', `data-act="potion" title="${t('Health potion (E)')}" class="hud-slot`)}
            ${slot('hud-map', 'M', iconImg('map')).replace('class="hud-slot', `data-act="map" title="${t('Map (M)')}" class="hud-slot`)}
            <div class="hud-slot hud-spec" data-act="spec" title="${t('Weapon art (Q)')}"><div class="hud-aurafill"></div><img class="px hud-ico" alt="" draggable="false"><kbd>Q</kbd></div>
            <div class="hud-roll" title="${t('Dodge roll (Space)')}">${iconImg('roll')}<div class="hud-cd"></div><kbd>␣</kbd></div>
            <div class="hud-ammo" title="${t('Arrows: RMB — shoot')}"><b data-id="arrows">0</b><div class="hud-hex"><div class="hud-hex-in">${iconImg('arrows')}</div></div>${iconImg('mouse', 'hud-mouse')}</div>
          </div>
          <div class="hud-xp" title="${t('Experience')}"><span data-id="lv">LV 1</span><div class="hud-track"><div class="hud-fill" data-id="xp"></div></div></div>
        </div>
        <div class="hud-berries" title="${t('Raspberries')}">${iconImg('berry')}<b data-id="berries">0</b></div>
      </div>
      <div class="hud-minibox" data-act="map" title="${t('Map (M) · Tab — over the game')}"><canvas data-id="mini"></canvas></div>
      <canvas class="hud-over" data-id="over"></canvas>
      <div class="hud-mapwrap" data-id="map">
        <div class="hud-mapframe">
          <h2 data-id="mapTitle"></h2>
          <button class="hud-mapx" data-act="map" title="${t('Close (M)')}">✕</button>
          <canvas data-id="full"></canvas>
          <div class="hud-mapstats" data-id="mapStats"></div>
        </div>
      </div>`;
    parent.appendChild(el);
    this.el = el;
    this.mapEl = this.q('map') as HTMLDivElement;
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (!a) return;
      if (a === 'inv') this.onInventory?.();
      else if (a === 'map') this.onMap?.();
      else if (a === 'potion') this.onPotion?.();
      else if (a === 'aura') this.onAura?.();
      else if (a === 'spec') this.onSpecial?.();
      else if (a.startsWith('art')) this.onArtifact?.(Number(a.slice(3)));
    });
  }

  private q(id: string): HTMLElement {
    const e = this.el.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (!e) throw new Error(`HUD: no ${id}`);
    return e;
  }

  private set(id: string, html: string): void {
    if (this.cache.get(id) === html) return;
    this.cache.set(id, html);
    this.q(id).innerHTML = html;
  }

  setGoal(title: string, sub: string): void { this.set('goal', title); this.set('goalSub', sub); }

  /** Large caption at the top centre: "New level", "Found: …" */
  banner(html: string, sec = 2.2): void {
    const b = this.q('banner');
    b.innerHTML = html;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    this.bannerT = sec;
  }

  get mapOpen(): boolean { return this.mapEl.classList.contains('open'); }

  /** Attach the level map and its name (the full map's title) */
  setMap(m: AutoMap, title: string): void { this.automap = m; this.set('mapTitle', title); }

  /** Full map (M) */
  toggleMap(): void { if (this.automap) this.mapEl.classList.toggle('open'); }

  /** Map over the game (Tab) */
  toggleOverlay(): void { this.overlay = !this.overlay; }

  /** Canvas sized to its on-screen size (pixel density included); null — not visible */
  private fitCanvas(id: string): CanvasRenderingContext2D | null {
    const c = this.q(id) as HTMLCanvasElement;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d');
    if (!g) return null;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    return g;
  }

  /** Draw the maps: mini, over the game, full; chests — [opened, total] */
  drawMaps(hero: MapView, markers: MapMarker[], chests: [number, number]): void {
    const m = this.automap;
    if (!m) return;
    const mini = this.fitCanvas('mini');
    if (mini) m.draw(mini, hero.x, hero.z, mini.canvas.width / 2, mini.canvas.height / 2, mini.canvas.width / 44, hero, markers, 0.95);
    const over = this.q('over');
    over.style.display = this.overlay && !this.mapOpen ? '' : 'none';
    if (this.overlay && !this.mapOpen) {
      const g = this.fitCanvas('over');
      if (g) m.draw(g, hero.x, hero.z, g.canvas.width / 2, g.canvas.height / 2, g.canvas.height / 34, hero, markers, 0.85, true);
    }
    if (this.mapOpen) {
      const g = this.fitCanvas('full');
      if (g) {
        const f = m.fit(g.canvas.width, g.canvas.height);
        m.draw(g, f.ox, f.oz, g.canvas.width / 2, g.canvas.height / 2, f.k, hero, markers);
      }
      this.set('mapStats', `<div>${iconImg('chest')}${t('Chests opened <b>{opened} / {total}</b>', { opened: chests[0], total: chests[1] })}</div><div>${iconImg('map')}${t('Explored <b>{pct} %</b>', { pct: Math.round(m.explored * 100) })}</div>`);
    }
  }

  update(s: HudState, dt: number): void {
    const p = this.profile.data;
    this.set('points', String(p.points));
    this.set('berries', String(p.berries));
    // raspberries were added — the counter bumps
    if (p.berries > this.berriesShown) {
      const el = this.q('berries').parentElement as HTMLElement;
      el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    }
    this.berriesShown = p.berries;
    this.set('arrows', String(p.arrows));
    this.set('lives', String(s.lives));
    this.set('lv', `LV ${p.level}`);
    this.set('hpN', `${Math.ceil(s.hp)}/${Math.round(s.maxHp)}`);
    this.q('hpClip').style.height = `${Math.max(0, Math.min(1, s.hp / s.maxHp)) * 100}%`;
    this.q('souls').style.width = `${(p.souls / MAX_SOULS) * 100}%`;
    this.q('xp').style.width = `${(p.xp / xpToNext(p.level)) * 100}%`;
    this.el.classList.toggle('low', s.hp / s.maxHp < 0.3);
    this.el.querySelector('.hud-ammo')?.classList.toggle('empty', p.arrows <= 0);

    const arts = this.profile.artifacts();
    this.el.querySelectorAll<HTMLElement>('.hud-art').forEach((el, i) => {
      const it = arts[i];
      const img = el.querySelector<HTMLImageElement>('.hud-ico');
      const icon = it ? itemDef(it.def).icon : '';
      if (img && img.dataset.icon !== icon) { img.dataset.icon = icon; img.src = icon ? iconURL(icon) : ''; }
      el.classList.toggle('empty', !it);
      el.title = it ? `${itemDef(it.def).title} (${i + 1})` : t('Empty artifact slot ({n})', { n: i + 1 });
      const [left, full] = s.artifacts[i] ?? [0, 1];
      this.cooldown(el, left, full);
      el.classList.toggle('active', !!s.active[i]);
      el.classList.toggle('souls', !!it && !!itemDef(it.def).artifact?.souls && p.souls < (itemDef(it.def).artifact?.souls ?? 0));
    });
    // aura: the meter rises from the bottom in the aura colour; full — glows and waits for R; drains during the flare
    const au = s.aura ?? null, ael = this.el.querySelector<HTMLElement>('.hud-aura');
    if (ael) {
      const img = ael.querySelector<HTMLImageElement>('.hud-ico');
      const icon = au?.icon ?? '';
      if (img && img.dataset.icon !== icon) { img.dataset.icon = icon; img.src = icon ? iconURL(icon) : ''; }
      ael.classList.toggle('empty', !au);
      ael.title = au ? t('{title} (R) — meter {pct} %', { title: au.title, pct: Math.floor(au.meter * 100) }) : t('Empty aura slot (R)');
      const fill = ael.querySelector<HTMLElement>('.hud-aurafill');
      const k = au ? (au.flare > 0 ? au.flare / 5 : au.meter) : 0;
      if (fill) { fill.style.height = `${k * 100}%`; fill.style.setProperty('--c', au?.color ?? '#555'); }
      ael.classList.toggle('ready', !!au && au.flare <= 0 && au.meter >= 1);
      ael.classList.toggle('flaring', !!au && au.flare > 0);
    }
    // weapon art: the meter in the temper colour; full — glows and waits for Q
    const sp = s.spec, sel = this.el.querySelector<HTMLElement>('.hud-spec');
    if (sel && sp) {
      const img = sel.querySelector<HTMLImageElement>('.hud-ico');
      if (img && img.dataset.icon !== sp.icon) { img.dataset.icon = sp.icon; img.src = iconURL(sp.icon); }
      const fill = sel.querySelector<HTMLElement>('.hud-aurafill');
      if (fill) { fill.style.height = `${Math.min(1, sp.meter) * 100}%`; fill.style.setProperty('--c', sp.color); }
      sel.title = t('{title} (Q) — meter {pct} %', { title: sp.title, pct: Math.floor(sp.meter * 100) });
      sel.classList.toggle('ready', sp.meter >= 1);
      sel.classList.toggle('flaring', sp.active);
    }
    this.cooldown(this.el.querySelector('.hud-potion') as HTMLElement, s.potion[0], s.potion[1]);
    this.cooldown(this.el.querySelector('.hud-roll') as HTMLElement, s.roll[0], s.roll[1], false);

    this.set('buffs', s.buffs.map((b) => `<div class="hud-buff"><div class="hud-buff-ico" style="--c:${b.color ?? '#7a5cff'}">${iconImg(b.icon)}</div><span>${b.count !== undefined ? `<b>×${b.count}</b> ` : ''}${b.name}${b.t !== undefined ? ` <i>${t('{n} s', { n: Math.ceil(b.t) })}</i>` : ''}</span></div>`).join(''));

    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.q('banner').classList.remove('show'); }
  }

  /** Dark cooldown fill (drains from top to bottom) and the seconds */
  private cooldown(el: HTMLElement, t: number, full: number, num = true): void {
    const k = full > 0 ? Math.max(0, Math.min(1, t / full)) : 0;
    const cd = el.querySelector<HTMLElement>('.hud-cd');
    if (cd) cd.style.height = `${k * 100}%`;
    if (num) { const n = el.querySelector<HTMLElement>('.hud-cdn'); if (n) n.textContent = cdText(t); }
    el.classList.toggle('cooling', t > 0);
  }
}
