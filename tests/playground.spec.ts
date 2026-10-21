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

test('тюремщики: тревога, низкое укрытие спасает присевшего, баллоны огнемётчика взрываются', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    m.resetTargets();
    const all = () => m.jailers;
    const asleep0 = all().every((j: any) => !j.awake && j.state === 'ест малину');
    // выстрел в стрелка будит его, он поднимает тревогу — просыпается весь пост
    const rifle = all().find((j: any) => j.kind === 'rifle');
    m.hero.place(rifle.pos.x - 8, rifle.pos.z - 4, 0);
    m.setAim(rifle.pos.x, rifle.pos.z);
    m.step(0.5);
    m.input.fire = true; m.step(1 / 60); m.input.fire = false;
    m.step(1.2);
    const awakeAfter = all().filter((j: any) => j.awake).length;

    // стрелок против героя за низким укрытием 0,9 м: стоя — получает, присев — нет
    const duel = (crouch: boolean) => {
      m.resetTargets(); m.hero.revive(); m.hero.god = false;
      m.hero.place(6, -9, 0); m.setAim(6, 0); m.step(0.1);
      if (crouch) { m.press('crouch'); m.step(1 / 60); }
      const j = m.jailers.find((x: any) => x.kind === 'rifle');
      j.hero.place(6, 1, Math.PI);
      m.wake('rifle');
      const others = m.jailers.filter((x: any) => x !== j);
      let lost = 0;
      for (let t = 0; t < 6; t += 1 / 60) {
        for (const o of others) o.awake = false;
        const hp = m.hero.hp;
        m.step(1 / 60);
        lost += Math.max(0, hp - m.hero.hp);
        if (m.hero.down) m.hero.revive();
      }
      if (crouch) { m.press('crouch'); m.step(1 / 60); }
      return { lost, shots: j.hero.gunner.shots };
    };
    const standing = duel(false);
    const crouched = duel(true);

    // огнемётчик: три пули в баллоны со спины — взрыв, огнемётчик погибает
    m.resetTargets(); m.hero.revive(); m.hero.god = true;
    const fl = m.jailers.find((x: any) => x.kind === 'flamer');
    m.freezeAI(true);
    const yaw = fl.hero.upperYaw;
    m.hero.place(fl.pos.x - Math.sin(yaw) * 2.2, fl.pos.z - Math.cos(yaw) * 2.2, 0);
    m.setAim(fl.pos.x, fl.pos.z); m.input.aimDown = true; m.step(0.6);
    for (let i = 0; i < 8 && !fl.tanks.exploded; i++) { m.input.fire = true; m.step(1 / 60); m.input.fire = false; m.step(0.4); }
    m.step(0.2);
    m.freezeAI(false);
    m.input.aimDown = false;
    const blast = { exploded: fl.tanks.exploded, dead: fl.hero.down };
    m.hero.god = false;
    m.resetTargets();
    return { asleep0, awakeAfter, standing, crouched, blast };
  });
  expect(r.asleep0).toBe(true);
  expect(r.awakeAfter).toBe(3);
  expect(r.standing.shots).toBeGreaterThan(0);
  expect(r.standing.lost).toBeGreaterThan(0);
  expect(r.crouched.shots).toBeGreaterThan(0);
  expect(r.crouched.lost).toBe(0);
  expect(r.blast).toEqual({ exploded: true, dead: true });
});

test('двустволка бросает гранату в засевшего героя, тюремщики убегают от гранат', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    m.resetTargets(); m.hero.revive(); m.hero.god = true;
    // герой засел за низким укрытием
    m.hero.place(6, -9, 0); m.setAim(6, 0); m.step(0.1);
    m.press('crouch'); m.step(1 / 60);
    const j = m.jailers.find((x: any) => x.kind === 'shotgun');
    j.hero.place(6, 2, Math.PI);
    m.wake('shotgun');
    const others = m.jailers.filter((x: any) => x !== j);
    let thrownAt = -1, landDist = -1;
    for (let t = 0; t < 8; t += 1 / 60) {
      for (const o of others) o.awake = false;
      m.step(1 / 60);
      const g = m.grenades.list[0];
      if (g && thrownAt < 0) thrownAt = t;
      if (g && landDist < 0 && g.vel.lengthSq() < 0.5) landDist = Math.hypot(g.pos.x - 6, g.pos.z + 9);
    }
    m.press('crouch'); m.step(1 / 60);
    const thrown = m.grenades.thrown, exploded = m.grenades.exploded;

    // граната у ног стрелка — он убегает за радиус
    m.resetTargets();
    const rifle = m.jailers.find((x: any) => x.kind === 'rifle');
    m.hero.place(0, 4, Math.PI);
    m.wake('rifle'); m.step(0.6);
    const p0 = rifle.pos.clone();
    m.grenades.throw(rifle.pos.clone().setY(1.5), rifle.pos.clone(), 2.5, 'тест');
    m.step(2.6);
    const fled = rifle.pos.distanceTo(p0);
    const rifleHp = rifle.hero.hp;
    m.hero.god = false;
    m.resetTargets();
    return { thrownAt, landDist, thrown, exploded, fled, rifleHp, eyes: true };
  });
  expect(r.thrown).toBeGreaterThan(0);
  expect(r.thrownAt).toBeLessThan(4);
  expect(r.landDist).toBeGreaterThanOrEqual(0);
  expect(r.landDist).toBeLessThan(4);
  expect(r.exploded).toBeGreaterThan(0);
  expect(r.fled).toBeGreaterThan(3);
  expect(r.rifleHp).toBe(100);
});

test('граната игрока на G: удержание — дальность, взрыв ранит манекен, гранат становится меньше', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    m.resetTargets(); m.hero.revive(); m.hero.grenades = 3;
    const d = m.dummies.find((x: any) => x.name === '10 м');
    m.hero.place(d.pos.x, 19, Math.PI);
    m.setAim(d.pos.x, d.pos.z);
    m.step(0.3);
    // короткое нажатие: граната летит лишь на 4–5 м
    m.input.grenade = true; m.step(0.1);
    const short = m.hero.grenadePreview ? m.hero.grenadePreview.distanceTo(m.hero.pos) : -1;
    // держим секунду: дальность растёт до курсора (10 м)
    m.step(1.0);
    const long = m.hero.grenadePreview ? m.hero.grenadePreview.distanceTo(m.hero.pos) : -1;
    m.input.grenade = false; m.step(1 / 60);
    const left = m.hero.grenades;
    m.step(0.7);
    const flying = m.grenades.list.length;
    m.step(3.2);
    return { short, long, left, flying, exploded: m.grenades.exploded, dmg: d.total, heroHp: m.hero.hp };
  });
  expect(r.short).toBeGreaterThan(3.5);
  expect(r.short).toBeLessThan(6);
  expect(r.long).toBeCloseTo(10, 0);
  expect(r.left).toBe(2);
  expect(r.flying).toBe(1);
  expect(r.exploded).toBe(1);
  expect(r.dmg).toBeGreaterThan(20);
  expect(r.heroHp).toBe(100);
});

test('склад: ящик с припасами на E, бочки взрываются цепочкой, ящики разбиваются, терминал лечит', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const m = (window as any).__malina;
    m.resetTargets(); m.hero.revive(); m.hero.god = false;
    const P = m.props;
    // ящик с припасами: подойти, E — крышка открыта, лут на полу, проходя — подобран
    const s = P.supplies[0];
    m.hero.place(s.pos.x + Math.sin(s.yaw) * 1.2, s.pos.z + Math.cos(s.yaw) * 1.2, 0);
    m.step(0.1);
    const berries0 = m.berries;
    m.interact(); m.step(0.3);
    const loot = P.pickups.length;
    m.step(1.2);
    for (const p of [...P.pickups]) { m.hero.place(p.pos.x, p.pos.z, 0); m.step(0.4); }
    const lootLeft = P.pickups.length, berries = m.berries - berries0;
    m.interact(); m.step(0.3);
    const reopenLoot = P.pickups.length;

    // бочки: стреляем в одну из тройки — взрываются три
    m.hero.god = true;
    const b = P.barrels[2];
    m.hero.place(b.pos.x, 4, Math.PI); m.setAim(b.pos.x, b.pos.z); m.input.aimDown = true; m.step(0.5);
    for (let i = 0; i < 6; i++) { m.input.fire = true; m.step(1 / 60); m.input.fire = false; m.step(0.15); }
    m.step(2);
    const barrelsLeft = P.barrels.filter((x: any) => !x.exploded).length;

    // деревянный ящик разбивается пулями, навигация пересобирается
    const c = P.crates[1];
    const ver0 = P.version;
    m.hero.place(c.pos.x, 9, 0); m.setAim(c.pos.x, c.pos.z); m.step(0.4);
    for (let i = 0; i < 12 && !c.broken; i++) { m.input.fire = true; m.step(1 / 60); m.input.fire = false; m.step(0.2); }
    m.input.aimDown = false;
    const crateBroken = c.broken, verChanged = P.version > ver0;

    // терминал: E лечит, пока стоишь рядом
    m.hero.god = false; m.hero.hp = 30;
    const t = P.terminals[0];
    m.hero.place(t.pos.x + Math.sin(t.yaw) * 1.0, t.pos.z + Math.cos(t.yaw) * 1.0, 0); m.step(0.1);
    m.interact(); m.step(1.0);
    const healed = m.hero.hp - 30;
    m.resetTargets(); m.hero.revive();
    return { loot, lootLeft, berries, reopenLoot, barrelsLeft, crateBroken, verChanged, healed };
  });
  expect(r.loot).toBe(7);
  expect(r.lootLeft).toBe(0);
  expect(r.berries).toBe(10);
  expect(r.reopenLoot).toBe(0);
  expect(r.barrelsLeft).toBe(2);
  expect(r.crateBroken).toBe(true);
  expect(r.verChanged).toBe(true);
  expect(r.healed).toBeGreaterThan(20);
});
