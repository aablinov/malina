import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Оборона куста (wiki/design-tower-defence.md, src/td/): карта с meta.td даёт площадки и казну; башня строится за малину,
 * сама бьёт врага в радиусе, улучшается и продаётся; меню площадки открывается клавишами и кликом.
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

test('оборона: площадки из карты, башня за малину бьёт врага, улучшение и продажа', async ({ page }) => {
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

test('оборона: нет малины — нет башни; меню площадки по F и по клику, цифра строит', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td;
    m.profile.data.berries = 10;
    const poor = td.build(td.pads[0], 'arrow');
    m.profile.data.berries = 500;
    // F рядом с площадкой — меню; цифра 1 — стрелковая вышка; меню закрылось
    const pad = td.pads[15];
    m.hero.place(pad.pos.x + 1.7, pad.pos.z, Math.PI);
    m.interact(); m.step(0.1);
    const open1 = td.menuOpen;
    const key = td.key(new KeyboardEvent('keydown', { code: 'Digit1' }));
    const built = pad.tower?.kind ?? null;
    const closed = !td.menuOpen;
    // клик по площадке издалека: герой идёт к ней и открывает меню
    const far = td.pads[14];
    m.hero.place(far.pos.x + 7, far.pos.z, Math.PI);
    m.click(far.pos.x, far.pos.z);
    m.step(0.1);
    m.release();
    let opened = false;
    for (let i = 0; i < 80 && !opened; i++) { m.step(0.1); opened = td.menuOpen && td.menuPad === far; }
    const dist = Math.hypot(m.hero.pos.x - far.pos.x, m.hero.pos.z - far.pos.z);
    // Esc закрывает
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
  expect(r.hud).toContain('башен');
});

test('оборона: пять башен бьют по-своему — болты, иней замедляет, камень по площади, пламя жжёт, сфера ослабляет цепью', async ({ page }) => {
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
  // вышка стреляет чаще всех, катапульта — реже
  expect(r.shots[0]).toBeGreaterThan(r.shots[2]);
  expect(r.chilled).toBeGreaterThan(0);
  expect(r.exposed).toBeGreaterThan(0);
  expect(r.burning).toBeGreaterThan(0);
  expect(r.dead).toBeGreaterThan(5);
  expect(r.titles).toEqual(['Стрелковая вышка I', 'Морозный шпиль I', 'Катапульта I', 'Огненная жаровня I', 'Волшебный обелиск I']);
});

test('оборона: враги идут по дорогам к кусту и бьют его; ударенный гонится и возвращается на дорогу; куст засыхает', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, td = m.td, V = m.hero.pos.constructor;
    m.hero.place(0, 30, Math.PI); m.hero.god = true;
    const a = td.spawnOn('berryling', 'west'), b = td.spawnOn('gardener', 'north'), w = td.spawnOn('wolf', 'east'), none = td.spawnOn('wolf', 'nope');
    const p0 = a.progress;
    let reached = -1, maxProgress = 0;
    for (let i = 0; i < 400; i++) { m.step(0.1); maxProgress = Math.max(maxProgress, a.progress); if (td.bush.taken > 0 && reached < 0) reached = i; }
    const r1 = { none, p0, maxProgress, reached, taken: td.bush.taken, alerted: [a.alerted, b.alerted, w.alerted], focus: [!!a.focus, !!b.focus, !!w.focus], near: [a, b, w].map((x: any) => Math.hypot(x.pos.x, x.pos.z) < 4), hud: document.querySelector('.td-hud')?.textContent ?? '' };
    // поводок: ударенный мечом гонится, герой убежал — снова марш
    td.pack.clear();
    const c = td.spawnOn('gardener', 'west');
    for (let i = 0; i < 30; i++) m.step(0.1);
    m.hero.place(c.pos.x + 1.5, c.pos.z, -Math.PI / 2);
    c.hit(5, new V(1, 0, 0), c.pos.clone(), 1);
    const al1 = c.alerted;
    m.hero.place(c.pos.x + 25, c.pos.z, 0);
    for (let i = 0; i < 20; i++) m.step(0.1);
    const al2 = c.alerted, walking = c.state === 'walk';
    // башня бьёт марширующего издалека — тот не отвлекается
    td.pack.clear();
    m.profile.data.berries = 500;
    td.build(td.pads[1], 'arrow');
    const d = td.spawnOn('gardener', 'west');
    let hitYetMarching = false;
    for (let i = 0; i < 150; i++) { m.step(0.1); if (d.taken > 0 && !d.alerted) hitYetMarching = true; }
    // куст засыхает
    td.pack.clear();
    td.bush.hp = 3;
    const e = td.spawnOn('berryling', 'east');
    for (let i = 0; i < 400 && td.state === 'play'; i++) m.step(0.1);
    const lost = td.state, dead = td.bush.dead, banner = document.body.textContent?.includes('Куст засох');
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
  expect(r.r1.hud).toContain('куст малины');
  expect(r.al1).toBe(true);
  expect(r.al2).toBe(false);
  expect(r.walking).toBe(true);
  expect(r.hitYetMarching).toBe(true);
  expect(r.lost).toBe('lost');
  expect(r.dead).toBe(true);
  expect(r.banner).toBe(true);
  expect(r.after).toEqual(['play', 400, 0, 0]);
});
