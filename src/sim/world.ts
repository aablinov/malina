import type * as THREE from 'three';
import type { Obstacle } from '../collision.ts';
import type { Level } from '../level/level.ts';
import type { EntityState } from '../net/snapshot.ts';
import { useDecoys, type Decoy } from '../decoys.ts';
import { rng, useRng, type Rand } from '../rng.ts';
import type { Target } from '../target.ts';
import type { TdSpec } from '../td/types.ts';
import type { SimEvent } from './events.ts';
import { Piles } from './pile.ts';
import { SimTd } from './td.ts';

/**
 * Мир симуляции — «game» Quake 3 (wiki/design-multiplayer.md): без сцены, DOM, звука и системной случайности; один и тот же код
 * крутит сервер и браузер (одиночная игра — listen server). Всё видимое — события (`events`) и записи сущностей (`entities()`).
 * Пока герои и враги живут в старых классах (src/knight.ts, src/mobs/) — мир берёт их через крючки `SimHooks`
 */

/** Враг для башен и снарядов: цель с долей пройденной дороги (кто ближе к кусту — тот первый) */
export interface Foe extends Target {
  readonly progress?: number;
  readonly dead: boolean;
}

/** Герой как цель кучек малины и тревоги: место, без сил ли, место в партии */
export interface HeroLike { readonly pos: THREE.Vector3; readonly down: boolean; readonly seat: number }

/** Враг, вышедший из логова на дорогу (src/mobs/mob.ts): маршрут и настороженность задаёт оборона */
export interface MarchingMob {
  march: THREE.Vector3[] | null;
  laneId: string | null;
  marchI: number;
  aggro: number;
  yaw: number;
  readonly ghost: boolean;
  extendMarch(points: THREE.Vector3[]): void;
  readonly title: string;
}

export interface SimHooks {
  /** Живые враги на карте (цели башен) */
  foes(): readonly Foe[];
  /** Герои партии — сборщики малины */
  heroes(): readonly HeroLike[];
  /** Враг из реестра в точке; null — нет такого */
  spawnMob(kind: string, at: THREE.Vector3): MarchingMob | null;
  /** Враги крепчают с волнами и игроками */
  setScale(level: number, players: number): void;
  /** Блоки уровня изменились (пролом, починка): пересчитать препятствия */
  levelChanged?(): void;
  /** Шаг героев и стаи внутри шага мира — под игровой случайностью и приманками этого мира */
  step?(dt: number): void;
}

export interface SimWorldOpts {
  seed: number;
  level: Level | null;
  td?: TdSpec;
  players?: number;
  /** Общий бой: у каждого места своя малина */
  personal?: boolean;
}

export class SimWorld {
  tick = 0;
  time = 0;
  readonly rng: Rand;
  readonly seed: number;
  readonly level: Level | null;
  readonly h: SimHooks;
  readonly td: SimTd | null;
  readonly piles: Piles;
  /** Приманки мобов этого мира: куст, стены, башни, призванные (src/decoys.ts) */
  readonly decoys: Decoy[] = [];
  events: SimEvent[] = [];
  private nextId = 0;

  constructor(h: SimHooks, o: SimWorldOpts) {
    this.h = h;
    this.seed = o.seed;
    this.rng = rng(o.seed);
    this.level = o.level;
    this.piles = new Piles(this);
    this.td = o.td ? new SimTd(this, o.td, o.players ?? 1, o.personal ?? false) : null;
  }

  emit(e: SimEvent): void { this.events.push(e); }
  /** Номер новой сущности с приставкой вида */
  id(prefix: string): string { return `${prefix}${++this.nextId}`; }

  /** Препятствия героя: ствол куста и башни */
  get solids(): Obstacle[] { return this.td?.solids ?? []; }
  /** Препятствия врагов: то же плюс целые ворота */
  get foeSolids(): Obstacle[] { return this.td?.foeSolids ?? []; }

  /** События с прошлого забора — вид и снимок забирают их после шага; что случилось между шагами (удары героя), тоже тут */
  takeEvents(): SimEvent[] { const e = this.events; this.events = []; return e; }

  /** Шаг мира: игровая случайность и приманки — этого мира, затем герои и стая (крючок), оборона, кучки */
  step(dt: number): void {
    const r1 = useRng(this.rng), r2 = useDecoys(this.decoys);
    try {
      this.tick++;
      this.time += dt;
      this.h.step?.(dt);
      this.td?.update(dt);
      this.piles.update(dt);
    } finally { r2(); r1(); }
  }

  /** Записи всех сущностей для снимка (src/sim/entities.ts) */
  entities(): EntityState[] {
    const out: EntityState[] = [];
    this.td?.entities(out);
    this.piles.entities(out);
    return out;
  }
}
