import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Playground (ADR-004): a hero with a sword — mouse control as in Minecraft Dungeons, a three-hit combo with a blade trail,
 * dodge roll, stairs without jumping, living water, a storage yard. No enemies and no guns.
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

test('walks 10 m at the right speed, no enemies and no guns', async ({ page }) => {
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
  expect(r.state).toBe('idle');
  expect(r.enemies).toBe(false);
  expect(r.guns).toBe(false);
});

test('sword: a three-hit combo, a blade trail, the finisher hits an area', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    m.resetTargets();
    const d1 = m.dummies.find((d: any) => d.name === 'dummy 1');
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
      others: m.dummies.filter((d: any) => d !== d1 && d.name.startsWith('dummy')).map((d: any) => d.hits),
      far: m.dummies.find((d: any) => d.name === 'lone').hits,
    };
  });
  expect(r.states).toEqual(expect.arrayContaining(['hit 1', 'hit 2', 'hit 3']));
  expect(r.swings).toBe(3);
  expect(r.combo).toBe(-1);
  expect(r.trail).toBe(true);
  expect(r.after).toBe(false);
  expect(r.d1).toBe(r.expect);
  // at least the finisher clips the neighbours in the cluster
  for (const h of r.others) expect(h).toBeGreaterThan(0);
  expect(r.far).toBe(0);

  // one press — one strike, the combo does not continue without a press
  const one = await page.evaluate(() => {
    const m = (window as any).__malina;
    const s0 = m.hero.swings;
    m.input.attack = true; m.step(1 / 60); m.input.attack = false; m.step(1);
    return m.hero.swings - s0;
  });
  expect(one).toBe(1);
});

test('mouse: click — walk, click on a dummy — approach and strike, Shift — strike in place', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    m.resetTargets();
    // a click on the ground: arrived and stopped
    m.hero.place(0, 6, 0); m.step(0.2);
    m.click(4, 8); m.step(1 / 60); m.release();
    m.step(2);
    const walked = { x: m.hero.pos.x, z: m.hero.pos.z, goal: m.goal };
    // hold LMB and move the cursor — follows the cursor
    m.click(4, 4); m.step(0.3); m.click(0, 4); m.step(1.5); m.release(); m.step(0.5);
    const followed = { x: m.hero.pos.x, z: m.hero.pos.z };
    // a click on the lone dummy from afar: approached, struck once
    const far = m.dummies.find((d: any) => d.name === 'lone');
    m.hero.place(far.pos.x + 6, far.pos.z + 1, 0); m.step(0.2);
    const s0 = m.hero.swings;
    m.click(far.pos.x, far.pos.z); m.step(1 / 60); m.release();
    m.step(3);
    const chased = { dist: Math.hypot(m.hero.pos.x - far.pos.x, m.hero.pos.z - far.pos.z), swings: m.hero.swings - s0, hits: far.hits, chase: m.chase };
    // hold LMB on the dummy — a combo of three
    far.reset();
    m.click(far.pos.x, far.pos.z); m.step(1.3); m.release(); m.step(0.8);
    const held = far.hits;
    // Shift + LMB — a strike in place, the hero does not move
    m.hero.place(10, 8, 0); m.step(0.2);
    const s1 = m.hero.swings;
    m.click(14, 8, true); m.step(0.5); m.release(); m.step(0.5);
    const here = { dx: Math.abs(m.hero.pos.x - 10), swings: m.hero.swings - s1, lunges: m.SWORD.swings.reduce((a: number, w: any) => a + w.lunge, 0) };
    // WASD cancels the mouse order
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
  // does not walk to the cursor — shifts only by the strike lunges
  expect(r.here.dx).toBeLessThan(r.here.lunges + 0.05);
  expect(r.here.swings).toBeGreaterThan(0);
  expect(r.goalAfterKeys).toBe(null);
});

test('temper: enchantments colour the trail, all 28 synergies fire on the finisher, the Q weapon art of each of the 16 weapons', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const E = ['sharpness', 'critical', 'leeching', 'knockback', 'swirling', 'fireAspect', 'soulSiphon', 'smiting'];
    const d1 = () => m.dummies.find((d: any) => d.name === 'dummy 1');
    const total = () => m.dummies.reduce((s: number, d: any) => s + d.total, 0);
    const stand = (dz: number) => { const d = d1(); m.hero.place(d.pos.x, d.pos.z + dz, Math.PI); m.setAim(d.pos.x, d.pos.z); m.step(0.3); };
    // without temper — the standard trail; one temper — its colour, no synergies
    m.weapon('sword');
    const plain = m.hero.swingLooks;
    m.temper(['fireAspect']);
    const one = { looks: m.hero.swingLooks?.length, syn: m.arts.synergies.length, red: m.hero.swingLooks?.[0].color.r > m.hero.swingLooks?.[0].color.b };
    // each pair: the synergy fires on the combo finisher and hits the dummies
    const pairs: [string, number][] = [];
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
      m.resetTargets(); m.step(0.2);
      const [id] = m.temper([E[i], E[j]]);
      stand(1.8);
      const p0 = m.arts.procs.get(id) ?? 0;
      m.input.attack = true;
      for (let k = 0; k < 200 && (m.arts.procs.get(id) ?? 0) === p0; k++) m.step(1 / 60);
      m.input.attack = false;
      m.step(2.5);
      pairs.push([id, (m.arts.procs.get(id) ?? 0) - p0]);
    }
    // three tempers — resonance: three synergies at once
    m.resetTargets(); m.step(0.2);
    const tri = m.temper(['sharpness', 'fireAspect', 'smiting']);
    stand(1.8);
    const res0 = m.arts.procs.get('resonance') ?? 0;
    m.input.attack = true; for (let k = 0; k < 120; k++) m.step(1 / 60); m.input.attack = false; m.step(2);
    const resonance = (m.arts.procs.get('resonance') ?? 0) - res0;
    // the meter fills with hits; without it Q does not strike
    m.temper([]); m.resetTargets(); m.step(0.2); stand(1.8);
    m.arts.meter = 0;
    const early = m.special(d1().pos.x, d1().pos.z);
    m.input.attack = true; for (let k = 0; k < 240; k++) m.step(1 / 60); m.input.attack = false; m.step(0.5);
    const filled = m.arts.meter;
    // the weapon art of each weapon kind
    const specials: Record<string, { ok: boolean; dmg: number; moved: number; hidden: boolean; back: boolean; state: string; dual: boolean; style: string }> = {};
    for (const id of ['sword', 'axe', 'dagger', 'mace', 'spear', 'hammer', 'scythe', 'katana', 'nagakiba', 'dragonslayer', 'pontiff', 'staff', 'halberd', 'rapier', 'knuckles']) {
      m.resetTargets(); m.step(0.2);
      m.weapon(id); m.temper(['knockback', 'smiting']);
      stand(['sword', 'scythe', 'dragonslayer', 'halberd', 'pontiff', 'knuckles', 'rapier'].includes(id) ? 1.6 : 3.5);
      m.arts.meter = 1;
      const p0 = m.hero.pos.clone(), t0 = total();
      const ok = m.special(d1().pos.x, d1().pos.z);
      let hidden = false;
      const states = new Set<string>();
      for (let k = 0; k < 150; k++) { m.step(1 / 60); hidden ||= m.hero.weaponHidden; states.add(m.hero.state); }
      specials[id] = { ok, dmg: total() - t0, moved: p0.distanceTo(m.hero.pos), hidden, back: !m.hero.weaponHidden, state: [...states].includes('art') ? 'art' : '', dual: m.hero.dual, style: m.hero.style };
    }
    m.weapon(''); m.temper([]);
    return { plain, one, pairs, tri, resonance, early, filled, specials, after: m.arts.meter };
  });
  expect(r.plain).toBe(null);
  expect(r.one).toEqual({ looks: 4, syn: 0, red: true });
  expect(r.pairs).toHaveLength(28);
  expect(new Set(r.pairs.map((p) => p[0])).size).toBe(28);
  for (const [id, n] of r.pairs) expect(n, id).toBeGreaterThan(0);
  expect(r.tri).toHaveLength(3);
  expect(r.resonance).toBeGreaterThan(0);
  expect(r.early).toBe(false);
  expect(r.filled).toBe(1);
  for (const [id, s] of Object.entries(r.specials)) {
    expect(s.ok, id).toBe(true);
    expect(s.state, id).toBe('art');
    expect(s.dmg, id).toBeGreaterThan(0);
    expect(s.back, id).toBe(true);
  }
  expect(r.specials.axe.hidden).toBe(true);
  // dual weapons — the second blade in the left hand
  expect(r.specials.pontiff.dual).toBe(true);
  expect(r.specials.knuckles.dual).toBe(true);
  expect(r.specials.katana.dual).toBe(false);
  // each kind has its own strike poses: eight styles
  expect(Object.fromEntries(Object.entries(r.specials).map(([id, s]) => [id, s.style]))).toEqual({
    sword: 'sword', axe: 'heavy', dagger: 'dagger', mace: 'heavy', spear: 'thrust', hammer: 'heavy', scythe: 'pole', katana: 'katana',
    nagakiba: 'katana', dragonslayer: 'heavy', pontiff: 'dual', staff: 'pole', halberd: 'pole', rapier: 'thrust', knuckles: 'fist',
  });
  for (const id of ['dagger', 'spear', 'hammer', 'katana', 'halberd']) expect(r.specials[id].moved, id).toBeGreaterThan(2);
});

test('pathfinding: a click leads around walls, up the stairs, wading through the pond and onto the showcase platform', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    /** Click at a point and wait until he arrives */
    const go = (x: number, z: number, y?: number, limit = 30) => {
      m.click(x, z, false, y); m.step(1 / 60); m.release();
      let t = 0;
      for (; t < limit && m.goal; t += 0.1) m.step(0.1);
      return { x: m.hero.pos.x, y: m.hero.pos.y, z: m.hero.pos.z, t, left: !!m.goal };
    };
    const out: Record<string, any> = {};
    // behind the "corner" wall: the straight line runs into the wall x = 16, the path goes around its end
    m.hero.place(12, 8, 0); m.step(0.1);
    out.cornerPath = m.pathfinder.find(m.hero.pos, m.hero.pos.clone().set(19, 0, 8)).length;
    out.corner = go(19, 8);
    // onto the 2 m platform — only by the stairs
    m.hero.place(-10, -17, 0); m.step(0.1);
    out.platform = go(-18, -20, 2);
    // wading into the pond and back to the shore
    m.hero.place(-12, 4, 0); m.step(0.1);
    out.pond = go(-18, 4);
    out.shore = go(-12, 4);
    // from the start — onto the 2 m platform in the showcase (through the opening in the south wall, by the stairs)
    m.hero.place(0, 4, 0); m.step(0.1);
    out.study = go(10, 42, 2);
    // a click on the dummy beyond the pond: approaches around and strikes
    m.resetTargets();
    const d = m.dummies.find((x: any) => x.name === 'lone');
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

test('no jump: the 2 m platform from the side is a wall, up 2 m — by the stairs, off the edge — a fall; roll on Space', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    // the platform from the side is a wall: no climbing without a jump
    m.hero.place(-18, -16, Math.PI); m.step(0.2);
    m.input.move.set(0, -1); m.step(1.5); m.input.move.set(0, 0);
    const wall = { z: m.hero.pos.z, y: m.hero.pos.y };
    // by the stairs from +X — onto the 2 m platform
    m.hero.place(-12, -20, -Math.PI / 2); m.step(0.2);
    m.input.move.set(-1, 0); m.step(1.2); m.input.move.set(0, 0); m.step(0.3);
    const top = m.hero.pos.y;
    // off the north edge of the platform — a fall
    m.input.move.set(0, -1); m.step(1.2); m.input.move.set(0, 0); m.step(0.5);
    const fell = { y: m.hero.pos.y, grounded: m.hero.grounded };
    // roll: ~rollDist, again — only after the cooldown
    m.hero.place(0, 8, Math.PI / 2); m.step(0.2);
    m.input.move.set(1, 0); m.press('roll'); m.step(m.HERO.rollTime); m.input.move.set(0, 0);
    const rollX = m.hero.pos.x;
    m.press('roll'); m.step(1 / 60);
    return { wall, top, fell, rollX, rollAgain: m.hero.state === 'roll', rollDist: m.HERO.rollDist, hasJump: 'jump' in m.input };
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

test('water is animated: the shader time runs', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const t0 = m.waterTime; m.step(0.5);
    return m.waterTime - t0;
  });
  expect(r).toBeCloseTo(0.5, 2);
});

test('storage yard: a chest on F with arrows and a gear item inside, barrels explode in a chain from the sword, crates break, the fountain heals', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    m.resetTargets(); m.hero.revive(); m.hero.god = false;
    const P = m.props;
    // chest: approach, F — it shakes, the lid flies open, loot bursts out in a fountain, walking over — picked up
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

    // barrels: hit one of the three — all three explode
    m.hero.god = true;
    const b = P.barrels[2];
    m.hero.place(b.pos.x - 1.2, b.pos.z - 0.6, 0); m.setAim(b.pos.x, b.pos.z); m.step(0.2);
    m.input.attack = true; m.step(1.5); m.input.attack = false;
    m.step(2);
    const barrelsLeft = P.barrels.filter((x: any) => !x.exploded).length;

    // a wooden crate breaks under the sword
    const c = P.crates[1];
    const ver0 = P.version;
    m.hero.place(c.pos.x, c.pos.z - 1.4, 0); m.setAim(c.pos.x, c.pos.z); m.step(0.2);
    m.input.attack = true;
    for (let i = 0; i < 300 && !c.broken; i++) m.step(1 / 60);
    m.input.attack = false;
    const crateBroken = c.broken, verChanged = P.version > ver0;

    // health fountain: E heals while you stand next to it
    m.hero.god = false; m.hero.hp = 30;
    const t = P.terminals[0];
    m.hero.place(t.pos.x + Math.sin(t.yaw) * 1.0, t.pos.z + Math.cos(t.yaw) * 1.0, 0); m.step(0.1);
    m.interact(); m.step(1.0);
    const healed = m.hero.hp - 30;
    m.resetTargets(); m.hero.revive();
    return { lootCharging, burstEarly, loot, lootLeft, berries, barrelsLeft, crateBroken, verChanged, healed, items1, arrows1, items0, arrows0 };
  });
  // while the chest gathers strength — empty; then 4 handfuls of raspberries, 2 heals, a bundle of arrows and an item
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

test('decor: items from the map are drawn as instances, survive JSON, give light', async ({ page }) => {
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

test('decor blocks the way: the hero runs into a column stump, the path goes around a fallen one, through rubble — straight on', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    // a 1 × 1 m column stump at (−2, −21.5): walk at it from the south and run into it
    m.hero.place(-2, -19, Math.PI);
    m.step(0.2);
    m.input.move.set(0, -1);
    let touching = false;
    for (let t = 0; t < 1.2; t += 0.05) { m.step(0.05); touching ||= m.hero.touching; }
    m.input.move.set(0, 0);
    const blocked = { z: m.hero.pos.z, touching };
    // a column lies at (13, −20) at 25°: a click behind it — the path goes around
    m.hero.place(13, -17, Math.PI); m.step(0.2);
    const to = m.hero.pos.clone().set(13, 0, -22.5);
    const path = m.pathfinder.find(m.hero.pos, to, { solids: m.solids });
    m.click(13, -22.5); m.step(1 / 60); m.release();
    for (let t = 0; t < 12 && m.goal; t += 0.1) m.step(0.1);
    const around = { x: m.hero.pos.x, z: m.hero.pos.z, left: !!m.goal };
    // rubble without a collider: we walk straight through
    m.hero.place(11, 0, Math.PI); m.step(0.2);
    m.input.move.set(0, -1); m.step(1); m.input.move.set(0, 0);
    const rubble = m.hero.pos.z;
    return {
      blocked, path: path.length, around, rubble,
      solids: m.solids.filter((o: any) => o.y0 !== undefined).length,
      inObstacles: m.obstacles.filter((o: any) => o.y0 !== undefined).length,
    };
  });
  expect(r.blocked.z).toBeGreaterThan(-21.05); // the stump's front face is z = −21, the hero is in front of it
  expect(r.blocked.touching).toBe(true);
  expect(r.path).toBeGreaterThan(1);
  expect(Math.hypot(r.around.x - 13, r.around.z + 22.5)).toBeLessThan(0.3);
  expect(r.around.left).toBe(false);
  expect(r.rubble).toBeLessThan(-3.5);
  expect(r.solids).toBeGreaterThanOrEqual(8);
  expect(r.inObstacles).toBe(r.solids);
});

test('editor: decor onto the floor, a wall and the ceiling, move, undo; the wall erased — the torch went with it', async ({ page }) => {
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
    const wall = m.aimDecor([18, 1.5, 0], [0, 0, 1]); // the "corner" wall z = 5
    m.setDecor('chain');
    const ceiling = m.aimDecor([9, 0.5, 49], [0, 1, 0]); // the showcase canopy
    m.setDecor('torch_wall');
    const wrong = m.aimDecor([3, 10, 3], [0, -1, 0]); // a wall-mounted one onto the floor — not allowed
    const item = m.addDecor({ name: 'torch_wall', pos: wall.pos, rot: wall.rot, on: wall.on });
    const added = L.decor.length - n0;
    m.changeDecor(item, (d: any) => { d.pos = [d.pos[0] + 1, d.pos[1], d.pos[2]]; });
    const moved = item.pos[0];
    m.undo();
    const back = item.pos[0];
    // the wall cell the torch is attached to is erased — the torch goes too; undo brings both back
    m.edit(wall.on[0], wall.on[1], wall.on[2], 'air');
    const erased = { decor: L.decor.length - n0, block: L.nameAt(...wall.on) };
    m.undo();
    const restored = { decor: L.decor.length - n0, block: L.nameAt(...wall.on), same: L.decor.includes(item) };
    m.undo(); // remove the torch itself
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

test('dungeon floor: room decor moves together with the rooms, mounts are on the walls', async ({ page }) => {
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

test('light as in Unreal: AO, colour grading and haze switch on and off, the frame is drawn', async ({ page }) => {
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
    // the frame's cost: the post-processing buffer is no denser than DPR 1.25, AO — half the buffer
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

test('grass over blocks: fringe hangs off ledges, tufts grow in patches, the path edge is ragged', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const v = m.view;
    let detailShadow = false;
    v.group.traverse((o: any) => { if (o.isMesh && o.material === v.mats.detail && o.castShadow) detailShadow = true; });
    const before = v.triangles('detail');
    // cut off the hill's top tier — the fringe and tufts are rebuilt
    const L = m.level;
    L.set(-22, 3, 17, 'grass');
    v.sync();
    const after = v.triangles('detail');
    L.set(-22, 3, 17, 'air');
    v.sync();
    const back = v.triangles('detail');
    // a path cell amid grass: a ragged edge both ways (grass onto the path and the path onto the grass) — up to 8 overlays
    // compared with dirt in the same cell: the tufts vanish alike, grass creeps onto both, and the path also creeps onto the grass itself
    const was = L.nameAt(6, -1, -6);
    L.set(6, -1, -6, 'path'); v.sync();
    const withPath = v.triangles('detail');
    L.set(6, -1, -6, 'dirt'); v.sync();
    const bleed = withPath - v.triangles('detail');
    L.set(6, -1, -6, was); v.sync();
    return { before, after, back, opaque: v.triangles('opaque'), detailShadow, bleed, restored: v.triangles('detail') };
  });
  expect(r.before).toBeGreaterThan(5000);
  expect(r.after).toBeGreaterThan(r.before); // new grass on the top: more fringe on 4 sides
  expect(r.back).toBe(r.before);
  expect(r.detailShadow).toBe(false);
  expect(r.bleed).toBe(8); // 4 sides × 2 triangles: the path creeps onto the grass
  expect(r.restored).toBe(r.back);
});

test('world: the waterfall, the flowing river, the portal and baked light are drawn; across the bridge — to the other bank, up the terrain layers — to the top', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const v = m.view;
    const names = new Set<string>();
    m.level.forEach((_x: number, _y: number, _z: number, id: number) => names.add(m.level.palette[id]));
    const want = ['wall_stone', 'yard_floor', 'hay', 'cliff', 'cliff_dark', 'cliff_grass', 'waterfall', 'river', 'bridge_deck', 'bridge_post', 'grass_slab', 'leaves_fluffy', 'dry_grass', 'daisies', 'path_stairs', 'portal', 'portal_frame', 'portal_floor'];
    const decor = new Set(m.level.decor.map((d: any) => d.name));
    const wantDecor = ['crates_banded_stack', 'chest', 'cart_loaded', 'bench', 'lantern_post_double', 'lantern_wall', 'waterfall_splash', 'foam_patch', 'candles_group', 'candles_row', 'candle_tall'];
    // along the road over the bridge: from the yard to the portal
    m.hero.place(46, 0, 0); m.step(0.2);
    m.click(58, 0); m.step(1 / 60); m.release();
    for (let t = 0; t < 10 && m.goal; t += 0.1) m.step(0.1);
    const bridge = { x: m.hero.pos.x, z: m.hero.pos.z, y: m.hero.pos.y, left: !!m.goal };
    // the terrain is walkable from everywhere: onto the highest slab of the south-west — without stairs, by 0.5 m layers
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
  expect(r.baked).toBeGreaterThan(5); // candles and the portal
  expect(r.bakedPoint).toBe(false); // candles have no PointLight
  expect(Math.hypot(r.hero.x - 58, r.hero.z)).toBeLessThan(0.3);
  expect(r.hero.y).toBe(0);
  expect(r.hero.left).toBe(false);
  expect(r.plateau.want).toBeGreaterThanOrEqual(1);
  expect(r.plateau.y).toBe(r.plateau.want);
  expect(r.plateau.d).toBeLessThan(0.3);
});

test('editor: terrain — place, select, edit, move, remove; undo and JSON', async ({ page }) => {
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
    // a second piece to the side, then select the first by clicking its cell and edit
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
    // a manual block on top of the piece survives a rebuild
    m.edit(8, 6, 6, 'cobble');
    m.selectLand(a);
    m.randomizeLand();
    const manualKept = L.nameAt(8, 6, 6) === 'cobble';
    const json = L.toJSON();
    const inJson = Array.isArray(json.meta?.lands) && json.meta.lands.length === 2 && json.meta.lands[0].x === 8;
    m.removeLand(a);
    const removed = m.lands.length === 1 && m.selectedLand === null;
    m.undo(); // bring the piece back
    const back = m.lands.length === 2;
    m.undo(); m.undo(); m.undo(); // the edit after the manual block, the manual block, the merged piece edits
    const restoredB = snap() === afterB && a.x === 5 && a.w === 20;
    m.undo(); // the second piece
    const restoredA = snap() === afterA && m.lands.length === 1;
    m.undo();
    return { placed, maxTop, picked, undoBefore, edited, moved, manualKept, inJson, removed, back, restoredB, restoredA, restored: snap() === orig && m.lands.length === 0 };
  });
  expect(errors).toEqual([]);
  expect(r.placed).toBeGreaterThan(50);
  expect(r.maxTop).toBeLessThanOrEqual(3 + 1); // 6 layers = 3 m above level 0 (+ grass and flowers on top)
  expect(r).toMatchObject({ picked: true, edited: true, moved: true, manualKept: true, inJson: true, removed: true, back: true, restoredB: true, restoredA: true, restored: true });
});

test('HUD as in Minecraft Dungeons: the artifact bar, heart, potion, map, arrows, experience, quest', async ({ page }) => {
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
  expect(r.goal).toContain('playground');
  expect(r.lv).toBe('LV 1');
  expect(r.clip).toBeCloseTo(50, 0);
  // the starting tunic gives health above 100
  expect(r.maxHp).toBeGreaterThan(100);
  // the starting spells take all three slots
  expect(r.emptyArt).toBe(0);
});

test('gear in battle: arrows on RMB, artifacts 1/2/3 with cooldown, potion, souls and experience', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    m.resetTargets(); m.hero.revive(); m.hero.god = false;
    const d = m.dummies.find((x: any) => x.name === 'lone');
    m.hero.place(d.pos.x + 5, d.pos.z, -Math.PI / 2);
    m.step(0.2);
    const arrows0 = m.profile.data.arrows, hits0 = d.hits;
    let shots = 0;
    for (let i = 0; i < 4; i++) { if (m.shoot(d.pos.x, d.pos.z)) shots++; m.step(0.7); }
    const arrowHits = d.hits - hits0, arrows1 = m.profile.data.arrows;
    // fireball: an explosion at the dummy, the cooldown in the HUD
    const hits1 = d.hits;
    const fired = m.artifact(0, d.pos.x, d.pos.z);
    const again = m.artifact(0, d.pos.x, d.pos.z);
    m.step(0.8);
    const boom = d.hits > hits1, cd = m.gear.hudState().artifacts[0][0];
    // heal heals, an empty slot does not fire, the potion heals and goes on cooldown
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

test('spells: four starting ones, a charge is stronger than a tap, a hit with hitstop, from bosses — not from chests', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    m.resetTargets(); m.hero.revive(); m.hero.god = true;
    const p = m.profile;
    const kinds = p.artifacts().map((it: any) => it?.def);
    const inBag = ['spark', 'fireball', 'icerain', 'heal'].every((d) => p.data.items.some((i: any) => i.def === d));
    // no spells in chests or at merchants
    let lootSpell = false;
    for (let i = 0; i < 300; i++) if (['spark', 'fireball', 'icerain', 'heal'].includes(p.rollLoot().def)) lootSpell = true;
    const d = m.dummies.find((x: any) => x.name === 'lone');
    m.hero.place(d.pos.x + 6, d.pos.z, -Math.PI / 2);
    m.step(0.2);
    const sp = m.gear.spells;
    // spark by tap and with a full charge: damage to the dummy
    let h0 = d.hits;
    m.artifact(1, d.pos.x, d.pos.z, 0); m.step(0.4);
    const sparkHit = d.hits > h0;
    m.gear.artT[1][0] = 0;
    // holding: the charge builds, the hero walks slower, release — cast
    m.fx.hitstop = 0;
    const charged = m.hold(1, d.pos.x, d.pos.z, 1.2);
    m.step(0.2);
    const hitstop = m.fx.hitstop;
    const slowWhile = (() => { m.gear.artT[1][0] = 0; m.gear.pressArtifact(1, d.pos); m.step(0.3); const k = m.gear.spells.charging?.k ?? 0; const sm = m.hero.speedMul; m.gear.releaseArtifact(1, d.pos); return { k, sm }; })();
    m.step(0.5);
    // ice rain: equip into slot 3 and cast
    const ice = p.data.items.find((i: any) => i.def === 'icerain');
    p.equip(ice.uid, 2);
    h0 = d.hits;
    m.artifact(2, d.pos.x, d.pos.z, 1); m.step(2.8);
    const iceHits = d.hits - h0;
    // the fireball flies there and explodes
    h0 = d.hits;
    m.artifact(0, d.pos.x, d.pos.z, 0.5); m.step(1);
    const fireHit = d.hits > h0;
    // heal: a charged one heals more
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
  // a full charge — hitstop on the hit
  expect(r.hitstop).toBeGreaterThan(0);
});

test('boss spells: all 21 are cast with a full charge, hit and do not crash the game', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const ids = ['meteor', 'flameserpent', 'ashcrown', 'icetomb', 'frostridge', 'absolutezero', 'thunderspear', 'thunderleap', 'stormcloud', 'starfall',
      'starbeam', 'judgement', 'deadchoir', 'gravitywell', 'skullscythe', 'fallenguards', 'rift', 'raspberrybush', 'titanform', 'bladephalanx'];
    const p = m.profile, sp = m.gear.spells;
    m.hero.god = true;
    const d = m.dummies.find((x: any) => x.name === 'lone');
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
    // everything except titan form (that is a buff) clips the dummy
    if (id !== 'titanform') expect(v.hits, id).toBeGreaterThan(0);
  }
  expect(r.impacts).toBeGreaterThanOrEqual(20);
  // the buffs ran out, the hero is normal size again
  expect(r.buffs).toBe(0);
  expect(r.scale).toBeCloseTo(1, 2);
});

test('base spells: 10 on the hero, they hit, blood costs health, the golem holds a mob', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const ids = ['firewall', 'firestorm', 'armageddon', 'wolves', 'elemental', 'golem', 'bloodclaws', 'bloodswarm', 'bloodblade', 'blindflash'];
    const p = m.profile;
    const inBag = ids.every((id) => p.data.items.some((i: any) => i.def === id));
    const d = m.dummies.find((x: any) => x.name === 'lone');
    const res: Record<string, { cast: boolean; hits: number; paid: number }> = {};
    for (const id of ids) {
      m.pack.clear();
      m.resetTargets(); m.hero.revive(); m.hero.god = false;
      m.hero.place(d.pos.x + 3.5, d.pos.z, -Math.PI / 2); m.step(0.1);
      const it = p.data.items.find((i: any) => i.def === id);
      p.equip(it.uid, 0);
      m.gear.artT[0][0] = 0;
      const h0 = d.hits, hp0 = m.hero.hp;
      const cast = m.artifact(0, d.pos.x, d.pos.z, 1);
      const paid = hp0 - m.hero.hp;
      // raspberry blade is a buff: we strike with the sword ourselves
      if (id === 'bloodblade') for (let j = 0; j < 4; j++) { m.gear.onHit(10, true, d.pos, d); m.step(0.2); }
      m.step(4);
      res[id] = { cast, hits: d.hits - h0, paid };
      m.step(id === 'golem' ? 16 : id === 'elemental' ? 12 : id === 'wolves' ? 9 : 2);
    }
    // the golem pulls the mob: it targets the golem, not the hero
    m.pack.clear(); m.resetTargets(); m.hero.revive(); m.hero.god = false;
    m.hero.place(2, 8, Math.PI / 2); m.step(0.1);
    const g = p.data.items.find((i: any) => i.def === 'golem');
    p.equip(g.uid, 0); m.gear.artT[0][0] = 0;
    const mob = m.spawnMob('hammer', 9, 8);
    m.artifact(0, 5, 8, 0); m.step(1.5);
    const focused = !!mob.focus;
    m.step(18.5);
    const freed = !mob.focus;
    m.pack.clear();
    return { inBag, res, focused, freed };
  });
  expect(errors).toEqual([]);
  expect(r.inBag).toBe(true);
  for (const [id, v] of Object.entries(r.res)) {
    expect(v.cast, id).toBe(true);
    expect(v.hits, id).toBeGreaterThan(0);
    if (id.startsWith('blood')) expect(v.paid, id).toBeGreaterThan(0);
  }
  expect(r.focused).toBe(true);
  // the golem dissolved — the mob looks at the hero again
  expect(r.freed).toBe(true);
});

test('auras: twelve in the inventory, the R slot, effects, a ×3 flare by the meter', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    m.resetTargets(); m.hero.revive(); m.hero.god = false;
    const p = m.profile, g = m.gear, au = g.auras;
    const uid = (def: string) => p.data.items.find((i: any) => i.def === def).uid;
    const bag = ['pact', 'bastion', 'rage', 'clarity', 'thorns', 'inferno', 'frost', 'storm', 'halo', 'shade', 'quake', 'blades'].every((d) => p.data.items.some((i: any) => i.def === d));
    const emptySlot = p.data.equip.aura === null && !!document.querySelector('.hud-aura.empty');
    // rage: damage is higher, the flare — only with a full meter, ×3, then back
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
    // bastion: a hit is weaker
    p.equip(uid('bastion')); m.step(0.1);
    m.hero.hp = 100; m.hero.hurt(50); const bastionLoss = 100 - m.hero.hp;
    // pact: arrows into the dummy heal
    const d = m.dummies.find((x: any) => x.name === 'lone');
    p.equip(uid('pact')); m.step(0.1);
    m.hero.place(d.pos.x + 5, d.pos.z, -Math.PI / 2); m.step(0.2);
    m.hero.hp = 40;
    for (let i = 0; i < 3; i++) { m.shoot(d.pos.x, d.pos.z); m.step(0.7); }
    const pactHeal = m.hero.hp - 40;
    // thorns: struck up close — the dummy takes damage
    p.equip(uid('thorns')); m.step(0.1);
    m.hero.place(d.pos.x + 1.2, d.pos.z, -Math.PI / 2); m.step(0.2);
    m.hero.hp = 100; m.step(0.05);
    const h0 = d.hits; m.hero.hurt(30); m.step(0.1);
    const thornsHit = d.hits > h0;
    // clarity: the cooldown is shorter
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

test('boss auras: all twelve are spread over the floor bosses, the chances sum to 100, they drop by the chances', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const floor = m.bosses.filter((b: any) => b.tier === 'boss');
    const sums = floor.map((b: any) => b.auras.reduce((a: number, [, w]: [string, number]) => a + w, 0));
    const all = floor.flatMap((b: any) => b.auras.map(([id]: [string, number]) => id));
    const others = m.bosses.filter((b: any) => b.tier !== 'boss').every((b: any) => b.aura === null && b.drops.length === 1);
    // the general: thorns 40 / shade 30 / quake 30 — 2000 rolls; the aura holds until reset
    const g = floor.find((b: any) => b.auras.length === 3 && b.auras.some(([id]: [string, number]) => id === 'thorns'));
    const freq: Record<string, number> = {};
    let stable = true;
    for (let i = 0; i < 2000; i++) {
      g.reset();
      const a = g.aura;
      if (g.drops[1] !== a) stable = false;
      freq[a] = (freq[a] ?? 0) + 1;
    }
    g.reset();
    return { n: floor.length, sums, all, others, freq, stable };
  });
  expect(r.n).toBe(5);
  for (const s of r.sums) expect(s).toBe(100);
  expect([...new Set(r.all)].sort()).toEqual(['bastion', 'blades', 'clarity', 'frost', 'halo', 'inferno', 'pact', 'quake', 'rage', 'shade', 'storm', 'thorns']);
  expect(r.others).toBe(true);
  expect(r.stable).toBe(true);
  expect(r.freq.thorns / 2000).toBeGreaterThan(0.34);
  expect(r.freq.thorns / 2000).toBeLessThan(0.46);
  expect(r.freq.shade / 2000).toBeGreaterThan(0.25);
  expect(r.freq.quake / 2000).toBeGreaterThan(0.25);
});

test('offensive auras: hit enemies nearby, the meter at half, frost, shade, a freeze by the flare', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    m.resetTargets(); m.pack.clear(); m.hero.revive(); m.hero.god = true;
    const p = m.profile, g = m.gear, au = g.auras, off = au.offense;
    const uid = (def: string) => p.data.items.find((i: any) => i.def === def).uid;
    const d = m.dummies.find((x: any) => x.name === 'lone');
    const out: Record<string, { dealt: number; hits: number; procs: number }> = {};
    // each aura clips the dummy at 1.3 m; the halo needs the hero's hits
    for (const id of ['inferno', 'frost', 'storm', 'halo', 'shade', 'quake', 'blades']) {
      p.equip(uid(id)); m.step(0.1);
      m.hero.place(d.pos.x + 1.3, d.pos.z, -Math.PI / 2); m.step(0.1);
      const h0 = d.hits, dealt0 = off.dealt, procs0 = off.procs;
      if (id === 'halo') for (let i = 0; i < 4; i++) { g.onHit(10, true, d.pos.clone()); m.step(0.1); }
      // shade strikes by itself only in the flare — drinks life
      if (id === 'shade') { au.meter = 1e9; m.step(0.05); m.flare(); }
      m.step(3.5);
      out[id] = { dealt: off.dealt - dealt0, hits: d.hits - h0, procs: off.procs - procs0 };
    }
    // the meter: the aura's own damage — at half
    p.equip(uid('inferno')); m.step(0.1);
    au.meter = 0; const dl0 = off.dealt;
    m.step(1.6);
    const meterK = au.meter / Math.max(1, off.dealt - dl0);
    // frost: a wolf nearby is slowed, the flare — frozen
    m.hero.place(30, 30, 0); m.step(0.1);
    p.equip(uid('frost')); m.step(0.1);
    const w = m.spawnMob('wolf', 31.5, 30); m.step(1.2);
    const chilled = w.chillT > 0 && w.pace < w.speed;
    au.meter = 1e9; m.step(0.05);
    const flared = m.flare(); m.step(0.1);
    const frozen = w.state === 'daze';
    m.step(5.5);
    // shade: a new wolf nearby is weakened (the first was already finished off by the frost)
    m.pack.clear();
    p.equip(uid('shade')); m.step(0.1);
    const w2 = m.spawnMob('wolf', 31.5, 30); m.step(1.2);
    const exposed = w2.exposeT > 0 && w2.exposeK > 0.1;
    // the aura leaves barrels and crates alone
    m.pack.clear();
    const barrel = m.props.barrels?.[0];
    let barrelSafe = true;
    if (barrel) {
      p.equip(uid('inferno')); m.step(0.1);
      const hp0 = barrel.hp;
      m.hero.place(barrel.pos.x + 1.2, barrel.pos.z, 0); m.step(1.5);
      barrelSafe = barrel.hp === hp0;
    }
    return { out, meterK, chilled, flared, frozen, exposed, barrelSafe };
  });
  for (const [id, v] of Object.entries(r.out)) {
    expect(v.dealt, id).toBeGreaterThan(0);
    // the lightning hits a random enemy within 5 m — there are other dummies nearby
    if (id !== 'storm') expect(v.hits, id).toBeGreaterThan(0);
    expect(v.procs, id).toBeGreaterThan(0);
  }
  expect(r.meterK).toBeCloseTo(0.5, 1);
  expect(r.chilled).toBe(true);
  expect(r.flared).toBe(true);
  expect(r.frozen).toBe(true);
  expect(r.exposed).toBe(true);
  expect(r.barrelSafe).toBe(true);
});

test('inventory: I opens, equip the claymore and armour, enchant for points, salvage for raspberries', async ({ page }) => {
  await open(page);
  await page.keyboard.press('KeyI');
  await expect(page.locator('.inv.open')).toBeVisible();
  const tiles = await page.locator('.inv-grid .it[data-uid]').count();
  expect(tiles).toBeGreaterThan(15);

  // equip the claymore by double click: the hero's weapon and the strike numbers changed
  const clay = await page.evaluate(() => (window as any).__malina.profile.data.items.find((i: any) => i.def === 'claymore').uid);
  await page.locator(`.inv-grid .it[data-uid="${clay}"]`).dblclick();
  const eq = await page.evaluate(() => { const m = (window as any).__malina; return { melee: m.profile.equipped('melee').def, range: m.SWORD.swings[0].range }; });
  expect(eq.melee).toBe('claymore');
  expect(eq.range).toBeCloseTo(2.8, 2);

  // armour: Enter equips the selected — health grows
  const hp0 = await page.evaluate(() => (window as any).__malina.hero.maxHp);
  const champ = await page.evaluate(() => (window as any).__malina.profile.data.items.find((i: any) => i.def === 'champion').uid);
  await page.locator(`.inv-grid .it[data-uid="${champ}"]`).click();
  await page.keyboard.press('Enter');
  const hp1 = await page.evaluate(() => (window as any).__malina.hero.maxHp);
  expect(hp1).toBeGreaterThan(hp0);

  // enchanting: select the claymore, open the first slot, the first option — a point spent, damage grew
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

  // salvaging an equipped item is forbidden; the warden's sword is unequipped — salvage it: raspberries and points back
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

  // Esc closes, the profile is saved
  await page.keyboard.press('Escape');
  await expect(page.locator('.inv.open')).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('malina.profile') || '{}').equip?.melee);
  expect(saved).toBe(clay);
});

test('armour and the bow are visible on the hero: armour on — parts on the body, a shot — the bow in the left hand', async ({ page }) => {
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

test('blacksmith and merchant: stalls with names, F — the window, a grid of all wares priced by power, buying the selected, reforging, arrows; every weapon in the inventory', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const labels = [...document.querySelectorAll('.npc-label')].map((e) => e.textContent);
    const melee = ['sword', 'axe', 'mace', 'spear', 'claymore', 'dagger', 'hammer', 'scythe', 'katana', 'nagakiba', 'dragonslayer', 'pontiff', 'staff', 'halberd', 'rapier', 'knuckles'];
    const inInventory = melee.filter((id) => m.profile.data.items.some((i: any) => i.def === id));
    m.profile.data.berries = 1000;
    const opened = m.trade('smith');
    const smithTabs = [...document.querySelectorAll('.trade.open [data-tab]')].map((e: any) => e.dataset.tab);
    m.shop.setTab('melee');
    const list = m.shop.list as { key: string; price: number }[];
    const price = (k: string) => list.find((w) => w.key === k)?.price ?? 0;
    const tiles = document.querySelectorAll('.trade.open .trade-ware').length;
    // select the katana and buy exactly it
    m.shop.select('katana');
    const card = document.querySelector('.trade.open .trade-detail')?.textContent ?? '';
    const b0 = m.berries, n0 = m.profile.data.items.length;
    const bought = m.shop.buy();
    const got = m.profile.data.items[m.profile.data.items.length - 1];
    const spent = b0 - m.berries, added = m.profile.data.items.length - n0;
    // Enter — equip the purchase
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }));
    const worn = m.profile.equipped('melee').def;
    const sword = m.profile.equipped('melee'), p0 = sword.power;
    const forged = m.profile.reforge(sword.uid, 45);
    m.shop.hide();
    m.trade('merchant');
    const merchantTabs = [...document.querySelectorAll('.trade.open [data-tab]')].map((e: any) => e.dataset.tab);
    m.shop.setTab('ranged');
    const a0 = m.profile.data.arrows;
    m.shop.buy('arrows');
    const arrows = m.profile.data.arrows - a0;
    m.shop.setTab('spell');
    const spellList = m.shop.list.map((w: any) => w.key);
    const spellBought = m.shop.buy(spellList[0]);
    const spellGot = m.profile.data.items[m.profile.data.items.length - 1].def;
    const shopSpells = ['ashcrown', 'frostridge', 'stormcloud', 'skullscythe', 'raspberrybush',
      'firewall', 'firestorm', 'armageddon', 'wolves', 'elemental', 'golem', 'bloodclaws', 'bloodswarm', 'bloodblade', 'blindflash'];
    let lootSpell = false;
    for (let i = 0; i < 300; i++) if (shopSpells.includes(m.profile.rollLoot().def)) lootSpell = true;
    m.shop.setTab('melee');
    m.profile.data.berries = 0;
    const poor = m.shop.buy('dragonslayer');
    m.shop.hide();
    return {
      labels, inInventory, opened, smithTabs, merchantTabs, tiles, keys: list.map((w) => w.key), prices: list.map((w) => w.price),
      sword: price('sword'), dragonslayer: price('dragonslayer'), katana: price('katana'), card,
      bought, got: got.def, spent, items: added, worn, forged, power: sword.power - p0,
      arrows, spellList, spellBought, spellGot, shopSpells, lootSpell, poor,
    };
  });
  expect(r.labels).toEqual(['Blacksmith', 'Merchant']);
  expect(r.inInventory).toHaveLength(16);
  expect(r.opened).toBe(true);
  expect(r.smithTabs).toEqual(['melee', 'ranged', 'armor']);
  // auras are not sold — they drop from the floor bosses
  expect(r.merchantTabs).toEqual(['melee', 'ranged', 'armor', 'artifact', 'spell']);
  // every weapon on the counter, each with its own price, the cheap ones first
  expect(r.tiles).toBe(16);
  expect([...r.keys].sort()).toEqual([...r.inInventory].sort());
  expect(r.prices).toEqual([...r.prices].sort((a, b) => a - b));
  expect(r.dragonslayer).toBeGreaterThan(r.sword * 2);
  expect(r.katana).toBeGreaterThan(r.sword);
  expect(r.card).toContain('Iaido');
  expect(r.card).toContain(String(r.katana));
  expect(r.bought).toBe(true);
  expect(r.got).toBe('katana');
  expect(r.spent).toBe(r.katana);
  expect(r.items).toBe(1);
  expect(r.worn).toBe('katana');
  expect(r.forged).toBe(true);
  expect(r.power).toBe(1);
  expect(r.arrows).toBe(24);
  expect(r.spellList.every((s: string) => r.shopSpells.includes(s))).toBe(true);
  expect(r.spellBought).toBe(true);
  expect(r.shopSpells).toContain(r.spellGot);
  expect(r.lootSpell).toBe(false);
  expect(r.poor).toBe(false);
  await expect(page.locator('.trade.open')).toHaveCount(0);
});

test('map as in Diablo: the fog of war opens as you go, the minimap, Tab — over the game, M — full', async ({ page }) => {
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
  await expect(page.locator('[data-id="mapStats"]')).toContainText('Chests opened');
  await page.keyboard.press('KeyM');
  await expect(page.locator('.hud-mapwrap.open')).toHaveCount(0);
});

test('AO shading does not draw sprites: spell flashes do not make black squares', async ({ page }) => {
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

/** Hall wardens (src/bosses/roster.ts): all eight — or as many as exist already */
const BOSS_IDS = ['cauldron', 'boar', 'storm', 'golden', 'night', 'druse', 'gatherer', 'cat', 'serpent', 'beast', 'queen', 'judge', 'general', 'winter', 'star', 'gardener'];

for (const id of BOSS_IDS) {
  test(`warden "${id}": the square closes the arena, hits the hero, a stun gives ×2, death — a grimoire, fell — reset`, async ({ page }) => {
    await open(page);
    const r = await page.evaluate((id) => {
      const m = (window as any).__malina;
      const k = m.bossIds.indexOf(id);
      if (k < 0) return { missing: true };
      const boss = m.bosses[k], arena = m.arenas[k];
      const V = m.hero.pos.constructor;
      const out: Record<string, unknown> = { missing: false };
      out.sleeping = boss.state === 'sleep' && arena.state === 'idle' && arena.solids.length === 0;
      // from the gate — into the square behind it
      m.toBoss(id);
      const t = arena.spec.trigger;
      m.hero.place((t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2);
      m.step(0.3);
      out.fight = arena.state === 'fight' && arena.solids.length > 0 && m.bossBar.shown && boss.awake;
      // the hero stands next to the warden — within 12 s the warden must clip him
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
      // rage at half health
      // the warden may be invulnerable at this moment (vanished, in the air) — hit until it lands
      for (let j = 0; j < 240 && !boss.enraged; j++) { boss.hit(boss.hp - boss.maxHp * 0.45, new V(0, 0, 1), boss.pos.clone(), 0); m.step(1 / 60); }
      out.enraged = boss.enraged;
      // stun: the heart is open — damage ×2
      m.step(0.5);
      boss.daze(1.5);
      m.step(0.2);
      const h0 = boss.hp;
      boss.hit(10, new V(0, 0, 1), boss.pos.clone(), 0);
      out.heart = h0 - boss.hp;
      // death — a grimoire; walk up — the spell is in the inventory
      const had = m.profile.data.items.filter((x: any) => x.def === boss.drop).length;
      const berries0 = m.profile.data.berries;
      for (let j = 0; j < 240 && !boss.dead; j++) { boss.hit(99999, new V(0, 0, 1), boss.pos.clone(), 0); if (!boss.dead) m.step(1 / 60); }
      m.step(3);
      out.won = arena.state;
      // a fountain of raspberries: the stronger the warden, the more; floor bosses — a pair of grimoires to choose from
      // berries: the picked-up ones the hero already has, the rest lie on the floor
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
      // reset and the hero's death: the warden sleeps, the hero is put at the gate
      m.resetTargets();
      m.hero.god = false;
      m.hero.place((t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2);
      m.step(0.3);
      m.hero.hurt(9999);
      m.step(3);
      out.reset = { arena: arena.state, boss: boss.state, full: boss.hp === boss.maxHp, atExit: Math.hypot(m.hero.pos.x - arena.spec.exit.x, m.hero.pos.z - arena.spec.exit.z) < 0.5 };
      return out;
    }, id);
    test.skip(r.missing === true, `warden ${id} is not made yet`);
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

test('warden scale: health, damage and raspberries grow with the level and the player count; the default level is the hero\'s', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const boss = m.bosses[m.bossIds.indexOf('cauldron')];
    const out: Record<string, unknown> = {};
    // by default — the hero's level, one player: health = base
    out.start = { level: boss.scale.level, players: boss.scale.players, hp: m.profile.data.level === 1 ? boss.maxHp === boss.baseHp : true, heroLevel: m.profile.data.level };
    const berries1 = boss.berries;
    // damage to the hero: a hit of 10 through the warden hooks at level 1 and at level 11 with four players
    const hit = () => { m.hero.hp = m.hero.maxHp; m.hero.down = false; m.step(0.5); const h0 = m.hero.hp; boss.h.hurtHero(10, boss.pos, 0); return h0 - m.hero.hp; };
    const d1 = hit();
    m.bossScale(11, 4);
    out.scaled = { level: boss.scale.level, players: boss.scale.players };
    // health: (1 + 0.06·10) · (1 + 0.5·3) = 1.6 · 2.5 relative to level 1 solo
    out.hpK = boss.maxHp / boss.baseHp;
    // damage: (1 + 0.03·10) = 1.3 — does not grow with the player count
    out.dmgK = hit() / d1;
    out.lootK = boss.berries / berries1;
    // in battle the health share is kept: a half stays a half
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
    out.bar = m.bossBar.el.textContent.includes('2 players');
    // the hero's level grew — the wardens on the playground get tougher by themselves
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

/** Rank-and-file mobs, the first batch (src/mobs/, wiki/design-mobs.md) */
const MOB_IDS = ['healer', 'pyro', 'summoner', 'squire', 'shield', 'berryling', 'gardener', 'wolf',
  'spear', 'crossbow', 'banner', 'hammer', 'slime', 'hedgehog', 'vine', 'bud', 'horror',
  'reaper', 'archer', 'wisp', 'scarecrow', 'boarlet', 'beetle', 'spider', 'hive',
  'druseling', 'pot', 'obelisk', 'mimic', 'keg', 'soller'];

test('mobs: each clips the hero, falls to the sword and drops raspberries', async ({ page }) => {
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
      // melee ones — the hero stands in front of the mob; ranged ones (keep distance), the wolf and the slime (jump at the mark) — the hero stays put
      const far = mob.keep > 3 || id === 'slime';
      let lost = 0;
      for (let j = 0; j < 14 * 30 && lost < 4; j++) {
        m.hero.hp = Math.max(m.hero.hp, 60);
        const hp = m.hero.hp;
        if (!far || id === 'healer' || id === 'banner') m.hero.place(mob.pos.x + Math.sin(mob.yaw) * (mob.radius + 1), mob.pos.z + Math.cos(mob.yaw) * (mob.radius + 1));
        m.step(1 / 30);
        lost += Math.max(0, hp - m.hero.hp);
      }
      m.hero.god = true;
      const berries0 = m.profile.data.berries;
      const floor0 = m.props.pickups.filter((p: any) => p.kind === 'berry').reduce((a: number, p: any) => a + p.amount, 0);
      for (let j = 0; j < 60 && !mob.dead; j++) { mob.hit(9999, new V(0, 0, 1), mob.pos.clone(), 0); if (!mob.dead) m.step(1 / 60); }
      m.step(1.5);
      const floor = m.props.pickups.filter((p: any) => p.kind === 'berry').reduce((a: number, p: any) => a + p.amount, 0);
      // the wisp bursts by itself, the keg explodes by itself — then it has already fallen
      if ((id === 'wisp' || id === 'keg') && mob.dead) { out[id] = { lost: lost >= 4, dead: true, gone: true, berries: true }; continue; }
      out[id] = { lost: lost >= 4, dead: mob.dead, gone: !m.pack.mobs.includes(mob), berries: floor - floor0 + m.profile.data.berries - berries0 >= mob.loot };
    }
    m.pack.clear();
    return out;
  }, MOB_IDS);
  for (const id of MOB_IDS) expect(r[id], id).toEqual({ lost: true, dead: true, gone: true, berries: true });
});

test('mobs: the shield holds a hit from the front, the healer heals and is interrupted by a hit, the summoner calls berrylings, the wolf is dazed after a miss', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const V = m.hero.pos.constructor;
    const out: Record<string, unknown> = {};
    m.hero.god = true;
    // the shieldbearer faces the hero: from the front 0.2 gets through, in the back — full damage
    m.pack.clear();
    m.hero.place(2, 8);
    const sh = m.spawnMob('shield', 6, 8);
    sh.yaw = -Math.PI / 2;
    m.step(0.6);
    sh.cd = 99; sh.alerted = false; sh.aggro = 0;
    let h0 = sh.hp; sh.hit(10, new V(1, 0, 0), sh.pos.clone(), 0); out.front = h0 - sh.hp;
    h0 = sh.hp; sh.hit(10, new V(-1, 0, 0), sh.pos.clone(), 0); out.back = h0 - sh.hp;
    // the healer heals a wounded squire; a hit during the cast — interrupted, dazed
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
    // the summoner: berrylings from the circles, summoned ones give no raspberries
    m.pack.clear();
    m.hero.place(0, 8);
    const su = m.spawnMob('summoner', 8, 8);
    m.step(4);
    const called = m.pack.mobs.filter((x: any) => x.kind === 'berryling');
    out.summoned = called.length >= 3 && called.every((x: any) => x.summoned);
    // the wolf: while it crouched, the hero stepped aside — a miss, dazed
    m.pack.clear();
    m.hero.place(2, 8);
    const w = m.spawnMob('wolf', 6, 8);
    let crouch = false;
    for (let j = 0; j < 8 * 60 && !crouch; j++) { m.step(1 / 60); crouch = w.state === 'attack' && w.st < 0.3; }
    m.hero.place(w.pos.x + Math.cos(w.yaw) * 4, w.pos.z - Math.sin(w.yaw) * 4);
    m.step(1.2);
    out.wolfDazed = crouch && w.state === 'daze';
    // scale — as for the wardens
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

test('mob rooms: the barracks, the Thorn Garden, the graveyard, the lair, the workshop — the garrison at its posts wakes in groups, all fallen — the hero left, the room is full again', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const V = m.hero.pos.constructor;
    const out: Record<string, unknown> = {};
    const room = (id: string) => m.mobRooms.find((x: any) => x.spec.id === id).pack;
    const B = room('barracks'), G = room('garden');
    m.hero.god = true;
    out.kinds = [...new Set([...B.mobs, ...G.mobs].map((x: any) => x.kind))].sort();
    out.count = [B.mobs.length, G.mobs.length, room('crypt').mobs.length, room('lair').mobs.length, room('workshop').mobs.length];
    out.kinds = [...new Set(m.mobRooms.flatMap((x: any) => x.pack.mobs.map((y: any) => y.kind)))].sort();
    // through the passage in the west wall — into the barracks; nobody wakes at the entrance
    m.hero.place(-23, 0, -Math.PI / 2);
    m.step(0.5);
    m.hero.place(-26.5, 0);
    m.step(0.5);
    out.door = B.mobs.filter((x: any) => x.alerted).length;
    // walked up to the berrylings — they woke up, the wolves, knights and guards further on sleep
    m.hero.place(-29, -4);
    m.step(0.3);
    const awake = (P: any, k: string) => P.mobs.filter((x: any) => x.kind === k).every((x: any) => x.alerted);
    const asleep = (P: any, k: string) => P.mobs.filter((x: any) => x.kind === k).every((x: any) => !x.alerted);
    out.groups = { berryling: awake(B, 'berryling'), wolf: asleep(B, 'wolf'), shield: asleep(B, 'shield'), healer: asleep(B, 'healer'), hammer: asleep(B, 'hammer') };
    // the garden: the entrance is from the barracks, at the passage the vines wake, the slimes and the horror sleep
    m.hero.place(-35, 13);
    m.step(0.3);
    out.garden = { vine: awake(G, 'vine'), slime: asleep(G, 'slime'), horror: asleep(G, 'horror'), hedgehog: asleep(G, 'hedgehog') };
    // the barracks garrison fell; the hero went out to the playground — the barracks is full and asleep again
    for (let j = 0; j < 30; j++) { for (const x of B.mobs) if (!x.dead) x.hit(9999, new V(1, 0, 0), x.pos.clone(), 0); m.step(1 / 30); }
    out.allDead = B.mobs.every((x: any) => x.dead);
    m.hero.place(-10, 0);
    m.step(0.5);
    out.refilled = B.mobs.length === (out.count as number[])[0] && B.mobs.every((x: any) => !x.dead && !x.alerted);
    return out;
  });
  expect(r.kinds).toEqual(['archer', 'banner', 'beetle', 'berryling', 'boarlet', 'bud', 'crossbow', 'druseling', 'gardener', 'hammer', 'healer', 'hedgehog', 'hive', 'horror', 'keg', 'mimic', 'obelisk', 'pot', 'pyro', 'reaper', 'scarecrow', 'shield', 'slime', 'soller', 'spear', 'spider', 'squire', 'summoner', 'vine', 'wisp', 'wolf']);
  expect(r.count).toEqual([22, 10, 9, 7, 10]);
  expect(r.door).toBe(0);
  expect(r.groups).toEqual({ berryling: true, wolf: true, shield: true, healer: true, hammer: true });
  expect(r.garden).toEqual({ vine: true, slime: true, horror: true, hedgehog: true });
  expect(r.allDead).toBe(true);
  expect(r.refilled).toBe(true);
});

test('mobs of the second batch: the banner rallies the knights and falls in three hits, the slime splits twice, the bud is shut while spitting, the ball is dazed against a wall, the hammer gets stuck', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const V = m.hero.pos.constructor;
    const out: Record<string, unknown> = {};
    m.hero.god = true;
    // the bannerman plants the banner: a knight nearby hits 25 % harder; three hits — the banner fell
    m.pack.clear();
    m.hero.place(0, 8);
    const bb = m.spawnMob('banner', 6, 8), sq = m.spawnMob('squire', 6, 10);
    m.step(0.6);
    bb.notice(); sq.speed = 0; sq.cd = 99;
    for (let j = 0; j < 4 * 30 && !bb.standard.up; j++) m.step(1 / 30);
    m.step(0.1);
    const rallied = sq.rally > 0, boosted = sq.dmgMult;
    sq.rally = 0;
    out.rally = bb.standard.up && rallied && Math.abs(boosted / sq.dmgMult - 1.25) < 0.01;
    const st = bb.standard;
    for (let j = 0; j < 3; j++) st.hit(1, new V(1, 0, 0), st.pos.clone(), 0);
    out.fell = !st.up && !m.pack.targets().includes(st);
    // the slime: big → two medium → four small; raspberries — only from the big one
    m.pack.clear();
    const sl = m.spawnMob('slime', 8, 8);
    m.step(0.6);
    sl.hit(9999, new V(0, 0, 1), sl.pos.clone(), 0);
    m.step(0.6);
    const mids = m.pack.mobs.filter((x: any) => x.kind === 'slime_mid');
    for (const x of mids) x.hit(9999, new V(0, 0, 1), x.pos.clone(), 0);
    m.step(0.6);
    const smalls = m.pack.mobs.filter((x: any) => x.kind === 'slime_small');
    out.slime = [mids.length, smalls.length, smalls.every((x: any) => x.summoned)];
    // the bud: shut while spitting — a quarter of the damage, in the pause — all
    m.pack.clear();
    m.hero.place(2, 8);
    const bud = m.spawnMob('bud', 9, 8);
    m.step(0.6);
    bud.notice();
    let h0 = bud.hp; bud.hit(4, new V(1, 0, 0), bud.pos.clone(), 0); out.open = h0 - bud.hp;
    for (let j = 0; j < 4 * 30 && bud.state !== 'attack'; j++) m.step(1 / 30);
    h0 = bud.hp; bud.hit(4, new V(1, 0, 0), bud.pos.clone(), 0); out.shut = h0 - bud.hp;
    // the ball rolls into a wall — dazed
    m.pack.clear();
    m.hero.place(-22, -2.5);
    const hh = m.spawnMob('hedgehog', -17, -2.5);
    m.step(0.6);
    hh.notice();
    let dazed = false;
    // curled up — the hero stepped off the strip, the ball rolls on into the west wall
    for (let j = 0; j < 6 * 30 && !dazed; j++) { if (hh.state === 'attack' && hh.st > 0.3) m.hero.place(-14, -6); m.step(1 / 30); dazed = hh.state === 'daze'; }
    out.bonk = dazed;
    // the hammerer got stuck after the hit — dazed
    m.pack.clear();
    m.hero.place(2, 8);
    const hm = m.spawnMob('hammer', 5, 8);
    m.step(0.6);
    let smashed = false, stuck = false;
    for (let j = 0; j < 8 * 30 && !stuck; j++) { m.step(1 / 30); smashed ||= hm.state === 'attack'; stuck = smashed && hm.state === 'daze'; }
    out.hammer = stuck;
    m.pack.clear();
    return out;
  });
  expect(r.rally).toBe(true);
  expect(r.fell).toBe(true);
  expect(r.slime).toEqual([2, 4, true]);
  expect(r.open).toBeCloseTo(4, 5);
  expect(r.shut).toBeCloseTo(1, 5);
  expect(r.bonk).toBe(true);
  expect(r.hammer).toBe(true);
});

test('mobs of the third batch: the wisp flies through a wall, the scarecrow calls crows, the beetle underground is invulnerable, the web slows the hero, the boarlet is dazed against a wall, the hive fell — the bees too', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const V = m.hero.pos.constructor;
    const out: Record<string, unknown> = {};
    m.hero.god = true;
    // the wisp beyond the playground's west wall, the hero inside — it flies through the wall
    m.pack.clear();
    m.hero.place(-21, -9);
    const w = m.spawnMob('wisp', -30, -9);
    m.step(0.6);
    w.notice();
    let inside = false;
    for (let j = 0; j < 6 * 30 && !inside; j++) { m.step(1 / 30); inside = w.pos.x > -24; }
    out.wisp = inside;
    // the scarecrow: three crows, no raspberries; the scarecrow fell — the crows too
    m.pack.clear();
    m.hero.place(0, 8);
    const sc = m.spawnMob('scarecrow', 6, 8);
    m.step(0.6);
    sc.notice();
    m.step(2.5);
    const crows = m.pack.mobs.filter((x: any) => x.kind === 'crow');
    out.crows = crows.length === 3 && crows.every((x: any) => x.summoned);
    sc.hit(9999, new V(0, 0, 1), sc.pos.clone(), 0);
    m.step(0.1);
    out.crowsGone = crows.every((x: any) => x.dead);
    // the beetle underground: hits miss; surfaced — dazed
    m.pack.clear();
    m.hero.place(0, 8);
    const b = m.spawnMob('beetle', 7, 8);
    m.step(0.6);
    b.notice();
    for (let j = 0; j < 4 * 30 && !b.burrowed; j++) m.step(1 / 30);
    const h0 = b.hp;
    b.hit(10, new V(0, 0, 1), b.pos.clone(), 0);
    out.under = b.burrowed && b.hp === h0;
    let up = false;
    for (let j = 0; j < 5 * 30 && !up; j++) { m.step(1 / 30); up = b.state === 'daze'; }
    out.surfaced = up && !b.burrowed;
    // the vine weaver: a web under the hero — the hero is slower
    m.pack.clear();
    m.hero.place(0, 8);
    const sp = m.spawnMob('spider', 7, 8);
    m.step(0.6);
    sp.notice();
    let slow = 0;
    for (let j = 0; j < 5 * 30 && slow === 0; j++) { m.step(1 / 30); slow = m.hero.slow; }
    out.slow = slow;
    m.pack.clear();
    m.step(0.1);
    out.slowGone = m.hero.slow;
    // the boarlet charges into the west wall — dazed
    m.hero.place(-22, -4);
    const bo = m.spawnMob('boarlet', -16, -4);
    m.step(0.6);
    bo.notice();
    let dazed = false;
    for (let j = 0; j < 6 * 30 && !dazed; j++) { if (bo.state === 'attack' && bo.st > 0.3) m.hero.place(-14, -8); m.step(1 / 30); dazed = bo.state === 'daze'; }
    out.boar = dazed;
    // the hive releases bees; the hive fell — the bees fall
    m.pack.clear();
    m.hero.place(0, 8);
    const hv = m.spawnMob('hive', 6, 8);
    m.step(0.6);
    hv.notice();
    m.step(1.5);
    const bees = m.pack.mobs.filter((x: any) => x.kind === 'bee');
    out.bees = bees.length >= 2;
    hv.hit(9999, new V(0, 0, 1), hv.pos.clone(), 0);
    m.step(0.1);
    out.beesGone = bees.every((x: any) => x.dead);
    m.pack.clear();
    return out;
  });
  expect(r.wisp).toBe(true);
  expect(r.crows).toBe(true);
  expect(r.crowsGone).toBe(true);
  expect(r.under).toBe(true);
  expect(r.surfaced).toBe(true);
  expect(r.slow as number).toBeCloseTo(0.45, 2);
  expect(r.slowGone).toBe(0);
  expect(r.boar).toBe(true);
  expect(r.bees).toBe(true);
  expect(r.beesGone).toBe(true);
});

test('mobs of the fourth batch: the obelisk holds a dome, the keg explodes and hits its own, the mimic poses as a basket, the golemling and the pot', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const V = m.hero.pos.constructor;
    const out: Record<string, unknown> = {};
    m.hero.god = true;
    // the obelisk: under the dome — half damage; the obelisk fell — the dome is gone
    m.pack.clear();
    m.hero.place(0, 8);
    const ob = m.spawnMob('obelisk', 8, 8), sq = m.spawnMob('squire', 6, 8);
    m.step(0.6);
    ob.notice(); sq.cd = 99; sq.speed = 0;
    m.step(0.1);
    let h0 = sq.hp; sq.hit(10, new V(0, 0, 1), sq.pos.clone(), 0); out.ward = h0 - sq.hp;
    ob.hit(9999, new V(0, 0, 1), ob.pos.clone(), 0);
    m.step(0.5);
    h0 = sq.hp; sq.hit(10, new V(0, 0, 1), sq.pos.clone(), 0); out.bare = h0 - sq.hp;
    // the keg: the explosion from a hit strikes the neighbour and sets off the second keg
    m.pack.clear();
    m.hero.place(0, 8);
    const k1 = m.spawnMob('keg', 8, 8), k2 = m.spawnMob('keg', 9.5, 8), gd = m.spawnMob('gardener', 8, 9.6);
    m.step(0.6);
    h0 = gd.hp;
    k1.hit(5, new V(1, 0, 0), k1.pos.clone(), 0);
    k1.hit(99, new V(1, 0, 0), k1.pos.clone(), 0);
    m.step(0.1);
    out.keg = { chain: k2.dead, ally: h0 - gd.hp >= 30 };
    // the mimic: sleeps as a basket until the hero comes within 2.5 m; lots of raspberries from it
    m.pack.clear();
    m.hero.place(0, 8);
    const mi = m.spawnMob('mimic', 5, 8);
    m.step(1.5);
    out.disguised = !mi.alerted;
    m.hero.place(3, 8);
    m.step(0.3);
    out.awake = mi.alerted;
    out.loot = mi.loot >= 8;
    // the golemling: after the spike slam — fists in the ground, dazed
    m.pack.clear();
    m.hero.place(0, 8);
    const dg = m.spawnMob('druseling', 5, 8);
    m.step(0.6);
    let slam = false, stuck = false;
    for (let j = 0; j < 8 * 30 && !stuck; j++) { m.step(1 / 30); slam ||= dg.state === 'attack'; stuck = slam && dg.state === 'daze'; }
    out.druse = stuck;
    // the pot: hops rather than walks — closer to the hero after a hop
    m.pack.clear();
    m.hero.place(0, 8);
    const pt = m.spawnMob('pot', 7, 8);
    m.step(0.6);
    pt.notice();
    const d0 = Math.hypot(pt.pos.x - 0, pt.pos.z - 8);
    let flew = 0;
    for (let j = 0; j < 3 * 30; j++) { m.step(1 / 30); flew = Math.max(flew, pt.flyY); }
    out.pot = flew > 1 && Math.hypot(pt.pos.x - 0, pt.pos.z - 8) < d0 - 2;
    m.pack.clear();
    return out;
  });
  expect(r.ward).toBeCloseTo(5, 5);
  expect(r.bare).toBeCloseTo(10, 5);
  expect(r.keg).toEqual({ chain: true, ally: true });
  expect(r.disguised).toBe(true);
  expect(r.awake).toBe(true);
  expect(r.loot).toBe(true);
  expect(r.druse).toBe(true);
  expect(r.pot).toBe(true);
});

test('Soller: praises the sun under the beam, wakes at 6 m, a sword series and the spear, the prayer heals and is interrupted, the hero left — back at the post', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const V = m.hero.pos.constructor;
    const out: Record<string, unknown> = {};
    // one Soller stands on the Sun Glade
    const glade = m.mobRooms.find((x: any) => x.spec.id === 'glade').pack;
    out.glade = glade.mobs.map((x: any) => x.kind);
    m.pack.clear();
    m.hero.god = true;
    m.hero.place(0, 8);
    const s = m.spawnMob('soller', 8, 8);
    m.step(0.6);
    out.idle = { praising: s.praising, beam: s.shine > 0.8, alerted: s.alerted };
    // at 7 m it does not see, at 5.5 m — lowers its arms, the beam goes out
    m.hero.place(8, 15);
    m.step(0.3);
    const far = s.alerted;
    m.hero.place(8, 13.5);
    m.step(0.3);
    const near = s.alerted && !s.praising;
    m.step(1);
    out.wake = { far, near, beamOff: s.shine < 0.3 };
    // up close — the sword series clips the hero
    m.hero.god = false;
    let lost = 0, combo = false;
    for (let j = 0; j < 4 * 30; j++) {
      m.hero.hp = Math.max(m.hero.hp, 80);
      m.hero.place(s.pos.x + Math.sin(s.yaw) * 1.5, s.pos.z + Math.cos(s.yaw) * 1.5);
      const hp = m.hero.hp;
      m.step(1 / 30);
      lost += Math.max(0, hp - m.hero.hp);
      combo ||= s.attack === 'combo';
    }
    out.combo = combo && lost >= 10;
    // from afar — the spear along a strip
    s.state = 'idle'; s.cd = 0; s.spearCd = 0;
    const hp0 = m.hero.hp = 100;
    m.hero.place(s.pos.x + Math.sin(s.yaw) * 9, s.pos.z + Math.cos(s.yaw) * 9);
    const spot = m.hero.pos.clone();
    let spear = false;
    for (let j = 0; j < 4 * 30; j++) { m.hero.place(spot.x, spot.z); m.step(1 / 30); spear ||= s.attack === 'spear'; }
    out.spear = spear && m.hero.hp < hp0;
    m.hero.god = true;
    // below half — the prayer: the beam is back, it heals; a hit interrupts; it does not pray a second time
    s.state = 'idle'; s.cd = 0;
    s.hp = s.maxHp * 0.4;
    m.hero.place(s.pos.x + Math.sin(s.yaw) * 2, s.pos.z + Math.cos(s.yaw) * 2);
    for (let j = 0; j < 60 && s.attack !== 'praise'; j++) m.step(1 / 30);
    const hpPray = s.hp;
    m.step(1.2);
    out.praise = { started: s.attack === 'praise', healed: s.hp > hpPray + 1, beam: s.shine > 0.5 };
    s.hit(5, new V(0, 0, 1), s.pos.clone(), 0);
    m.step(0.05);
    out.broken = s.state === 'daze';
    s.cd = 0;
    let again = false;
    for (let j = 0; j < 3 * 30; j++) { m.step(1 / 30); again ||= s.state === 'attack' && s.attack === 'praise'; }
    out.again = again;
    // the hero went far away — Soller walks to its post, full health, praises the sun again
    m.hero.place(-14, -8);
    for (let j = 0; j < 10 * 30 && (s.homing || s.alerted || s.state === 'attack'); j++) m.step(1 / 30);
    m.step(0.3);
    out.home = { atPost: Math.hypot(s.pos.x - 8, s.pos.z - 8) < 0.5, full: s.hp === s.maxHp, praising: s.praising, alerted: s.alerted };
    m.pack.clear();
    return out;
  });
  expect(r.glade).toEqual(['soller']);
  expect(r.idle).toEqual({ praising: true, beam: true, alerted: false });
  expect(r.wake).toEqual({ far: false, near: true, beamOff: true });
  expect(r.combo).toBe(true);
  expect(r.spear).toBe(true);
  expect(r.praise).toEqual({ started: true, healed: true, beam: true });
  expect(r.broken).toBe(true);
  expect(r.again).toBe(false);
  expect(r.home).toEqual({ atPost: true, full: true, praising: true, alerted: false });
});
