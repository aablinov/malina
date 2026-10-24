import { iconImg, iconURL } from '../icons';
import { itemDef, MAX_SOULS, xpToNext, type Profile } from '../items';
import { AutoMap, type MapMarker, type MapView } from './automap';
import './hud.css';

/**
 * HUD как в Minecraft Dungeons (wiki/design-inventory.md): снизу по центру тёмная панель —
 * очки зачарования, инвентарь (I), три артефакта (1, 2, 3) с полосой душ под ними, большое сердце здоровья
 * с жизнями, зелье (E), карта (M), перекат (Space), стрелы в шестиугольнике (ПКМ), справа малина; под правой
 * половиной — полоса опыта с уровнем. Слева сверху — действующие эффекты, справа сверху — задание и мини-карта.
 * Карта (src/hud/automap.ts): мини-карта в углу, Tab — прозрачная поверх игры (как в Diablo II), M — полная (как в MCD).
 * Только отображение: числа приходят из профиля (src/items.ts) и из сцены (HudState) каждый кадр.
 */

export interface HudBuff { icon: string; name: string; /** Осталось, с */ t?: number; count?: number; color?: string }

export interface HudState {
  hp: number;
  maxHp: number;
  lives: number;
  /** Перезарядки: осталось, с, и полная длительность */
  potion: [number, number];
  roll: [number, number];
  artifacts: [number, number][];
  /** Артефакт сейчас действует (тотем стоит, сапоги бегут) */
  active: boolean[];
  buffs: HudBuff[];
  /** Аура: шкала 0..1, осталось вспышки, с; null — гнездо пустое */
  aura?: { icon: string; title: string; meter: number; flare: number; color: string } | null;
}

const cdText = (t: number): string => (t <= 0 ? '' : t < 1 ? t.toFixed(1) : String(Math.ceil(t)));

export class Hud {
  readonly el: HTMLDivElement;
  private readonly cache = new Map<string, string>();
  private mapEl: HTMLDivElement;
  private automap: AutoMap | null = null;
  /** Карта поверх игры (Tab) */
  overlay = false;
  private bannerT = 0;
  /** Сколько малины было на прошлом кадре — чтобы счётчик подпрыгнул, когда прибавилось */
  private berriesShown = Infinity;
  onInventory?: () => void;
  onMap?: () => void;
  onArtifact?: (i: number) => void;
  onPotion?: () => void;
  onAura?: () => void;

  constructor(parent: HTMLElement, private readonly profile: Profile) {
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
        <div class="hud-points" title="Очки зачарования">${iconImg('spiral')}<b data-id="points">0</b></div>
        ${slot('hud-inv', 'I', iconImg('chest')).replace('class="hud-slot', 'data-act="inv" title="Инвентарь (I)" class="hud-slot')}
        <div class="hud-arts">
          <div class="hud-artrow">${[0, 1, 2].map((i) => slot(`hud-art`, String(i + 1), '<img class="px hud-ico" alt="" draggable="false"><span class="hud-plus">+</span>').replace('class="hud-slot', `data-act="art${i}" class="hud-slot`)).join('')}${slot('hud-aura', 'R', '<div class="hud-aurafill"></div><img class="px hud-ico" alt="" draggable="false"><span class="hud-plus">+</span>').replace('class="hud-slot', 'data-act="aura" class="hud-slot')}</div>
          <div class="hud-souls" title="Души">${iconImg('soul')}<div class="hud-track"><div class="hud-fill" data-id="souls"></div></div></div>
        </div>
        <div class="hud-heart" title="Здоровье">
          <div class="hud-heart-frame"><div class="hud-heart-in">
            <div class="hud-heart-icon"><img class="px hud-heart-bg" src="${iconURL('heart')}" alt="">
            <div class="hud-heart-clip" data-id="hpClip"><img class="px" src="${iconURL('heart')}" alt=""></div></div>
          </div></div>
          <div class="hud-lives"><b data-id="lives">3</b>${iconImg('heart')}</div>
          <div class="hud-hpn" data-id="hpN"></div>
        </div>
        <div class="hud-right">
          <div class="hud-row">
            ${slot('hud-potion', 'E', iconImg('potion')).replace('class="hud-slot', 'data-act="potion" title="Зелье здоровья (E)" class="hud-slot')}
            ${slot('hud-map', 'M', iconImg('map')).replace('class="hud-slot', 'data-act="map" title="Карта (M)" class="hud-slot')}
            <div class="hud-roll" title="Перекат (Space)">${iconImg('roll')}<div class="hud-cd"></div><kbd>␣</kbd></div>
            <div class="hud-ammo" title="Стрелы: ПКМ — выстрел"><b data-id="arrows">0</b><div class="hud-hex"><div class="hud-hex-in">${iconImg('arrows')}</div></div>${iconImg('mouse', 'hud-mouse')}</div>
          </div>
          <div class="hud-xp" title="Опыт"><span data-id="lv">LV 1</span><div class="hud-track"><div class="hud-fill" data-id="xp"></div></div></div>
        </div>
        <div class="hud-berries" title="Малина">${iconImg('berry')}<b data-id="berries">0</b></div>
      </div>
      <div class="hud-minibox" data-act="map" title="Карта (M) · Tab — поверх игры"><canvas data-id="mini"></canvas></div>
      <canvas class="hud-over" data-id="over"></canvas>
      <div class="hud-mapwrap" data-id="map">
        <div class="hud-mapframe">
          <h2 data-id="mapTitle"></h2>
          <button class="hud-mapx" data-act="map" title="Закрыть (M)">✕</button>
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
      else if (a.startsWith('art')) this.onArtifact?.(Number(a.slice(3)));
    });
  }

  private q(id: string): HTMLElement {
    const e = this.el.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (!e) throw new Error(`HUD: нет ${id}`);
    return e;
  }

  private set(id: string, html: string): void {
    if (this.cache.get(id) === html) return;
    this.cache.set(id, html);
    this.q(id).innerHTML = html;
  }

  setGoal(title: string, sub: string): void { this.set('goal', title); this.set('goalSub', sub); }

  /** Крупная надпись по центру сверху: «Новый уровень», «Найдено: …» */
  banner(html: string, sec = 2.2): void {
    const b = this.q('banner');
    b.innerHTML = html;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    this.bannerT = sec;
  }

  get mapOpen(): boolean { return this.mapEl.classList.contains('open'); }

  /** Подключить карту уровня и её название (заголовок полной карты) */
  setMap(m: AutoMap, title: string): void { this.automap = m; this.set('mapTitle', title); }

  /** Полная карта (M) */
  toggleMap(): void { if (this.automap) this.mapEl.classList.toggle('open'); }

  /** Карта поверх игры (Tab) */
  toggleOverlay(): void { this.overlay = !this.overlay; }

  /** Холст под размер на экране (с учётом плотности пикселей); false — не виден */
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

  /** Нарисовать карты: мини, поверх игры, полную; chests — [открыто, всего] */
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
      this.set('mapStats', `<div>${iconImg('chest')}Сундуков открыто <b>${chests[0]} / ${chests[1]}</b></div><div>${iconImg('map')}Исследовано <b>${Math.round(m.explored * 100)} %</b></div>`);
    }
  }

  update(s: HudState, dt: number): void {
    const p = this.profile.data;
    this.set('points', String(p.points));
    this.set('berries', String(p.berries));
    // малины прибавилось — счётчик подпрыгивает
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
      el.title = it ? `${itemDef(it.def).title} (${i + 1})` : `Пустое гнездо артефакта (${i + 1})`;
      const [t, full] = s.artifacts[i] ?? [0, 1];
      this.cooldown(el, t, full);
      el.classList.toggle('active', !!s.active[i]);
      el.classList.toggle('souls', !!it && !!itemDef(it.def).artifact?.souls && p.souls < (itemDef(it.def).artifact?.souls ?? 0));
    });
    // аура: шкала поднимается снизу цветом ауры; полная — светится и ждёт R; во время вспышки убывает
    const au = s.aura ?? null, ael = this.el.querySelector<HTMLElement>('.hud-aura');
    if (ael) {
      const img = ael.querySelector<HTMLImageElement>('.hud-ico');
      const icon = au?.icon ?? '';
      if (img && img.dataset.icon !== icon) { img.dataset.icon = icon; img.src = icon ? iconURL(icon) : ''; }
      ael.classList.toggle('empty', !au);
      ael.title = au ? `${au.title} (R) — шкала ${Math.floor(au.meter * 100)} %` : 'Пустое гнездо ауры (R)';
      const fill = ael.querySelector<HTMLElement>('.hud-aurafill');
      const k = au ? (au.flare > 0 ? au.flare / 5 : au.meter) : 0;
      if (fill) { fill.style.height = `${k * 100}%`; fill.style.setProperty('--c', au?.color ?? '#555'); }
      ael.classList.toggle('ready', !!au && au.flare <= 0 && au.meter >= 1);
      ael.classList.toggle('flaring', !!au && au.flare > 0);
    }
    this.cooldown(this.el.querySelector('.hud-potion') as HTMLElement, s.potion[0], s.potion[1]);
    this.cooldown(this.el.querySelector('.hud-roll') as HTMLElement, s.roll[0], s.roll[1], false);

    this.set('buffs', s.buffs.map((b) => `<div class="hud-buff"><div class="hud-buff-ico" style="--c:${b.color ?? '#7a5cff'}">${iconImg(b.icon)}</div><span>${b.count !== undefined ? `<b>×${b.count}</b> ` : ''}${b.name}${b.t !== undefined ? ` <i>${Math.ceil(b.t)} с</i>` : ''}</span></div>`).join(''));

    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.q('banner').classList.remove('show'); }
  }

  /** Тёмная заливка перезарядки (убывает сверху вниз) и секунды */
  private cooldown(el: HTMLElement, t: number, full: number, num = true): void {
    const k = full > 0 ? Math.max(0, Math.min(1, t / full)) : 0;
    const cd = el.querySelector<HTMLElement>('.hud-cd');
    if (cd) cd.style.height = `${k * 100}%`;
    if (num) { const n = el.querySelector<HTMLElement>('.hud-cdn'); if (n) n.textContent = cdText(t); }
    el.classList.toggle('cooling', t > 0);
  }
}
