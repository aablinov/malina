import * as THREE from 'three';
import { rnd } from './rng.ts';
import type { FX } from './fx.ts';
import { iconCanvas } from './icons.ts';
import { itemDef, MAX_SOULS, powerMult, RARITY, type ArtifactStats, type GearStats, type PlainArtifactKind, type Profile } from './items.ts';
import { additive, additiveSprite, glowTex, groundGlow, lightBeam, raysTex, type LootData } from './loot-look.ts';
import type { Knight } from './knight.ts';
import type { Terrain } from './level/collide.ts';
import type { Target } from './target.ts';
import { AURA_COLOR, AURA_METER, Auras } from './auras.ts';
import { spellOf, Spells } from './spells.ts';
import { HERO } from './tuning.ts';
import { applyWeapon, getWeapon, type WeaponDef } from './weapons.ts';
import { temperOf, type TemperSlot } from './temper.ts';
import { WeaponArts } from './weapon-arts.ts';
import type { HudBuff, HudState } from './hud/hud.ts';
import type { GearAction } from './net/protocol.ts';

/**
 * Снаряжение в бою (wiki/design-inventory.md): надетое из профиля (src/items.ts) превращается в числа и действия —
 * оружие героя и множители удара, здоровье брони, стрелы на ПКМ, артефакты на 1/2/3, зелье на E, души, опыт и уровни,
 * жизни, закалка и спец-удар (Q) — src/weapon-arts.ts. Сцена сообщает о попаданиях и вызывает действия; что задело — решают цели (Target).
 */

export interface GearHooks {
  scene: THREE.Scene;
  fx: FX;
  hero: Knight;
  terrain: Terrain;
  targets(): Target[];
  /** Взрыв артефакта поджигает бочки и бьёт ящики */
  blast?(at: THREE.Vector3, r: number, dmg: number): void;
  sound(k: 'shoot' | 'potion' | 'level' | 'boom' | 'horn' | 'zap' | 'totem' | 'dash' | 'souls' | 'empty' | 'hit'): void;
  toast(s: string): void;
  banner(html: string): void;
  /** Без звука (сцену ведёт тест) */
  quiet?(): boolean;
}

interface Arrow { pos: THREE.Vector3; vel: THREE.Vector3; left: number; dmg: number; knock: number; pierce: number; hit: Set<Target>; mesh: THREE.Group }
interface Totem { pos: THREE.Vector3; t: number; heal: number; r: number; mesh: THREE.Group }

export const POTION_CD = 20;
const LIVES = 3;

const glowMat = (r: number, g: number, b: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), toneMapped: false });
const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  return o;
};

export class Gear {
  stats!: GearStats;
  lives = LIVES;
  potionT = 0;
  /** Перезарядка артефактов: осталось и полная */
  readonly artT: [number, number][] = [[0, 1], [0, 1], [0, 1]];
  private shotT = 0;
  private speedT = 0;
  private speedK = 1;
  private soulAcc = 0;
  private readonly arrows: Arrow[] = [];
  private readonly totems: Totem[] = [];
  /** Заклинания: заряд и каст (src/spells.ts) */
  readonly spells: Spells;
  /** Закалка оружия и спец-удар (src/weapon-arts.ts) */
  readonly arts: WeaponArts;
  /** Закалка для отладки (панель F1) поверх зачарований надетого: только вид, синергии и спец-удар */
  temperOverride: TemperSlot[] | null = null;
  /** Аура в четвёртом гнезде (src/auras.ts) */
  readonly auras: Auras;
  /** Здоровье на прошлом кадре: упало — героя ударили (для «Бастиона» и шипов) */
  private lastHp = 0;
  private buffSpeed = 1;
  private weaponId = '';
  private armorId = '-';
  private bowId = '-';
  /** ?weapon=… из адреса — оружие для отладки поверх надетого */
  weaponOverride: WeaponDef | null = null;
  /** Попадания стрел (для тестов) */
  arrowHits = 0;
  arrowsShot = 0;
  /** Сетевой бой (src/cgame/net-battle.ts): действие сработало — уходит серверу, тот повторит его снаряжением героя и перешлёт остальным */
  onAction?: (a: GearAction) => void;

  private readonly h: GearHooks;
  readonly profile: Profile;
  constructor(h: GearHooks, profile: Profile) { this.h = h; this.profile = profile;
    const damage = (t: Target, v: number, from: THREE.Vector3, knock: number): void => {
      const dir = new THREE.Vector3(t.pos.x - from.x, 0, t.pos.z - from.z).normalize();
      t.hit(v, dir, t.pos.clone().setY(1), knock);
      h.fx.text(t.pos.clone().setY(1.1), String(v), 'spell');
      this.onHit(v, false, t.pos);
    };
    this.spells = new Spells({
      scene: h.scene, fx: h.fx, hero: h.hero, terrain: h.terrain, targets: () => h.targets(), damage,
      aoe: (c, r, dmg, knock, blast) => this.aoe(c, r, dmg, knock, blast),
    });
    this.spells.onBuffs = () => this.apply();
    this.auras = new Auras({ scene: h.scene, fx: h.fx, hero: h.hero, targets: () => h.targets(), damage, changed: () => this.apply(), banner: h.banner });
    this.arts = new WeaponArts({
      scene: h.scene, fx: h.fx, hero: h.hero, terrain: h.terrain, targets: () => h.targets(),
      hitTarget: (t, v, dir, knock, melee) => {
        t.hit(v, dir, t.pos.clone().setY(1), knock);
        h.fx.text(t.pos.clone().setY(1.1), String(v), melee ? 'crit' : '');
        this.onHit(v, melee, t.pos, t);
      },
      heal: (v) => { if (!h.hero.down) h.hero.hp = Math.min(h.hero.maxHp, h.hero.hp + v); },
      souls: (n) => { if (n > 0) this.profile.addSouls(n); },
      meleeMult: () => this.stats.meleeMult,
      sound: (k) => h.sound(k),
      blast: (at, r, dmg) => h.blast?.(at, r, dmg),
      quiet: () => h.quiet?.() ?? false,
    });
    profile.onChange(() => this.apply());
    this.apply();
    h.hero.hp = h.hero.maxHp;
  }

  /** Надетое → герой: оружие, здоровье, скорость, перекат */
  apply(): void {
    const hero = this.h.hero;
    this.stats = this.profile.stats();
    // аура: множители урона, крита, перезарядки и душ; «Бастион» — меньше получаемого урона
    const au = this.auras;
    au.set(this.profile.aura());
    this.stats.meleeMult *= au.dmgMult; this.stats.rangedMult *= au.dmgMult; this.stats.artifactMult *= au.dmgMult;
    this.stats.critChance += au.critBonus;
    this.stats.artifactCdMult *= au.cdMult;
    this.stats.soulsMult *= au.soulsMult;
    hero.dmgTakenMul = au.damageTaken;
    // усиления от заклинаний (облик титана): урон, получаемый урон, скорость, размер героя
    let bm = 1, bt = 1, bs = 1, sc = 1;
    for (const b of this.spells.buffs) { bm *= b.melee ?? 1; bt *= b.taken ?? 1; bs *= b.speed ?? 1; sc = Math.max(sc, b.scale ?? 1); }
    this.stats.meleeMult *= bm; hero.dmgTakenMul *= bt; this.buffSpeed = bs;
    hero.object.scale.setScalar(sc);
    const m = this.profile.equipped('melee');
    const w = this.weaponOverride ?? (m ? getWeapon(itemDef(m.def).weapon ?? '') : undefined);
    if (w && w.id !== this.weaponId) { this.weaponId = w.id; applyWeapon(w, hero.tune); hero.setWeapon(w); this.arts.set(w, []); }
    if (w) this.arts.set(w, this.temperOverride ?? temperOf(m));
    const max = HERO.hp + this.stats.maxHpBonus;
    if (max !== hero.maxHp) {
      const k = hero.maxHp > 0 ? hero.hp / hero.maxHp : 1;
      hero.maxHp = max;
      hero.hp = Math.min(max, Math.max(1, Math.round(max * k)));
    }
    // вид: броня на теле и лук в левой руке
    const a = this.profile.equipped('armor'), r = this.profile.equipped('ranged');
    const ak = a?.def ?? '', rk = r?.def ?? '';
    if (ak !== this.armorId) { this.armorId = ak; hero.setArmor(a ? itemDef(a.def).armor?.look ?? null : null); }
    if (rk !== this.bowId) { this.bowId = rk; hero.setBow(r ? itemDef(r.def).ranged?.look ?? null : null); }
    // пока заряжаешь заклинание — идёшь вдвое медленнее
    hero.speedMul = this.stats.speedMult * this.buffSpeed * (this.speedT > 0 ? this.speedK : 1) * (this.spells?.charging ? 0.5 : 1);
    hero.rollCdMul = this.stats.rollCdMult;
  }

  /** Оружие поправили в редакторе: заново применить, если оно надето */
  refreshWeapon(w: WeaponDef): void { if (w.id === this.weaponId) { applyWeapon(w); this.h.hero.setWeapon(w); this.arts.set(w, []); this.apply(); } }

  // ---------- ближний бой ----------

  /** Урон удара по цели: сила оружия, острота, крит, огонь */
  meleeDamage(base: number): { dmg: number; crit: boolean; fire: number } {
    const s = this.stats;
    // «Сердце звезды» (синергия крита и вампиризма): следующие удары — гарантированный крит
    const forced = this.arts.forcedCrits > 0;
    if (forced) this.arts.forcedCrits--;
    const crit = forced || (s.critChance > 0 && rnd() < s.critChance);
    const fire = s.fireDmg;
    return { dmg: Math.round(base * s.meleeMult * (crit ? 3 : 1)) + fire, crit, fire };
  }

  /** Q: спец-удар оружия, если шкала полна */
  special(aim: THREE.Vector3): boolean {
    if (this.arts.special(aim)) { this.onAction?.({ k: 'special', at: [aim.x, aim.z] }); return true; }
    if (!this.arts.ready && !this.h.hero.down) { this.h.toast(`${this.arts.specialTitle}: шкала ${Math.floor(this.arts.meter * 100)} % — бей врагов`); this.h.sound('empty'); }
    return false;
  }

  /** Попали по цели (мечом, стрелой, артефактом): души, опыт, вампиризм, шкала ауры; at — где цель */
  onHit(dmg: number, melee: boolean, at?: THREE.Vector3, target?: Target): void {
    const s = this.stats, hero = this.h.hero;
    if (melee && target) for (const b of this.spells.buffs) b.onMelee?.(target, dmg);
    const pact = this.auras.onDealt(dmg, at);
    if (pact > 0 && !hero.down) hero.hp = Math.min(hero.maxHp, hero.hp + pact);
    this.soulAcc += (melee ? s.soulsPerHit : 1) * s.soulsMult;
    if (this.soulAcc >= 1) { const n = Math.floor(this.soulAcc); this.soulAcc -= n; this.profile.addSouls(n); }
    if (melee && s.leech > 0) hero.hp = Math.min(hero.maxHp, hero.hp + dmg * s.leech);
    this.gainXp(Math.max(1, Math.round(dmg * 0.25)));
  }

  gainXp(n: number): void {
    const ups = this.profile.addXp(n);
    if (ups > 0) {
      const lv = this.profile.data.level;
      this.h.banner(`Уровень ${lv}<small>+${ups} ${ups === 1 ? 'очко' : 'очка'} зачарования — открой инвентарь (I)</small>`);
      this.h.sound('level');
      this.h.fx.burst(this.h.hero.pos.clone().setY(this.h.hero.pos.y + 1), [new THREE.Color(2.4, 1.2, 3.4), new THREE.Color(3.2, 2.6, 1)], 26, { speed: 3, up: 4, size: 0.08, life: 0.9, glow: true, gravity: 2 });
    }
  }

  // ---------- зелье ----------

  potion(): boolean {
    const hero = this.h.hero;
    if (this.potionT > 0 || hero.down) { if (this.potionT > 0) this.h.toast(`Зелье будет готово через ${Math.ceil(this.potionT)} с`); return false; }
    const heal = Math.round(hero.maxHp * 0.6 * this.stats.potionMult);
    const before = hero.hp;
    hero.hp = Math.min(hero.maxHp, hero.hp + heal);
    this.potionT = POTION_CD;
    this.onAction?.({ k: 'potion' });
    this.h.fx.text(hero.pos.clone().setY(hero.pos.y + 0.6), `+${Math.round(hero.hp - before)}`, 'heal');
    this.h.fx.burst(hero.pos.clone().setY(hero.pos.y + 1), [new THREE.Color(3.2, 0.5, 0.8), new THREE.Color(3, 2.6, 2.6)], 18, { speed: 1.6, up: 3, size: 0.07, life: 0.8, glow: true, gravity: 1 });
    this.h.sound('potion');
    return true;
  }

  // ---------- стрелы ----------

  /** Выстрел к точке; держишь ПКМ — стреляет с паузой лука */
  shoot(at: THREE.Vector3): boolean {
    const r = this.profile.equipped('ranged');
    if (!r || this.shotT > 0 || this.h.hero.down) return false;
    const def = itemDef(r.def).ranged;
    if (!def) return false;
    const P = this.profile.data, s = this.stats, hero = this.h.hero;
    if (P.arrows <= 0) { this.h.toast('Стрелы кончились — ищи связки в сундуках'); this.h.sound('empty'); this.shotT = 0.5; return false; }
    this.shotT = def.cd * s.rangedCdMult;
    const from = hero.pos.clone().setY(hero.pos.y + 1.1);
    const yaw = Math.atan2(at.x - from.x, at.z - from.z);
    hero.shootPose(yaw, Math.max(0.45, this.shotT + 0.15));
    let n = def.shots ?? 1;
    if (s.multishot > 0 && rnd() < s.multishot) n += 2;
    const dmg = Math.round(def.dmg * s.rangedMult);
    for (let i = 0; i < n; i++) {
      const a = yaw + (i - (n - 1) / 2) * 0.2;
      this.spawnArrow(from, a, def.speed, def.range, dmg, def.knock * s.rangedKnock, s.pierce, (def.shots ?? 1) > 1 || i > 0);
    }
    if (!(s.infinity > 0 && rnd() < s.infinity)) P.arrows = Math.max(0, P.arrows - 1);
    this.arrowsShot++;
    this.h.sound('shoot');
    return true;
  }

  private spawnArrow(from: THREE.Vector3, yaw: number, speed: number, range: number, dmg: number, knock: number, pierce: number, glow: boolean): void {
    const g = new THREE.Group();
    g.add(box(0.04, 0.04, 0.7, new THREE.MeshLambertMaterial({ color: '#a8774a' })));
    g.add(box(0.09, 0.09, 0.12, glow ? glowMat(1.2, 2.6, 3.4) : glowMat(2.2, 2.3, 2.5), 0, 0, 0.38));
    g.add(box(0.14, 0.02, 0.14, new THREE.MeshLambertMaterial({ color: '#f2f2f2' }), 0, 0, -0.3));
    g.position.copy(from);
    g.rotation.y = yaw;
    this.h.scene.add(g);
    const vel = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(speed);
    this.arrows.push({ pos: from.clone(), vel, left: range, dmg, knock, pierce, hit: new Set(), mesh: g });
  }

  private updateArrows(dt: number): void {
    const { terrain, fx, scene } = this.h;
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      const step = a.vel.length() * dt;
      const to = a.pos.clone().addScaledVector(a.vel, dt);
      let dead = (a.left -= step) <= 0;
      const wall = terrain.wallHit(a.pos.x, a.pos.z, to.x, to.z, a.pos.y);
      if (wall) { to.set(wall.x, a.pos.y, wall.z); dead = true; fx.burst(to, ['#c8b890', '#8a7a5a'], 5, { speed: 1.5, up: 1.5, size: 0.06, life: 0.3 }); }
      // попадание: цель ближе радиуса к отрезку пути на этом шаге
      for (const t of this.h.targets()) {
        if (!t.alive || a.hit.has(t)) continue;
        if (a.pos.y < t.pos.y - 0.2 || a.pos.y > t.pos.y + (t.topY ?? 1.9)) continue;
        const d = segDist(a.pos.x, a.pos.z, to.x, to.z, t.pos.x, t.pos.z);
        if (d > t.radius + 0.08) continue;
        a.hit.add(t);
        const dir = a.vel.clone().setY(0).normalize();
        const point = t.pos.clone().setY(a.pos.y).addScaledVector(dir, -t.radius);
        t.hit(a.dmg, dir, point, a.knock);
        fx.text(point, String(a.dmg), '');
        fx.burst(point, [new THREE.Color(2, 2.6, 3.4), '#e8e2d0'], 6, { speed: 2.5, up: 2, size: 0.06, life: 0.3, glow: true });
        this.arrowHits++;
        this.onHit(a.dmg, false, t.pos);
        this.h.sound('hit');
        if (a.pierce-- <= 0) { dead = true; break; }
      }
      a.pos.copy(to);
      a.mesh.position.copy(to);
      if (dead) { scene.remove(a.mesh); disposeGroup(a.mesh); this.arrows.splice(i, 1); }
    }
  }

  // ---------- артефакты: гнёзда 1/2/3, заклинания (src/spells.ts, реестр src/magic/registry.ts) и обычные ----------

  /**
   * Клавиша 1/2/3 нажата: заклинание с зарядом начинает заряжаться (каст — когда отпустят), остальное срабатывает сразу
   */
  pressArtifact(i: number, at: THREE.Vector3): boolean {
    const a = this.artifactAt(i)?.a;
    const spell = a?.charge ? spellOf(a.kind) : null;
    if (!a || !spell) return this.useArtifact(i, at);
    if (this.artT[i][0] > 0 || this.h.hero.down || this.spells.charging) return false;
    this.spells.start(i, spell, a);
    this.apply();
    this.onAction?.({ k: 'charge', i, at: [at.x, at.z] });
    return true;
  }

  /** Клавиша отпущена: сотворить заряжаемое заклинание с набранным зарядом */
  releaseArtifact(i: number, at: THREE.Vector3): boolean {
    const c = this.spells.charging;
    if (!c || c.slot !== i) return false;
    this.spells.release();
    this.apply();
    return this.useArtifact(i, at, c.k);
  }

  /** R: вспышка ауры (шкала полна) */
  flareAura(): boolean {
    const au = this.auras;
    if (!au.kind) { this.h.toast('Гнездо ауры пустое — надень ауру в инвентаре (I)'); return false; }
    if (au.flareT > 0) return false;
    if (!au.ready) { this.h.toast(`Шкала ауры: ${Math.floor((au.meter / AURA_METER) * 100)} % — бей врагов, чтобы заполнить`); this.h.sound('empty'); return false; }
    const ok = au.flare();
    if (ok) this.onAction?.({ k: 'aura' });
    return ok;
  }

  /** Бросить заряд без каста (окно открылось, фокус ушёл) */
  cancelCast(): void { if (this.spells.charging) { this.spells.cancel(); this.apply(); this.onAction?.({ k: 'cancel' }); } }

  /** Артефакт в гнезде i (0..2): характеристики и урон (лечение) с учётом силы предмета; гнездо пустое — null */
  private artifactAt(i: number): { a: ArtifactStats; power: number } | null {
    const it = this.profile.artifacts()[i];
    const a = it ? itemDef(it.def).artifact : undefined;
    return a ? { a, power: a.power * powerMult(it!.power) * this.stats.artifactMult } : null;
  }

  /**
   * Сработать сразу; charge 0..1 — заряд заклинания (клик по слоту и тесты — без удержания).
   * Общее для всех: гнездо, перезарядка, герой на ногах, плата душами; дальше заклинание творит реестр, обычный артефакт — plain
   */
  useArtifact(i: number, at: THREE.Vector3, charge = 0): boolean {
    const art = this.artifactAt(i);
    if (!art) { this.h.toast(`Гнездо ${i + 1} пустое — надень артефакт в инвентаре (I)`); return false; }
    const { a, power } = art;
    if (this.artT[i][0] > 0 || this.h.hero.down) return false;
    if (a.souls && this.profile.data.souls < a.souls) { this.h.toast(`Нужно ${a.souls} душ`); this.h.sound('empty'); return false; }
    if (a.souls) this.profile.data.souls -= a.souls;
    const spell = spellOf(a.kind);
    if (spell) this.spells.cast(spell, a, power, at, charge);
    else this.plain(a.kind as PlainArtifactKind, a, power, at);
    this.artT[i] = [a.cd * this.stats.artifactCdMult, a.cd * this.stats.artifactCdMult];
    this.apply();
    this.onAction?.({ k: 'art', i, at: [at.x, at.z], c: charge });
    return true;
  }

  /**
   * Повторить действие героя другого игрока (сетевой бой: сервер — src/game/match.ts, у других игроков — вид): перезарядки, души и шкалы — его,
   * поэтому здесь их не проверяем — открываем и делаем
   */
  perform(a: GearAction): void {
    const y = this.h.hero.pos.y;
    switch (a.k) {
      case 'art':
        // заряжал у себя — у нас заряд тоже шёл: отпустить и сотворить
        if (this.spells.charging?.slot === a.i) { this.spells.release(); this.apply(); }
        this.artT[a.i][0] = 0;
        this.profile.data.souls = MAX_SOULS;
        this.useArtifact(a.i, new THREE.Vector3(a.at[0], y, a.at[1]), a.c);
        break;
      case 'charge':
        this.artT[a.i][0] = 0;
        if (this.spells.charging) this.spells.cancel();
        this.pressArtifact(a.i, new THREE.Vector3(a.at[0], y, a.at[1]));
        break;
      case 'cancel': this.cancelCast(); break;
      case 'potion': this.potionT = 0; this.potion(); break;
      case 'aura': this.auras.meter = AURA_METER; this.auras.flareT = 0; this.flareAura(); break;
      case 'special': this.arts.meter = 1; this.special(new THREE.Vector3(a.at[0], y, a.at[1])); break;
    }
  }

  /** Обычный артефакт без каста: power — урон или лечение с силой предмета; сапоги берут множитель скорости как есть */
  private plain(kind: PlainArtifactKind, a: ArtifactStats, power: number, at: THREE.Vector3): void {
    const R = a.radius ?? 3, me = this.h.hero.pos.clone();
    switch (kind) {
      case 'firework': this.firework(me, at, R, power); break;
      case 'totem': this.totem(me, R, power, a.duration ?? 8); break;
      case 'boots':
        this.speedT = a.duration ?? 2; this.speedK = a.power;
        this.h.fx.burst(me.clone().setY(me.y + 0.2), [new THREE.Color(1, 2.2, 3.4)], 14, { speed: 2, up: 1, size: 0.07, life: 0.4, glow: true });
        this.h.sound('dash');
        break;
      case 'horn':
        this.aoe(me, R, power, 3.2, false);
        this.h.fx.shock(me.clone().setY(me.y + 0.1), R, new THREE.Color(1.6, 2.6, 3.2), 0.45, 0.3);
        this.h.fx.shock(me.clone().setY(me.y + 0.6), R * 0.7, new THREE.Color(2.4, 3, 3.2), 0.35, 0.2);
        this.h.sound('horn');
        break;
      case 'lightning': this.lightning(me, R, power); break;
      case 'harvester':
        this.aoe(me, R, power, 1.6, true);
        this.magicBoom(me, R, new THREE.Color(0.8, 2.6, 3.4), new THREE.Color(2.2, 1.2, 3.4));
        this.h.sound('souls');
        break;
    }
  }

  /**
   * Взрыв магии: вспышки, светящиеся искры и кольца — без дыма и обломков fx.explosion
   * (тёмные кубики дыма у заклинаний выглядели чёрными квадратами)
   */
  private magicBoom(at: THREE.Vector3, r: number, a: THREE.Color, b: THREE.Color): void {
    const fx = this.h.fx, c = at.clone().setY(at.y + 0.6);
    fx.flash(c, a.clone().multiplyScalar(1.2), Math.min(6, r * 1.6), 0.3);
    for (let i = 0; i < 4; i++) fx.flash(c.clone().add(new THREE.Vector3((rnd() - 0.5) * r, rnd() * 0.8, (rnd() - 0.5) * r)), (i % 2 ? b : a).clone(), r * 0.6, 0.3 + rnd() * 0.15);
    fx.burst(c, [a, b, new THREE.Color(3.2, 3, 2.6)], Math.round(14 + r * 7), { speed: r * 2.6, up: r * 1.2, size: 0.08, life: 0.6, glow: true, gravity: 3 });
    fx.shock(at, r, a, 0.4, 0.22);
    fx.shock(at, r * 0.65, b, 0.3, 0.15);
    fx.shake = Math.max(fx.shake, 0.5);
  }

  /** Урон по площади вокруг c (без героя); blast — поджечь бочки */
  private aoe(c: THREE.Vector3, r: number, dmg: number, knock: number, blast: boolean): number {
    let n = 0;
    for (const t of this.h.targets()) {
      if (!t.alive) continue;
      const d = Math.hypot(t.pos.x - c.x, t.pos.z - c.z);
      if (d - t.radius > r) continue;
      const dir = new THREE.Vector3(t.pos.x - c.x, 0, t.pos.z - c.z).normalize();
      const v = Math.round(dmg * (1 - Math.min(1, d / (r + t.radius)) * 0.4));
      t.hit(v, dir, t.pos.clone().setY(1), knock);
      this.h.fx.text(t.pos.clone().setY(1.1), String(v), 'crit');
      this.onHit(v, false, t.pos);
      n++;
    }
    if (blast) this.h.blast?.(c, r, dmg);
    return n;
  }

  private firework(from: THREE.Vector3, at: THREE.Vector3, r: number, dmg: number): void {
    const dir = new THREE.Vector3(at.x - from.x, 0, at.z - from.z);
    if (dir.length() > 14) dir.setLength(14);
    const end = from.clone().add(dir);
    end.y = this.h.terrain.floorAt(end.x, end.z, from.y + 3);
    if (!Number.isFinite(end.y)) end.y = from.y;
    const g = new THREE.Group();
    g.add(box(0.12, 0.12, 0.5, new THREE.MeshLambertMaterial({ color: '#e23a3a' })), box(0.1, 0.1, 0.14, glowMat(3.4, 2.4, 0.8), 0, 0, -0.3));
    const start = from.clone().setY(from.y + 1.2);
    g.position.copy(start);
    this.h.scene.add(g);
    const fx = this.h.fx;
    const T = 0.45;
    fx.custom(g, T, (k) => {
      const p = start.clone().lerp(end, k);
      p.y += Math.sin(k * Math.PI) * 2.2;
      g.lookAt(p.clone().add(new THREE.Vector3(end.x - start.x, (1 - 2 * k) * 6, end.z - start.z)));
      g.position.copy(p);
      if (rnd() < 0.7) fx.burst(p, [new THREE.Color(3.4, 2.2, 0.6)], 1, { speed: 0.6, up: 0.5, size: 0.06, life: 0.3, glow: true, gravity: 0 });
      if (k > 0.97 && !g.userData.boom) {
        g.userData.boom = true;
        this.magicBoom(end, r, new THREE.Color(3.4, 1.2, 2.2), new THREE.Color(3.4, 3, 0.8));
        fx.burst(end.clone().setY(end.y + 1.2), [new THREE.Color(3.4, 0.8, 1.6), new THREE.Color(0.8, 2.6, 3.4), new THREE.Color(3.4, 3, 0.8)], 40, { speed: 6, up: 4, size: 0.08, life: 0.8, glow: true, gravity: 3 });
        this.aoe(end, r, dmg, 1.8, true);
        this.h.sound('boom');
      }
    });
  }

  private totem(at: THREE.Vector3, r: number, heal: number, dur: number): void {
    const g = new THREE.Group();
    const wood = new THREE.MeshLambertMaterial({ color: '#8a6038' });
    g.add(box(0.5, 1.3, 0.5, wood, 0, 0.65, 0), box(0.62, 0.2, 0.62, new THREE.MeshLambertMaterial({ color: '#5a3a22' }), 0, 1.35, 0));
    g.add(box(0.26, 0.22, 0.04, glowMat(3.4, 0.6, 1), 0, 0.55, 0.26), box(0.08, 0.08, 0.04, glowMat(0.2, 0.2, 0.2), -0.1, 1.0, 0.26), box(0.08, 0.08, 0.04, glowMat(0.2, 0.2, 0.2), 0.1, 1.0, 0.26));
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.08, r, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.6, 1), transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
    g.add(ring);
    g.position.copy(at);
    this.h.scene.add(g);
    this.totems.push({ pos: at.clone(), t: dur, heal, r, mesh: g });
    this.h.sound('totem');
  }

  private lightning(from: THREE.Vector3, r: number, dmg: number): void {
    const near = this.h.targets().filter((t) => t.alive && Math.hypot(t.pos.x - from.x, t.pos.z - from.z) < r)
      .sort((a, b) => a.pos.distanceToSquared(from) - b.pos.distanceToSquared(from)).slice(0, 3);
    for (const t of near) {
      const bolt = box(0.16, 12, 0.16, glowMat(2.4, 2.2, 3.4), 0, 6, 0);
      const g = new THREE.Group();
      g.add(bolt);
      g.position.copy(t.pos);
      this.h.scene.add(g);
      this.h.fx.custom(g, 0.3, (k) => { bolt.scale.set(1 - k, 1, 1 - k); });
      this.h.fx.flash(t.pos.clone().setY(1), new THREE.Color(2.4, 2.2, 3.4), 2.2, 0.2);
      const dir = new THREE.Vector3(t.pos.x - from.x, 0, t.pos.z - from.z).normalize();
      const v = Math.round(dmg);
      t.hit(v, dir, t.pos.clone().setY(1), 0.8);
      this.h.fx.text(t.pos.clone().setY(1.1), String(v), 'crit');
      this.onHit(v, false, t.pos);
    }
    if (!near.length) this.h.toast('Рядом нет целей для молнии');
    this.h.sound('zap');
  }

  // ---------- цикл ----------

  /** Жизнь потеряна (герой упал) */
  onDown(): void {
    this.lives--;
    if (this.lives <= 0) { this.lives = LIVES; this.h.banner('Все жизни потеряны<small>Плейграунд: жизни восстановлены</small>'); }
  }

  update(dt: number, rmb: boolean, aim: THREE.Vector3): void {
    const hero = this.h.hero;
    if (hero.hp < this.lastHp - 0.01 && !hero.down) this.auras.onHurt(this.lastHp - hero.hp);
    this.potionT = Math.max(0, this.potionT - dt);
    this.shotT = Math.max(0, this.shotT - dt);
    for (const a of this.artT) a[0] = Math.max(0, a[0] - dt);
    if (this.speedT > 0) {
      this.speedT -= dt;
      if (rnd() < 0.4 && hero.speed > 1) this.h.fx.burst(hero.pos.clone().setY(hero.pos.y + 0.1), [new THREE.Color(1, 2.2, 3.4)], 1, { speed: 0.4, up: 0.3, size: 0.06, life: 0.35, glow: true, gravity: 0 });
      if (this.speedT <= 0) this.apply();
    }
    if (!hero.down && this.stats.regen > 0) hero.hp = Math.min(hero.maxHp, hero.hp + this.stats.regen * dt);
    for (let i = this.totems.length - 1; i >= 0; i--) {
      const t = this.totems[i];
      t.t -= dt;
      t.mesh.children[t.mesh.children.length - 1].rotation.z += dt;
      if (!hero.down && Math.hypot(hero.pos.x - t.pos.x, hero.pos.z - t.pos.z) < t.r) {
        hero.hp = Math.min(hero.maxHp, hero.hp + t.heal * dt);
        if (rnd() < 0.15) this.h.fx.burst(hero.pos.clone().setY(hero.pos.y + 0.8), [new THREE.Color(0.6, 3, 1)], 1, { speed: 0.5, up: 1.5, size: 0.06, life: 0.6, glow: true, gravity: -1 });
      }
      if (t.t <= 0) { this.h.scene.remove(t.mesh); disposeGroup(t.mesh); this.totems.splice(i, 1); }
    }
    this.spells.update(dt, aim);
    this.auras.update(dt);
    this.arts.update(dt);
    if (rmb) this.shoot(aim);
    this.updateArrows(dt);
    this.lastHp = hero.hp;
  }

  /** Числа для HUD */
  hudState(): HudState {
    const hero = this.h.hero;
    const arts = this.profile.artifacts();
    const buffs: HudBuff[] = [];
    if (this.speedT > 0) buffs.push({ icon: 'boots', name: 'Скорость', t: this.speedT, color: '#3a8ad8' });
    for (const t of this.totems) if (Math.hypot(hero.pos.x - t.pos.x, hero.pos.z - t.pos.z) < t.r) { buffs.push({ icon: 'totem', name: 'Исцеление', t: t.t, color: '#3a9a4a' }); break; }
    if (this.stats.multishot > 0) buffs.push({ icon: 'e-multi', name: 'Мультивыстрел', count: Math.round(this.stats.multishot * 100), color: '#3a9a4a' });
    if (this.stats.infinity > 0) buffs.push({ icon: 'e-inf', name: 'Бесконечность', color: '#7a5cff' });
    if (this.stats.regen > 0) buffs.push({ icon: 'e-leaf', name: 'Восстановление', color: '#3a9a4a' });
    if (hero.god) buffs.push({ icon: 'champion', name: 'Бессмертие', color: '#c08a2a' });
    const aura = this.profile.aura(), au = this.auras;
    const syn = this.arts.synergies;
    for (const x of syn) buffs.push({ icon: 'e-swirl', name: x.title, color: '#c08a2a' });
    if (syn.length >= 3) buffs.push({ icon: 'e-star', name: 'Резонанс', color: '#d8a020' });
    if (this.arts.forcedCrits > 0) buffs.push({ icon: 'e-star', name: 'Звёздный крит', count: this.arts.forcedCrits, color: '#c08a2a' });
    if (aura && au.kind && au.flareT > 0) buffs.push({ icon: itemDef(aura.def).icon, name: `${itemDef(aura.def).title} ×3`, t: au.flareT, color: AURA_COLOR[au.kind] });
    return {
      hp: hero.hp, maxHp: hero.maxHp, lives: this.lives,
      potion: [this.potionT, POTION_CD],
      roll: [hero.rollCdT, HERO.rollCd * hero.rollCdMul],
      artifacts: this.artT.map(([t, f]) => [t, f]),
      active: arts.map((it) => {
        const k = it ? itemDef(it.def).artifact?.kind : undefined;
        return (k === 'boots' && this.speedT > 0) || (k === 'totem' && this.totems.length > 0);
      }),
      buffs,
      spec: { title: this.arts.specialTitle, meter: this.arts.meter, color: cssColor(this.arts.color), icon: this.profile.equipped('melee') ? itemDef(this.profile.equipped('melee')!.def).icon : 'e-blade', active: this.h.hero.special !== null },
      aura: aura && au.kind ? { icon: itemDef(aura.def).icon, title: itemDef(aura.def).title, meter: au.meter / AURA_METER, flare: au.flareT, color: AURA_COLOR[au.kind] } : null,
    };
  }
}

/** HDR-цвет → CSS: ярчайшая составляющая — 1 */
function cssColor(c: THREE.Color): string {
  const k = 1 / Math.max(c.r, c.g, c.b, 1e-3);
  return `#${c.clone().multiplyScalar(k).getHexString()}`;
}

function segDist(ax: number, az: number, bx: number, bz: number, px: number, pz: number): number {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}

function disposeGroup(g: THREE.Object3D): void {
  g.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
}

/**
 * Трофей на полу, как в MCD, только ярче: крупная иконка над крутящейся звездой лучей, столб света цвета редкости
 * (у уникальных — выше и с золотом), ореол и расходящиеся по земле кольца-«сонар». Искры и вспышки даёт Props по userData.
 */
export function itemLootMesh(it: { def: string }): THREE.Group {
  const d = itemDef(it.def);
  const rarity = (['common', 'rare', 'unique'] as const).indexOf(d.rarity);
  const g = new THREE.Group();
  const c = new THREE.Color(RARITY[d.rarity].color);
  const tex = new THREE.CanvasTexture(iconCanvas(d.icon));
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
  const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  icon.position.y = 0.55;
  icon.renderOrder = 6;
  const rays = new THREE.Sprite(additiveSprite(raysTex(), c.clone().multiplyScalar(1.4 + rarity * 0.4), 0.85));
  rays.position.y = 0.55;
  rays.renderOrder = 5;
  const halo = new THREE.Sprite(additiveSprite(glowTex(), c.clone().multiplyScalar(0.9), 0.8));
  halo.position.y = 0.55;
  halo.scale.setScalar(1.6);
  // цвет редкости, но с белой сердцевиной — даже серое «обычное» видно издалека
  const beam = lightBeam(c.clone().lerp(new THREE.Color('#fff'), 0.25).multiplyScalar(2.4 + rarity * 0.6), 5.5 + rarity * 1.5, 1.4 + rarity * 0.3);
  // второй, золотой столб у уникальных
  const gold = rarity === 2 ? lightBeam(new THREE.Color(3, 2.2, 0.6), 4, 1.6) : null;
  const floor = groundGlow(c.clone().multiplyScalar(1.2), 2 + rarity * 0.4);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), additive(glowTex(), c.clone().multiplyScalar(2.4)));
  ring.rotation.x = -Math.PI / 2;
  const ground = new THREE.Group();
  ground.add(beam.group, floor, ring);
  if (gold) ground.add(gold.group);
  g.add(halo, rays, icon, ground);
  let last = 0, rise = 0;
  const ud: LootData = {
    glow: c.clone().multiplyScalar(2.6),
    rarity,
    tick: (t, grounded) => {
      const dt = Math.min(0.1, Math.max(0, t - last));
      last = t;
      // столб вырастает, когда трофей лёг; в полёте его нет
      rise = grounded ? Math.min(1, rise + dt * 2.5) : 0;
      ground.visible = rise > 0;
      ground.position.y = 0.02 - g.position.y;
      ground.rotation.set(-g.rotation.x, 0, 0);
      beam.group.scale.set(1, rise * (1 - Math.pow(1 - rise, 3)), 1);
      for (const m of beam.mats) m.opacity = 0.75 + Math.sin(t * 3) * 0.25;
      if (gold) { gold.group.scale.y = rise; for (const m of gold.mats) m.opacity = 0.5 + Math.sin(t * 2 + 1) * 0.3; gold.group.rotation.y = t * 0.8; }
      const k = (t % 1.4) / 1.4;
      ring.scale.setScalar(0.3 + k * (1.6 + rarity * 0.4));
      ring.material.opacity = (1 - k) * rise;
      floor.material.opacity = (0.7 + Math.sin(t * 3) * 0.2) * rise;
      const s = 0.9 + rarity * 0.08 + Math.sin(t * 4) * 0.05;
      icon.scale.setScalar(s);
      rays.scale.setScalar(s * (2 + rarity * 0.35) * (0.6 + rise * 0.4));
      rays.material.rotation = t * (0.8 + rarity * 0.3);
      halo.material.opacity = 0.6 + Math.sin(t * 4) * 0.2;
    },
  };
  g.userData = ud;
  return g;
}

/** Связка стрел на полу */
export function arrowsLootMesh(): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.MeshLambertMaterial({ color: '#a8774a' }), tip = new THREE.MeshLambertMaterial({ color: '#c6d0dc' }), band = new THREE.MeshLambertMaterial({ color: '#c03a3a' });
  for (const x of [-0.07, 0, 0.07]) g.add(box(0.04, 0.04, 0.5, shaft, x, 0, 0), box(0.06, 0.06, 0.08, tip, x, 0, 0.27));
  g.add(box(0.22, 0.07, 0.06, band, 0, 0, 0));
  return g;
}

