import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Перф-сценарии (wiki/dev-performance.md): смерть финального стража на 30 уровне с 4 игроками и шквал заклинаний.
 * WebGL здесь программный (SwiftShader), поэтому абсолютные миллисекунды условны: ловим подлагивания относительно
 * медианы кадра, утечки геометрий и рост числа шейдерных программ после прогрева. Порог — PERF_MAX_MS (по умолчанию 40 мс).
 */

const URL = pathToFileURL(resolve('dist/index.html')).href + '?dev=playground';
const MAX_MS = Number(process.env.PERF_MAX_MS || 40);
/** Время кадра имеет смысл только на настоящем GPU (PERF_GPU=1, см. playwright.config.ts); в SwiftShader проверяем утечки и программы */
const GPU = !!process.env.PERF_GPU;
/** В SwiftShader кадр рисуется секунды — рисуем каждый четвёртый, утечкам и программам этого хватает */
const RENDER_EVERY = GPU ? 1 : 4;

test.setTimeout(600_000);

interface Frame { ms: number; tick: number; render: number; marks: string[] }
interface Report { frames: Frame[]; programs0: number; programs1: number; geo0: number; geo1: number; tex0: number; tex1: number }

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  await page.evaluate(() => (window as any).__malina.script(true));
  // прогрев шейдеров и текстур (src/fx-zoo.ts) — до замеров
  const t0 = Date.now();
  const programs = await page.evaluate(() => (window as any).__malina.ready);
  console.log(`[perf] прогрев: ${programs} программ, ${Date.now() - t0} мс после старта страницы`);
  return errors;
}

/** Сводка: медиана, максимум, число длинных кадров (дольше порога и втрое дольше медианы) */
function summarize(frames: Frame[]) {
  const ms = frames.map((f) => f.ms).sort((a, b) => a - b);
  const median = ms[Math.floor(ms.length / 2)] ?? 0;
  const limit = Math.max(MAX_MS, median * 3);
  const long = frames.filter((f) => f.ms > limit);
  return { median, max: ms[ms.length - 1] ?? 0, limit, long, p95: ms[Math.floor(ms.length * 0.95)] ?? 0 };
}

function log(name: string, r: Report): ReturnType<typeof summarize> {
  const s = summarize(r.frames);
  const worst = s.long.slice().sort((a, b) => b.ms - a.ms).slice(0, 5).map((f) => `${f.ms.toFixed(0)}мс (сим ${f.tick.toFixed(0)}, рендер ${f.render.toFixed(0)}${f.marks.length ? `, ${f.marks.join('+')}` : ''})`);
  console.log(`[perf] ${name}: кадров ${r.frames.length}, медиана ${s.median.toFixed(1)} мс, p95 ${s.p95.toFixed(1)}, макс ${s.max.toFixed(1)}, длинных ${s.long.length} (порог ${s.limit.toFixed(0)});`
    + ` программ ${r.programs0}→${r.programs1}, геометрий ${r.geo0}→${r.geo1}, текстур ${r.tex0}→${r.tex1}${worst.length ? `; худшие: ${worst.join('; ')}` : ''}`);
  return s;
}

/** Код в странице: прогнать n кадров симуляции с рендером, замеряя стенное время каждого */
const RUN = `
  const RENDER_EVERY = ${RENDER_EVERY};
  const run = (n, between) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      if (between) between(i);
      const t0 = performance.now(); m.step(1 / 60); const t1 = performance.now(); if (i % RENDER_EVERY === 0) m.render(); const t2 = performance.now();
      const f = m.perf.snapshot().long.at(-1);
      out.push({ ms: t2 - t0, tick: t1 - t0, render: t2 - t1, marks: f && f.t > lastLong ? f.marks : [] });
      if (f) lastLong = f.t;
    }
    return out;
  };
  const counts = () => ({ programs: m.renderer.info.programs.length, geo: m.renderer.info.memory.geometries, tex: m.renderer.info.memory.textures });
`;

test('перф: смерть финального стража на 30 уровне × 4 игрока — без подлагиваний и утечек', async ({ page }) => {
  const errors = await open(page);
  const r = await page.evaluate<Report>(`(() => {
    const m = window.__malina; let lastLong = -1;
    ${RUN}
    m.hero.god = true;
    m.bossScale(30, 4);
    const id = m.bossIds.includes('gardener') ? 'gardener' : m.bossIds[m.bossIds.length - 1];
    const k = m.bossIds.indexOf(id), boss = m.bosses[k], arena = m.arenas[k];
    m.toBoss(id);
    const t = arena.spec.trigger;
    m.hero.place((t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2);
    run(30); // прогрев: арена закрылась, страж проснулся
    const c0 = counts();
    const V = m.hero.pos.constructor;
    const frames = [];
    // добить: удар до смерти, затем 4 с — фонтан, гримуары, подбор ягод
    for (let j = 0; j < 240 && !boss.dead; j++) { boss.hit(99999, new V(0, 0, 1), boss.pos.clone(), 0); if (!boss.dead) m.step(1 / 60); }
    frames.push(...run(120));
    // герой ходит по ягодам — подбор с эффектами
    frames.push(...run(180, (i) => {
      if (i % 20 !== 0) return;
      const ps = m.props.pickups.filter((p) => p.kind === 'berry');
      if (ps.length) m.hero.place(ps[0].pos.x, ps[0].pos.z);
    }));
    const left = m.props.pickups.length;
    m.step(5); m.render();
    const c1 = counts();
    return { frames, programs0: c0.programs, programs1: c1.programs, geo0: c0.geo, geo1: c1.geo, tex0: c0.tex, tex1: c1.tex, left, berries: boss.berries };
  })()`);
  expect(errors).toEqual([]);
  const s = log(`смерть стража (ягод ${(r as any).berries}, осталось на полу ${(r as any).left})`, r);
  if (GPU) expect(s.long.length, `длинные кадры: ${s.long.map((f) => f.ms.toFixed(0)).join(', ')}`).toBe(0);
  // гримуары и оставшиеся ягоды держат геометрии; утечка — когда геометрий стало больше, чем объектов на полу
  expect(r.geo1 - r.geo0).toBeLessThanOrEqual((r as any).left * 4 + 40);
});

test('перф: шквал заклинаний всех школ — программы не растут, кадры ровные', async ({ page }) => {
  const errors = await open(page);
  const r = await page.evaluate<Report & { casts: number }>(`(() => {
    const m = window.__malina; let lastLong = -1;
    ${RUN}
    const ids = ['fireball', 'spark', 'icerain', 'heal', 'meteor', 'flameserpent', 'ashcrown', 'icetomb', 'frostridge', 'absolutezero', 'thunderspear', 'thunderleap',
      'stormcloud', 'starfall', 'starbeam', 'judgement', 'deadchoir', 'gravitywell', 'skullscythe', 'fallenguards', 'rift', 'raspberrybush', 'titanform', 'bladephalanx'];
    const p = m.profile;
    m.hero.god = true;
    const d = m.dummies.find((x) => x.name === 'одиночное');
    m.hero.place(d.pos.x + 3.5, d.pos.z, -Math.PI / 2);
    run(30);
    const c0 = counts();
    const frames = []; let casts = 0;
    const round = (measure) => {
      for (const id of ids) {
        p.data.souls = 100;
        const it = p.data.items.find((x) => x.def === id) || p.add(id, 1, false);
        p.equip(it.uid, 0);
        m.gear.artT[0][0] = 0;
        if (m.artifact(0, d.pos.x, d.pos.z, 1) && measure) casts++;
        const fs = run(20);
        if (measure) frames.push(...fs);
      }
      if (measure) frames.push(...run(120));
      // долгие заклинания (туча, руки, купол) живут до 10 с — ждём, пока всё растает
      m.step(12); m.render();
      return counts();
    };
    const c1 = round(true);
    // второй круг: общие геометрии и текстуры уже созданы — любой рост теперь утечка
    const c2 = round(false);
    return { frames, casts, programs0: c0.programs, programs1: c2.programs, geo0: c1.geo, geo1: c2.geo, tex0: c0.tex, tex1: c2.tex, firstRound: c1.geo - c0.geo };
  })()`);
  expect(errors).toEqual([]);
  const s = log(`шквал заклинаний (кастов ${r.casts})`, r);
  expect(r.casts).toBeGreaterThanOrEqual(20);
  if (GPU) expect(s.long.length, `длинные кадры: ${s.long.map((f) => f.ms.toFixed(0)).join(', ')}`).toBe(0);
  // после прогрева при загрузке новые шейдерные программы в бою не должны появляться
  expect(r.programs1 - r.programs0).toBeLessThanOrEqual(0);
  // второй круг заклинаний не должен добавлять геометрий (первый создаёт общие — это не утечка)
  console.log(`[perf] общих геометрий после первого круга: +${(r as any).firstRound}`);
  expect(r.geo1 - r.geo0).toBeLessThanOrEqual(4);
});
