import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

/**
 * Preset library (wiki/design-prefab-library.md): the showcase `?map=prefabs` loads without errors and carries decor,
 * in the editor the library presets sit in their tab, are placed with a 90° turn (cells and decor turn together) and are undone.
 */

const JSONS = readdirSync(resolve('assets/prefabs')).filter((f) => f.endsWith('.json'));
const FILES = JSONS.length;
const CATS = new Set(JSONS.map((f) => (JSON.parse(readFileSync(resolve('assets/prefabs', f), 'utf8')) as { category: string }).category)).size;

test('preset showcase: every preset from assets/prefabs stands, each has decor', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(resolve('dist/index.html')).href + '?dev=playground&map=prefabs', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, L = m.level;
    let blocks = 0; L.forEach(() => blocks++);
    const labels = (L.meta.labels ?? []) as { text: string }[];
    return { name: L.name, blocks, decor: L.decor.length, labels: labels.length, cats: labels.filter((l) => ['nature', 'settlement', 'roads'].includes(l.text)).length };
  });
  expect(errors).toEqual([]);
  expect(r.name).toBe('Prefab Showcase');
  expect(r.blocks).toBeGreaterThan(1000);
  // the showcase is big and streams by regions — count decor from the map file, the page holds only the regions near the hero
  const mapDecor = (JSON.parse(readFileSync(resolve('assets/maps/prefabs.json'), 'utf8')) as { decor?: unknown[] }).decor?.length ?? 0;
  expect(mapDecor).toBeGreaterThanOrEqual(FILES);
  expect(r.decor).toBeGreaterThan(0);
  expect(r.labels).toBeGreaterThanOrEqual(FILES + CATS);
  expect(r.cats).toBeGreaterThanOrEqual(CATS);
});

test('editor: the "Library" tab, placement with a 90° turn and undo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(resolve('dist/index.html')).href + '?dev=editor', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'editor');
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, L = m.level;
    const count = () => { let n = 0; L.forEach(() => n++); return n; };
    const lib = m.prefabs.filter((p: any) => p.kind === 'lib');
    const wall = lib.find((p: any) => p.id === 'lib:wall_stepped');
    const n0 = count(), d0 = L.decor.length;
    // a fence along X at (100, 0, 100)
    m.placePrefab('lib:wall_stepped', 100, 0, 100, 0);
    const straight = { blocks: count() - n0, decor: L.decor.length - d0, alongX: L.nameAt(104, 0, 100) !== 'air' && L.nameAt(96, 0, 100) !== 'air', alongZ: L.nameAt(100, 0, 104) !== 'air' };
    const lantern0 = L.decor[L.decor.length - straight.decor] ?? null;
    m.undo();
    const undone = { blocks: count() - n0, decor: L.decor.length - d0 };
    // the same fence turned by 90° — along Z, the lantern turned together with the wall
    m.placePrefab('lib:wall_stepped', 100, 0, 130, 1);
    const turned = { blocks: count() - n0, decor: L.decor.length - d0, alongZ: L.nameAt(100, 0, 134) !== 'air' && L.nameAt(100, 0, 126) !== 'air', alongX: L.nameAt(104, 0, 130) !== 'air' };
    const lantern1 = L.decor.find((d: any) => d.name === 'lantern_wall' && d.pos[2] >= 120) ?? null;
    m.undo();
    const undone2 = { blocks: count() - n0, decor: L.decor.length - d0 };
    return { libs: lib.length, group: wall?.group, cells: wall?.user.cells.length, straight, lantern0: lantern0 && { name: lantern0.name, rot: lantern0.rot?.[0] ?? 0, on: lantern0.on }, undone, turned, lantern1: lantern1 && { rot: lantern1.rot?.[0] ?? 0, on: lantern1.on, pos: lantern1.pos }, undone2 };
  });
  expect(errors).toEqual([]);
  expect(r.libs).toBe(FILES);
  expect(r.group).toBe('library');
  expect(r.straight.blocks).toBe(r.cells);
  expect(r.straight.decor).toBe(3);
  expect(r.straight.alongX).toBe(true);
  expect(r.straight.alongZ).toBe(false);
  expect(r.lantern0?.name).toBe('lantern_wall');
  expect(r.undone).toEqual({ blocks: 0, decor: 0 });
  expect(r.turned.blocks).toBe(r.cells);
  expect(r.turned.decor).toBe(3);
  expect(r.turned.alongZ).toBe(true);
  expect(r.turned.alongX).toBe(false);
  expect(r.lantern1?.rot).toBe(90);
  // the lantern's support is the wall cell on the axis x = 100, the lantern itself is on its −X face (turned from +Z to −X)
  expect(r.lantern1?.on?.[0]).toBe(100);
  expect(r.lantern1?.pos?.[0]).toBe(99.5);
  expect(r.undone2).toEqual({ blocks: 0, decor: 0 });
});
