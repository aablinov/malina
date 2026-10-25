import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Плейграунд (ADR-004): герой с мечом — управление мышью как в Minecraft Dungeons, комбо из трёх ударов со следом клинка,
 * перекат, ступени без прыжка, живая вода, склад. Врагов и огнестрела нет.
 */

const URL = pathToFileURL(resolve('dist/index.html')).href + '?dev=playground';

async function open(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  expect(errors).toEqual([]);
  await page.evaluate(() => (window as any).__malina.script(true));
}

test('проходит 10 м с нужной скоростью, врагов и стволов нет', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    m.hero.place(10, 8, 0);
    m.step(0.3);
    m.input.move.set(-1, 0);
    let maxSpeed = 0;
    const T = 10 / m.HERO.walk;
    for (let t = 0; t < T; t += 0.05) { m.step(0.05); maxSpeed = Math.max(maxSpeed, m.hero.speed); }
    m.input.move.set(0, 0);
    m.step(0.4);
    return { dx: 10 - m.hero.pos.x, maxSpeed, walk: m.HERO.walk, state: m.hero.state, enemies: 'enemies' in m, guns: 'GUNS' in m };
  });
  expect(r.dx).toBeGreaterThan(9.6);
  expect(r.dx).toBeLessThan(10.3);
  expect(r.maxSpeed).toBeCloseTo(r.walk, 1);
  expect(r.state).toBe('стоит');
  expect(r.enemies).toBe(false);
  expect(r.guns).toBe(false);
});

test('меч: комбо из трёх ударов, след клинка, добивающий бьёт по площади', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    m.resetTargets();
    const d1 = m.dummies.find((d: any) => d.name === 'чучело 1');
    m.hero.place(d1.pos.x, d1.pos.z + 1.8, Math.PI);
    m.setAim(d1.pos.x, d1.pos.z);
    m.step(0.3);
    const states = new Set<string>();
    let trail = false;
    m.input.attack = true;
    for (let i = 0; i < 80; i++) { m.step(1 / 60); states.add(m.hero.state); trail ||= m.trail.visible; }
    m.input.attack = false;
    m.step(0.8);
    const sw = m.SWORD.swings;
    return {
      states: [...states], trail, swings: m.hero.swings, combo: m.hero.combo, after: m.trail.visible,
      d1: d1.total, expect: sw[0].dmg + sw[1].dmg + sw[2].dmg,
      others: m.dummies.filter((d: any) => d !== d1 && d.name.startsWith('чучело')).map((d: any) => d.hits),
      far: m.dummies.find((d: any) => d.name === 'одиночное').hits,
    };
  });
  expect(r.states).toEqual(expect.arrayContaining(['удар 1', 'удар 2', 'удар 3']));
  expect(r.swings).toBe(3);
  expect(r.combo).toBe(-1);
  expect(r.trail).toBe(true);
  expect(r.after).toBe(false);
  expect(r.d1).toBe(r.expect);
  // соседей по кучке задевает хотя бы добивающий
  for (const h of r.others) expect(h).toBeGreaterThan(0);
  expect(r.far).toBe(0);

  // одно нажатие — один удар, комбо не продолжается без нажатия
  const one = await page.evaluate(() => {
    const m = (window as any).__malina;
    const s0 = m.hero.swings;
    m.input.attack = true; m.step(1 / 60); m.input.attack = false; m.step(1);
    return m.hero.swings - s0;
  });
  expect(one).toBe(1);
});

test('мышь: клик — идти, клик по чучелу — подойти и бить, Shift — бить на месте', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    m.resetTargets();
    // клик по земле: дошёл и остановился
    m.hero.place(0, 6, 0); m.step(0.2);
    m.click(4, 8); m.step(1 / 60); m.release();
    m.step(2);
    const walked = { x: m.hero.pos.x, z: m.hero.pos.z, goal: m.goal };
    // держим ЛКМ и ведём курсор — идёт за курсором
    m.click(4, 4); m.step(0.3); m.click(0, 4); m.step(1.5); m.release(); m.step(0.5);
    const followed = { x: m.hero.pos.x, z: m.hero.pos.z };
    // клик по одиночному чучелу издалека: подошёл, ударил один раз
    const far = m.dummies.find((d: any) => d.name === 'одиночное');
    m.hero.place(far.pos.x + 6, far.pos.z + 1, 0); m.step(0.2);
    const s0 = m.hero.swings;
    m.click(far.pos.x, far.pos.z); m.step(1 / 60); m.release();
    m.step(3);
    const chased = { dist: Math.hypot(m.hero.pos.x - far.pos.x, m.hero.pos.z - far.pos.z), swings: m.hero.swings - s0, hits: far.hits, chase: m.chase };
    // держим ЛКМ на чучеле — комбо из трёх
    far.reset();
    m.click(far.pos.x, far.pos.z); m.step(1.3); m.release(); m.step(0.8);
    const held = far.hits;
    // Shift + ЛКМ — удар на месте, герой не двигается
    m.hero.place(10, 8, 0); m.step(0.2);
    const s1 = m.hero.swings;
    m.click(14, 8, true); m.step(0.5); m.release(); m.step(0.5);
    const here = { dx: Math.abs(m.hero.pos.x - 10), swings: m.hero.swings - s1, lunges: m.SWORD.swings.reduce((a: number, w: any) => a + w.lunge, 0) };
    // WASD отменяет приказ мыши
    m.click(10, 0); m.step(1 / 60); m.release();
    m.script(true); m.input.move.set(1, 0); m.step(0.1); m.input.move.set(0, 0);
    return { walked, followed, chased, held, here, goalAfterKeys: m.goal };
  });
  expect(Math.hypot(r.walked.x - 4, r.walked.z - 8)).toBeLessThan(0.3);
  expect(r.walked.goal).toBe(null);
  expect(Math.hypot(r.followed.x, r.followed.z - 4)).toBeLessThan(0.3);
  expect(r.chased.dist).toBeLessThan(2.2);
  expect(r.chased.swings).toBe(1);
  expect(r.chased.hits).toBe(1);
  expect(r.chased.chase).toBe(null);
  expect(r.held).toBe(3);
  // к курсору не идёт — сдвигается только выпадами ударов
  expect(r.here.dx).toBeLessThan(r.here.lunges + 0.05);
  expect(r.here.swings).toBeGreaterThan(0);
  expect(r.goalAfterKeys).toBe(null);
});

test('поиск пути: клик ведёт в обход стен, по ступеням, вброд через пруд и на площадку витрины', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    /** Клик в точку и ждать, пока дойдёт */
    const go = (x: number, z: number, y?: number, limit = 30) => {
      m.click(x, z, false, y); m.step(1 / 60); m.release();
      let t = 0;
      for (; t < limit && m.goal; t += 0.1) m.step(0.1);
      return { x: m.hero.pos.x, y: m.hero.pos.y, z: m.hero.pos.z, t, left: !!m.goal };
    };
    const out: Record<string, any> = {};
    // за стену «угла»: прямая упирается в стену x = 16, путь — в обход её конца
    m.hero.place(12, 8, 0); m.step(0.1);
    out.cornerPath = m.pathfinder.find(m.hero.pos, m.hero.pos.clone().set(19, 0, 8)).length;
    out.corner = go(19, 8);
    // на площадку 2 м — только по ступеням
    m.hero.place(-10, -17, 0); m.step(0.1);
    out.platform = go(-18, -20, 2);
    // в пруд вброд и обратно на берег
    m.hero.place(-12, 4, 0); m.step(0.1);
    out.pond = go(-18, 4);
    out.shore = go(-12, 4);
    // от старта — на площадку 2 м в витрине (через проём в южной стене, по ступеням)
    m.hero.place(0, 4, 0); m.step(0.1);
    out.study = go(10, 42, 2);
    // клик по чучелу за прудом: подходит в обход и бьёт
    m.resetTargets();
    const d = m.dummies.find((x: any) => x.name === 'одиночное');
    m.hero.place(-11, 6, 0); m.step(0.1);
    m.click(d.pos.x, d.pos.z); m.step(1 / 60); m.release(); m.step(4);
    out.dummyHits = d.hits;
    return out;
  });
  const near = (p: any, x: number, z: number, y: number) => Math.hypot(p.x - x, p.z - z) < 0.3 && Math.abs(p.y - y) < 0.01 && !p.left;
  expect(r.cornerPath).toBeGreaterThan(1);
  expect(near(r.corner, 19, 8, 0)).toBe(true);
  expect(near(r.platform, -18, -20, 2)).toBe(true);
  expect(near(r.pond, -18, 4, -0.5)).toBe(true);
  expect(near(r.shore, -12, 4, 0)).toBe(true);
  expect(near(r.study, 10, 42, 2)).toBe(true);
  expect(r.dummyHits).toBe(1);
});

test('прыжка нет: площадка 2 м сбоку — стена, наверх 2 м — по ступеням, с края — падение; перекат на пробел', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    // площадка сбоку — стена: без прыжка не залезть
    m.hero.place(-18, -16, Math.PI); m.step(0.2);
    m.input.move.set(0, -1); m.step(1.5); m.input.move.set(0, 0);
    const wall = { z: m.hero.pos.z, y: m.hero.pos.y };
    // по ступеням с +X — на площадку 2 м
    m.hero.place(-12, -20, -Math.PI / 2); m.step(0.2);
    m.input.move.set(-1, 0); m.step(1.2); m.input.move.set(0, 0); m.step(0.3);
    const top = m.hero.pos.y;
    // с северного края площадки — падение
    m.input.move.set(0, -1); m.step(1.2); m.input.move.set(0, 0); m.step(0.5);
    const fell = { y: m.hero.pos.y, grounded: m.hero.grounded };
    // перекат: ~rollDist, повторно — только после перезарядки
    m.hero.place(0, 8, Math.PI / 2); m.step(0.2);
    m.input.move.set(1, 0); m.press('roll'); m.step(m.HERO.rollTime); m.input.move.set(0, 0);
    const rollX = m.hero.pos.x;
    m.press('roll'); m.step(1 / 60);
    return { wall, top, fell, rollX, rollAgain: m.hero.state === 'перекат', rollDist: m.HERO.rollDist, hasJump: 'jump' in m.input };
  });
  expect(r.hasJump).toBe(false);
  expect(r.wall.y).toBe(0);
  expect(r.wall.z).toBeGreaterThan(-18.7);
  expect(r.top).toBe(2);
  expect(r.fell.y).toBe(0);
  expect(r.fell.grounded).toBe(true);
  expect(r.rollX).toBeGreaterThan(r.rollDist - 0.4);
  expect(r.rollAgain).toBe(false);
});

test('вода анимирована: время шейдера идёт', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const t0 = m.waterTime; m.step(0.5);
    return m.waterTime - t0;
  });
  expect(r).toBeCloseTo(0.5, 2);
});

test('склад: сундук на F, в нём стрелы и предмет снаряжения, бочки взрываются цепочкой от меча, ящики разбиваются, источник лечит', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    m.resetTargets(); m.hero.revive(); m.hero.god = false;
    const P = m.props;
    // сундук: подойти, F — трясётся, крышка распахивается, лут вылетает фонтаном, проходя — подобран
    const s = P.supplies[0];
    m.hero.place(s.pos.x + Math.sin(s.yaw) * 1.2, s.pos.z + Math.cos(s.yaw) * 1.2, 0);
    m.step(0.1);
    const berries0 = m.berries, items0 = m.profile.data.items.length, arrows0 = m.profile.data.arrows;
    m.interact(); m.step(0.3);
    const lootCharging = P.pickups.length, burstEarly = s.burst;
    m.step(1.0);
    const loot = P.pickups.length;
    m.step(2);
    for (const p of [...P.pickups]) { m.hero.place(p.pos.x, p.pos.z, 0); m.step(0.4); }
    const lootLeft = P.pickups.length, berries = m.berries - berries0;
    const items1 = m.profile.data.items.length, arrows1 = m.profile.data.arrows;

    // бочки: бьём одну из тройки — взрываются три
    m.hero.god = true;
    const b = P.barrels[2];
    m.hero.place(b.pos.x - 1.2, b.pos.z - 0.6, 0); m.setAim(b.pos.x, b.pos.z); m.step(0.2);
    m.input.attack = true; m.step(1.5); m.input.attack = false;
    m.step(2);
    const barrelsLeft = P.barrels.filter((x: any) => !x.exploded).length;

    // деревянный ящик разбивается мечом
    const c = P.crates[1];
    const ver0 = P.version;
    m.hero.place(c.pos.x, c.pos.z - 1.4, 0); m.setAim(c.pos.x, c.pos.z); m.step(0.2);
    m.input.attack = true;
    for (let i = 0; i < 300 && !c.broken; i++) m.step(1 / 60);
    m.input.attack = false;
    const crateBroken = c.broken, verChanged = P.version > ver0;

    // источник здоровья: E лечит, пока стоишь рядом
    m.hero.god = false; m.hero.hp = 30;
    const t = P.terminals[0];
    m.hero.place(t.pos.x + Math.sin(t.yaw) * 1.0, t.pos.z + Math.cos(t.yaw) * 1.0, 0); m.step(0.1);
    m.interact(); m.step(1.0);
    const healed = m.hero.hp - 30;
    m.resetTargets(); m.hero.revive();
    return { lootCharging, burstEarly, loot, lootLeft, berries, barrelsLeft, crateBroken, verChanged, healed, items1, arrows1, items0, arrows0 };
  });
  // пока сундук копит силу — пусто; потом 4 горсти малины, 2 лечения, связка стрел и предмет
  expect(r.lootCharging).toBe(0);
  expect(r.burstEarly).toBe(false);
  expect(r.loot).toBe(8);
  expect(r.items1).toBe(r.items0 + 1);
  expect(r.arrows1).toBeGreaterThan(r.arrows0);
  expect(r.lootLeft).toBe(0);
  expect(r.berries).toBe(16);
  expect(r.barrelsLeft).toBe(2);
  expect(r.crateBroken).toBe(true);
  expect(r.verChanged).toBe(true);
  expect(r.healed).toBeGreaterThan(20);
});

test('декор: предметы из карты рисуются экземплярами, переживают JSON, светят', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const L = m.level;
    const back = L.constructor.fromJSON(JSON.parse(JSON.stringify(L.toJSON())));
    const names = new Set(L.decor.map((d: any) => d.name));
    const before = m.view.decor.instances;
    const v0 = L.decorVersion;
    L.addDecor({ name: 'rubble', pos: [3, 0, 3], rot: [30] });
    m.view.sync();
    const added = m.view.decor.instances - before;
    L.removeDecor(L.decor[L.decor.length - 1]);
    m.view.sync();
    return {
      count: L.decor.length, back: back.decor.length, same: JSON.stringify(back.decor) === JSON.stringify(L.decor),
      names: names.size, before, added, after: m.view.decor.instances, bumped: L.decorVersion - v0,
      lights: m.view.decor.lights.length,
    };
  });
  expect(r.count).toBeGreaterThan(30);
  expect(r.back).toBe(r.count);
  expect(r.same).toBe(true);
  expect(r.names).toBeGreaterThanOrEqual(16);
  expect(r.before).toBeGreaterThanOrEqual(r.count);
  expect(r.added).toBe(1);
  expect(r.after).toBe(r.before);
  expect(r.bumped).toBe(2);
  expect(r.lights).toBeGreaterThan(5);
});

test('декор мешает пройти: герой упирается в обломок колонны, путь обходит упавшую, через щебень — насквозь', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    // обломок колонны 1 × 1 м в (−2, −21,5): идём на него с юга и упираемся
    m.hero.place(-2, -19, Math.PI);
    m.step(0.2);
    m.input.move.set(0, -1);
    let touching = false;
    for (let t = 0; t < 1.2; t += 0.05) { m.step(0.05); touching ||= m.hero.touching; }
    m.input.move.set(0, 0);
    const blocked = { z: m.hero.pos.z, touching };
    // колонна лежит в (13, −20) под 25°: клик за неё — путь в обход
    m.hero.place(13, -17, Math.PI); m.step(0.2);
    const to = m.hero.pos.clone().set(13, 0, -22.5);
    const path = m.pathfinder.find(m.hero.pos, to, { solids: m.solids });
    m.click(13, -22.5); m.step(1 / 60); m.release();
    for (let t = 0; t < 12 && m.goal; t += 0.1) m.step(0.1);
    const around = { x: m.hero.pos.x, z: m.hero.pos.z, left: !!m.goal };
    // щебень без коллайдера: проходим насквозь
    m.hero.place(11, 0, Math.PI); m.step(0.2);
    m.input.move.set(0, -1); m.step(1); m.input.move.set(0, 0);
    const rubble = m.hero.pos.z;
    return {
      blocked, path: path.length, around, rubble,
      solids: m.solids.filter((o: any) => o.y0 !== undefined).length,
      inObstacles: m.obstacles.filter((o: any) => o.y0 !== undefined).length,
    };
  });
  expect(r.blocked.z).toBeGreaterThan(-21.05); // передняя грань обломка — z = −21, герой перед ней
  expect(r.blocked.touching).toBe(true);
  expect(r.path).toBeGreaterThan(1);
  expect(Math.hypot(r.around.x - 13, r.around.z + 22.5)).toBeLessThan(0.3);
  expect(r.around.left).toBe(false);
  expect(r.rubble).toBeLessThan(-3.5);
  expect(r.solids).toBeGreaterThanOrEqual(8);
  expect(r.inObstacles).toBe(r.solids);
});

test('редактор: декор на пол, стену и потолок, перенос, отмена; стёрли стену — факел ушёл вместе с ней', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(resolve('dist/index.html')).href + '?dev=editor');
  await page.waitForFunction(() => (window as any).__malina?.mode === 'editor');
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const L = m.level;
    m.setMode('decor');
    const n0 = L.decor.length;
    m.setDecor('rubble');
    const floor = m.aimDecor([3, 10, 3], [0, -1, 0]);
    m.setDecor('torch_wall');
    const wall = m.aimDecor([18, 1.5, 0], [0, 0, 1]); // стена «угла» z = 5
    m.setDecor('chain');
    const ceiling = m.aimDecor([9, 0.5, 49], [0, 1, 0]); // навес витрины
    m.setDecor('torch_wall');
    const wrong = m.aimDecor([3, 10, 3], [0, -1, 0]); // настенный на пол — нельзя
    const item = m.addDecor({ name: 'torch_wall', pos: wall.pos, rot: wall.rot, on: wall.on });
    const added = L.decor.length - n0;
    m.changeDecor(item, (d: any) => { d.pos = [d.pos[0] + 1, d.pos[1], d.pos[2]]; });
    const moved = item.pos[0];
    m.undo();
    const back = item.pos[0];
    // стёрли клетку стены, к которой прикреплён факел, — уходит и факел; отмена возвращает оба
    m.edit(wall.on[0], wall.on[1], wall.on[2], 'air');
    const erased = { decor: L.decor.length - n0, block: L.nameAt(...wall.on) };
    m.undo();
    const restored = { decor: L.decor.length - n0, block: L.nameAt(...wall.on), same: L.decor.includes(item) };
    m.undo(); // убрать сам факел
    m.view.sync();
    return { floor, wall, ceiling, wrong, added, moved, back, erased, restored, after: L.decor.length - n0, inst: m.view.decor.instances > 0 };
  });
  expect(errors).toEqual([]);
  expect(r.floor.pos).toEqual([3, 0, 3]);
  expect(r.wall.pos).toEqual([18, 1.5, 4.5]);
  expect(Math.abs(r.wall.rot[0])).toBe(180);
  expect(r.wall.on).toEqual([18, 1, 5]);
  expect(r.ceiling.pos).toEqual([9, 2, 49]);
  expect(r.wrong).toBe(null);
  expect(r.added).toBe(1);
  expect(r.moved).toBe(19);
  expect(r.back).toBe(18);
  expect(r.erased).toEqual({ decor: 0, block: 'air' });
  expect(r.restored.decor).toBe(1);
  expect(r.restored.block).not.toBe('air');
  expect(r.restored.same).toBe(true);
  expect(r.after).toBe(0);
  expect(r.inst).toBe(true);
});

test('этаж подземелья: декор комнат переезжает вместе с ними, крепления — на стенах', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(resolve('dist/index.html')).href + '?dev=playground&map=dungeon&seed=42&floor=2');
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const L = m.level;
    const rooms = L.meta.rooms as { x0: number; z0: number; w: number; d: number }[];
    const inRoom = (x: number, z: number) => rooms.some((q) => x >= q.x0 - 0.5 && x <= q.x0 + q.w - 0.5 && z >= q.z0 - 0.5 && z <= q.z0 + q.d - 0.5);
    const outside = L.decor.filter((d: any) => !inRoom(d.pos[0], d.pos[2])).length;
    const floating = L.decor.filter((d: any) => d.on && L.nameAt(...d.on) === 'air').length;
    return { n: L.decor.length, rooms: rooms.length, outside, floating, inst: m.view.decor.instances };
  });
  expect(errors).toEqual([]);
  expect(r.n).toBeGreaterThan(r.rooms * 5);
  expect(r.outside).toBe(0);
  expect(r.floating).toBe(0);
  expect(r.inst).toBeGreaterThanOrEqual(r.n);
});

test('свет как в Unreal: AO, цветокоррекция и дымка включаются и выключаются, кадр рисуется', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const L = m.look;
    const passes = () => L.composer.passes.filter((p: any) => p.enabled).length;
    m.render();
    const on = { unreal: L.unreal, passes: passes(), fog: !!m.view.group.parent.fog, ao: L.ao.enabled };
    m.toggles.unreal = false; m.render();
    const off = { passes: passes(), fog: !!m.view.group.parent.fog, ao: L.ao.enabled };
    m.toggles.unreal = true;
    m.setNight(true); m.render();
    const night = { bloom: L.bloom.strength, sun: L.sun.intensity };
    m.setNight(false); m.render();
    // цена кадра: буфер постобработки не плотнее DPR 1,25, AO — в половину буфера
    const buf = L.composer.renderTarget1, css = window.innerWidth;
    const res = { dpr: buf.width / css, ao: L.ao.width / buf.width };
    return { on, off, night, day: { bloom: L.bloom.strength, sun: L.sun.intensity }, res };
  });
  expect(r.on).toEqual({ unreal: true, passes: 5, fog: true, ao: true });
  expect(r.off).toEqual({ passes: 3, fog: false, ao: false });
  expect(r.night.bloom).toBeGreaterThan(r.day.bloom);
  expect(r.night.sun).toBeLessThan(r.day.sun);
  expect(r.res.dpr).toBeLessThanOrEqual(1.25);
  expect(r.res.ao).toBeCloseTo(0.5, 2);
});

test('трава поверх блоков: бахрома свисает с уступов, пучки растут пятнами, край дорожки рваный', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const v = m.view;
    let detailShadow = false;
    v.group.traverse((o: any) => { if (o.isMesh && o.material === v.mats.detail && o.castShadow) detailShadow = true; });
    const before = v.triangles('detail');
    // срезать верхний ярус холма — бахрома и пучки пересобираются
    const L = m.level;
    L.set(-22, 3, 17, 'grass');
    v.sync();
    const after = v.triangles('detail');
    L.set(-22, 3, 17, 'air');
    v.sync();
    const back = v.triangles('detail');
    // клетка дорожки посреди травы: рваный край в обе стороны (трава на дорожку и дорожка на траву) — до 8 наложений
    // сравнение с землёй в той же клетке: пучки пропадают одинаково, трава заходит на обе, а дорожка ещё и сама заходит на траву
    const was = L.nameAt(6, -1, -6);
    L.set(6, -1, -6, 'path'); v.sync();
    const withPath = v.triangles('detail');
    L.set(6, -1, -6, 'dirt'); v.sync();
    const bleed = withPath - v.triangles('detail');
    L.set(6, -1, -6, was); v.sync();
    return { before, after, back, opaque: v.triangles('opaque'), detailShadow, bleed, restored: v.triangles('detail') };
  });
  expect(r.before).toBeGreaterThan(5000);
  expect(r.after).toBeGreaterThan(r.before); // новая трава на вершине: ещё бахрома на 4 стороны
  expect(r.back).toBe(r.before);
  expect(r.detailShadow).toBe(false);
  expect(r.bleed).toBe(8); // 4 стороны × 2 треугольника: дорожка заходит на траву
  expect(r.restored).toBe(r.back);
});

test('мир: водопад, река с течением, портал и запечённый свет рисуются; через мост — на другой берег, по слоям ландшафта — на вершину', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const v = m.view;
    const names = new Set<string>();
    m.level.forEach((_x: number, _y: number, _z: number, id: number) => names.add(m.level.palette[id]));
    const want = ['wall_stone', 'yard_floor', 'hay', 'cliff', 'cliff_dark', 'cliff_grass', 'waterfall', 'river', 'bridge_deck', 'bridge_post', 'grass_slab', 'leaves_fluffy', 'dry_grass', 'daisies', 'path_stairs', 'portal', 'portal_frame', 'portal_floor'];
    const decor = new Set(m.level.decor.map((d: any) => d.name));
    const wantDecor = ['crates_banded_stack', 'chest', 'cart_loaded', 'bench', 'lantern_post_double', 'lantern_wall', 'waterfall_splash', 'foam_patch', 'candles_group', 'candles_row', 'candle_tall'];
    // по дороге через мост: от двора к порталу
    m.hero.place(46, 0, 0); m.step(0.2);
    m.click(58, 0); m.step(1 / 60); m.release();
    for (let t = 0; t < 10 && m.goal; t += 0.1) m.step(0.1);
    const bridge = { x: m.hero.pos.x, z: m.hero.pos.z, y: m.hero.pos.y, left: !!m.goal };
    // ландшафт проходим отовсюду: на самую высокую плиту юго-запада — без лестниц, по слоям 0,5 м
    let best = { x: 0, z: 0, y: -1 };
    for (let x = 28; x <= 46; x++) for (let z = 8; z <= 22; z++) {
      const t = m.level.topAt(x, z, 12);
      if (t === null || !['grass', 'grass_slab'].includes(m.level.nameAt(x, t, z)) || !m.level.isAir(x, t + 1, z)) continue;
      const f = m.terrain.floorAt(x, z, t + 1.2);
      if (f > best.y) best = { x, z, y: f };
    }
    m.hero.place(38, 3.5, 0); m.step(0.2);
    m.click(best.x, best.z, false, best.y); m.step(1 / 60); m.release();
    for (let t = 0; t < 30 && m.goal; t += 0.1) m.step(0.1);
    const plateau = { y: m.hero.pos.y, want: best.y, d: Math.hypot(m.hero.pos.x - best.x, m.hero.pos.z - best.z) };
    return {
      plateau,
      missing: want.filter((n) => !names.has(n)), missingDecor: wantDecor.filter((n) => !decor.has(n)),
      falls: v.triangles('falls'), river: v.triangles('river'), portal: v.triangles('portal'),
      baked: v.baked.length, bakedPoint: v.decor.lights.some((l: any) => l.intensity < 1.5 && l.dist < 3.5),
      hero: bridge,
    };
  });
  expect(r.missing).toEqual([]);
  expect(r.missingDecor).toEqual([]);
  expect(r.falls).toBeGreaterThan(0);
  expect(r.river).toBeGreaterThan(0);
  expect(r.portal).toBeGreaterThan(0);
  expect(r.baked).toBeGreaterThan(5); // свечи и портал
  expect(r.bakedPoint).toBe(false); // у свечей нет PointLight
  expect(Math.hypot(r.hero.x - 58, r.hero.z)).toBeLessThan(0.3);
  expect(r.hero.y).toBe(0);
  expect(r.hero.left).toBe(false);
  expect(r.plateau.want).toBeGreaterThanOrEqual(1);
  expect(r.plateau.y).toBe(r.plateau.want);
  expect(r.plateau.d).toBeLessThan(0.3);
});

test('редактор: ландшафт — поставить, выбрать, править, сдвинуть, убрать; отмена и JSON', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(resolve('dist/index.html')).href + '?dev=editor');
  await page.waitForFunction(() => (window as any).__malina?.mode === 'editor');
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const L = m.level;
    const snap = () => JSON.stringify(L.toJSON().rows);
    const orig = snap();
    m.setMode('land');
    Object.assign(m.land, { w: 20, d: 16, layers: 6, seed: 7 });
    const a = m.placeLand(5, 0, 6);
    const placed = a.cells.length;
    let maxTop = 0;
    for (let x = -5; x <= 15; x++) for (let z = -2; z <= 14; z++) { const t = L.topAt(x, z, 10); if (t !== null) maxTop = Math.max(maxTop, t + 1); }
    const afterA = snap();
    // второй кусок в стороне, затем выбрать первый кликом по его клетке и править
    const b = m.placeLand(40, 0, 6);
    const afterB = snap();
    const picked = m.landAt(5, 1, 6) === a && m.landAt(40, 0, 6) === b && m.landAt(80, 0, 80) === null;
    m.selectLand(a);
    const undoBefore = m.lands.length;
    m.randomizeLand();
    m.editLand({ w: 14, layers: 4 });
    const edited = a.w === 14 && a.layers === 4 && m.selectedLand === a;
    m.editLand({ x: 8 });
    const moved = a.x === 8;
    // ручной блок поверх куска переживает перестройку
    m.edit(8, 6, 6, 'cobble');
    m.selectLand(a);
    m.randomizeLand();
    const manualKept = L.nameAt(8, 6, 6) === 'cobble';
    const json = L.toJSON();
    const inJson = Array.isArray(json.meta?.lands) && json.meta.lands.length === 2 && json.meta.lands[0].x === 8;
    m.removeLand(a);
    const removed = m.lands.length === 1 && m.selectedLand === null;
    m.undo(); // вернуть кусок
    const back = m.lands.length === 2;
    m.undo(); m.undo(); m.undo(); // правка после ручного блока, ручной блок, слитые правки куска
    const restoredB = snap() === afterB && a.x === 5 && a.w === 20;
    m.undo(); // второй кусок
    const restoredA = snap() === afterA && m.lands.length === 1;
    m.undo();
    return { placed, maxTop, picked, undoBefore, edited, moved, manualKept, inJson, removed, back, restoredB, restoredA, restored: snap() === orig && m.lands.length === 0 };
  });
  expect(errors).toEqual([]);
  expect(r.placed).toBeGreaterThan(50);
  expect(r.maxTop).toBeLessThanOrEqual(3 + 1); // 6 слоёв = 3 м над уровнем 0 (+ трава и цветы сверху)
  expect(r).toMatchObject({ picked: true, edited: true, moved: true, manualKept: true, inJson: true, removed: true, back: true, restoredB: true, restoredA: true, restored: true });
});

test('HUD как в Minecraft Dungeons: панель с артефактами, сердце, зелье, карта, стрелы, опыт, задание', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const q = (s: string) => document.querySelector(s) as HTMLElement | null;
    m.hero.hp = m.hero.maxHp / 2;
    m.render();
    const clip = parseFloat(q('[data-id="hpClip"]')!.style.height);
    return {
      bar: !!q('.hud-bar'), arts: document.querySelectorAll('.hud-art').length, heart: !!q('.hud-heart'),
      potion: !!q('.hud-potion kbd'), potionKey: q('.hud-potion kbd')!.textContent, map: !!q('.hud-map'), ammo: q('[data-id="arrows"]')!.textContent,
      goal: q('[data-id="goal"]')!.textContent, lv: q('[data-id="lv"]')!.textContent, clip, maxHp: m.hero.maxHp,
      emptyArt: document.querySelectorAll('.hud-art.empty').length,
    };
  });
  expect(r.bar).toBe(true);
  expect(r.arts).toBe(3);
  expect(r.heart).toBe(true);
  expect(r.potionKey).toBe('E');
  expect(r.map).toBe(true);
  expect(Number(r.ammo)).toBeGreaterThan(0);
  expect(r.goal).toContain('плейграунд');
  expect(r.lv).toBe('LV 1');
  expect(r.clip).toBeCloseTo(50, 0);
  // стартовая куртка даёт здоровье сверх 100
  expect(r.maxHp).toBeGreaterThan(100);
  // стартовые заклинания занимают все три гнезда
  expect(r.emptyArt).toBe(0);
});

test('снаряжение в бою: стрелы на ПКМ, артефакты 1/2/3 с перезарядкой, зелье, души и опыт', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    m.resetTargets(); m.hero.revive(); m.hero.god = false;
    const d = m.dummies.find((x: any) => x.name === 'одиночное');
    m.hero.place(d.pos.x + 5, d.pos.z, -Math.PI / 2);
    m.step(0.2);
    const arrows0 = m.profile.data.arrows, hits0 = d.hits;
    let shots = 0;
    for (let i = 0; i < 4; i++) { if (m.shoot(d.pos.x, d.pos.z)) shots++; m.step(0.7); }
    const arrowHits = d.hits - hits0, arrows1 = m.profile.data.arrows;
    // огненный шар: взрыв у чучела, перезарядка в HUD
    const hits1 = d.hits;
    const fired = m.artifact(0, d.pos.x, d.pos.z);
    const again = m.artifact(0, d.pos.x, d.pos.z);
    m.step(0.8);
    const boom = d.hits > hits1, cd = m.gear.hudState().artifacts[0][0];
    // лечение лечит, пустое гнездо не срабатывает, зелье лечит и уходит на перезарядку
    m.hero.hp = 40;
    m.artifact(2, 0, 0); m.step(1);
    const totemHeal = m.hero.hp - 40;
    m.profile.unequipArtifact(2);
    const empty = m.artifact(2, d.pos.x, d.pos.z);
    m.hero.hp = 30;
    const drank = m.potion(), hpAfter = m.hero.hp, drankAgain = m.potion();
    const souls = m.profile.data.souls, xp = m.profile.data.xp + m.profile.data.level * 1000;
    return { shots, arrowHits, arrowsSpent: arrows0 - arrows1, fired, again, boom, cd, empty, totemHeal, drank, hpAfter, drankAgain, souls, xp };
  });
  expect(r.shots).toBe(4);
  expect(r.arrowHits).toBeGreaterThanOrEqual(3);
  expect(r.arrowsSpent).toBe(4);
  expect(r.fired).toBe(true);
  expect(r.again).toBe(false);
  expect(r.boom).toBe(true);
  expect(r.cd).toBeGreaterThan(5);
  expect(r.empty).toBe(false);
  expect(r.totemHeal).toBeGreaterThan(5);
  expect(r.drank).toBe(true);
  expect(r.hpAfter).toBeGreaterThan(60);
  expect(r.drankAgain).toBe(false);
  expect(r.souls).toBeGreaterThan(0);
  expect(r.xp).toBeGreaterThan(1000);
});

test('заклинания: четыре стартовых, заряд сильнее тапа, удар со стоп-кадром, с боссов — не из сундуков', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    m.resetTargets(); m.hero.revive(); m.hero.god = true;
    const p = m.profile;
    const kinds = p.artifacts().map((it: any) => it?.def);
    const inBag = ['spark', 'fireball', 'icerain', 'heal'].every((d) => p.data.items.some((i: any) => i.def === d));
    // в сундуках и у торговцев заклинаний нет
    let lootSpell = false;
    for (let i = 0; i < 300; i++) if (['spark', 'fireball', 'icerain', 'heal'].includes(p.rollLoot().def)) lootSpell = true;
    const d = m.dummies.find((x: any) => x.name === 'одиночное');
    m.hero.place(d.pos.x + 6, d.pos.z, -Math.PI / 2);
    m.step(0.2);
    const sp = m.gear.spells;
    // искра тапом и с полным зарядом: урон по чучелу
    let h0 = d.hits;
    m.artifact(1, d.pos.x, d.pos.z, 0); m.step(0.4);
    const sparkHit = d.hits > h0;
    m.gear.artT[1][0] = 0;
    // удержание: заряд копится, герой идёт медленнее, отпустить — каст
    m.fx.hitstop = 0;
    const charged = m.hold(1, d.pos.x, d.pos.z, 1.2);
    m.step(0.2);
    const hitstop = m.fx.hitstop;
    const slowWhile = (() => { m.gear.artT[1][0] = 0; m.gear.pressArtifact(1, d.pos); m.step(0.3); const k = m.gear.spells.charging?.k ?? 0; const sm = m.hero.speedMul; m.gear.releaseArtifact(1, d.pos); return { k, sm }; })();
    m.step(0.5);
    // ледяной дождь: надеть в гнездо 3 и кастовать
    const ice = p.data.items.find((i: any) => i.def === 'icerain');
    p.equip(ice.uid, 2);
    h0 = d.hits;
    m.artifact(2, d.pos.x, d.pos.z, 1); m.step(2.8);
    const iceHits = d.hits - h0;
    // огненный шар долетает и взрывается
    h0 = d.hits;
    m.artifact(0, d.pos.x, d.pos.z, 0.5); m.step(1);
    const fireHit = d.hits > h0;
    // лечение: заряженное лечит сильнее
    const heal = p.data.items.find((i: any) => i.def === 'heal');
    p.equip(heal.uid, 2);
    m.hero.hp = 20; m.artifact(2, 0, 0, 0); m.step(0.5); const tap = m.hero.hp - 20;
    m.gear.artT[2][0] = 0;
    m.hero.hp = 20; m.artifact(2, 0, 0, 1); m.step(0.5); const full = m.hero.hp - 20;
    m.step(4);
    return { kinds, inBag, lootSpell, sparkHit, charged, slowWhile, iceHits, fireHit, tap, full, impacts: sp.impacts, hitstop };
  });
  expect(r.kinds).toEqual(['fireball', 'spark', 'heal']);
  expect(r.inBag).toBe(true);
  expect(r.lootSpell).toBe(false);
  expect(r.sparkHit).toBe(true);
  expect(r.charged).toBe(true);
  expect(r.slowWhile.k).toBeGreaterThan(0.2);
  expect(r.slowWhile.sm).toBeLessThan(0.7);
  expect(r.iceHits).toBeGreaterThanOrEqual(3);
  expect(r.fireHit).toBe(true);
  expect(r.full).toBeGreaterThan(r.tap * 2);
  expect(r.impacts).toBeGreaterThanOrEqual(6);
  // полный заряд — стоп-кадр на ударе
  expect(r.hitstop).toBeGreaterThan(0);
});

test('заклинания с боссов: все 21 творятся с полным зарядом, бьют и не роняют игру', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const ids = ['meteor', 'flameserpent', 'ashcrown', 'icetomb', 'frostridge', 'absolutezero', 'thunderspear', 'thunderleap', 'stormcloud', 'starfall',
      'starbeam', 'judgement', 'deadchoir', 'gravitywell', 'skullscythe', 'fallenguards', 'rift', 'raspberrybush', 'titanform', 'bladephalanx'];
    const p = m.profile, sp = m.gear.spells;
    m.hero.god = true;
    const d = m.dummies.find((x: any) => x.name === 'одиночное');
    const res: Record<string, { cast: boolean; hits: number }> = {};
    for (const id of ids) {
      m.resetTargets(); m.hero.revive();
      m.hero.place(d.pos.x + 3.5, d.pos.z, -Math.PI / 2); m.step(0.1);
      p.data.souls = 100;
      const it = p.add(id, 1, false);
      p.equip(it.uid, 0);
      m.gear.artT[0][0] = 0;
      const h0 = d.hits;
      const cast = m.artifact(0, d.pos.x, d.pos.z, 1);
      m.step(id === 'titanform' ? 0.5 : 4);
      res[id] = { cast, hits: d.hits - h0 };
    }
    m.step(12);
    return { res, impacts: sp.impacts, buffs: sp.buffs.length, scale: m.hero.object.scale.x };
  });
  expect(errors).toEqual([]);
  for (const [id, v] of Object.entries(r.res)) {
    expect(v.cast, id).toBe(true);
    // всё, кроме облика титана (это усиление), задевает чучело
    if (id !== 'titanform') expect(v.hits, id).toBeGreaterThan(0);
  }
  expect(r.impacts).toBeGreaterThanOrEqual(20);
  // усиления кончились, герой снова обычного роста
  expect(r.buffs).toBe(0);
  expect(r.scale).toBeCloseTo(1, 2);
});

test('ауры: пять в инвентаре, гнездо R, эффекты, вспышка ×3 по шкале', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    m.resetTargets(); m.hero.revive(); m.hero.god = false;
    const p = m.profile, g = m.gear, au = g.auras;
    const uid = (def: string) => p.data.items.find((i: any) => i.def === def).uid;
    const bag = ['pact', 'bastion', 'rage', 'clarity', 'thorns'].every((d) => p.data.items.some((i: any) => i.def === d));
    const emptySlot = p.data.equip.aura === null && !!document.querySelector('.hud-aura.empty');
    // ярость: урон выше, вспышка — только с полной шкалой, ×3, потом назад
    const base = g.stats.meleeMult;
    p.equip(uid('rage')); m.step(0.1);
    const rage = g.stats.meleeMult / base;
    const notReady = m.flare();
    au.meter = 1e9; m.step(0.1);
    const hudReady = !!document.querySelector('.hud-aura.ready') || au.ready;
    const flared = m.flare();
    const rageFlare = g.stats.meleeMult / base;
    m.step(5.2);
    const after = g.stats.meleeMult / base;
    // бастион: удар слабее
    p.equip(uid('bastion')); m.step(0.1);
    m.hero.hp = 100; m.hero.hurt(50); const bastionLoss = 100 - m.hero.hp;
    // пакт: стрелы по чучелу лечат
    const d = m.dummies.find((x: any) => x.name === 'одиночное');
    p.equip(uid('pact')); m.step(0.1);
    m.hero.place(d.pos.x + 5, d.pos.z, -Math.PI / 2); m.step(0.2);
    m.hero.hp = 40;
    for (let i = 0; i < 3; i++) { m.shoot(d.pos.x, d.pos.z); m.step(0.7); }
    const pactHeal = m.hero.hp - 40;
    // шипы: ударили вблизи — чучело получает урон
    p.equip(uid('thorns')); m.step(0.1);
    m.hero.place(d.pos.x + 1.2, d.pos.z, -Math.PI / 2); m.step(0.2);
    m.hero.hp = 100; m.step(0.05);
    const h0 = d.hits; m.hero.hurt(30); m.step(0.1);
    const thornsHit = d.hits > h0;
    // ясность: перезарядка короче
    const cd0 = g.stats.artifactCdMult;
    p.equip(uid('clarity')); m.step(0.1);
    const clarity = g.stats.artifactCdMult / cd0;
    return { bag, emptySlot, rage, notReady, hudReady, flared, rageFlare, after, bastionLoss, pactHeal, thornsHit, clarity, flares: au.flares };
  });
  expect(r.bag).toBe(true);
  expect(r.emptySlot).toBe(true);
  expect(r.rage).toBeCloseTo(1.15, 2);
  expect(r.notReady).toBe(false);
  expect(r.hudReady).toBe(true);
  expect(r.flared).toBe(true);
  expect(r.rageFlare).toBeCloseTo(1.45, 2);
  expect(r.after).toBeCloseTo(1.15, 2);
  expect(r.bastionLoss).toBeCloseTo(40, 0);
  expect(r.pactHeal).toBeGreaterThan(0);
  expect(r.thornsHit).toBe(true);
  expect(r.clarity).toBeCloseTo(0.75, 2);
  expect(r.flares).toBe(1);
});

test('инвентарь: I открывает, надеть клеймор и броню, зачаровать за очки, разобрать за малину', async ({ page }) => {
  await open(page);
  await page.keyboard.press('KeyI');
  await expect(page.locator('.inv.open')).toBeVisible();
  const tiles = await page.locator('.inv-grid .it[data-uid]').count();
  expect(tiles).toBeGreaterThan(15);

  // надеть клеймор двойным кликом: оружие героя и числа удара сменились
  const clay = await page.evaluate(() => (window as any).__malina.profile.data.items.find((i: any) => i.def === 'claymore').uid);
  await page.locator(`.inv-grid .it[data-uid="${clay}"]`).dblclick();
  const eq = await page.evaluate(() => { const m = (window as any).__malina; return { melee: m.profile.equipped('melee').def, range: m.SWORD.swings[0].range }; });
  expect(eq.melee).toBe('claymore');
  expect(eq.range).toBeCloseTo(2.8, 2);

  // броня: Enter надевает выбранное — здоровье растёт
  const hp0 = await page.evaluate(() => (window as any).__malina.hero.maxHp);
  const champ = await page.evaluate(() => (window as any).__malina.profile.data.items.find((i: any) => i.def === 'champion').uid);
  await page.locator(`.inv-grid .it[data-uid="${champ}"]`).click();
  await page.keyboard.press('Enter');
  const hp1 = await page.evaluate(() => (window as any).__malina.hero.maxHp);
  expect(hp1).toBeGreaterThan(hp0);

  // зачарование: выбрать клеймор, открыть первое гнездо, первый вариант — очко ушло, урон вырос
  await page.locator(`.inv-grid .it[data-uid="${clay}"]`).click();
  const mult0 = await page.evaluate(() => (window as any).__malina.gear.stats.meleeMult);
  await page.locator('.gem[data-slot="0"]').click();
  await page.locator('[data-opt="0"]').click();
  const opt = await page.evaluate((u) => (window as any).__malina.profile.get(u).enchants[0].options[0], clay);
  await page.locator('[data-act="enchant"]').click();
  const en = await page.evaluate((u) => { const m = (window as any).__malina; const it = m.profile.get(u); return { points: m.profile.data.points, tier: it.enchants[0].tier, mult: m.gear.stats.meleeMult }; }, clay);
  expect(en.points).toBe(2);
  expect(en.tier).toBe(1);
  if (opt === 'sharpness') expect(en.mult).toBeGreaterThan(mult0);
  await expect(page.locator(`.inv-grid .it[data-uid="${clay}"]`)).toHaveClass(/ench/);

  // разбор надетого запрещён; меч стража снят — разбираем: малина и очки назад
  await page.keyboard.press('KeyX');
  await expect(page.locator('.d-salvage')).toHaveCount(0);
  const sword = await page.evaluate(() => (window as any).__malina.profile.data.items.find((i: any) => i.def === 'sword').uid);
  await page.locator(`.inv-grid .it[data-uid="${sword}"]`).click();
  await page.keyboard.press('KeyX');
  await expect(page.locator('.d-salvage')).toBeVisible();
  const b0 = await page.evaluate(() => (window as any).__malina.berries);
  await page.keyboard.press('Enter');
  const after = await page.evaluate((u) => { const m = (window as any).__malina; return { gone: !m.profile.get(u), berries: m.berries }; }, sword);
  expect(after.gone).toBe(true);
  expect(after.berries).toBeGreaterThan(b0);

  // Esc закрывает, профиль сохранён
  await page.keyboard.press('Escape');
  await expect(page.locator('.inv.open')).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('malina.profile') || '{}').equip?.melee);
  expect(saved).toBe(clay);
});

test('броня и лук видны на герое: надел доспех — детали на теле, выстрел — лук в левой руке', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const tunic = m.hero.armorParts;
    m.profile.equip(m.profile.data.items.find((i: any) => i.def === 'champion').uid);
    const champ = m.hero.armorParts;
    m.profile.equip(m.profile.data.items.find((i: any) => i.def === 'soulrobe').uid);
    const robe = m.hero.armorParts;
    m.hero.place(0, 4, 0); m.step(0.2);
    const before = m.hero.bowShown;
    m.shoot(0, 12); m.step(0.1);
    const during = m.hero.bowShown;
    m.step(1.2);
    return { tunic, champ, robe, before, during, after: m.hero.bowShown };
  });
  expect(r.tunic).toBeGreaterThan(0);
  expect(r.champ).toBeGreaterThan(r.tunic);
  expect(r.robe).toBeGreaterThan(r.tunic);
  expect(r.before).toBe(false);
  expect(r.during).toBe(true);
  expect(r.after).toBe(false);
});

test('кузнец и торговец: лавки с именами, F — окно, покупка за малину, перековка, стрелы', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const labels = [...document.querySelectorAll('.npc-label')].map((e) => e.textContent);
    const opened = m.trade('smith');
    const b0 = m.berries, n0 = m.profile.data.items.length;
    const bought = m.shop.buy(0);
    const got = m.profile.data.items[m.profile.data.items.length - 1];
    const sword = m.profile.equipped('melee'), p0 = sword.power;
    const forged = m.profile.reforge(sword.uid, 45);
    m.shop.hide();
    m.trade('merchant');
    const a0 = m.profile.data.arrows;
    m.shop.buy(1);
    const arrows = m.profile.data.arrows - a0;
    // обычное заклинание — четвёртый товар торговца; после покупки на прилавке другое
    const cards = document.querySelectorAll('.trade.open .trade-card').length;
    const spellOn = document.querySelectorAll('.trade.open .trade-card h3')[3]?.textContent;
    m.profile.data.berries = 500;
    const spellBought = m.shop.buy(3);
    const spellGot = m.profile.data.items[m.profile.data.items.length - 1].def;
    const shopSpells = ['ashcrown', 'frostridge', 'stormcloud', 'skullscythe', 'raspberrybush'];
    // в случайный товар и в бесплатный набор обычные заклинания не попадают
    let lootSpell = false;
    for (let i = 0; i < 300; i++) if (shopSpells.includes(m.profile.rollLoot().def)) lootSpell = true;
    m.profile.data.berries = 0;
    const poor = m.shop.buy(0);
    m.shop.hide();
    return { labels, opened, spent: b0 - m.berries, items: m.profile.data.items.length - n0, bought, gotSlot: got.def, forged, power: sword.power - p0, arrows, poor, cards, spellOn, spellBought, spellGot, shopSpells, lootSpell };
  });
  expect(r.labels).toEqual(['Кузнец', 'Торговец']);
  expect(r.opened).toBe(true);
  expect(r.bought).toBe(true);
  expect(r.items).toBe(2);
  expect(r.cards).toBe(4);
  expect(r.spellOn).toBe('Заклинание');
  expect(r.spellBought).toBe(true);
  expect(r.shopSpells).toContain(r.spellGot);
  expect(r.lootSpell).toBe(false);
  expect(['sword', 'axe', 'mace', 'spear', 'claymore', 'dagger', 'hammer', 'scythe']).toContain(r.gotSlot);
  expect(r.forged).toBe(true);
  expect(r.power).toBe(1);
  expect(r.arrows).toBe(24);
  expect(r.poor).toBe(false);
  await expect(page.locator('.trade.open')).toHaveCount(0);
});

test('карта как в Diablo: туман войны открывается по ходу, мини-карта, Tab — поверх игры, M — полная', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    m.hero.place(0, 4, 0); m.step(0.1); m.render();
    const e0 = m.automap.explored;
    m.hero.place(-15, -15, 0); m.step(0.1); m.render();
    const e1 = m.automap.explored;
    return { e0, e1, seenFar: m.automap.isSeen(20, 20), mini: (document.querySelector('[data-id="mini"]') as HTMLCanvasElement).width };
  });
  expect(r.e0).toBeGreaterThan(0);
  expect(r.e1).toBeGreaterThan(r.e0);
  expect(r.seenFar).toBe(false);
  expect(r.mini).toBeGreaterThan(50);
  await page.keyboard.press('Tab');
  await page.evaluate(() => (window as any).__malina.render());
  await expect(page.locator('.hud-over')).toBeVisible();
  await page.keyboard.press('Tab');
  await page.keyboard.press('KeyM');
  await page.evaluate(() => (window as any).__malina.render());
  await expect(page.locator('.hud-mapwrap.open')).toBeVisible();
  await expect(page.locator('[data-id="mapStats"]')).toContainText('Сундуков открыто');
  await page.keyboard.press('KeyM');
  await expect(page.locator('.hud-mapwrap.open')).toHaveCount(0);
});

test('затенение AO не рисует спрайты: вспышки заклинаний не дают чёрных квадратов', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    m.artifact(0, m.hero.pos.x, m.hero.pos.z - 3);
    m.step(0.5);
    const sprites: any[] = [];
    m.look.scene ?? null;
    let root: any = m.hero.object; while (root.parent) root = root.parent;
    root.traverse((o: any) => { if (o.isSprite && o.visible) sprites.push(o); });
    m.look.ao.overrideVisibility();
    const hidden = sprites.every((s) => !s.visible);
    m.look.ao.restoreVisibility();
    return { n: sprites.length, hidden, back: sprites.every((s) => s.visible) };
  });
  expect(r.n).toBeGreaterThan(0);
  expect(r.hidden).toBe(true);
  expect(r.back).toBe(true);
});

/** Стражи зала (src/bosses/roster.ts): все восемь — или сколько уже есть */
const BOSS_IDS = ['cauldron', 'boar', 'storm', 'golden', 'night', 'druse', 'gatherer', 'cat', 'serpent', 'beast', 'queen', 'judge', 'general', 'winter', 'star', 'gardener'];

for (const id of BOSS_IDS) {
  test(`страж «${id}»: квадрат закрывает арену, бьёт героя, оглушение даёт ×2, смерть — гримуар, пал — сброс`, async ({ page }) => {
    await open(page);
    const r = await page.evaluate((id) => {
      const m = (window as any).__malina;
      const k = m.bossIds.indexOf(id);
      if (k < 0) return { missing: true };
      const boss = m.bosses[k], arena = m.arenas[k];
      const V = m.hero.pos.constructor;
      const out: Record<string, unknown> = { missing: false };
      out.sleeping = boss.state === 'sleep' && arena.state === 'idle' && arena.solids.length === 0;
      // от ворот — в квадрат за ними
      m.toBoss(id);
      const t = arena.spec.trigger;
      m.hero.place((t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2);
      m.step(0.3);
      out.fight = arena.state === 'fight' && arena.solids.length > 0 && m.bossBar.shown && boss.awake;
      // герой стоит рядом со стражем — за 12 с страж должен его задеть
      m.step(1.8);
      let lost = 0;
      for (let j = 0; j < 12 * 30 && lost < 5; j++) {
        m.hero.hp = Math.max(m.hero.hp, 60);
        const hp = m.hero.hp;
        const a = boss.yaw;
        m.hero.place(boss.pos.x + Math.sin(a) * (boss.radius + 1.2), boss.pos.z + Math.cos(a) * (boss.radius + 1.2));
        m.step(1 / 30);
        lost += Math.max(0, hp - m.hero.hp);
      }
      out.lost = lost;
      m.hero.god = true;
      // ярость на половине здоровья
      // страж может быть неуязвим в этот миг (исчез, в воздухе) — бьём, пока не попадёт
      for (let j = 0; j < 240 && !boss.enraged; j++) { boss.hit(boss.hp - boss.maxHp * 0.45, new V(0, 0, 1), boss.pos.clone(), 0); m.step(1 / 60); }
      out.enraged = boss.enraged;
      // оглушение: сердце открыто — урон ×2
      m.step(0.5);
      boss.daze(1.5);
      m.step(0.2);
      const h0 = boss.hp;
      boss.hit(10, new V(0, 0, 1), boss.pos.clone(), 0);
      out.heart = h0 - boss.hp;
      // смерть — гримуар; подойти — заклинание в инвентаре
      const had = m.profile.data.items.filter((x: any) => x.def === boss.drop).length;
      const berries0 = m.profile.data.berries;
      for (let j = 0; j < 240 && !boss.dead; j++) { boss.hit(99999, new V(0, 0, 1), boss.pos.clone(), 0); if (!boss.dead) m.step(1 / 60); }
      m.step(3);
      out.won = arena.state;
      // фонтан малины: чем сильнее страж, тем больше; у боссов этажа — пара гримуаров на выбор
      // ягоды: подобранные герой уже получил, остальные лежат на полу
      const onFloor = m.props.pickups.filter((p: any) => p.kind === 'berry').reduce((a: number, p: any) => a + p.amount, 0);
      out.berries = boss.berries > 0 && onFloor + m.profile.data.berries - berries0 >= boss.berries;
      const pair = m.grimoires.slice(-boss.drops.length);
      const g = pair.find((x: any) => x.item === boss.drop);
      out.grimoire = !!g && pair.length === boss.drops.length && pair.map((x: any) => x.item).join() === boss.drops.join();
      if (g) { m.step(1.8); m.hero.place(g.pos.x, g.pos.z); m.step(0.2); }
      out.got = m.profile.data.items.filter((x: any) => x.def === boss.drop).length - had;
      out.chose = pair.every((x: any) => x.taken);
      m.step(1);
      out.open = arena.solids.length === 0 && boss.minions.length === 0;
      // сброс и гибель героя: страж спит, героя ставит у ворот
      m.resetTargets();
      m.hero.god = false;
      m.hero.place((t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2);
      m.step(0.3);
      m.hero.hurt(9999);
      m.step(3);
      out.reset = { arena: arena.state, boss: boss.state, full: boss.hp === boss.maxHp, atExit: Math.hypot(m.hero.pos.x - arena.spec.exit.x, m.hero.pos.z - arena.spec.exit.z) < 0.5 };
      return out;
    }, id);
    test.skip(r.missing === true, `страж ${id} ещё не сделан`);
    expect(r.sleeping).toBe(true);
    expect(r.fight).toBe(true);
    expect(r.lost as number).toBeGreaterThan(4);
    expect(r.enraged).toBe(true);
    expect(r.heart).toBe(20);
    expect(r.won).toBe('won');
    expect(r.berries).toBe(true);
    expect(r.grimoire).toBe(true);
    expect(r.got).toBe(1);
    expect(r.chose).toBe(true);
    expect(r.open).toBe(true);
    expect(r.reset).toEqual({ arena: 'idle', boss: 'sleep', full: true, atExit: true });
  });
}

test('масштаб стражей: здоровье, урон и малина растут с уровнем и числом игроков; уровень по умолчанию — героя', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const boss = m.bosses[m.bossIds.indexOf('cauldron')];
    const out: Record<string, unknown> = {};
    // по умолчанию — уровень героя, один игрок: здоровье = база
    out.start = { level: boss.scale.level, players: boss.scale.players, hp: m.profile.data.level === 1 ? boss.maxHp === boss.baseHp : true, heroLevel: m.profile.data.level };
    const berries1 = boss.berries;
    // урон по герою: удар в 10 через хуки стража на уровне 1 и на уровне 11 с четырьмя игроками
    const hit = () => { m.hero.hp = m.hero.maxHp; m.hero.down = false; m.step(0.5); const h0 = m.hero.hp; boss.h.hurtHero(10, boss.pos, 0); return h0 - m.hero.hp; };
    const d1 = hit();
    m.bossScale(11, 4);
    out.scaled = { level: boss.scale.level, players: boss.scale.players };
    // здоровье: (1 + 0,06·10) · (1 + 0,5·3) = 1,6 · 2,5 относительно уровня 1 соло
    out.hpK = boss.maxHp / boss.baseHp;
    // урон: (1 + 0,03·10) = 1,3 — от числа игроков не растёт
    out.dmgK = hit() / d1;
    out.lootK = boss.berries / berries1;
    // в бою доля здоровья сохраняется: половина остаётся половиной
    m.bossScale(1, 1);
    m.toBoss('cauldron');
    const t = m.arenas[m.bossIds.indexOf('cauldron')].spec.trigger;
    m.hero.god = true;
    m.hero.place((t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2);
    m.step(0.3);
    boss.hp = boss.maxHp / 2;
    m.bossScale(1, 2);
    out.fightRatio = boss.hp / boss.maxHp;
    m.step(1 / 60);
    out.bar = m.bossBar.el.textContent.includes('игроков 2');
    // уровень героя вырос — стражи на плейграунде крепчают сами
    m.bossScale('hero', 1);
    m.profile.data.level = 6;
    m.step(0.1);
    out.followsHero = boss.scale.level === 6;
    return out;
  });
  expect(r.start).toEqual({ level: r.start && (r.start as any).heroLevel, players: 1, hp: true, heroLevel: (r.start as any).heroLevel });
  expect(r.scaled).toEqual({ level: 11, players: 4 });
  expect(r.hpK as number).toBeCloseTo(1.6 * 2.5, 1);
  expect(r.dmgK as number).toBeCloseTo(1.3, 1);
  expect(r.lootK as number).toBeCloseTo(1.5 * 4, 1);
  expect(r.fightRatio as number).toBeCloseTo(0.5, 2);
  expect(r.bar).toBe(true);
  expect(r.followsHero).toBe(true);
});

/** Рядовые мобы, первая партия (src/mobs/, wiki/design-mobs.md) */
const MOB_IDS = ['healer', 'pyro', 'summoner', 'squire', 'shield', 'berryling', 'gardener', 'wolf'];

test('мобы первой партии: каждый задевает героя, падает от меча и роняет малину', async ({ page }) => {
  await open(page);
  const r = await page.evaluate((ids) => {
    const m = (window as any).__malina;
    const V = m.hero.pos.constructor;
    const out: Record<string, unknown> = {};
    for (const id of ids) {
      m.pack.clear();
      m.hero.god = false;
      m.hero.place(2, 8, Math.PI / 2);
      const mob = m.spawnMob(id, 8, 8);
      m.step(0.6);
      // ближние — герой стоит перед мобом; дальние (держат дистанцию) и волк — герой стоит на месте
      const far = mob.keep > 3;
      let lost = 0;
      for (let j = 0; j < 14 * 30 && lost < 4; j++) {
        m.hero.hp = Math.max(m.hero.hp, 60);
        const hp = m.hero.hp;
        if (!far || id === 'healer') m.hero.place(mob.pos.x + Math.sin(mob.yaw) * (mob.radius + 1), mob.pos.z + Math.cos(mob.yaw) * (mob.radius + 1));
        m.step(1 / 30);
        lost += Math.max(0, hp - m.hero.hp);
      }
      m.hero.god = true;
      const berries0 = m.profile.data.berries;
      const floor0 = m.props.pickups.filter((p: any) => p.kind === 'berry').reduce((a: number, p: any) => a + p.amount, 0);
      for (let j = 0; j < 60 && !mob.dead; j++) { mob.hit(9999, new V(0, 0, 1), mob.pos.clone(), 0); if (!mob.dead) m.step(1 / 60); }
      m.step(1.5);
      const floor = m.props.pickups.filter((p: any) => p.kind === 'berry').reduce((a: number, p: any) => a + p.amount, 0);
      out[id] = { lost: lost >= 4, dead: mob.dead, gone: !m.pack.mobs.includes(mob), berries: floor - floor0 + m.profile.data.berries - berries0 >= mob.loot };
    }
    m.pack.clear();
    return out;
  }, MOB_IDS);
  for (const id of MOB_IDS) expect(r[id], id).toEqual({ lost: true, dead: true, gone: true, berries: true });
});

test('мобы: щит держит удар спереди, целительница лечит и срывается от удара, призыватель зовёт малинёнышей, волк после промаха оглушён', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const V = m.hero.pos.constructor;
    const out: Record<string, unknown> = {};
    m.hero.god = true;
    // щитоносец смотрит на героя: спереди проходит 0,2, в спину — весь урон
    m.pack.clear();
    m.hero.place(2, 8);
    const sh = m.spawnMob('shield', 6, 8);
    sh.yaw = -Math.PI / 2;
    m.step(0.6);
    sh.cd = 99; sh.alerted = false; sh.aggro = 0;
    let h0 = sh.hp; sh.hit(10, new V(1, 0, 0), sh.pos.clone(), 0); out.front = h0 - sh.hp;
    h0 = sh.hp; sh.hit(10, new V(-1, 0, 0), sh.pos.clone(), 0); out.back = h0 - sh.hp;
    // целительница лечит раненого оруженосца; удар во время каста — сорвано, оглушена
    m.pack.clear();
    m.hero.place(-14, 8);
    const sq = m.spawnMob('squire', 6, 8), he = m.spawnMob('healer', 8, 8.5);
    m.step(0.6);
    sq.cd = 99; sq.speed = 0;
    sq.hp = sq.maxHp / 2;
    he.notice();
    const half = sq.hp;
    let healing = false;
    for (let j = 0; j < 4 * 30 && !healing; j++) { m.step(1 / 30); healing = he.state === 'attack' && he.attack === 'heal' && he.st > 0.6; }
    out.healed = sq.hp > half;
    he.hit(5, new V(0, 0, 1), he.pos.clone(), 0);
    m.step(1 / 30);
    out.interrupted = he.state === 'daze';
    // призыватель: малинёныши из кругов, призванные малины не дают
    m.pack.clear();
    m.hero.place(0, 8);
    const su = m.spawnMob('summoner', 8, 8);
    m.step(4);
    const called = m.pack.mobs.filter((x: any) => x.kind === 'berryling');
    out.summoned = called.length >= 3 && called.every((x: any) => x.summoned);
    // волк: пока присел, герой отошёл в сторону — промах, оглушён
    m.pack.clear();
    m.hero.place(2, 8);
    const w = m.spawnMob('wolf', 6, 8);
    let crouch = false;
    for (let j = 0; j < 8 * 60 && !crouch; j++) { m.step(1 / 60); crouch = w.state === 'attack' && w.st < 0.3; }
    m.hero.place(w.pos.x + Math.cos(w.yaw) * 4, w.pos.z - Math.sin(w.yaw) * 4);
    m.step(1.2);
    out.wolfDazed = crouch && w.state === 'daze';
    // масштаб — как у стражей
    m.bossScale(11, 4);
    const w2 = m.spawnMob('wolf', 0, 0);
    out.scaled = w2.maxHp / w2.baseHp;
    m.bossScale('hero', 1);
    m.pack.clear();
    void su;
    return out;
  });
  expect(r.front).toBeCloseTo(2, 5);
  expect(r.back).toBeCloseTo(10, 5);
  expect(r.healed).toBe(true);
  expect(r.interrupted).toBe(true);
  expect(r.summoned).toBe(true);
  expect(r.wolfDazed).toBe(true);
  expect(r.scaled as number).toBeCloseTo(1.6 * 2.5, 1);
});

test('казарма Ордена: гарнизон на постах просыпается группами, пал весь — герой вышел, казарма снова полна', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const V = m.hero.pos.constructor;
    const B = m.barracks;
    const out: Record<string, unknown> = {};
    m.hero.god = true;
    out.kinds = [...new Set(B.mobs.map((x: any) => x.kind))].sort();
    out.count = B.mobs.length;
    // через проход в западной стене — в казарму; у входа никто не просыпается
    m.hero.place(-23, 0, -Math.PI / 2);
    m.step(0.5);
    m.hero.place(-26.5, 0);
    m.step(0.5);
    out.door = B.mobs.filter((x: any) => x.alerted).length;
    // подошёл к малинёнышам — проснулись они, волки и рыцари дальше спят
    m.hero.place(-29, -4);
    m.step(0.3);
    const awake = (k: string) => B.mobs.filter((x: any) => x.kind === k).every((x: any) => x.alerted);
    const asleep = (k: string) => B.mobs.filter((x: any) => x.kind === k).every((x: any) => !x.alerted);
    out.groups = { berryling: awake('berryling'), wolf: asleep('wolf'), shield: asleep('shield'), healer: asleep('healer') };
    // гарнизон пал; герой вышел на плейграунд — казарма снова полна и спит
    for (let j = 0; j < 30; j++) { for (const x of B.mobs) if (!x.dead) x.hit(9999, new V(1, 0, 0), x.pos.clone(), 0); m.step(1 / 30); }
    out.allDead = B.mobs.every((x: any) => x.dead);
    m.hero.place(-10, 0);
    m.step(0.5);
    out.refilled = B.mobs.length === out.count && B.mobs.every((x: any) => !x.dead && !x.alerted);
    return out;
  });
  expect(r.kinds).toEqual(['berryling', 'gardener', 'healer', 'pyro', 'shield', 'squire', 'summoner', 'wolf']);
  expect(r.count).toBe(16);
  expect(r.door).toBe(0);
  expect(r.groups).toEqual({ berryling: true, wolf: true, shield: true, healer: true });
  expect(r.allDead).toBe(true);
  expect(r.refilled).toBe(true);
});
