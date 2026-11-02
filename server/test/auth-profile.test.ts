import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { api, register, starter, startServer, type TestServer } from './helpers.ts';

let s: TestServer;
before(async () => { s = await startServer(); });
after(() => s.stop());

test('вход по имени: токен, занятое имя, повторный вход своим токеном', async () => {
  const a = await register(s, 'Малинка');
  assert.ok(a.token.length >= 40);
  assert.equal((await api(s, 'POST', '/api/auth', { name: 'малинка' })).status, 409);
  const again = await api(s, 'POST', '/api/auth', { name: 'Малинка' }, a.token);
  assert.equal(again.status, 200);
  assert.equal(again.body.playerId, a.playerId);
  assert.equal((await api(s, 'POST', '/api/auth', { name: 'x' })).status, 400);
  assert.equal((await api(s, 'GET', '/api/me', undefined, a.token)).body.name, 'Малинка');
  assert.equal((await api(s, 'GET', '/api/me', undefined, 'wrong-token-wrong-token-wrong')).status, 401);
});

test('переименование', async () => {
  const a = await register(s, 'Старое');
  await register(s, 'Занято');
  assert.equal((await api(s, 'POST', '/api/auth/rename', { name: 'Занято' }, a.token)).status, 409);
  assert.equal((await api(s, 'POST', '/api/auth/rename', { name: 'Новое' }, a.token)).status, 200);
  assert.equal((await api(s, 'GET', '/api/me', undefined, a.token)).body.name, 'Новое');
});

test('профиль: первая запись, чтение, конфликт версий', async () => {
  const a = await register(s, 'Профиль');
  assert.equal((await api(s, 'GET', '/api/profile', undefined, a.token)).status, 404);
  const data = starter() as { berries: number };
  const w1 = await api(s, 'PUT', '/api/profile', { version: 0, data }, a.token);
  assert.equal(w1.status, 200);
  assert.equal(w1.body.version, 1);
  data.berries = 999;
  assert.equal((await api(s, 'PUT', '/api/profile', { version: 1, data }, a.token)).body.version, 2);
  // запись по старой версии — конфликт и свежий профиль
  const stale = await api(s, 'PUT', '/api/profile', { version: 1, data: starter() }, a.token);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.version, 2);
  assert.equal(stale.body.data.berries, 999);
  const r = await api(s, 'GET', '/api/profile', undefined, a.token);
  assert.equal(r.body.data.berries, 999);
});

test('профиль: мусор отклонён, неизвестные предметы выброшены', async () => {
  const a = await register(s, 'Мусор');
  for (const bad of [null, 5, { version: 2 }, { ...(starter() as object), berries: -1 }, { ...(starter() as object), level: 0.5 }]) {
    assert.equal((await api(s, 'PUT', '/api/profile', { version: 0, data: bad }, a.token)).status, 400, JSON.stringify(bad)?.slice(0, 40));
  }
  const d = starter() as { items: { uid: string; def: string; power: number; enchants: unknown[] }[]; equip: { melee: string | null; aura: string | null } };
  // надет предмет, которого нет в сумке
  assert.equal((await api(s, 'PUT', '/api/profile', { version: 0, data: { ...d, equip: { ...d.equip, aura: 'нет' } } }, a.token)).status, 400);
  d.items.push({ uid: 'z1', def: 'нет-такого', power: 1, enchants: [] });
  d.equip.melee = 'z1';
  const w = await api(s, 'PUT', '/api/profile', { version: 0, data: d }, a.token);
  assert.equal(w.status, 200);
  assert.ok(!w.body.data.items.some((i: { uid: string }) => i.uid === 'z1'));
  assert.equal(w.body.data.equip.melee, null);
});

test('health и карты', async () => {
  const r = await api(s, 'GET', '/api/health');
  assert.deepEqual(r.body.maps, ['td', 'td2', 'td3']);
  assert.equal((await api(s, 'GET', '/api/records?map=нет')).status, 400);
});
