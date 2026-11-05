import type { Level } from '../level/level.ts';
import { REGION, type RegionData, type RegionEntity, type RegionSource } from './gen.ts';

/**
 * Region manager (wiki/dev-performance.md, "Regions"): the world is a grid of 32 × 32 m columns keyed "rx,rz";
 * no tree needed, a point's region is floor(x / 32). Anchors are hero positions (the union for co-op):
 * a square of radius regions is kept around each, everything beyond radius + 1 is unloaded after unloadDelay seconds
 * (hysteresis so the border does not flicker). Loading is at most one region per update call so the frame does not stall.
 *
 * Region state (what is killed, opened, broken — by stable entity ids; map exploration) survives unloading
 * and page reloads: it is a delta in localStorage (the server will later take the same format).
 */

export interface RegionHooks {
  /** Region loaded: place the entities (the "dead" ones already removed) */
  spawn(key: string, rx: number, rz: number, entities: RegionEntity[]): void;
  /** Region unloading: remove its entities */
  despawn(key: string, rx: number, rz: number): void;
  /** The region's map exploration at unload (base64), to be saved */
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
  /** Radius in regions around an anchor; unloading beyond radius + 1 */
  radius = 2;
  unloadDelay = 5;
  private time = 0;
  private saveDue = false;
  private lastSave = 0;
  /** How many regions were loaded and unloaded in total (for tests and F8) */
  readonly stats = { loads: 0, unloads: 0 };

  private readonly level: Level;
  private readonly source: RegionSource;
  private readonly hooks: RegionHooks;
  private readonly saveKey: string | null;
  constructor(level: Level, source: RegionSource, hooks: RegionHooks, saveKey: string | null = null) { this.level = level; this.source = source; this.hooks = hooks; this.saveKey = saveKey;
    this.restore();
  }

  /** Keys of the loaded regions */
  get keys(): string[] { return [...this.loaded.keys()]; }

  has(x: number, z: number): boolean { return this.loaded.has(regionKey(...regionOf(x, z))); }

  /** The entity with this id is already killed, opened or broken */
  isDead(id: string): boolean { return this.states.get(id.split(':')[0])?.dead.includes(id) ?? false; }

  /** Remember: the entity will not appear again */
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

  /** The region's exploration saved earlier */
  seenOf(key: string): string | undefined { return this.states.get(key)?.seen; }

  /** Load everything around the anchors at once (start) */
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

  /** Once per frame: load the nearest missing region, schedule and perform unloads */
  update(dt: number, anchors: { x: number; z: number }[]): void {
    this.time += dt;
    const want = this.wanted(anchors), keep = this.wanted(anchors, this.radius + 1);
    // the nearest missing one — one per call
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

  /** Unload everything (world change) */
  dispose(): void { for (const key of [...this.loaded.keys()]) this.unload(key); this.save(); }

  save(): void {
    this.saveDue = false;
    this.lastSave = this.time;
    if (!this.saveKey) return;
    const regions: Record<string, RegionState> = {};
    for (const [k, st] of this.states) if (st.dead.length || st.seen) regions[k] = st;
    const j: WorldSave = { version: 1, regions };
    try { localStorage.setItem(this.saveKey, JSON.stringify(j)); } catch { /* storage unavailable */ }
  }

  private restore(): void {
    if (!this.saveKey) return;
    try {
      const raw = localStorage.getItem(this.saveKey);
      if (!raw) return;
      const j = JSON.parse(raw) as WorldSave;
      if (j.version !== 1) return;
      for (const [k, st] of Object.entries(j.regions)) this.states.set(k, { dead: [...(st.dead ?? [])], seen: st.seen });
    } catch { /* corrupt save — start over */ }
  }
}
