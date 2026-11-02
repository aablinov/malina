import * as THREE from 'three';
import type { Obstacle } from '../collision';
import type { FX } from '../fx';
import { emptyInput, Knight, type KnightInput, type Strike } from '../knight';
import type { Terrain } from '../level/collide.ts';
import type { Mob } from '../mobs/mob';
import { party } from '../party';
import type { Textures } from '../textures';
import type { TowerDefense } from '../td/td';
import type { NetBattle, NetClient } from './client';
import type { BattleSnap, GuestInput, HeroSnap, MobSnap, ServerMsg, TdCommand } from './protocol';

/**
 * Общий бой обороны куста (wiki/design-multiplayer.md, раздел 7). Модель хост-авторитарная:
 *
 * - **хост** (`CoopHost`) считает весь бой как одиночный и вдобавок ведёт героев гостей по их вводу; мобы выбирают ближайшего
 *   героя (src/party.ts), удары гостей бьют врагов; 20 раз в секунду рассылает снимок — герои, враги, оборона;
 * - **гость** (`CoopGuest`) ведёт своего героя сам (без задержки) и шлёт ввод хосту 30 раз в секунду; враги у него — куклы
 *   по снимку, башни, куст, стены, казна и волны — со снимка (`TowerDefense.applySnap`), меню площадок — командами хосту.
 *   Свой герой сверяется со снимком: здоровье — хоста, разошлись дальше SNAP_DIST — на место хоста.
 *
 * Чужие герои у гостя — те же рыцари: шаг по вводу из снимка и подтяжка к месту хоста.
 * Урон гостя у хоста — базовый урон удара (снаряжение гостя хост не знает); лук, артефакты и спец-удары гостя — пока только для вида.
 */

export interface CoopHooks {
  net: NetClient;
  battle: NetBattle;
  scene: THREE.Scene;
  T: Textures;
  fx: FX;
  hero: Knight;
  /** Ввод своего героя (читает playground) */
  input: KnightInput;
  td: TowerDefense;
  terrain: Terrain;
  solids: () => readonly Obstacle[];
  /** Хост: удар героя гостя по врагам */
  strike: (s: Strike, who: Knight) => number;
  toast: (s: string) => void;
}

/** Снимков в секунду от хоста и ввода в секунду от гостя */
const SNAP_HZ = 20;
const INPUT_HZ = 30;
/** Разошёлся со снимком дальше — свой герой гостя встаёт на место хоста, м */
const SNAP_DIST = 1.5;
/** Без сил — встаёт через, с (как свой герой в playground) */
const REVIVE_S = 2;

const r2 = (v: number): number => Math.round(v * 100) / 100;

/** Герой гостя или чужой герой: рыцарь, его ввод и таймер «без сил» */
interface Member { seat: number; knight: Knight; input: KnightInput; downT: number; rolled: boolean }

function spawnKnight(h: CoopHooks, seat: number): Knight {
  const k = new Knight(h.scene, h.T);
  // рядом с точкой появления своего героя, по кругу от места
  const a = (seat / 4) * Math.PI * 2;
  k.place(h.hero.pos.x + Math.cos(a) * 1.6, h.hero.pos.z + Math.sin(a) * 1.6, h.hero.yaw, h.hero.pos.y);
  return k;
}

function setInput(i: KnightInput, mx: number, mz: number, ax: number, az: number, attack: boolean, roll: boolean): void {
  i.move.set(mx, mz);
  i.aim.set(ax, i.aim.y, az);
  i.attack = attack;
  i.roll = roll;
}

/** Хост общего боя */
export class CoopHost {
  private readonly h: CoopHooks;
  private readonly members = new Map<number, Member>();
  private snapT = 0;
  private tick = 0;
  /** Перекат своего героя с прошлого снимка — гости увидят его даже между снимками */
  private rolled = false;
  private readonly off: () => void;

  constructor(h: CoopHooks) {
    this.h = h;
    for (const s of h.battle.seats) if (s.seat !== h.battle.hostSeat) this.add(s.seat);
    party.hurt = (k, dmg, from, knock) => this.hurt(k, dmg, from, knock);
    this.off = h.net.on((m) => this.onMsg(m));
  }

  dispose(): void {
    this.off();
    party.allies.length = 0;
    party.hurt = null;
  }

  private add(seat: number): Member {
    const k = spawnKnight(this.h, seat);
    k.onStrike = (s) => this.h.strike(s, k);
    const m: Member = { seat, knight: k, input: emptyInput(), downT: 0, rolled: false };
    this.members.set(seat, m);
    party.allies.push(k);
    return m;
  }

  private onMsg(m: ServerMsg): void {
    if (m.t !== 'relay') return;
    const d = m.d as GuestInput | TdCommand | null;
    if (d?.t === 'in') {
      const mem = this.members.get(m.from) ?? this.add(m.from);
      // перекат — однократный: держится до шага, который его прочтёт
      setInput(mem.input, d.move[0], d.move[1], d.aim[0], d.aim[2], d.attack, d.roll || mem.input.roll);
    } else if (d?.t === 'td') this.h.td.command(d);
  }

  /** Удар моба по герою гостя: урон, цифра, отброс — как свой hurtHero */
  private hurt(k: Knight, dmg: number, from: THREE.Vector3, knock: number): void {
    const hp0 = k.hp;
    if (!k.hurt(dmg)) return;
    const lost = hp0 - k.hp;
    if (lost >= 1) this.h.fx.text(k.pos.clone().setY(k.pos.y + 1.2), `−${Math.round(lost)}`, '');
    if (knock > 0) {
      const d = new THREE.Vector3(k.pos.x - from.x, 0, k.pos.z - from.z);
      if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
      k.vel.addScaledVector(d.normalize(), knock);
    }
  }

  update(dt: number): void {
    const h = this.h;
    this.rolled ||= h.input.roll;
    for (const m of this.members.values()) {
      m.rolled ||= m.input.roll;
      m.knight.update(dt, m.input, h.solids(), h.terrain);
      m.input.roll = false;
      if (m.knight.down) { m.downT += dt; if (m.downT > REVIVE_S) { m.knight.revive(); m.downT = 0; } }
    }
    this.snapT -= dt;
    if (this.snapT > 0) return;
    this.snapT = 1 / SNAP_HZ;
    h.net.relay(this.snapshot());
  }

  private heroSnap(seat: number, k: Knight, i: KnightInput, rolled: boolean): HeroSnap {
    return [seat, r2(k.pos.x), r2(k.pos.y), r2(k.pos.z), r2(k.yaw), Math.round(k.hp), k.maxHp, k.down ? 1 : 0,
      r2(i.move.x), r2(i.move.y), r2(i.aim.x), r2(i.aim.z), i.attack ? 1 : 0, rolled ? 1 : 0];
  }

  /** Для тестов: герои гостей — место и здоровье */
  get alliesInfo(): { seat: number; x: number; z: number; hp: number }[] {
    return [...this.members.values()].map((m) => ({ seat: m.seat, x: m.knight.pos.x, z: m.knight.pos.z, hp: m.knight.hp }));
  }

  snapshot(): BattleSnap {
    const h = this.h;
    const heroes = [this.heroSnap(h.battle.hostSeat, h.hero, h.input, this.rolled)];
    this.rolled = false;
    for (const m of this.members.values()) { heroes.push(this.heroSnap(m.seat, m.knight, m.input, m.rolled)); m.rolled = false; }
    const mobs: MobSnap[] = h.td.pack.mobs.filter((m) => !m.dead).map((m) => [m.net, m.kind, r2(m.pos.x), r2(m.pos.y), r2(m.pos.z), r2(m.yaw), Math.round(m.hp), m.maxHp]);
    return { t: 'snap', tick: ++this.tick, heroes, mobs, td: h.td.snap() };
  }
}

/** Гость общего боя */
export class CoopGuest {
  private readonly h: CoopHooks;
  /** Чужие герои: хост и другие гости */
  private readonly others = new Map<number, Member & { to: THREE.Vector3; yawTo: number }>();
  private inputT = 0;
  private seq = 0;
  private rolled = false;
  private readonly off: () => void;
  /** Снимков получено (для тестов) */
  snaps = 0;

  constructor(h: CoopHooks) {
    this.h = h;
    h.td.remote = (c) => h.net.relay(c);
    this.off = h.net.on((m) => this.onMsg(m));
  }

  dispose(): void { this.off(); this.h.td.remote = null; }

  private onMsg(m: ServerMsg): void {
    if (m.t === 'battle.over') {
      // итог мог уйти раньше последнего снимка: комната уже в лобби, снимков больше не будет
      if (this.h.td.state === 'play') this.h.td.state = m.result === 'won' ? 'won' : 'lost';
      if (m.result === 'abandoned') this.h.toast('Хост вышел — бой прерван');
      return;
    }
    if (m.t !== 'relay' || m.from !== this.h.battle.hostSeat) return;
    const d = m.d as BattleSnap | null;
    if (d?.t === 'snap') this.apply(d);
  }

  private apply(s: BattleSnap): void {
    this.snaps++;
    const h = this.h, me = h.battle.seat;
    for (const hs of s.heroes) {
      const [seat, x, y, z, yaw, hp, maxHp, down, mx, mz, ax, az, attack, roll] = hs;
      if (seat === me) {
        // свой: здоровье и «без сил» решает хост; место — своё, пока не разошлись
        const k = h.hero;
        k.maxHp = maxHp;
        if (down && !k.down) { k.hp = 0; k.down = true; }
        else if (!down && k.down) k.revive();
        if (!down) k.hp = Math.min(maxHp, hp);
        if (Math.hypot(k.pos.x - x, k.pos.z - z) > SNAP_DIST || Math.abs(k.pos.y - y) > 2) k.place(x, z, k.yaw, y);
        continue;
      }
      let o = this.others.get(seat);
      if (!o) {
        const knight = spawnKnight(h, seat);
        knight.place(x, z, yaw, y);
        o = { seat, knight, input: emptyInput(), downT: 0, rolled: false, to: new THREE.Vector3(x, y, z), yawTo: yaw };
        this.others.set(seat, o);
      }
      o.to.set(x, y, z);
      o.yawTo = yaw;
      setInput(o.input, mx, mz, ax, az, !!attack, !!roll || o.input.roll);
      o.knight.maxHp = maxHp;
      if (down && !o.knight.down) { o.knight.hp = 0; o.knight.down = true; }
      else if (!down && o.knight.down) o.knight.revive();
      if (!down) o.knight.hp = hp;
    }
    this.mobs(s.mobs);
    if (s.td) h.td.applySnap(s.td);
  }

  /** Враги — куклы: новые появляются, пропавшие со снимка рассыпаются */
  private mobs(list: MobSnap[]): void {
    const pack = this.h.td.pack;
    const byId = new Map<number, Mob>();
    for (const m of pack.mobs) byId.set(m.net, m);
    const seen = new Set<Mob>();
    for (const [id, kind, x, y, z, yaw, hp, maxHp] of list) {
      let m = byId.get(id);
      if (!m) {
        const made = pack.spawn(kind, new THREE.Vector3(x, 0, z));
        if (!made) continue;
        m = made;
        m.puppet = true;
        m.net = id;
        m.yaw = m.pupYaw = yaw;
        byId.set(id, m);
      }
      m.pupTo.set(x, y, z);
      m.pupYaw = yaw;
      m.maxHp = maxHp;
      m.hp = hp;
      seen.add(m);
    }
    for (const m of pack.mobs) if (!seen.has(m) && !m.dead) m.vanish();
  }

  update(dt: number): void {
    const h = this.h;
    this.rolled ||= h.input.roll;
    for (const o of this.others.values()) {
      o.knight.update(dt, o.input, h.solids(), h.terrain);
      o.input.roll = false;
      // шаг — по вводу, место — подтянуть к хосту
      const k = o.knight, d = Math.hypot(k.pos.x - o.to.x, k.pos.z - o.to.z);
      if (d > 3) k.place(o.to.x, o.to.z, o.yawTo, o.to.y);
      else { const a = Math.min(1, dt * 6); k.pos.x += (o.to.x - k.pos.x) * a; k.pos.z += (o.to.z - k.pos.z) * a; }
    }
    this.inputT -= dt;
    if (this.inputT > 0) return;
    this.inputT = 1 / INPUT_HZ;
    const i = h.input;
    const msg: GuestInput = { t: 'in', seq: ++this.seq, move: [r2(i.move.x), r2(i.move.y)], aim: [r2(i.aim.x), r2(i.aim.y), r2(i.aim.z)], attack: i.attack, roll: this.rolled };
    this.rolled = false;
    h.net.relay(msg);
  }

  /** Для тестов: чужие герои — место и здоровье */
  get othersInfo(): { seat: number; x: number; z: number; hp: number }[] {
    return [...this.others.values()].map((o) => ({ seat: o.seat, x: o.knight.pos.x, z: o.knight.pos.z, hp: o.knight.hp }));
  }
}
