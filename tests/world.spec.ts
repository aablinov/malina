import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Open world by regions (src/world/, wiki/dev-performance.md): 32 × 32 m regions load around the hero and
 * unload beyond the radius with a delay; a broken crate and an opened chest do not come back after unloading
 * or after a page reload; the region's map exploration is saved too.
 */

const URL = pathToFileURL(resolve('dist/index.html')).href + '?dev=playground&map=world&seed=42';

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  await page.evaluate(() => (window as any).__malina.script(true));
  await page.evaluate(() => (window as any).__malina.ready);
  return errors;
}

test('world: regions load around the hero, unload beyond the radius, the mesher fits the budget', async ({ page }) => {
  const errors = await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, R = m.regions;
    const at0 = { regions: R.keys.length, chunks: m.level.chunks.size, has: R.has(1, 4) && R.has(60, 4) && !R.has(100, 4) };
    // determinism: the same region — the same items
    const near = (i: string) => /^(-?[01]),(-?[01]):/.test(i);
    const ids0 = m.props.crates.map((c: any) => c.id).filter(near).sort().join(';');
    // walk east 160 m in 2 m steps, as in the game; each step — 4 ticks and a frame
    const frames: number[] = [];
    for (let x = 1; x <= 160; x += 2) {
      const t0 = performance.now(); m.hero.place(x, 4, Math.PI); m.step(4 / 60); m.render(); frames.push(performance.now() - t0);
    }
    const mid = { regions: R.keys.length, loads: R.stats.loads, unloads0: R.stats.unloads, hasFar: R.has(159, 4), hasStart: R.has(1, 4) };
    // after 6 s the regions at the start are unloaded (unload radius 3, delay 5 s)
    m.step(6); m.render();
    const after = { regions: R.keys.length, unloads: R.stats.unloads, hasStart: R.has(1, 4), hasFar: R.has(159, 4), chunks: m.level.chunks.size, pending: m.view.pending };
    // back to the start — the same crates with the same ids
    for (let x = 159; x >= 1; x -= 2) { m.hero.place(x, 4, Math.PI); m.step(4 / 60); m.render(); }
    m.step(6); m.render();
    const ids1 = m.props.crates.map((c: any) => c.id).filter(near).sort().join(';');
    const back = { same: ids0 === ids1 && ids1.length > 0, hasStart: R.has(1, 4) };
    frames.sort((a, b) => a - b);
    return { at0, mid, after, back, maxStep: frames[frames.length - 1], medianStep: frames[frames.length >> 1] };
  });
  expect(errors).toEqual([]);
  expect(r.at0.regions).toBe(25);
  expect(r.at0.has).toBe(true);
  expect(r.mid.hasFar).toBe(true);
  expect(r.mid.loads).toBeGreaterThan(25);
  expect(r.after.hasStart).toBe(false);
  expect(r.after.unloads).toBeGreaterThan(0);
  expect(r.after.regions).toBeLessThanOrEqual(49);
  expect(r.after.pending).toBe(0);
  expect(r.back.same).toBe(true);
  console.log(`[world] 2 m step with generation and meshing: median ${r.medianStep.toFixed(1)} ms, max ${r.maxStep.toFixed(1)} ms; regions ${r.at0.regions} → ${r.mid.regions} → ${r.after.regions}`);
});

test('world: a broken crate and an opened chest do not come back after unloading and reload, the map remembers the exploration', async ({ page }) => {
  await open(page);
  const first = await page.evaluate(() => {
    const m = (window as any).__malina, R = m.regions;
    m.hero.god = true;
    // the crate closest to the start and the closest chest among the loaded regions
    const crate = m.props.crates.slice().sort((a: any, b: any) => a.pos.length() - b.pos.length())[0];
    const chest = m.props.supplies.slice().sort((a: any, b: any) => a.pos.length() - b.pos.length())[0];
    const V = m.hero.pos.constructor;
    crate.hit(9999, new V(0, 0, 1), crate.pos.clone(), 0); m.step(0.5);
    m.hero.place(chest.pos.x + 1.2, chest.pos.z); m.step(0.1); m.interact(); m.step(3);
    const explored0 = m.automap.explored;
    const seenAtStart = m.automap.isSeen(1, 4);
    // go beyond the unload radius and come back
    m.hero.place(200, 4, Math.PI); m.step(0.2); m.render(); m.step(6); m.render();
    const gone = !R.has(crate.pos.x, crate.pos.z);
    m.hero.place(1, 4, Math.PI); m.step(0.2); m.render(); m.step(1); m.render();
    const crateBack = m.props.crates.some((c: any) => c.id === crate.id);
    const chestBack = m.props.supplies.some((c: any) => c.id === chest.id);
    R.save();
    return { crateId: crate.id, chestId: chest.id, broken: crate.broken, opened: chest.opened, gone, crateBack, chestBack, explored0, seenAtStart };
  });
  expect(first.broken).toBe(true);
  expect(first.opened).toBe(true);
  expect(first.gone).toBe(true);
  expect(first.crateBack).toBe(false);
  expect(first.chestBack).toBe(false);
  expect(first.seenAtStart).toBe(true);
  // reload: the world state comes from localStorage
  await page.reload();
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  const second = await page.evaluate((ids) => {
    const m = (window as any).__malina;
    m.script(true);
    return {
      crateBack: m.props.crates.some((c: any) => c.id === ids.crateId),
      chestBack: m.props.supplies.some((c: any) => c.id === ids.chestId),
      others: m.props.crates.length > 0,
      seenAtStart: m.automap.isSeen(1, 4),
      saved: JSON.parse(localStorage.getItem('malina.world.42') || '{}'),
    };
  }, first);
  expect(second.crateBack).toBe(false);
  expect(second.chestBack).toBe(false);
  expect(second.others).toBe(true);
  expect(second.seenAtStart).toBe(true);
  expect(second.saved.regions[first.crateId.split(':')[0]]?.dead).toContain(first.crateId);
  expect(second.saved.regions[first.chestId.split(':')[0]]?.dead).toContain(first.chestId);
});

/** A fixed map as the source of regions: a dungeon floor 160 × 160 m (5 × 5 rooms), chests come from the map's entities */
const DUNGEON = pathToFileURL(resolve('dist/index.html')).href + '?dev=playground&map=dungeon&seed=42&floor=2&stream=1';

test('map: a dungeon floor streams by regions, chests from the entities, an opened one does not come back', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(DUNGEON);
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  const r = await page.evaluate(async () => {
    const m = (window as any).__malina, R = m.regions; m.script(true); await m.ready;
    m.hero.god = true;
    const start = { regions: R.keys.length, chunks: m.level.chunks.size, chests: m.props.supplies.length, spawnOk: m.level.spawn !== null, onFloor: Math.abs(m.hero.pos.y - 0) < 0.6 };
    const chest = m.props.supplies.slice().sort((a: any, b: any) => a.pos.distanceTo(m.hero.pos) - b.pos.distanceTo(m.hero.pos))[0];
    if (!chest) return { start, noChest: true };
    const heroAt = m.hero.pos.clone();
    m.hero.place(chest.pos.x + 1.2, chest.pos.z, 0, chest.pos.y); m.step(0.1); m.interact(); m.step(3);
    const opened = chest.opened;
    // to the far corner of the floor (160 m) and back: the chest's region unloads and loads again
    const far = { x: chest.pos.x > 80 ? 2 : 158, z: chest.pos.z > 80 ? 2 : 158 };
    m.hero.place(far.x, far.z); m.step(0.3); m.render(); m.step(6); m.render();
    const gone = !R.has(chest.pos.x, chest.pos.z);
    m.hero.place(heroAt.x, heroAt.z); m.step(0.3); m.render(); m.step(1); m.render();
    const back = m.props.supplies.some((c: any) => c.id === chest.id);
    const decorBack = m.level.decor.length;
    R.save();
    return { start, chestId: chest.id, opened, gone, back, decorBack, unloads: R.stats.unloads, loads: R.stats.loads };
  });
  expect(errors).toEqual([]);
  expect((r as any).noChest).toBeUndefined();
  expect(r.start.spawnOk).toBe(true);
  expect(r.start.chests).toBeGreaterThan(0);
  expect(r.opened).toBe(true);
  expect(r.gone).toBe(true);
  expect(r.back).toBe(false);
  expect(r.unloads).toBeGreaterThan(0);
  await page.reload();
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  const again = await page.evaluate((id) => {
    const m = (window as any).__malina; m.script(true);
    return { back: m.props.supplies.some((c: any) => c.id === id), others: m.props.supplies.length };
  }, r.chestId);
  expect(again.back).toBe(false);
  console.log(`[world] floor: regions ${r.start.regions}, chunks ${r.start.chunks}, chests ${r.start.chests} → after returning ${again.others}; loads ${r.loads}, unloads ${r.unloads}`);
});
