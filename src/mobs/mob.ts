import * as THREE from 'three';
import { rnd } from '../rng.ts';
import { resolveCircle } from '../collision.ts';
import { HERO } from '../tuning.ts';
import { boom, hiss } from '../spell-audio.ts';
import { Boss, C, rand, RASP, wrap, type BossHooks } from '../bosses/kit.ts';
import { Field } from '../bosses/field.ts';
import type { Target } from '../target.ts';
import { pickDecoy, type Decoy } from '../decoys.ts';
import type { Knight } from '../knight.ts';
import { t } from '../i18n/i18n.ts';

/**
 * Rank-and-file mob of the Raspberry Order (wiki/design-mobs.md): a lightened mini-boss brain — no arena, rage or heart.
 * Stands until it sees the hero (or until hit), then a chase keeping distance → an attack with a mark on the floor →
 * sometimes a stun → death: crumbles into cubes, raspberries drop out. One attack and one trick; the body is 1–6 moving parts.
 */

export type MobState = 'spawn' | 'idle' | 'walk' | 'attack' | 'daze' | 'dead';
/** Movement mode chosen by the brain: stand, march along the road, patrol, chase keeping distance, along a detour path */
export type MobMode = 'hold' | 'march' | 'patrol' | 'chase' | 'path';
/** The brain thinks this many seconds apart (bot_thinktime in Quake 3); the mover and attacks run every tick */
export const THINK_S = 0.1;
/** Detour paths per world tick — for all mobs together */
export const ROUTE_BUDGET = 4;
/** Cap on expanded cells for one mob path (the hero has 30000): it does not hold farther targets anyway */
export const ROUTE_EXPAND = 2500;
/** Path not found or budget exhausted — the next request no sooner than this many seconds later */
const ROUTE_RETRY_S = 1.5;

export interface MobHooks extends BossHooks {
  /** Living mobs of the pack (allies: the healer heals, the summoner counts its own) */
  allies(): readonly Mob[];
  /** Summon a mob into the pack */
  spawn(kind: string, at: THREE.Vector3): Mob | null;
  /** Detour path around walls (budget per world tick): points; null — no navigation or budget exhausted */
  route?(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] | null;
  /** Party (shared battle): other players' heroes — the mob chases the nearest one on its feet; empty — only its own hero */
  heroes?(): readonly Knight[];
  /** Hit a party hero (not its own): damage already scaled by the mob */
  hurtKnight?(k: Knight, dmg: number, from: THREE.Vector3, knock: number): void;
}

/** Nearest hero on its feet to point at among its own and the party; all exhausted — its own */
export function nearestHero(at: THREE.Vector3, local: Knight, others: readonly Knight[]): Knight {
  let best = local, bd = local.down ? Infinity : Math.hypot(local.pos.x - at.x, local.pos.z - at.z);
  for (const k of others) {
    if (k.down) continue;
    const d = Math.hypot(k.pos.x - at.x, k.pos.z - at.z);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

/** Green light of healing */
export const HEAL = C(0.9, 3.4, 1.1);
/** Blue frost of the slow */
const FROST = C(1.6, 3, 4);

export abstract class Mob extends Boss {
  /** id in the registry (src/mobs/roster.ts) */
  abstract readonly kind: string;
  /** Cost in the horde budget (wiki/design-dungeon.md, section 5) */
  abstract readonly cost: number;
  override readonly subtitle: string = t('warrior of the Order');
  state: MobState = 'spawn';
  attack = '';
  st = 0;
  cd = 0.8;
  /** Run speed, m/s; turn rate, rad/s; distance it keeps */
  speed = 3;
  turn = 5;
  keep = 1.6;
  /** Sees the hero from this distance; once hit — always sees */
  aggro = 14;
  /** Noticed the hero */
  alerted = false;
  /** Patrol route: until it notices the hero, walks the points in a loop (src/level/playground-map.ts, MobPost.route) */
  route: THREE.Vector3[] | null = null;
  private routeI = 0;
  /**
   * One-way march (Bush Defence, src/td/): walks the points at full speed, notices the hero only within aggro; at the end of the road —
   * alarm, and the bush decoy (src/decoys.ts) becomes the target. Hit by the hero it chases him; he ran farther than leash — back to the road
   */
  march: THREE.Vector3[] | null = null;
  marchI = 0;
  /** The road it walks (id from meta.td.lanes) — to continue the march after a breach */
  laneId: string | null = null;
  leash = 10;
  private marchDone = false;
  /** Raspberries from the mob (before scaling) */
  loot = 1;
  /** Summoned — no raspberries */
  summoned = false;
  /** Crumbled — the pack will remove it */
  gone = false;
  /** Weight: knockback from a hit and jostling in the pack */
  mass = 1;
  /** Knight of the Order: the bannerman's banner inspires it */
  readonly knight: boolean = false;
  /** Inspired by the banner (seconds): damage and speed +25 % */
  rally = 0;
  /** Ghost: flies through walls */
  ghost = false;
  /** Tower hunter: siege decoys (defence towers, src/td/tower.ts) pull it off the road */
  hunter = false;
  /** How far above or below itself the hunter reaches a tower, m */
  reachY = 1.5;
  /** Under the obelisk dome (seconds): damage to the mob ×0.5 */
  ward = 0;
  /** Slowed by the "Chill" aura: loses a chillK share of speed, chillT s left */
  chillK = 0;
  chillT = 0;
  protected readonly body = new THREE.Group();
  protected readonly field: Field;
  protected readonly mh: MobHooks;
  protected hitDone = false;
  /** The summon the mob targets (null — the hero) */
  protected focus: Decoy | null = null;
  /** Shared battle: the nearest party hero (shared battle, MobHooks.heroes); null — its own hero */
  protected prey: Knight | null = null;
  /** Network id in the pack (snapshot records, src/game/match.ts) */
  net = 0;
  /**
   * Puppet (network battle client): no brain — position, facing and health come from the server snapshot (`puppetStep`),
   * client hits only flash, the server counts damage
   */
  puppet = false;
  readonly pupTo = new THREE.Vector3();
  pupYaw = 0;
  /** Puppet: what it aims at (windup, marks and hits follow it, for show only), the attack from the snapshot and its number */
  readonly pupAim = new THREE.Vector3();
  pupAttack = '';
  pupSeq = 0;
  /** Puppet: step direction from the snapshot (server intent) — gait and turning like a live one */
  readonly pupMove = new THREE.Vector2();
  /** Brain intent (thinks once per THINK_S): movement mode; move — where the mover stepped this tick (into the snapshot, for the gait) */
  readonly intent = { mode: 'hold' as MobMode, move: new THREE.Vector2() };
  private thinkT = 0;
  /** Detour path (path mode): points and where it leads */
  private path: THREE.Vector3[] = [];
  private readonly pathTo = new THREE.Vector3();
  /** Chase stuck: how many seconds without progress toward the target */
  private stuckT = 0;
  private stuckFrom = new THREE.Vector3();
  /** Puppet: stunned, slowed, inspired, noticed the hero — from the snapshot (sparks and ice are the same as a live one's) */
  pupDaze = false;
  pupAlerted = false;
  private seenSeq = 0;
  /** Attack number: grows with each one — the guest's puppet restarts the same attack by it */
  attackSeq = 0;
  /** Height above the floor (a hop, a moth's flight); the body stands at `ground + flyY` */
  protected flyY = 0;
  /**
   * Floor under the feet (`Terrain.floorAt`): mobs walk on the terrain like the hero — up stairs, half-blocks and ramps
   * a step of 0.5 m at most, down any height. Over a chasm the last floor is kept
   */
  ground = 0;
  private dazeFor = 0;
  private deathT = 0;
  /** Healing accumulates and is shown as a number once per 0.5 s */
  private healed = 0;
  private healT = 0;

  constructor(h: MobHooks, hp: number, at: THREE.Vector3, yaw = rnd() * Math.PI * 2) {
    super(h, hp, at.clone().setY(0), yaw);
    // decoys (src/decoys.ts): while the mob targets a summon, the "hero" for it is the decoy, and its hits go to it
    // shared battle: the "hero" is the nearest of the party (MobHooks.heroes), that is who we hit
    const base = this.h, me = this, local = base.hero;
    const hero = new Proxy(base.hero, {
      get(t, p) {
        if (me.puppet) { if (p === 'pos') return me.pupAim; if (p === 'down') return false; }
        const f = me.focus;
        if (f?.alive) { if (p === 'pos') return f.pos; if (p === 'down') return false; }
        const k = me.prey ?? t;
        const v = Reflect.get(k, p, k) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(k) : v;
      },
    });
    (this as unknown as { h: typeof base }).h = {
      ...base, hero,
      hurtHero: (dmg, from, knock) => {
        // the puppet hits for show only: the host counts damage
        if (me.puppet) return;
        const f = me.focus;
        if (f?.alive) f.hurt(dmg, from);
        else if (me.prey && me.prey !== local) h.hurtKnight?.(me.prey, dmg * me.dmgMult, from, knock);
        else base.hurtHero(dmg, from, knock);
      },
    };
    this.mh = h;
    this.field = new Field(this.h);
    this.awake = true;
    this.pos.copy(this.home);
    const f = h.terrain.floorAt(at.x, at.z, at.y);
    this.ground = f > -Infinity ? f : 0;
    this.pos.y = this.ground;
    this.yaw = yaw;
    this.setPlayers(1);
    this.group.add(this.body);
    // own thinking phase so the whole pack does not think in the same tick
    this.thinkT = rnd() * THINK_S;
  }

  /** Attack choice when the cooldown is over (null — keep walking) */
  protected abstract choose(dist: number, rel: number): string | null;
  /** Attack progress: t — time since start; true — the attack is over */
  protected abstract act(name: string, t: number, dt: number, dist: number): boolean;
  /** Pose of the body parts (once per frame); walk — moving */
  protected abstract animate(dt: number, walk: boolean): void;
  /** Cooldown after an attack */
  protected rest(): number { return rand(0.8, 1.4); }
  /** Share of damage that goes through (a shield in front — less) */
  protected guard(_dir: THREE.Vector3): number { return 1; }

  get quiet(): boolean { return this.h.quiet(); }
  /** Damage to heroes: scaling and banner */
  override get dmgMult(): number { return super.dmgMult * (this.rally > 0 ? 1.25 : 1); }
  /** Run speed with the banner */
  get pace(): number { return this.speed * (this.rally > 0 ? 1.25 : 1) * this.slowMul; }
  /** March speed: those that do not walk on their own (the slime hops, the vine grows) still crawl along the road */
  protected get marchPace(): number { return this.pace; }
  /** Speed multiplier from cold */
  get slowMul(): number { return this.chillT > 0 ? 1 - this.chillK : 1; }
  /** Hero slow from the mob's zones (0..1) */
  get heroSlow(): number { return this.field.heroSlow; }
  /** Extra targets besides the mob itself (a planted banner) */
  extras(): Target[] { return []; }

  /** Share of the road covered (0..1) on the march; towers hit the one with the most */
  get progress(): number {
    const r = this.march;
    if (!r || !r.length) return 0;
    if (this.marchI >= r.length) return 1;
    const t = r[this.marchI], prev = r[this.marchI - 1];
    const seg = prev ? Math.hypot(t.x - prev.x, t.z - prev.z) : 1;
    const frac = prev && seg > 0 ? Math.max(0, Math.min(1, 1 - Math.hypot(t.x - this.pos.x, t.z - this.pos.z) / seg)) : 0;
    return (this.marchI - (prev ? 1 : 0) + frac) / r.length;
  }

  /** Noticed the hero — and neighbours within 8 m too. byHit — from a hit: on the march a tower shot from afar does not distract */
  notice(byHit = false): void {
    if (this.alerted || this.dead) return;
    if (this.march && byHit) { const hp = this.mh.hero.pos; if (Math.hypot(hp.x - this.pos.x, hp.z - this.pos.z) > this.aggro + 2) return; }
    this.alerted = true;
    this.thinkT = 0;
    for (const m of this.mh.allies()) if (m !== this && Math.hypot(m.pos.x - this.pos.x, m.pos.z - this.pos.z) < 8) m.notice();
  }

  wake(): void { this.notice(); }

  /** The road continued (a breach in the wall was made, src/td/wall.ts): new march points, alarm cleared — on the way again */
  extendMarch(points: THREE.Vector3[]): void {
    if (!this.march || this.dead) return;
    this.march.push(...points);
    this.marchDone = false;
    this.alerted = false;
    this.focus = null;
    this.thinkT = 0;
    if (this.state === 'attack') { this.field.clear(); this.go('idle'); }
  }
  /** Join the road of the same march as `from` (spawned on the way: slime halves, minions) */
  joinMarch(from: Mob): void {
    if (!from.march) return;
    this.march = from.march.map((v) => v.clone());
    this.marchI = from.marchI;
    this.laneId = from.laneId;
    this.aggro = Math.min(this.aggro, from.aggro);
  }
  reset(): void { /* a rank-and-file mob does not come back: the pack removes it entirely */ }

  /** A hit without direction (zero dir) is piercing: armour and shields do not absorb it (wall ballista, src/td/tower.ts) */
  override hit(dmg: number, dir: THREE.Vector3, point: THREE.Vector3, knock: number): void {
    if (this.dead || this.state === 'spawn') return;
    if (this.puppet) { this.flashT = 0.1; return; }
    const k = (dir.lengthSq() < 1e-6 ? 1 : this.guard(dir)) * (this.ward > 0 ? 0.5 : 1);
    if (k < 1) {
      this.h.fx.text(point.clone().setY(point.y + 0.5), this.ward > 0 && this.guard(dir) >= 1 ? t('dome') : t('block'), '');
      this.h.fx.burst(point, ['#ffffff', '#e8b84a'], 6, { speed: 3, up: 2, size: 0.07, life: 0.3, glow: true, gravity: 8 });
      if (!this.quiet) boom(900, 500, 0.12, 0.15);
    }
    super.hit(dmg * k, dir, point, knock);
    // knockback: a light one — farther; update will correct for walls
    this.pos.addScaledVector(dir, (0.15 + knock * 0.5) * k / this.mass);
    this.notice(true);
  }

  /** Fall without a hit (the master fell, burst on its own): bypasses the shield and the spawn-in */
  vanish(): void {
    if (this.dead) return;
    this.hp = 0;
    this.dead = true;
    this.die();
  }

  /** Healing: health no higher than full, green sparks, a number */
  heal(n: number): void {
    if (this.dead || this.hp >= this.maxHp) return;
    const v = Math.min(n, this.maxHp - this.hp);
    this.hp += v;
    this.healed += v;
    if (rnd() < 0.3) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(rand(-0.4, 0.4), rand(0.4, this.topY), rand(-0.4, 0.4))), vel: new THREE.Vector3(0, 1.2, 0), life: 0.5, size: 0.1, color: HEAL, gravity: 0 });
  }

  protected go(s: MobState, attack = ''): void { this.state = s; this.attack = attack; this.st = 0; this.hitDone = false; if (s === 'attack') this.attackSeq++; }
  /** Shared battle: the party hero it chases (null — the host's own hero) */
  get target(): Knight | null { return this.prey; }
  /** What it aims at (party hero or decoy) — for the host snapshot */
  get aimPos(): THREE.Vector3 { return this.h.hero.pos; }
  chill(k: number, sec: number): void {
    if (this.dead) return;
    this.chillK = this.chillT > 0 ? Math.max(this.chillK, k) : k;
    this.chillT = Math.max(this.chillT, sec);
  }

  /** Stun: stands still, sparks circle over the head */
  daze(sec: number): void { if (this.dead) return; this.dazeFor = sec; this.flyY = 0; this.go('daze'); }
  /** Stun from an aura (the "Chill" freeze, the "Stone Stride" shove): no shorter than the one already running */
  stun(sec: number): void { if (this.state === 'spawn' || (this.state === 'daze' && this.dazeFor - this.st >= sec)) return; this.daze(sec); }

  protected die(): void {
    this.flyY = 0;
    this.go('dead');
    this.field.clear();
    if (!this.quiet) { boom(160, 60, 0.3, 0.25); hiss({ dur: 0.3, vol: 0.12, f: 1800, f1: 400, q: 0.6, type: 'lowpass' }); }
  }

  /** Remove from the scene (the pack calls it when the mob crumbled or the pack is cleared) */
  dispose(): void {
    this.field.clear();
    this.h.scene.remove(this.group);
    for (const m of this.flashMats) m.dispose();
    for (const s of this.shimmers) s.mat.dispose();
  }

  // ---------- brain and mover ----------
  /**
   * Tick: the brain (once per THINK_S — target, alarm, movement mode, attack choice), then the mover (every tick — a step by mode,
   * walls, not climbing onto the hero), attacks and stun on their own timers every tick. Like a Quake 3 bot: thinks less often than it moves
   */
  update(dt: number): void {
    this.st += dt;
    this.ward -= dt;
    this.auraFx(dt);
    const hero = this.h.hero.pos;
    let walk = false;
    switch (this.state) {
      case 'spawn':
        // climbs out of the ground
        this.body.position.y = -this.topY * Math.max(0, 1 - this.st / 0.45);
        if (this.st > 0.45) { this.body.position.y = 0; this.go('idle'); }
        break;
      case 'idle':
      case 'walk': {
        // the cooldown runs only in the chase (as before): on the march the first hit at the bush is not instant
        if (this.alerted && !this.h.hero.down) this.cd -= dt;
        this.thinkT -= dt;
        if (this.thinkT <= 0) { this.thinkT += THINK_S; this.think(); }
        // the thought may have started an attack — then the mover does not go this tick
        if ((this.state as MobState) !== 'attack') { walk = this.mover(dt); this.state = walk ? 'walk' : 'idle'; }
        break;
      }
      case 'attack': {
        const dx = hero.x - this.pos.x, dz = hero.z - this.pos.z;
        if (this.act(this.attack, this.st, dt, Math.hypot(dx, dz)) && this.state === 'attack') { this.cd = this.rest(); this.go('idle'); }
        break;
      }
      case 'daze':
        this.dazeFx();
        if (this.st > this.dazeFor) { this.cd = 0.4; this.go('idle'); }
        break;
      case 'dead': this.dying(dt); break;
    }
    this.field.update(dt);
    if (this.state !== 'dead') this.collide(hero);
    this.healT -= dt;
    if (this.healed >= 1 && this.healT <= 0) { this.h.fx.text(this.pos.clone().setY(this.ground + this.topY + 0.3), `+${Math.round(this.healed)}`, 'heal'); this.healed = 0; this.healT = 0.5; }
    this.tickLook(dt, this.state === 'dead' ? Math.max(0.1, 1 - this.st * 2) : 1);
    this.animate(dt, walk);
    this.place();
  }

  /** Brain: target (party hero or decoy), alarm and leash, movement mode, attack choice, a detour path if stuck */
  protected think(): void {
    const others = this.mh.heroes?.() ?? [];
    if (others.length) { const n = nearestHero(this.pos, this.mh.hero, others); this.prey = n === this.mh.hero ? null : n; } else this.prey = null;
    this.focus = pickDecoy(this.pos, this.h.hero.pos, this.aggro, this.hunter, this.reachY);
    const hero = this.h.hero.pos;
    const dx = hero.x - this.pos.x, dz = hero.z - this.pos.z, dist = Math.hypot(dx, dz);
    if (!this.alerted && dist < this.aggro && Math.abs(hero.y - this.pos.y) < 2) this.notice();
    // the hunter saw a tower — turns off the road toward it (does not alarm neighbours); the tower fell — focus empty, march again
    if (!this.alerted && this.focus?.siege && dist < (this.focus.taunt ?? 0)) this.alerted = true;
    // on the march: the hero ran beyond the leash, no decoy — alarm cleared, back to the road
    if (this.march && this.alerted && !this.focus && dist > this.leash) this.alerted = false;
    if (!this.alerted || this.h.hero.down) { this.intent.mode = this.march ? 'march' : !this.alerted ? 'patrol' : 'hold'; this.path = []; return; }
    if (this.cd <= 0) {
      const rel = wrap(Math.atan2(dx, dz) - this.yaw);
      const a = this.choose(dist, rel);
      if (a) { this.go('attack', a); this.intent.mode = 'hold'; return; }
    }
    // chase; stuck at a wall (half a second without progress toward the target) — a detour path while there is budget
    if (this.intent.mode === 'path' && this.path.length && this.pathTo.distanceTo(hero) < 1.5) return;
    this.intent.mode = 'chase';
    if (this.stuckT >= 0.5 && this.mh.route) {
      const p = this.mh.route(this.pos, hero);
      if (p && p.length) { this.path = p; this.pathTo.copy(hero); this.intent.mode = 'path'; this.stuckT = 0; }
      else this.stuckT = -ROUTE_RETRY_S;
    }
  }

  /**
   * Mover (every tick): a step by the brain's mode — march and patrol along points, chase keeping distance (`steer`,
   * subclasses override), detour path. Records `intent.move` — where it stepped (for the gait and the snapshot). true — it moved
   */
  protected mover(dt: number): boolean {
    const x0 = this.pos.x, z0 = this.pos.z;
    let walk = false;
    switch (this.intent.mode) {
      case 'march': walk = this.marching(dt); break;
      case 'patrol': walk = this.patrol(dt); break;
      case 'chase': {
        const hero = this.h.hero.pos, dx = hero.x - this.pos.x, dz = hero.z - this.pos.z, dist = Math.hypot(dx, dz);
        walk = this.steer(dt, dist, dx, dz, wrap(Math.atan2(dx, dz) - this.yaw));
        // not progressing toward the target although it wants to go — "stuck" accumulates
        if (walk) {
          if (this.stuckT <= 0 && this.stuckT > -dt) this.stuckFrom.copy(this.pos);
          this.stuckT += dt;
          const was = Math.hypot(hero.x - this.stuckFrom.x, hero.z - this.stuckFrom.z);
          if (this.stuckT > 0 && was - dist > 0.3) this.stuckT = 0;
        } else if (this.stuckT > 0) this.stuckT = 0;
        break;
      }
      case 'path': walk = this.followPath(dt); break;
      default: break;
    }
    const sx = this.pos.x - x0, sz = this.pos.z - z0, len = Math.hypot(sx, sz);
    const full = this.pace * dt;
    if (len > 1e-5 && full > 1e-6) this.intent.move.set(sx / len, sz / len).multiplyScalar(Math.min(1, len / full)); else this.intent.move.set(0, 0);
    return walk;
  }

  /** Along the detour path points at almost full speed; path ended — chase again */
  private followPath(dt: number): boolean {
    while (this.path.length > 1 && Math.hypot(this.path[0].x - this.pos.x, this.path[0].z - this.pos.z) < 0.5) this.path.shift();
    const t = this.path[0];
    if (!t) { this.intent.mode = 'chase'; return false; }
    const dx = t.x - this.pos.x, dz = t.z - this.pos.z, d = Math.hypot(dx, dz);
    if (this.path.length === 1 && d < 0.6) { this.path = []; this.intent.mode = 'chase'; return false; }
    const want = wrap(Math.atan2(dx, dz) - this.yaw), m = this.turn * 1.5 * dt;
    this.yaw += Math.max(-m, Math.min(m, want));
    const sp = this.pace * dt * (Math.abs(want) > 1.2 ? 0.5 : 1);
    this.pos.x += (dx / d) * Math.min(sp, d); this.pos.z += (dz / d) * Math.min(sp, d);
    return true;
  }

  /** Not through walls (except ghosts): blocks — by the terrain with a step, towers and decor — by obstacles; does not climb onto the hero — yields to him */
  private collide(hero: THREE.Vector3): void {
    const p = new THREE.Vector3(this.pos.x, this.ground, this.pos.z);
    if (!this.ghost) this.solid(p);
    const d = Math.hypot(hero.x - p.x, hero.z - p.z), R = this.radius + HERO.radius;
    if (d < R && d > 1e-3) { const k = (R - d) / d; p.x -= (hero.x - p.x) * k; p.z -= (hero.z - p.z) * k; }
    this.pos.x = p.x; this.pos.z = p.z;
  }

  /** The puppet became a live enemy (the guest became the host): the brain starts from what was in the snapshot */
  unpuppet(): void {
    this.puppet = false;
    this.alerted = this.pupAlerted;
    if (!this.dead && this.state !== 'spawn') { this.field.clear(); this.go('idle'); }
  }

  /** Sparks of cold and of the banner (for a live one and a puppet) */
  private auraFx(dt: number): void {
    if (this.chillT > 0) {
      this.chillT -= dt;
      if (rnd() < 0.2) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(rand(-0.4, 0.4), rand(0.2, this.topY), rand(-0.4, 0.4))), vel: new THREE.Vector3(0, -0.4, 0), life: 0.5, size: 0.07, color: FROST, gravity: 0 });
    }
    if (this.rally > 0) {
      this.rally -= dt;
      if (rnd() < 0.15) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(rand(-0.3, 0.3), this.topY + 0.1, rand(-0.3, 0.3))), vel: new THREE.Vector3(0, 0.8, 0), life: 0.5, size: 0.08, color: RASP, gravity: 0 });
    }
  }

  /** Stun stars over the head */
  private dazeFx(): void {
    if (rnd() < 0.2) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(Math.cos(this.time * 7) * 0.4, this.topY + 0.25, Math.sin(this.time * 7) * 0.4)), vel: new THREE.Vector3(0, 0.2, 0), life: 0.35, size: 0.08, color: C(3.4, 3, 1.2), gravity: 0 });
  }

  /** Puppet frame (shared battle guest): toward the position and facing from the snapshot, step and pose are its own; fell — crumbles like a live one */
  puppetStep(dt: number): void {
    this.st += dt;
    this.auraFx(dt);
    if (this.pupDaze && this.state !== 'dead') this.dazeFx();
    let walk = false;
    if (this.state === 'spawn') {
      this.body.position.y = -this.topY * Math.max(0, 1 - this.st / 0.45);
      if (this.st > 0.45) { this.body.position.y = 0; this.go('idle'); }
    } else if (this.state === 'dead') this.dying(dt);
    else {
      // attack from the snapshot: the same on the puppet — windup, marks on the floor, lunges; hits wound nobody
      if (this.pupAttack && this.pupSeq !== this.seenSeq) { this.seenSeq = this.pupSeq; this.go('attack', this.pupAttack); }
      // a step by the server intent with the same motion as a live one, then a pull toward the position from the snapshot buffer (like other players' heroes)
      const mv = this.pupMove, sp = this.pace * dt;
      if (this.state !== 'attack') { this.pos.x += mv.x * sp; this.pos.z += mv.y * sp; }
      const dx = this.pupTo.x - this.pos.x, dz = this.pupTo.z - this.pos.z, d = Math.hypot(dx, dz), k = d > 4 ? 1 : Math.min(1, dt * 12);
      this.pos.x += dx * k; this.pos.z += dz * k;
      this.ground = this.floorUnder();
      this.flyY += (this.pupTo.y - this.ground - this.flyY) * Math.min(1, dt * 10);
      this.yaw += wrap(this.pupYaw - this.yaw) * Math.min(1, dt * 10);
      if (this.state === 'attack') {
        const dist = Math.hypot(this.pupAim.x - this.pos.x, this.pupAim.z - this.pos.z);
        if (this.act(this.attack, this.st, dt, dist) && this.state === 'attack') this.go('idle');
      } else {
        walk = mv.lengthSq() > 0.01 || d > 0.3;
        this.state = walk ? 'walk' : 'idle';
      }
    }
    this.field.update(dt);
    this.tickLook(dt, this.state === 'dead' ? Math.max(0.1, 1 - this.st * 2) : 1);
    this.animate(dt, walk);
    this.place();
  }

  /** Walk toward the hero and keep distance; ranged ones back off when too close. true — it moved */
  protected steer(dt: number, dist: number, dx: number, dz: number, rel: number): boolean {
    this.face(dt);
    const sp = this.pace * dt;
    if (Math.abs(rel) < 1.2 && dist > this.keep + 0.3) { this.pos.x += (dx / dist) * sp; this.pos.z += (dz / dist) * sp; return true; }
    if (this.keep > 4 && dist < this.keep - 2) { this.pos.x -= (dx / dist) * sp * 0.7; this.pos.z -= (dz / dist) * sp * 0.7; return true; }
    return false;
  }

  /** Patrol step toward the next route point (at half speed); reached it — to the next in the loop. true — it moved */
  protected patrol(dt: number): boolean {
    const r = this.route;
    if (!r || !r.length) return false;
    const t = r[this.routeI % r.length], dx = t.x - this.pos.x, dz = t.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.7) { this.routeI = (this.routeI + 1) % r.length; return false; }
    const want = wrap(Math.atan2(dx, dz) - this.yaw), m = this.turn * dt;
    this.yaw += Math.max(-m, Math.min(m, want));
    if (Math.abs(want) > 1) return true;
    const sp = this.pace * 0.55 * dt;
    this.pos.x += (dx / d) * sp; this.pos.z += (dz / d) * sp;
    return true;
  }

  /** March step toward the next road point (at almost full speed); end of the road — alarm: the bush decoy is nearby. true — it moved */
  protected marching(dt: number): boolean {
    const r = this.march!;
    if (this.marchI >= r.length) { if (!this.marchDone) { this.marchDone = true; this.notice(); } return false; }
    const t = r[this.marchI], dx = t.x - this.pos.x, dz = t.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.6) { this.marchI++; return true; }
    const want = wrap(Math.atan2(dx, dz) - this.yaw), m = this.turn * 1.5 * dt;
    this.yaw += Math.max(-m, Math.min(m, want));
    const sp = this.marchPace * 0.85 * dt * (Math.abs(want) > 1.2 ? 0.4 : 1);
    this.pos.x += (dx / d) * sp; this.pos.z += (dz / d) * sp;
    return true;
  }

  /** Dash along dir: speed m/s; true — ran into a wall */
  protected dash(dir: THREE.Vector3, speed: number, dt: number): boolean {
    const step = speed * this.slowMul * dt;
    this.move(dir, step);
    const p = new THREE.Vector3(this.pos.x, this.ground, this.pos.z);
    this.solid(p);
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z) > step * 0.5;
  }

  /** Push the body (feet at p.y) out of level blocks by the terrain and out of towers, gates and decor */
  private solid(p: THREE.Vector3): void {
    resolveCircle(p, this.radius, this.h.obstacles(), true);
    this.h.terrain.resolve(p, this.radius);
  }

  /** Floor under the current point: climbs a step, drops any height; over a chasm — the last floor */
  private floorUnder(): number {
    const f = this.h.terrain.floorAt(this.pos.x, this.pos.z, this.ground);
    return f > -Infinity ? f : this.ground;
  }

  protected place(): void {
    if (!this.puppet) this.ground = this.floorUnder();
    this.pos.y = this.ground + this.flyY;
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.group.rotation.y = this.yaw;
  }

  protected face(dt: number, k = 1): void {
    const hero = this.h.hero.pos;
    const d = wrap(Math.atan2(hero.x - this.pos.x, hero.z - this.pos.z) - this.yaw), m = this.turn * k * dt;
    this.yaw += Math.max(-m, Math.min(m, d));
  }

  /** Step: sway phase from time (legs, arms) */
  protected stride(speed = 9): number { return Math.sin(this.time * speed); }

  private dying(dt: number): void {
    // topples sideways and crumbles into cubes, raspberries go to the pack
    this.body.rotation.z = Math.min(1, this.st / 0.35) * 1.2;
    if (this.st > 0.35 && this.deathT === 0) {
      this.deathT = 1;
      const c = this.pos.clone().setY(this.ground + this.topY * 0.5);
      this.h.fx.burst(c, [RASP, '#ffffff', ...this.flashMats.slice(0, 2).map((m) => m.color.clone())], 18, { speed: 3.5, up: 3.5, size: 0.11, life: 0.7, gravity: 8 });
      this.onDeath?.(new THREE.Vector3(this.pos.x, this.ground, this.pos.z));
    }
    if (this.deathT > 0) {
      this.deathT += dt;
      const k = Math.max(0, 1 - (this.deathT - 1) / 0.2);
      this.body.scale.setScalar(k);
      if (k <= 0) this.gone = true;
    }
  }
}
