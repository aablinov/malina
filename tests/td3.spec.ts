import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Осада замка — оборона куста 3 (wiki/design-tower-defence.md, раздел 9): карта `td3` со стенами и воротами (src/td/wall.ts),
 * площадки на бастионах, лестницы на стены, пролом и починка; новые враги — пнёвый подрывник и лозовая баллиста
 * (src/mobs/td-foes.ts), новые башни — стенная баллиста и котёл со смолой (src/td/tower.ts).
 */

const URL = pathToFileURL(resolve('dist/index.html')).href + '?dev=playground&map=td3';

async function open(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  await page.evaluate(async () => { const m = (window as any).__malina; m.script(true); await m.ready; });
  expect(errors).toEqual([]);
}

test('осада: замок — стены, бастионы с площадками, лестницы; подрывники ломают стену, враги идут в пролом, стена чинится за малину', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td, L = m.level, t = m.terrain, V = m.hero.pos.constructor;
    const spec = td.spec;
    m.hero.place(0, 6, 0, 0); m.hero.god = true;
    // дорожка по стене на высоте 3 — свободна от угла до угла
    let bad = 0;
    for (let i = -16; i <= 16; i++) if (t.floorAt(i, -18, 3.5) !== 3 || t.floorAt(i, 18, 3.5) !== 3 || t.floorAt(18, i, 3.5) !== 3 || t.floorAt(-18, i, 3.5) !== 3) bad++;
    // луг: пол везде не ниже земли — нет ям, в которые проваливается герой (растения только поверх травы)
    let pits = 0;
    for (let x = -47; x <= 47; x += 1) for (let z = -47; z <= 47; z += 1) { const f = t.floorAt(x, z, 0.4); if (f < -0.5 || (f === -Infinity)) pits++; }
    // лестница: герой со двора кликом поднимается на стену
    m.hero.place(-14, -14, 0, 0);
    m.click(-10, -18, false, 3);
    for (let i = 0; i < 100; i++) m.step(0.1);
    const climbed = [Math.round(m.hero.pos.x), Math.round(m.hero.pos.y), Math.round(m.hero.pos.z)];
    const padUp = td.nearPad(new V(-19, 3, -19))?.index ?? null, padDown = td.nearPad(new V(-19, 0, -19));
    // три подрывника с востока: стена проломлена, блоки — в воздух
    m.hero.place(0, 6, 0, 0);
    const east = td.wall('east');
    const hp0 = east.hp;
    const s = [0, 1, 2].map(() => td.spawnOn('sapper', 'east'));
    let breachAt = -1;
    for (let i = 0; i < 700; i++) { m.step(0.1); if (east.dead) { breachAt = i / 10; break; } }
    const ignored = s.every((x: any) => x.blasted);
    const hole = [L.nameAt(19, 1, 0), L.nameAt(18, 0, 0), L.nameAt(17, 2, 0)];
    const banner = document.body.innerText.includes('проломлена');
    // гонец по восточной дороге идёт в пролом и бьёт куст
    const run = td.spawnOn('runner', 'east');
    const marchLen = run.march.length;
    for (let i = 0; i < 300; i++) { m.step(0.1); if (td.bush.taken > 0) break; }
    const bushTaken = td.bush.taken;
    run.vanish();
    // починка: герой у стены, F — за малину блоки на месте
    m.hero.place(16, 0, 0, 0);
    const nw = td.nearWall(m.hero.pos);
    const cost = nw ? td.repairCost(nw) : 0, prompt = nw ? td.wallPrompt(nw) : '';
    const b0 = m.berries;
    const ok = td.repair(nw);
    const spent = b0 - m.berries;
    const fixed = [east.hp, east.dead, L.nameAt(19, 1, 0), L.nameAt(18, 0, 0)];
    const walkAfter = t.floorAt(18, 0, 3.5);
    m.resetTargets();
    return {
      name: L.name, pads: td.pads.length, high: td.pads.filter((p: any) => p.pos.y === 3).length, lanes: spec.lanes.map((l: any) => l.wall), kinds: td.kinds, walls: td.walls.map((w: any) => [w.id, w.kind, w.maxHp]),
      bad, pits, climbed, padUp, padDown, hp0, breachAt, ignored, hole, banner, marchLen, bushTaken, nwId: nw?.id, cost, prompt, spent, ok, fixed, walkAfter,
      hud: document.querySelector('.td-walls')?.children.length,
      mist: m.mistFx?.count ?? 0, fogFar: L.meta.world.fog.far,
    };
  });
  expect(r.name).toBe('Замок на лугу');
  expect(r.pads).toBe(16);
  expect(r.high).toBe(12);
  expect(r.lanes).toEqual(['gate', 'east', 'south', 'west']);
  expect(r.kinds).toEqual(['arrow', 'frost', 'splash', 'fire', 'magic', 'ballista', 'oil']);
  expect(r.walls).toEqual([['gate', 'gate', 250], ['east', 'wall', 400], ['south', 'wall', 400], ['west', 'wall', 400]]);
  expect(r.bad).toBe(0);
  expect(r.pits).toBe(0);
  expect(r.climbed).toEqual([-10, 3, -18]);
  expect(r.padUp).toBe(0);
  expect(r.padDown).toBeNull();
  expect(r.hp0).toBe(400);
  expect(r.breachAt).toBeGreaterThan(0);
  expect(r.breachAt).toBeLessThan(60);
  expect(r.ignored).toBe(true);
  expect(r.hole).toEqual(['air', 'air', 'air']);
  expect(r.banner).toBe(true);
  expect(r.marchLen).toBe(6);
  expect(r.bushTaken).toBeGreaterThan(0);
  expect(r.nwId).toBe('east');
  expect(r.cost).toBe(80);
  expect(r.prompt).toContain('Отстроить');
  expect(r.ok).toBe(true);
  expect(r.spent).toBe(80);
  expect(r.fixed[0]).toBe(400);
  expect(r.fixed[1]).toBe(false);
  expect(r.fixed[2]).not.toBe('air');
  expect(r.fixed[3]).not.toBe('air');
  expect(r.walkAfter).toBe(3);
  expect(r.hud).toBe(4);
  expect(r.mist).toBeGreaterThan(40);
  expect(r.fogFar).toBeLessThanOrEqual(60);
});

test('осада: ворота расстреливают баллиста и арбалетчик, герой проходит через калитку; броня подрывника и пробивающий болт; смола вяжет и жжёт', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td, V = m.hero.pos.constructor;
    m.hero.place(0, 6, 0, 0); m.hero.god = true;
    // ворота: мобы с севера упираются в створки, баллиста бьёт с 9 м, арбалетчик тоже
    const gate = td.wall('gate');
    const stop = td.spawnOn('runner', 'north');
    for (let i = 0; i < 150; i++) m.step(0.1);
    const stopped = [stop.pos.z < -18.5, stop.alerted, !!stop.focus];
    stop.vanish();
    const b = td.spawnOn('ballista', 'north'), c = td.spawnOn('crossbow', 'north');
    for (let i = 0; i < 400; i++) { m.step(0.1); if (b.shots >= 2 && gate.taken > 0) break; }
    const shooting = { shots: b.shots, taken: gate.taken, dist: Math.hypot(b.pos.x - gate.pos.x, b.pos.z - gate.pos.z), cFocus: !!c.focus };
    let gateAt = -1;
    for (let i = 0; i < 900; i++) { m.step(0.1); if (gate.dead) { gateAt = i / 10; break; } }
    b.vanish(); c.vanish();
    const run = td.spawnOn('runner', 'north');
    const t0 = td.bush.taken;
    for (let i = 0; i < 300; i++) { m.step(0.1); if (td.bush.taken > t0) break; }
    const throughGate = td.bush.taken > t0;
    run.vanish();
    m.hero.place(0, -14, 0, 0); td.repair(gate);
    const gateBack = [gate.hp, gate.dead];
    // герой выходит из замка через ворота кликом наружу
    m.click(0, -24, false, 0);
    for (let i = 0; i < 120; i++) m.step(0.1);
    const heroOut = m.hero.pos.z;
    // подрывник: меч ×0,3, пробивающий болт стенной баллисты — целиком; пал — взорвался и задел своих
    m.hero.place(0, 6, 0, 0);
    const s = td.spawn('sapper', new V(24, 0, -3)); s.march = null;
    m.step(0.6);
    const h0 = s.hp; s.hit(10, new V(1, 0, 0), s.pos.clone(), 0);
    const sword = h0 - s.hp;
    const pad = td.pads[6];
    const bt = td.build(pad, 'ballista');
    for (let i = 0; i < 60; i++) { m.step(0.1); if (bt.shots >= 1) break; }
    const pierce = s.taken - sword;
    const ally = td.spawn('wolf', new V(25, 0, -3)); ally.march = null;
    m.step(0.6);
    const a0 = ally.hp;
    s.vanish();
    const splash = a0 - ally.hp;
    ally.vanish(); td.sell(pad);
    // котёл со смолой: лужа, в ней вязнут и горят
    const oil = td.build(pad, 'oil');
    const w = td.spawn('runner', new V(22, 0, -2)); w.march = null;
    for (let i = 0; i < 60; i++) { m.step(0.1); if (oil.pooling > 0) break; }
    m.step(0.6);
    const tar = { pools: oil.pooling, chill: w.chillT > 0, taken: w.taken, burning: oil.burning };
    w.vanish(); td.sell(pad);
    m.resetTargets();
    return { stopped, shooting, gateAt, throughGate, gateBack, heroOut, sword, pierce, blasted: s.blasted, splash, tar, titles: [s.title, b.title] };
  });
  expect(r.stopped).toEqual([true, true, true]);
  expect(r.shooting.shots).toBeGreaterThanOrEqual(2);
  expect(r.shooting.taken).toBeGreaterThan(0);
  expect(r.shooting.dist).toBeGreaterThan(6);
  expect(r.shooting.cFocus).toBe(true);
  expect(r.gateAt).toBeGreaterThan(0);
  expect(r.throughGate).toBe(true);
  expect(r.gateBack).toEqual([250, false]);
  expect(r.heroOut).toBeLessThan(-21);
  expect(r.sword).toBe(3);
  expect(r.pierce).toBe(45);
  expect(r.blasted).toBe(true);
  expect(r.splash).toBeGreaterThan(0);
  expect(r.tar.pools).toBe(1);
  expect(r.tar.chill).toBe(true);
  expect(r.tar.taken).toBeGreaterThan(0);
  expect(r.tar.burning).toBe(1);
  expect(r.titles).toEqual(['Пнёвый подрывник', 'Лозовая баллиста']);
});
