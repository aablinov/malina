import * as THREE from 'three';
import { CFG, type Collider } from './config';
import type { Beetle, RangedStats } from './beetle';
import type { Bush } from './bush';
import type { FX } from './fx';
import type { Player } from './player';
import type { Textures } from './textures';
import { AMMO, AMMO_TYPES, levelMul, modCdMul, type AmmoType, type GunSound, type WeaponDef } from './weapons';

export type SoundKey = GunSound | 'ricochet' | 'empty' | 'explosion' | 'missile' | 'hook' | 'beam' | 'spit' | 'pickup' | 'heat' | 'spinup' | 'zap' | 'splat';

/** Что бою нужно от игры */
export interface CombatHooks {
  scene: THREE.Scene;
  fx: FX;
  player: Player;
  T: Textures;
  beetles(): readonly Beetle[];
  bushes(): readonly (Bush | null)[];
  weapon(): WeaponDef;
  level(): number;
  aim(): THREE.Vector3;
  hovered(): Beetle | null;
  ammo(t: AmmoType): number;
  /** Потратить патроны; false — не хватило */
  useAmmo(t: AmmoType, n: number): boolean;
  addAmmo(t: AmmoType, n: number): void;
  damageBeetle(b: Beetle, dmg: number, dir: THREE.Vector3, big?: boolean): void;
  hurtPlayer(d: number): void;
  hurtBush(b: Bush, d: number): void;
  sound(k: SoundKey): void;
  light(pos: THREE.Vector3, color: THREE.Color, intensity: number, dur: number): void;
  owned(t: AmmoType): boolean;
  /** Препятствия на поле: деревья, камни, домик, прилавок, фонари */
  colliders(): readonly Collider[];
}

type ProjKind = 'bullet' | 'pellet' | 'plasma' | 'grenade' | 'bfg' | 'missile' | 'slug';

interface Proj {
  kind: ProjKind;
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  dmg: number;
  travelled: number;
  range: number;
  radius: number;
  pierce: number;
  hit: Set<Beetle>;
  explode?: { r: number; dmg: number };
  /** Граната: сколько до взрыва */
  fuse?: number;
  /** Ракета: за кем летит */
  homing?: Beetle | null;
  /** Шар Б-9000: таймер разрядов */
  zapT?: number;
  color: THREE.Color;
  /** Уже отскакивал — второй раз не отскочит */
  ricocheted?: boolean;
}

interface EnemyShot {
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  travelled: number;
  r: RangedStats;
  atPlayer: boolean;
}

interface Pickup {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  type: AmmoType | 'health';
  amount: number;
  t: number;
  vel: THREE.Vector3;
}

const glowMat = (c: THREE.Color, opacity = 1) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
const flatDist = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

/** Расстояние от точки до отрезка на плоскости */
function segDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const abx = b.x - a.x, abz = b.z - a.z;
  const t = THREE.MathUtils.clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / Math.max(1e-6, abx * abx + abz * abz), 0, 1);
  return Math.hypot(a.x + abx * t - p.x, a.z + abz * t - p.z);
}

export class Combat {
  private readonly projs: Proj[] = [];
  private readonly shots: EnemyShot[] = [];
  private readonly pickups: Pickup[] = [];
  private readonly geo = {
    tracer: new THREE.BoxGeometry(0.06, 0.06, 0.8),
    pellet: new THREE.BoxGeometry(0.05, 0.05, 0.45),
    plasma: new THREE.BoxGeometry(0.18, 0.18, 0.18),
    grenade: new THREE.BoxGeometry(0.16, 0.16, 0.22),
    missile: new THREE.BoxGeometry(0.08, 0.08, 0.3),
    glob: new THREE.BoxGeometry(0.22, 0.22, 0.22),
    pickup: new THREE.BoxGeometry(0.26, 0.2, 0.26),
  };
  private readonly matCache = new Map<string, THREE.MeshBasicMaterial>();
  private readonly grenadeMat = new THREE.MeshStandardMaterial({ color: '#2b2e35', emissive: '#ff2a1a', emissiveIntensity: 0.8, metalness: 0.6, roughness: 0.4 });

  private fireT = 0;
  private emptyT = 0;
  private akimboSide = false;
  /** Раскрутка пулемёта, 0..1 */
  spin = 0;
  /** Накопленный жар плазмы, 0..1 */
  heat = 0;
  private heatIdle = 0;
  modCd = 0;
  /** Таймеры модов */
  akimboT = 0;
  turretT = 0;
  overloadT = 0;
  private beam: THREE.Mesh | null = null;
  private chain: THREE.Mesh | null = null;
  private hookTarget: Beetle | null = null;
  /** Насколько разошёлся прицел от стрельбы, 0..1 */
  bloom = 0;

  constructor(private readonly h: CombatHooks) {}

  private mat(c: THREE.Color): THREE.MeshBasicMaterial {
    const key = c.getHexString() + c.r.toFixed(2);
    let m = this.matCache.get(key);
    if (!m) { m = glowMat(c); this.matCache.set(key, m); }
    return m;
  }

  /** Сбросить всё при смене оружия или обмороке */
  reset(): void {
    this.akimboT = 0; this.turretT = 0; this.overloadT = 0;
    this.spin = 0; this.heat = 0;
    this.h.player.akimbo = false;
    this.h.player.speedMul = 1;
    this.endBeam();
    this.endHook();
  }

  get modReady(): boolean { return this.modCd <= 0; }
  /** Сколько процентов перезарядки мода осталось, 0..1 */
  modProgress(w: WeaponDef): number { return Math.min(1, this.modCd / (w.mod.cd * modCdMul(this.h.level()))); }

  // ---------- основной огонь ----------
  /** Вызывается каждый кадр: held — зажата ли кнопка огня */
  trigger(held: boolean, dt: number): void {
    const { player } = this.h;
    const w = this.h.weapon();
    this.fireT -= dt;
    this.emptyT -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 2.5);

    // пулемёт сначала раскручивается
    if (w.spinUp) {
      const target = held || this.turretT > 0 ? 1 : 0;
      const before = this.spin;
      this.spin = THREE.MathUtils.clamp(this.spin + (target ? dt / w.spinUp : -dt / 0.8), 0, 1);
      if (before === 0 && this.spin > 0 && target) this.h.sound('spinup');
      player.spin(this.spin * 9, dt);
    }
    if (!held || player.down || player.equipping || this.overloadT > 0 || this.hookTarget) return;
    if (w.spinUp && this.spin < 0.35) return;

    let rate = w.rate;
    if (w.spinUp) rate *= 0.35 + 0.65 * this.spin;
    if (this.akimboT > 0) rate *= 2;
    if (this.turretT > 0) rate *= 3;
    if (this.fireT > 0) return;
    this.fireT = 1 / rate;

    if (!this.h.useAmmo(w.ammo, w.ammoPerShot)) {
      if (this.emptyT <= 0) { this.h.sound('empty'); this.h.fx.text(player.pos, `нет: ${AMMO[w.ammo].name.toLowerCase()}`, 'bad'); this.emptyT = 1; }
      this.fireT = 0.3;
      return;
    }
    this.shoot(w);
  }

  private shoot(w: WeaponDef): void {
    const { player, fx } = this.h;
    const muzzles = player.muzzles();
    let left = false;
    let from = muzzles[0];
    if (this.akimboT > 0 && muzzles[1]) { left = this.akimboSide; from = left ? muzzles[1] : muzzles[0]; this.akimboSide = !this.akimboSide; }
    const target = this.h.hovered()?.pos.clone() ?? this.h.aim();
    const base = Math.atan2(target.x - from.x, target.z - from.z);
    const color = new THREE.Color(...w.tracer);
    const lm = levelMul(this.h.level());
    const spread = w.spread * (1 + this.bloom * 0.8) * (this.turretT > 0 ? 1.3 : 1);
    for (let i = 0; i < w.pellets; i++) {
      const a = base + (Math.random() + Math.random() - 1) * spread;
      const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      this.spawn(w.shot, from.clone(), dir, w.speed * (0.92 + Math.random() * 0.16), w.dmg * lm, w.range, color, w.explode, w.pierce);
    }
    const glow = new THREE.Color(...w.glow);
    const big = w.shot === 'pellet' || w.shot === 'bfg' || w.shot === 'grenade';
    fx.muzzle(from, base, glow, big ? 1.5 : w.id === 'uzi' ? 0.7 : 1);
    this.h.light(from, glow, big ? 26 : 12, 0.06);
    if (w.shot === 'bullet') fx.casing(from.clone().addScaledVector(player.forward, -0.4), base);
    if (w.shot === 'pellet') this.later(0.25, () => fx.casing(from.clone().addScaledVector(player.forward, -0.4), base, true));
    player.kick(w.recoil, left);
    fx.shake = Math.max(fx.shake, w.shake);
    this.bloom = Math.min(1, this.bloom + w.recoil * 0.25);
    if (w.shot === 'plasma') { this.heat = Math.min(1, this.heat + 0.03); this.heatIdle = 0; }
    if (w.knock > 2 && w.shot === 'pellet') player.squash = 0.3;
    this.h.sound(w.sound);
  }

  private spawn(kind: ProjKind, pos: THREE.Vector3, dir: THREE.Vector3, speed: number, dmg: number, range: number, color: THREE.Color, explode?: { r: number; dmg: number }, pierce = 0): Proj {
    let mesh: THREE.Object3D;
    switch (kind) {
      case 'bullet': mesh = new THREE.Mesh(this.geo.tracer, this.mat(color)); break;
      case 'pellet': case 'slug': mesh = new THREE.Mesh(kind === 'slug' ? this.geo.missile : this.geo.pellet, this.mat(color)); break;
      case 'plasma': {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(this.geo.plasma, this.mat(color)));
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.h.T.glow, color: color.clone().multiplyScalar(0.5), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        s.scale.setScalar(0.9);
        g.add(s);
        mesh = g;
        break;
      }
      case 'grenade': mesh = new THREE.Mesh(this.geo.grenade, this.grenadeMat); break;
      case 'missile': mesh = new THREE.Mesh(this.geo.missile, this.mat(new THREE.Color(2.6, 2.6, 2.6))); break;
      case 'bfg': {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), this.mat(new THREE.Color(1.2, 3.6, 1.2))));
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.h.T.glow, color: new THREE.Color(0.4, 2.2, 0.5), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        s.scale.setScalar(3.2);
        g.add(s);
        mesh = g;
        break;
      }
    }
    mesh.position.copy(pos);
    mesh.rotation.y = Math.atan2(dir.x, dir.z);
    this.h.scene.add(mesh);
    const vel = dir.clone().multiplyScalar(speed);
    if (kind === 'grenade') vel.y = 4.5;
    const p: Proj = {
      kind, mesh, pos: pos.clone(), vel, dmg, travelled: 0, range, color,
      radius: kind === 'bfg' ? 0.5 : kind === 'grenade' ? 0.25 : kind === 'plasma' ? 0.2 : 0.1,
      pierce, hit: new Set(), explode,
      fuse: kind === 'grenade' ? 1.15 : undefined, zapT: 0,
    };
    this.projs.push(p);
    return p;
  }

  // ---------- моды ----------
  mod(): void {
    const { player, fx } = this.h;
    const w = this.h.weapon();
    if (player.down || player.equipping) return;
    if (this.modCd > 0) return;
    const cd = w.mod.cd * modCdMul(this.h.level());
    const lm = levelMul(this.h.level());
    const from = player.muzzles()[0] ?? player.pos.clone().setY(1);
    const glow = new THREE.Color(...w.glow);
    switch (w.mod.kind) {
      case 'microMissiles': {
        if (!this.h.useAmmo('bullets', 6)) { this.noAmmo(w.ammo); return; }
        for (let i = 0; i < 6; i++) {
          this.later(i * 0.07, () => {
            const a = player.facing + (i - 2.5) * 0.18;
            const p = this.spawn('missile', (player.muzzles()[0] ?? from).clone(), new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), 14, 3 * lm, 18, new THREE.Color(3, 1.4, 0.4), { r: 1.3, dmg: 4 * lm });
            p.homing = this.nearestTo(this.h.hovered()?.pos ?? this.h.aim(), 10, i);
            this.h.sound('missile');
            fx.muzzle(p.pos, a, glow, 0.6);
          });
        }
        break;
      }
      case 'akimbo':
        this.akimboT = 4;
        player.akimbo = true;
        fx.flash(player.pos.clone().setY(1.2), glow, 1.6, 0.25);
        this.h.sound('spinup');
        break;
      case 'explosiveShot': {
        if (!this.h.useAmmo('shells', 1)) { this.noAmmo('shells'); return; }
        const a = Math.atan2(this.h.aim().x - from.x, this.h.aim().z - from.z);
        this.spawn('slug', from.clone(), new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), 30, 4 * lm, 14, new THREE.Color(3.2, 1.4, 0.3), { r: 2.4, dmg: 10 * lm });
        fx.muzzle(from, a, glow, 1.6);
        player.kick(1);
        fx.shake = Math.max(fx.shake, 0.4);
        this.h.sound('shotgun');
        break;
      }
      case 'turret':
        this.turretT = 4;
        player.speedMul = 0.45;
        this.spin = 1;
        fx.shock(player.pos, 1.6, glow, 0.3, 0.12);
        this.h.sound('spinup');
        break;
      case 'heatBlast': {
        if (this.heat < 0.15) { fx.text(player.pos, 'мало жара — стреляй', 'bad'); this.h.sound('empty'); return; }
        const r = 2 + this.heat * 4;
        const dmg = (6 + this.heat * 22) * lm;
        const c = player.pos.clone();
        fx.explosion(c, r, new THREE.Color(0.35, 1.3, 2.1));
        this.h.light(c.clone().setY(1), new THREE.Color(0.6, 2, 3), 60, 0.25);
        for (const b of this.alive()) {
          const d = flatDist(b.pos, c);
          if (d > r + b.radius) continue;
          b.freeze(0.8, false);
          this.h.damageBeetle(b, dmg * (1 - (d / (r + 1)) * 0.5), this.away(c, b).multiplyScalar(2.5), true);
        }
        this.heat = 0;
        this.h.sound('heat');
        break;
      }
      case 'detonate': {
        const gr = this.projs.filter((p) => p.kind === 'grenade');
        if (!gr.length) { fx.text(player.pos, 'нет гранат в полёте', 'bad'); return; }
        for (const p of gr) this.blow(p, 1.35);
        this.modCd = cd;
        return;
      }
      case 'meatHook': {
        const t = this.hookCandidate();
        if (!t) { fx.text(player.pos, 'нет цели для крюка', 'bad'); return; }
        this.hookTarget = t;
        const chainMat = glowMat(new THREE.Color(3, 2.2, 0.6));
        this.chain = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1), chainMat);
        this.h.scene.add(this.chain);
        this.h.sound('hook');
        break;
      }
      case 'overload': {
        if (!this.h.useAmmo('cells', 30)) { this.noAmmo('cells'); return; }
        this.overloadT = 2;
        player.speedMul = 0.5;
        this.beam = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 1), glowMat(new THREE.Color(0.8, 3.6, 1)));
        this.h.scene.add(this.beam);
        this.h.sound('beam');
        break;
      }
    }
    this.modCd = cd;
  }

  private noAmmo(t: AmmoType): void {
    this.h.sound('empty');
    this.h.fx.text(this.h.player.pos, `нет: ${AMMO[t].name.toLowerCase()}`, 'bad');
  }

  private hookCandidate(): Beetle | null {
    const hv = this.h.hovered();
    const p = this.h.player;
    if (hv && !hv.dead && flatDist(hv.pos, p.pos) < 11) return hv;
    let best: Beetle | null = null, bd = 11;
    for (const b of this.alive()) {
      const d = flatDist(b.pos, p.pos);
      let da = Math.atan2(b.pos.x - p.pos.x, b.pos.z - p.pos.z) - p.facing;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) < 0.4 && d < bd) { bd = d; best = b; }
    }
    return best;
  }

  private endHook(): void {
    if (this.chain) { this.h.scene.remove(this.chain); this.chain.geometry.dispose(); (this.chain.material as THREE.Material).dispose(); this.chain = null; }
    this.hookTarget = null;
  }
  private endBeam(): void {
    if (this.beam) { this.h.scene.remove(this.beam); this.beam.geometry.dispose(); (this.beam.material as THREE.Material).dispose(); this.beam = null; }
    this.overloadT = 0;
  }

  // ---------- помощники ----------
  private alive(): Beetle[] { return this.h.beetles().filter((b) => !b.dead); }
  private away(from: THREE.Vector3, b: Beetle): THREE.Vector3 {
    const d = new THREE.Vector3(b.pos.x - from.x, 0, b.pos.z - from.z);
    return d.lengthSq() < 1e-4 ? this.h.player.forward : d.normalize();
  }
  private nearestTo(p: THREE.Vector3, maxD: number, skip = 0): Beetle | null {
    const list = this.alive().map((b) => ({ b, d: flatDist(b.pos, p) })).filter((x) => x.d < maxD).sort((a, b) => a.d - b.d);
    return list.length ? list[skip % list.length].b : null;
  }
  private timers: { t: number; fn: () => void }[] = [];
  private later(delay: number, fn: () => void): void { this.timers.push({ t: delay, fn }); }

  /** Взрыв снаряда */
  private blow(p: Proj, mul = 1): void {
    const ex = p.explode;
    this.remove(p);
    if (!ex) return;
    const r = ex.r * (mul > 1 ? 1.15 : 1);
    const dmg = ex.dmg * mul * (p.kind === 'grenade' || p.kind === 'bfg' ? levelMul(this.h.level()) : 1);
    const tint = p.kind === 'bfg' ? new THREE.Color(0.6, 3.4, 0.8) : new THREE.Color(3, 1.3, 0.3);
    const c = p.pos.clone();
    this.h.fx.explosion(c, r, tint);
    this.h.light(c.clone().setY(1.2), tint, 40 + r * 10, 0.22);
    this.h.sound('explosion');
    for (const b of this.alive()) {
      const d = flatDist(b.pos, c);
      if (d > r + b.radius) continue;
      this.h.damageBeetle(b, dmg * (1 - Math.min(0.6, d / (r * 2))), this.away(c, b).multiplyScalar(3), true);
    }
  }

  /**
   * Пересёк ли снаряд стену поля или препятствие на шаге prev → pos.
   * Возвращает нормаль поверхности, а снаряд ставит на точку удара.
   */
  private envHit(prev: THREE.Vector3, pos: THREE.Vector3): THREE.Vector3 | null {
    const W = CFG.FIELD + 1.2;
    const GAP = 1.6; // проходы для жуков в стенах открыты
    if (Math.abs(pos.x) > W && Math.abs(prev.x) <= W && Math.abs(pos.z) > GAP) {
      pos.x = Math.sign(pos.x) * W;
      return new THREE.Vector3(-Math.sign(pos.x), 0, 0);
    }
    if (Math.abs(pos.z) > W && Math.abs(prev.z) <= W && Math.abs(pos.x) > GAP) {
      pos.z = Math.sign(pos.z) * W;
      return new THREE.Vector3(0, 0, -Math.sign(pos.z));
    }
    for (const c of this.h.colliders()) {
      const cp = new THREE.Vector3(c.x, 0, c.z);
      if (segDist(cp, prev, pos) > c.r) continue;
      // нормаль — от центра препятствия к точке, откуда прилетел снаряд
      const n = new THREE.Vector3(prev.x - c.x, 0, prev.z - c.z);
      if (n.lengthSq() < 1e-6) n.set(1, 0, 0);
      n.normalize();
      pos.x = c.x + n.x * c.r; pos.z = c.z + n.z * c.r;
      return n;
    }
    return null;
  }

  /** Отразить скорость от поверхности с нормалью n */
  private reflect(p: Proj, n: THREE.Vector3, keep: number): void {
    const vy = p.vel.y;
    const flat = p.vel.clone().setY(0);
    flat.sub(n.clone().multiplyScalar(2 * flat.dot(n))).multiplyScalar(keep);
    p.vel.set(flat.x, vy, flat.z);
    p.mesh.position.copy(p.pos);
  }

  /** Рикошет: пуля отлетает под случайным углом, слабее и недалеко */
  private ricochet(p: Proj, n: THREE.Vector3): void {
    this.reflect(p, n, 0.65);
    const a = Math.atan2(p.vel.x, p.vel.z) + (Math.random() - 0.5) * 0.9;
    const sp = Math.hypot(p.vel.x, p.vel.z);
    p.vel.set(Math.sin(a) * sp, 0, Math.cos(a) * sp);
    p.ricocheted = true;
    p.dmg *= 0.5;
    p.range = p.travelled + 6;
    p.hit.clear();
    const c = new THREE.Color(3, 2.6, 1.4);
    this.h.fx.spray(p.pos.clone(), p.vel.clone().normalize(), [c, new THREE.Color(3, 1.6, 0.5)], 8, { speed: 7, spread: 0.6, life: 0.25 });
    this.h.fx.flash(p.pos.clone(), c, 0.8, 0.08);
    this.h.light(p.pos.clone(), c, 8, 0.06);
    this.h.sound('ricochet');
  }

  private remove(p: Proj): void {
    const i = this.projs.indexOf(p);
    if (i >= 0) this.projs.splice(i, 1);
    this.h.scene.remove(p.mesh);
    p.mesh.traverse((o) => {
      if (o instanceof THREE.Sprite) o.material.dispose();
      if (o instanceof THREE.Mesh && o.geometry.type === 'SphereGeometry') o.geometry.dispose();
    });
  }

  // ---------- выстрелы жуков ----------
  enemyShoot(from: THREE.Vector3, to: THREE.Vector3, r: RangedStats, atPlayer: boolean): void {
    const dir = to.clone().sub(from);
    dir.y = 0;
    // небольшое упреждение и неточность
    const a = Math.atan2(dir.x, dir.z) + (Math.random() - 0.5) * 0.12;
    const g = new THREE.Group();
    const c = new THREE.Color(...r.color);
    g.add(new THREE.Mesh(this.geo.glob, this.mat(c)));
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.h.T.glow, color: c.clone().multiplyScalar(0.6), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    s.scale.setScalar(1.1);
    g.add(s);
    g.position.copy(from);
    this.h.scene.add(g);
    this.shots.push({ mesh: g, pos: from.clone(), vel: new THREE.Vector3(Math.sin(a), 0, Math.cos(a)).multiplyScalar(r.speed), travelled: 0, r, atPlayer });
    this.h.fx.burst(from, [c], 4, { speed: 1.5, up: 1, size: 0.07, life: 0.3, glow: true, gravity: 2 });
    this.h.sound('spit');
  }

  private removeShot(i: number, splat: boolean): void {
    const s = this.shots[i];
    this.shots.splice(i, 1);
    this.h.scene.remove(s.mesh);
    s.mesh.traverse((o) => { if (o instanceof THREE.Sprite) o.material.dispose(); });
    if (splat) {
      const c = new THREE.Color(...s.r.color);
      this.h.fx.burst(s.pos, [c, c.clone().multiplyScalar(0.5)], 8, { speed: 2.5, up: 2, size: 0.08, life: 0.5, glow: true, gravity: 8 });
      this.h.sound('splat');
    }
  }

  // ---------- трофеи ----------
  /** Коробки с патронами и аптечки, выпадающие из жука */
  drop(at: THREE.Vector3, big: boolean): void {
    const owned = AMMO_TYPES.filter((t) => this.h.owned(t));
    const n = big ? 3 : Math.random() < 0.7 ? 1 : 2;
    for (let i = 0; i < n; i++) {
      // чаще падают патроны к текущему стволу
      const cur = this.h.weapon().ammo;
      const type: AmmoType | 'health' = Math.random() < 0.18 ? 'health' : Math.random() < 0.55 ? cur : owned[Math.floor(Math.random() * owned.length)];
      const amount = type === 'health' ? 10 : Math.ceil(AMMO[type].drop * (big ? 1.5 : 1));
      const col = type === 'health' ? new THREE.Color(0.4, 1.6, 3.4) : new THREE.Color(...AMMO[type].color);
      const mesh = new THREE.Mesh(this.geo.pickup, new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.3), emissive: col.clone().multiplyScalar(0.3), emissiveIntensity: 1.6 }));
      const pos = at.clone().setY(0.4);
      mesh.position.copy(pos);
      this.h.scene.add(mesh);
      const a = Math.random() * Math.PI * 2;
      this.pickups.push({ mesh, pos, type, amount, t: 0, vel: new THREE.Vector3(Math.cos(a) * 2, 4, Math.sin(a) * 2) });
    }
  }

  // ---------- кадр ----------
  update(dt: number, t: number): void {
    const { player, fx } = this.h;
    const w = this.h.weapon();
    this.modCd = Math.max(0, this.modCd - dt);
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); }
    }
    this.heatIdle += dt;
    if (this.heatIdle > 1.5) this.heat = Math.max(0, this.heat - dt * 0.08);

    if (this.akimboT > 0) { this.akimboT -= dt; if (this.akimboT <= 0) player.akimbo = false; }
    if (this.turretT > 0) { this.turretT -= dt; if (this.turretT <= 0) player.speedMul = 1; }

    // луч перегрузки
    if (this.overloadT > 0 && this.beam) {
      this.overloadT -= dt;
      const from = player.muzzles()[0] ?? player.pos.clone().setY(1);
      const dir = player.forward;
      const len = 16;
      this.beam.position.copy(from).addScaledVector(dir, len / 2);
      this.beam.rotation.set(0, player.facing, 0);
      const flick = 0.8 + Math.sin(t * 60) * 0.25;
      this.beam.scale.set(flick, flick, len);
      const end = from.clone().addScaledVector(dir, len);
      const dps = 40 * levelMul(this.h.level());
      for (const b of this.alive()) {
        if (segDist(b.pos, from, end) < 0.5 + b.radius) this.h.damageBeetle(b, dps * dt, dir.clone().multiplyScalar(0.3));
      }
      if (Math.random() < 0.5) fx.burst(end.clone().setY(0.5), [new THREE.Color(0.6, 3.4, 0.8)], 2, { speed: 3, up: 2, size: 0.07, life: 0.3, glow: true });
      this.h.light(from.clone().addScaledVector(dir, 2), new THREE.Color(0.4, 2.4, 0.6), 18, 0.05);
      if (this.overloadT <= 0) { this.endBeam(); player.speedMul = 1; }
    }

    // мясной крюк: цепь тянет героя к жуку
    if (this.hookTarget) {
      const tg = this.hookTarget;
      const from = player.pos.clone().setY(1);
      const to = tg.pos.clone().setY(0.5);
      const d = from.distanceTo(to);
      if (this.chain) {
        this.chain.position.copy(from).lerp(to, 0.5);
        this.chain.lookAt(to);
        this.chain.scale.set(1, 1, d);
      }
      const flat = flatDist(player.pos, tg.pos);
      if (tg.dead || flat < 1.3 + tg.radius) {
        if (!tg.dead) tg.freeze(0.6, false);
        this.endHook();
      } else {
        const dir = new THREE.Vector3(tg.pos.x - player.pos.x, 0, tg.pos.z - player.pos.z).normalize();
        player.pos.addScaledVector(dir, Math.min(flat, 22 * dt));
      }
    }

    // снаряды героя
    const beetles = this.alive();
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const p = this.projs[i];
      if (!this.projs.includes(p)) continue;
      const prev = p.pos.clone();
      if (p.kind === 'missile') {
        if (!p.homing || p.homing.dead) p.homing = this.nearestTo(p.pos, 9);
        if (p.homing) {
          const want = new THREE.Vector3(p.homing.pos.x - p.pos.x, 0, p.homing.pos.z - p.pos.z).normalize().multiplyScalar(p.vel.length());
          p.vel.lerp(want, Math.min(1, dt * 5));
        }
        fx.burst(p.pos, [new THREE.Color(3, 1.4, 0.3)], 1, { speed: 0.3, up: 0.2, size: 0.07, life: 0.25, glow: true, gravity: 0 });
      }
      if (p.kind === 'grenade') {
        p.vel.y -= 14 * dt;
        p.fuse = (p.fuse ?? 1) - dt;
        if (Math.random() < 0.5) fx.burst(p.pos, ['#555', '#777'], 1, { speed: 0.2, up: 0.4, size: 0.08, life: 0.4, gravity: -1 });
      }
      p.pos.addScaledVector(p.vel, dt);
      const step = Math.hypot(p.pos.x - prev.x, p.pos.z - prev.z);
      p.travelled += step;
      if (p.kind === 'grenade' && p.pos.y < 0.12) {
        p.pos.y = 0.12; p.vel.y *= -0.45; p.vel.x *= 0.72; p.vel.z *= 0.72;
      }
      p.mesh.position.copy(p.pos);
      if (p.kind === 'grenade') { p.mesh.rotation.x += dt * 12; }
      else if (p.kind === 'plasma' || p.kind === 'bfg') { p.mesh.rotation.y += dt * 8; p.mesh.rotation.x += dt * 6; }
      else p.mesh.rotation.y = Math.atan2(p.vel.x, p.vel.z);
      if (p.kind === 'plasma' && Math.random() < 0.4) fx.burst(p.pos, [p.color], 1, { speed: 0.4, up: 0.2, size: 0.05, life: 0.2, glow: true, gravity: 0 });

      // шар Б-9000 бьёт лучами всех рядом
      if (p.kind === 'bfg') {
        p.zapT = (p.zapT ?? 0) - dt;
        if (p.zapT <= 0) {
          p.zapT = 0.15;
          const near = beetles.filter((b) => flatDist(b.pos, p.pos) < 5.5).slice(0, 4);
          for (const b of near) {
            const ang = Math.atan2(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
            fx.line(p.pos.clone(), ang, flatDist(b.pos, p.pos), new THREE.Color(0.6, 3.4, 0.8), 0.12, 0.12, p.pos.y);
            this.h.damageBeetle(b, p.dmg, new THREE.Vector3(0, 0, 0));
          }
          if (near.length) this.h.sound('zap');
        }
        this.h.light(p.pos, new THREE.Color(0.4, 2.4, 0.6), 20, 0.05);
      }

      let done = false;
      for (const b of beetles) {
        if (b.dead || p.hit.has(b)) continue;
        if (segDist(b.pos, prev, p.pos) > b.radius + p.radius) continue;
        if (p.explode && p.kind !== 'bfg') { this.blow(p); done = true; break; }
        if (p.kind === 'bfg') { this.blow(p); done = true; break; }
        p.hit.add(b);
        const dir = p.vel.clone().setY(0).normalize();
        this.h.damageBeetle(b, p.dmg, dir.multiplyScalar(this.h.weapon().knock * 0.4));
        fx.hit(b.pos, dir.negate(), p.color, p.kind === 'pellet' ? 0.6 : 1);
        if (p.pierce > 0) { p.pierce--; continue; }
        this.remove(p);
        done = true;
        break;
      }
      if (done) continue;
      // удар об окружение: стены поля и препятствия
      const wall = this.envHit(prev, p.pos);
      if (wall) {
        if (p.explode && p.kind !== 'grenade') { this.blow(p); continue; }
        if (p.kind === 'grenade') { this.reflect(p, wall, 0.6); continue; }
        if ((p.kind === 'bullet' || p.kind === 'pellet') && !p.ricocheted && Math.random() < CFG.RICOCHET_CHANCE) {
          this.ricochet(p, wall);
          continue;
        }
        fx.ricochet(p.pos.clone(), p.color);
        fx.burst(p.pos.clone(), ['#6b6b6b', '#8b5e3c'], 2, { speed: 1.5, up: 1.5, size: 0.06, life: 0.4 });
        this.remove(p);
        continue;
      }
      const out = Math.abs(p.pos.x) > CFG.FIELD + 6 || Math.abs(p.pos.z) > CFG.FIELD + 6;
      if (p.kind === 'grenade' && (p.fuse ?? 0) <= 0) { this.blow(p); continue; }
      if (p.kind !== 'grenade' && (p.travelled > p.range || out)) {
        if (p.explode) { this.blow(p); continue; }
        fx.ricochet(p.pos.clone().setY(0.2), p.color);
        this.remove(p);
      }
    }

    // выстрелы жуков
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      const prev = s.pos.clone();
      s.pos.addScaledVector(s.vel, dt);
      s.travelled += s.vel.length() * dt;
      s.mesh.position.copy(s.pos);
      s.mesh.rotation.y += dt * 10;
      if (Math.random() < 0.5) fx.burst(s.pos, [new THREE.Color(...s.r.color)], 1, { speed: 0.3, up: 0.1, size: 0.06, life: 0.3, glow: true, gravity: 1 });
      if (!player.down && segDist(player.pos, prev, s.pos) < 0.55) {
        this.h.hurtPlayer(s.r.dmg);
        this.removeShot(i, true);
        continue;
      }
      let hitBush = false;
      for (const b of this.h.bushes()) {
        if (!b || b.dead || segDist(b.pos, prev, s.pos) > 0.6) continue;
        this.h.hurtBush(b, s.r.bushDmg);
        hitBush = true;
        break;
      }
      if (hitBush) { this.removeShot(i, true); continue; }
      if (s.travelled > s.r.range * 1.9) this.removeShot(i, true);
    }

    // трофеи: подпрыгивают и летят к герою
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      k.t += dt;
      k.vel.y -= 12 * dt;
      k.pos.addScaledVector(k.vel, dt);
      if (k.pos.y < 0.3) { k.pos.y = 0.3; k.vel.set(k.vel.x * 0.5, Math.abs(k.vel.y) * 0.3, k.vel.z * 0.5); }
      const d = flatDist(k.pos, player.pos);
      if (!player.down && d < 3 && k.t > 0.3) {
        const pull = new THREE.Vector3(player.pos.x - k.pos.x, 0, player.pos.z - k.pos.z).normalize().multiplyScalar(14 * dt);
        k.pos.add(pull);
      }
      k.mesh.position.set(k.pos.x, k.pos.y + Math.sin(t * 4 + i) * 0.06, k.pos.z);
      k.mesh.rotation.y += dt * 3;
      const life = 18;
      if (!player.down && d < 0.6 && k.t > 0.3) {
        if (k.type === 'health') { player.heal(k.amount); fx.text(player.pos, `+${k.amount} здоровья`, 'heal'); }
        else { this.h.addAmmo(k.type, k.amount); fx.text(player.pos, `+${k.amount} ${AMMO[k.type].name.toLowerCase()}`, 'pickup'); }
        this.h.sound('pickup');
        this.killPickup(i);
      } else if (k.t > life) this.killPickup(i);
      else if (k.t > life - 3) k.mesh.visible = Math.floor(k.t * 8) % 2 === 0;
    }
    void w;
  }

  private killPickup(i: number): void {
    const k = this.pickups[i];
    this.pickups.splice(i, 1);
    this.h.scene.remove(k.mesh);
    (k.mesh.material as THREE.Material).dispose();
  }

  /** Убрать всё летящее (на рассвете — вражеские плевки) */
  clearEnemyShots(): void { for (let i = this.shots.length - 1; i >= 0; i--) this.removeShot(i, false); }
}
