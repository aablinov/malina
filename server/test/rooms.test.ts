import assert from 'node:assert/strict';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { CLOSE, NET_LIMITS, PROTOCOL } from '../../src/net/protocol.ts';
import { MapCatalog } from '../maps.ts';
import { RESTORE_MS } from '../rooms.ts';
import { api, MAPS, Player, register, sleep, starter, startServer, type TestServer } from './helpers.ts';

let s: TestServer;
const open: Player[] = [];
afterEach(async () => { for (const p of open.splice(0)) p.close(); await s.stop(); });

async function hero(name: string): Promise<{ id: string; token: string; p: Player }> {
  const a = await register(s, name);
  await api(s, 'PUT', '/api/profile', { version: 0, data: starter() }, a.token);
  const p = await Player.connect(s, a.token);
  open.push(p);
  return { id: a.playerId, token: a.token, p };
}

/** Хост создаёт комнату, гости входят по коду и готовы */
async function party(n: number): Promise<{ code: string; heroes: Awaited<ReturnType<typeof hero>>[] }> {
  const heroes = [];
  for (let i = 0; i < n; i++) heroes.push(await hero(`Герой${i}${Math.random().toString(36).slice(2, 6)}`));
  heroes[0].p.send({ t: 'room.create', map: 'td', max: 4, private: false });
  const code = (await heroes[0].p.state()).room.code;
  for (const h of heroes.slice(1)) {
    h.p.send({ t: 'room.join', code });
    await h.p.state((m) => m.seats.some((x) => x.playerId === h.id));
    h.p.send({ t: 'room.ready', ready: true });
  }
  if (n > 1) await heroes[0].p.state((m) => m.seats.length === n && m.seats.every((x) => x.host || x.ready));
  return { code, heroes };
}

test('неверный токен и чужая версия протокола закрывают соединение', async () => {
  s = await startServer();
  const bad = new Player(s.ws);
  await new Promise((ok) => { bad.ws.onopen = ok; });
  bad.send({ t: 'hello', token: 'x'.repeat(40), protocol: PROTOCOL });
  assert.equal((await bad.waitClose()).code, CLOSE.auth);
  const a = await register(s, 'Старый');
  const old = new Player(s.ws);
  await new Promise((ok) => { old.ws.onopen = ok; });
  old.send({ t: 'hello', token: a.token, protocol: PROTOCOL + 1 });
  assert.equal((await old.waitClose()).code, CLOSE.protocol);
});

test('комната: создать, войти по коду, список, места, полная комната', async () => {
  s = await startServer();
  const a = await hero('Аня'), b = await hero('Боря'), c = await hero('Вика');
  a.p.send({ t: 'room.create', map: 'td2', max: 2, private: false });
  const st = await a.p.state();
  assert.match(st.room.code, /^[A-Z]{6}$/);
  assert.equal(st.room.map, 'td2');
  assert.equal(st.you, 0);
  assert.equal((await api(s, 'GET', '/api/rooms')).body.length, 1);
  b.p.send({ t: 'room.join', code: st.room.code.toLowerCase() });
  const sb = await b.p.state();
  assert.equal(sb.you, 1);
  assert.deepEqual(sb.seats.map((x) => [x.name, x.host]), [['Аня', true], ['Боря', false]]);
  // полная комната пропадает из списка и не пускает
  assert.equal((await api(s, 'GET', '/api/rooms')).body.length, 0);
  c.p.send({ t: 'room.join', code: st.room.code });
  assert.equal((await c.p.next('error')).code, 'room-full');
  c.p.send({ t: 'room.join', code: 'НЕТКОД' });
  assert.equal((await c.p.next('error')).code, 'no-room');
  // закрытая комната не видна в списке
  c.p.send({ t: 'room.create', map: 'td', max: 4, private: true });
  await c.p.state();
  assert.equal((await api(s, 'GET', '/api/rooms')).body.length, 0);
  // неизвестная карта
  c.p.send({ t: 'room.map', map: 'нет' });
  assert.equal((await c.p.next('error')).code, 'bad-map');
});

test('старт: только хост и только когда все готовы; смена карты сбрасывает готовность', async () => {
  s = await startServer();
  const { heroes: [h, g] } = await party(2);
  g.p.send({ t: 'room.start' });
  assert.equal((await g.p.next('error')).code, 'not-host');
  h.p.send({ t: 'room.map', map: 'td3' });
  await h.p.state((m) => m.room.map === 'td3' && m.seats.every((x) => !x.ready));
  h.p.send({ t: 'room.start' });
  assert.equal((await h.p.next('error')).code, 'not-ready');
  g.p.send({ t: 'room.ready', ready: true });
  await h.p.state((m) => m.seats[1].ready);
  h.p.send({ t: 'room.start' });
  const bs = await g.p.next('battle.start');
  assert.equal(bs.map, 'td3');
  assert.equal(bs.players, 2);
  assert.equal(bs.hostSeat, 0);
  assert.ok(bs.seed > 0);
  assert.equal((await h.p.next('battle.start')).matchId, bs.matchId);
  // в идущий бой можно войти, пока есть место: опоздавший сразу получает battle.start, комната — в списке с «battle»
  const code = (await h.p.state((m) => m.room.state === 'battle')).room.code;
  assert.equal((await api(s, 'GET', '/api/rooms')).body[0].state, 'battle');
  const late = await hero('Опоздал');
  late.p.send({ t: 'room.join', code });
  const lb = await late.p.next('battle.start');
  assert.equal(lb.matchId, bs.matchId);
  assert.equal(lb.players, 3);
  assert.equal((await h.p.state((m) => m.seats.length === 3)).seats[2].name, 'Опоздал');
  // и в серверном матче у него своё место и герой
  assert.equal(s.app.games.get(bs.matchId)?.seats.size, 3);
});

test('лимиты: поток сообщений закрывает соединение', async () => {
  s = await startServer();
  const { heroes: [, g] } = await party(2);
  // две «секунды» с превышением подряд — закрыть (часы сервера двигаем вручную)
  for (let i = 0; i < NET_LIMITS.perSecond + 5; i++) g.p.send({ t: 'ping' });
  await sleep(100);
  s.clock.t += 1000;
  for (let i = 0; i < NET_LIMITS.perSecond + 5; i++) g.p.send({ t: 'ping' });
  assert.equal((await g.p.waitClose()).code, CLOSE.flood);
});

/** Кадры серверного боя: раннер крутится по таймеру с фейковыми часами (dt 0), поэтому шаги даём сами */
const frames = (n: number): void => { for (let i = 0; i < n; i++) s.app.games.frame(0.05); };

test('итог боя: матч считает сервер — куст отбит, история, награды с потолком, профили, комната снова лобби', async () => {
  s = await startServer();
  const { heroes: [h, g] } = await party(2);
  h.p.send({ t: 'room.start' });
  const { matchId } = await g.p.next('battle.start');
  const match = s.app.games.get(matchId)!;
  assert.ok(match && match.seats.size === 2, 'матч в раннере с двумя героями');
  frames(10);
  assert.ok(match.tick > 0, 'бой идёт');
  s.clock.t += 60_000;
  // гость потратился на башню — награда ему меньше; хост получает всю стартовую казну
  assert.ok(match.td.command(1, { t: 'td', a: 'build:arrow', pad: 0 }));
  const left = match.td.berries(1), full = match.td.berries(0);
  match.td.state = 'won';
  frames(120);
  const over = await g.p.next('battle.over');
  assert.deepEqual([over.matchId, over.result, over.wave], [matchId, 'won', 10]);
  const pu = await g.p.next('profile.updated');
  assert.equal((pu.data as { berries: number }).berries, 250 + left);
  const hp = await h.p.next('profile.updated');
  assert.equal((hp.data as { berries: number }).berries, 250 + full);
  await h.p.state((m) => m.room.state === 'lobby' && m.seats.every((x) => !x.ready));
  assert.equal(s.app.games.get(matchId), null, 'матч убран из раннера');

  const mine = await api(s, 'GET', '/api/matches', undefined, g.token);
  assert.equal(mine.body.length, 1);
  assert.equal(mine.body[0].berries, left);
  assert.equal(mine.body[0].result, 'won');
  const rec = await api(s, 'GET', '/api/records?map=td');
  assert.deepEqual(rec.body, { map: 'td', bestWave: 10, wins: 1, fastestWinMs: 60_000 });
  const prof = await api(s, 'GET', '/api/profile', undefined, g.token);
  assert.equal(prof.body.version, 2);
  assert.ok(new MapCatalog(MAPS).maxBerries('td', 2) >= full, 'потолок выше стартовой казны');
});

test('обрыв связи: место держится, возврат с тем же токеном; срок вышел — место свободно, хост передан', async () => {
  s = await startServer();
  const { heroes: [h, g] } = await party(2);
  h.p.close();
  await g.p.state((m) => !m.seats[0].online);
  // хост вернулся (перезагрузил страницу) — снова на связи, на своём месте
  const h2 = await Player.connect(s, h.token);
  open.push(h2);
  const back = await h2.state();
  assert.equal(back.you, 0);
  assert.ok(back.seats[0].host && back.seats[0].online);
  // ушёл насовсем
  h2.close();
  await g.p.state((m) => !m.seats[0].online);
  s.clock.t += NET_LIMITS.graceMs + 1;
  s.app.rooms.sweep();
  const st = await g.p.state((m) => m.seats.length === 1);
  assert.ok(st.seats[0].host);
  assert.equal(st.room.hostId, g.id);
});

test('хост ушёл из боя — бой идёт дальше у остальных; ушли все — прерван; кик', async () => {
  s = await startServer();
  const { heroes: [h, g1, g2, g3] } = await party(4);
  h.p.send({ t: 'room.kick', playerId: g3.id });
  assert.equal((await g3.p.next('room.left')).reason, 'kick');
  await h.p.state((m) => m.seats.length === 3);
  h.p.send({ t: 'room.start' });
  const { matchId } = await g1.p.next('battle.start');
  const match = s.app.games.get(matchId)!;
  h.p.send({ t: 'room.leave' });
  // корона — следующему, бой идёт на сервере без героя хоста
  const st = await g1.p.state((m) => m.seats.length === 2 && m.room.hostId === g1.id);
  assert.equal(st.room.state, 'battle');
  assert.equal(match.seats.size, 2);
  frames(5);
  assert.ok(!match.ended);
  // обрыв гостя: место держится graceMs, потом герой уходит из матча
  g1.p.close();
  await g2.p.state((m) => !m.seats.find((x) => x.seat === 1)?.online);
  s.clock.t += NET_LIMITS.graceMs + 1;
  s.app.rooms.sweep();
  await g2.p.state((m) => m.seats.length === 1);
  assert.equal(match.seats.size, 1);
  // последний ушёл — бой прерван, комната закрыта
  g2.p.send({ t: 'room.leave' });
  await g2.p.next('room.left');
  assert.equal((s.app.db.prepare('SELECT result FROM matches WHERE id = ?').get(matchId) as { result: string }).result, 'abandoned');
  assert.equal(s.app.games.get(matchId), null);
});

test('«Ещё раз»: хост начинает новый бой тем же составом без готовности', async () => {
  s = await startServer();
  const { heroes: [h, g] } = await party(2);
  h.p.send({ t: 'room.start' });
  const first = await g.p.next('battle.start');
  s.app.games.get(first.matchId)!.td.state = 'lost';
  frames(120);
  await g.p.next('battle.over');
  g.p.send({ t: 'room.again' });
  assert.equal((await g.p.next('error')).code, 'not-host');
  h.p.send({ t: 'room.again' });
  const again = await g.p.next('battle.start');
  assert.notEqual(again.matchId, first.matchId);
  assert.equal(again.players, 2);
});

test('чат комнаты: всем в ней, с именем; пустое и частое — нет', async () => {
  s = await startServer();
  const { heroes: [h, g] } = await party(2);
  g.p.send({ t: 'chat', text: '  привет,   хост!  ' });
  const m = await h.p.next('chat');
  assert.deepEqual([m.seat, m.text], [1, 'привет, хост!']);
  assert.equal((await g.p.next('chat')).text, 'привет, хост!');
  g.p.send({ t: 'chat', text: 'ещё' });
  g.p.send({ t: 'chat', text: '   ' });
  await sleep(100);
  assert.ok(!h.p.inbox.some((x) => x.t === 'chat'), 'чаще chatMs и пустое не доходят');
  s.clock.t += NET_LIMITS.chatMs + 1;
  g.p.send({ t: 'chat', text: 'x'.repeat(500) });
  assert.equal((await h.p.next('chat')).text.length, NET_LIMITS.chatMax);
});

test('друзья: добавить по имени, на связи и комната, убрать', async () => {
  s = await startServer();
  const a = await hero('Аня'), b = await hero('Боря');
  assert.equal((await api(s, 'POST', '/api/friends', { name: 'нет такого' }, a.token)).status, 404);
  assert.equal((await api(s, 'POST', '/api/friends', { name: 'Аня' }, a.token)).status, 400);
  assert.equal((await api(s, 'POST', '/api/friends', { name: 'боря' }, a.token)).status, 201);
  let list = (await api(s, 'GET', '/api/friends', undefined, a.token)).body;
  assert.deepEqual(list.map((f: { name: string; online: boolean; room: unknown }) => [f.name, f.online, f.room]), [['Боря', true, null]]);
  b.p.send({ t: 'room.create', map: 'td', max: 4, private: true });
  const code = (await b.p.state()).room.code;
  list = (await api(s, 'GET', '/api/friends', undefined, a.token)).body;
  assert.equal(list[0].room.code, code);
  b.p.close();
  await sleep(50);
  assert.equal((await api(s, 'GET', '/api/friends', undefined, a.token)).body[0].online, false);
  assert.equal((await api(s, 'DELETE', `/api/friends?id=${b.id}`, undefined, a.token)).status, 200);
  assert.deepEqual((await api(s, 'GET', '/api/friends', undefined, a.token)).body, []);
});


test('тот же игрок с другой вкладки вытесняет старое соединение', async () => {
  s = await startServer();
  const a = await hero('Двойник');
  const b = await Player.connect(s, a.token);
  open.push(b);
  assert.equal((await a.p.waitClose()).code, CLOSE.replaced);
});

test('перезапуск: лобби остаётся, бой — abandoned, места держатся RESTORE_MS', async () => {
  s = await startServer();
  const db = join(s.dir, 'malina.db');
  await s.stop();
  s = await startServer(db);
  const { code, heroes: [h, g] } = await party(2);
  const { heroes: [h2] } = await party(1);
  h2.p.send({ t: 'room.start' });
  const { matchId } = await h2.p.next('battle.start');
  for (const p of open.splice(0)) p.close();
  await sleep(50);
  await s.app.close();

  s = await startServer(db);
  const st = s.app.rooms.roomOfPlayer(h.id);
  assert.equal(st?.code, code);
  assert.equal(st?.state, 'lobby');
  assert.equal(s.app.rooms.roomOfPlayer(h2.id)?.state, 'lobby');
  const rows = s.app.db.prepare('SELECT result FROM matches WHERE id = ?').get(matchId) as { result: string };
  assert.equal(rows.result, 'abandoned');
  // гость вернулся сам — на своё место
  const g2 = await Player.connect(s, g.token);
  open.push(g2);
  assert.equal((await g2.state()).you, 1);
  // хост так и не пришёл — через RESTORE_MS место освобождается
  s.clock.t += RESTORE_MS + 1;
  s.app.rooms.sweep();
  assert.equal(s.app.rooms.roomOfPlayer(h.id), null);
  assert.equal(s.app.rooms.roomOfPlayer(g.id)?.hostId, g.id);
  assert.equal(s.app.rooms.roomOfPlayer(h2.id), null, 'пустая комната закрыта');
});
