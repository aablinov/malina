import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventQueue, MAX_QUEUED, type SysEvent } from '../../src/cgame/events.ts';
import { GameInput } from '../../src/cgame/input.ts';

const key = (code: string, down: boolean, repeat = false): Parameters<EventQueue['push']>[0] => ({ kind: 'key', code, down, repeat, e: {} as KeyboardEvent });

test('очередь событий: порядок по времени, разбор только накопленного, переполнение выбрасывает старейшие', () => {
  const clock = { t: 0 };
  const q = new EventQueue(() => clock.t);
  q.push(key('KeyW', true)); clock.t = 5;
  q.push({ kind: 'mouse', x: 10, y: 20 }); clock.t = 9;
  q.push(key('KeyW', false));
  const seen: SysEvent[] = [];
  q.drain((e) => { seen.push(e); if (seen.length === 1) q.push({ kind: 'blur' }); });
  assert.deepEqual(seen.map((e) => [e.kind, e.t]), [['key', 0], ['mouse', 5], ['key', 9]]);
  assert.equal(q.size, 1, 'добавленное по ходу разбора ждёт следующего');
  q.clear();
  for (let i = 0; i < MAX_QUEUED + 10; i++) q.push({ kind: 'wheel', dy: i });
  assert.equal(q.dropped, 10);
  const first: SysEvent[] = [];
  q.drain((e) => { if (first.length < 1) first.push(e); });
  assert.equal((first[0] as { dy: number }).dy, 10, 'старейшие выброшены');
});

test('ввод: тап короче такта доходит до такта, зажатая держится, действия копятся по порядку и исполняются раз', () => {
  const g = new GameInput(() => ({ w: 100, h: 50 }));
  g.feed({ t: 0, kind: 'key', code: 'KeyW', down: true, repeat: false, e: {} as KeyboardEvent });
  g.feed({ t: 1, kind: 'key', code: 'KeyW', down: false, repeat: false, e: {} as KeyboardEvent });
  assert.ok(g.keys.has('KeyW') && g.keys.tapped('KeyW'), 'тап виден такту');
  g.endTick();
  assert.ok(!g.keys.has('KeyW'), 'после такта отпущена');
  g.feed({ t: 2, kind: 'key', code: 'KeyD', down: true, repeat: false, e: {} as KeyboardEvent });
  g.endTick();
  assert.ok(g.keys.has('KeyD'), 'зажатая держится между тактами');
  // повторы клавиши (автоповтор) — не действия
  g.feed({ t: 3, kind: 'key', code: 'KeyE', down: true, repeat: false, e: {} as KeyboardEvent });
  g.feed({ t: 4, kind: 'key', code: 'KeyE', down: true, repeat: true, e: {} as KeyboardEvent });
  g.feed({ t: 5, kind: 'key', code: 'Digit2', down: true, repeat: false, e: {} as KeyboardEvent });
  g.feed({ t: 6, kind: 'key', code: 'Digit2', down: false, repeat: false, e: {} as KeyboardEvent });
  assert.deepEqual(g.takeActions(), [{ k: 'potion' }, { k: 'artifact', i: 1, down: true }, { k: 'artifact', i: 1, down: false }]);
  assert.deepEqual(g.takeActions(), [], 'исполненные не повторяются');
  // мышь: клик короче такта — защёлка, курсор в NDC
  g.feed({ t: 7, kind: 'button', button: 0, down: true });
  g.feed({ t: 8, kind: 'button', button: 0, down: false });
  g.feed({ t: 9, kind: 'mouse', x: 100, y: 0 });
  assert.ok(g.mouse.lmbHeld && !g.mouse.lmb);
  assert.deepEqual([g.mouse.ndc.x, g.mouse.ndc.y], [1, 1]);
  g.endTick();
  assert.ok(!g.mouse.lmbHeld);
  g.feed({ t: 10, kind: 'blur' });
  assert.ok(!g.keys.has('KeyD'), 'потеря фокуса отпускает всё');
});
