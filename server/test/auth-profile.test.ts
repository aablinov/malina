import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { api, register, starter, startServer, type TestServer } from './helpers.ts';

let s: TestServer;
before(async () => { s = await startServer(); });
after(() => s.stop());

test('sign-in by name: token, taken name, repeated sign-in with own token', async () => {
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

test('rename', async () => {
  const a = await register(s, 'OldName');
  await register(s, 'Taken');
  assert.equal((await api(s, 'POST', '/api/auth/rename', { name: 'Taken' }, a.token)).status, 409);
  assert.equal((await api(s, 'POST', '/api/auth/rename', { name: 'NewName' }, a.token)).status, 200);
  assert.equal((await api(s, 'GET', '/api/me', undefined, a.token)).body.name, 'NewName');
});

test('profile: born with the hero, read, write, version conflict', async () => {
  const a = await register(s, 'Profiler');
  const r0 = await api(s, 'GET', '/api/profile', undefined, a.token);
  assert.equal(r0.status, 200);
  assert.equal(r0.body.version, 1);
  assert.equal(r0.body.data.level, 1);
  const data = starter() as { berries: number };
  data.berries = 999;
  assert.equal((await api(s, 'PUT', '/api/profile', { version: 1, data }, a.token)).body.version, 2);
  // write against an old version — conflict and the fresh profile
  const stale = await api(s, 'PUT', '/api/profile', { version: 1, data: starter() }, a.token);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.version, 2);
  assert.equal(stale.body.data.berries, 999);
  const r = await api(s, 'GET', '/api/profile', undefined, a.token);
  assert.equal(r.body.data.berries, 999);
});

test('registration with a brought profile (old browser save)', async () => {
  const data = starter() as { berries: number };
  data.berries = 4242;
  const r = await api(s, 'POST', '/api/auth', { name: 'Bringer', profile: data });
  assert.equal(r.status, 201);
  assert.equal((await api(s, 'GET', '/api/profile', undefined, r.body.token)).body.data.berries, 4242);
  assert.equal((await api(s, 'POST', '/api/auth', { name: 'Junker', profile: { version: 2 } })).status, 400);
  assert.equal((await api(s, 'POST', '/api/auth', { name: 'Junker' })).status, 201, 'a rejected profile does not take the name');
});

test('profile: junk rejected, unknown items dropped', async () => {
  const a = await register(s, 'Garbage');
  // an account from before profiles were born with the hero — writes from version 0
  s.app.db.prepare('DELETE FROM profiles WHERE player_id = ?').run(a.playerId);
  assert.equal((await api(s, 'GET', '/api/profile', undefined, a.token)).status, 404);
  for (const bad of [null, 5, { version: 2 }, { ...(starter() as object), berries: -1 }, { ...(starter() as object), level: 0.5 }]) {
    assert.equal((await api(s, 'PUT', '/api/profile', { version: 0, data: bad }, a.token)).status, 400, JSON.stringify(bad)?.slice(0, 40));
  }
  const d = starter() as { items: { uid: string; def: string; power: number; enchants: unknown[] }[]; equip: { melee: string | null; aura: string | null } };
  // an item that is not in the bag is equipped
  assert.equal((await api(s, 'PUT', '/api/profile', { version: 0, data: { ...d, equip: { ...d.equip, aura: 'none' } } }, a.token)).status, 400);
  d.items.push({ uid: 'z1', def: 'no-such', power: 1, enchants: [] });
  d.equip.melee = 'z1';
  const w = await api(s, 'PUT', '/api/profile', { version: 0, data: d }, a.token);
  assert.equal(w.status, 200);
  assert.ok(!w.body.data.items.some((i: { uid: string }) => i.uid === 'z1'));
  assert.equal(w.body.data.equip.melee, null);
});

test('health and maps', async () => {
  const r = await api(s, 'GET', '/api/health');
  assert.deepEqual(r.body.maps, ['td', 'td2', 'td3', 'td4']);
  assert.equal((await api(s, 'GET', '/api/records?map=none')).status, 400);
});
