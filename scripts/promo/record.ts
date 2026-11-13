import { chromium, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { startGameServer, type GameServer } from '../../tests/game-server.ts';
import { openBattle } from '../shots/lib.ts';
import { installOverlay } from './overlay.ts';
import { SCENES, type Scene } from './scenes.ts';

/**
 * The README trailer (`make promo`): every scene of scripts/promo/scenes.ts is played in the built game with the simulation in
 * the script's hands and shot frame by frame — a frame is "step the game 1/30 s, draw, screenshot", so the video is smooth
 * whatever the machine does. The captions and the wipes between scenes are drawn in the page (overlay.ts); ffmpeg only
 * glues the frames: docs/promo/malina-promo.mp4 and the animated docs/promo/malina-promo.webp the README shows.
 *
 *   node scripts/promo/record.ts                 — everything
 *   node scripts/promo/record.ts --only fight    — one scene (frames only, no video)
 *   node scripts/promo/record.ts --every 15      — every 15th frame: a quick look at the staging
 *   node scripts/promo/record.ts --encode        — only glue the frames already shot
 * Needs the network once (Google Fonts) and ffmpeg + img2webp on PATH.
 */
const W = 1280, H = 720, FPS = 30;
const arg = (name: string): string | undefined => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const only = arg('only'), every = Number(arg('every')) || 1;
const work = resolve(arg('work') ?? '.promo-frames'), out = resolve('docs/promo');

let server: GameServer;

async function record(page: Page, scene: Scene, dir: string): Promise<number> {
  await openBattle(page, server, 'en', scene.query);
  await page.addStyleTag({ url: 'https://fonts.googleapis.com/css2?family=Luckiest+Guy&display=block' });
  await page.addStyleTag({ content: `${scene.hud ? '' : '.hud,.td-hud,.td-towers,.boss-bar,.fx-title,#pgPrompt,'}#pgRet,#pgHelp,#pgToast,#pgTele,#pgFps{visibility:hidden!important}${scene.css ?? ''}` });
  const ok = await page.evaluate(async () => { await document.fonts.load('400 10px "Luckiest Guy"', 'A'); return document.fonts.check('400 10px "Luckiest Guy"', 'A'); });
  if (!ok) throw new Error('Luckiest Guy did not load (Google Fonts needs the network)');
  await page.evaluate(installOverlay);
  await page.evaluate(`window.__scene = { setup: ${scene.setup.toString()}, frame: ${scene.frame.toString()} }; window.__S = {};`);
  await page.evaluate(() => {
    const w = window as any, m = w.__malina, STEP = 1 / 60;
    let acc = 0;
    w.__scene.setup(m, w.__S);
    w.__tick = (t: number, dt: number, ov: any, draw: boolean) => {
      const r = w.__scene.frame(m, t, dt, w.__S) ?? {};
      // slow motion: fewer simulation ticks per frame (the game steps by 1/60)
      acc += dt * (r.rate ?? 1);
      const n = Math.floor(acc / STEP + 1e-6); acc -= n * STEP;
      if (n > 0) m.step(n * STEP);
      if (!draw) return;
      m.render();
      w.__overlay({ ...ov, t, flash: r.flash ?? 0 });
    };
  });
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const n = Math.round(scene.dur * FPS), ov = { dur: scene.dur, ...scene.overlay };
  let shot = 0;
  for (let i = 0; i < n; i++) {
    const draw = i % every === 0;
    await page.evaluate(([t, dt, o, d]) => (window as any).__tick(t, dt, o, d), [i / FPS, 1 / FPS, ov, draw] as const);
    if (draw) await page.screenshot({ path: resolve(dir, `f${String(shot++).padStart(4, '0')}.png`), type: 'png' });
  }
  return shot;
}

if (!process.argv.includes('--encode')) {
server = await startGameServer();
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PW_CHROMIUM || undefined,
  args: process.platform === 'darwin' ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const scenes = SCENES.filter((s) => !only || only.split(',').includes(s.name));
  // every scene has its own page; a few at a time — each is a whole game
  const queue = [...scenes];
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.error(`[${s!.name}]`, e.message));
      const t0 = Date.now(), n = await record(page, s, resolve(work, s.name));
      console.log(`${s.name}: ${n} frames, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      await ctx.close();
    }
  }));
} finally {
  await browser.close();
  server.stop();
}

}

if (!only && every === 1) {
  mkdirSync(out, { recursive: true });
  // the scenes butt-join: each ends under the wipe's last stripe and the next starts under it
  const all = resolve(work, 'all'); rmSync(all, { recursive: true, force: true }); mkdirSync(all);
  const inputs = SCENES.flatMap((s) => ['-framerate', String(FPS), '-i', resolve(work, s.name, 'f%04d.png')]);
  const cat = `${SCENES.map((_, i) => `[${i}:v]`).join('')}concat=n=${SCENES.length}:v=1:a=0`;
  const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  ff([...inputs, '-filter_complex', `${cat},format=yuv420p[v]`, '-map', '[v]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-movflags', '+faststart', resolve(out, 'malina-promo.mp4')]);
  // the README picture: GitHub plays an animated WebP in an <img>, no player and no sound needed
  ff([...inputs, '-filter_complex', `${cat},fps=20,scale=640:-2:flags=lanczos[v]`, '-map', '[v]', resolve(all, 'f%04d.png')]);
  execFileSync('sh', ['-c', `img2webp -loop 0 -lossy -q 50 -m 4 -d 50 "${all}"/f*.png -o "${resolve(out, 'malina-promo.webp')}"`], { stdio: 'inherit' });
  console.log(`→ ${out}`);
}
