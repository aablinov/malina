import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Perf scenarios (wiki/dev-performance.md): the death of the final warden at level 30 with 4 players and a barrage of spells.
 * WebGL here is software (SwiftShader), so absolute milliseconds are nominal: we catch hitches relative to
 * the median frame, geometry leaks and growth of the shader program count after warm-up. The threshold is PERF_MAX_MS (40 ms by default).
 */

// warm=1: an automated run skips the shader warm-up (src/devflag.ts AUTOMATED), here it is measured
// switched off (2026-11-08): runs on the playground scene — no tests there, wiki/dev-testing.md
test.skip(true, 'perf tests are switched off');

const URL = pathToFileURL(resolve('dist/index.html')).href + '?dev=playground&warm=1';
const MAX_MS = Number(process.env.PERF_MAX_MS || 40);
/** Frame time is meaningful only on a real GPU (PERF_GPU=1, see playwright.config.ts); in SwiftShader we check leaks and programs */
const GPU = !!process.env.PERF_GPU;
/** In SwiftShader a frame takes seconds to draw — draw every fourth, that is enough for leaks and programs */
const RENDER_EVERY = GPU ? 1 : 4;

test.setTimeout(600_000);
// programs, geometries and textures do not depend on the frame size; in SwiftShader every pixel costs — a small frame (a real GPU keeps the full one)
if (!GPU) test.use({ viewport: { width: 320, height: 200 } });

interface Frame { ms: number; tick: number; render: number; marks: string[] }
interface Report { frames: Frame[]; programs0: number; programs1: number; geo0: number; geo1: number; tex0: number; tex1: number }

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  await page.evaluate(() => (window as any).__malina.script(true));
  // shader and texture warm-up (src/fx-zoo.ts) — before the measurements
  const t0 = Date.now();
  const programs = await page.evaluate(() => (window as any).__malina.ready);
  console.log(`[perf] warm-up: ${programs} programs, ${Date.now() - t0} ms after the page start`);
  return errors;
}

/** Summary: median, max, number of long frames (longer than the threshold and three times longer than the median) */
function summarize(frames: Frame[]) {
  const ms = frames.map((f) => f.ms).sort((a, b) => a - b);
  const median = ms[Math.floor(ms.length / 2)] ?? 0;
  const limit = Math.max(MAX_MS, median * 3);
  const long = frames.filter((f) => f.ms > limit);
  return { median, max: ms[ms.length - 1] ?? 0, limit, long, p95: ms[Math.floor(ms.length * 0.95)] ?? 0 };
}

function log(name: string, r: Report): ReturnType<typeof summarize> {
  const s = summarize(r.frames);
  const worst = s.long.slice().sort((a, b) => b.ms - a.ms).slice(0, 5).map((f) => `${f.ms.toFixed(0)}ms (sim ${f.tick.toFixed(0)}, render ${f.render.toFixed(0)}${f.marks.length ? `, ${f.marks.join('+')}` : ''})`);
  console.log(`[perf] ${name}: frames ${r.frames.length}, median ${s.median.toFixed(1)} ms, p95 ${s.p95.toFixed(1)}, max ${s.max.toFixed(1)}, long ${s.long.length} (threshold ${s.limit.toFixed(0)});`
    + ` programs ${r.programs0}→${r.programs1}, geometries ${r.geo0}→${r.geo1}, textures ${r.tex0}→${r.tex1}${worst.length ? `; worst: ${worst.join('; ')}` : ''}`);
  return s;
}

/** Code in the page: run n simulation frames with rendering, measuring the wall time of each */
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

test('perf: the death of the final warden at level 30 × 4 players — no hitches and no leaks', async ({ page }) => {
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
    run(30); // warm-up: the arena closed, the warden woke up
    const c0 = counts();
    const V = m.hero.pos.constructor;
    const frames = [];
    // finish it: hit until death, then 4 s — the fountain, grimoires, berry pickup
    for (let j = 0; j < 240 && !boss.dead; j++) { boss.hit(99999, new V(0, 0, 1), boss.pos.clone(), 0); if (!boss.dead) m.step(1 / 60); }
    frames.push(...run(120));
    // the hero walks over the berries — pickup with effects
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
  const s = log(`warden death (berries ${(r as any).berries}, left on the floor ${(r as any).left})`, r);
  if (GPU) expect(s.long.length, `long frames: ${s.long.map((f) => f.ms.toFixed(0)).join(', ')}`).toBe(0);
  // grimoires and the remaining berries hold geometries; a leak is when there are more geometries than objects on the floor
  expect(r.geo1 - r.geo0).toBeLessThanOrEqual((r as any).left * 4 + 40);
});

test('perf: a barrage of spells of every school — programs do not grow, frames are even', async ({ page }) => {
  const errors = await open(page);
  const r = await page.evaluate<Report & { casts: number }>(`(() => {
    const m = window.__malina; let lastLong = -1;
    ${RUN}
    const ids = ['fireball', 'spark', 'icerain', 'heal', 'meteor', 'flameserpent', 'ashcrown', 'icetomb', 'frostridge', 'absolutezero', 'thunderspear', 'thunderleap',
      'stormcloud', 'starfall', 'starbeam', 'judgement', 'deadchoir', 'gravitywell', 'skullscythe', 'fallenguards', 'rift', 'raspberrybush', 'titanform', 'bladephalanx'];
    const p = m.profile;
    m.hero.god = true;
    const d = m.dummies.find((x) => x.name === 'lone');
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
      // long spells (the cloud, the hands, the dome) live up to 10 s — wait until everything melts away
      m.step(12); m.render();
      return counts();
    };
    const c1 = round(true);
    // second round: the shared geometries and textures already exist — any growth now is a leak
    const c2 = round(false);
    return { frames, casts, programs0: c0.programs, programs1: c2.programs, geo0: c1.geo, geo1: c2.geo, tex0: c0.tex, tex1: c2.tex, firstRound: c1.geo - c0.geo };
  })()`);
  expect(errors).toEqual([]);
  const s = log(`spell barrage (casts ${r.casts})`, r);
  expect(r.casts).toBeGreaterThanOrEqual(20);
  if (GPU) expect(s.long.length, `long frames: ${s.long.map((f) => f.ms.toFixed(0)).join(', ')}`).toBe(0);
  // after the warm-up at load no new shader programs should appear in battle
  expect(r.programs1 - r.programs0).toBeLessThanOrEqual(0);
  // the second round of spells must not add geometries (the first creates the shared ones — that is not a leak)
  console.log(`[perf] shared geometries after the first round: +${(r as any).firstRound}`);
  expect(r.geo1 - r.geo0).toBeLessThanOrEqual(4);
});
