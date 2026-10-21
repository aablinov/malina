import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Этап 0: плейграунд открывается, герой проходит 10 м по клеткам, стреляет по манекену на 10 м,
 * урон и расход патронов сходятся с tuning.ts.
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

test('проходит 10 м и стреляет по манекену на 10 м', async ({ page }) => {
  await open(page);

  // старт: 10 м правее мишени «10 м», на огневом рубеже
  const walk = await page.evaluate(() => {
    const m = (window as any).__malina;
    const target = m.dummies.find((d: any) => d.name === '10 м');
    const x0 = target.pos.x + 10, z0 = 19;
    m.hero.place(x0, z0, Math.PI);
    m.setAim(target.pos.x, target.pos.z);
    m.step(0.5);
    // идём на −X, пока не пройдём 10 м по полу
    const speed = m.HERO.walk * 0.95; // АК-74 — средний вес
    m.input.move.set(-1, 0);
    let maxSpeed = 0;
    const T = 10 / speed;
    for (let t = 0; t < T; t += 0.05) { m.step(0.05); maxSpeed = Math.max(maxSpeed, m.hero.speed); }
    m.input.move.set(0, 0);
    m.step(0.4);
    return { dx: x0 - m.hero.pos.x, dz: Math.abs(m.hero.pos.z - z0), maxSpeed, speed, state: m.hero.state };
  });
  expect(walk.dx).toBeGreaterThan(9.7);
  expect(walk.dx).toBeLessThan(10.3);
  expect(walk.dz).toBeLessThan(0.05);
  expect(walk.maxSpeed).toBeCloseTo(walk.speed, 1);
  expect(walk.state).toBe('стоит');

  // стрельба одиночными в прицеле: раскачка успевает спасть
  const fire = await page.evaluate(() => {
    const m = (window as any).__malina;
    const target = m.dummies.find((d: any) => d.name === '10 м');
    m.setAim(target.pos.x, target.pos.z);
    m.input.aimDown = true;
    m.step(0.6);
    const gun = m.hero.gun;
    const rounds0 = gun.rounds, shots0 = m.hero.gunner.shots, reserve0 = m.hero.gunner.reserve['545'];
    for (let i = 0; i < 6; i++) { m.input.fire = true; m.step(1 / 60); m.input.fire = false; m.step(0.45); }
    const res = {
      shots: m.hero.gunner.shots - shots0, spent: rounds0 - gun.rounds, hits: target.hits, total: target.total,
      dmg: m.GUNS.ak74.dmg, others: m.dummies.filter((d: any) => d !== target).reduce((a: number, d: any) => a + d.hits, 0),
      reserveBefore: reserve0, rounds: gun.rounds,
    };
    // перезарядка: тактическая, магазин 30 + патрон в патроннике
    m.press('reload');
    m.step(m.GUNS.ak74.reloadTac + 0.2);
    return { ...res, afterReload: gun.rounds, reserveAfter: m.hero.gunner.reserve['545'] };
  });
  expect(fire.shots).toBe(6);
  expect(fire.spent).toBe(6);
  expect(fire.hits).toBe(6);
  expect(fire.others).toBe(0);
  expect(fire.total).toBeCloseTo(fire.hits * fire.dmg, 5);
  expect(fire.afterReload).toBe(31);
  expect(fire.reserveBefore - fire.reserveAfter).toBe(6);
});

test('бег, присед, перекат и выносливость', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    const H = m.HERO;
    const measure = (setup: () => void, sec = 1.2): number => {
      m.hero.place(0, 4, Math.PI);
      m.step(0.3);
      setup();
      m.input.move.set(1, 0);
      m.step(0.4);
      const x0 = m.hero.pos.x;
      m.step(sec);
      const v = (m.hero.pos.x - x0) / sec;
      m.input.move.set(0, 0); m.input.run = false; m.input.aimDown = false;
      if (m.hero.crouched) { m.press('crouch'); m.step(1 / 60); }
      m.step(0.5);
      return v;
    };
    m.setAim(0, -20);
    const walk = measure(() => {});
    const run = measure(() => { m.input.run = true; });
    const crouch = measure(() => { m.press('crouch'); m.step(1 / 60); });
    const aim = measure(() => { m.input.aimDown = true; });
    // перекат
    m.hero.place(0, 4, Math.PI); m.step(1.5);
    const st0 = m.hero.stamina;
    m.input.move.set(1, 0); m.press('roll'); m.step(1 / 60); m.input.move.set(0, 0);
    const x0 = m.hero.pos.x;
    m.step(H.rollTime + 0.3);
    return { walk, run, crouch, aim, roll: m.hero.pos.x - x0, rollCost: st0 - m.hero.stamina, H };
  });
  const w = 0.95;
  expect(r.walk).toBeCloseTo(r.H.walk * w, 1);
  expect(r.run).toBeCloseTo(r.H.run * w, 1);
  expect(r.crouch).toBeCloseTo(r.H.crouch * w, 1);
  expect(r.aim).toBeCloseTo(r.H.aim * w, 1);
  expect(r.roll).toBeGreaterThan(r.H.rollDist - 0.2);
  expect(r.rollCost).toBeGreaterThan(r.H.rollCost - 5);
});

test('арахниды: спят в загоне, просыпаются от выстрела, уклоняются и не прыгают через стены', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    m.resetTargets();
    const asleep0 = m.enemies.filter((e: any) => !e.awake).length;
    const warrior = m.arachnids.find((a: any) => a.kind === 'warrior');
    // один выстрел по воину будит только его
    m.hero.place(warrior.pos.x, 2, Math.PI);
    m.setAim(warrior.pos.x, warrior.pos.z);
    m.step(0.4);
    m.input.fire = true; m.step(1 / 60); m.input.fire = false; m.step(0.1);
    const awakeAfterShot = m.enemies.filter((e: any) => e.awake).map((e: any) => e.spec.kind);

    // бой: герой целится с запаздыванием 0,25 с и стреляет очередями
    const crossings = { n: 0 };
    const check = (a: any, p: any) => {
      const dx = a.pos.x - p.x, dz = a.pos.z - p.z, d = Math.hypot(dx, dz);
      if (d > 1e-4 && m.raycast(p.x, p.z, dx / d, dz / d, d)) crossings.n++;
    };
    m.hero.gunner.infinite = true;
    const hist: any[] = [];
    for (let t = 0; t < 6 && !warrior.dead; t += 1 / 60) {
      hist.push(warrior.pos.clone());
      const lag = hist[Math.max(0, hist.length - 15)];
      m.setAim(lag.x, lag.z);
      m.input.fire = (t % 0.8) < 0.4;
      const p = warrior.pos.clone();
      m.step(1 / 60);
      check(warrior, p);
      if (m.hero.down) m.hero.revive();
    }
    m.input.fire = false;
    const dodges = warrior.dodges;

    // прыгун за низким укрытием: прыгать через него нельзя, только обходить
    m.resetTargets();
    m.hero.revive();
    const leaper = m.arachnids.find((a: any) => a.kind === 'leaper');
    m.hero.place(6, -6.6, Math.PI);
    leaper.pos.set(6, 0, -9.6);
    m.wake('leaper');
    for (let t = 0; t < 5; t += 1 / 60) {
      const p = leaper.pos.clone();
      m.step(1 / 60);
      check(leaper, p);
      if (m.hero.down) m.hero.revive();
    }
    m.resetTargets();
    const asleepAfterReset = m.enemies.filter((e: any) => !e.awake).length;
    return { asleep0, total: m.enemies.length, awakeAfterShot, dodges, crossings: crossings.n, asleepAfterReset };
  });
  expect(r.asleep0).toBe(r.total);
  expect(r.awakeAfterShot).toEqual(['warrior']);
  expect(r.dodges).toBeGreaterThan(0);
  expect(r.crossings).toBe(0);
  expect(r.asleepAfterReset).toBe(r.total);
});
