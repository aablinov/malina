import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

/**
 * Библиотека пресетов (wiki/design-prefab-library.md): витрина `?map=prefabs` грузится без ошибок и несёт декор,
 * в редакторе пресеты библиотеки стоят во вкладке, ставятся с поворотом на 90° (клетки и декор поворачиваются вместе) и отменяются.
 */

const JSONS = readdirSync(resolve('assets/prefabs')).filter((f) => f.endsWith('.json'));
const FILES = JSONS.length;
const CATS = new Set(JSONS.map((f) => (JSON.parse(readFileSync(resolve('assets/prefabs', f), 'utf8')) as { category: string }).category)).size;

test('витрина пресетов: все пресеты из assets/prefabs стоят, у каждого есть декор', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(resolve('dist/index.html')).href + '?dev=playground&map=prefabs', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__malina?.mode === 'playground');
  const r = await page.evaluate(() => {
    const m = (window as any).__malina, L = m.level;
    let blocks = 0; L.forEach(() => blocks++);
    const labels = (L.meta.labels ?? []) as { text: string }[];
    return { name: L.name, blocks, decor: L.decor.length, labels: labels.length, cats: labels.filter((l) => ['природа', 'поселение', 'дороги'].includes(l.text)).length };
  });
  expect(errors).toEqual([]);
  expect(r.name).toBe('Витрина пресетов');
  expect(r.blocks).toBeGreaterThan(1000);
  expect(r.decor).toBeGreaterThanOrEqual(FILES);
  expect(r.labels).toBeGreaterThanOrEqual(FILES + CATS);
  expect(r.cats).toBeGreaterThanOrEqual(CATS);
});

test('редактор: вкладка «Библиотека», постановка с поворотом на 90° и отмена', async ({ page }) => {
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
    // ограда вдоль X в (100, 0, 100)
    m.placePrefab('lib:wall_stepped', 100, 0, 100, 0);
    const straight = { blocks: count() - n0, decor: L.decor.length - d0, alongX: L.nameAt(104, 0, 100) !== 'air' && L.nameAt(96, 0, 100) !== 'air', alongZ: L.nameAt(100, 0, 104) !== 'air' };
    const lantern0 = L.decor[L.decor.length - straight.decor] ?? null;
    m.undo();
    const undone = { blocks: count() - n0, decor: L.decor.length - d0 };
    // та же ограда, повёрнутая на 90° — вдоль Z, фонарь повернулся вместе со стеной
    m.placePrefab('lib:wall_stepped', 100, 0, 130, 1);
    const turned = { blocks: count() - n0, decor: L.decor.length - d0, alongZ: L.nameAt(100, 0, 134) !== 'air' && L.nameAt(100, 0, 126) !== 'air', alongX: L.nameAt(104, 0, 130) !== 'air' };
    const lantern1 = L.decor.find((d: any) => d.name === 'lantern_wall' && d.pos[2] >= 120) ?? null;
    m.undo();
    const undone2 = { blocks: count() - n0, decor: L.decor.length - d0 };
    return { libs: lib.length, group: wall?.group, cells: wall?.user.cells.length, straight, lantern0: lantern0 && { name: lantern0.name, rot: lantern0.rot?.[0] ?? 0, on: lantern0.on }, undone, turned, lantern1: lantern1 && { rot: lantern1.rot?.[0] ?? 0, on: lantern1.on, pos: lantern1.pos }, undone2 };
  });
  expect(errors).toEqual([]);
  expect(r.libs).toBe(FILES);
  expect(r.group).toBe('Библиотека');
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
  // опора фонаря — клетка стены на оси x = 100, сам фонарь — на её грани −X (повёрнут с +Z на −X)
  expect(r.lantern1?.on?.[0]).toBe(100);
  expect(r.lantern1?.pos?.[0]).toBe(99.5);
  expect(r.undone2).toEqual({ blocks: 0, decor: 0 });
});
