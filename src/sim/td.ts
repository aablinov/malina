import * as THREE from 'three';
import type { Obstacle } from '../collision.ts';
import { addDecoy } from '../decoys.ts';
import type { EntityState } from '../net/snapshot.ts';
import type { TdCommand } from '../net/protocol.ts';
import type { Target } from '../target.ts';
import { clampRating, LOOT_WAVE, LOOT_WIN, lootK, scaledBounty, scaledCount, waveLevel } from '../td/scaling.ts';
import { BASE_TOWERS, SELL_BACK, TOWER_ORDER, TOWERS, type TowerKind } from '../td/towers.ts';
import type { TdLane, TdPad, TdSpec, TdWave } from '../td/types.ts';
import { SimBush } from './bush.ts';
import { SimFog } from './fog.ts';
import { fogWave } from '../td/waves-fog.ts';
import { r1 } from './entities.ts';
import { SimLair } from './lair.ts';
import { SimTower } from './tower.ts';
import { t } from '../i18n/i18n.ts';
import { SimWall } from './wall.ts';
import type { SimWorld } from './world.ts';

/**
 * Bush Defence rules (wiki/design-tower-defence.md) — pure logic: pads and towers, walls, the bush, lairs, waves along
 * lanes, the treasury. Menu, HUD, models and sparks belong to the view (src/cgame/td-ui.ts, views). All player actions are commands
 * `command(seat, c)` (build, upgrade, sell, repair, wave now), just like a guest of a network battle
 */

/** Defence mini-boss (src/mobs/td-chiefs.ts) */
export const isChief = (kind: string): boolean => kind.startsWith('chief_');

export class SimPad {
  readonly index: number;
  readonly spec: TdPad;
  readonly pos: THREE.Vector3;
  tower: SimTower | null = null;
  constructor(spec: TdPad, index: number) { this.spec = spec; this.index = index; this.pos = new THREE.Vector3(spec.x, spec.y ?? 0, spec.z); }
  get free(): boolean { return this.tower === null; }
}

interface Queued { kind: string; lane: string; left: number; t: number; every: number }

export class SimTd {
  readonly spec: TdSpec;
  readonly pads: SimPad[];
  readonly towers: SimTower[] = [];
  readonly bush: SimBush;
  readonly lairs: SimLair[];
  readonly walls: SimWall[];
  readonly kinds: TowerKind[];
  /** Misty Clearing: lanterns and wisps (src/sim/fog.ts); null on the other maps */
  readonly fog: SimFog | null;
  /** Endless mode: waves generated past the map's own list */
  private readonly gen: TdWave[] = [];
  state: 'play' | 'lost' | 'won' = 'play';
  wave = 0;
  next: number;
  readonly queue: Queued[] = [];
  spawned = 0;
  fallen = 0;
  players: number;
  /** The heroes' strength (src/td/scaling.ts): +1 pack level per unit, more loot */
  rating = 1;
  /** Shared battle: each seat has its own raspberries; otherwise one treasury (seat 0) */
  readonly personal: boolean;
  private readonly purses = new Map<number, number>();
  /** Match loot (wiki/design-tower-defence.md, section 16): raspberries for the account — kills, waves, victory; not spendable in battle, paid only on victory */
  private readonly loots = new Map<number, number>();
  /** Hint to the player: not enough raspberries, tower at its limit (seat, text) */
  onToast: ((seat: number, text: string) => void) | null = null;
  /** A tower is being gnawed, frozen or broken */
  onAlarm: ((t: SimTower, why: 'hurt' | 'frozen' | 'ruin') => void) | null = null;
  /** Client of a network battle (src/cgame/net-battle.ts): a mirror of the server's defence — commands go to the server, waves are not counted */
  remote: ((c: TdCommand) => void) | null = null;
  /** Mirror: whether a wave is running — from the server snapshot */
  netRunning: boolean | null = null;
  private time = 0;
  private solidsCache: Obstacle[] = [];
  private solidsN = -1;
  private foeSolidsCache: Obstacle[] | null = null;
  private foeSolidsN = -1;
  private readonly w: SimWorld;
  private readonly undecoy: (() => void)[] = [];
  private readonly decoyOf = new Map<SimTower, () => void>();
  private undecoyTower(t: SimTower): void { this.decoyOf.get(t)?.(); this.decoyOf.delete(t); }

  constructor(w: SimWorld, spec: TdSpec, players: number, personal: boolean) {
    this.w = w;
    this.spec = spec;
    this.players = Math.max(1, Math.round(players));
    this.personal = personal;
    this.pads = spec.pads.map((p, i) => new SimPad(p, i));
    this.next = spec.rest ?? 20;
    this.bush = new SimBush(w, spec.bush.x, spec.bush.z, spec.bush.hp, spec.bush.y ?? 0);
    this.undecoy.push(addDecoy(this.bush, w.decoys));
    this.lairs = spec.lanes.map((l) => new SimLair(w, l));
    this.fog = spec.fog ? new SimFog(w, spec.fog) : null;
    this.kinds = (spec.towers ?? TOWER_ORDER.slice(0, BASE_TOWERS)).filter((k): k is TowerKind => k in TOWERS);
    this.walls = w.level ? (spec.walls ?? []).map((ws) => new SimWall(w, w.level!, ws)) : [];
    for (const wall of this.walls) {
      this.undecoy.push(addDecoy(wall, w.decoys));
      wall.onBreak = () => { this.breach(wall); };
      wall.onRepair = () => { this.solidsN = -1; };
    }
    this.bush.onDeath = () => { this.state = 'lost'; w.emit({ t: 'td.lost' }); };
    this.w.piles.onPick = (seat, n) => this.gain(seat, n);
    w.h.setScale(this.base, this.players);
  }

  dispose(): void { for (const f of this.undecoy) f(); for (const t of this.towers) { t.dispose(); this.undecoyTower(t); } }

  // ---------- treasury ----------
  private key(seat: number): number { return this.personal ? seat : 0; }
  berries(seat = 0): number { return this.purses.get(this.key(seat)) ?? 0; }
  /** Raspberries into the purse (bounty, sale, pickup); negative — pay */
  gain(seat: number, n: number): void { this.purses.set(this.key(seat), Math.max(0, this.berries(seat) + n)); }
  /** Pay if there is enough (towers, sutler); false — there is not */
  spend(seat: number, cost: number): boolean {
    if (cost <= 0) return true;
    if (this.berries(seat) < cost) { this.onToast?.(seat, t('Not enough raspberries: {cost} needed', { cost })); return false; }
    this.gain(seat, -cost);
    return true;
  }
  /** The map's starting treasury — to a seat (to each in a shared battle) */
  fund(seat: number): void { this.purses.set(this.key(seat), this.spec.berries); }
  /** Mirror of a network battle: a seat's raspberries — from the server snapshot */
  setBerries(seat: number, n: number): void { this.purses.set(this.key(seat), Math.max(0, n)); }
  get seats(): number[] { return [...this.purses.keys()]; }

  // ---------- match loot ----------
  /** A seat's loot so far */
  lootOf(seat = 0): number { return Math.floor(this.loots.get(this.key(seat)) ?? 0); }
  /** Loot to every seat (the battle is a team one: kills and waves count for everyone) */
  addLoot(n: number): void {
    if (n <= 0) return;
    // fractions accumulate: a 1-raspberry enemy at rating 3 gives 1.16
    for (const seat of this.purses.keys()) this.loots.set(seat, (this.loots.get(seat) ?? 0) + n);
  }
  /** Mirror of a network battle: a seat's loot — from the server snapshot */
  setLoot(seat: number, n: number): void { this.loots.set(this.key(seat), Math.max(0, n)); }
  /** An enemy fell: the pile of raspberries for the purse on the ground, its own loot (before scaling) — into the match loot */
  killed(at: THREE.Vector3, pile: number, base: number): void {
    this.fallen++;
    this.w.piles.drop(at, pile);
    if (this.state === 'play') this.addLoot(base * lootK(this.rating));
  }

  // ---------- geometry ----------
  get solids(): Obstacle[] {
    if (this.solidsN !== this.towers.length) { this.solidsCache = [this.bush.solid, ...this.towers.map((t) => t.solid)]; this.solidsN = this.towers.length; this.foeSolidsCache = null; }
    return this.solidsCache;
  }
  get foeSolids(): Obstacle[] {
    const base = this.solids;
    const gates = this.walls.filter((wl) => wl.solid && !wl.dead);
    if (!this.foeSolidsCache || this.foeSolidsN !== gates.length) { this.foeSolidsCache = base.concat(gates.map((wl) => wl.solid!)); this.foeSolidsN = gates.length; }
    return this.foeSolidsCache;
  }
  wall(id: string): SimWall | undefined { return this.walls.find((wl) => wl.wallId === id); }
  nearWall(pos: THREE.Vector3): SimWall | null { return this.walls.find((wl) => wl.hp < wl.maxHp && wl.near(pos)) ?? null; }
  repairCost(wl: SimWall): number { return Math.max(5, Math.ceil(((wl.maxHp - wl.hp) / 100) * (this.spec.repair ?? 20))); }
  lane(id: string): TdLane | undefined { return this.spec.lanes.find((l) => l.id === id); }
  /** Pad next to the hero (within 2 m of the edge) */
  nearPad(pos: THREE.Vector3): SimPad | null {
    let best: SimPad | null = null, bd = 2.2;
    for (const p of this.pads) { if (Math.abs(p.pos.y - pos.y) > 1.5) continue; const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  /** Where to walk to open the pad menu: a point on the edge on the hero's side */
  approach(p: SimPad, from: THREE.Vector3): THREE.Vector3 {
    const d = new THREE.Vector3(from.x - p.pos.x, 0, from.z - p.pos.z);
    if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
    return p.pos.clone().addScaledVector(d.normalize(), 1.7);
  }
  /** Ice on towers — sword targets */
  targets(): Target[] { return this.towers.filter((t) => t.frozen > 0).map((t) => t.ice); }

  private breach(wl: SimWall): void {
    for (const lane of this.spec.lanes) {
      if (lane.wall !== wl.wallId || !lane.inner) continue;
      const inner = lane.inner.map(([x, z]) => new THREE.Vector3(x, 0, z));
      for (const m of this.marching) if (m.march && m.laneId === lane.id && !m.ghost && m.march.length <= lane.points.length) m.extendMarch(inner.map((v) => v.clone()));
    }
  }
  /** Enemies on the march (out of the lairs) — to extend their lane on a breach */
  private readonly marching: import('./world.ts').MarchingMob[] = [];

  // ---------- commands ----------
  /** Action of the player in seat `seat`; false — it failed (the hint goes to onToast) */
  command(seat: number, c: TdCommand): boolean {
    if (this.remote) { this.remote(c); return true; }
    if (this.state !== 'play') return false;
    if (c.a === 'wave') return this.callWave(seat);
    if (c.a === 'lantern') return !!this.fog?.light(c.pad ?? -1);
    if (c.wall !== undefined) { const wl = this.wall(c.wall); return !!wl && this.repairWall(seat, wl); }
    const p = this.pads[c.pad ?? -1];
    if (!p) return false;
    if (c.a.startsWith('build:')) return !!this.build(seat, p, c.a.slice(6) as TowerKind);
    if (c.a === 'upgrade') return this.upgrade(seat, p);
    if (c.a === 'repair') return this.repairTower(seat, p);
    if (c.a === 'sell') return this.sell(seat, p) > 0;
    return false;
  }

  build(seat: number, p: SimPad, kind: TowerKind): SimTower | null {
    const def = TOWERS[kind];
    if (!def || p.tower || !this.kinds.includes(kind)) return null;
    if (!this.spend(seat, def.cost)) return null;
    const t = new SimTower(this.w, p.index, kind, p.pos.x, p.pos.z, p.pos.y);
    t.onAlarm = (why) => this.onAlarm?.(t, why);
    p.tower = t;
    this.towers.push(t);
    this.decoyOf.set(t, addDecoy(t, this.w.decoys));
    this.w.emit({ t: 'tower.build', id: t.id, x: p.pos.x, y: p.pos.y, z: p.pos.z, kind, cost: def.cost, seat });
    return t;
  }

  upgrade(seat: number, p: SimPad): boolean {
    const tw = p.tower;
    if (!tw || tw.ruined) return false;
    const cost = tw.nextCost;
    if (cost === null) { this.onToast?.(seat, t('Tower at its limit')); return false; }
    if (!this.spend(seat, cost)) return false;
    tw.upgrade();
    this.w.emit({ t: 'berry.spent', x: p.pos.x, y: p.pos.y + 1.6, z: p.pos.z, n: cost, seat });
    return true;
  }

  sell(seat: number, p: SimPad): number {
    const t = p.tower;
    if (!t) return 0;
    const back = Math.round(t.spent * SELL_BACK);
    this.gain(seat, back);
    this.removeTower(t);
    this.w.emit({ t: 'tower.sell', id: t.id, x: p.pos.x, y: p.pos.y, z: p.pos.z, n: back, seat });
    return back;
  }

  private removeTower(t: SimTower): void {
    this.towers.splice(this.towers.indexOf(t), 1);
    t.dispose();
    this.undecoyTower(t);
    const p = this.pads[t.pad];
    if (p) p.tower = null;
  }

  repairTower(seat: number, p: SimPad): boolean {
    const t = p.tower;
    if (!t?.ruined) return false;
    const cost = t.repairCost;
    if (!this.spend(seat, cost)) return false;
    t.repair();
    this.w.emit({ t: 'berry.spent', x: p.pos.x, y: p.pos.y + 1.6, z: p.pos.z, n: cost, seat });
    return true;
  }

  repairWall(seat: number, wl: SimWall): boolean {
    if (wl.hp >= wl.maxHp) return false;
    const cost = this.repairCost(wl);
    if (!this.spend(seat, cost)) return false;
    wl.repair();
    this.w.emit({ t: 'berry.spent', x: wl.pos.x, y: 2.6, z: wl.pos.z, n: cost, seat });
    return true;
  }

  /** Next wave now (G): the waiting bonus goes to the caller's purse */
  callWave(seat = 0): boolean {
    if (this.remote) { this.remote({ t: 'td', a: 'wave' }); return true; }
    if (this.state !== 'play' || this.waveRunning || this.wave >= this.waves.length) return false;
    const bonus = this.earlyBonus;
    if (bonus > 0) { this.gain(seat, bonus); this.w.emit({ t: 'wave.early', n: bonus, seat }); }
    this.startWave();
    return true;
  }

  /** Player count: the next waves use the new scale, living enemies right away */
  setPlayers(n: number): void {
    this.players = Math.max(1, Math.round(n));
    this.w.h.setScale(this.wave ? waveLevel(this.wave, this.base) : this.base, this.players);
  }

  /** The heroes' strength: the next waves use the new level, living enemies right away */
  setRating(r: number): void {
    this.rating = clampRating(r);
    this.setPlayers(this.players);
  }

  /** Pack level of the first wave: the map's base plus the heroes' strength */
  get base(): number { return (this.spec.level ?? 1) + this.rating - 1; }

  // ---------- enemies and waves ----------
  /** Enemy at a point (no lane: stands and waits for the hero) */
  spawn(kind: string, at: THREE.Vector3): import('./world.ts').MarchingMob | null { return this.w.h.spawnMob(kind, at); }

  /** Enemy from a lair onto a lane: marches along the points to the bush, notices the hero only within 3.5 m */
  spawnOn(kind: string, laneId: string): import('./world.ts').MarchingMob | null {
    const lane = this.lane(laneId);
    if (!lane) return null;
    const [sx, sz] = lane.points[0], r = this.w.rng;
    // no roads in the mist: every enemy comes out and wanders its own way, only the end by the bush is shared
    const sc = this.spec.fog ? 7 : 1.2;
    const px = sx + (r() - 0.5) * sc, pz = sz + (r() - 0.5) * sc;
    const m = this.w.h.spawnMob(kind, new THREE.Vector3(px, this.w.floor(px, pz), pz));
    if (!m) return null;
    this.spawned++;
    const wl = lane.wall ? this.wall(lane.wall) : undefined;
    const through = lane.inner && (!wl || wl.dead || m.ghost) ? lane.inner : [];
    m.march = [...lane.points, ...through].map(([x, z]) => new THREE.Vector3(x, 0, z));
    if (this.spec.fog) for (let i = 1; i < m.march.length - 1; i++) { const k = 1 - i / (m.march.length - 1); m.march[i].x += (r() - 0.5) * 9 * k; m.march[i].z += (r() - 0.5) * 9 * k; }
    m.laneId = lane.id;
    m.marchI = 1;
    m.aggro = Math.min(m.aggro, 3.5);
    m.yaw = Math.atan2(lane.points[1][0] - sx, lane.points[1][1] - sz);
    this.marching.push(m);
    if (this.marching.length > 400) this.marching.splice(0, this.marching.length - 400);
    this.lairs.find((l) => l.lane === lane)?.burst();
    if (isChief(kind)) this.w.emit({ t: 'chief', kind, title: m.title, lane: lane.title });
    return m;
  }

  get nextLanes(): TdLane[] | null {
    const w = this.waves[this.wave];
    if (!w) return null;
    const ids = new Set(w.groups.map((g) => g.lane));
    return this.spec.lanes.filter((l) => ids.has(l.id));
  }
  get waves(): readonly TdWave[] {
    const own = this.spec.waves ?? [];
    if (!this.spec.endless) return own;
    // endless: the map's own waves, then generated by number — always one ahead of the current
    if (this.gen.length < own.length) this.gen.push(...own.slice(this.gen.length));
    const ids = this.spec.lanes.map((l) => l.id);
    while (this.gen.length <= this.wave) this.gen.push(fogWave(this.gen.length + 1, ids));
    return this.gen;
  }
  /** Endless mode: the run never ends in victory, the loot is paid when the bush falls */
  get endless(): boolean { return !!this.spec.endless; }
  /** Whether the match loot goes to the camp: a saved bush, or any end of an endless run */
  get paid(): boolean { return this.state === 'won' || (this.state === 'lost' && this.endless); }
  /** The wave running now (or the last one) — its title and modifier */
  get current(): TdWave | undefined { return this.waves[this.wave - 1]; }
  get waveRunning(): boolean { if (this.netRunning !== null) return this.netRunning; return this.queue.length > 0 || this.w.h.foes().some((m) => !m.dead); }
  get earlyBonus(): number { return this.waveRunning || this.wave >= this.waves.length ? 0 : Math.round(this.next); }
  /** Next wave: who and how many (the HUD card) */
  preview(): { kind: string; n: number }[] {
    const w = this.waves[this.wave];
    if (!w) return [];
    const count = new Map<string, number>();
    for (const g of w.groups) count.set(g.kind, (count.get(g.kind) ?? 0) + (isChief(g.kind) ? g.count : scaledCount(g.count, this.players)));
    return [...count].map(([kind, n]) => ({ kind, n }));
  }

  private startWave(): void {
    const w = this.waves[this.wave];
    if (!w) return;
    this.wave++;
    this.w.h.setScale(waveLevel(this.wave, this.base), this.players);
    for (const g of w.groups) this.queue.push({ kind: g.kind, lane: g.lane, left: isChief(g.kind) ? g.count : scaledCount(g.count, this.players), t: g.delay ?? 0, every: g.every });
    this.w.emit({ t: 'wave.start', wave: this.wave, of: this.endless ? 0 : this.waves.length, title: w.title ?? '', mod: w.mod ?? '' });
    this.fog?.waveStarted(this.wave);
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
    const rest = this.spec.rest ?? 20;
    if (this.wave > 0 && !this.waveRunning && this.next >= rest) {
      // wave beaten: bounty to everyone and rest; the last one — victory
      const w = this.waves[this.wave - 1], bounty = this.personal ? w.bounty : scaledBounty(w.bounty, this.players);
      for (const seat of this.purses.keys()) this.gain(seat, bounty);
      this.addLoot(w.bounty * LOOT_WAVE * lootK(this.rating));
      this.w.piles.harvest();
      if (this.wave >= this.waves.length) {
        for (const seat of this.purses.keys()) this.loots.set(seat, Math.round((this.loots.get(seat) ?? 0) * (1 + LOOT_WIN)));
        this.state = 'won';
        this.w.emit({ t: 'td.won', n: bounty });
        return;
      }
      this.w.emit({ t: 'wave.won', wave: this.wave, n: bounty, rest });
      this.next = rest - 0.001;
      return;
    }
    if (this.waveRunning) { this.next = rest; return; }
    this.next -= dt;
    if (this.next <= 0) this.startWave();
  }

  update(dt: number): void {
    this.time += dt;
    this.tickWaves(dt);
    // lairs: the alarm builds for 6 s before a wave along their lanes and holds while the groups come out
    const soon = this.state === 'play' && !this.waveRunning && this.waves[this.wave]?.mod !== 'quiet' ? this.nextLanes : null;
    const busy = new Set(this.queue.map((q) => q.lane));
    for (const l of this.lairs) {
      const want = busy.has(l.lane.id) ? 1 : soon?.includes(l.lane) ? Math.max(0, Math.min(1, (6 - this.next) / 5)) : 0;
      l.warn += (want - l.warn) * Math.min(1, dt * 4);
    }
    for (const t of this.towers) t.update(dt);
    if (this.state === 'play') this.fog?.update(dt, (seat, n) => this.gain(seat, n));
  }

  /** Everything anew: towers demolished, enemies removed, treasury full */
  reset(): void {
    for (const t of this.towers.splice(0)) { t.dispose(); this.undecoyTower(t); }
    for (const p of this.pads) p.tower = null;
    this.queue.length = 0;
    this.marching.length = 0;
    this.wave = 0;
    this.next = this.spec.rest ?? 20;
    this.spawned = this.fallen = 0;
    for (const l of this.lairs) { l.warn = 0; l.spawned = 0; }
    this.w.h.setScale(this.base, this.players);
    for (const wl of this.walls) if (wl.hp < wl.maxHp) wl.repair();
    this.bush.reset();
    this.fog?.reset();
    this.gen.length = 0;
    this.w.piles.clear();
    for (const seat of this.purses.keys()) this.fund(seat);
    this.loots.clear();
    this.state = 'play';
    this.w.emit({ t: 'td.reset' });
  }

  entities(out: EntityState[]): void {
    out.push({ id: 'td', state: this.state, wave: this.wave, next: r1(this.next), running: this.waveRunning ? 1 : 0, players: this.players, rating: this.rating, spawned: this.spawned, fallen: this.fallen, early: this.earlyBonus });
    this.bush.entity(out);
    for (const wl of this.walls) wl.entity(out);
    for (const l of this.lairs) l.entity(out);
    for (const t of this.towers) t.entities(out);
    this.fog?.entities(out);
    for (const [seat, n] of this.purses) out.push({ id: `purse${seat}`, seat, n });
    for (const seat of this.purses.keys()) out.push({ id: `loot${seat}`, seat, n: this.lootOf(seat) });
  }
}
