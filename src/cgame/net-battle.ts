import * as THREE from 'three';
import type { Obstacle } from '../collision.ts';
import type { FX } from '../fx.ts';
import { t } from '../i18n/i18n.ts';
import type { Gear } from '../gear.ts';
import { MAX_ARROWS, MAX_SOULS, Profile, type Equipment, type Item, type ProfileData } from '../items.ts';
import { emptyInput, Knight, type KnightInput } from '../knight.ts';
import type { Terrain } from '../level/collide.ts';
import type { Mob } from '../mobs/mob.ts';
import type { Pack } from '../mobs/pack.ts';
import { BattleNetUi, type RosterRow } from '../net/battle-ui.ts';
import { Channel } from '../net/channel.ts';
import type { NetBattle, NetClient } from '../net/client.ts';
import { CMD_DUP, MOB_FLAG, TICK, type Cmd, type CmdBatch, type GameClientMsg, type GameServerMsg, type HeroEnt, type MobEnt } from '../net/game-protocol.ts';
import { CLOSE, PROTOCOL, type GearAction, type SeatInfo, type ServerMsg, type TdCommand } from '../net/protocol.ts';
import { SnapshotView, type Delta, type EntityState } from '../net/snapshot.ts';
import { WebSocketTransport, type SocketLike } from '../net/ws-transport.ts';
import type { EventQueue } from './events.ts';
import type { SimEvent } from '../sim/events.ts';
import type { SimTd } from '../sim/td.ts';
import type { SimExpedition } from '../sim/expedition.ts';
import type { ExpUi } from './exp-ui.ts';
import type { ExpeditionView } from './views/expedition-view.ts';
import { SimWisp } from '../sim/fog.ts';
import { SimTower } from '../sim/tower.ts';
import type { SimWorld } from '../sim/world.ts';
import { applyWeapon, getWeapon } from '../weapons.ts';
import { SWORD } from '../tuning.ts';
import type { TowerKind } from '../td/towers.ts';
import type { Textures } from '../textures.ts';
import type { TdUi } from './td-ui.ts';
import type { TdView } from './views/td-view.ts';

/**
 * Network battle client — "cgame" (wiki/design-multiplayer.md, section 7): the server runs the battle (src/game/match.ts),
 * snapshot deltas arrive here over `/game` (src/net/game-protocol.ts). Our own hero is predicted locally and reconciled
 * with the server position by acknowledged input; other heroes are knights driven by snapshot input with an interpolation buffer; enemies are
 * puppets (`Mob.puppet`) from records; the defence is a `SimTd` mirror from records for the menu and HUD, commands go to the server
 */
export interface NetBattleHooks {
  net: NetClient;
  battle: NetBattle;
  token: string;
  /** Server address http(s)://… */
  base: string;
  scene: THREE.Scene;
  T: Textures;
  fx: FX;
  hero: Knight;
  gear: Gear;
  profile: Profile;
  input: KnightInput;
  bow(): boolean;
  /** Bush Defence: the mirror of the defence, its view and menu; absent in another mode */
  sim?: SimTd;
  world: SimWorld;
  pack: Pack;
  tdView?: TdView;
  tdUi?: TdUi;
  /** Expedition: the mirror of the mission rules, its view and HUD */
  exp?: { sim: SimExpedition; view: ExpeditionView; ui: ExpUi };
  terrain: Terrain;
  solids(): Obstacle[];
  /** Gear for another player's hero: the same targets, sound only near our own hero */
  makeGear(k: Knight, p: Profile): Gear;
  /** Swing whoosh of another player's hero (nearby) */
  swing(k: Knight, g: Gear, step: number): void;
  toast(s: string): void;
  quiet(): boolean;
  /** Client event queue: network frames are applied when it is drained before the ticks */
  events: EventQueue;
  /** Voice chat (src/net/voice.ts): own mic and who is talking — for the player list */
  voice?: { readonly on: boolean; speaking(seat: number): boolean };
  /** The battle is over (the server's result) */
  onOver(result: 'won' | 'lost' | 'abandoned', wave: number): void;
}

/** Input commands per second (one per tick) */
const CMD_HZ = 60;
/** Other heroes and puppets are shown with a delay — between two snapshots, no jerks on an uneven link, s */
const RENDER_DELAY = 0.1;
/** Server time estimate (Quake 3's cl.serverTimeDelta): the offset "snapshot time − own clock"; drifted further — reset, s */
const TIME_RESET = 0.5;
/** Drifted less than the reset but noticeably — halfway; otherwise creeps a little per snapshot */
const TIME_JUMP = 0.1;
const TIME_NUDGE_UP = 0.001;
const TIME_NUDGE_DOWN = 0.002;
/** Drifted further from the snapshot — our hero snaps to the server position, m; less — pulled by CORRECT_K per snapshot */
const SNAP_DIST = 2.5;
const CORRECT_K = 0.2;
const REVIVE_S = 2;

const r2 = (v: number): number => Math.round(v * 100) / 100;
const now = (): number => performance.now() / 1000;

/** Buffer of snapshot positions by server time: the position at time t between two neighbours (past the last one — no further than half a step ahead) */
export class Track {
  private readonly s: { t: number; x: number; y: number; z: number; yaw: number }[] = [];
  push(t: number, x: number, y: number, z: number, yaw: number): void {
    this.s.push({ t, x, y, z, yaw });
    if (this.s.length > 6) this.s.shift();
  }
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

/** Another player's hero: a knight, its gear, input from the snapshot, position buffer */
interface Remote { seat: number; knight: Knight; gear: Gear; profile: Profile; input: KnightInput; bow: boolean; track: Track; to: THREE.Vector3; yawTo: number; hp: number; maxHp: number; ping: number; down: boolean }

type R = GameClientMsg | GameServerMsg;
type U = CmdBatch | Delta<SimEvent>;

export class NetBattleClient {
  readonly h: NetBattleHooks;
  readonly view = new SnapshotView<SimEvent>();
  readonly heroes = new Map<number, Remote>();
  private readonly tracks = new Map<string, Track>();
  private readonly ui: BattleNetUi;
  private chan: Channel<R, U> | null = null;
  private ws: WebSocket | null = null;
  private stopped = false;
  private retry = 0;
  private seq = 0;
  private rolled = false;
  private cmdT = 0;
  private readonly sent: { seq: number; x: number; z: number }[] = [];
  /** The latest commands — sent as a batch in every frame (cl_packetdup) */
  private readonly recent: Cmd[] = [];
  /** Server time ≈ own clock + timeDelta (from snapshots); unknown before the first snapshot */
  private timeDelta = 0;
  private timeKnown = false;
  private readonly names = document.createElement('div');
  private readonly labels = new Map<number, HTMLDivElement>();
  private rosterT = 0;
  private readonly off: (() => void)[] = [];
  /** Snapshots applied (for tests) */
  snaps = 0;
  /** The battle result arrived */
  over: 'won' | 'lost' | 'abandoned' | null = null;
  /** Battle connection open and the seat confirmed */
  joined = false;

  constructor(h: NetBattleHooks) {
    this.h = h;
    this.ui = new BattleNetUi(document.body);
    this.ui.onSend = (t) => h.net.chat(t);
    this.names.className = 'net-names';
    document.body.appendChild(this.names);
    h.pack.mirror = true;
    if (h.sim) h.sim.remote = (c) => { if (c.t === 'td') this.sendTd(c); };
    if (h.exp) h.exp.sim.remote = (c) => { if (c.t === 'exp') this.chan?.sendReliable({ t: 'exp', a: c.a }); };
    h.gear.onAction = (a) => this.sendAct(a);
    h.net.battlePing();
    // gear changes go as tens-of-bytes `gear` messages; the kit itself the server took from the database
    h.profile.onOp = (op) => { this.chan?.sendReliable({ t: 'gear', ...op }); };
    this.off.push(h.net.on((m) => this.onLobby(m)));
    this.connect();
  }

  dispose(): void {
    this.stopped = true;
    for (const f of this.off) f();
    this.h.gear.onAction = undefined;
    this.h.profile.onOp = undefined;
    if (this.h.sim) this.h.sim.remote = null;
    if (this.h.exp) this.h.exp.sim.remote = null;
    this.h.pack.mirror = false;
    this.ws?.close();
    this.names.remove();
    this.ui.dispose();
  }

  // ---------- connection ----------

  private connect(): void {
    if (this.stopped) return;
    const ws = new WebSocket(`${this.h.base.replace(/^http/, 'ws')}/game`);
    this.ws = ws;
    ws.onopen = () => {
      const chan = new Channel<R, U>(new WebSocketTransport(ws as unknown as SocketLike, this.h.events), { clock: () => performance.now() });
      this.chan = chan;
      chan.onReliable = (m) => this.onReliable(m as GameServerMsg);
      chan.onUnreliable = (u) => this.onDelta(u as Delta<SimEvent>);
      chan.onClose = (code) => {
        if (this.chan !== chan) return;
        this.chan = null;
        this.joined = false;
        if (this.stopped || code === CLOSE.auth || code === CLOSE.protocol || code === 4004) return;
        this.retry = Math.min(this.retry + 1, 5);
        window.setTimeout(() => this.connect(), 500 * 2 ** this.retry);
      };
      chan.sendReliable({ t: 'hello', token: this.h.token, matchId: this.h.battle.matchId, protocol: PROTOCOL });
    };
    ws.onerror = () => { /* onclose reconnects */ };
  }

  private onReliable(m: GameServerMsg): void {
    switch (m.t) {
      case 'welcome': this.joined = true; this.retry = 0; this.sent.length = 0; this.recent.length = 0; this.seq = 0; break;
      case 'kit': if (m.seat !== this.h.battle.seat) this.applyKit(m.seat, m.items, m.equip); break;
      case 'mine': this.takeMine(m); break;
      case 'act': { const { t: _t, seat, ...a } = m; void _t; if (seat !== this.h.battle.seat) this.remote(seat).gear.perform(a as GearAction); break; }
      case 'toast': this.h.toast(t(m.text)); break;
      case 'over': if (!this.over) { this.over = m.result; this.h.onOver(m.result, m.wave); } break;
      case 'error': this.h.toast(t(m.text)); break;
    }
  }

  /** Lobby: chat, room roster, end of battle */
  private onLobby(m: ServerMsg): void {
    if (m.t === 'chat') this.ui.add(m.name, m.text);
    if (m.t === 'room.state' && m.room.state === 'battle') this.seats(m.seats);
    if (m.t === 'battle.over' && m.matchId === this.h.battle.matchId && !this.over) { this.over = m.result; this.h.onOver(m.result, m.wave); }
  }

  private seats(list: SeatInfo[]): void {
    const was = new Set(this.h.battle.seats.map((s) => s.seat));
    for (const s of list) if (!was.has(s.seat) && s.seat !== this.h.battle.seat) this.ui.add(null, t('{name} joined the battle', { name: s.name }));
    const live = new Set(list.map((s) => s.seat));
    for (const [seat, r] of [...this.heroes]) if (!live.has(seat)) { this.ui.add(null, t('{name} left', { name: this.nameOf(seat) })); this.drop(seat, r); }
    this.h.battle.seats = list;
    for (const [seat, el] of this.labels) el.textContent = this.nameOf(seat);
  }

  private nameOf(seat: number): string { return this.h.battle.seats.find((s) => s.seat === seat)?.name ?? t('Player {n}', { n: seat + 1 }); }

  // ---------- sending ----------

  private sendTd(c: TdCommand): void { this.chan?.sendReliable({ t: 'td', a: c.a, pad: c.pad, wall: c.wall }); }
  /** Action with the number of the last command: the server executes it after that one, before the next, as on the client */
  private sendAct(a: GearAction): void { this.chan?.sendReliable({ t: 'act', seq: this.seq, ...a }); }

  // ---------- snapshots ----------

  private onDelta(d: Delta<SimEvent>): void {
    if (!this.view.apply(d)) return;
    this.snaps++;
    const t = this.serverTime(d.tick * TICK), v = this.view, me = this.h.battle.seat;
    const seenMobs = new Set<number>();
    for (const e of v.ents.values()) {
      const id = e.id;
      if (id[0] === 'h' && /^h\d+$/.test(id)) {
        const he = e as HeroEnt;
        if (he.seat === me) this.reconcile(he);
        else this.remoteFrom(he, t, v.added.includes(e));
      } else if (id[0] === 'm' && /^m\d+$/.test(id)) { seenMobs.add(Number(id.slice(1))); this.puppetFrom(e as MobEnt, t); }
    }
    for (const r of this.heroes.values()) if (!v.ents.has(`h${r.seat}`)) { /* the room roster removes those who left */ }
    for (const m of this.h.pack.mobs) if (!seenMobs.has(m.net) && !m.dead) { m.vanish(); this.tracks.delete(`m${m.net}`); }
    if (this.h.sim) this.mirrorTd(this.h.sim, v);
    this.h.tdView?.apply(v);
    this.h.tdUi?.events(v.events);
    const exp = this.h.exp;
    if (exp) {
      exp.sim.mirror(v.ents);
      // raspberries of the mission purse — the hero's for the HUD
      this.h.profile.data.berries = exp.sim.berries(me);
      exp.view.apply(v);
      exp.ui.events(v.events);
    }
  }

  /** Snapshot time into the server clock estimate; returns the snapshot time (the axis of the interpolation buffers) */
  private serverTime(snapT: number): number {
    const want = snapT - now(), diff = want - this.timeDelta;
    if (!this.timeKnown || Math.abs(diff) > TIME_RESET) { this.timeDelta = want; this.timeKnown = true; }
    else if (Math.abs(diff) > TIME_JUMP) this.timeDelta += diff / 2;
    else this.timeDelta += Math.max(-TIME_NUDGE_DOWN, Math.min(TIME_NUDGE_UP, diff));
    return snapT;
  }

  /** Our hero from the snapshot: health and "exhausted" are the server's; position is reconciled by acknowledged input */
  private reconcile(he: HeroEnt): void {
    const k = this.h.hero;
    if (he.down && !k.down) { k.hp = 0; k.down = true; }
    else if (!he.down && k.down) k.revive();
    if (!he.down) k.hp = Math.min(k.maxHp, he.hp);
    const ack = he.ack;
    while (this.sent.length && this.sent[0].seq < ack) this.sent.shift();
    const then = this.sent[0]?.seq === ack ? this.sent[0] : null;
    const ex = he.x - (then ? then.x : k.pos.x), ez = he.z - (then ? then.z : k.pos.z), e = Math.hypot(ex, ez);
    if (e > SNAP_DIST || Math.abs(k.pos.y - he.y) > 2) {
      k.place(k.pos.x + ex, k.pos.z + ez, k.yaw, he.y);
      this.sent.length = 0;
    } else if (e > 0.05) {
      const cx = ex * CORRECT_K, cz = ez * CORRECT_K;
      k.pos.x += cx; k.pos.z += cz;
      for (const p of this.sent) { p.x += cx; p.z += cz; }
    }
  }

  /** Another player's hero: a knight nearby, its own strike numbers, gear from its kit (a sword until the kit arrives) */
  private remote(seat: number): Remote {
    let r = this.heroes.get(seat);
    if (r) return r;
    const h = this.h, k = new Knight(h.scene, h.T);
    k.tune = structuredClone(SWORD);
    const sword = getWeapon('sword');
    if (sword) { applyWeapon(sword, k.tune); k.setWeapon(sword); }
    k.place(h.hero.pos.x + 1.6, h.hero.pos.z, h.hero.yaw, h.hero.pos.y);
    const data: ProfileData = { version: 1, level: 1, xp: 0, points: 0, berries: 0, souls: MAX_SOULS, arrows: MAX_ARROWS, seq: 0, items: [], equip: { melee: null, ranged: null, armor: null, artifacts: [null, null, null], aura: null } };
    const profile = new Profile(data);
    const gear = h.makeGear(k, profile);
    k.onSwing = (step) => h.swing(k, gear, step);
    r = { seat, knight: k, gear, profile, input: emptyInput(), bow: false, track: new Track(), to: k.pos.clone(), yawTo: k.yaw, hp: k.hp, maxHp: k.maxHp, ping: 0, down: false };
    this.heroes.set(seat, r);
    return r;
  }

  private remoteFrom(he: HeroEnt, t: number, fresh: boolean): void {
    const had = this.heroes.has(he.seat), o = this.remote(he.seat);
    if (!had || fresh) { o.knight.place(he.x, he.z, he.yaw, he.y); o.to.set(he.x, he.y, he.z); }
    o.track.push(t, he.x, he.y, he.z, he.yaw);
    o.input.move.set(he.mx, he.mz);
    o.input.aim.set(he.ax, o.input.aim.y, he.az);
    o.input.attack = !!he.attack;
    o.input.roll = !!he.roll || o.input.roll;
    o.bow = !!he.bow;
    o.hp = he.hp; o.maxHp = he.maxHp; o.ping = he.ping; o.down = !!he.down;
    if (he.down && !o.knight.down) { o.knight.hp = 0; o.knight.down = true; }
    else if (!he.down && o.knight.down) o.knight.revive();
    if (!he.down) o.knight.hp = he.hp;
  }

  /** The server's copy of own gear (reconnected after changes in this battle) replaces the local one */
  private takeMine(m: Extract<GameServerMsg, { t: 'mine' }>): void {
    if (!Array.isArray(m.items) || typeof m.equip !== 'object' || !m.equip) return;
    const d = this.h.profile.data;
    d.items = m.items as Item[];
    d.equip = m.equip as Equipment;
    d.equip.aura ??= null;
    d.seq = m.seq; d.points = m.points; d.arrows = m.arrows;
    this.h.profile.save();
  }

  private applyKit(seat: number, items: unknown, equip: unknown): void {
    if (!Array.isArray(items) || typeof equip !== 'object' || !equip) return;
    const r = this.remote(seat), d = r.profile.data;
    const a = JSON.stringify(items), b = JSON.stringify(equip);
    if (JSON.stringify(d.items) === a && JSON.stringify(d.equip) === b) return;
    d.items = JSON.parse(a) as Item[];
    d.equip = JSON.parse(b) as Equipment;
    d.equip.aura ??= null;
    r.profile.save();
  }

  private drop(seat: number, r: Remote): void {
    this.h.scene.remove(r.knight.object);
    this.heroes.delete(seat);
    this.labels.get(seat)?.remove();
    this.labels.delete(seat);
  }

  /** Enemy puppet: a new one appears, the rest — position, attack, flags from the snapshot */
  private puppetFrom(e: MobEnt, t: number): void {
    const pack = this.h.pack, id = Number(e.id.slice(1));
    let m: Mob | undefined = pack.mobs.find((x) => x.net === id);
    if (!m) {
      const made = pack.spawn(e.kind, new THREE.Vector3(e.x, 0, e.z));
      if (!made) return;
      m = made;
      m.puppet = true;
      m.net = id;
      m.yaw = m.pupYaw = e.yaw;
      m.pupTo.set(e.x, e.y, e.z);
    }
    let tr = this.tracks.get(e.id);
    if (!tr) { tr = new Track(); this.tracks.set(e.id, tr); }
    tr.push(t, e.x, e.y, e.z, e.yaw);
    m.summoned = (e.flags & MOB_FLAG.summoned) !== 0;
    m.pupDaze = (e.flags & MOB_FLAG.daze) !== 0;
    m.pupAlerted = (e.flags & MOB_FLAG.alerted) !== 0;
    if (e.flags & MOB_FLAG.chill) m.chillT = Math.max(m.chillT, 0.3);
    if (e.flags & MOB_FLAG.rally) m.rally = Math.max(m.rally, 0.3);
    m.pupAttack = e.attack;
    m.pupSeq = e.seq;
    m.pupAim.set(e.ax, 0, e.az);
    m.pupMove.set(e.mx ?? 0, e.mz ?? 0);
    m.laneId = e.lane || null;
    m.marchI = e.marchI;
    m.maxHp = e.maxHp;
    m.hp = e.hp;
  }

  /** Defence from records: state, wave, bush, walls, towers and own raspberries into the SimTd mirror (menu, HUD, hints) */
  private mirrorTd(sim: SimTd, v: SnapshotView<SimEvent>): void {
    const me = this.h.battle.seat;
    const td = v.ents.get('td');
    if (td) {
      sim.state = td.state as SimTd['state'];
      sim.wave = td.wave as number;
      sim.next = td.next as number;
      sim.netRunning = !!td.running;
      sim.players = td.players as number;
      sim.rating = (td.rating as number) ?? 1;
      sim.spawned = td.spawned as number;
      sim.fallen = td.fallen as number;
    }
    const bush = v.ents.get('bush');
    if (bush) { sim.bush.hp = bush.hp as number; sim.bush.dead = !!bush.dead; }
    for (const w of sim.walls) {
      const e = v.ents.get(w.id);
      if (e) w.mirror(e.hp as number, !!e.dead, !!e.cracked);
    }
    const purse = v.ents.get(`purse${me}`);
    if (purse) {
      const n = purse.n as number;
      sim.setBerries(me, n);
      // profile raspberries mirror the treasury: the sutler's `gear` purchase is charged by the server, the snapshot brings the result
      this.h.profile.data.berries = n;
    }
    const loot = v.ents.get(`loot${me}`);
    if (loot) sim.setLoot(me, loot.n as number);
    for (const p of sim.pads) {
      const e = v.ents.get(`t${p.index}`) as (EntityState & { kind: string; level: number; hp: number; maxHp: number; frozen: number; spent: number }) | undefined;
      let t = p.tower;
      if (t && (!e || e.kind !== t.kind)) { sim.towers.splice(sim.towers.indexOf(t), 1); p.tower = t = null; }
      if (!e) continue;
      if (!t) { t = new SimTower(this.h.world, p.index, e.kind as TowerKind, p.pos.x, p.pos.z, p.pos.y); p.tower = t; sim.towers.push(t); }
      t.level = e.level; t.hp = e.hp; t.maxHp = e.maxHp; t.frozen = e.frozen; t.spent = e.spent;
    }
    for (const l of sim.lairs) { const e = v.ents.get(l.id); if (e) l.warn = e.warn as number; }
    if (sim.fog) for (const l of sim.fog.lanterns) { const e = v.ents.get(l.id); if (e) { l.lit = !!e.lit; l.flame = e.flame as number; } }
    if (sim.fog) {
      // wisps: rebuilt from the records (the server moves and catches them)
      sim.fog.wisps.length = 0;
      for (const [id, e] of v.ents) if (id.startsWith('wisp')) { const w = new SimWisp(Number(id.slice(4)), 0, 0, 0, e.n as number); w.x = e.x as number; w.z = e.z as number; sim.fog.wisps.push(w); }
    }
  }

  // ---------- frame ----------

  update(dt: number): void {
    const h = this.h, t = now() + this.timeDelta - RENDER_DELAY;
    this.rolled ||= h.input.roll;
    // other heroes: step by input, position from the snapshot buffer
    for (const o of this.heroes.values()) {
      o.yawTo = o.track.sample(t, o.to);
      const k = o.knight, d = Math.hypot(k.pos.x - o.to.x, k.pos.z - o.to.z);
      if (d > 3) k.place(o.to.x, o.to.z, o.yawTo, o.to.y);
      else { const a = Math.min(1, dt * 12); k.pos.x += (o.to.x - k.pos.x) * a; k.pos.z += (o.to.z - k.pos.z) * a; }
      k.update(dt, o.input, h.solids(), h.terrain);
      o.input.roll = false;
      o.profile.data.arrows = MAX_ARROWS;
      o.gear.update(dt, o.bow && !k.down, o.input.aim);
    }
    // puppets also from the buffer
    for (const m of h.pack.mobs) { const tr = this.tracks.get(`m${m.net}`); if (tr && m.puppet) m.pupYaw = tr.sample(t, m.pupTo); }
    h.pack.puppets(dt);
    // exhausted — gets up by the server snapshot; while down, own input is not sent
    void REVIVE_S;
    this.rosterT -= dt;
    if (this.rosterT <= 0) { this.rosterT = 0.25; this.ui.setRoster(this.rows()); }
    this.cmdT -= dt;
    if (this.cmdT > 0 || !this.chan || !this.joined) return;
    this.cmdT = 1 / CMD_HZ;
    const i = h.input, seq = ++this.seq;
    const c: Cmd = { seq, snap: this.view.n, move: [r2(i.move.x), r2(i.move.y)], aim: [r2(i.aim.x), r2(i.aim.y), r2(i.aim.z)], attack: i.attack, roll: this.rolled, bow: h.bow(), ping: h.net.rtt };
    this.recent.push(c);
    const dup = this.chan.lossy ? CMD_DUP : 1;
    while (this.recent.length > dup) this.recent.shift();
    this.chan.sendUnreliable(this.recent.slice());
    this.chan.flush();
    this.rolled = false;
    this.sent.push({ seq, x: h.hero.pos.x, z: h.hero.pos.z });
    if (this.sent.length > 120) this.sent.shift();
  }

  private rows(): RosterRow[] {
    const h = this.h, me = h.battle.seat, hs = h.battle.hostSeat;
    const mic = (seat: number): boolean => (seat === me ? !!h.voice?.on : !!h.battle.seats.find((s) => s.seat === seat)?.voice);
    const talk = (seat: number): boolean => mic(seat) && !!h.voice?.speaking(seat);
    return [
      { seat: me, name: this.nameOf(me), hp: h.hero.hp, maxHp: h.hero.maxHp, ping: h.net.rtt, host: me === hs, me: true, down: h.hero.down, voice: mic(me), speaking: talk(me) },
      ...[...this.heroes.values()].map((r): RosterRow => ({ seat: r.seat, name: this.nameOf(r.seat), hp: r.hp, maxHp: r.maxHp, ping: r.ping, host: r.seat === hs, me: false, down: r.down, voice: mic(r.seat), speaking: talk(r.seat) })),
    ];
  }

  /** Chat: open the field (Enter in battle) */
  openChat(): void { this.ui.openChat(); }
  get typing(): boolean { return this.ui.typing; }

  /** Names above heroes: ours and others'; behind the camera — hide */
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

  /** For tests: other heroes — position, health, weapon */
  get othersInfo(): { seat: number; x: number; z: number; hp: number; maxHp: number; melee: string | null }[] {
    return [...this.heroes.values()].map((r) => ({ seat: r.seat, x: r.knight.pos.x, z: r.knight.pos.z, hp: r.knight.hp, maxHp: r.knight.maxHp, melee: r.profile.equipped('melee')?.def ?? null }));
  }
}
