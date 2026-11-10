import * as THREE from 'three';
import type { Obstacle } from '../collision.ts';
import { addDecoy } from '../decoys.ts';
import { emptyBag, guardPool, SEED_RARITIES, type ExpeditionSpec, type ExpPoi, type ExpSecondary, type SeedBag, type SeedRarity } from '../expedition/types.ts';
import { t } from '../i18n/i18n.ts';
import { rollMobLoot } from '../items.ts';
import type { EntityState } from '../net/snapshot.ts';
import { rng, type Rand } from '../rng.ts';
import type { Target } from '../target.ts';
import { clampRating, lootK, scaledCount } from '../td/scaling.ts';
import { SimBush } from './bush.ts';
import { Garrisons, type PostedMob } from './garrison.ts';
import { BOARD_WAIT, EXTRACT_WAIT, HOLD_R, PAD_R, SimBeacon, SimExtraction, SimNest, USE_R } from './objective.ts';
import type { Rules, RulesCommand, RulesState } from './rules.ts';
import type { HeroLike, SimWorld } from './world.ts';

/**
 * Expedition rules (wiki/design-expeditions.md): the squad lands on a seeded map, completes the primary objective — burns the
 * lairs, lights and holds the beacons, or plants a bush and defends it for three waves — gathers seeds at points of interest and
 * leaves by balloon. The mission counts once the primary objective is done and the balloon has left; only the seeds of those who
 * boarded reach the camp. Everything the player does besides fighting is one command, `use`
 */

export const BUSH_WAVES = 3;
const BUSH_HP = 320;
const WAVE_REST = 6;
/** While the balloon is on its way a raid comes this often */
const RAID_EVERY = 22;
const POI_R = 1.7;
const SEED_R = 1.5;
/** Match loot: a lair by size, a secondary objective, the primary one (plus per difficulty), the share added for boarding */
const LOOT_LAIR = 10;
const LOOT_SIDE = 15;
const LOOT_PRIMARY = 40;
const LOOT_PRIMARY_D = 15;
const LOOT_BOARD = 0.25;

interface GroundSeed { id: string; x: number; y: number; z: number; rarity: SeedRarity; lock: number }
interface Side { spec: ExpSecondary; done: boolean; nest: SimNest | null }
interface Raid { mobs: PostedMob[] }

export class SimExpedition implements Rules {
  readonly spec: ExpeditionSpec;
  readonly garrisons: Garrisons;
  readonly nests: SimNest[];
  readonly beacons: SimBeacon[];
  readonly extraction: SimExtraction;
  readonly sides: Side[];
  /** The planted bush (objective `bush`); null — not planted or another objective */
  bush: SimBush | null = null;
  /** Waves beaten at the bush, and seconds to the next one (−1 — a wave is running or nothing is planted) */
  bushWave = 0;
  private bushRest = -1;
  private bushRaid: Raid | null = null;
  state: RulesState = 'play';
  /** The primary objective is done: the balloon may be called */
  primary = false;
  players: number;
  rating = 1;
  fallen = 0;
  readonly personal: boolean;
  readonly seeds: GroundSeed[] = [];
  private readonly taken = new Set<string>();
  private readonly carried = new Map<number, SeedBag>();
  private readonly banked = new Map<number, SeedBag>();
  private readonly wasDown = new Map<number, boolean>();
  private readonly purses = new Map<number, number>();
  private readonly loots = new Map<number, number>();
  private raidT = 0;
  /** Hint to the player (seat, text) */
  onToast: ((seat: number, text: string) => void) | null = null;
  /** Client of a network battle: a mirror of the server's rules — commands go to the server */
  remote: ((c: RulesCommand) => void) | null = null;
  private readonly w: SimWorld;
  private readonly lootRng: Rand;
  private readonly pool: string[];
  private solidsCache: Obstacle[] | null = null;
  private undecoy: (() => void) | null = null;

  constructor(w: SimWorld, spec: ExpeditionSpec, players: number, personal: boolean) {
    this.w = w;
    this.spec = spec;
    this.players = Math.max(1, Math.round(players));
    this.personal = personal;
    this.lootRng = rng((w.seed ^ 0x3c6ef372) >>> 0 || 1);
    this.pool = guardPool(spec.difficulty);
    w.h.setScale(this.base, this.players);
    this.garrisons = new Garrisons(w, spec.garrisons);
    this.nests = spec.lairs.map((l) => new SimNest(w, l, this.players));
    for (const n of this.nests) n.onDeath = () => this.nestFell(n);
    this.beacons = spec.objective.kind === 'beacons' ? spec.objective.sites.map((s) => new SimBeacon(w, s)) : [];
    this.extraction = new SimExtraction(w, spec.extraction);
    this.sides = spec.secondary.map((s) => {
      // a horn-blowers' nest is burnt down like a lair, the rest are used
      const nest = s.kind === 'horns' ? new SimNest(w, { id: s.id, x: s.x, z: s.z, size: 1 }, this.players) : null;
      const side: Side = { spec: s, done: false, nest };
      if (nest) nest.onDeath = () => { this.solidsCache = null; this.sideDone(side); };
      return side;
    });
    w.piles.onPick = (seat, n) => this.gain(seat, n);
  }

  // ---------- rules ----------
  /** Pack level: the mission's plus the heroes' strength */
  get base(): number { return this.spec.level + this.rating - 1; }
  get stage(): number { return this.done; }
  get progress(): number { return this.done; }
  get goal(): number { return this.spec.objective.kind === 'bush' ? BUSH_WAVES : this.spec.objective.sites.length; }
  get paid(): boolean { return this.state === 'won'; }
  get muster(): [number, number, number] { const l = this.spec.landings[0]; return [l.x, this.w.floor(l.x, l.z, 2), l.z]; }
  /** Steps of the primary objective done: lairs burnt, beacons lit, waves beaten */
  get done(): number {
    const k = this.spec.objective.kind;
    return k === 'lairs' ? this.nests.filter((n) => n.dead).length : k === 'beacons' ? this.beacons.filter((b) => b.state === 'lit').length : this.bushWave;
  }
  get solids(): Obstacle[] {
    this.solidsCache ??= [...this.nests, ...this.sides.map((s) => s.nest)].filter((n): n is SimNest => !!n && !n.dead).map((n) => n.solid).concat(this.bush && !this.bush.dead ? [this.bush.solid] : []);
    return this.solidsCache;
  }
  get foeSolids(): Obstacle[] { return this.solids; }
  targets(): Target[] { return [...this.nests, ...this.sides.map((s) => s.nest)].filter((n): n is SimNest => !!n && !n.dead); }

  setPlayers(n: number): void { this.players = Math.max(1, Math.round(n)); this.w.h.setScale(this.base, this.players); }
  setRating(r: number): void { this.rating = clampRating(r); this.setPlayers(this.players); }

  // ---------- purse, loot, seeds ----------
  private key(seat: number): number { return this.personal ? seat : 0; }
  berries(seat = 0): number { return this.purses.get(this.key(seat)) ?? 0; }
  gain(seat: number, n: number): void { this.purses.set(this.key(seat), Math.max(0, this.berries(seat) + n)); }
  fund(seat: number): void { if (!this.purses.has(this.key(seat))) this.purses.set(this.key(seat), 0); }
  spend(seat: number, cost: number): boolean {
    if (cost <= 0) return true;
    if (this.berries(seat) < cost) { this.onToast?.(seat, t('Not enough raspberries: {cost} needed', { cost })); return false; }
    this.gain(seat, -cost);
    return true;
  }
  lootOf(seat = 0): number { return Math.floor(this.loots.get(this.key(seat)) ?? 0); }
  /** Loot to every seat: the mission is a team one */
  addLoot(n: number): void { if (n > 0) for (const seat of this.purses.keys()) this.loots.set(seat, (this.loots.get(seat) ?? 0) + n * lootK(this.rating)); }
  /** Seeds a hero carries now — lost unless he boards the balloon */
  carriedOf(seat: number): SeedBag { let b = this.carried.get(seat); if (!b) { b = emptyBag(); this.carried.set(seat, b); } return b; }
  /** Seeds a hero brought out — these reach the camp */
  bankedOf(seat: number): SeedBag { return this.banked.get(seat) ?? emptyBag(); }
  isTaken(id: string): boolean { return this.taken.has(id); }
  /** Mirror of a network battle */
  setBerries(seat: number, n: number): void { this.purses.set(this.key(seat), Math.max(0, n)); }
  setLoot(seat: number, n: number): void { this.loots.set(this.key(seat), Math.max(0, n)); }

  killed(at: THREE.Vector3, pile: number, base: number): void {
    this.fallen++;
    this.w.piles.drop(at, pile);
    if (this.state === 'play') this.addLoot(base);
  }

  // ---------- the one command ----------
  command(seat: number, c: RulesCommand): boolean {
    if (c.t !== 'exp') return false;
    if (this.remote) { this.remote(c); return true; }
    if (this.state !== 'play') return false;
    // a command arrives between steps and may bring a raid: the same randomness as inside a step
    return this.w.scoped(() => this.use(seat));
  }

  private use(seat: number): boolean {
    const h = this.w.h.heroes().find((x) => x.seat === seat);
    if (!h || h.down) return false;
    const near = (p: { x: number; z: number }): boolean => Math.hypot(p.x - h.pos.x, p.z - h.pos.z) <= USE_R;
    const beacon = this.beacons.find((b) => b.state === 'dark' && near(b.pos));
    if (beacon) {
      beacon.state = 'lighting';
      this.w.emit({ t: 'beacon.light', id: beacon.id, x: beacon.pos.x, y: beacon.pos.y, z: beacon.pos.z, seat });
      this.raid(beacon.pos, 3 + Math.floor(this.spec.difficulty / 2));
      return true;
    }
    const plot = this.spec.objective.kind === 'bush' ? this.spec.objective.sites[0] : null;
    if (plot && !this.bush && near(plot)) {
      // the plot's guards would trample the seedling
      if (!this.garrisons.cleared(`g:${plot.id}`)) { this.onToast?.(seat, t('Drive the guards off the plot first')); return false; }
      this.plant(plot.x, plot.z, seat);
      return true;
    }
    const side = this.sides.find((s) => !s.done && !s.nest && near(s.spec));
    if (side) { this.sideDone(side, seat); return true; }
    const pad = this.extraction;
    if (pad.state === 'idle' && near(pad.pos)) {
      if (!this.primary) { this.onToast?.(seat, t('The balloon will come when the objective is done')); return false; }
      pad.state = 'called';
      pad.t = EXTRACT_WAIT;
      this.raidT = 4;
      this.w.emit({ t: 'extract.call', x: pad.pos.x, y: pad.pos.y, z: pad.pos.z, sec: EXTRACT_WAIT, seat });
      return true;
    }
    return false;
  }

  /** What `use` would do for the hero of a seat — the hint by the F key; null — nothing to use here */
  usable(seat: number): 'beacon' | 'plot' | 'guarded' | 'chest' | 'altar' | 'watchtower' | 'extract' | 'wait' | null {
    const h = this.w.h.heroes().find((x) => x.seat === seat);
    if (!h || h.down || this.state !== 'play') return null;
    const near = (p: { x: number; z: number }): boolean => Math.hypot(p.x - h.pos.x, p.z - h.pos.z) <= USE_R;
    if (this.beacons.some((b) => b.state === 'dark' && near(b.pos))) return 'beacon';
    if (this.spec.objective.kind === 'bush' && !this.bush && near(this.spec.objective.sites[0])) return this.garrisons.cleared(`g:${this.spec.objective.sites[0].id}`) ? 'plot' : 'guarded';
    const side = this.sides.find((s) => !s.done && !s.nest && near(s.spec));
    if (side) return side.spec.kind as 'chest' | 'altar' | 'watchtower';
    if (this.extraction.state === 'idle' && near(this.extraction.pos)) return this.primary ? 'extract' : 'wait';
    return null;
  }

  // ---------- objectives ----------
  private nestFell(n: SimNest): void {
    this.solidsCache = null;
    this.addLoot(LOOT_LAIR * n.size);
    if (this.spec.objective.kind === 'lairs') this.step();
  }

  /** A step of the primary objective is done; the last one completes it */
  private step(): void {
    this.w.emit({ t: 'exp.step', n: this.done, of: this.goal });
    if (this.primary || this.done < this.goal) return;
    this.primary = true;
    this.addLoot(LOOT_PRIMARY + LOOT_PRIMARY_D * this.spec.difficulty);
    const p = this.extraction.pos;
    this.w.emit({ t: 'exp.primary', x: p.x, y: p.y, z: p.z });
  }

  private sideDone(s: Side, seat = -1): void {
    if (s.done) return;
    s.done = true;
    this.addLoot(LOOT_SIDE);
    const at = new THREE.Vector3(s.spec.x, this.w.floor(s.spec.x, s.spec.z, 2), s.spec.z);
    // an Order chest: raspberries on the ground and an item; an altar blesses the loot; a watchtower shows the map (the view)
    if (s.spec.kind === 'chest') { this.w.piles.drop(at, 20 + 5 * this.spec.difficulty); const it = rollMobLoot(this.lootRng); this.w.drops.drop(at, it.def, it.relic); }
    if (s.spec.kind === 'altar') this.addLoot(LOOT_SIDE);
    this.w.emit({ t: 'exp.side', id: s.spec.id, kind: s.spec.kind, x: at.x, y: at.y, z: at.z, seat });
  }

  private plant(x: number, z: number, seat: number): void {
    const b = new SimBush(this.w, x, z, BUSH_HP, this.w.floor(x, z, 2));
    this.bush = b;
    this.solidsCache = null;
    this.undecoy = addDecoy(b, this.w.decoys);
    b.onDeath = () => { this.undecoy?.(); this.solidsCache = null; this.state = 'lost'; this.w.emit({ t: 'exp.lost', why: 'bush' }); };
    this.w.emit({ t: 'bush.plant', x, y: b.pos.y, z, seat });
    this.bushRest = 4;
  }

  private tickBush(dt: number): void {
    const b = this.bush;
    if (!b || b.dead || this.bushWave >= BUSH_WAVES) return;
    if (this.bushRaid) {
      if (this.bushRaid.mobs.some((m) => !m.dead)) return;
      this.bushRaid = null;
      this.bushWave++;
      this.bushRest = WAVE_REST;
      this.w.piles.harvest();
      this.step();
      // the bush has taken root: enemies leave it alone
      if (this.bushWave >= BUSH_WAVES) this.undecoy?.();
      return;
    }
    this.bushRest -= dt;
    if (this.bushRest > 0) return;
    this.bushRaid = this.raid(b.pos, 4 + this.bushWave * 2 + Math.floor(this.spec.difficulty / 2));
    this.w.emit({ t: 'wave.start', wave: this.bushWave + 1, of: BUSH_WAVES, title: '', mod: '' });
  }

  /**
   * A raid on a point: enemies come out of the nearest standing lair if it is close, otherwise out of the woods some way off, and
   * march at the point. `n` — for one player; the party gets more
   */
  raid(target: THREE.Vector3, n: number): Raid {
    const r = this.w.rng, half = this.spec.half - 10;
    let from: THREE.Vector3 | null = null;
    const lair = this.nests.filter((x) => !x.dead).map((x) => ({ x, d: Math.hypot(x.pos.x - target.x, x.pos.z - target.z) })).filter((x) => x.d > 6 && x.d < 42).sort((a, b) => a.d - b.d)[0];
    const open = (x: number, z: number): boolean => !this.w.terrain?.blocked(x, z, target.x, target.z, this.w.floor(x, z, 2) + 0.6);
    if (lair && open(lair.x.pos.x, lair.x.pos.z)) from = lair.x.pos.clone();
    for (let i = 0, a0 = r() * Math.PI * 2; !from && i < 12; i++) {
      const a = a0 + (i / 12) * Math.PI * 2, x = target.x + Math.cos(a) * 22, z = target.z + Math.sin(a) * 22;
      if (Math.max(Math.abs(x), Math.abs(z)) < half && (i === 11 || open(x, z))) from = new THREE.Vector3(x, 0, z);
    }
    from ??= new THREE.Vector3(target.x, 0, target.z + 14);
    const raid: Raid = { mobs: [] };
    for (let i = 0, count = scaledCount(n, this.players); i < count; i++) {
      const a = r() * Math.PI * 2, d = 2.2 + r() * 2.5, x = from.x + Math.cos(a) * d, z = from.z + Math.sin(a) * d;
      const m = this.w.h.spawnMob(this.pool[Math.floor(r() * this.pool.length)], new THREE.Vector3(x, this.w.floor(x, z, 2), z)) as PostedMob | null;
      if (!m) continue;
      m.march = [new THREE.Vector3(x, 0, z), new THREE.Vector3(target.x, 0, target.z)];
      m.marchI = 1;
      m.aggro = Math.min(m.aggro, 9);
      m.yaw = Math.atan2(target.x - x, target.z - z);
      raid.mobs.push(m);
    }
    this.w.emit({ t: 'exp.raid', x: from.x, y: this.w.floor(from.x, from.z, 2), z: from.z, n: raid.mobs.length });
    return raid;
  }

  // ---------- seeds ----------
  private pickPoi(q: ExpPoi, h: HeroLike): void {
    this.taken.add(q.id);
    this.gain(h.seat, q.berries);
    this.addLoot(q.berries * 0.5);
    if (q.seed) this.carriedOf(h.seat)[q.seed]++;
    this.w.emit({ t: 'poi.take', id: q.id, x: q.x, y: h.pos.y, z: q.z, n: q.berries, seed: q.seed ?? '', seat: h.seat });
  }

  /** A hero fell: everything he carried lies around him for anyone to pick up */
  private spill(h: HeroLike): void {
    const bag = this.carriedOf(h.seat), r = this.w.rng;
    for (const rarity of SEED_RARITIES) for (; bag[rarity] > 0; bag[rarity]--) {
      const a = r() * Math.PI * 2, d = 0.8 + r() * 1.2, x = h.pos.x + Math.cos(a) * d, z = h.pos.z + Math.sin(a) * d;
      this.seeds.push({ id: this.w.id('seed'), x, y: this.w.floor(x, z, h.pos.y), z, rarity, lock: 1.5 });
    }
  }

  private tickSeeds(dt: number, heroes: readonly HeroLike[]): void {
    for (const h of heroes) {
      const was = this.wasDown.get(h.seat) ?? false;
      if (h.down && !was) this.spill(h);
      this.wasDown.set(h.seat, h.down);
    }
    for (const s of this.seeds) s.lock -= dt;
    for (const h of heroes) {
      if (h.down) continue;
      for (const q of this.spec.pois) if (!this.taken.has(q.id) && Math.hypot(q.x - h.pos.x, q.z - h.pos.z) <= POI_R) this.pickPoi(q, h);
      for (let i = this.seeds.length - 1; i >= 0; i--) {
        const s = this.seeds[i];
        if (s.lock > 0 || Math.hypot(s.x - h.pos.x, s.z - h.pos.z) > SEED_R) continue;
        this.seeds.splice(i, 1);
        this.carriedOf(h.seat)[s.rarity]++;
        this.w.emit({ t: 'seed.take', id: s.id, x: s.x, y: s.y, z: s.z, seed: s.rarity, seat: h.seat });
      }
    }
  }

  // ---------- extraction ----------
  private tickExtraction(dt: number, heroes: readonly HeroLike[]): void {
    const pad = this.extraction;
    if (pad.state === 'idle' || pad.state === 'gone') return;
    pad.t -= dt;
    if (pad.state === 'called') {
      this.raidT -= dt;
      if (this.raidT <= 0 && pad.t > 8) { this.raidT = RAID_EVERY; this.raid(pad.pos, 3 + Math.floor(this.spec.difficulty / 2)); }
      if (pad.t > 0) return;
      pad.state = 'ready';
      pad.t = BOARD_WAIT;
      this.w.emit({ t: 'extract.ready', x: pad.pos.x, y: pad.pos.y, z: pad.pos.z, sec: BOARD_WAIT });
      return;
    }
    const up = heroes.filter((h) => !h.down);
    const aboard = up.filter((h) => Math.hypot(h.pos.x - pad.pos.x, h.pos.z - pad.pos.z) <= PAD_R);
    if (pad.t > 0 && (!up.length || aboard.length < up.length)) return;
    // the balloon leaves: whoever stands on the pad takes his seeds to the camp, and everyone gets the boarding share
    pad.state = 'gone';
    for (const h of aboard) { this.banked.set(h.seat, { ...this.carriedOf(h.seat) }); this.carried.set(h.seat, emptyBag()); }
    if (aboard.length) for (const seat of this.purses.keys()) this.loots.set(seat, Math.round((this.loots.get(seat) ?? 0) * (1 + LOOT_BOARD)));
    this.state = 'won';
    this.w.emit({ t: 'exp.won', x: pad.pos.x, y: pad.pos.y, z: pad.pos.z, n: aboard.length });
  }

  update(dt: number): void {
    this.garrisons.update();
    if (this.state !== 'play') return;
    const heroes = this.w.h.heroes();
    for (const b of this.beacons) {
      if (b.update(dt, heroes.some((h) => !h.down && Math.hypot(h.pos.x - b.pos.x, h.pos.z - b.pos.z) <= HOLD_R))) {
        this.w.emit({ t: 'beacon.lit', id: b.id, x: b.pos.x, y: b.pos.y, z: b.pos.z });
        this.step();
      }
    }
    this.tickBush(dt);
    this.tickSeeds(dt, heroes);
    this.tickExtraction(dt, heroes);
  }

  entities(out: EntityState[]): void {
    out.push({ id: 'exp', state: this.state, kind: this.spec.objective.kind, done: this.done, goal: this.goal, primary: this.primary ? 1 : 0, players: this.players, rating: this.rating, fallen: this.fallen, guards: this.garrisons.alive, wave: this.bushRaid ? 1 : 0 });
    for (const n of this.nests) n.entity(out);
    for (const b of this.beacons) b.entity(out);
    this.bush?.entity(out);
    this.extraction.entity(out);
    for (const s of this.sides) { out.push({ id: `s:${s.spec.id}`, kind: s.spec.kind, x: s.spec.x, z: s.spec.z, done: s.done ? 1 : 0 }); s.nest?.entity(out); }
    for (const q of this.spec.pois) if (!this.taken.has(q.id)) out.push({ id: q.id, x: q.x, z: q.z, seed: q.seed ?? '' });
    for (const s of this.seeds) out.push({ id: s.id, x: s.x, y: s.y, z: s.z, seed: s.rarity });
    for (const [seat, b] of this.carried) out.push({ id: `carry${seat}`, seat, c: b.common, r: b.rare, g: b.golden });
    for (const [seat, n] of this.purses) out.push({ id: `purse${seat}`, seat, n });
    for (const seat of this.purses.keys()) out.push({ id: `loot${seat}`, seat, n: this.lootOf(seat) });
  }
}
