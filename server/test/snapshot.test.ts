import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SnapshotRing, SnapshotView, type EntityState } from '../../src/net/snapshot.ts';

const ents = (...xs: EntityState[]): EntityState[] => xs;

test('первый снимок без подтверждения — полный; пустая дельта, когда ничего не изменилось', () => {
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

test('дельта: изменённые поля, новые и пропавшие сущности, события всех снимков после базового', () => {
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

test('клиент: дельта от прежней базы (подтверждение ещё в пути) — из истории, события только новые', () => {
  const ring = new SnapshotRing<string>(8);
  const v = new SnapshotView<string>();
  ring.push(1, ents({ id: 'm0', x: 1 }), ['e1']);
  assert.ok(v.apply(ring.delta(0)!));
  ring.push(2, ents({ id: 'm0', x: 2 }, { id: 'm1', x: 0 }), ['e2']);
  assert.ok(v.apply(ring.delta(1)!));
  assert.deepEqual(v.events, ['e2']);
  // сервер ещё не видел подтверждения снимка 2 — дельта 3 от базы 1
  ring.push(3, ents({ id: 'm0', x: 3 }), ['e3']);
  const d = ring.delta(1)!;
  assert.equal(d.base, 1);
  assert.ok(v.apply(d), 'база 1 в истории');
  assert.equal(v.n, 3);
  assert.deepEqual(new Map(v.ents), new Map([['m0', { id: 'm0', x: 3 }]]));
  assert.deepEqual(v.removed.map((e) => e.id), ['m1'], 'разница — от прежнего текущего');
  assert.deepEqual(v.events, ['e3'], 'e2 второй раз не играется');
  assert.equal(v.rejected, 0);
  // старый дубль — мимо, без отказа
  assert.equal(v.apply(d), false);
  assert.equal(v.rejected, 0);
});

test('клиент: применение по цепочке совпадает с полным снимком; чужая база — отказ и полный', () => {
  const ring = new SnapshotRing<string>(8);
  const v = new SnapshotView<string>();
  let ack = 0;
  for (let t = 1; t <= 6; t++) {
    const es: EntityState[] = [];
    for (let i = 0; i < 3; i++) if (!(t === 4 && i === 1)) es.push({ id: `m${i}`, x: t * i, flag: t % 2 === 0 });
    es.push({ id: 'td', wave: Math.floor(t / 2) });
    ring.push(t, es, [`e${t}`]);
    const d = ring.delta(ack)!;
    assert.ok(v.apply(d), `снимок ${t}`);
    ack = v.n;
    const want = new Map([...ring.last!.ents].map(([k, e]) => [k, { ...e }]));
    assert.deepEqual(new Map(v.ents), want);
    assert.deepEqual(v.events, [`e${t}`]);
  }
  // клиент «уснул»: его подтверждение выпало из кольца — полный снимок
  for (let t = 7; t <= 20; t++) ring.push(t, ents({ id: 'm0', x: t }), []);
  const stale = ring.delta(3)!;
  assert.equal(stale.base, 0);
  assert.ok(v.apply(stale));
  assert.deepEqual([...v.ents.keys()], ['m0']);
  assert.deepEqual(v.removed.map((e) => e.id).sort(), ['m1', 'm2', 'td']);
  // дельта от базы, которой у клиента нет
  ring.push(21, ents({ id: 'm0', x: 21 }), []);
  const foreign = ring.delta(19)!;
  assert.equal(foreign.base, 19);
  assert.equal(v.apply(foreign), false);
  assert.equal(v.rejected, 1);
  assert.equal(v.n, 20);
});
