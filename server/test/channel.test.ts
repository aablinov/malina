import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rng } from '../../src/rng.ts';
import { Channel } from '../../src/net/channel.ts';
import { loopbackPair } from '../../src/net/loopback.ts';

/** Pair of channels over a loopback with a clock; step(ms) advances the clock, delivers what is due and resends reliable */
function pair(o: { loss?: number; reorder?: number; delayMs?: number; jitterMs?: number; seed?: number } = {}) {
  const clock = { t: 0 };
  const lb = loopbackPair({ clock: () => clock.t, rng: rng(o.seed ?? 7), delayMs: o.delayMs ?? 20, jitterMs: o.jitterMs ?? 0, loss: o.loss, reorder: o.reorder });
  const a = new Channel<string, { x: number }>(lb.a, { clock: () => clock.t });
  const b = new Channel<string, { x: number }>(lb.b, { clock: () => clock.t });
  const gotB: string[] = [], gotA: string[] = [], uB: number[] = [];
  b.onReliable = (m) => gotB.push(m);
  a.onReliable = (m) => gotA.push(m);
  b.onUnreliable = (u) => uB.push(u.x);
  const step = (ms = 10): void => { clock.t += ms; lb.pump(clock.t); a.flush(); b.flush(); };
  const run = (ms: number): void => { for (let i = 0; i < ms / 10; i++) step(10); };
  return { a, b, lb, clock, gotA, gotB, uB, step, run };
}

test('reliable messages arrive in order and get acknowledged', () => {
  const p = pair();
  for (let i = 0; i < 5; i++) assert.ok(p.a.sendReliable(`m${i}`));
  assert.equal(p.a.pending, 5);
  p.run(100);
  assert.deepEqual(p.gotB, ['m0', 'm1', 'm2', 'm3', 'm4']);
  // the ack only comes with a frame from b — b sends unreliable
  p.b.sendUnreliable({ x: 1 });
  p.run(100);
  assert.equal(p.a.pending, 0);
});

test('reliable messages get through 30 % loss and reordering, without duplicates', () => {
  const p = pair({ loss: 0.3, reorder: 0.2, seed: 3 });
  const want: string[] = [];
  for (let i = 0; i < 40; i++) {
    want.push(`r${i}`);
    assert.ok(p.a.sendReliable(`r${i}`));
    p.b.sendUnreliable({ x: i });
    p.step(25);
  }
  p.run(3000);
  assert.deepEqual(p.gotB, want);
  assert.equal(p.a.pending, 0);
  assert.ok(p.b.stats.received < p.a.stats.sent, 'some frames were lost');
});

test('unreliable: stale frames are dropped, ack grows', () => {
  const p = pair({ reorder: 0.5, seed: 11, delayMs: 10 });
  for (let i = 1; i <= 30; i++) { p.a.sendUnreliable({ x: i }); p.step(5); }
  p.run(500);
  // not all arrived (reordering makes a frame stale), but the order is strictly increasing
  for (let i = 1; i < p.uB.length; i++) assert.ok(p.uB[i] > p.uB[i - 1]);
  assert.ok(p.b.stats.stale > 0);
  assert.equal(p.b.lastRecv, 30);
  p.b.sendUnreliable({ x: 0 });
  p.run(100);
  assert.equal(p.a.peerAck, 30);
});

test('reliable window: over it — refused, after an ack allowed again', () => {
  const p = pair();
  for (let i = 0; i < 64; i++) assert.ok(p.a.sendReliable(`w${i}`));
  assert.equal(p.a.sendReliable('extra'), false);
  p.run(100);
  p.b.sendUnreliable({ x: 1 });
  p.run(100);
  assert.ok(p.a.sendReliable('extra'));
  p.run(100);
  assert.equal(p.gotB.length, 65);
});

test('transport close reaches the channel', () => {
  const p = pair();
  let code = 0;
  p.b.onClose = (c) => { code = c; };
  p.a.close(4001);
  assert.equal(code, 4001);
  assert.ok(p.b.closed);
});
