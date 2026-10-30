import * as THREE from 'three';
import type { Obstacle } from '../collision';
import type { FX } from '../fx';
import type { Knight } from '../knight';
import type { Profile } from '../items';
import type { Target } from '../target';
import type { BossHooks } from '../bosses/kit';
import { C, glowMat } from '../bosses/kit';
import { Pack } from '../mobs/pack';
import type { Mob } from '../mobs/mob';
import { Tower, type Foe } from './tower';
import { SELL_BACK, TOWER_ORDER, TOWERS, type TowerKind } from './towers';
import type { TdPad, TdSpec } from './types';
import './td.css';

/**
 * Режим «Оборона куста» (wiki/design-tower-defence.md): площадки под башни, меню постройки, башни, враги по дорогам.
 * Включается на карте с `meta.td` (src/td/types.ts). Малина — валюта: постройка и улучшение берут из профиля,
 * продажа возвращает часть, с павших врагов малина падает кучками (подбирать — как всегда).
 */

export interface TdHooks {
  scene: THREE.Scene;
  fx: FX;
  hero: Knight;
  profile: Profile;
  /** Крючки стражей и мобов (сцена, герой, препятствия, урон герою) — для стаи врагов */
  boss: BossHooks;
  /** Малина с павшего: где и сколько */
  loot(at: THREE.Vector3, n: number): void;
  toast(s: string): void;
  banner(html: string, sec?: number): void;
  quiet(): boolean;
}

/** Площадка: кольцо на земле, подсветка под курсором, башня на ней */
export class Pad {
  readonly pos: THREE.Vector3;
  readonly group = new THREE.Group();
  tower: Tower | null = null;
  hover = false;
  private readonly ring: THREE.MeshBasicMaterial;
  private readonly disc: THREE.Mesh;

  constructor(scene: THREE.Scene, readonly spec: TdPad, readonly index: number) {
    this.pos = new THREE.Vector3(spec.x, 0, spec.z);
    this.group.position.copy(this.pos);
    // кольцо-подсветка: тускло всегда, ярко под курсором; каменный круг площадки рисует карта блоками
    this.ring = glowMat(C(1.2, 1.0, 0.5), 0.35, true);
    const r = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.45, 24), this.ring);
    r.rotation.x = -Math.PI / 2;
    r.position.y = 0.05;
    this.group.add(r);
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(1.25, 24), glowMat(C(1.2, 1.0, 0.5), 0.08, true));
    this.disc.rotation.x = -Math.PI / 2;
    this.disc.position.y = 0.045;
    this.group.add(this.disc);
    scene.add(this.group);
  }

  get free(): boolean { return this.tower === null; }

  update(dt: number, t: number): void {
    const k = this.hover ? 1 : this.tower ? 0.08 : 0.3 + Math.sin(t * 2 + this.index) * 0.08;
    this.ring.opacity += (k - this.ring.opacity) * Math.min(1, dt * 12);
    this.disc.visible = this.hover && !this.tower;
  }

  /** Луч камеры проходит над площадкой (на высоте башни, если она стоит) */
  hitBy(ray: THREE.Ray): boolean {
    const a = this.pos, b = this.pos.clone().setY(this.tower ? 3 : 0.4);
    return ray.distanceSqToSegment(a, b) < 1.45 * 1.45;
  }
}

export class TowerDefense {
  readonly spec: TdSpec;
  readonly pads: Pad[];
  readonly towers: Tower[] = [];
  /** Стая врагов режима: все, кто идёт к кусту */
  readonly pack: Pack;
  /** Площадка, чьё меню открыто */
  menuPad: Pad | null = null;
  /** Площадка под курсором */
  hoverPad: Pad | null = null;
  readonly menuEl: HTMLDivElement;
  readonly hudEl: HTMLDivElement;
  private readonly h: TdHooks;
  private time = 0;
  private menuHtml = '';
  private hudHtml = '';
  private solidsCache: Obstacle[] = [];
  private solidsN = -1;

  constructor(h: TdHooks, spec: TdSpec, parent: HTMLElement) {
    this.h = h;
    this.spec = spec;
    this.pads = spec.pads.map((p, i) => new Pad(h.scene, p, i));
    this.pack = new Pack(h.boss, (at, n) => h.loot(at, n));
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
    // стартовая казна режима: малина профиля становится казной обороны
    h.profile.data.berries = spec.berries;
  }

  get berries(): number { return this.h.profile.data.berries; }
  get menuOpen(): boolean { return this.menuPad !== null; }
  /** Препятствия от башен (герой, путь, враги) */
  get solids(): Obstacle[] {
    if (this.solidsN !== this.towers.length) { this.solidsCache = this.towers.map((t) => t.solid); this.solidsN = this.towers.length; }
    return this.solidsCache;
  }
  /** Враги как цели меча и заклинаний */
  targets(): Target[] { return this.pack.targets(); }
  /** Враги для башен */
  foes(): readonly Foe[] { return this.pack.mobs as unknown as Foe[]; }

  /** Площадка под лучом камеры (ближайшая к камере) */
  padAt(ray: THREE.Ray): Pad | null {
    let best: Pad | null = null, bd = Infinity;
    for (const p of this.pads) {
      if (!p.hitBy(ray)) continue;
      const d = ray.origin.distanceToSquared(p.pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  /** Площадка рядом с героем (в 2 м от края) */
  nearPad(pos: THREE.Vector3): Pad | null {
    let best: Pad | null = null, bd = 2.2;
    for (const p of this.pads) { const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  /** Куда подойти, чтобы открыть меню площадки: точка на краю со стороны героя */
  approach(p: Pad, from: THREE.Vector3): THREE.Vector3 {
    const d = new THREE.Vector3(from.x - p.pos.x, 0, from.z - p.pos.z);
    if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
    return p.pos.clone().addScaledVector(d.normalize(), 1.7);
  }
  /** Подсказка внизу: что сделает F у этой площадки */
  prompt(p: Pad): string { return p.tower ? `Башня: ${p.tower.title}` : 'Построить башню'; }

  // ---------- меню площадки ----------
  openMenu(p: Pad): void { this.menuPad = p; this.menuHtml = ''; this.menuEl.classList.remove('hidden'); this.renderMenu(); }
  closeMenu(): void { this.menuPad = null; this.menuEl.classList.add('hidden'); }

  /** Клавиша при открытом меню: цифры — выбор, Esc — закрыть. true — обработана */
  key(e: KeyboardEvent): boolean {
    const p = this.menuPad;
    if (!p) return false;
    if (e.code === 'Escape' || e.code === 'KeyF') { this.closeMenu(); return true; }
    if (!e.code.startsWith('Digit')) return false;
    const n = e.code.slice(5);
    if (p.tower) { if (n === '1') this.act('upgrade'); else if (n === '2') this.act('sell'); return true; }
    const kind = TOWER_ORDER.find((k) => TOWERS[k].key === n);
    if (kind) this.act(`build:${kind}`);
    return true;
  }

  private act(a: string): void {
    const p = this.menuPad;
    if (!p) return;
    if (a.startsWith('build:')) { if (this.build(p, a.slice(6) as TowerKind)) this.closeMenu(); }
    else if (a === 'upgrade') this.upgrade(p);
    else if (a === 'sell') { this.sell(p); this.closeMenu(); }
    else if (a === 'close') this.closeMenu();
    if (this.menuPad) this.renderMenu();
  }

  private renderMenu(): void {
    const p = this.menuPad;
    if (!p) return;
    let html: string;
    if (!p.tower) {
      html = `<div class="td-head">Площадка · малина ${this.berries}</div>` + TOWER_ORDER.map((k) => {
        const d = TOWERS[k], ok = this.berries >= d.cost;
        return `<button class="td-card${ok ? '' : ' off'}" data-act="build:${k}"><kbd>${d.key}</kbd><i style="background:${d.color}"></i><b>${d.title}</b><small>${d.hint} · ${d.range} м</small><em class="${ok ? 'ok' : ''}">${d.cost} малины</em></button>`;
      }).join('');
    } else {
      const t = p.tower, next = t.nextCost, back = Math.round(t.spent * SELL_BACK), ok = next !== null && this.berries >= next;
      html = `<div class="td-head">${t.title} · урон ${t.dmg} · ${t.range} м · малина ${this.berries}</div>`
        + `<button class="td-card${next === null || !ok ? ' off' : ''}" data-act="upgrade"><kbd>1</kbd><i style="background:${t.def.color}"></i><b>${next === null ? 'Предел' : `Улучшить до ${['I', 'II', 'III'][t.level]}`}</b><small>${next === null ? 'лучше не бывает' : 'урон и дальность выше'}</small><em class="${ok ? 'ok' : ''}">${next === null ? '—' : `${next} малины`}</em></button>`
        + `<button class="td-card" data-act="sell"><kbd>2</kbd><i style="background:#9ad87a"></i><b>Продать</b><small>площадка освободится</small><em class="sell">+${back} малины</em></button>`;
    }
    if (html !== this.menuHtml) { this.menuHtml = html; this.menuEl.innerHTML = html; }
  }

  // ---------- постройка ----------
  build(p: Pad, kind: TowerKind): Tower | null {
    const def = TOWERS[kind];
    if (!def || p.tower) return null;
    if (this.berries < def.cost) { this.h.toast(`Не хватает малины: нужно ${def.cost}`); return null; }
    this.h.profile.data.berries -= def.cost;
    const t = new Tower({ scene: this.h.scene, fx: this.h.fx, quiet: this.h.quiet, foes: () => this.foes() }, kind, p.pos.x, p.pos.z);
    p.tower = t;
    this.towers.push(t);
    const c = new THREE.Color(def.color).multiplyScalar(2);
    this.h.fx.burst(p.pos.clone().setY(0.4), ['#d8cfa8', '#9a8f70', c], 20, { speed: 3, up: 3, size: 0.12, life: 0.6, gravity: 8 });
    this.h.fx.shock(p.pos.clone().setY(0.06), 2, c, 0.4, 0.14);
    this.h.fx.shake = Math.max(this.h.fx.shake, 0.25);
    this.h.fx.text(p.pos.clone().setY(1.4), `−${def.cost} малины`, 'berry');
    return t;
  }

  upgrade(p: Pad): boolean {
    const t = p.tower;
    if (!t) return false;
    const cost = t.nextCost;
    if (cost === null) { this.h.toast('Башня на пределе'); return false; }
    if (this.berries < cost) { this.h.toast(`Не хватает малины: нужно ${cost}`); return false; }
    this.h.profile.data.berries -= cost;
    t.upgrade();
    this.h.fx.text(p.pos.clone().setY(1.6), `−${cost} малины`, 'berry');
    return true;
  }

  sell(p: Pad): number {
    const t = p.tower;
    if (!t) return 0;
    const back = Math.round(t.spent * SELL_BACK);
    this.h.profile.data.berries += back;
    this.towers.splice(this.towers.indexOf(t), 1);
    t.dispose();
    p.tower = null;
    this.h.fx.burst(p.pos.clone().setY(0.6), ['#d8cfa8', '#9a8f70', '#5e3c22'], 16, { speed: 3, up: 3, size: 0.12, life: 0.6, gravity: 8 });
    this.h.fx.text(p.pos.clone().setY(1.4), `+${back} малины`, 'berry');
    return back;
  }

  /** Враг на дорогу (пока — у точки; с волнами — src/td/waves.ts) */
  spawn(kind: string, at: THREE.Vector3): Mob | null { return this.pack.spawn(kind, at); }

  update(dt: number): void {
    this.time += dt;
    for (const p of this.pads) { p.hover = p === this.hoverPad || p === this.menuPad; p.update(dt, this.time); }
    for (const t of this.towers) t.update(dt);
    this.pack.update(dt);
    if (this.menuPad) {
      // ушёл от площадки — меню закрывается
      const hp = this.h.hero.pos, p = this.menuPad.pos;
      if (Math.hypot(hp.x - p.x, hp.z - p.z) > 3.2) this.closeMenu();
      else this.renderMenu();
    }
    this.renderHud();
  }

  private renderHud(): void {
    const html = `<div class="td-wave">Оборона куста · башен <span>${this.towers.length}</span> из ${this.pads.length}</div>`;
    if (html !== this.hudHtml) { this.hudHtml = html; this.hudEl.innerHTML = html; }
  }

  /** Всё заново: башни снесены, враги убраны, казна полная */
  reset(): void {
    this.closeMenu();
    for (const t of this.towers.splice(0)) t.dispose();
    for (const p of this.pads) p.tower = null;
    this.pack.clear();
    this.h.profile.data.berries = this.spec.berries;
  }
}

