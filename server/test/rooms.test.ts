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

/** Host creates a room, guests join by code and get ready */
async function party(n: number): Promise<{ code: string; heroes: Awaited<ReturnType<typeof hero>>[] }> {
  const heroes = [];
  for (let i = 0; i < n; i++) heroes.push(await hero(`Hero${i}${Math.random().toString(36).slice(2, 6)}`));
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

test('wrong token and a foreign protocol version close the connection', async () => {
  s = await startServer();
  const bad = new Player(s.ws);
  await new Promise((ok) => { bad.ws.onopen = ok; });
  bad.send({ t: 'hello', token: 'x'.repeat(40), protocol: PROTOCOL });
  assert.equal((await bad.waitClose()).code, CLOSE.auth);
  const a = await register(s, 'Oldtimer');
  const old = new Player(s.ws);
  await new Promise((ok) => { old.ws.onopen = ok; });
  old.send({ t: 'hello', token: a.token, protocol: PROTOCOL + 1 });
  assert.equal((await old.waitClose()).code, CLOSE.protocol);
});

test('room: create, join by code, list, seats, full room', async () => {
  s = await startServer();
  const a = await hero('Anya'), b = await hero('Borya'), c = await hero('Vika');
  a.p.send({ t: 'room.create', map: 'td2', max: 2, private: false });
  const st = await a.p.state();
  assert.match(st.room.code, /^[1-9]\d{4}$/);
  assert.equal(st.room.map, 'td2');
  assert.equal(st.you, 0);
  assert.equal((await api(s, 'GET', '/api/rooms')).body.length, 1);
  b.p.send({ t: 'room.join', code: st.room.code.toLowerCase() });
  const sb = await b.p.state();
  assert.equal(sb.you, 1);
  assert.deepEqual(sb.seats.map((x) => [x.name, x.host]), [['Anya', true], ['Borya', false]]);
  // a full room disappears from the list and lets nobody in
  assert.equal((await api(s, 'GET', '/api/rooms')).body.length, 0);
  c.p.send({ t: 'room.join', code: st.room.code });
  assert.equal((await c.p.next('error')).code, 'room-full');
  c.p.send({ t: 'room.join', code: 'NOCODE' });
  assert.equal((await c.p.next('error')).code, 'no-room');
  // a private room is not visible in the list
  c.p.send({ t: 'room.create', map: 'td', max: 4, private: true });
  await c.p.state();
  assert.equal((await api(s, 'GET', '/api/rooms')).body.length, 0);
  // unknown map
  c.p.send({ t: 'room.map', map: 'none' });
  assert.equal((await c.p.next('error')).code, 'bad-map');
});

test('start: only the host and only when everyone is ready; changing the map resets readiness', async () => {
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
  // a running battle can be joined while there is a seat: the latecomer gets battle.start at once, the room is listed with "battle"
  const code = (await h.p.state((m) => m.room.state === 'battle')).room.code;
  assert.equal((await api(s, 'GET', '/api/rooms')).body[0].state, 'battle');
  const late = await hero('Latecomer');
  late.p.send({ t: 'room.join', code });
  const lb = await late.p.next('battle.start');
  assert.equal(lb.matchId, bs.matchId);
  assert.equal(lb.players, 3);
  assert.equal((await h.p.state((m) => m.seats.length === 3)).seats[2].name, 'Latecomer');
  // and in the server match they have their own seat and hero
  assert.equal(s.app.games.get(bs.matchId)?.seats.size, 3);
});

test('limits: a message flood closes the connection', async () => {
  s = await startServer();
  const { heroes: [, g] } = await party(2);
  // two consecutive "seconds" over the limit — close (the server clock is advanced by hand)
  for (let i = 0; i < NET_LIMITS.perSecond + 5; i++) g.p.send({ t: 'ping' });
  await sleep(100);
  s.clock.t += 1000;
  for (let i = 0; i < NET_LIMITS.perSecond + 5; i++) g.p.send({ t: 'ping' });
  assert.equal((await g.p.waitClose()).code, CLOSE.flood);
});

/** Server battle frames: the runner spins on a timer with a fake clock (dt 0), so steps are driven by hand */
const frames = (n: number): void => { for (let i = 0; i < n; i++) s.app.games.frame(0.05); };

test('battle result: the server runs the match — bush defended, history, capped rewards, profiles, room is a lobby again', async () => {
  s = await startServer();
  const { heroes: [h, g] } = await party(2);
  h.p.send({ t: 'room.start' });
  const { matchId } = await g.p.next('battle.start');
  const match = s.app.games.get(matchId)!;
  assert.ok(match && match.seats.size === 2, 'match in the runner with two heroes');
  frames(10);
  assert.ok(match.tick > 0, 'battle is running');
  s.clock.t += 60_000;
  // the reward is the match loot, not the purse: the guest's tower does not cut it
  assert.ok(match.td.command(1, { t: 'td', a: 'build:arrow', pad: 0 }));
  match.td.addLoot(40);
  const left = match.td.lootOf(1), full = match.td.lootOf(0);
  assert.equal(left, 40);
  match.td.state = 'won';
  frames(120);
  const over = await g.p.next('battle.over');
  assert.deepEqual([over.matchId, over.result, over.wave], [matchId, 'won', 10]);
  const pu = await g.p.next('profile.updated');
  assert.equal((pu.data as { berries: number }).berries, 250 + left);
  const hp = await h.p.next('profile.updated');
  assert.equal((hp.data as { berries: number }).berries, 250 + full);
  await h.p.state((m) => m.room.state === 'lobby' && m.seats.every((x) => !x.ready));
  assert.equal(s.app.games.get(matchId), null, 'match removed from the runner');

  const mine = await api(s, 'GET', '/api/matches', undefined, g.token);
  assert.equal(mine.body.length, 1);
  assert.equal(mine.body[0].berries, left);
  assert.equal(mine.body[0].result, 'won');
  const rec = await api(s, 'GET', '/api/records?map=td');
  assert.deepEqual(rec.body, { map: 'td', bestWave: 10, wins: 1, fastestWinMs: 60_000 });
  const prof = await api(s, 'GET', '/api/profile', undefined, g.token);
  assert.equal(prof.body.version, 2);
  assert.ok(new MapCatalog(MAPS).maxBerries('td', 2) >= 1000, 'the cap leaves room for a real victory loot');
});

test('connection drop: the seat is held, return with the same token; deadline passed — seat freed, host handed over', async () => {
  s = await startServer();
  const { heroes: [h, g] } = await party(2);
  h.p.close();
  await g.p.state((m) => !m.seats[0].online);
  // the host came back (reloaded the page) — online again, in their seat
  const h2 = await Player.connect(s, h.token);
  open.push(h2);
  const back = await h2.state();
  assert.equal(back.you, 0);
  assert.ok(back.seats[0].host && back.seats[0].online);
  // gone for good
  h2.close();
  await g.p.state((m) => !m.seats[0].online);
  s.clock.t += NET_LIMITS.graceMs + 1;
  s.app.rooms.sweep();
  const st = await g.p.state((m) => m.seats.length === 1);
  assert.ok(st.seats[0].host);
  assert.equal(st.room.hostId, g.id);
});

test('host left the battle — it goes on for the rest; everyone left — abandoned; kick', async () => {
  s = await startServer();
  const { heroes: [h, g1, g2, g3] } = await party(4);
  h.p.send({ t: 'room.kick', playerId: g3.id });
  assert.equal((await g3.p.next('room.left')).reason, 'kick');
  await h.p.state((m) => m.seats.length === 3);
  h.p.send({ t: 'room.start' });
  const { matchId } = await g1.p.next('battle.start');
  const match = s.app.games.get(matchId)!;
  h.p.send({ t: 'room.leave' });
  // the crown goes to the next one, the battle runs on the server without the host's hero
  const st = await g1.p.state((m) => m.seats.length === 2 && m.room.hostId === g1.id);
  assert.equal(st.room.state, 'battle');
  assert.equal(match.seats.size, 2);
  frames(5);
  assert.ok(!match.ended);
  // guest drop: the seat is held for graceMs, then the hero leaves the match
  g1.p.close();
  await g2.p.state((m) => !m.seats.find((x) => x.seat === 1)?.online);
  s.clock.t += NET_LIMITS.graceMs + 1;
  s.app.rooms.sweep();
  await g2.p.state((m) => m.seats.length === 1);
  assert.equal(match.seats.size, 1);
  // the last one left — battle abandoned, room closed
  g2.p.send({ t: 'room.leave' });
  await g2.p.next('room.left');
  assert.equal((s.app.db.prepare('SELECT result FROM matches WHERE id = ?').get(matchId) as { result: string }).result, 'abandoned');
  assert.equal(s.app.games.get(matchId), null);
});

test('"Once more": the host starts a new battle with the same party without readiness', async () => {
  s = await startServer();
  const { heroes: [h, g] } = await party(2);
  h.p.send({ t: 'room.start' });
  const first = await g.p.next('battle.start');
  // defeat: the collected loot burns
  s.app.games.get(first.matchId)!.td.addLoot(70);
  s.app.games.get(first.matchId)!.td.state = 'lost';
  frames(120);
  assert.equal(((await g.p.next('profile.updated')).data as { berries: number }).berries, 250);
  await g.p.next('battle.over');
  g.p.send({ t: 'room.again' });
  assert.equal((await g.p.next('error')).code, 'not-host');
  h.p.send({ t: 'room.again' });
  const again = await g.p.next('battle.start');
  assert.notEqual(again.matchId, first.matchId);
  assert.equal(again.players, 2);
});

test('room chat: to everyone in it, with a name; empty and too frequent are dropped', async () => {
  s = await startServer();
  const { heroes: [h, g] } = await party(2);
  g.p.send({ t: 'chat', text: '  hello,   host!  ' });
  const m = await h.p.next('chat');
  assert.deepEqual([m.seat, m.text], [1, 'hello, host!']);
  assert.equal((await g.p.next('chat')).text, 'hello, host!');
  g.p.send({ t: 'chat', text: 'more' });
  g.p.send({ t: 'chat', text: '   ' });
  await sleep(100);
  assert.ok(!h.p.inbox.some((x) => x.t === 'chat'), 'more often than chatMs and empty do not get through');
  s.clock.t += NET_LIMITS.chatMs + 1;
  g.p.send({ t: 'chat', text: 'x'.repeat(500) });
  assert.equal((await h.p.next('chat')).text.length, NET_LIMITS.chatMax);
});

test('friends: add by name, online and room, remove', async () => {
  s = await startServer();
  const a = await hero('Anya'), b = await hero('Borya');
  assert.equal((await api(s, 'POST', '/api/friends', { name: 'no such' }, a.token)).status, 404);
  assert.equal((await api(s, 'POST', '/api/friends', { name: 'Anya' }, a.token)).status, 400);
  assert.equal((await api(s, 'POST', '/api/friends', { name: 'borya' }, a.token)).status, 201);
  let list = (await api(s, 'GET', '/api/friends', undefined, a.token)).body;
  assert.deepEqual(list.map((f: { name: string; online: boolean; room: unknown }) => [f.name, f.online, f.room]), [['Borya', true, null]]);
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


test('the same player from another tab displaces the old connection', async () => {
  s = await startServer();
  const a = await hero('Twin');
  const b = await Player.connect(s, a.token);
  open.push(b);
  assert.equal((await a.p.waitClose()).code, CLOSE.replaced);
});

test('restart: the lobby remains, the battle is abandoned, seats are held for RESTORE_MS', async () => {
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
  // the guest came back on their own — to their seat
  const g2 = await Player.connect(s, g.token);
  open.push(g2);
  assert.equal((await g2.state()).you, 1);
  // the host never came — after RESTORE_MS the seat is freed
  s.clock.t += RESTORE_MS + 1;
  s.app.rooms.sweep();
  assert.equal(s.app.rooms.roomOfPlayer(h.id), null);
  assert.equal(s.app.rooms.roomOfPlayer(g.id)?.hostId, g.id);
  assert.equal(s.app.rooms.roomOfPlayer(h2.id), null, 'empty room closed');
});
