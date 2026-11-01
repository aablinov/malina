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
import { RaspberryBush } from './bush';
import { scaledBounty, scaledCount, waveLevel } from './scaling';
import { Lair } from './lair';
import { Wall, wallBarColor } from './wall';
import type { Level } from '../level/level.ts';
import { SELL_BACK, TOWER_ORDER, TOWERS, type TowerKind } from './towers';
import type { TdLane, TdPad, TdSpec } from './types';
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
  /** Уровень — для стен замка (пролом убирает блоки, починка возвращает) */
  level?: Level;
  /** Блоки уровня изменились: пересчитать препятствия врагов и героя */
  levelChanged?(): void;
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
    this.pos = new THREE.Vector3(spec.x, spec.y ?? 0, spec.z);
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
    const a = this.pos, b = this.pos.clone().setY(this.pos.y + (this.tower ? 3 : 0.4));
    return ray.distanceSqToSegment(a, b) < 1.45 * 1.45;
  }
}

/** Мини-босс обороны (src/mobs/td-chiefs.ts) */
export const isChief = (kind: string): boolean => kind.startsWith('chief_');

export class TowerDefense {
  readonly spec: TdSpec;
  readonly pads: Pad[];
  readonly towers: Tower[] = [];
  /** Стая врагов режима: все, кто идёт к кусту */
  readonly pack: Pack;
  /** Куст малины — что защищаем; враги с конца дороги бьют его как приманку */
  readonly bush: RaspberryBush;
  /** Логова — по одному на дорогу: завеса, кольцо, тревога перед волной, вспышка выхода */
  readonly lairs: Lair[];
  /** Стены и ворота замка (осада, src/td/wall.ts); пусто — куст в чистом поле */
  readonly walls: Wall[];
  /** Какие башни можно строить на этой карте */
  readonly kinds: TowerKind[];
  /** Состояние партии: идёт, куст засох, все волны отбиты */
  state: 'play' | 'lost' | 'won' = 'play';
  /** Номер текущей волны (1 — первая); 0 — ещё не начиналась */
  wave = 0;
  /** До следующей волны, с (пока не идёт волна) */
  next: number;
  /** Группы текущей волны: сколько ещё выпустить и когда */
  private readonly queue: { kind: string; lane: string; left: number; t: number; every: number }[] = [];
  /** Всего врагов вышло и пало за партию */
  spawned = 0;
  /** Игроков (1–4): больше врагов, здоровья и награды — src/td/scaling.ts */
  players = 1;
  fallen = 0;
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
  private foeSolidsCache: Obstacle[] | null = null;
  private foeSolidsN = -1;

  constructor(h: TdHooks, spec: TdSpec, parent: HTMLElement) {
    this.h = h;
    this.spec = spec;
    this.pads = spec.pads.map((p, i) => new Pad(h.scene, p, i));
    this.next = spec.rest ?? 20;
    this.pack = new Pack(h.boss, (at, n) => { this.fallen++; h.loot(at, n); });
    this.bush = new RaspberryBush(h.scene, h.fx, spec.bush.x, spec.bush.z, spec.bush.hp, h.quiet);
    this.lairs = spec.lanes.map((l) => new Lair(h.scene, h.fx, l, h.quiet));
    this.kinds = (spec.towers ?? TOWER_ORDER.slice(0, 5)).filter((k): k is TowerKind => k in TOWERS);
    this.walls = h.level ? (spec.walls ?? []).map((w) => new Wall(h.scene, h.fx, h.level!, w, h.quiet, () => { this.solidsN = -1; h.levelChanged?.(); })) : [];
    for (const w of this.walls) {
      w.onBreak = () => { this.breach(w); };
      w.onRepair = () => { this.solidsN = -1; };
    }
    this.bush.onDeath = () => { this.state = 'lost'; this.closeMenu(); h.banner('Куст засох<small>Орден добрался до малины · N — попробовать снова</small>', 5); };
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
  /** Препятствия от башен и ствола куста (герой, путь, враги) */
  get solids(): Obstacle[] {
    if (this.solidsN !== this.towers.length) { this.solidsCache = [this.bush.solid, ...this.towers.map((t) => t.solid)]; this.solidsN = this.towers.length; this.foeSolidsCache = null; }
    return this.solidsCache;
  }
  /** Препятствия врагов: то же плюс целые ворота */
  get foeSolids(): Obstacle[] {
    const base = this.solids;
    const gates = this.walls.filter((w) => w.solid && !w.dead);
    if (!this.foeSolidsCache || this.foeSolidsN !== gates.length) { this.foeSolidsCache = base.concat(gates.map((w) => w.solid!)); this.foeSolidsN = gates.length; }
    return this.foeSolidsCache;
  }
  wall(id: string): Wall | undefined { return this.walls.find((w) => w.id === id); }
  /** Стена рядом с героем, которую можно чинить (битая или проломленная) */
  nearWall(pos: THREE.Vector3): Wall | null { return this.walls.find((w) => w.hp < w.maxHp && w.near(pos)) ?? null; }
  /** Цена починки: малины за недостающие 100 здоровья (не меньше 5) */
  repairCost(w: Wall): number { return Math.max(5, Math.ceil(((w.maxHp - w.hp) / 100) * (this.spec.repair ?? 20))); }
  wallPrompt(w: Wall): string { return `${w.dead ? 'Отстроить' : 'Починить'}: ${w.title.toLowerCase()} · ${this.repairCost(w)} малины`; }

  /** Починить стену за малину (F у стены) */
  repair(w: Wall): boolean {
    if (w.hp >= w.maxHp) return false;
    const cost = this.repairCost(w);
    if (this.berries < cost) { this.h.toast(`Не хватает малины: нужно ${cost}`); return false; }
    this.h.profile.data.berries -= cost;
    w.repair();
    this.h.fx.text(w.pos.clone().setY(2.6), `−${cost} малины`, 'berry');
    return true;
  }

  /** Пролом пробит: враги на этой дороге идут дальше внутрь, следующие — сразу до куста */
  private breach(w: Wall): void {
    this.h.banner(`${w.kind === 'gate' ? 'Ворота разбиты' : 'Стена проломлена'}!<small>${w.title} · враги идут внутрь · F у стены — починить</small>`, 3);
    this.h.fx.shake = Math.max(this.h.fx.shake, 0.6);
    for (const lane of this.spec.lanes) {
      if (lane.wall !== w.id || !lane.inner) continue;
      const inner = lane.inner.map(([x, z]) => new THREE.Vector3(x, 0, z));
      for (const m of this.pack.mobs) if (m.march && m.laneId === lane.id && !m.ghost && m.march.length <= lane.points.length) m.extendMarch(inner.map((v) => v.clone()));
    }
  }
  lane(id: string): TdLane | undefined { return this.spec.lanes.find((l) => l.id === id); }
  /** Враги как цели меча и заклинаний */
  targets(): Target[] {
    const list = this.pack.targets();
    for (const t of this.towers) if (t.frozen > 0) list.push(t.ice);
    return list;
  }
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
    for (const p of this.pads) { if (Math.abs(p.pos.y - pos.y) > 1.5) continue; const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  /** Куда подойти, чтобы открыть меню площадки: точка на краю со стороны героя */
  approach(p: Pad, from: THREE.Vector3): THREE.Vector3 {
    const d = new THREE.Vector3(from.x - p.pos.x, 0, from.z - p.pos.z);
    if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
    return p.pos.clone().addScaledVector(d.normalize(), 1.7);
  }
  /** Подсказка внизу: что сделает F у этой площадки */
  prompt(p: Pad): string { return p.tower ? p.tower.ruined ? `Руины: ${p.tower.title} · починить` : `Башня: ${p.tower.title}` : 'Построить башню'; }

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
    if (p.tower?.ruined) { if (n === '1') this.act('repair'); return true; }
    if (p.tower) { if (n === '1') this.act('upgrade'); else if (n === '2') this.act('sell'); return true; }
    const kind = this.kinds.find((k) => TOWERS[k].key === n);
    if (kind) this.act(`build:${kind}`);
    return true;
  }

  private act(a: string): void {
    const p = this.menuPad;
    if (!p) return;
    if (a.startsWith('build:')) { if (this.build(p, a.slice(6) as TowerKind)) this.closeMenu(); }
    else if (a === 'upgrade') this.upgrade(p);
    else if (a === 'repair') this.repairTower(p);
    else if (a === 'sell') { this.sell(p); this.closeMenu(); }
    else if (a === 'close') this.closeMenu();
    if (this.menuPad) this.renderMenu();
  }

  private renderMenu(): void {
    const p = this.menuPad;
    if (!p) return;
    let html: string;
    if (!p.tower) {
      html = `<div class="td-head">Площадка · малина ${this.berries}</div>` + this.kinds.map((k) => {
        const d = TOWERS[k], ok = this.berries >= d.cost;
        return `<button class="td-card${ok ? '' : ' off'}" data-act="build:${k}"><kbd>${d.key}</kbd><i style="background:${d.color}"></i><b>${d.title}</b><small>${d.hint} · ${d.range} м</small><em class="${ok ? 'ok' : ''}">${d.cost} малины</em></button>`;
      }).join('');
    } else if (p.tower.ruined) {
      const t = p.tower, cost = t.repairCost, ok = this.berries >= cost;
      html = `<div class="td-head">Руины: ${t.title} · малина ${this.berries}</div>`
        + `<button class="td-card${ok ? '' : ' off'}" data-act="repair"><kbd>1</kbd><i style="background:${t.def.color}"></i><b>Починить</b><small>снова стреляет, уровень прежний</small><em class="${ok ? 'ok' : ''}">${cost} малины</em></button>`;
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
    if (!def || p.tower || !this.kinds.includes(kind)) return null;
    if (this.berries < def.cost) { this.h.toast(`Не хватает малины: нужно ${def.cost}`); return null; }
    this.h.profile.data.berries -= def.cost;
    const t = new Tower({ scene: this.h.scene, fx: this.h.fx, quiet: this.h.quiet, foes: () => this.foes() }, kind, p.pos.x, p.pos.z, p.pos.y);
    t.onAlarm = (why) => this.alarm(t, why);
    p.tower = t;
    this.towers.push(t);
    const c = new THREE.Color(def.color).multiplyScalar(2);
    this.h.fx.burst(p.pos.clone().setY(0.4), ['#d8cfa8', '#9a8f70', c], 20, { speed: 3, up: 3, size: 0.12, life: 0.6, gravity: 8 });
    this.h.fx.shock(p.pos.clone().setY(0.06), 2, c, 0.4, 0.14);
    this.h.fx.shake = Math.max(this.h.fx.shake, 0.25);
    this.h.fx.text(p.pos.clone().setY(1.4), `−${def.cost} малины`, 'berry');
    return t;
  }

  /** Починить руины башни за малину: прочность полная, уровень прежний */
  repairTower(p: Pad): boolean {
    const t = p.tower;
    if (!t?.ruined) return false;
    const cost = t.repairCost;
    if (this.berries < cost) { this.h.toast(`Не хватает малины: нужно ${cost}`); return false; }
    this.h.profile.data.berries -= cost;
    t.repair();
    this.h.fx.text(p.pos.clone().setY(p.pos.y + 1.6), `−${cost} малины`, 'berry');
    return true;
  }

  /** Башню грызут, заморозили или сломали: сигнал игроку */
  private alarm(t: Tower, why: 'hurt' | 'frozen' | 'ruin'): void {
    if (why === 'ruin') this.h.toast(`Башня разрушена: ${t.title} — F у руин, чтобы починить`);
  }

  upgrade(p: Pad): boolean {
    const t = p.tower;
    if (!t || t.ruined) return false;
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

  /** Враг в точке (без дороги: стоит и ждёт героя, как в комнатах) */
  spawn(kind: string, at: THREE.Vector3): Mob | null { return this.pack.spawn(kind, at); }

  /** Враг из логова на дорогу: марш по точкам к кусту, героя замечает только в 3,5 м */
  spawnOn(kind: string, laneId: string): Mob | null {
    const lane = this.lane(laneId);
    if (!lane) return null;
    const [sx, sz] = lane.points[0];
    const m = this.pack.spawn(kind, new THREE.Vector3(sx + (Math.random() - 0.5) * 1.2, 0, sz + (Math.random() - 0.5) * 1.2));
    if (!m) return null;
    this.spawned++;
    // осада: дорога до стены; стена проломлена или враг летит — сразу дальше внутрь
    const w = lane.wall ? this.wall(lane.wall) : undefined;
    const through = lane.inner && (!w || w.dead || m.ghost) ? lane.inner : [];
    m.march = [...lane.points, ...through].map(([x, z]) => new THREE.Vector3(x, 0, z));
    m.laneId = lane.id;
    m.marchI = 1;
    m.aggro = Math.min(m.aggro, 3.5);
    m.yaw = Math.atan2(lane.points[1][0] - sx, lane.points[1][1] - sz);
    this.lairs.find((l) => l.lane === lane)?.burst();
    if (isChief(kind)) { this.h.banner(`Идёт мини-босс!<small>${m.title} · ${lane.title.toLowerCase()}</small>`, 3); this.h.fx.shake = Math.max(this.h.fx.shake, 0.4); }
    return m;
  }

  /** Дороги следующей волны — по ним логова тревожатся; null — волн больше нет */
  get nextLanes(): TdLane[] | null {
    const w = this.waves[this.wave];
    if (!w) return null;
    const ids = new Set(w.groups.map((g) => g.lane));
    return this.spec.lanes.filter((l) => ids.has(l.id));
  }

  // ---------- волны ----------
  get waves(): readonly import('./types').TdWave[] { return this.spec.waves ?? []; }
  /** Идёт волна: группы ещё выходят или враги живы */
  get waveRunning(): boolean { return this.queue.length > 0 || this.pack.mobs.some((m) => !m.dead); }
  /** Награда за ранний вызов: по малине за каждую секунду ожидания */
  get earlyBonus(): number { return this.waveRunning || this.wave >= this.waves.length ? 0 : Math.round(this.next); }

  /** Следующая волна сейчас (G): бонус за ожидание — в казну */
  callWave(): boolean {
    if (this.state !== 'play' || this.waveRunning || this.wave >= this.waves.length) return false;
    const bonus = this.earlyBonus;
    if (bonus > 0) { this.h.profile.data.berries += bonus; this.h.toast(`Волна раньше срока: +${bonus} малины`); }
    this.startWave();
    return true;
  }

  /** Число игроков (панель F1 / сеть): следующие волны — по новому масштабу, живые враги — сразу */
  setPlayers(n: number): void {
    this.players = Math.max(1, Math.round(n));
    this.pack.setScale(this.wave ? waveLevel(this.wave, this.spec.level) : (this.spec.level ?? 1), this.players);
  }

  private startWave(): void {
    const w = this.waves[this.wave];
    if (!w) return;
    this.wave++;
    // враги крепчают с волнами и игроками: уровень стаи, как у стражей (src/td/scaling.ts); больше игроков — больше врагов
    this.pack.setScale(waveLevel(this.wave, this.spec.level), this.players);
    // мини-босс один на любое число игроков: сильнее он и так — по уровню и игрокам (src/td/scaling.ts)
    for (const g of w.groups) this.queue.push({ kind: g.kind, lane: g.lane, left: isChief(g.kind) ? g.count : scaledCount(g.count, this.players), t: g.delay ?? 0, every: g.every });
    this.h.banner(`Волна ${this.wave} из ${this.waves.length}<small>${w.title ?? 'Орден идёт к кусту'}</small>`, 2.5);
    this.h.fx.shake = Math.max(this.h.fx.shake, 0.2);
  }

  private tickWaves(dt: number): void {
    if (this.state !== 'play' || !this.waves.length) return;
    if (this.queue.length) {
      for (let i = this.queue.length - 1; i >= 0; i--) {
        const q = this.queue[i];
        q.t -= dt;
        if (q.t > 0) continue;
        this.spawnOn(q.kind, q.lane);
        q.t = q.every;
        if (--q.left <= 0) this.queue.splice(i, 1);
      }
      return;
    }
    if (this.wave > 0 && !this.waveRunning && this.next >= (this.spec.rest ?? 20)) {
      // волна отбита: награда и отдых; последняя — победа
      const w = this.waves[this.wave - 1], bounty = scaledBounty(w.bounty, this.players);
      this.h.profile.data.berries += bounty;
      this.h.fx.text(this.bush.pos.clone().setY(3.6), `+${bounty} малины`, 'berry');
      if (this.wave >= this.waves.length) { this.state = 'won'; this.h.banner('Куст отбит!<small>Все волны Ордена разбиты · N — сыграть снова</small>', 6); return; }
      this.h.banner(`Волна ${this.wave} отбита<small>+${bounty} малины · следующая через ${this.spec.rest ?? 20} с · G — сейчас</small>`, 3);
      this.next = (this.spec.rest ?? 20) - 0.001;
      return;
    }
    if (this.waveRunning) { this.next = this.spec.rest ?? 20; return; }
    this.next -= dt;
    if (this.next <= 0) this.startWave();
  }

  update(dt: number): void {
    this.time += dt;
    this.tickWaves(dt);
    // логова: тревога нарастает за 6 с до волны по их дорогам и держится, пока группы выходят
    const soon = this.state === 'play' && !this.waveRunning ? this.nextLanes : null;
    const busy = new Set(this.queue.map((q) => q.lane));
    for (const l of this.lairs) {
      const want = busy.has(l.lane.id) ? 1 : soon?.includes(l.lane) ? Math.max(0, Math.min(1, (6 - this.next) / 5)) : 0;
      l.warn += (want - l.warn) * Math.min(1, dt * 4);
      l.update(dt);
    }
    for (const p of this.pads) { p.hover = p === this.hoverPad || p === this.menuPad; p.update(dt, this.time); }
    for (const t of this.towers) t.update(dt);
    for (const w of this.walls) w.update(dt);
    this.pack.update(dt);
    this.bush.update(dt);
    if (this.menuPad) {
      // ушёл от площадки — меню закрывается
      const hp = this.h.hero.pos, p = this.menuPad.pos;
      if (Math.hypot(hp.x - p.x, hp.z - p.z) > 3.2) this.closeMenu();
      else this.renderMenu();
    }
    this.renderHud();
  }

  private renderHud(): void {
    const b = this.bush, k = Math.max(0, b.hp / b.maxHp), n = this.waves.length;
    const head = this.state === 'lost' ? 'Куст засох' : this.state === 'won' ? 'Куст отбит!' : n ? `Волна <span>${this.wave}</span> из ${n}${this.players > 1 ? ` · игроков ${this.players}` : ''}` : `Оборона куста · башен <span>${this.towers.length}</span> из ${this.pads.length}`;
    const alive = this.pack.mobs.filter((m) => !m.dead).length;
    const from = this.nextLanes?.map((l) => l.title.toLowerCase()).join(', ') ?? '';
    const sub = this.state !== 'play' || !n ? '' : this.waveRunning ? `врагов на карте ${alive}` : this.wave >= n ? '' : `следующая через ${Math.ceil(this.next)} с — ${from} · <kbd>G</kbd> сейчас (+${this.earlyBonus})`;
    const walls = this.walls.length ? `<div class="td-walls">${this.walls.map((w) => `<span class="${w.dead ? 'dead' : ''}" title="${w.title}"><b>${w.kind === 'gate' ? '⌂' : w.title.slice(0, 1)}</b><i style="width:${(w.k * 100).toFixed(0)}%;background:${wallBarColor(w.k)}"></i></span>`).join('')}</div>` : '';
    const html = `<div class="td-wave">${head}</div>${sub ? `<div class="td-next">${sub}</div>` : ''}<div class="td-bush"><i style="width:${(k * 100).toFixed(1)}%"></i></div><div class="td-bush-t">куст малины ${Math.ceil(b.hp)} / ${b.maxHp}</div>${walls}`;
    if (html !== this.hudHtml) { this.hudHtml = html; this.hudEl.innerHTML = html; }
    this.hudEl.classList.toggle('lost', this.state === 'lost');
    this.hudEl.classList.toggle('won', this.state === 'won');
  }

  /** Всё заново: башни снесены, враги убраны, казна полная */
  reset(): void {
    this.closeMenu();
    for (const t of this.towers.splice(0)) t.dispose();
    for (const p of this.pads) p.tower = null;
    this.pack.clear();
    this.queue.length = 0;
    this.wave = 0;
    this.next = this.spec.rest ?? 20;
    this.spawned = this.fallen = 0;
    for (const l of this.lairs) { l.warn = 0; l.spawned = 0; }
    this.pack.setScale(1, this.players);
    for (const w of this.walls) if (w.hp < w.maxHp) w.repair();
    this.bush.reset();
    this.state = 'play';
    this.h.profile.data.berries = this.spec.berries;
  }
}

