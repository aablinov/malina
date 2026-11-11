import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { boardDay, dailyBoard, missionId, missionMods, MODIFIERS, OP_STEP, operationMult, parseMission, withLanding } from '../../src/expedition/mission.ts';
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
  assert.notDeepEqual(dailyBoard(day, 3).map((o) => o.seed), dailyBoard(day, 4).map((o) => o.seed));
  // an operation: two or three missions with different objectives, shared modifiers; its missions parse back with their place
  for (const op of dailyBoard(day, 8)) {
    assert.ok(op.missions.length >= 2 && op.missions.length <= 3);
    assert.equal(new Set(op.missions.map((m) => m.objective)).size, op.missions.length);
    assert.ok(op.mods.length >= 1 && op.mods.every((m) => MODIFIERS.includes(m)));
    for (const m of op.missions) { assert.deepEqual(parseMission(missionId(m)), m); assert.deepEqual(missionMods(m), op.mods); }
    // a place in an operation is not taken on trust
    const m = op.missions[1];
    assert.equal(parseMission(missionId({ ...m, op: { seed: m.op!.seed, index: 0 } })), null);
    assert.equal(parseMission(missionId({ ...m, seed: m.seed + 1 })), null);
    // the multiplier grows only for missions won in a row
    assert.equal(operationMult(op.missions[0], null), 1);
    assert.equal(operationMult(m, { seed: op.seed, difficulty: 8, next: 0 }), 1);
    assert.ok(operationMult(m, { seed: op.seed, difficulty: 8, next: 1 }) >= 1 + OP_STEP);
  }
  // the catalog serves missions next to the map files
  const maps = new MapCatalog(MAPS);
  assert.ok(maps.has('exp:12345:4:bush:2') && !maps.has('exp:12345:9:bush:2') && maps.has('td'));
  assert.ok(maps.maxBerries('exp:12345:4:bush:2', 2) > 1000);
  assert.equal(maps.load('exp:12345:4:bush:2')!.mode.kind, 'expedition');
});

test('mission room: the server runs an expedition — heroes on the chosen landing, `exp` commands, seeds and loot into the profiles', async () => {
  s = await startServer();
  const h = await hero('Lena'), g = await hero('Gosha');
  const map = 'exp:777:1:beacons:1';
  h.p.send({ t: 'room.create', map: 'exp:777:9:beacons:1', max: 4, password: '' });
  assert.equal((await h.p.next('error')).code, 'bad-map');
  h.p.send({ t: 'room.create', map: 'td', max: 4, password: '' });
  const code = (await h.p.state()).room.code;
  // the ladder: difficulty 2 opens only after a won mission of difficulty 1
  h.p.send({ t: 'room.map', map: 'exp:777:2:beacons:1' });
  assert.equal((await h.p.next('error')).code, 'bad-map');
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
  assert.equal((gp as { expLevel?: number }).expLevel, 2, 'the won mission opened the next difficulty');
  assert.equal(gp.berries, 250 + loot);
  const hp = (await h.p.next('profile.updated')).data as { seeds?: unknown };
  assert.equal(hp.seeds, undefined, 'the host did not board: his seeds are lost');
  await h.p.state((m) => m.room.state === 'lobby');
  // the stored profile with seeds passes validation when the camp saves it again
  const prof = await api(s, 'GET', '/api/profile', undefined, g.token);
  assert.deepEqual(prof.body.data.seeds, { common: 0, rare: 2, golden: 0 });
});

test('operation in a room: a won mission moves the room on to the next one, which pays more; a lost one breaks the streak', async () => {
  s = await startServer();
  const h = await hero('Olya');
  const op = dailyBoard(boardDay(), 1)[0], [first, second] = op.missions.map((m) => missionId(m));
  h.p.send({ t: 'room.create', map: first, max: 4, password: '' });
  await h.p.state((m) => m.room.map === first);
  const win = async (loot: number): Promise<number> => {
    h.p.send({ t: 'room.start' });
    const { matchId } = await h.p.next('battle.start');
    const exp = s.app.games.get(matchId)!.battle.world.expedition!;
    frames(4);
    exp.addLoot(loot);
    const had = exp.lootOf(0);
    exp.state = 'won';
    frames(120);
    await h.p.next('battle.over');
    const paid = ((await api(s, 'GET', '/api/matches', undefined, h.token)).body as { id: string; berries: number }[]).find((x) => x.id === matchId)!.berries;
    return paid / had;
  };
  assert.equal(await win(100), 1, 'the first mission pays as is');
  assert.equal((await h.p.state((m) => m.room.state === 'lobby')).room.map, second, 'the room moved on to the next mission');
  assert.ok(Math.abs((await win(100)) - operationMult(op.missions[1], { seed: op.seed, difficulty: 1, next: 1 })) < 0.02, 'the second one pays more');
  await h.p.state((m) => m.room.state === 'lobby');
  // picked out of order, a later mission pays as is
  h.p.send({ t: 'room.map', map: second });
  await h.p.state((m) => m.room.map === second);
  assert.equal(await win(100), 1);
});
