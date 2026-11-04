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

/** Фейковый клиент: канал над петлёй, копия мира по дельтам (с историей, как у настоящего), пачки команд ввода */
class FakeClient {
  readonly chan: Channel<R, U>;
  readonly view = new SnapshotView<SimEvent>();
  readonly got: GameServerMsg[] = [];
  /** Все игранные события по порядку */
  readonly events: SimEvent[] = [];
  seq = 0;
  deltas = 0;
  /** Дельт применено */
  applied = 0;
  /** Видел перекат героя 1 в снимке */
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
  const match = new Match({ id: 'm1', map, seed: 7, players: Array.from({ length: players }, (_, i) => ({ seat: i, playerId: `p${i}`, name: `Игрок ${i + 1}`, profile: Profile.starter() })) });
  const links: ReturnType<typeof loopbackPair>[] = [], clients: FakeClient[] = [];
  for (let i = 0; i < players; i++) {
    const lb = loopbackPair({ clock: now, delayMs, ...link });
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
  return { match, clients, links, frame, run, clock };
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
  // по петле без потерь — по одной команде в кадре; дубли не копятся в очереди сервера
  assert.ok(!b.chan.lossy);
  assert.ok(match.seats.get(1)!.queue.length <= CMD_DUP, `очередь ${match.seats.get(1)!.queue.length}`);
});

test('матч: задержка в кадр и больше — дельты от прежней базы принимаются из истории, ни одна не мимо', () => {
  for (const delayMs of [60, 100]) {
    const { clients, run } = setup(2, delayMs);
    const [a, b] = clients;
    b.move = [1, 0];
    run(60);
    assert.equal(a.view.rejected, 0, `задержка ${delayMs}: отказов нет`);
    assert.ok(a.applied >= 45, `задержка ${delayMs}: применено ${a.applied} из ${a.deltas}`);
    assert.equal(a.ent('h1')!.x, b.ent('h1')!.x, 'оба клиента видят одно');
  }
});

test('матч: события под задержкой приходят ровно один раз; перекат с клиента виден другому и двигает героя', () => {
  const { match, clients, run } = setup(2, 80);
  const [a, b] = clients;
  run(3);
  b.chan.sendReliable({ t: 'td', a: 'build:arrow', pad: 0 });
  run(20);
  assert.equal(a.events.filter((e) => e.t === 'tower.build').length, 1, 'постройка — одно событие у другого');
  assert.equal(b.events.filter((e) => e.t === 'tower.build').length, 1, 'и у строившего');
  // перекат: однократный флаг в команде; сервер катит героя (≈4 м за 0,3 с), гости видят roll в снимке
  const x0 = match.heroPos(1)!.x;
  b.move = [1, 0];
  b.roll = true;
  run(12);
  assert.ok(a.sawRoll, 'другой клиент видел перекат');
  assert.ok(match.heroPos(1)!.x - x0 > 3.5, `перекат унёс героя: ${match.heroPos(1)!.x - x0}`);
});

test('матч: обрыв связи — герой встаёт, а не идёт вечно; после возврата ack идёт с новой нумерации', () => {
  const { match, clients, links, run, clock } = setup(2);
  const [, b] = clients;
  b.move = [1, 0];
  run(10);
  links[1].b.close();
  run(3);
  const x1 = match.heroPos(1)!.x;
  run(10);
  assert.ok(Math.abs(match.heroPos(1)!.x - x1) < 0.05, 'после обрыва герой стоит');
  const lb = loopbackPair({ clock: () => clock.t, delayMs: 10 });
  const b2 = new FakeClient(lb, () => clock.t);
  match.attach(1, new Channel<R, U>(lb.a, { clock: () => clock.t }));
  for (let i = 0; i < 6; i++) { b2.cmd(); clock.t += 16; lb.pump(clock.t); match.frame(0.05); clock.t += 2; lb.pump(clock.t); b2.chan.flush(); lb.pump(clock.t); }
  const ack = b2.ent('h1')!.ack as number;
  assert.ok(ack > 0 && ack <= b2.seq, `ack ${ack} по новой нумерации (seq ${b2.seq})`);
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

test('матч: действие с номером команды исполняется после неё, перед следующей — как в такте клиента', () => {
  const { clients, run } = setup(2);
  const [a, b] = clients;
  run(2);
  // действие «после команды seq+4»: три команды кадра её не достигают — ждёт; следующий кадр — исполнено и ушло другим
  b.chan.sendReliable({ t: 'act', seq: b.seq + 4, k: 'potion' });
  run(1);
  assert.ok(!a.got.some((m) => m.t === 'act'), 'рано: команда ещё не пришла');
  run(2);
  assert.ok(a.got.some((m) => m.t === 'act' && m.seat === 1 && m.k === 'potion'), 'исполнено после своей команды');
  // без номера или с уже прошедшей командой — сразу
  b.chan.sendReliable({ t: 'act', seq: 1, k: 'aura' });
  run(1);
  assert.ok(a.got.some((m) => m.t === 'act' && m.k === 'aura'));
});

test('матч: по петле с потерями клиент дублирует команды (cl_packetdup) — ввод доходит, герой идёт', () => {
  let x = 12345;
  const r = () => { x = (x * 1103515245 + 12345) % 2 ** 31; return x / 2 ** 31; };
  const { match, clients, run } = setup(2, 10, { loss: 0.25, rng: r });
  const [, b] = clients;
  assert.ok(b.chan.lossy, 'петля с потерями — транспорт с потерями');
  const x0 = match.heroPos(1)!.x;
  b.move = [1, 0];
  run(40);
  assert.ok(match.heroPos(1)!.x - x0 > 3, `герой шёл несмотря на потери: ${match.heroPos(1)!.x - x0}`);
  assert.ok(match.seats.get(1)!.lastSeq > 100, `команды дошли: ${match.seats.get(1)!.lastSeq}`);
});
