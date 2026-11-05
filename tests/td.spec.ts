import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Bush Defence (wiki/design-tower-defence.md, src/td/): a map with meta.td gives pads and a treasury; a tower is built for raspberries,
 * hits enemies in range by itself, upgrades and sells; the pad menu opens with keys and by click.
 */

const URL = pathToFileURL(resolve('dist/index.html')).href + '?dev=playground&map=td';

async function open(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  await page.evaluate(async () => { const m = (window as any).__malina; m.script(true); await m.ready; });
  expect(errors).toEqual([]);
}

test('defence: pads from the map, a tower for raspberries hits an enemy, upgrade and sale', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td, V = m.hero.pos.constructor;
    const pad = td.pads[16];
    const b0 = m.berries;
    const none = td.build(pad, 'nope');
    const t = td.build(pad, 'arrow');
    const b1 = m.berries;
    const again = td.build(pad, 'arrow');
    const mob = td.spawn('berryling', new V(pad.pos.x + 4, 0, pad.pos.z));
    m.step(4);
    const dmg1 = t.dmg, range1 = t.range;
    const up = td.upgrade(pad);
    const b2 = m.berries;
    const back = td.sell(pad);
    return {
      pads: td.pads.length, lanes: td.spec.lanes.length, bushHp: td.spec.bush.hp,
      none, built: !!t, again, cost: b0 - b1, shots: t.shots, dealt: t.dealt, mobDead: mob.dead,
      up, upCost: b1 - b2, dmg: [dmg1, t.dmg], range: [range1, t.range], level: t.level,
      back, berries: m.berries, towers: td.towers.length, free: pad.free, solids: m.solids.length,
    };
  });
  expect(r.pads).toBe(17);
  expect(r.lanes).toBe(3);
  expect(r.bushHp).toBeGreaterThan(0);
  expect(r.none).toBeNull();
  expect(r.built).toBe(true);
  expect(r.again).toBeNull();
  expect(r.cost).toBe(60);
  expect(r.shots).toBeGreaterThan(2);
  expect(r.dealt).toBeGreaterThan(10);
  expect(r.mobDead).toBe(true);
  expect(r.up).toBe(true);
  expect(r.upCost).toBe(42);
  expect(r.dmg[1]).toBeGreaterThan(r.dmg[0]);
  expect(r.range[1]).toBeGreaterThan(r.range[0]);
  expect(r.level).toBe(2);
  expect(r.back).toBe(Math.round(102 * 0.7));
  expect(r.berries).toBe(300 - 60 - 42 + r.back);
  expect(r.towers).toBe(0);
  expect(r.free).toBe(true);
});

test('defence: no raspberries — no tower; the pad menu by F and by click, a digit builds', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td;
    m.profile.data.berries = 10;
    const poor = td.build(td.pads[0], 'arrow');
    m.profile.data.berries = 500;
    // F next to a pad — the menu; digit 1 — the archer tower; the menu closed
    const pad = td.pads[15];
    m.hero.place(pad.pos.x + 1.7, pad.pos.z, Math.PI);
    m.interact(); m.step(0.1);
    const open1 = td.menuOpen;
    const key = td.key(new KeyboardEvent('keydown', { code: 'Digit1' }));
    const built = pad.tower?.kind ?? null;
    const closed = !td.menuOpen;
    // a click on a pad from afar: the hero walks to it and opens the menu
    const far = td.pads[14];
    m.hero.place(far.pos.x + 7, far.pos.z, Math.PI);
    m.click(far.pos.x, far.pos.z);
    m.step(0.1);
    m.release();
    let opened = false;
    for (let i = 0; i < 80 && !opened; i++) { m.step(0.1); opened = td.menuOpen && td.menuPad === far; }
    const dist = Math.hypot(m.hero.pos.x - far.pos.x, m.hero.pos.z - far.pos.z);
    // Esc closes
    td.key(new KeyboardEvent('keydown', { code: 'Escape' }));
    return { poor, open1, key, built, closed, opened, dist, esc: !td.menuOpen, hud: document.querySelector('.td-hud')?.textContent ?? '' };
  });
  expect(r.poor).toBeNull();
  expect(r.open1).toBe(true);
  expect(r.key).toBe(true);
  expect(r.built).toBe('arrow');
  expect(r.closed).toBe(true);
  expect(r.opened).toBe(true);
  expect(r.dist).toBeLessThan(2.4);
  expect(r.esc).toBe(true);
  expect(r.hud).toContain('Wave');
});

test('defence: five towers hit in their own way — bolts, rime slows, a rock over an area, flame burns, the orb weakens in a chain', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td, V = m.hero.pos.constructor;
    m.profile.data.berries = 5000;
    m.hero.god = true;
    m.hero.place(26, 14, Math.PI);
    const kinds = ['arrow', 'frost', 'splash', 'fire', 'magic'], pads = [10, 11, 12, 13, 14];
    const towers = kinds.map((k, i) => td.build(td.pads[pads[i]], k));
    const mobs: any[] = [];
    for (const i of pads) { const p = td.pads[i]; for (let j = 0; j < 3; j++) mobs.push(td.spawn('gardener', new V(p.pos.x + 3 + j * 0.9, 0, p.pos.z - 2 + j))); }
    let chilled = 0, exposed = 0, burning = 0;
    for (let i = 0; i < 60; i++) { m.step(0.1); chilled = Math.max(chilled, mobs.filter((x) => x.chillT > 0).length); exposed = Math.max(exposed, mobs.filter((x) => x.exposeT > 0).length); burning = Math.max(burning, towers[3].burning); }
    return { shots: towers.map((t) => t.shots), dealt: towers.map((t) => t.dealt), chilled, exposed, burning, dead: mobs.filter((x) => x.dead).length, titles: towers.map((t) => t.title) };
  });
  for (const s of r.shots) expect(s).toBeGreaterThan(0);
  for (const d of r.dealt) expect(d).toBeGreaterThan(0);
  // the archer tower fires most often, the catapult — least
  expect(r.shots[0]).toBeGreaterThan(r.shots[2]);
  expect(r.chilled).toBeGreaterThan(0);
  expect(r.exposed).toBeGreaterThan(0);
  expect(r.burning).toBeGreaterThan(0);
  expect(r.dead).toBeGreaterThan(5);
  expect(r.titles).toEqual(['Archer tower I', 'Frost spire I', 'Catapult I', 'Fire brazier I', 'Arcane obelisk I']);
});

test('defence: enemies walk the roads to the bush and hit it; a struck one gives chase and returns to the road; the bush withers', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td, V = m.hero.pos.constructor;
    m.hero.place(0, 30, Math.PI); m.hero.god = true;
    const a = td.spawnOn('berryling', 'west'), b = td.spawnOn('gardener', 'north'), w = td.spawnOn('wolf', 'east'), none = td.spawnOn('wolf', 'nope');
    const p0 = a.progress;
    let reached = -1, maxProgress = 0;
    for (let i = 0; i < 400; i++) { m.step(0.1); maxProgress = Math.max(maxProgress, a.progress); if (td.bush.taken > 0 && reached < 0) reached = i; }
    const r1 = { none, p0, maxProgress, reached, taken: td.bush.taken, alerted: [a.alerted, b.alerted, w.alerted], focus: [!!a.focus, !!b.focus, !!w.focus], near: [a, b, w].map((x: any) => Math.hypot(x.pos.x, x.pos.z) < 4), hud: document.querySelector('.td-hud')?.textContent ?? '' };
    // the leash: struck by the sword it gives chase, the hero ran away — marching again
    td.pack.clear();
    const c = td.spawnOn('gardener', 'west');
    for (let i = 0; i < 30; i++) m.step(0.1);
    m.hero.place(c.pos.x + 1.5, c.pos.z, -Math.PI / 2);
    c.hit(5, new V(1, 0, 0), c.pos.clone(), 1);
    const al1 = c.alerted;
    m.hero.place(c.pos.x + 25, c.pos.z, 0);
    for (let i = 0; i < 20; i++) m.step(0.1);
    const al2 = c.alerted, walking = c.state === 'walk';
    // a tower hits a marching one from afar — it is not distracted
    td.pack.clear();
    m.profile.data.berries = 500;
    td.build(td.pads[1], 'arrow');
    const d = td.spawnOn('gardener', 'west');
    let hitYetMarching = false;
    for (let i = 0; i < 150; i++) { m.step(0.1); if (d.taken > 0 && !d.alerted) hitYetMarching = true; }
    // the bush withers
    td.pack.clear();
    td.bush.hp = 3;
    const e = td.spawnOn('berryling', 'east');
    for (let i = 0; i < 400 && td.state === 'play'; i++) m.step(0.1);
    const lost = td.state, dead = td.bush.dead, banner = document.body.textContent?.includes('The bush withered');
    m.resetTargets();
    return { r1, al1, al2, walking, hitYetMarching, lost, dead, banner, after: [td.state, td.bush.hp, td.towers.length, td.pack.mobs.length], e: !!e };
  });
  expect(r.r1.none).toBeNull();
  expect(r.r1.p0).toBeLessThan(0.05);
  expect(r.r1.maxProgress).toBe(1);
  expect(r.r1.reached).toBeGreaterThan(0);
  expect(r.r1.taken).toBeGreaterThan(20);
  expect(r.r1.alerted).toEqual([true, true, true]);
  expect(r.r1.focus).toEqual([true, true, true]);
  expect(r.r1.near).toEqual([true, true, true]);
  expect(r.r1.hud).toContain('raspberry bush');
  expect(r.al1).toBe(true);
  expect(r.al2).toBe(false);
  expect(r.walking).toBe(true);
  expect(r.hitYetMarching).toBe(true);
  expect(r.lost).toBe('lost');
  expect(r.dead).toBe(true);
  expect(r.banner).toBe(true);
  expect(r.after).toEqual(['play', 400, 0, 0]);
});

test('defence: the courier is fast, the ram takes hits from the front, the moth flies; waves by G with a bonus, a reward for a beaten one, victory', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td, V = m.hero.pos.constructor;
    m.hero.place(0, 30, Math.PI); m.hero.god = true;
    const ru = td.spawnOn('runner', 'west'), ra = td.spawnOn('ram', 'north'), mo = td.spawnOn('moth', 'east');
    const x0 = ru.pos.x;
    m.step(2);
    const runDist = ru.pos.x - x0;
    // the ram walks south (+z): a hit against its gaze — dir from the hero to the mob looks toward −z
    ra.hit(10, new V(0, 0, -1), ra.pos.clone(), 0);
    const front = ra.taken;
    ra.hit(10, new V(0, 0, 1), ra.pos.clone(), 0);
    const back = ra.taken - front;
    const r1 = { runDist, front, back, mothY: mo.pos.y, ghost: mo.ghost, titles: [ru.title, ra.title, mo.title], speeds: [ru.speed, ra.speed, mo.speed] };
    td.pack.clear();
    // a wave ahead of time: a bonus for the waiting; groups come out along the roads; beaten — a reward, rest
    const b0 = m.berries, next0 = td.next, waves = td.waves.length;
    const called = td.callWave();
    const bonus = m.berries - b0;
    let maxAlive = 0;
    for (let i = 0; i < 300 && td.waveRunning; i++) { m.step(0.1); maxAlive = Math.max(maxAlive, td.pack.mobs.filter((x: any) => !x.dead).length); if (td.spawned >= 6) for (const x of td.pack.mobs) if (!x.dead) x.vanish(); }
    m.step(0.2);
    const afterFirst = { wave: td.wave, spawned: td.spawned, fallen: td.fallen, running: td.waveRunning, berries: m.berries, resting: td.next < next0 && td.next > 0, hud: document.querySelector('.td-hud')?.textContent ?? '' };
    // the remaining waves: everyone into the ground at once — until victory
    for (let w = 0; w < waves + 1 && td.state === 'play'; w++) {
      td.callWave();
      for (let i = 0; i < 600 && td.waveRunning; i++) { m.step(0.1); for (const x of td.pack.mobs) if (!x.dead && x.state !== 'spawn') x.vanish(); }
      m.step(0.2);
    }
    const won = { state: td.state, wave: td.wave, banner: document.body.textContent?.includes('The bush is saved'), again: td.callWave() };
    m.resetTargets();
    return { r1, called, bonus, waves, afterFirst, won, reset: [td.wave, td.state, td.next] };
  });
  expect(r.r1.runDist).toBeGreaterThan(5);
  expect(r.r1.front).toBeCloseTo(3.5, 1);
  expect(r.r1.back).toBeCloseTo(10, 1);
  expect(r.r1.mothY).toBeGreaterThan(0.8);
  expect(r.r1.ghost).toBe(true);
  expect(r.r1.titles).toEqual(['Berry Courier', 'Vine Battering Ram', 'Pollen Moth']);
  expect(r.r1.speeds[0]).toBeGreaterThan(r.r1.speeds[2]);
  expect(r.r1.speeds[2]).toBeGreaterThan(r.r1.speeds[1]);
  expect(r.called).toBe(true);
  expect(r.bonus).toBeGreaterThan(10);
  expect(r.waves).toBe(10);
  expect(r.afterFirst.wave).toBe(1);
  expect(r.afterFirst.spawned).toBeGreaterThanOrEqual(6);
  expect(r.afterFirst.running).toBe(false);
  expect(r.afterFirst.berries).toBe(300 + r.bonus + 50);
  expect(r.afterFirst.resting).toBe(true);
  expect(r.afterFirst.hud).toContain('Wave 1 of 10');
  expect(r.won.state).toBe('won');
  expect(r.won.wave).toBe(10);
  expect(r.won.banner).toBe(true);
  expect(r.won.again).toBe(false);
  expect(r.reset).toEqual([0, 'play', 20]);
});

test('defence: scale — with the waves the pack level is 1, 4, 7…; more players — more enemies, health and reward', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td;
    m.script(true);
    const run = (players: number) => {
      m.resetTargets();
      m.bossScale('hero', players);
      const b0 = m.berries;
      td.callWave();
      let maxHp = 0, level = 0;
      for (let i = 0; i < 600 && td.waveRunning; i++) {
        m.step(0.1);
        for (const x of td.pack.mobs) { maxHp = Math.max(maxHp, x.maxHp); level = x.scale?.level ?? level; }
        if (!td.queue.length) for (const x of td.pack.mobs) if (!x.dead && x.state !== 'spawn') x.vanish();
      }
      m.step(0.2);
      return { players: td.players, spawned: td.spawned, maxHp, level, bounty: m.berries - b0 - 0, hud: document.querySelector('.td-hud')?.textContent ?? '' };
    };
    const solo = run(1), trio = run(3);
    // the second wave with three: pack level 4
    td.callWave();
    for (let i = 0; i < 30; i++) m.step(0.1);
    const lvl2 = td.pack.mobs.map((x: any) => x.scale?.level ?? 0);
    m.bossScale('hero', 1);
    m.resetTargets();
    return { solo, trio, lvl2 };
  });
  expect(r.solo.players).toBe(1);
  expect(r.solo.spawned).toBe(13);
  expect(r.solo.level).toBe(1);
  expect(r.trio.players).toBe(3);
  expect(r.trio.spawned).toBe(26);
  expect(r.trio.maxHp).toBe(r.solo.maxHp * 2);
  expect(r.trio.hud).toContain('players 3');
  expect(r.solo.hud).not.toContain('players');
  // reward = the early-call bonus (the same: the same pause) + bounty × 2
  expect(r.trio.bounty - r.solo.bounty).toBe(50);
  expect(r.lvl2.length).toBeGreaterThan(0);
  expect(r.lvl2.every((l: number) => l === 4)).toBe(true);
});

test('defence: lairs on the roads stir before a wave and flare when an enemy comes out', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td;
    m.hero.place(0, 30, Math.PI); m.hero.god = true;
    const lairs = td.lairs.map((l: any) => l.lane.id);
    const next = td.nextLanes.map((l: any) => l.id);
    // 6 s before a wave only the lair of its road stirs
    const warn0 = td.lairs.map((l: any) => l.warn);
    td.next = 2;
    m.step(1.5);
    const warn1 = td.lairs.map((l: any) => +l.warn.toFixed(2));
    const hud = document.querySelector('.td-hud')?.textContent ?? '';
    td.callWave();
    m.step(3);
    const bursts = td.lairs.map((l: any) => l.spawned);
    for (const x of td.pack.mobs) x.vanish();
    m.resetTargets();
    return { lairs, next, warn0, warn1, hud, bursts, after: td.lairs.map((l: any) => l.spawned) };
  });
  expect(r.lairs).toEqual(['west', 'north', 'east']);
  expect(r.next).toEqual(['west']);
  expect(r.warn0).toEqual([0, 0, 0]);
  expect(r.warn1[0]).toBeGreaterThan(0.5);
  expect(r.warn1[1]).toBe(0);
  expect(r.hud).toContain('west path');
  expect(r.bursts[0]).toBeGreaterThan(1);
  expect(r.bursts[1]).toBe(0);
  expect(r.after).toEqual([0, 0, 0]);
});

test('defence: the lava map — lava in the rifts burns the hero, bridges over it on the roads, the roads are walkable, haze over the lava', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td, L = m.level, V = m.hero.pos.constructor;
    let lava = 0, bridges = 0, fences = 0, volcanoFire = 0;
    L.forEach((_x: number, _y: number, _z: number, id: number) => { const n = L.palette[id]; if (n === 'lava') lava++; else if (n === 'bridge_deck') bridges++; else if (n === 'fence' || n === 'bridge_post') fences++; else if (n === 'fire') volcanoFire++; });
    // the roads are walkable from the lair to the bush point by point
    const bad: unknown[] = [];
    for (const lane of td.spec.lanes) for (let i = 0; i + 1 < lane.points.length; i++) {
      const [ax, az] = lane.points[i], [bx, bz] = lane.points[i + 1];
      m.hero.place(ax, az, 0); m.step(0.1);
      const path = m.pathfinder.find(new V(ax, m.hero.pos.y, az), new V(bx, 0, bz), { solids: m.solids });
      const end = path[path.length - 1], d = end ? Math.hypot(end.x - bx, end.z - bz) : 99;
      if (d > 1.5) bad.push([lane.id, i, d]);
    }
    // the pads and the bush — on level ground, not in lava
    const spots = [...td.spec.pads, td.spec.bush].map((p: any) => L.nameAt(p.x, -1, p.z));
    // the hero burns in lava, on the shore — not
    let cell: [number, number] | null = null;
    L.forEach((x: number, y: number, z: number, id: number) => { if (!cell && y === -1 && L.palette[id] === 'lava' && L.nameAt(x + 1, -1, z) === 'lava' && L.nameAt(x - 1, -1, z) === 'lava') cell = [x, z]; });
    m.hero.god = false; m.hero.hp = m.hero.maxHp;
    m.hero.place(cell![0], cell![1], 0);
    m.step(1.5);
    const burnt = m.hero.maxHp - m.hero.hp, inLavaY = m.hero.pos.y;
    m.hero.hp = m.hero.maxHp;
    m.hero.place(0, 7, 0); m.step(1.5);
    const safe = m.hero.maxHp - m.hero.hp;
    const world = L.meta.world;
    return { lava, bridges, fences, volcanoFire, bad, spots, burnt, inLavaY, safe, weather: world.weather.kind, fog: world.fog.color, haze: m.lavaFx?.cells?.length ?? -1 };
  });
  expect(r.lava).toBeGreaterThan(300);
  expect(r.bridges).toBeGreaterThan(8);
  expect(r.fences).toBeGreaterThan(20);
  expect(r.volcanoFire).toBeGreaterThan(5);
  expect(r.bad).toEqual([]);
  for (const s of r.spots) expect(['stone', 'tiles', 'tiles_broken', 'basalt']).toContain(s);
  expect(r.burnt).toBeGreaterThan(10);
  expect(r.inLavaY).toBeLessThan(0);
  expect(r.safe).toBe(0);
  expect(r.weather).toBe('embers');
  expect(r.fog).toBe('#3a1c14');
  // the haze counts lava open from above (in the craters there is fire over it)
  expect(r.haze).toBeGreaterThan(r.lava * 0.9);
  expect(r.haze).toBeLessThanOrEqual(r.lava);
});

test('defence: the slime and the vine do not walk by themselves, but reach the bush along the road; the slime halves go on along the same road', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td, V = m.hero.pos.constructor;
    m.hero.place(0, 30, Math.PI); m.hero.god = true;
    const s = td.spawnOn('slime', 'north'), v = td.spawnOn('vine', 'west');
    const p0 = [s.progress, v.progress];
    for (let i = 0; i < 300; i++) m.step(0.1);
    const p1 = [s.progress, v.progress];
    for (let i = 0; i < 400; i++) m.step(0.1);
    const p2 = [s.progress, v.progress];
    // the slime is killed halfway — the halves are on the march, not standing
    td.pack.clear();
    const b = td.spawnOn('slime', 'east');
    for (let i = 0; i < 100; i++) m.step(0.1);
    const pb = b.progress;
    b.hit(999, new V(0, 0, 0), b.pos.clone(), 0);
    for (let i = 0; i < 10; i++) m.step(0.1);
    const kids = td.pack.mobs.filter((x: any) => x !== b && !x.dead);
    const k0 = kids.map((x: any) => x.progress);
    for (let i = 0; i < 100; i++) m.step(0.1);
    const k1 = kids.map((x: any) => x.progress);
    return { p0, p1, p2, pb, lanes: kids.map((x: any) => x.laneId), k0, k1 };
  });
  expect(r.p0[0]).toBeLessThan(0.1);
  expect(r.p1[0]).toBeGreaterThan(r.p0[0] + 0.3);
  expect(r.p1[1]).toBeGreaterThan(r.p0[1] + 0.2);
  expect(r.p2).toEqual([1, 1]);
  expect(r.pb).toBeGreaterThan(0.1);
  expect(r.lanes).toEqual(['east', 'east']);
  for (let i = 0; i < 2; i++) { expect(r.k0[i]).toBeGreaterThanOrEqual(r.pb - 0.05); expect(r.k1[i]).toBeGreaterThan(r.k0[i] + 0.1); }
});
