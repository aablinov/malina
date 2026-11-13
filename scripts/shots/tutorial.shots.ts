import { test, type Page } from '@playwright/test';
import { startGameServer, type GameServer } from '../../tests/game-server.ts';
import { openBattle, openCamp, shoot, type Lang, type Mark } from './lib.ts';

/**
 * The pictures of the tutorial cards (src/tutorial/cards.ts): one scene per card, the rings in the order of the card's `marks`.
 * `make shots` — both languages into public/tutorial/<lang>/; the server it needs is its own (tests/game-server.ts).
 */
let server: GameServer;
test.beforeAll(async () => { server = await startGameServer(); });
test.afterAll(() => server?.stop());

const lang = (): Lang => test.info().project.name as Lang;
/** Run a scene in the page: it sets the game up and returns the rings of the world it wants */
const scene = <T>(page: Page, f: () => T): Promise<T> => page.evaluate(f);

// ---------- Bush Defence ----------
test('td: the first battle — move, build, waves, raspberries, sutler, abilities, level', async ({ page }) => {
  const L = lang();
  await openBattle(page, server, L, 'map=td&seed=7');

  // the hero between his spawn and the bush
  let marks: Mark[] = await scene(page, () => {
    const m = (window as any).__malina, td = m.td, at = (window as any).__at, b = td.bush.pos;
    m.hero.place(b.x + 5, b.z + 5, -2.4);
    m.setCam(24); m.setCamTarget(b.x + 2.5, b.z + 2.5);
    m.step(0.3); m.render();
    return [at(m.hero.pos, 34, 0.9), at(b, 46, 1.2)];
  });
  await shoot(page, L, 'td.move', [...marks, '.hud-heart'], { full: true });

  // a pad with its menu open
  marks = await scene(page, () => {
    const m = (window as any).__malina, td = m.td, at = (window as any).__at, b = td.bush.pos;
    const pad = [...td.pads].sort((p: any, q: any) => Math.hypot(p.pos.x - b.x, p.pos.z - b.z) - Math.hypot(q.pos.x - b.x, q.pos.z - b.z))[0];
    m.hero.place(pad.pos.x + 1, pad.pos.z + 1, -2.4);
    m.setCam(22); m.setCamTarget(pad.pos.x, pad.pos.z);
    m.step(0.3); m.render();
    return [at(pad.pos, 46, 0.2)];
  });
  await shoot(page, L, 'td.build', [...marks, '#pgPrompt', '.hud-berries'], { minW: 720 });

  // the wave panel: a tower built, the second wave ahead
  await scene(page, () => {
    const m = (window as any).__malina, td = m.td;
    td.build(td.nearPad(m.hero.pos) ?? td.pads[0], 'arrow');
    td.wave = 2; td.next = 14;
    m.step(2.5); td.next = 14; m.step(0.1); m.render();
  });
  await shoot(page, L, 'td.wave', [['.td-wave', '.td-next'], '.td-preview', ['.td-bush', '.td-bush-t']], { minW: 560 });

  // raspberries lying out of the magnet's reach
  marks = await scene(page, () => {
    const m = (window as any).__malina, td = m.td, at = (window as any).__at, V = m.hero.pos.constructor, b = td.bush.pos;
    // raspberries lie only while a wave runs: once it is beaten they all fly to the hero
    td.callWave();
    m.hero.place(b.x + 5, b.z + 5, -0.8);
    const h = m.hero.pos, spots = [[8, -8], [9.3, -7], [7.2, -9.4]];
    m.setCam(19); m.setCamTarget(h.x + 4.5, h.z - 4.5);
    for (const [dx, dz] of spots) m.world.piles.drop(new V(h.x + dx, h.y, h.z + dz), 6);
    m.step(3.2); m.render();
    // ring them where they landed
    const ps = m.world.piles.list.map((p: any) => at(p.pos ?? p, 0, 0.3)), cx = ps.reduce((a: number, p: any) => a + p.x, 0) / ps.length, cy = ps.reduce((a: number, p: any) => a + p.y, 0) / ps.length;
    return [{ x: cx, y: cy, r: Math.max(44, ...ps.map((p: any) => Math.hypot(p.x - cx, p.y - cy) + 26)) }];
  });
  await shoot(page, L, 'td.berries', [...marks, '.hud-berries', '.td-loot'], { full: true });

  // the sutler and his F line
  marks = await scene(page, () => {
    const m = (window as any).__malina, at = (window as any).__at, s = m.merchants.find((x: any) => x.kind === 'sutler');
    for (const x of m.td.pack.mobs) if (!x.dead) x.vanish();
    m.step(4);
    m.hero.place(s.front.x, s.front.z, Math.PI, s.front.y);
    m.setCam(18); m.setCamTarget(s.pos.x, s.pos.z);
    m.step(0.4); m.render();
    return [at(s.pos, 44, 1)];
  });
  await shoot(page, L, 'td.sutler', [...marks, '#pgPrompt'], { minW: 620 });

  // the bottom bar
  await scene(page, () => { const m = (window as any).__malina, b = m.td.bush.pos; m.hero.place(b.x + 5, b.z + 5, -2.4); m.setCamTarget(); m.setCam(22); m.step(0.2); m.render(); });
  await shoot(page, L, 'td.skills', [['[data-act="art0"]', '[data-act="art1"]', '[data-act="art2"]'], '[data-act="potion"]', '[data-act="spec"]', '[data-act="aura"]'], { minW: 620 });
  await shoot(page, L, 'td.level', ['.hud-xp'], { minW: 600, include: ['.hud-heart'] });
});

test('td: trouble — the mini-boss, tower hunters, ruins, the fallen hero, lava', async ({ page }) => {
  const L = lang();
  await openBattle(page, server, L, 'map=td&seed=7');

  // the chief walks up to a tower
  let marks: Mark[] = await scene(page, () => {
    const m = (window as any).__malina, td = m.td, V = m.hero.pos.constructor, b = td.bush.pos;
    m.profile.data.berries = 2000;
    const pads = [...td.pads].sort((p: any, q: any) => Math.hypot(p.pos.x - b.x, p.pos.z - b.z) - Math.hypot(q.pos.x - b.x, q.pos.z - b.z));
    td.build(pads[0], 'arrow');
    const p = pads[0].pos;
    m.hero.place(p.x + 3, p.z + 3, -2.4);
    td.spawn('chief_brute', new V(p.x - 4, 0, p.z - 4));
    td.spawn('gardener', new V(p.x - 6, 0, p.z - 3));
    td.spawn('gardener', new V(p.x - 3.5, 0, p.z - 6.5));
    m.setCam(17); m.setCamTarget(p.x - 2, p.z - 2);
    m.step(1.2); m.render();
    const boss = td.pack.mobs.find((x: any) => x.kind === 'chief_brute' || x.def?.id === 'chief_brute') ?? td.pack.mobs[0];
    return [(window as any).__at(boss.pos, 58, 1.4)];
  });
  await shoot(page, L, 'td.chief', marks, { full: true });

  // a far tower is being gnawed: the alarm line and the minimap
  await scene(page, () => {
    const m = (window as any).__malina, td = m.td, b = td.bush.pos;
    for (const x of td.pack.mobs) if (!x.dead) x.vanish();
    m.hero.place(b.x + 4, b.z + 4, -2.4);
    m.setCamTarget(); m.setCam(22);
    const pad = td.pads.filter((p: any) => !td.towers.some((t: any) => t.pad === td.pads.indexOf(p))).sort((p: any, q: any) => Math.hypot(q.pos.x - b.x, q.pos.z - b.z) - Math.hypot(p.pos.x - b.x, p.pos.z - b.z))[0];
    const t = td.build(pad, 'arrow');
    (window as any).__far = t;
    t.hurt(10);
    m.step(0.3); m.render();
  });
  await shoot(page, L, 'td.hunters', ['.td-alarm', '.hud-minibox'], { full: true });

  // the same tower in ruins, the hero next to it
  marks = await scene(page, () => {
    const m = (window as any).__malina, at = (window as any).__at, t = (window as any).__far;
    t.hurt(1e6);
    m.hero.place(t.pos.x + 1.6, t.pos.z - 1.6, 2.4);
    m.setCam(18); m.setCamTarget(t.pos.x, t.pos.z);
    m.step(0.4); m.render();
    return [at(t.pos, 50, 0.9)];
  });
  await shoot(page, L, 'td.repair', marks, { minW: 620 });

  // the hero is down
  await scene(page, () => {
    const m = (window as any).__malina, td = m.td, b = td.bush.pos;
    m.hero.place(b.x + 5, b.z + 5, -2.4);
    m.setCamTarget(); m.setCam(18);
    m.hero.hurt(1e6);
    m.step(0.7); m.render();
  });
  await shoot(page, L, 'td.down', [], { full: true });

  // the hero in the lava
  await scene(page, () => {
    const m = (window as any).__malina, lv = m.level, h = m.hero;
    m.step(3);
    let best: [number, number, number] | null = null, bd = Infinity;
    for (let x = -60; x <= 60; x++) for (let z = -60; z <= 60; z++) for (let y = -4; y <= 6; y++) {
      if (lv.nameAt(x, y, z) !== 'lava' || lv.nameAt(x, y + 1, z) === 'lava') continue;
      // a cell with lava all around, the nearest to the hero
      if (lv.nameAt(x + 1, y, z) !== 'lava' || lv.nameAt(x - 1, y, z) !== 'lava' || lv.nameAt(x, y, z + 1) !== 'lava') continue;
      const d = Math.hypot(x - h.pos.x, z - h.pos.z);
      if (d < bd) { bd = d; best = [x, y, z]; }
    }
    if (!best) throw new Error('no lava on the map');
    h.place(best[0], best[2], -2.4, best[1] + 1);
    m.setCam(18);
    m.step(0.5); m.render();
  });
  await shoot(page, L, 'td.lava', [], { full: true });
});

test('td: the castle walls and the lanterns of the misty clearing', async ({ page }) => {
  const L = lang();
  await openBattle(page, server, L, 'map=td3&seed=7');
  let marks: Mark[] = await scene(page, () => {
    const m = (window as any).__malina, td = m.td, at = (window as any).__at, w = td.walls[0];
    m.hero.place(w.pos.x + 2.2, w.pos.z + 2.2, -2.4);
    m.setCam(20); m.setCamTarget(w.pos.x, w.pos.z);
    w.hurt?.(w.maxHp * 0.45);
    m.step(0.4); m.render();
    return [at(w.pos, 50, 1)];
  });
  await shoot(page, L, 'td.walls', ['.td-walls', ...marks], { full: true });

  await page.goto('about:blank');
  await openBattle(page, server, L, 'map=td5&seed=7');
  marks = await scene(page, () => {
    const m = (window as any).__malina, at = (window as any).__at, l = m.sim.fog.lanterns[0];
    m.hero.place(l.x + 1.2, l.z + 1.2, -2.4);
    m.setCam(17); m.setCamTarget(l.x, l.z);
    m.step(0.4); m.render();
    return [at({ x: l.x, y: m.hero.pos.y, z: l.z }, 46, 1.7)];
  });
  await shoot(page, L, 'td.lanterns', marks, { minW: 680, include: ['#pgPrompt'] });
});

// ---------- expeditions ----------
test('expedition: the objective, parcels, alarm, totems, seeds, the horn-blower, dusk, the balloon', async ({ page }) => {
  const L = lang();
  await openBattle(page, server, L, 'map=expedition&seed=3&obj=lairs&d=1');
  await scene(page, () => { const m = (window as any).__malina; m.setCam(22); m.step(0.4); m.render(); });
  await shoot(page, L, 'exp.goal', ['.hud-goal', '.exp-arrow', '.hud-minibox'], { full: true });

  // a parcel tower has landed, its slot rests
  let marks: Mark[] = await scene(page, () => {
    const m = (window as any).__malina, s = m.exp.sim, h = m.hero.pos;
    s.command(0, { t: 'exp', a: 'parcel', slot: 0, x: h.x - 3.5, z: h.z - 2 });
    m.step(4); m.render();
    return [];
  });
  await shoot(page, L, 'exp.parcels', ['.exp-parcels', ...marks], { minW: 640 });

  await scene(page, () => {
    const m = (window as any).__malina, s = m.exp.sim;
    while (s.alarmLevel < 2) s.alarm += 1;
    const bag = s.carriedOf(0); bag.common = 3; bag.rare = 1; bag.golden = 1;
    m.step(0.2); m.render();
  });
  await shoot(page, L, 'exp.alarm', [{ sel: '.exp-alarm', side: 'right' }], { minW: 560 });
  await shoot(page, L, 'exp.totems', ['.exp-totems'], { minW: 560 });
  await shoot(page, L, 'exp.seeds', ['.exp-seeds'], { minW: 560 });

  // the first of a patrol carries the horn
  marks = await scene(page, () => {
    const m = (window as any).__malina, s = m.exp.sim, at = (window as any).__at;
    const g = s.garrisons.rooms.find((r: any) => r.spec.id.startsWith('patrol') && r.mobs[0] && !r.mobs[0].dead), mob = g.mobs[0];
    m.hero.place(mob.pos.x + 5, mob.pos.z + 5, -2.4);
    m.setCam(17); m.setCamTarget(mob.pos.x + 1.5, mob.pos.z + 1.5);
    m.step(1.2); m.render();
    return [at(mob.pos, 44, 1)];
  });
  await shoot(page, L, 'exp.horn', marks, { full: true });

  // the objective is done: the arrow leads to the pad
  marks = await scene(page, () => {
    const m = (window as any).__malina, s = m.exp.sim, at = (window as any).__at, p = s.extraction.pos;
    for (const r of s.garrisons.rooms) for (const x of r.mobs) if (!x.dead) x.vanish?.();
    s.primary = true;
    m.hero.place(p.x + 7, p.z + 7, -2.4);
    m.setCam(22); m.setCamTarget(p.x + 3, p.z + 3);
    m.step(0.4); m.render();
    return [at(p, 60, 0.3)];
  });
  await shoot(page, L, 'exp.balloon', ['.exp-arrow', ...marks], { full: true });

  await scene(page, () => {
    const m = (window as any).__malina, s = m.exp.sim;
    s.dusk = true; m.setNight(true);
    m.step(0.4); m.render();
  });
  await shoot(page, L, 'exp.dusk', [], { full: true });
});

// ---------- camp ----------
test('camp: gear, all items, maps, expeditions', async ({ page }) => {
  const L = lang();
  await openCamp(page, server, L, L === 'ru' ? 'Одиночная игра' : 'Solo game');
  await page.waitForTimeout(1500);
  await shoot(page, L, 'camp.gear', ['.mm-tabs', '.mm-group', '.mm-cur', '[data-act="start"]'], { full: true });

  await page.locator('[data-pane="map"]').click();
  await page.waitForTimeout(400);
  await shoot(page, L, 'camp.map', ['.mm-maps', '.mm-card.map'], { full: true });

  await page.locator('[data-pane="missions"]').click();
  await page.evaluate(() => { const m = (window as any).__menu; m.profile.data.seeds = { common: 6, rare: 2, golden: 0 }; m.profile.save(); m.lobby.render(); });
  await page.locator('.mm-maps .mm-map').first().click();
  await page.waitForTimeout(600);
  await shoot(page, L, 'camp.exp', ['.mm-exp-diff', '.mm-maps', '.mm-exp-map', ['.mm-pane-title:has(+ .mm-parcels)', '.mm-parcels:has([data-bed])']], { full: true });

  await page.locator('[data-pane="gear"]').click();
  await page.evaluate(() => (window as any).__menu.lobby.openInventory());
  await page.waitForTimeout(900);
  await shoot(page, L, 'camp.items', ['.inv-grid', '.inv-detail', '[data-act="salvage"]'], { full: true });
});

test('camp: rooms of the online game', async ({ page }) => {
  const L = lang();
  await openCamp(page, server, L, L === 'ru' ? 'Сетевая игра' : 'Online game');
  await page.waitForTimeout(2500);
  await shoot(page, L, 'camp.rooms', ['[data-act="host"]', ['.mm-pane-title', '.mm-pane .mm-online-empty', '.mm-browser'], ['.mm-join:has([data-act="friend-add"])', '.mm-online > .mm-online-empty', '.mm-online > .mm-rooms']], { full: true });
});
