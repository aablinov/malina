import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Expeditions (wiki/design-expeditions.md): a mission on a seeded map — `?map=expedition&seed=N&obj=…&d=…`. The hero lands,
 * lights and holds the beacons with F (src/sim/expedition.ts), carries a seed to the pad, calls the balloon and leaves
 */

const URL = (q: string): string => pathToFileURL(resolve('dist/index.html')).href + `?dev=playground&map=expedition&${q}`;

async function open(page: Page, q: string): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL(q), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  await page.evaluate(async () => { const m = (window as any).__malina; m.script(true); await m.ready; });
  expect(errors).toEqual([]);
}

test('expedition: the map of a seed — landings, lairs, beacons, the pad; the hero stands on a landing, far garrisons sleep', async ({ page }) => {
  await open(page, 'seed=3&obj=beacons&d=2');
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, e = m.exp, s = e.sim, land = s.spec.landings[0];
    m.step(0.5);
    return {
      name: m.level.name, kind: s.spec.objective.kind, landings: s.spec.landings.length, beacons: s.beacons.length, lairs: s.nests.length,
      onLanding: Math.hypot(m.hero.pos.x - land.x, m.hero.pos.z - land.z) < 2,
      asleep: e.pack.mobs.filter((x: any) => x.asleep).length, total: e.pack.mobs.length, markers: e.ui.markers().length,
    };
  });
  expect(r).toMatchObject({ name: 'Expedition', kind: 'beacons', landings: 3, beacons: 3, onLanding: true });
  expect(r.lairs).toBeGreaterThanOrEqual(3);
  expect(r.asleep).toBeGreaterThan(0);
  expect(r.asleep).toBeLessThanOrEqual(r.total);
  expect(r.markers).toBeGreaterThan(5);
});

test('expedition: F lights a beacon, holding it completes a step; all lit — the balloon is called, lands and takes the hero with his seed', async ({ page }) => {
  await open(page, 'seed=3&obj=beacons&d=1');
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, e = m.exp, s = e.sim;
    const posted = e.pack.mobs.length;
    /** n seconds with the hero kept at a point and the raiders falling — the test is about the mission, not the fight */
    const hold = (p: { x: number; z: number }, sec: number): void => {
      for (let i = 0; i < sec * 4; i++) {
        m.hero.hp = m.hero.maxHp;
        m.hero.place(p.x + 1.5, p.z, 0, e.world.floor(p.x + 1.5, p.z, 2));
        for (const mob of e.pack.mobs) if (mob.net > posted && !mob.dead) mob.hit(99999, mob.pos.clone().set(0, 0, 1), mob.pos, 0);
        m.step(0.25);
      }
    };
    // the pad before the objective: the hint says the balloon will not come
    hold(s.extraction.pos, 0.5);
    const early = { prompt: e.ui.prompt(), used: e.use() };
    // a point of interest with a seed
    const poi = s.spec.pois.find((q: any) => q.seed);
    hold({ x: poi.x - 1.5, z: poi.z }, 0.5);
    const bag = { ...s.carriedOf(0) }, berries = m.berries;
    // the beacons
    const first = s.beacons[0];
    hold(first.pos, 0.5);
    const prompt = e.ui.prompt();
    m.interact();
    hold(first.pos, 3);
    const lighting = { state: first.state, charge: first.charge };
    for (const b of s.beacons) { hold(b.pos, 0.5); if (b.state === 'dark') e.use(); hold(b.pos, 21); }
    const lit = s.beacons.map((b: any) => b.state), primary = s.primary;
    // the balloon
    hold(s.extraction.pos, 0.5);
    const call = { prompt: e.ui.prompt(), used: e.use(), state: s.extraction.state, hud: e.ui.el.textContent };
    hold(s.extraction.pos, 92);
    return { early, bag, seed: poi.seed, berries, poiBerries: poi.berries, prompt, lighting, lit, primary, call, state: s.state, banked: s.bankedOf(0), loot: s.lootOf(0), pad: s.extraction.state };
  });
  expect(r.early.used).toBe(false);
  expect(r.early.prompt).toBeTruthy();
  expect(r.bag[r.seed]).toBe(1);
  expect(r.berries).toBe(r.poiBerries);
  expect(r.prompt).toBeTruthy();
  expect(r.lighting.state).toBe('lighting');
  expect(r.lighting.charge).toBeGreaterThan(2);
  expect(r.lit).toEqual(['lit', 'lit', 'lit']);
  expect(r.primary).toBe(true);
  expect(r.call.used).toBe(true);
  expect(r.call.state).toBe('called');
  expect(r.call.hud).toMatch(/\d/);
  expect(r.state).toBe('won');
  expect(r.pad).toBe('gone');
  expect(r.banked[r.seed]).toBe(1);
  expect(r.loot).toBeGreaterThan(0);
});

test('expedition: a lair falls to the sword and counts; the same seed builds the same map', async ({ page }) => {
  await open(page, 'seed=8&obj=lairs&d=1');
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, e = m.exp, s = e.sim, n = s.nests[0];
    const before = { done: s.done, goal: s.goal, targets: e.targets().includes(n) };
    n.hit(99999);
    m.step(0.2);
    return { before, done: s.done, dead: n.dead, sites: JSON.stringify(s.spec.lairs) };
  });
  expect(r.before).toEqual({ done: 0, goal: expect.any(Number), targets: true });
  expect(r.done).toBe(1);
  expect(r.dead).toBe(true);
  await open(page, 'seed=8&obj=lairs&d=1');
  expect(await page.evaluate(() => JSON.stringify((window as any).__malina.exp.sim.spec.lairs))).toBe(r.sites);
});

test('expedition: parcels — Z calls a tower that lands near the hero and stands in the HUD on cooldown; totems and the alarm are shown', async ({ page }) => {
  await open(page, 'seed=3&obj=lairs&d=1');
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, e = m.exp, s = e.sim;
    m.step(0.2);
    const hud0 = e.ui.el.textContent as string;
    const ok = s.command(0, { t: 'exp', a: 'parcel', slot: 0, x: m.hero.pos.x + 4, z: m.hero.pos.z });
    m.step(0.5);
    const flying = e.world.entities().some((x: any) => /^parcel\d+$/.test(x.id));
    m.step(3);
    const towers = s.parcels.towers.length, record = e.world.entities().find((x: any) => /^t\d+$/.test(x.id));
    m.step(0.2);
    return { hud0, ok, flying, towers, kind: record?.kind, cd: s.parcels.cooldowns(0)[0], hud: e.ui.el.textContent as string, again: s.command(0, { t: 'exp', a: 'parcel', slot: 0, x: m.hero.pos.x + 4, z: m.hero.pos.z }), totems: s.totems };
  });
  expect(r.hud0).toMatch(/Z .*X .*C /);
  expect(r.hud0).toContain('Totems');
  expect(r).toMatchObject({ ok: true, flying: true, towers: 1, kind: 'arrow', again: false, totems: 4 });
  expect(r.cd).toBeGreaterThan(60);
  expect(r.hud).toMatch(/Archer tower \d+/);
});
