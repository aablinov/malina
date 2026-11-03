import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Channel } from '../../src/net/channel.ts';
import { LOOT_DELAY, type Cmd, type GameClientMsg, type GameServerMsg } from '../../src/net/game-protocol.ts';
import { loopbackPair } from '../../src/net/loopback.ts';
import { SnapshotView, type Delta } from '../../src/net/snapshot.ts';
import { Profile } from '../../src/items.ts';
import { Match } from '../../src/game/match.ts';
import type { SimEvent } from '../../src/sim/events.ts';
import { TOWERS } from '../../src/td/towers.ts';
import { loadMap } from './sim-helpers.ts';

type R = GameClientMsg | GameServerMsg;
type U = Cmd | Delta<SimEvent>;

/** Фейковый клиент: канал над петлёй, копия мира по дельтам, команды ввода */
class FakeClient {
  readonly chan: Channel<R, U>;
  readonly view = new SnapshotView<SimEvent>();
  readonly got: GameServerMsg[] = [];
  seq = 0;
  deltas = 0;
  move: [number, number] = [0, 0];
  attack = false;
  roll = false;
  constructor(lb: ReturnType<typeof loopbackPair>, clock: () => number) {
    this.chan = new Channel<R, U>(lb.b, { clock });
    this.chan.onReliable = (m) => this.got.push(m as GameServerMsg);
    this.chan.onUnreliable = (u) => { this.deltas++; const d = u as Delta<SimEvent>; this.view.apply(d); };
  }
  cmd(): void {
    const c: Cmd = { seq: ++this.seq, snap: this.view.n, move: this.move, aim: [0, 0, 5], attack: this.attack, roll: this.roll, bow: false, ping: 30 };
    this.roll = false;
    this.chan.sendUnreliable(c);
  }
  ent(id: string) { return this.view.ents.get(id); }
}

function setup(players = 2) {
  const clock = { t: 0 };
  const now = () => clock.t;
  const map = loadMap('td');
  const match = new Match({ id: 'm1', map, seed: 7, players: Array.from({ length: players }, (_, i) => ({ seat: i, playerId: `p${i}`, name: `Игрок ${i + 1}`, profile: Profile.starter() })) });
  const links: ReturnType<typeof loopbackPair>[] = [], clients: FakeClient[] = [];
  for (let i = 0; i < players; i++) {
    const lb = loopbackPair({ clock: now, delayMs: 10 });
    links.push(lb);
    const c = new FakeClient(lb, now);
    clients.push(c);
    match.attach(i, new Channel<R, U>(lb.a, { clock: now }));
  }
  /** Кадр сервера 50 мс: клиенты шлют по три команды (60 Гц), сервер считает, петля доставляет */
  const frame = (): void => {
    for (let k = 0; k < 3; k++) { for (const c of clients) c.cmd(); clock.t += 16; for (const lb of links) lb.pump(clock.t); }
    match.frame(0.05);
    clock.t += 2;
    for (const lb of links) lb.pump(clock.t);
    for (const c of clients) c.chan.flush();
    for (const lb of links) lb.pump(clock.t);
  };
  const run = (frames: number): void => { for (let i = 0; i < frames; i++) frame(); };
  return { match, clients, frame, run, clock };
}

test('матч: приветствие и наборы, первый снимок полный, дальше дельты; ввод двигает героя, место подтверждается', () => {
  const { match, clients, run } = setup(2);
  const [a, b] = clients;
  run(2);
  assert.ok(a.got.some((m) => m.t === 'welcome' && m.seat === 0));
  assert.equal(a.got.filter((m) => m.t === 'kit').length, 2, 'наборы обоих');
  assert.ok(a.deltas >= 1 && a.ent('h0') && a.ent('h1') && a.ent('td') && a.ent('purse1'));
  const x0 = b.ent('h1')!.x as number;
  b.move = [1, 0];
  run(20);
  const h1 = b.ent('h1')!;
  assert.ok((h1.x as number) - x0 > 2, `герой 1 прошёл: ${(h1.x as number) - x0}`);
  assert.ok((h1.ack as number) > 0 && (h1.ack as number) <= b.seq, 'ack ввода');
  assert.equal(h1.ping, 30);
  assert.equal(h1.mx, 1);
  // у другого клиента тот же герой на том же месте
  assert.equal(a.ent('h1')!.x, h1.x);
  assert.ok(match.heroPos(1)!.x - x0 > 2);
});

test('матч: постройка за свою малину, действие героя уходит другим, волна выходит врагами в снимке, итог с наградой', () => {
  const { match, clients, run, clock } = setup(2);
  const [a, b] = clients;
  run(2);
  const purse1 = b.ent('purse1')!.n as number;
  b.chan.sendReliable({ t: 'td', a: 'build:arrow', pad: 0 });
  run(3);
  assert.ok(b.ent('t0'), 'башня в снимке');
  assert.equal(b.ent('purse1')!.n, purse1 - TOWERS.arrow.cost);
  assert.equal(a.ent('purse0')!.n, purse1, 'у другого своя малина');
  assert.ok(a.ent('t0'), 'и у другого башня');
  // действие: зелье — остальным приходит повтор с местом
  b.chan.sendReliable({ t: 'act', k: 'potion' });
  run(3);
  assert.ok(a.got.some((m) => m.t === 'act' && m.seat === 1 && m.k === 'potion'));
  assert.ok(!b.got.some((m) => m.t === 'act'), 'своё действие не возвращается');
  // волна
  a.chan.sendReliable({ t: 'td', a: 'wave' });
  run(60);
  const mobs = [...a.view.ents.keys()].filter((k) => /^m\d+$/.test(k));
  assert.ok(mobs.length > 0, 'враги в снимке');
  assert.ok((a.ent('td')!.wave as number) === 1);
  // итог: куст отбит — через LOOT_DELAY матч кончается с наградой каждому
  let end: Parameters<NonNullable<Match['onEnd']>>[0] | null = null;
  match.onEnd = (e) => { end = e; };
  match.td.state = 'won';
  for (let i = 0; i < Math.ceil(LOOT_DELAY / 0.05) + 2 && !end; i++) run(1);
  run(2);
  assert.ok(end, 'бой кончился');
  const e = end as unknown as NonNullable<typeof end>;
  assert.equal(e.result, 'won');
  assert.equal(e.rewards.get(1)!.berries, b.ent('purse1')!.n);
  assert.ok(a.got.some((m) => m.t === 'over' && m.result === 'won'));
  void clock;
});

test('матч: обрыв и возврат — полный снимок заново; выход игрока убирает героя', () => {
  const { match, clients, run, clock } = setup(2);
  const [, b] = clients;
  run(3);
  match.detach(1);
  run(5);
  const lb = loopbackPair({ clock: () => clock.t, delayMs: 10 });
  const b2 = new FakeClient(lb, () => clock.t);
  clients[1] = b2;
  match.attach(1, new Channel<R, U>(lb.a, { clock: () => clock.t }));
  // команды нового клиента и доставка — через свой кадр
  for (let i = 0; i < 4; i++) { b2.cmd(); clock.t += 16; lb.pump(clock.t); match.frame(0.05); clock.t += 2; lb.pump(clock.t); b2.chan.flush(); lb.pump(clock.t); }
  assert.ok(b2.got.some((m) => m.t === 'welcome'));
  assert.ok(b2.ent('h1') && b2.ent('h0'), 'полный снимок после возврата');
  void b;
  match.leave(0);
  for (let i = 0; i < 3; i++) { b2.cmd(); clock.t += 16; lb.pump(clock.t); match.frame(0.05); clock.t += 2; lb.pump(clock.t); }
  assert.ok(!b2.ent('h0'), 'герой ушедшего убран');
  assert.equal(match.seats.size, 1);
});
