import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Channel } from '../../src/net/channel.ts';
import { CMD_DUP, LOOT_DELAY, type Cmd, type CmdBatch, type GameClientMsg, type GameServerMsg } from '../../src/net/game-protocol.ts';
import { loopbackPair } from '../../src/net/loopback.ts';
import { SnapshotView, type Delta } from '../../src/net/snapshot.ts';
import { Profile } from '../../src/items.ts';
import { Match } from '../../src/game/match.ts';
import type { SimEvent } from '../../src/sim/events.ts';
import { TOWERS } from '../../src/td/towers.ts';
import { loadMap } from './sim-helpers.ts';

type R = GameClientMsg | GameServerMsg;
type U = CmdBatch | Delta<SimEvent>;

/** Fake client: a channel over a loopback, a world copy from deltas (with history, like the real one), input command batches */
class FakeClient {
  readonly chan: Channel<R, U>;
  readonly view = new SnapshotView<SimEvent>();
  readonly got: GameServerMsg[] = [];
  /** All played events in order */
  readonly events: SimEvent[] = [];
  seq = 0;
  deltas = 0;
  /** Deltas applied */
  applied = 0;
  /** Saw hero 1's dodge roll in a snapshot */
  sawRoll = false;
  move: [number, number] = [0, 0];
  attack = false;
  roll = false;
  private readonly recent: Cmd[] = [];
  constructor(lb: ReturnType<typeof loopbackPair>, clock: () => number) {
    this.chan = new Channel<R, U>(lb.b, { clock });
    this.chan.onReliable = (m) => this.got.push(m as GameServerMsg);
    this.chan.onUnreliable = (u) => {
      this.deltas++;
      if (!this.view.apply(u as Delta<SimEvent>)) return;
      this.applied++;
      this.events.push(...this.view.events);
      if (this.ent('h1')?.roll === 1) this.sawRoll = true;
    };
  }
  cmd(): void {
    const c: Cmd = { seq: ++this.seq, snap: this.view.n, move: this.move, aim: [0, 0, 5], attack: this.attack, roll: this.roll, bow: false, ping: 30 };
    this.roll = false;
    this.recent.push(c);
    const dup = this.chan.lossy ? CMD_DUP : 1;
    while (this.recent.length > dup) this.recent.shift();
    this.chan.sendUnreliable(this.recent.slice());
  }
  ent(id: string) { return this.view.ents.get(id); }
}

function setup(players = 2, delayMs = 10, link: { loss?: number; rng?: () => number } = {}) {
  const clock = { t: 0 };
  const now = () => clock.t;
  const map = loadMap('td');
  const match = new Match({ id: 'm1', map, seed: 7, players: Array.from({ length: players }, (_, i) => ({ seat: i, playerId: `p${i}`, name: `Player ${i + 1}`, profile: Profile.starter() })) });
  const links: ReturnType<typeof loopbackPair>[] = [], clients: FakeClient[] = [];
  for (let i = 0; i < players; i++) {
    const lb = loopbackPair({ clock: now, delayMs, ...link });
    links.push(lb);
    const c = new FakeClient(lb, now);
    clients.push(c);
    match.attach(i, new Channel<R, U>(lb.a, { clock: now }));
  }
  /** Server frame 50 ms: clients send three commands each (60 Hz), the server simulates, the loopback delivers */
  const frame = (): void => {
    for (let k = 0; k < 3; k++) { for (const c of clients) c.cmd(); clock.t += 16; for (const lb of links) lb.pump(clock.t); }
    match.frame(0.05);
    clock.t += 2;
    for (const lb of links) lb.pump(clock.t);
    for (const c of clients) c.chan.flush();
    for (const lb of links) lb.pump(clock.t);
  };
  const run = (frames: number): void => { for (let i = 0; i < frames; i++) frame(); };
  return { match, clients, links, frame, run, clock };
}

test('match: welcome and kits, first snapshot full, then deltas; input moves the hero, seat is confirmed', () => {
  const { match, clients, run } = setup(2);
  const [a, b] = clients;
  run(2);
  assert.ok(a.got.some((m) => m.t === 'welcome' && m.seat === 0));
  assert.equal(a.got.filter((m) => m.t === 'kit').length, 2, 'kits of both');
  assert.ok(a.deltas >= 1 && a.ent('h0') && a.ent('h1') && a.ent('td') && a.ent('purse1'));
  const x0 = b.ent('h1')!.x as number;
  b.move = [1, 0];
  run(20);
  const h1 = b.ent('h1')!;
  assert.ok((h1.x as number) - x0 > 2, `hero 1 walked: ${(h1.x as number) - x0}`);
  assert.ok((h1.ack as number) > 0 && (h1.ack as number) <= b.seq, 'input ack');
  assert.equal(h1.ping, 30);
  assert.equal(h1.mx, 1);
  // the other client has the same hero in the same place
  assert.equal(a.ent('h1')!.x, h1.x);
  assert.ok(match.heroPos(1)!.x - x0 > 2);
  // over a lossless loopback — one command per frame; duplicates do not pile up in the server queue
  assert.ok(!b.chan.lossy);
  assert.ok(match.seats.get(1)!.queue.length <= CMD_DUP, `queue ${match.seats.get(1)!.queue.length}`);
});

test('match: latency of a frame and more — deltas from an older base are accepted from history, none missed', () => {
  for (const delayMs of [60, 100]) {
    const { clients, run } = setup(2, delayMs);
    const [a, b] = clients;
    b.move = [1, 0];
    run(60);
    assert.equal(a.view.rejected, 0, `latency ${delayMs}: no rejections`);
    assert.ok(a.applied >= 45, `latency ${delayMs}: applied ${a.applied} of ${a.deltas}`);
    assert.equal(a.ent('h1')!.x, b.ent('h1')!.x, 'both clients see the same');
  }
});

test('match: events under latency arrive exactly once; a dodge roll from a client is seen by the other and moves the hero', () => {
  const { match, clients, run } = setup(2, 80);
  const [a, b] = clients;
  run(3);
  b.chan.sendReliable({ t: 'td', a: 'build:arrow', pad: 0 });
  run(20);
  assert.equal(a.events.filter((e) => e.t === 'tower.build').length, 1, 'build — one event at the other client');
  assert.equal(b.events.filter((e) => e.t === 'tower.build').length, 1, 'and at the builder');
  // dodge roll: a one-shot flag in the command; the server rolls the hero (≈4 m in 0.3 s), guests see roll in the snapshot
  const x0 = match.heroPos(1)!.x;
  b.move = [1, 0];
  b.roll = true;
  run(12);
  assert.ok(a.sawRoll, 'the other client saw the roll');
  assert.ok(match.heroPos(1)!.x - x0 > 3.5, `roll carried the hero: ${match.heroPos(1)!.x - x0}`);
});

test('match: connection drop — the hero stops rather than walking forever; after return ack follows the new numbering', () => {
  const { match, clients, links, run, clock } = setup(2);
  const [, b] = clients;
  b.move = [1, 0];
  run(10);
  links[1].b.close();
  run(3);
  const x1 = match.heroPos(1)!.x;
  run(10);
  assert.ok(Math.abs(match.heroPos(1)!.x - x1) < 0.05, 'hero stands still after the drop');
  const lb = loopbackPair({ clock: () => clock.t, delayMs: 10 });
  const b2 = new FakeClient(lb, () => clock.t);
  match.attach(1, new Channel<R, U>(lb.a, { clock: () => clock.t }));
  for (let i = 0; i < 6; i++) { b2.cmd(); clock.t += 16; lb.pump(clock.t); match.frame(0.05); clock.t += 2; lb.pump(clock.t); b2.chan.flush(); lb.pump(clock.t); }
  const ack = b2.ent('h1')!.ack as number;
  assert.ok(ack > 0 && ack <= b2.seq, `ack ${ack} in the new numbering (seq ${b2.seq})`);
});

test('match: build with own raspberries, hero action goes to others, a wave appears as enemies in the snapshot, result with reward', () => {
  const { match, clients, run, clock } = setup(2);
  const [a, b] = clients;
  run(2);
  const purse1 = b.ent('purse1')!.n as number;
  b.chan.sendReliable({ t: 'td', a: 'build:arrow', pad: 0 });
  run(3);
  assert.ok(b.ent('t0'), 'tower in the snapshot');
  assert.equal(b.ent('purse1')!.n, purse1 - TOWERS.arrow.cost);
  assert.equal(a.ent('purse0')!.n, purse1, 'the other has their own raspberries');
  assert.ok(a.ent('t0'), 'and the other sees the tower');
  // action: potion — the others get a replay with the seat
  b.chan.sendReliable({ t: 'act', k: 'potion' });
  run(3);
  assert.ok(a.got.some((m) => m.t === 'act' && m.seat === 1 && m.k === 'potion'));
  assert.ok(!b.got.some((m) => m.t === 'act'), 'own action is not echoed back');
  // wave
  a.chan.sendReliable({ t: 'td', a: 'wave' });
  run(60);
  const mobs = [...a.view.ents.keys()].filter((k) => /^m\d+$/.test(k));
  assert.ok(mobs.length > 0, 'enemies in the snapshot');
  assert.ok((a.ent('td')!.wave as number) === 1);
  // result: bush defended — after LOOT_DELAY the match ends with a reward for everyone
  let end: Parameters<NonNullable<Match['onEnd']>>[0] | null = null;
  match.onEnd = (e) => { end = e; };
  match.td.addLoot(33);
  match.td.state = 'won';
  for (let i = 0; i < Math.ceil(LOOT_DELAY / 0.05) + 2 && !end; i++) run(1);
  run(2);
  assert.ok(end, 'battle ended');
  const e = end as unknown as NonNullable<typeof end>;
  assert.equal(e.result, 'won');
  // the reward is the match loot (the wave still running may add its kills), not the purse
  assert.equal(e.rewards.get(1)!.berries, match.td.lootOf(1));
  assert.ok(match.td.lootOf(1) >= 33);
  assert.ok(a.got.some((m) => m.t === 'over' && m.result === 'won'));
  void clock;
});

test('match: drop and return — full snapshot again; a player leaving removes the hero', () => {
  const { match, clients, run, clock } = setup(2);
  const [, b] = clients;
  run(3);
  match.detach(1);
  run(5);
  const lb = loopbackPair({ clock: () => clock.t, delayMs: 10 });
  const b2 = new FakeClient(lb, () => clock.t);
  clients[1] = b2;
  match.attach(1, new Channel<R, U>(lb.a, { clock: () => clock.t }));
  // the new client's commands and delivery — through its own frame
  for (let i = 0; i < 4; i++) { b2.cmd(); clock.t += 16; lb.pump(clock.t); match.frame(0.05); clock.t += 2; lb.pump(clock.t); b2.chan.flush(); lb.pump(clock.t); }
  assert.ok(b2.got.some((m) => m.t === 'welcome'));
  assert.ok(b2.ent('h1') && b2.ent('h0'), 'full snapshot after return');
  void b;
  match.leave(0);
  for (let i = 0; i < 3; i++) { b2.cmd(); clock.t += 16; lb.pump(clock.t); match.frame(0.05); clock.t += 2; lb.pump(clock.t); }
  assert.ok(!b2.ent('h0'), 'the leaving player hero is removed');
  assert.equal(match.seats.size, 1);
});

test('match: an action with a command number runs after it, before the next one — as in the client tick', () => {
  const { clients, run } = setup(2);
  const [a, b] = clients;
  run(2);
  // action "after command seq+4": the frame's three commands do not reach it — waits; next frame — executed and sent to others
  b.chan.sendReliable({ t: 'act', seq: b.seq + 4, k: 'potion' });
  run(1);
  assert.ok(!a.got.some((m) => m.t === 'act'), 'too early: the command has not arrived yet');
  run(2);
  assert.ok(a.got.some((m) => m.t === 'act' && m.seat === 1 && m.k === 'potion'), 'executed after its command');
  // without a number or with an already passed command — immediately
  b.chan.sendReliable({ t: 'act', seq: 1, k: 'aura' });
  run(1);
  assert.ok(a.got.some((m) => m.t === 'act' && m.k === 'aura'));
});

test('match: over a lossy loopback the client duplicates commands (cl_packetdup) — input gets through, the hero walks', () => {
  let x = 12345;
  const r = () => { x = (x * 1103515245 + 12345) % 2 ** 31; return x / 2 ** 31; };
  const { match, clients, run } = setup(2, 10, { loss: 0.25, rng: r });
  const [, b] = clients;
  assert.ok(b.chan.lossy, 'lossy loopback — lossy transport');
  const x0 = match.heroPos(1)!.x;
  b.move = [1, 0];
  run(40);
  assert.ok(match.heroPos(1)!.x - x0 > 3, `hero walked despite the loss: ${match.heroPos(1)!.x - x0}`);
  assert.ok(match.seats.get(1)!.lastSeq > 100, `commands got through: ${match.seats.get(1)!.lastSeq}`);
});

test('match: gear changes are small commands — equip, sutler purchase from the treasury, junk refused; others see only the equipped', () => {
  const { match, clients, run } = setup(2);
  const [a, b] = clients;
  run(2);
  const hero = match.seats.get(0)!.hero.profile, d = hero.data;
  const other = b.got.filter((m) => m.t === 'kit' && m.seat === 0).at(-1) as Extract<GameServerMsg, { t: 'kit' }>;
  assert.ok(other.items.length <= 7 && other.items.length < d.items.length, `only the equipped: ${other.items.length}`);
  // equip the claymore by uid
  const clay = d.items.find((i) => i.def === 'claymore')!.uid;
  a.chan.sendReliable({ t: 'gear', op: 'equip', uid: clay });
  run(2);
  assert.equal(d.equip.melee, clay);
  assert.equal((b.got.filter((m) => m.t === 'kit' && m.seat === 0).at(-1) as { equip: { melee: string } }).equip.melee, clay, 'the other sees the new sword');
  // junk: an unknown uid, an unknown def, a bad slot — nothing changes
  for (const m of [{ op: 'equip', uid: 'nope' }, { op: 'buy', def: 'no-such' }, { op: 'unequip', slot: 7 }, { op: 'enchant', uid: clay, slot: 'x', option: 0 }]) a.chan.sendReliable({ t: 'gear', ...m } as GameClientMsg);
  const n = d.items.length;
  run(2);
  assert.equal(d.items.length, n);
  assert.equal(d.equip.melee, clay);
  // the sutler: the price comes from the seat's treasury, the item at the hero's power with the same uid as on the client
  match.td.gain(0, 2000);
  const purse = match.td.berries(0), want = new Profile(structuredClone(d));
  const mine = want.add('champion', want.power);
  a.chan.sendReliable({ t: 'gear', op: 'buy', def: 'champion' });
  run(2);
  const got = d.items.at(-1)!;
  assert.deepEqual({ uid: got.uid, power: got.power, enchants: got.enchants }, { uid: mine.uid, power: mine.power, enchants: mine.enchants }, 'the client predicts the same item');
  assert.ok(match.td.berries(0) < purse, 'paid from the treasury');
  // not enough raspberries — nothing bought, a hint
  match.td.spend(0, match.td.berries(0));
  a.chan.sendReliable({ t: 'gear', op: 'buy', def: 'champion' });
  run(2);
  assert.equal(d.items.at(-1)!.uid, got.uid);
  assert.ok(a.got.some((m) => m.t === 'toast' && /raspberries/.test(m.text)));
});

test('match: the battle page joins — the kit is the stored one; reconnecting after changes — the server copy comes back whole', () => {
  const clock = { t: 0 }, now = () => clock.t;
  const stored = Profile.starter();
  const clay = stored.items.find((i) => i.def === 'claymore')!.uid;
  const match = new Match({ id: 'm2', map: loadMap('td'), seed: 7, players: [{ seat: 0, playerId: 'p0', name: 'A', profile: Profile.starter() }], stored: () => stored });
  // the camp saved the claymore after the match started: the battle page connects — the hero has it
  stored.equip.melee = clay;
  const lb = loopbackPair({ clock: now, delayMs: 0 }), c = new FakeClient(lb, now);
  match.attach(0, new Channel<R, U>(lb.a, { clock: now }));
  assert.equal(match.seats.get(0)!.hero.profile.data.equip.melee, clay);
  // a change in battle, then a new connection: no longer the database kit, the client gets its own whole
  c.chan.sendReliable({ t: 'gear', op: 'unequip', slot: 0 });
  c.chan.flush(); lb.pump(clock.t);
  assert.equal(match.seats.get(0)!.hero.profile.data.equip.artifacts[0], null);
  const lb2 = loopbackPair({ clock: now, delayMs: 0 }), c2 = new FakeClient(lb2, now);
  match.attach(0, new Channel<R, U>(lb2.a, { clock: now }));
  assert.equal(match.seats.get(0)!.hero.profile.data.equip.artifacts[0], null, 'not restocked from the database');
  match.frame(0.05); lb2.pump(clock.t);
  const m = c2.got.find((x) => x.t === 'mine') as Extract<GameServerMsg, { t: 'mine' }> | undefined;
  assert.ok(m && (m.equip as { artifacts: unknown[] }).artifacts[0] === null && m.items.length === stored.items.length);
});

test('match: an item picked up from a fallen enemy goes into the hero\'s kit at once and into the rewards whatever the outcome', () => {
  const match = new Match({ id: 'm3', map: loadMap('td'), seed: 7, players: [{ seat: 0, playerId: 'p0', name: 'A', profile: Profile.starter() }] });
  const hero = match.battle.heroes.get(0)!, n = hero.profile.data.items.length, power = hero.profile.power;
  let end: import('../../src/game/match.ts').MatchEnd | null = null;
  match.onEnd = (e) => { end = e; };
  match.battle.world.drops.onPick!(0, 'emberfang', true);
  match.battle.world.drops.onPick!(0, 'mace', false);
  match.battle.world.drops.onPick!(0, 'no-such-item', false);
  assert.equal(hero.profile.data.items.length, n + 2, 'both items are in the battle kit, the unknown one is not');
  assert.deepEqual(hero.profile.data.items.slice(-2).map((i) => [i.def, i.power]), [['emberfang', power + 1], ['mace', power]], 'a relic is one power above the hero');
  match.abandon();
  assert.deepEqual(end!.rewards.get(0)!.items, [{ def: 'emberfang', power: power + 1 }, { def: 'mace', power }]);
});

test('a tower built on the pad the hero stands on does not throw them out in one tick — they slide off', () => {
  const b = new Match({ id: 'm4', map: loadMap('td'), seed: 3, players: [{ seat: 0, playerId: 'p0', name: 'A', profile: Profile.starter() }] }).battle;
  const h = b.heroes.get(0)!, td = b.world.td!, pad = td.pads[0];
  h.knight.place(pad.pos.x + 0.1, pad.pos.z, 0, pad.pos.y);
  b.step(1 / 60);
  td.gain(0, 1000);
  assert.ok(td.command(0, { t: 'td', a: 'build:arrow', pad: pad.index }));
  let prev = h.knight.pos.clone(), max = 0;
  for (let i = 0; i < 90; i++) { b.step(1 / 60); max = Math.max(max, Math.hypot(h.knight.pos.x - prev.x, h.knight.pos.z - prev.z)); prev = h.knight.pos.clone(); }
  assert.ok(max < 0.12, `no jump in a tick: the longest step is ${max.toFixed(3)} m`);
  assert.ok(Math.abs(h.knight.pos.x - pad.pos.x) >= 0.75 + 0.3 || Math.abs(h.knight.pos.z - pad.pos.z) >= 0.75 + 0.3, 'and the hero ends up outside the tower');
});
