import * as THREE from 'three';
import { raycastCircle, raycastObstacles, type Obstacle } from './collision';
import { FIREARMS, type FirearmDef, type FirearmId } from './firearms';
import { CALIBERS, DOUBLE_HOLD, RICOCHET, type Caliber } from './tuning';

/**
 * Стрельба без рендера: магазины, патронник, перезарядка, разброс, раскачка, лучи пуль с рикошетами.
 * Модель и эффекты подписываются на события (GunEvent). Случайность — от seed, чтобы прогон был повторяемым.
 */

export type Rand = () => number;
export function rng(seed = 1): Rand {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export type ReloadKind = 'tac' | 'full' | 'break';

export interface ReloadState {
  kind: ReloadKind;
  t: number;
  dur: number;
  /** Патроны уже вставлены — прерывание их не отнимает */
  committed: boolean;
  /** Сколько событий анимации уже отправлено */
  stage: number;
}

export type GunEvent = 'shot' | 'dry' | 'magOut' | 'magIn' | 'rack' | 'open' | 'eject' | 'shellsIn' | 'close' | 'draw' | 'reloadCancel';

/** Доли длительности перезарядки, когда происходят события */
export const RELOAD_MARKS: Record<ReloadKind, { ev: GunEvent; at: number }[]> = {
  tac: [{ ev: 'magOut', at: 0.15 }, { ev: 'magIn', at: 0.72 }],
  full: [{ ev: 'magOut', at: 0.12 }, { ev: 'magIn', at: 0.6 }, { ev: 'rack', at: 0.84 }],
  break: [{ ev: 'open', at: 0.12 }, { ev: 'eject', at: 0.2 }, { ev: 'shellsIn', at: 0.68 }, { ev: 'close', at: 0.86 }],
};

export class GunState {
  readonly def: FirearmDef;
  /** Патроны в магазине (у двустволки — в стволах) */
  mag: number;
  /** Патрон в патроннике */
  chamber: boolean;
  reload: ReloadState | null = null;
  /** До следующего выстрела, с */
  cool = 0;
  /** Раскачка от отдачи, 0..1 */
  bloom = 0;
  /** Увод ствола от отдачи, рад — плавно возвращается */
  drift = 0;
  /** Сколько держим спуск (дуплет двустволки) */
  held = 0;
  /** Спуск был нажат в прошлом кадре (для полуавтомата) */
  wasDown = false;
  /** Дуплет уже прозвучал за это нажатие */
  doubleFired = false;

  constructor(id: FirearmId) {
    this.def = FIREARMS[id];
    const t = this.def.t;
    // полный магазин и, у магазинных, патрон в патроннике: 30 + 1
    this.chamber = this.def.reload === 'mag';
    this.mag = t.mag;
  }

  get rounds(): number { return this.mag + (this.chamber ? 1 : 0); }
  get capacity(): number { return this.def.t.mag + (this.def.reload === 'mag' ? 1 : 0); }
  get reloading(): boolean { return this.reload !== null; }

  /** Начать перезарядку, если есть смысл */
  startReload(reserve: number): boolean {
    if (this.reload) return false;
    const t = this.def.t;
    if (this.mag >= t.mag || reserve <= 0) return false;
    let kind: ReloadKind;
    if (this.def.reload === 'break') kind = 'break';
    else kind = this.chamber && t.reloadTac > 0 ? 'tac' : 'full';
    const dur = kind === 'tac' ? t.reloadTac : t.reloadFull;
    this.reload = { kind, t: 0, dur, committed: false, stage: 0 };
    this.held = 0;
    return true;
  }

  /** Прервать перезарядку (бег, перекат, смена ствола) */
  cancelReload(): boolean {
    if (!this.reload) return false;
    const r = this.reload;
    // если магазин вставлен, а затвор не передёрнут — дошлём патрон сами, чтобы не наказывать за прерывание
    if (r.committed && !this.chamber && this.mag > 0 && this.def.reload === 'mag') { this.mag--; this.chamber = true; }
    this.reload = null;
    return true;
  }
}

export interface FireRequest {
  gun: GunState;
  /** Углы отклонения каждой пули или дробины от направления ствола, рад */
  angles: number[];
  dmg: number;
  knock: number;
  /** Дуплет: оба ствола */
  double: boolean;
}

export interface GunnerContext {
  trigger: boolean;
  reloadPressed: boolean;
  /** Можно стрелять (не бег, не перекат, не смена ствола) */
  canFire: boolean;
  /** Бег и перекат прерывают перезарядку */
  interrupt: boolean;
  /** Итоговый множитель разброса от стойки */
  spreadMul: number;
}

/** Оружие одного бойца: основной ствол, пистолет, запас по калибрам */
export class Gunner {
  primary: GunState;
  pistol: GunState;
  active: 'primary' | 'pistol' = 'primary';
  /** Смена ствола: сколько осталось, с */
  switchT = 0;
  readonly reserve: Record<Caliber, number>;
  infinite = false;
  /** Число выстрелов и пуль — для телеметрии и тестов */
  shots = 0;

  constructor(primary: FirearmId, private readonly rand: Rand, private readonly onEvent: (ev: GunEvent, gun: GunState) => void, private readonly onFire: (req: FireRequest) => void) {
    this.primary = new GunState(primary);
    this.pistol = new GunState('pm');
    this.reserve = Object.fromEntries(Object.entries(CALIBERS).map(([k, v]) => [k, v.max])) as Record<Caliber, number>;
  }

  get gun(): GunState { return this.active === 'primary' ? this.primary : this.pistol; }

  /** Текущий разброс в радианах (полуугол) при данном множителе стойки */
  spread(mul: number, gun = this.gun): number {
    const t = gun.def.t;
    return THREE.MathUtils.degToRad(t.spread * mul + t.bloomDeg * gun.bloom);
  }

  select(slot: 'primary' | 'pistol', switchTime: number): void {
    if (this.active === slot) return;
    if (this.gun.cancelReload()) this.onEvent('reloadCancel', this.gun);
    this.active = slot;
    this.switchT = switchTime;
    this.onEvent('draw', this.gun);
  }

  /** Заменить основной ствол (панель плейграунда, торговец) */
  setPrimary(id: FirearmId, switchTime: number): void {
    if (this.primary.def.id === id) return;
    this.primary = new GunState(id);
    if (this.active === 'primary') { this.switchT = switchTime; this.onEvent('draw', this.primary); }
  }

  update(dt: number, ctx: GunnerContext): void {
    const g = this.gun;
    const t = g.def.t;
    this.switchT = Math.max(0, this.switchT - dt);
    g.cool = Math.max(0, g.cool - dt);
    // раскачка спадает линейно за bloomDecay, только когда не стреляем
    if (g.cool <= 0 || !ctx.trigger) g.bloom = Math.max(0, g.bloom - dt / Math.max(0.05, t.bloomDecay));
    g.drift *= Math.exp(-dt / Math.max(0.05, t.bloomDecay * 0.6));
    for (const other of [this.primary, this.pistol]) if (other !== g) { other.bloom = 0; other.drift = 0; }
    // магазин могли уменьшить в панели
    if (g.mag > t.mag) g.mag = t.mag;

    // перезарядка
    if (g.reload) {
      if (ctx.interrupt) {
        g.cancelReload();
        this.onEvent('reloadCancel', g);
      } else {
        const r = g.reload;
        r.t += dt;
        const k = r.t / r.dur;
        const marks = RELOAD_MARKS[r.kind];
        while (r.stage < marks.length && k >= marks[r.stage].at) {
          const ev = marks[r.stage].ev;
          r.stage++;
          this.onEvent(ev, g);
          if (ev === 'magIn' || ev === 'shellsIn') this.commit(g);
          if (ev === 'rack' && !g.chamber && g.mag > 0) { g.mag--; g.chamber = true; }
        }
        if (k >= 1) g.reload = null;
      }
    } else if (ctx.reloadPressed) {
      if (g.startReload(this.reserveOf(g))) g.wasDown = true;
    }

    // спуск
    const down = ctx.trigger;
    const pressed = down && !g.wasDown;
    g.wasDown = down;
    if (!ctx.canFire || this.switchT > 0 || g.reload) { g.held = 0; return; }

    if (g.def.mode === 'double') {
      // тап — один ствол на отпускании; удержание 0,3 с — дуплет
      if (down) {
        if (pressed) { g.held = 0; g.doubleFired = false; }
        g.held += dt;
        if (g.held >= DOUBLE_HOLD && !g.doubleFired) {
          g.doubleFired = true;
          if (g.mag >= 2) this.fire(g, ctx, 2);
          else if (g.mag === 1) this.fire(g, ctx, 1);
          else this.dry(g);
        }
      } else if (g.held > 0) {
        if (!g.doubleFired) {
          if (g.mag > 0 && g.cool <= 0) this.fire(g, ctx, 1);
          else if (g.mag <= 0) this.dry(g);
        }
        g.held = 0;
      }
      return;
    }

    const want = g.def.mode === 'auto' ? down : pressed;
    if (!want || g.cool > 0) return;
    if (g.rounds <= 0) { this.dry(g); return; }
    this.fire(g, ctx, 1);
  }

  private reserveOf(g: GunState): number { return this.infinite ? 9999 : this.reserve[g.def.caliber]; }

  /** Вставить патроны из запаса */
  private commit(g: GunState): void {
    const r = g.reload;
    if (!r) return;
    const need = g.def.t.mag - g.mag;
    const have = this.reserveOf(g);
    const n = Math.min(need, have);
    g.mag += n;
    if (!this.infinite) this.reserve[g.def.caliber] -= n;
    r.committed = true;
  }

  private dry(g: GunState): void {
    if (g.cool > 0) return;
    g.cool = 0.25;
    this.onEvent('dry', g);
    // пустой магазин и нажатый спуск — перезарядка начинается сама
    g.startReload(this.reserveOf(g));
  }

  private fire(g: GunState, ctx: GunnerContext, barrels: number): void {
    const t = g.def.t;
    if (g.def.reload === 'mag') {
      if (g.chamber) {
        if (g.mag > 0) g.mag--;
        else g.chamber = false;
      } else { g.mag--; }
    } else g.mag -= barrels;
    g.cool = 1 / t.rate;
    const spread = this.spread(ctx.spreadMul, g);
    const angles: number[] = [];
    const n = t.pellets * barrels;
    for (let i = 0; i < n; i++) {
      // треугольное распределение: к центру гуще
      const a = (this.rand() + this.rand() - 1) * spread * (barrels > 1 ? 1.25 : 1);
      angles.push(a + g.drift);
    }
    g.bloom = Math.min(1, g.bloom + t.bloomShot * barrels);
    g.drift += (this.rand() - 0.5) * THREE.MathUtils.degToRad(t.bloomDeg) * 0.35 * t.kick;
    this.shots++;
    this.onFire({ gun: g, angles, dmg: t.dmg, knock: t.knock * (barrels > 1 ? 1 : 0.4), double: barrels > 1 });
    this.onEvent('shot', g);
  }
}

// ---------- Полёт пули ----------

/** То, во что можно попасть: манекены, жуки, позже — игроки */
export interface Shootable {
  readonly pos: THREE.Vector3;
  readonly radius: number;
  readonly alive: boolean;
  /**
   * Высота корпуса, если цель пригнулась (присел за укрытием). Если между стрелком и целью
   * есть препятствие выше этой высоты, пуля проходит над головой.
   */
  readonly shieldY?: number;
  /** Высота цели (ящик, бочка): пуля выше неё пролетает поверх */
  readonly topY?: number;
  hit(dmg: number, dir: THREE.Vector3, point: THREE.Vector3, knock: number): void;
}

export interface ShotResult {
  /** Отрезки трассеров (с рикошетами) */
  segments: { from: THREE.Vector3; to: THREE.Vector3 }[];
  wallHits: { point: THREE.Vector3; nx: number; nz: number; ricochet: boolean }[];
  targetHits: { target: Shootable; dmg: number; point: THREE.Vector3 }[];
}

/**
 * Пуля летит мгновенно по горизонтали на высоте y.
 * Урон полный до range, дальше падает до 50% к 1,5 × range, там пуля исчезает.
 */
export function traceShot(
  origin: THREE.Vector3, yaw: number, dmg: number, range: number, knock: number,
  obstacles: readonly Obstacle[], targets: readonly Shootable[], rand: Rand,
): ShotResult {
  const res: ShotResult = { segments: [], wallHits: [], targetHits: [] };
  let ox = origin.x, oz = origin.z;
  let dx = Math.sin(yaw), dz = Math.cos(yaw);
  const y = origin.y;
  let left = range * 1.5;
  let travelled = 0;
  let mul = 1;
  let bounced = false;
  const skip = new Set<Shootable>();
  for (let leg = 0; leg < 3 && left > 0.01; leg++) {
    const wall = raycastObstacles(ox, oz, dx, dz, left, y, obstacles);
    const wallT = wall ? wall.t : left;
    let bestT = wallT;
    let best: Shootable | null = null;
    for (const tg of targets) {
      if (!tg.alive || skip.has(tg)) continue;
      if (tg.topY !== undefined && y >= tg.topY) continue;
      const t = raycastCircle(ox, oz, dx, dz, tg.pos.x, tg.pos.z, tg.radius);
      if (t < 0 || t >= bestT) continue;
      // пригнулся за укрытием — пуля проходит над ним
      if (tg.shieldY !== undefined && raycastObstacles(ox, oz, dx, dz, t, tg.shieldY, obstacles)) continue;
      bestT = t; best = tg;
    }
    const from = new THREE.Vector3(ox, y, oz);
    const to = new THREE.Vector3(ox + dx * bestT, y, oz + dz * bestT);
    res.segments.push({ from, to });
    const dist = travelled + bestT;
    const fall = dist <= range ? 1 : 1 - 0.5 * Math.min(1, (dist - range) / (range * 0.5));
    if (best) {
      const d = dmg * mul * fall;
      res.targetHits.push({ target: best, dmg: d, point: to.clone() });
      best.hit(d, new THREE.Vector3(dx, 0, dz), to.clone(), knock);
      return res;
    }
    if (!wall) return res;
    const canBounce = !bounced && rand() < RICOCHET.chance;
    res.wallHits.push({ point: to.clone(), nx: wall.nx, nz: wall.nz, ricochet: canBounce });
    if (!canBounce) return res;
    // отражение со случайным разбросом
    const dot = dx * wall.nx + dz * wall.nz;
    let rx = dx - 2 * dot * wall.nx, rz = dz - 2 * dot * wall.nz;
    const jitter = (rand() - 0.5) * 0.8;
    const c = Math.cos(jitter), s = Math.sin(jitter);
    [rx, rz] = [rx * c + rz * s, -rx * s + rz * c];
    // не даём уйти внутрь стены
    if (rx * wall.nx + rz * wall.nz < 0.1) { rx += wall.nx * 0.3; rz += wall.nz * 0.3; }
    const l = Math.hypot(rx, rz);
    dx = rx / l; dz = rz / l;
    ox = to.x + wall.nx * 0.02; oz = to.z + wall.nz * 0.02;
    travelled += bestT;
    left -= bestT;
    left = Math.min(left, range * 0.6);
    mul *= RICOCHET.dmgMul;
    bounced = true;
  }
  return res;
}
