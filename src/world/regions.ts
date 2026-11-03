import type { Level } from '../level/level.ts';
import { REGION, type RegionData, type RegionEntity, type RegionSource } from './gen.ts';

/**
 * Менеджер регионов (wiki/dev-performance.md, «Регионы»): мир — сетка колонок 32 × 32 м с ключом «rx,rz»;
 * дерево не нужно, регион точки — это floor(x / 32). Якоря — позиции героев (для кооператива объединение):
 * вокруг каждого держится квадрат радиуса radius регионов, всё дальше radius + 1 выгружается через unloadDelay секунд
 * (гистерезис, чтобы на границе не мигало). Загрузка — не больше одного региона за вызов update, чтобы кадр не вставал.
 *
 * Состояние региона (что убито, открыто, разбито — по стабильным id сущностей; разведка карты) переживает выгрузку
 * и перезагрузку страницы: это дельта в localStorage (сервер потом возьмёт тот же формат).
 */

export interface RegionHooks {
  /** Регион загружен: поставить сущности (уже без «мёртвых») */
  spawn(key: string, rx: number, rz: number, entities: RegionEntity[]): void;
  /** Регион выгружается: убрать его сущности */
  despawn(key: string, rx: number, rz: number): void;
  /** Разведка карты региона на выгрузке (base64), чтобы сохранить */
  seenOf?(key: string, rx: number, rz: number): string | undefined;
}

export interface RegionState { dead: string[]; seen?: string }
interface WorldSave { version: 1; regions: Record<string, RegionState> }

interface Region { key: string; rx: number; rz: number; data: RegionData; unloadAt: number | null }

export const regionKey = (rx: number, rz: number): string => `${rx},${rz}`;
export const regionOf = (x: number, z: number): [number, number] => [Math.floor(x / REGION), Math.floor(z / REGION)];

export class RegionManager {
  readonly loaded = new Map<string, Region>();
  private readonly states = new Map<string, RegionState>();
  /** Радиус в регионах вокруг якоря; выгрузка — за radius + 1 */
  radius = 2;
  unloadDelay = 5;
  private time = 0;
  private saveDue = false;
  private lastSave = 0;
  /** Сколько регионов загружено и выгружено за всё время (для тестов и F8) */
  readonly stats = { loads: 0, unloads: 0 };

  private readonly level: Level;
  private readonly source: RegionSource;
  private readonly hooks: RegionHooks;
  private readonly saveKey: string | null;
  constructor(level: Level, source: RegionSource, hooks: RegionHooks, saveKey: string | null = null) { this.level = level; this.source = source; this.hooks = hooks; this.saveKey = saveKey;
    this.restore();
  }

  /** Ключи загруженных регионов */
  get keys(): string[] { return [...this.loaded.keys()]; }

  has(x: number, z: number): boolean { return this.loaded.has(regionKey(...regionOf(x, z))); }

  /** Сущность с таким id уже убита, открыта или разбита */
  isDead(id: string): boolean { return this.states.get(id.split(':')[0])?.dead.includes(id) ?? false; }

  /** Запомнить: сущность больше не появится */
  kill(id: string): void {
    const key = id.split(':')[0];
    const st = this.state(key);
    if (!st.dead.includes(id)) { st.dead.push(id); this.saveDue = true; }
  }

  private state(key: string): RegionState {
    let st = this.states.get(key);
    if (!st) this.states.set(key, st = { dead: [] });
    return st;
  }

  /** Разведка региона, сохранённая ранее */
  seenOf(key: string): string | undefined { return this.states.get(key)?.seen; }

  /** Загрузить всё вокруг якорей сразу (старт) */
  warm(anchors: { x: number; z: number }[]): void {
    for (const key of this.wanted(anchors)) if (!this.loaded.has(key)) this.load(key);
  }

  private wanted(anchors: { x: number; z: number }[], r = this.radius): Set<string> {
    const out = new Set<string>();
    for (const a of anchors) {
      const [ax, az] = regionOf(a.x, a.z);
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) out.add(regionKey(ax + dx, az + dz));
    }
    return out;
  }

  /** Раз в кадр: подгрузить ближайший недостающий регион, наметить и выполнить выгрузки */
  update(dt: number, anchors: { x: number; z: number }[]): void {
    this.time += dt;
    const want = this.wanted(anchors), keep = this.wanted(anchors, this.radius + 1);
    // ближайший недостающий — один за вызов
    let best: string | null = null, bd = Infinity;
    for (const key of want) {
      if (this.loaded.has(key)) continue;
      const [rx, rz] = key.split(',').map(Number);
      for (const a of anchors) {
        const d = (rx * REGION + REGION / 2 - a.x) ** 2 + (rz * REGION + REGION / 2 - a.z) ** 2;
        if (d < bd) { bd = d; best = key; }
      }
    }
    if (best) this.load(best);
    for (const r of this.loaded.values()) {
      if (keep.has(r.key)) { r.unloadAt = null; continue; }
      if (r.unloadAt === null) r.unloadAt = this.time + this.unloadDelay;
      else if (this.time >= r.unloadAt) this.unload(r.key);
    }
    if (this.saveDue && this.time - this.lastSave > 1) this.save();
  }

  private load(key: string): void {
    const [rx, rz] = key.split(',').map(Number);
    const data = this.source.generate(rx, rz, this.level);
    const r: Region = { key, rx, rz, data, unloadAt: null };
    this.loaded.set(key, r);
    this.stats.loads++;
    this.hooks.spawn(key, rx, rz, data.entities.filter((e) => !this.isDead(e.id)));
  }

  private unload(key: string): void {
    const r = this.loaded.get(key);
    if (!r) return;
    const seen = this.hooks.seenOf?.(key, r.rx, r.rz);
    if (seen) { this.state(key).seen = seen; this.saveDue = true; }
    this.hooks.despawn(key, r.rx, r.rz);
    this.source.release?.(r.rx, r.rz, this.level);
    for (const ck of this.level.chunkKeysOf(r.rx, r.rz)) this.level.removeChunk(ck);
    this.loaded.delete(key);
    this.stats.unloads++;
  }

  /** Выгрузить всё (смена мира) */
  dispose(): void { for (const key of [...this.loaded.keys()]) this.unload(key); this.save(); }

  save(): void {
    this.saveDue = false;
    this.lastSave = this.time;
    if (!this.saveKey) return;
    const regions: Record<string, RegionState> = {};
    for (const [k, st] of this.states) if (st.dead.length || st.seen) regions[k] = st;
    const j: WorldSave = { version: 1, regions };
    try { localStorage.setItem(this.saveKey, JSON.stringify(j)); } catch { /* закрытое хранилище */ }
  }

  private restore(): void {
    if (!this.saveKey) return;
    try {
      const raw = localStorage.getItem(this.saveKey);
      if (!raw) return;
      const j = JSON.parse(raw) as WorldSave;
      if (j.version !== 1) return;
      for (const [k, st] of Object.entries(j.regions)) this.states.set(k, { dead: [...(st.dead ?? [])], seen: st.seen });
    } catch { /* битое сохранение — начинаем заново */ }
  }
}
