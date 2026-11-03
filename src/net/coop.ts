import * as THREE from 'three';
import type { Obstacle } from '../collision';
import type { FX } from '../fx';
import type { Gear } from '../gear';
import { MAX_ARROWS, MAX_SOULS, Profile, xpToNext, type Equipment, type Item, type ProfileData } from '../items';
import { emptyInput, Knight, type KnightInput, type Strike } from '../knight';
import type { Terrain } from '../level/collide.ts';
import type { Mob } from '../mobs/mob';
import { party } from '../party';
import type { Props } from '../props';
import type { Textures } from '../textures';
import type { Purse, TowerDefense } from '../td/td';
import { SWORD } from '../tuning';
import { applyWeapon, getWeapon } from '../weapons';
import { BattleNetUi, type RosterRow } from './battle-ui';
import type { NetBattle, NetClient } from './client';
import { MOB_FLAG, type ActMsg, type BattleSnap, type GainMsg, type GearAction, type GuestInput, type HeroSnap, type KitMsg, type KnockMsg, type MobSnap, type SeatInfo, type ServerMsg, type TdCommand } from './protocol';
import './coop.css';

/**
 * Общий бой обороны куста (wiki/design-multiplayer.md, раздел 7). Модель хост-авторитарная:
 *
 * - **хост** (`CoopHost`) считает весь бой как одиночный и вдобавок ведёт героев гостей по их вводу; мобы выбирают ближайшего
 *   героя (src/party.ts), их зоны замедляют и лава жжёт героев гостей так же, как своего; 20 раз в секунду — снимок;
 * - **гость** (`CoopGuest`) ведёт своего героя сам (без задержки) и шлёт ввод хосту 30 раз в секунду; враги у него — куклы
 *   по снимку (атаки, оглушение, холод — для вида), башни, куст, стены и волны — со снимка (`TowerDefense.applySnap`),
 *   меню площадок — командами хосту. Свой герой сверяется по последнему учтённому вводу (ack): расхождение убирается
 *   плавно, отброс от удара приходит отдельно (`KnockMsg`). Чужие герои и куклы — из буфера снимков с задержкой RENDER_DELAY.
 *
 * Чужие герои у каждого — рыцари со своим снаряжением (`Gear` по набору игрока, `KitMsg`): шаг по вводу, удары, лук,
 * артефакты (с зарядом), зелье, аура и спец-удар (`ActMsg`) — у хоста бьют по-настоящему, у гостя — для вида; звук — вблизи.
 * Малина у каждого своя (`TowerDefense.personal`): кучки с врагов общие — лежат у хоста, кто подобрал, того и малина
 * (у гостя — по снимку); награда за волну — каждому, башни — за свою; собранное и не потраченное после боя уходит
 * в профиль (`battle.loot`). Над героями — имена, справа — список игроков с пингом, Enter — чат.
 *
 * Состав меняется на ходу: вошёл новый игрок — у всех появляется его герой; хост ушёл — сервер назначает следующего
 * (`battle.host`), и тот перехватывает бой с последнего снимка (`CoopGuest.promote`, `TowerDefense.takeOver`).
 */

export interface CoopHooks {
  net: NetClient;
  battle: NetBattle;
  scene: THREE.Scene;
  T: Textures;
  fx: FX;
  hero: Knight;
  /** Снаряжение и профиль своего героя (в бою — набор обороны) */
  gear: Gear;
  profile: Profile;
  /** Ввод своего героя (читает playground) и лук (держит ПКМ) */
  input: KnightInput;
  bow: () => boolean;
  td: TowerDefense;
  /** Лут: малина с врагов общая — лежит у хоста, кто подобрал, того и малина */
  props: Props;
  terrain: Terrain;
  solids: () => readonly Obstacle[];
  /** Удар героя другого игрока его снаряжением: у хоста — урон, у гостя — для вида */
  strike: (s: Strike, who: Knight, g: Gear) => number;
  /** Снаряжение для героя другого игрока: те же цели, звук — только вблизи своего героя */
  makeGear: (k: Knight, p: Profile) => Gear;
  /** Свист взмаха героя другого игрока (вблизи) */
  swing: (k: Knight, g: Gear, step: number) => void;
  /** Под героем лава: жжёт (хост — и героев гостей) */
  inLava: (p: THREE.Vector3) => boolean;
  /** Замедление героя от зон врагов, которые гонятся за ним */
  slowFor: (k: Knight) => number;
  toast: (s: string) => void;
  /** Гость стал хостом — сцена держит новый объект */
  replaced: (c: CoopHost) => void;
}

/** Снимков в секунду от хоста и ввода в секунду от гостя */
const SNAP_HZ = 20;
const INPUT_HZ = 30;
/** Чужие герои и куклы у гостя показываются с задержкой — между двумя снимками, без рывков при неровной связи, с */
const RENDER_DELAY = 0.1;
/** Набор снаряжения — раз в столько секунд (и сразу, как сменился): страница могла перезагрузиться */
const KIT_S = 3;
/** Разошёлся со снимком дальше — свой герой гостя встаёт на место хоста, м; меньше — подтягивается на CORRECT_K за снимок */
const SNAP_DIST = 2.5;
const CORRECT_K = 0.2;
/** Без сил — встаёт через, с (как свой герой в playground) */
const REVIVE_S = 2;
/** Конец боя → своя награда серверу через, с: сбор урожая успевает долететь */
const LOOT_DELAY = 4.5;
/** Лава жжёт героя гостя у хоста: урон раз в столько секунд (как своего, src/dev/playground.ts) */
const LAVA_S = 0.4;
const LAVA_DMG = 6;

const r2 = (v: number): number => Math.round(v * 100) / 100;
const now = (): number => performance.now() / 1000;
/** Весь опыт героя от первого уровня — чтобы посчитать, сколько набрано за бой */
const xpTotal = (d: ProfileData): number => { let n = d.xp; for (let l = 1; l < d.level; l++) n += xpToNext(l); return n; };

/** Буфер мест со снимков: место на момент t между двумя соседними (за последним — не дальше половины шага вперёд) */
class Track {
  private readonly s: { t: number; x: number; y: number; z: number; yaw: number }[] = [];
  push(t: number, x: number, y: number, z: number, yaw: number): void {
    this.s.push({ t, x, y, z, yaw });
    if (this.s.length > 6) this.s.shift();
  }
  /** Место — в out, вернёт взгляд */
  sample(t: number, out: THREE.Vector3): number {
    const s = this.s;
    if (!s.length) return 0;
    let i = s.length - 1;
    while (i > 0 && s[i - 1].t > t) i--;
    const b = s[i], a = s[i - 1] ?? b;
    const span = b.t - a.t, k = span > 1e-4 ? Math.max(0, Math.min(1.5, (t - a.t) / span)) : 1;
    out.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
    return a.yaw + Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) * Math.min(1, k);
  }
}

/** Герой другого игрока: рыцарь, его снаряжение, ввод */
interface Remote {
  seat: number;
  knight: Knight;
  gear: Gear;
  profile: Profile;
  input: KnightInput;
  bow: boolean;
  downT: number;
  rolled: boolean;
  /** Хост: последний учтённый ввод гостя, его пинг, лава */
  ack: number;
  ping: number;
  lavaT: number;
  /** Гость: место и взгляд — из буфера снимков */
  track: Track;
  to: THREE.Vector3;
  yawTo: number;
}

function setInput(i: KnightInput, mx: number, mz: number, ax: number, az: number, attack: boolean, roll: boolean): void {
  i.move.set(mx, mz);
  i.aim.set(ax, i.aim.y, az);
  i.attack = attack;
  i.roll = roll;
}

/** Что переходит от гостя к нему же хостом: чужие герои, опыт на старте боя, награда, чат */
interface Carry { heroes: Map<number, Remote>; xp0: number; lootSent: boolean; ui: BattleNetUi }

/** Общее хосту и гостю: чужие герои со снаряжением, наборы, действия, имена, список игроков, чат, награда */
abstract class Coop {
  protected readonly h: CoopHooks;
  protected readonly heroes: Map<number, Remote>;
  protected readonly off: (() => void)[] = [];
  protected readonly ui: BattleNetUi;
  private kitT = 0;
  private kitDirty = true;
  private lootT = -1;
  protected lootSent: boolean;
  protected readonly xp0: number;
  private readonly names = document.createElement('div');
  private readonly labels = new Map<number, HTMLDivElement>();
  private rosterT = 0;

  constructor(h: CoopHooks, carry?: Carry) {
    this.h = h;
    this.heroes = carry?.heroes ?? new Map();
    this.xp0 = carry?.xp0 ?? xpTotal(h.profile.data);
    this.lootSent = carry?.lootSent ?? false;
    this.ui = carry?.ui ?? new BattleNetUi(document.body);
    this.ui.onSend = (t) => h.net.chat(t);
    h.td.personal = true;
    h.gear.onAction = (a) => this.sendAct(a);
    h.net.battlePing();
    this.off.push(h.profile.onChange(() => { this.kitDirty = true; }));
    this.off.push(h.net.on((m) => this.onCommon(m)));
    this.names.className = 'net-names';
    document.body.appendChild(this.names);
    // ушёл со страницы боя (в лагерь, закрыл вкладку) — награда за бой, сколько собрано
    const leave = (): void => this.sendLoot();
    window.addEventListener('pagehide', leave);
    this.off.push(() => window.removeEventListener('pagehide', leave));
  }

  /** Убрать подписки и подписи; keep — герои и чат остаются новому объекту (гость стал хостом) */
  dispose(keep = false): void {
    for (const f of this.off) f();
    this.off.length = 0;
    this.h.gear.onAction = undefined;
    this.names.remove();
    if (!keep) this.ui.dispose();
  }

  /** Своё действие — другим игрокам */
  protected abstract sendAct(a: GearAction): void;
  /** Свой набор снаряжения — другим игрокам; false — не ушёл (страница боя ещё не вошла в комнату) */
  protected abstract sendKit(kit: KitMsg): boolean;
  protected abstract onMsg(m: ServerMsg): void;
  /** Строки списка игроков */
  protected abstract rows(): RosterRow[];

  /** Чат и состав комнаты — общее; остальное — хосту или гостю */
  private onCommon(m: ServerMsg): void {
    if (m.t === 'chat') { this.ui.add(m.name, m.text); return; }
    if (m.t === 'room.state' && m.room.state === 'battle') this.seats(m.seats);
    // комната в лобби, а бой у нас идёт — сервер перезапустился (бои после перезапуска прерываются)
    if (m.t === 'room.state' && m.room.state === 'lobby' && this.h.td.state === 'play') {
      this.h.td.state = 'lost';
      this.h.toast('Связь с сервером прервалась — бой прерван');
      this.ui.add(null, 'Бой прерван: сервер перезапустился');
    }
    this.onMsg(m);
  }

  /** Состав комнаты сменился: новые — по имени, ушедших — убрать */
  protected seats(list: SeatInfo[]): void {
    const was = new Set(this.h.battle.seats.map((s) => s.seat));
    for (const s of list) if (!was.has(s.seat) && s.seat !== this.h.battle.seat) this.ui.add(null, `${s.name} в бою`);
    const live = new Set(list.map((s) => s.seat));
    for (const [seat, r] of [...this.heroes]) {
      if (live.has(seat)) continue;
      this.ui.add(null, `${this.nameOf(seat)} вышел`);
      this.drop(seat, r);
    }
    this.h.battle.seats = list;
    for (const [seat, el] of this.labels) el.textContent = this.nameOf(seat);
  }

  /** Убрать героя ушедшего игрока */
  protected drop(seat: number, r: Remote): void {
    this.h.scene.remove(r.knight.object);
    this.heroes.delete(seat);
    this.labels.get(seat)?.remove();
    this.labels.delete(seat);
  }

  /** Чат: открыть поле (Enter в бою) */
  openChat(): void { this.ui.openChat(); }
  get typing(): boolean { return this.ui.typing; }

  protected nameOf(seat: number): string { return this.h.battle.seats.find((s) => s.seat === seat)?.name ?? `Игрок ${seat + 1}`; }

  /** Герой другого игрока: рыцарь рядом со своим, свои числа удара, снаряжение по его набору (пока набора нет — меч) */
  protected remote(seat: number): Remote {
    let r = this.heroes.get(seat);
    if (r) return r;
    const h = this.h, k = new Knight(h.scene, h.T);
    k.tune = structuredClone(SWORD);
    const sword = getWeapon('sword');
    if (sword) { applyWeapon(sword, k.tune); k.setWeapon(sword); }
    const a = (seat / 4) * Math.PI * 2;
    k.place(h.hero.pos.x + Math.cos(a) * 1.6, h.hero.pos.z + Math.sin(a) * 1.6, h.hero.yaw, h.hero.pos.y);
    const data: ProfileData = { version: 1, level: 1, xp: 0, points: 0, berries: 0, souls: MAX_SOULS, arrows: MAX_ARROWS, seq: 0, items: [], equip: { melee: null, ranged: null, armor: null, artifacts: [null, null, null], aura: null } };
    const profile = new Profile(data, false);
    const gear = h.makeGear(k, profile);
    k.onStrike = (s) => h.strike(s, k, gear);
    k.onSwing = (step) => h.swing(k, gear, step);
    r = { seat, knight: k, gear, profile, input: emptyInput(), bow: false, downT: 0, rolled: false, ack: 0, ping: 0, lavaT: 0, track: new Track(), to: k.pos.clone(), yawTo: k.yaw };
    this.heroes.set(seat, r);
    return r;
  }

  /** Набор снаряжения другого игрока: предметы и надетое — его снаряжение пересоберётся (оружие, броня, лук, здоровье) */
  protected applyKit(seat: number, kit: KitMsg): void {
    if (seat === this.h.battle.seat || !Array.isArray(kit.items) || typeof kit.equip !== 'object' || !kit.equip) return;
    const r = this.remote(seat), d = r.profile.data;
    const items = JSON.stringify(kit.items), equip = JSON.stringify(kit.equip);
    if (JSON.stringify(d.items) === items && JSON.stringify(d.equip) === equip) return;
    d.items = JSON.parse(items) as Item[];
    d.equip = JSON.parse(equip) as Equipment;
    d.equip.aura ??= null;
    r.profile.save();
  }

  /** Разослать наборы на ближайшем шаге */
  protected kitSoon(): void { this.kitDirty = true; }

  /** Шаг чужих героев и их снаряжения; набор, список игроков и награда — по таймерам */
  protected stepHeroes(dt: number): void {
    const h = this.h;
    for (const r of this.heroes.values()) {
      r.rolled ||= r.input.roll;
      r.knight.update(dt, r.input, h.solids(), h.terrain);
      r.input.roll = false;
      r.profile.data.arrows = MAX_ARROWS;
      r.gear.update(dt, r.bow && !r.knight.down, r.input.aim);
    }
    this.kitT -= dt;
    if (this.kitDirty || this.kitT <= 0) {
      this.kitT = KIT_S;
      if (this.sendKit({ t: 'kit', seat: h.battle.seat, items: h.profile.data.items, equip: h.profile.data.equip })) this.kitDirty = false;
    }
    this.rosterT -= dt;
    if (this.rosterT <= 0) { this.rosterT = 0.25; this.ui.setRoster(this.rows()); }
    // бой кончился — своя награда серверу, когда сбор урожая долетит
    if (h.td.state !== 'play' && this.lootT < 0 && !this.lootSent) this.lootT = LOOT_DELAY;
    if (this.lootT > 0) { this.lootT -= dt; if (this.lootT <= 0) this.sendLoot(); }
  }

  /** Своя награда за бой: собранная и не потраченная малина и опыт за бой — один раз */
  protected sendLoot(): void {
    if (this.lootSent) return;
    const d = this.h.profile.data;
    if (this.h.net.sendLoot(this.h.battle.matchId, d.berries, xpTotal(d) - this.xp0)) this.lootSent = true;
  }

  /** Бой кончился у хоста раньше, чем у нас (комната ушла в лобби) — награда тоже по таймеру */
  protected battleOver(): void { if (this.lootT < 0 && !this.lootSent) this.lootT = LOOT_DELAY; }

  /** Строка списка игроков о своём герое */
  protected myRow(ping: number): RosterRow {
    const h = this.h;
    return { seat: h.battle.seat, name: this.nameOf(h.battle.seat), hp: h.hero.hp, maxHp: h.hero.maxHp, ping, host: h.battle.seat === h.battle.hostSeat, me: true, down: h.hero.down };
  }

  /** Имена над героями: свой и чужие; за камерой — спрятать */
  drawNames(camera: THREE.Camera): void {
    const w = window.innerWidth, hgt = window.innerHeight, v = new THREE.Vector3();
    camera.updateMatrixWorld();
    const list: [number, Knight][] = [[this.h.battle.seat, this.h.hero], ...[...this.heroes.values()].map((r): [number, Knight] => [r.seat, r.knight])];
    for (const [seat, k] of list) {
      let el = this.labels.get(seat);
      if (!el) {
        el = document.createElement('div');
        el.className = `net-name${seat === this.h.battle.seat ? ' me' : ''}`;
        el.textContent = this.nameOf(seat);
        this.names.appendChild(el);
        this.labels.set(seat, el);
      }
      v.set(k.pos.x, k.pos.y + 2.35, k.pos.z).project(camera);
      const show = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      el.style.display = show ? '' : 'none';
      if (show) el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * hgt}px) translate(-50%, -100%)`;
      el.classList.toggle('down', k.down);
    }
  }

  /** Для тестов: чужие герои — место, здоровье, наибольшее здоровье, оружие */
  get othersInfo(): { seat: number; x: number; z: number; hp: number; maxHp: number; melee: string | null }[] {
    return [...this.heroes.values()].map((r) => ({ seat: r.seat, x: r.knight.pos.x, z: r.knight.pos.z, hp: r.knight.hp, maxHp: r.knight.maxHp, melee: r.profile.equipped('melee')?.def ?? null }));
  }
}

/** Хост общего боя */
export class CoopHost extends Coop {
  readonly host = true;
  private snapT = 0;
  private tick = 0;
  /** Перекат своего героя с прошлого снимка — гости увидят его даже между снимками */
  private rolled = false;
  /** Последние наборы гостей — пересылаются всем вместе со своим */
  private readonly kits = new Map<number, KitMsg>();

  constructor(h: CoopHooks, carry?: Carry) {
    super(h, carry);
    for (const s of h.battle.seats) if (s.seat !== h.battle.hostSeat) this.ally(s.seat);
    // перехватил бой у ушедшего хоста: чужие герои — теперь союзники (цели мобов, сборщики малины)
    for (const seat of [...this.heroes.keys()]) this.ally(seat);
    party.hurt = (k, dmg, from, knock) => this.hurt(k, dmg, from, knock);
    // волна отбита: у каждого своя малина — награда и гостям
    h.td.onBounty = (n) => this.relay({ t: 'gain', n, why: 'wave' } satisfies GainMsg);
  }

  override dispose(keep = false): void {
    super.dispose(keep);
    party.allies.length = 0;
    party.hurt = null;
    this.h.td.onBounty = undefined;
    this.h.props.collectors.length = 0;
  }

  private relay(d: unknown, to?: number): boolean { return this.h.net.relay(d, to); }

  /** Герой гостя: и цель мобов (src/party.ts), и сборщик общей малины */
  private ally(seat: number): Remote {
    const r = this.remote(seat), k = r.knight;
    if (!party.allies.includes(k)) {
      party.allies.push(k);
      // малина общая: герой гостя подобрал кучку — малина гостю
      this.h.props.collectors.push({ pos: k.pos, get down() { return k.down; }, take: (n) => { this.relay({ t: 'gain', n, why: 'pick' } satisfies GainMsg, seat); } });
    }
    return r;
  }

  protected override drop(seat: number, r: Remote): void {
    const k = r.knight, i = party.allies.indexOf(k);
    if (i >= 0) party.allies.splice(i, 1);
    const c = this.h.props.collectors.findIndex((x) => x.pos === k.pos);
    if (c >= 0) this.h.props.collectors.splice(c, 1);
    this.kits.delete(seat);
    super.drop(seat, r);
  }

  protected sendAct(a: GearAction): void { this.relay({ t: 'act', seat: this.h.battle.hostSeat, ...a } satisfies ActMsg); }

  protected sendKit(kit: KitMsg): boolean {
    for (const k of this.kits.values()) this.relay(k);
    return this.relay(kit);
  }

  protected onMsg(m: ServerMsg): void {
    if (m.t === 'battle.over') { this.battleOver(); return; }
    if (m.t !== 'relay') return;
    const d = m.d as GuestInput | TdCommand | ActMsg | KitMsg | null;
    if (!d) return;
    if (d.t === 'in') {
      const r = this.ally(m.from);
      // перекат — однократный: держится до шага, который его прочтёт
      setInput(r.input, d.move[0], d.move[1], d.aim[0], d.aim[2], d.attack, d.roll || r.input.roll);
      r.bow = !!d.bow;
      r.ack = d.seq;
      r.ping = d.ping ?? 0;
    } else if (d.t === 'td') {
      // гость уже заплатил (paid): что осталось — возврат, продажа и бонус волны — ему в кошелёк
      let left = Math.max(0, d.paid ?? 0);
      const purse: Purse = { get: () => left, add: (n) => { left += n; } };
      this.h.td.command(d, purse);
      if (left > 0) this.relay({ t: 'gain', n: left, why: 'back' } satisfies GainMsg, m.from);
    } else if (d.t === 'act') {
      const r = this.ally(m.from);
      r.gear.perform(d);
      this.relay({ ...d, seat: m.from });
    } else if (d.t === 'kit') {
      const kit: KitMsg = { t: 'kit', seat: m.from, items: d.items, equip: d.equip };
      // гость вошёл (или перезагрузился) — свой набор и чужие ему сразу, не через KIT_S
      if (!this.kits.has(m.from)) this.kitSoon();
      this.kits.set(m.from, kit);
      this.applyKit(m.from, kit);
    }
  }

  /** Удар моба по герою гостя: урон, цифра, отброс — как свой hurtHero; отброс — и самому гостю */
  private hurt(k: Knight, dmg: number, from: THREE.Vector3, knock: number): void {
    const hp0 = k.hp;
    if (!k.hurt(dmg)) return;
    const lost = hp0 - k.hp;
    if (lost >= 1) this.h.fx.text(k.pos.clone().setY(k.pos.y + 1.2), `−${Math.round(lost)}`, '');
    if (knock > 0) {
      const d = new THREE.Vector3(k.pos.x - from.x, 0, k.pos.z - from.z);
      if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
      d.normalize().multiplyScalar(knock);
      k.vel.add(d);
      const seat = [...this.heroes.values()].find((r) => r.knight === k)?.seat;
      if (seat !== undefined) this.relay({ t: 'knock', vx: r2(d.x), vz: r2(d.z) } satisfies KnockMsg, seat);
    }
  }

  update(dt: number): void {
    const h = this.h;
    this.rolled ||= h.input.roll;
    for (const r of this.heroes.values()) {
      const k = r.knight;
      if (k.down) { r.downT += dt; if (r.downT > REVIVE_S) { k.revive(); r.downT = 0; } }
      // зоны врагов замедляют и лава жжёт героя гостя — как своего
      k.slow = Math.min(0.8, h.slowFor(k));
      if (!k.down && h.inLava(k.pos)) {
        r.lavaT -= dt;
        if (r.lavaT <= 0) {
          r.lavaT = LAVA_S;
          this.hurt(k, LAVA_DMG, k.pos, 0);
          h.fx.burst(k.pos.clone().setY(k.pos.y + 0.2), [new THREE.Color(3.4, 1.4, 0.3), '#ff8a2a'], 8, { speed: 1.5, up: 3, size: 0.09, life: 0.5, glow: true, gravity: 2 });
        }
      } else r.lavaT = 0;
    }
    this.stepHeroes(dt);
    this.snapT -= dt;
    if (this.snapT > 0) return;
    this.snapT = 1 / SNAP_HZ;
    this.relay(this.snapshot());
  }

  private heroSnap(seat: number, k: Knight, i: KnightInput, rolled: boolean, bow: boolean, ack: number, ping: number): HeroSnap {
    return [seat, r2(k.pos.x), r2(k.pos.y), r2(k.pos.z), r2(k.yaw), Math.round(k.hp), k.maxHp, k.down ? 1 : 0,
      r2(i.move.x), r2(i.move.y), r2(i.aim.x), r2(i.aim.z), i.attack ? 1 : 0, rolled ? 1 : 0, bow ? 1 : 0, ack, Math.round(ping)];
  }

  protected rows(): RosterRow[] {
    const hs = this.h.battle.hostSeat;
    return [this.myRow(this.h.net.rtt), ...[...this.heroes.values()].map((r): RosterRow => ({
      seat: r.seat, name: this.nameOf(r.seat), hp: r.knight.hp, maxHp: r.knight.maxHp, ping: r.ping, host: r.seat === hs, me: false, down: r.knight.down,
    }))];
  }

  /** Для тестов: герои гостей */
  get alliesInfo(): Coop['othersInfo'] { return this.othersInfo; }

  snapshot(): BattleSnap {
    const h = this.h;
    const heroes = [this.heroSnap(h.battle.hostSeat, h.hero, h.input, this.rolled, h.bow(), 0, h.net.rtt)];
    this.rolled = false;
    for (const r of this.heroes.values()) { heroes.push(this.heroSnap(r.seat, r.knight, r.input, r.rolled, r.bow, r.ack, r.ping)); r.rolled = false; }
    const mobs: MobSnap[] = h.td.pack.mobs.filter((m) => !m.dead).map((m) => {
      const aim = m.aimPos;
      const flags = (m.summoned ? MOB_FLAG.summoned : 0) | (m.state === 'daze' ? MOB_FLAG.daze : 0) | (m.chillT > 0 ? MOB_FLAG.chill : 0)
        | (m.rally > 0 ? MOB_FLAG.rally : 0) | (m.alerted ? MOB_FLAG.alerted : 0);
      return [m.net, m.kind, r2(m.pos.x), r2(m.pos.y), r2(m.pos.z), r2(m.yaw), Math.round(m.hp), m.maxHp, flags,
        m.state === 'attack' ? m.attack : '', m.attackSeq, r2(aim.x), r2(aim.z), m.laneId ?? '', m.marchI];
    });
    return { t: 'snap', tick: ++this.tick, heroes, mobs, td: h.td.snap(), piles: h.props.berryPiles() };
  }
}

/** Гость общего боя */
export class CoopGuest extends Coop {
  readonly host = false;
  private inputT = 0;
  private seq = 0;
  private rolled = false;
  /** Где был свой герой, когда ушёл ввод seq — сверка с местом хоста по ack */
  private readonly sent: { seq: number; x: number; z: number }[] = [];
  /** Буферы мест кукол по сетевому id */
  private readonly tracks = new Map<number, Track>();
  /** Герои последнего снимка — для списка игроков */
  private last: HeroSnap[] = [];
  /** Снимков получено (для тестов) */
  snaps = 0;

  constructor(h: CoopHooks) {
    super(h);
    h.td.remote = (c) => h.net.relay(c);
    h.td.pack.mirror = true;
  }

  override dispose(keep = false): void { super.dispose(keep); this.h.td.remote = null; this.h.td.pack.mirror = false; }

  protected sendAct(a: GearAction): void { this.h.net.relay({ t: 'act', ...a } satisfies ActMsg); }
  protected sendKit(kit: KitMsg): boolean { return this.h.net.relay({ t: 'kit', items: kit.items, equip: kit.equip } satisfies KitMsg); }

  protected onMsg(m: ServerMsg): void {
    if (m.t === 'battle.over') {
      // итог мог уйти раньше последнего снимка: комната уже в лобби, снимков больше не будет
      if (this.h.td.state === 'play') this.h.td.state = m.result === 'won' ? 'won' : 'lost';
      if (m.result === 'abandoned') this.h.toast('Все вышли — бой прерван');
      this.battleOver();
      return;
    }
    if (m.t === 'battle.host' && m.matchId === this.h.battle.matchId) {
      const old = this.h.battle.hostSeat;
      this.h.battle.hostSeat = m.hostSeat;
      this.ui.add(null, `${this.nameOf(old)} вышел — бой ведёт ${this.nameOf(m.hostSeat)}`);
      if (m.hostSeat === this.h.battle.seat) this.promote(old);
      return;
    }
    if (m.t !== 'relay' || m.from !== this.h.battle.hostSeat) return;
    const d = m.d as BattleSnap | GainMsg | ActMsg | KitMsg | KnockMsg | null;
    if (!d) return;
    if (d.t === 'snap') this.apply(d);
    else if (d.t === 'gain') this.h.td.gain(d.n, d.why);
    else if (d.t === 'knock') this.h.hero.vel.add(new THREE.Vector3(d.vx, 0, d.vz));
    else if (d.t === 'act') { if (d.seat !== undefined && d.seat !== this.h.battle.seat) this.remote(d.seat).gear.perform(d); }
    else if (d.t === 'kit') { if (d.seat !== undefined) this.applyKit(d.seat, d); }
  }

  /**
   * Хост ушёл, хост — я: бой дальше считаю сам с последнего снимка. Герой ушедшего — убрать,
   * оборона — перехватить (волны, враги), остальные — союзники нового хоста
   */
  private promote(oldHost: number): void {
    const gone = this.heroes.get(oldHost);
    if (gone) this.drop(oldHost, gone);
    this.h.td.takeOver();
    this.dispose(true);
    this.h.replaced(new CoopHost(this.h, { heroes: this.heroes, xp0: this.xp0, lootSent: this.lootSent, ui: this.ui }));
  }

  private apply(s: BattleSnap): void {
    this.snaps++;
    const h = this.h, me = h.battle.seat, t = now();
    for (const hs of s.heroes) {
      const [seat, x, y, z, yaw, hp, , down, mx, mz, ax, az, attack, roll, bow, ack] = hs;
      if (seat === me) { this.reconcile(x, y, z, hp, !!down, ack); continue; }
      const had = this.heroes.has(seat), o = this.remote(seat);
      if (!had) { o.knight.place(x, z, yaw, y); o.to.set(x, y, z); }
      o.track.push(t, x, y, z, yaw);
      setInput(o.input, mx, mz, ax, az, !!attack, !!roll || o.input.roll);
      o.bow = !!bow;
      if (down && !o.knight.down) { o.knight.hp = 0; o.knight.down = true; }
      else if (!down && o.knight.down) o.knight.revive();
      if (!down) o.knight.hp = hp;
    }
    this.last = s.heroes;
    this.mobs(s.mobs, t);
    if (s.td) h.td.applySnap(s.td);
    h.props.mirrorBerries(s.piles ?? []);
  }

  /**
   * Свой герой по снимку: здоровье и «без сил» — хоста (наибольшее — своё снаряжение, у хоста то же по набору).
   * Место: хост учёл ввод до ack — сравниваем с тем, где сами были тогда; расхождение убираем на CORRECT_K за снимок,
   * больше SNAP_DIST — сразу на место хоста
   */
  private reconcile(x: number, y: number, z: number, hp: number, down: boolean, ack: number): void {
    const k = this.h.hero;
    if (down && !k.down) { k.hp = 0; k.down = true; }
    else if (!down && k.down) k.revive();
    if (!down) k.hp = Math.min(k.maxHp, hp);
    while (this.sent.length && this.sent[0].seq < ack) this.sent.shift();
    const then = this.sent[0]?.seq === ack ? this.sent[0] : null;
    const ex = x - (then ? then.x : k.pos.x), ez = z - (then ? then.z : k.pos.z), e = Math.hypot(ex, ez);
    if (e > SNAP_DIST || Math.abs(k.pos.y - y) > 2) {
      k.place(k.pos.x + ex, k.pos.z + ez, k.yaw, y);
      this.sent.length = 0;
    } else if (e > 0.05) {
      const cx = ex * CORRECT_K, cz = ez * CORRECT_K;
      k.pos.x += cx; k.pos.z += cz;
      for (const p of this.sent) { p.x += cx; p.z += cz; }
    }
  }

  protected rows(): RosterRow[] {
    const hs = this.h.battle.hostSeat, me = this.h.battle.seat;
    return [this.myRow(this.h.net.rtt), ...this.last.filter((r) => r[0] !== me).map((r): RosterRow => ({
      seat: r[0], name: this.nameOf(r[0]), hp: r[5], maxHp: r[6], ping: r[16] ?? 0, host: r[0] === hs, me: false, down: !!r[7],
    }))];
  }

  /** Враги — куклы: новые появляются, пропавшие со снимка рассыпаются (малина с них — у хоста, придёт кучками в снимке) */
  private mobs(list: MobSnap[], t: number): void {
    const pack = this.h.td.pack;
    const byId = new Map<number, Mob>();
    for (const m of pack.mobs) byId.set(m.net, m);
    const seen = new Set<Mob>();
    for (const [id, kind, x, y, z, yaw, hp, maxHp, flags, attack, seq, ax, az, lane, marchI] of list) {
      let m = byId.get(id);
      if (!m) {
        const made = pack.spawn(kind, new THREE.Vector3(x, 0, z));
        if (!made) continue;
        m = made;
        m.puppet = true;
        m.net = id;
        m.yaw = m.pupYaw = yaw;
        m.pupTo.set(x, y, z);
        byId.set(id, m);
      }
      let tr = this.tracks.get(id);
      if (!tr) { tr = new Track(); this.tracks.set(id, tr); }
      tr.push(t, x, y, z, yaw);
      m.summoned = (flags & MOB_FLAG.summoned) !== 0;
      m.pupDaze = (flags & MOB_FLAG.daze) !== 0;
      m.pupAlerted = (flags & MOB_FLAG.alerted) !== 0;
      if (flags & MOB_FLAG.chill) m.chillT = Math.max(m.chillT, 0.3);
      if (flags & MOB_FLAG.rally) m.rally = Math.max(m.rally, 0.3);
      m.pupAttack = attack;
      m.pupSeq = seq;
      m.pupAim.set(ax, 0, az);
      m.laneId = lane || null;
      m.marchI = marchI ?? 0;
      m.maxHp = maxHp;
      m.hp = hp;
      seen.add(m);
    }
    for (const m of pack.mobs) if (!seen.has(m) && !m.dead) { m.vanish(); this.tracks.delete(m.net); }
  }

  update(dt: number): void {
    const h = this.h, t = now() - RENDER_DELAY;
    this.rolled ||= h.input.roll;
    this.stepHeroes(dt);
    h.props.mirrorStep(dt);
    // чужие герои: шаг — по вводу, место — из буфера снимков
    for (const o of this.heroes.values()) {
      o.yawTo = o.track.sample(t, o.to);
      const k = o.knight, d = Math.hypot(k.pos.x - o.to.x, k.pos.z - o.to.z);
      if (d > 3) k.place(o.to.x, o.to.z, o.yawTo, o.to.y);
      else { const a = Math.min(1, dt * 12); k.pos.x += (o.to.x - k.pos.x) * a; k.pos.z += (o.to.z - k.pos.z) * a; }
    }
    // куклы — тоже из буфера
    for (const m of h.td.pack.mobs) { const tr = this.tracks.get(m.net); if (tr && m.puppet) m.pupYaw = tr.sample(t, m.pupTo); }
    this.inputT -= dt;
    if (this.inputT > 0) return;
    this.inputT = 1 / INPUT_HZ;
    const i = h.input, seq = ++this.seq;
    const msg: GuestInput = { t: 'in', seq, move: [r2(i.move.x), r2(i.move.y)], aim: [r2(i.aim.x), r2(i.aim.y), r2(i.aim.z)], attack: i.attack, roll: this.rolled, bow: h.bow(), ping: h.net.rtt };
    if (!h.net.relay(msg)) return;
    this.rolled = false;
    this.sent.push({ seq, x: h.hero.pos.x, z: h.hero.pos.z });
    if (this.sent.length > 120) this.sent.shift();
  }
}
