import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { boardDay, dailyBoard, missionId, parseMission, withLanding } from '../../src/expedition/mission.ts';
import { OBJECTIVES } from '../../src/expedition/types.ts';
import { MapCatalog } from '../maps.ts';
import { api, MAPS, Player, register, startServer, type TestServer } from './helpers.ts';

let s: TestServer;
const open: Player[] = [];
afterEach(async () => { for (const p of open.splice(0)) p.close(); await s?.stop(); });

async function hero(name: string): Promise<{ id: string; token: string; p: Player }> {
  const a = await register(s, name);
  const p = await Player.connect(s, a.token);
  open.push(p);
  return { id: a.playerId, token: a.token, p };
}
const frames = (n: number): void => { for (let i = 0; i < n; i++) s.app.games.frame(0.05); };

test('mission id: parsed back, malformed ones rejected; the board of a day is the same for everyone and has every objective', () => {
  const p = { seed: 12345, difficulty: 4, objective: 'bush' as const, landing: 2 };
  assert.equal(missionId(p), 'exp:12345:4:bush:2');
  assert.deepEqual(parseMission(missionId(p)), p);
  assert.equal(withLanding('exp:7:1:lairs:0', 1), 'exp:7:1:lairs:1');
  for (const bad of ['td', 'exp:', 'exp:0:1:lairs:0', 'exp:5:9:lairs:0', 'exp:5:1:dragons:0', 'exp:5:1:lairs:3', 'exp:5:1:lairs:0:9', 'exp:1.5:1:lairs:0']) assert.equal(parseMission(bad), null, bad);
  const day = boardDay(Date.UTC(2026, 10, 11, 15));
  assert.deepEqual(dailyBoard(day, 3), dailyBoard(day, 3));
  assert.notDeepEqual(dailyBoard(day, 3), dailyBoard(day + 1, 3));
  assert.notDeepEqual(dailyBoard(day, 3).map((m) => m.seed), dailyBoard(day, 4).map((m) => m.seed));
  assert.deepEqual(dailyBoard(day, 3).map((m) => m.objective).sort(), OBJECTIVES.slice().sort());
  for (const m of dailyBoard(day, 8)) assert.deepEqual(parseMission(missionId(m)), m);
  // the catalog serves missions next to the map files
  const maps = new MapCatalog(MAPS);
  assert.ok(maps.has('exp:12345:4:bush:2') && !maps.has('exp:12345:9:bush:2') && maps.has('td'));
  assert.ok(maps.maxBerries('exp:12345:4:bush:2', 2) > 1000);
  assert.equal(maps.load('exp:12345:4:bush:2')!.mode.kind, 'expedition');
});

test('mission room: the server runs an expedition — heroes on the chosen landing, `exp` commands, seeds and loot into the profiles', async () => {
  s = await startServer();
  const h = await hero('Lena'), g = await hero('Gosha');
  const map = 'exp:777:2:beacons:1';
  h.p.send({ t: 'room.create', map: 'exp:777:9:beacons:1', max: 4, password: '' });
  assert.equal((await h.p.next('error')).code, 'bad-map');
  h.p.send({ t: 'room.create', map: 'td', max: 4, password: '' });
  const code = (await h.p.state()).room.code;
  h.p.send({ t: 'room.map', map });
  assert.equal((await h.p.state((m) => m.room.map === map)).room.map, map);
  g.p.send({ t: 'room.join', code });
  await g.p.state((m) => m.seats.some((x) => x.playerId === g.id));
  g.p.send({ t: 'room.ready', ready: true });
  await h.p.state((m) => m.seats.length === 2 && m.seats.every((x) => x.host || x.ready));
  h.p.send({ t: 'room.start' });
  const start = await g.p.next('battle.start');
  assert.equal(start.map, map);
  const match = s.app.games.get(start.matchId)!, exp = match.battle.world.expedition!;
  assert.ok(exp, 'the match is an expedition');
  assert.equal(exp.spec.landing, 1);
  const land = exp.spec.landings[1];
  for (const seat of [0, 1]) { const p = match.heroPos(seat)!; assert.ok(Math.hypot(p.x - land.x, p.z - land.z) < 3, `seat ${seat} on the chosen landing`); }
  frames(10);
  assert.equal((await api(s, 'GET', '/api/rooms')).body[0].state, 'battle');
  // the guest carries a seed out, the host stays away from the pad
  for (const b of exp.beacons) { b.state = 'lit'; }
  (exp as unknown as { step(): void }).step();
  assert.equal(exp.primary, true);
  exp.carriedOf(1).rare = 2;
  exp.carriedOf(0).common = 5;
  const pad = exp.extraction.pos, away = exp.spec.landings[0];
  const put = (): void => {
    match.battle.heroes.get(1)!.knight.place(pad.x, pad.z, 0, pad.y);
    match.battle.heroes.get(0)!.knight.place(away.x, away.z, 0, 0);
    for (const k of match.battle.heroes.values()) k.knight.hp = k.knight.maxHp;
  };
  put();
  frames(2);
  assert.ok(match.rules.command(1, { t: 'exp', a: 'use' }));
  assert.equal(exp.extraction.state, 'called');
  for (let i = 0; i < 2400 && exp.state === 'play'; i++) { put(); frames(1); }
  assert.equal(exp.state, 'won');
  const loot = exp.lootOf(1);
  assert.ok(loot > 0);
  frames(120);
  const over = await g.p.next('battle.over');
  assert.equal(over.result, 'won');
  const gp = (await g.p.next('profile.updated')).data as { berries: number; seeds?: { common: number; rare: number; golden: number } };
  assert.deepEqual(gp.seeds, { common: 0, rare: 2, golden: 0 });
  assert.equal(gp.berries, 250 + loot);
  const hp = (await h.p.next('profile.updated')).data as { seeds?: unknown };
  assert.equal(hp.seeds, undefined, 'the host did not board: his seeds are lost');
  await h.p.state((m) => m.room.state === 'lobby');
  // the stored profile with seeds passes validation when the camp saves it again
  const prof = await api(s, 'GET', '/api/profile', undefined, g.token);
  assert.deepEqual(prof.body.data.seeds, { common: 0, rare: 2, golden: 0 });
});
