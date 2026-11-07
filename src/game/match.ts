import * as THREE from 'three';
import { t } from '../i18n/i18n.ts';
import type { Channel } from '../net/channel.ts';
import { CMD_BACKLOG, LOOT_DELAY, MOB_FLAG, SNAP_RING, TICK, type Cmd, type CmdBatch, type GameClientMsg, type GameServerMsg } from '../net/game-protocol.ts';
import { CLOSE } from '../net/protocol.ts';
import type { Equipment, Item, ProfileData } from '../items.ts';
import type { GearAction } from '../net/protocol.ts';
import { SnapshotRing, type Delta, type EntityState } from '../net/snapshot.ts';
import type { Level } from '../level/level.ts';
import type { SimEvent } from '../sim/events.ts';
import { r2 } from '../sim/entities.ts';
import type { TdSpec } from '../td/types.ts';
import { HeadlessBattle, type BattleHero } from './battle.ts';

/**
 * Match — a server battle modelled on Quake 3's sv_client.c (wiki/design-multiplayer.md): a world with the party heroes and the pack
 * (src/game/battle.ts), input commands from clients one per tick (empty queue — repeat the last), after every
 * frame — a snapshot into the ring and a delta to each from the one they acknowledged. Knows nothing of transports: the server provides channels (server/game/)
 */
export interface MatchPlayer { seat: number; playerId: string; name: string; profile: ProfileData }
export type GameChannel = Channel<GameClientMsg | GameServerMsg, CmdBatch | Delta<SimEvent>>;
export interface MatchEnd { result: 'won' | 'lost' | 'abandoned'; wave: number; rewards: Map<number, { berries: number; xp: number }> }

interface Seat {
  player: MatchPlayer;
  hero: BattleHero;
  chan: GameChannel | null;
  queue: Cmd[];
  last: Cmd | null;
  lastSeq: number;
  /** Last snapshot the client applied — the delta base */
  snapAck: number;
  ping: number;
  /** Roll since the last snapshot — guests see it even between snapshots */
  rolled: boolean;
  /** Actions waiting for their command: executed when lastSeq reaches their seq (the same order as on the client) */
  acts: { seq: number; a: GearAction }[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export class Match {
  readonly id: string;
  readonly battle: HeadlessBattle;
  readonly seats = new Map<number, Seat>();
  private readonly ring = new SnapshotRing<SimEvent>(SNAP_RING);
  private acc = 0;
  private endT = -1;
  private readonly ratings = new Map<number, number>();
  ended: MatchEnd | null = null;
  /** The battle is over (result, rewards) — the room closes the match */
  onEnd: ((e: MatchEnd) => void) | null = null;

  constructor(o: { id: string; map: { level: Level; td: TdSpec }; seed: number; players: MatchPlayer[] }) {
    this.id = o.id;
    this.battle = new HeadlessBattle(o.map, o.seed, Math.max(1, o.players.length), true);
    for (const p of o.players) this.join(p);
  }

  get tick(): number { return this.battle.world.tick; }
  get td() { return this.battle.world.td!; }

  /** Player in the match (start or joining a running battle): the hero at the spawn point */
  join(p: MatchPlayer): Seat {
    const was = this.seats.get(p.seat);
    if (was) return was;
    const hero = this.battle.addHero(p.seat, p.profile);
    const s: Seat = { player: p, hero, chan: null, queue: [], last: null, lastSeq: 0, snapAck: 0, ping: 0, rolled: false, acts: [] };
    this.seats.set(p.seat, s);
    this.td.setPlayers(this.seats.size);
    // strength — from the gear the hero came with (the sutler's goods do not raise it)
    this.ratings.set(p.seat, hero.profile.rating);
    this.rerate();
    this.broadcast(this.kitOf(s), p.seat);
    return s;
  }

  /** Player left the room: the hero is removed */
  leave(seat: number): void {
    const s = this.seats.get(seat);
    if (!s) return;
    this.detach(seat);
    this.battle.removeHero(seat);
    this.seats.delete(seat);
    this.ratings.delete(seat);
    if (this.seats.size) { this.td.setPlayers(this.seats.size); this.rerate(); }
  }

  /** The party's strength — the average of the heroes' */
  private rerate(): void {
    if (this.ratings.size) this.td.setRating([...this.ratings.values()].reduce((a, b) => a + b, 0) / this.ratings.size);
  }

  /** Battle page connection: the channel goes to the seat; a greeting and everyone's kits right away */
  attach(seat: number, chan: GameChannel): boolean {
    const s = this.seats.get(seat);
    if (!s) return false;
    if (s.chan && s.chan !== chan) s.chan.close(CLOSE.replaced);
    s.chan = chan;
    // a new connection — new client command numbering (the page reloaded) and a full snapshot
    s.snapAck = 0;
    s.queue.length = 0;
    s.last = null;
    s.lastSeq = 0;
    s.rolled = false;
    s.acts.length = 0;
    // an error handling someone's message must not take down the server with all matches: log it and carry on
    chan.onReliable = (m) => { try { this.onReliable(s, m as GameClientMsg); } catch (e) { this.fail(s, e); } };
    chan.onUnreliable = (u) => { try { if (Array.isArray(u)) for (const c of u) this.onCmd(s, c); } catch (e) { this.fail(s, e); } };
    // dropped: the hero stops (does not repeat the last command forever) and stands while the room holds the seat
    chan.onClose = () => { if (s.chan === chan) { s.chan = null; this.halt(s); } };
    this.send(s, { t: 'welcome', seat, tick: this.tick });
    for (const o of this.seats.values()) this.send(s, this.kitOf(o));
    if (this.ended) this.send(s, { t: 'over', result: this.ended.result, wave: this.ended.wave });
    return true;
  }

  /** No more commands: the queue is empty, the last one forgotten, the hero's input is empty */
  private halt(s: Seat): void {
    s.queue.length = 0;
    s.last = null;
    s.acts.length = 0;
    s.hero.input.move.set(0, 0);
    s.hero.input.attack = false;
    s.hero.bow = false;
  }

  /** Reliably to a seat; window overflowed (the client is not acknowledging) — as in Q3: the connection closes */
  private send(s: Seat, m: GameServerMsg): void {
    const c = s.chan;
    if (!c) return;
    if (!c.sendReliable(m)) { console.error(`match ${this.id}, seat ${s.player.seat}: reliable window overflowed, connection closed`); c.close(CLOSE.overflow); }
  }

  detach(seat: number): void {
    const s = this.seats.get(seat);
    if (!s?.chan) return;
    const c = s.chan;
    s.chan = null;
    c.onReliable = null; c.onUnreliable = null; c.onClose = null;
    this.halt(s);
  }

  /** Something failed while handling a seat's message: to the log, a hint to the player */
  private fail(s: Seat, e: unknown): void {
    console.error(`match ${this.id}, seat ${s.player.seat}: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    this.send(s, { t: 'toast', text: t('The server could not perform the action') });
  }

  get connected(): number { return [...this.seats.values()].filter((s) => s.chan).length; }

  private kitOf(s: Seat): GameServerMsg { return { t: 'kit', seat: s.player.seat, items: s.hero.profile.data.items, equip: s.hero.profile.data.equip }; }

  private broadcast(m: GameServerMsg, except = -1): void { for (const s of this.seats.values()) if (s.player.seat !== except) this.send(s, m); }

  private onCmd(s: Seat, c: Cmd): void {
    if (!c || !isNum(c.seq) || !Array.isArray(c.move) || !Array.isArray(c.aim) || c.move.length !== 2 || c.aim.length !== 3 || !c.move.every(isNum) || !c.aim.every(isNum)) return;
    // already executed or already queued (duplicate commands in a frame, resends) — skip
    if (c.seq <= s.lastSeq || c.seq <= (s.queue[s.queue.length - 1]?.seq ?? 0)) return;
    if (isNum(c.snap) && c.snap > s.snapAck) s.snapAck = c.snap;
    if (isNum(c.ping)) s.ping = Math.max(0, Math.min(9999, Math.round(c.ping)));
    s.queue.push(c);
    if (s.queue.length > CMD_BACKLOG) s.queue.shift();
  }

  private onReliable(s: Seat, m: GameClientMsg): void {
    if (this.ended || !m || typeof m.t !== 'string') return;
    const seat = s.player.seat;
    switch (m.t) {
      case 'td': {
        if (typeof m.a !== 'string') return;
        this.td.command(seat, { t: 'td', a: m.a, pad: isNum(m.pad) ? m.pad : undefined, wall: typeof m.wall === 'string' ? m.wall : undefined });
        break;
      }
      case 'act': {
        const { t: _t, seq, ...a } = m;
        void _t;
        if (typeof a.k !== 'string') return;
        // after command seq (not yet executed) — wait for it; the command already passed or there is no number — right away
        if (isNum(seq) && seq > s.lastSeq) s.acts.push({ seq, a });
        else this.doAct(s, a);
        break;
      }
      case 'kit': {
        if (!Array.isArray(m.items) || typeof m.equip !== 'object' || !m.equip) return;
        // the sutler's fee comes from the seat's treasury; not enough — the kit does not change, a hint to the client (its mirror is fixed by the snapshot)
        if (isNum(m.cost) && m.cost > 0 && !this.td.spend(seat, Math.round(m.cost))) { this.send(s, { t: 'toast', text: t('Not enough raspberries') }); break; }
        const d = s.hero.profile.data;
        d.items = JSON.parse(JSON.stringify(m.items)) as Item[];
        d.equip = JSON.parse(JSON.stringify(m.equip)) as Equipment;
        d.equip.aura ??= null;
        s.hero.profile.save();
        this.broadcast(this.kitOf(s), seat);
        break;
      }
      default: break;
    }
  }

  private doAct(s: Seat, a: GearAction): void {
    s.hero.gear.perform(a);
    this.broadcast({ t: 'act', seat: s.player.seat, ...a }, s.player.seat);
  }

  /** Server frame: physics ticks for the accumulated time, then a snapshot to everyone */
  frame(dt: number): void {
    if (this.ended) return;
    this.acc += dt;
    let n = 0;
    try {
      while (this.acc >= TICK && n < 6) { this.step(); this.acc -= TICK; n++; }
      if (n >= 6) this.acc = 0;
      this.snapshot();
    } catch (e) {
      // the simulation or the snapshot failed: the match is aborted cleanly, the other matches live on
      console.error(`match ${this.id}: frame failed — ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      this.finish('abandoned');
      return;
    }
    if (this.td.state !== 'play') {
      if (this.endT < 0) this.endT = LOOT_DELAY;
      this.endT -= dt;
      if (this.endT <= 0) this.finish(this.td.state === 'won' ? 'won' : 'lost');
    }
  }

  private step(): void {
    for (const s of this.seats.values()) {
      // actions whose command is already executed — before the next command (on the client they go at the start of the tick)
      while (s.acts.length && s.acts[0].seq <= s.lastSeq) this.doAct(s, s.acts.shift()!.a);
      const c = s.queue.shift() ?? s.last;
      if (!c) continue;
      const i = s.hero.input;
      i.move.set(c.move[0], c.move[1]);
      i.aim.set(c.aim[0], c.aim[1], c.aim[2]);
      i.attack = !!c.attack;
      s.hero.bow = !!c.bow;
      if (c.roll && c !== s.last) { s.hero.rolled = true; s.rolled = true; }
      if (c.seq > s.lastSeq) s.lastSeq = c.seq;
      s.last = c;
    }
    this.battle.step(TICK);
  }

  private snapshot(): void {
    const ents = this.entities();
    const events = this.battle.world.takeEvents();
    this.ring.push(this.tick, ents, events);
    for (const s of this.seats.values()) {
      s.rolled = false;
      if (!s.chan) continue;
      const d = this.ring.delta(s.snapAck);
      if (d) s.chan.sendUnreliable(d);
      s.chan.flush();
    }
  }

  /** Hero and enemy records plus world records (the defence, piles) */
  entities(): EntityState[] {
    const out: EntityState[] = [];
    for (const s of this.seats.values()) {
      const k = s.hero.knight, i = s.hero.input;
      out.push({ id: `h${s.player.seat}`, seat: s.player.seat, x: r2(k.pos.x), y: r2(k.pos.y), z: r2(k.pos.z), yaw: r2(k.yaw), hp: Math.round(k.hp), maxHp: k.maxHp, down: k.down ? 1 : 0,
        mx: r2(i.move.x), mz: r2(i.move.y), ax: r2(i.aim.x), az: r2(i.aim.z), attack: i.attack ? 1 : 0, roll: s.rolled ? 1 : 0, bow: s.hero.bow ? 1 : 0, ack: s.lastSeq, ping: s.ping });
    }
    for (const m of this.battle.pack.mobs) {
      if (m.dead) continue;
      const aim = m.aimPos;
      const flags = (m.summoned ? MOB_FLAG.summoned : 0) | (m.state === 'daze' ? MOB_FLAG.daze : 0) | (m.chillT > 0 ? MOB_FLAG.chill : 0) | (m.rally > 0 ? MOB_FLAG.rally : 0) | (m.alerted ? MOB_FLAG.alerted : 0);
      out.push({ id: `m${m.net}`, kind: m.kind, x: r2(m.pos.x), y: r2(m.pos.y), z: r2(m.pos.z), yaw: r2(m.yaw), hp: Math.round(m.hp), maxHp: m.maxHp, flags,
        attack: m.state === 'attack' ? m.attack : '', seq: m.attackSeq, ax: r2(aim.x), az: r2(aim.z), lane: m.laneId ?? '', marchI: m.marchI, mx: r2(m.intent.move.x), mz: r2(m.intent.move.y) });
    }
    out.push(...this.battle.world.entities());
    return out;
  }

  /** Everyone left or the server is closing the match */
  abandon(): void { if (!this.ended) this.finish('abandoned'); }

  private finish(result: MatchEnd['result']): void {
    const wave = result === 'won' ? this.td.waves.length : Math.max(0, this.td.wave - (this.td.waveRunning ? 1 : 0));
    this.ended = { result, wave, rewards: this.battle.rewards() };
    this.broadcast({ t: 'over', result, wave });
    for (const s of this.seats.values()) s.chan?.flush();
    this.onEnd?.(this.ended);
  }

  /** For tests and debugging: the hero's position */
  heroPos(seat: number): THREE.Vector3 | null { return this.seats.get(seat)?.hero.knight.pos.clone() ?? null; }
}
