import type { Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { signIn, type GameServer } from '../../tests/game-server.ts';

/**
 * Tutorial screenshots (wiki/design-tutorial.md): open the game in a state, ring the things a card talks about and save the
 * frame as public/tutorial/<lang>/<card id>.webp. The rings are drawn in the page itself, over the game, right before the
 * shot — the project has no image library. The numbers on the rings are the order of `marks` in src/tutorial/cards.ts.
 */
export type Lang = 'en' | 'ru';
/** What to ring: an element (or the union of several), or a spot of the 3D world already projected to the screen */
export type Mark = string | string[] | { x: number; y: number; r?: number } | { sel: string | string[]; side: 'left' | 'right' };
export interface ShotOptions {
  /** The whole window instead of a crop around the rings */
  full?: boolean;
  /** The crop is at least this wide (CSS px); the height follows 16:9 */
  minW?: number;
  /** Extra things the crop must hold, not ringed */
  include?: Mark[];
}

const W = 960, H = 540, OUT_W = 800, OUT_H = 450;
const FONTS = ['400 10px "Press Start 2P"', '500 10px Rubik', '700 10px Rubik'];

/** The language, quiet settings and no tutorial cards over the picture — before the page scripts run */
export async function prepare(page: Page, lang: Lang): Promise<void> {
  await page.addInitScript((l) => {
    try {
      localStorage.setItem('malina.lang', l);
      localStorage.setItem('malina.tutorial', JSON.stringify({ off: true }));
      localStorage.setItem('malina.settings', JSON.stringify({ volume: 0, music: 0, postFX: true, shadows: true, quality: 'high', help: false }));
    } catch { /* storage unavailable */ }
  }, lang);
}

/** A battle from the menu, the simulation in the script's hands: `m.step()` moves time, `m.render()` draws */
export async function openBattle(page: Page, s: GameServer, lang: Lang, query: string): Promise<void> {
  await signIn(page, s);
  await prepare(page, lang);
  await page.goto(`${s.url}?${query}&from=menu`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground', null, { timeout: 90_000 });
  await page.evaluate(async () => {
    const m = (window as any).__malina;
    m.script(true);
    await m.ready;
    /** A world point on the screen, for a ring (call after `m.render()`) */
    (window as any).__at = (p: { x: number; y: number; z: number }, r = 30, up = 0.8) => {
      const v = m.hero.pos.clone().set(p.x, (p.y ?? 0) + up, p.z).project(m.camera);
      return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight, r };
    };
  });
}

/** The camp: the page believes it is not automated, so the campfire scene is drawn (src/menu/scene.ts) */
export async function openCamp(page: Page, s: GameServer, lang: Lang, mode: 'Solo game' | 'Online game' | 'Одиночная игра' | 'Сетевая игра'): Promise<void> {
  await page.addInitScript(() => { Object.defineProperty(Object.getPrototypeOf(navigator), 'webdriver', { get: () => false }); });
  await signIn(page, s);
  await prepare(page, lang);
  await page.goto(s.url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__menu?.screen === 'start', null, { timeout: 60_000 });
  await page.locator('.mm-nav .mm-btn.big', { hasText: mode }).click();
  await page.waitForFunction(() => (window as any).__menu.screen === 'lobby');
}

async function fonts(page: Page): Promise<void> {
  const ok = await page.evaluate(async (list) => {
    await Promise.all(list.map((f) => document.fonts.load(f, 'AaЯя09')));
    await document.fonts.ready;
    return list.every((f) => document.fonts.check(f, 'AaЯя09'));
  }, FONTS);
  if (!ok) throw new Error('Press Start 2P / Rubik did not load (Google Fonts needs the network): the shots would come out in fallback fonts');
}

/** Ring `marks` over the page, shoot the frame around them and save it as the card's picture */
export async function shoot(page: Page, lang: Lang, id: string, marks: Mark[], opt: ShotOptions = {}): Promise<void> {
  await fonts(page);
  const clip = await page.evaluate(({ marks, include, full, minW, W, H }) => {
    type Box = { x: number; y: number; w: number; h: number; round?: boolean; side?: string };
    const box = (m: any): Box => {
      if (typeof m === 'object' && !Array.isArray(m) && m.sel) return { ...box(m.sel), side: m.side };
      if (typeof m === 'object' && !Array.isArray(m)) { const r = m.r ?? 30; return { x: m.x - r, y: m.y - r, w: r * 2, h: r * 2, round: true }; }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      // a line of text in a wide transparent block is ringed by its text, anything else — by its box
      const rect = (e: Element): DOMRect => {
        const r = e.getBoundingClientRect(), rg = document.createRange();
        rg.selectNodeContents(e);
        const c = rg.getBoundingClientRect();
        const cs = getComputedStyle(e), plain = cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.backgroundImage === 'none' && cs.borderTopWidth === '0px';
        let { left, top, right, bottom } = c.width > 0 && c.height > 0 && r.width > c.width * 1.4 && plain ? c : r;
        // only what is seen: a scrolled pane cuts its children
        for (let p = e.parentElement; p; p = p.parentElement) {
          if (getComputedStyle(p).overflow === 'visible') continue;
          const q = p.getBoundingClientRect();
          left = Math.max(left, q.left); top = Math.max(top, q.top); right = Math.min(right, q.right); bottom = Math.min(bottom, q.bottom);
        }
        return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
      };
      for (const sel of Array.isArray(m) ? m : [m]) {
        const els = [...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
        for (const e of els) { const r = rect(e); if (r.width < 4 || r.height < 4) continue; x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); }
      }
      if (x0 === Infinity) throw new Error(`nothing to ring: ${m}`);
      const p = 4;
      return { x: x0 - p, y: y0 - p, w: x1 - x0 + p * 2, h: y1 - y0 + p * 2 };
    };
    const boxes = marks.map(box), all = [...boxes, ...include.map(box)];
    document.getElementById('shot-marks')?.remove();
    for (const id of ['pgRet', 'pgHelp', 'pgToast', 'pgTele', 'pgFps']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.id = 'shot-marks';
    svg.setAttribute('style', 'position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none');
    const el = (tag: string, a: Record<string, string | number>): SVGElement => { const e = document.createElementNS(ns, tag); for (const k of Object.keys(a)) e.setAttribute(k, String(a[k])); svg.appendChild(e); return e; };
    boxes.forEach((b, i) => {
      for (const [stroke, width] of [['#000', 7.5], ['#fff', 5.5], ['#ff4f7b', 3]] as const) {
        if (b.round) el('circle', { cx: b.x + b.w / 2, cy: b.y + b.h / 2, r: b.w / 2, fill: 'none', stroke, 'stroke-width': width });
        else el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 8, fill: 'none', stroke, 'stroke-width': width });
      }
      // the number sits on the ring's top-left; by a single line of text — beside it, so the words stay readable
      const k = b.round ? b.w / 2 * 0.29 : 0, line = !b.round && b.h < 34, side = b.side ?? 'left';
      const cx = Math.min(W - 14, Math.max(14, line ? (side === 'right' ? b.x + b.w + 12 : b.x - 12) : b.x + k)), cy = Math.min(H - 14, Math.max(14, line ? b.y + b.h / 2 : b.y + k));
      el('circle', { cx, cy, r: 11.5, fill: '#ff4f7b', stroke: '#fff', 'stroke-width': 2.5 });
      el('circle', { cx, cy, r: 13.5, fill: 'none', stroke: '#000', 'stroke-width': 1.5 });
      const tx = el('text', { x: cx + 0.5, y: cy + 5, 'text-anchor': 'middle', fill: '#fff', style: 'font:400 10px "Press Start 2P",monospace' });
      tx.textContent = String(i + 1);
    });
    document.body.appendChild(svg);
    if (full || !all.length) return { x: 0, y: 0, width: W, height: H };
    const pad = 34;
    const x0 = Math.min(...all.map((b) => b.x)) - pad, y0 = Math.min(...all.map((b) => b.y)) - pad, x1 = Math.max(...all.map((b) => b.x + b.w)) + pad, y1 = Math.max(...all.map((b) => b.y + b.h)) + pad;
    let w = Math.max(minW, x1 - x0, ((y1 - y0) * 16) / 9);
    w = Math.min(W, w);
    const h = (w * 9) / 16;
    const x = Math.min(W - w, Math.max(0, (x0 + x1) / 2 - w / 2)), y = Math.min(H - h, Math.max(0, (y0 + y1) / 2 - h / 2));
    return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
  }, { marks, include: opt.include ?? [], full: !!opt.full, minW: opt.minW ?? 480, W, H });
  // a battle draws only on request in an automated run; the camp draws by itself
  await page.evaluate(() => (window as any).__malina?.render?.());
  const png = await page.screenshot({ clip, type: 'png' });
  const webp = await page.evaluate(async ({ b64, w, h }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/webp', 0.84).split(',')[1];
  }, { b64: png.toString('base64'), w: OUT_W, h: OUT_H });
  await page.evaluate(() => document.getElementById('shot-marks')?.remove());
  const dir = resolve('public/tutorial', lang);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, `${id}.webp`), Buffer.from(webp, 'base64'));
}
