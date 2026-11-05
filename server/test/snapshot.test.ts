import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SnapshotRing, SnapshotView, type EntityState } from '../../src/net/snapshot.ts';

const ents = (...xs: EntityState[]): EntityState[] => xs;

test('first snapshot without an ack is full; empty delta when nothing changed', () => {
  const ring = new SnapshotRing<string>(4);
  ring.push(1, ents({ id: 'h1', x: 1, y: 2 }, { id: 'm1', kind: 'imp', hp: 10 }), ['spawn']);
  const d = ring.delta(0)!;
  assert.equal(d.base, 0);
  assert.equal(d.add.length, 2);
  assert.deepEqual(d.ev, [['spawn']]);
  const v = new SnapshotView<string>();
  assert.ok(v.apply(d));
  assert.equal(v.n, 1);
  assert.equal(v.ents.get('m1')!.hp, 10);
  assert.deepEqual(v.added.map((e) => e.id), ['h1', 'm1']);
  const e = ring.delta(1)!;
  assert.equal(e.base, 1);
  assert.equal(e.add.length + e.upd.length + e.del.length, 0);
});

test('delta: changed fields, new and vanished entities, events of all snapshots after the base', () => {
  const ring = new SnapshotRing<string>(4);
  ring.push(1, ents({ id: 'h1', x: 1, y: 2 }, { id: 'm1', hp: 10 }), []);
  ring.push(2, ents({ id: 'h1', x: 1.5, y: 2 }, { id: 'm1', hp: 7 }), ['hit']);
  ring.push(3, ents({ id: 'h1', x: 2, y: 2 }, { id: 'm2', hp: 5 }), ['die', 'spawn']);
  const d = ring.delta(1)!;
  assert.equal(d.base, 1);
  assert.deepEqual(d.upd, [{ id: 'h1', x: 2 }]);
  assert.deepEqual(d.add, [{ id: 'm2', hp: 5 }]);
  assert.deepEqual(d.del, ['m1']);
  assert.deepEqual(d.ev, [['hit'], ['die', 'spawn']]);
  const v = new SnapshotView<string>();
  assert.ok(v.apply(ring.delta(0)!));
  assert.equal(v.n, 3);
  assert.equal(v.ents.get('h1')!.x, 2);
});

test('client: delta from an older base (ack still in flight) — from history, only new events', () => {
  const ring = new SnapshotRing<string>(8);
  const v = new SnapshotView<string>();
  ring.push(1, ents({ id: 'm0', x: 1 }), ['e1']);
  assert.ok(v.apply(ring.delta(0)!));
  ring.push(2, ents({ id: 'm0', x: 2 }, { id: 'm1', x: 0 }), ['e2']);
  assert.ok(v.apply(ring.delta(1)!));
  assert.deepEqual(v.events, ['e2']);
  // the server has not seen the ack of snapshot 2 yet — delta 3 from base 1
  ring.push(3, ents({ id: 'm0', x: 3 }), ['e3']);
  const d = ring.delta(1)!;
  assert.equal(d.base, 1);
  assert.ok(v.apply(d), 'base 1 is in history');
  assert.equal(v.n, 3);
  assert.deepEqual(new Map(v.ents), new Map([['m0', { id: 'm0', x: 3 }]]));
  assert.deepEqual(v.removed.map((e) => e.id), ['m1'], 'difference is from the previous current');
  assert.deepEqual(v.events, ['e3'], 'e2 is not played a second time');
  assert.equal(v.rejected, 0);
  // an old duplicate is skipped, no rejection
  assert.equal(v.apply(d), false);
  assert.equal(v.rejected, 0);
});

test('client: applying along the chain matches the full snapshot; foreign base — rejection and full', () => {
  const ring = new SnapshotRing<string>(8);
  const v = new SnapshotView<string>();
  let ack = 0;
  for (let t = 1; t <= 6; t++) {
    const es: EntityState[] = [];
    for (let i = 0; i < 3; i++) if (!(t === 4 && i === 1)) es.push({ id: `m${i}`, x: t * i, flag: t % 2 === 0 });
    es.push({ id: 'td', wave: Math.floor(t / 2) });
    ring.push(t, es, [`e${t}`]);
    const d = ring.delta(ack)!;
    assert.ok(v.apply(d), `snapshot ${t}`);
    ack = v.n;
    const want = new Map([...ring.last!.ents].map(([k, e]) => [k, { ...e }]));
    assert.deepEqual(new Map(v.ents), want);
    assert.deepEqual(v.events, [`e${t}`]);
  }
  // the client "fell asleep": its ack dropped out of the ring — full snapshot
  for (let t = 7; t <= 20; t++) ring.push(t, ents({ id: 'm0', x: t }), []);
  const stale = ring.delta(3)!;
  assert.equal(stale.base, 0);
  assert.ok(v.apply(stale));
  assert.deepEqual([...v.ents.keys()], ['m0']);
  assert.deepEqual(v.removed.map((e) => e.id).sort(), ['m1', 'm2', 'td']);
  // delta from a base the client does not have
  ring.push(21, ents({ id: 'm0', x: 21 }), []);
  const foreign = ring.delta(19)!;
  assert.equal(foreign.base, 19);
  assert.equal(v.apply(foreign), false);
  assert.equal(v.rejected, 1);
  assert.equal(v.n, 20);
});
