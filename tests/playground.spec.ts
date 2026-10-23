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

test('склад: сундук на E, бочки взрываются цепочкой от меча, ящики разбиваются, источник лечит', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    m.resetTargets(); m.hero.revive(); m.hero.god = false;
    const P = m.props;
    // сундук: подойти, E — крышка открыта, лут на полу, проходя — подобран
    const s = P.supplies[0];
    m.hero.place(s.pos.x + Math.sin(s.yaw) * 1.2, s.pos.z + Math.cos(s.yaw) * 1.2, 0);
    m.step(0.1);
    const berries0 = m.berries;
    m.interact(); m.step(0.3);
    const loot = P.pickups.length;
    m.step(1.2);
    for (const p of [...P.pickups]) { m.hero.place(p.pos.x, p.pos.z, 0); m.step(0.4); }
    const lootLeft = P.pickups.length, berries = m.berries - berries0;

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
    return { loot, lootLeft, berries, barrelsLeft, crateBroken, verChanged, healed };
  });
  expect(r.loot).toBe(6);
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
    // цена кадра: буфер постобработки не плотнее DPR 1,5, AO — в половину буфера
    const buf = L.composer.renderTarget1, css = window.innerWidth;
    const res = { dpr: buf.width / css, ao: L.ao.width / buf.width };
    return { on, off, night, day: { bloom: L.bloom.strength, sun: L.sun.intensity }, res };
  });
  expect(r.on).toEqual({ unreal: true, passes: 5, fog: true, ao: true });
  expect(r.off).toEqual({ passes: 3, fog: false, ao: false });
  expect(r.night.bloom).toBeGreaterThan(r.day.bloom);
  expect(r.night.sun).toBeLessThan(r.day.sun);
  expect(r.res.dpr).toBeLessThanOrEqual(1.5);
  expect(r.res.ao).toBeCloseTo(0.5, 2);
});

test('трава поверх блоков: бахрома свисает с уступов, пучки растут пятнами и не отбрасывают теней', async ({ page }) => {
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
    return { before, after, back: v.triangles('detail'), opaque: v.triangles('opaque'), detailShadow };
  });
  expect(r.before).toBeGreaterThan(5000);
  expect(r.after).toBeGreaterThan(r.before); // новая трава на вершине: ещё бахрома на 4 стороны
  expect(r.back).toBe(r.before);
  expect(r.detailShadow).toBe(false);
});
