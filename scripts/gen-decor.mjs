#!/usr/bin/env node
/**
 * Генератор форм декора: пишет assets/decor/*.obj.
 *
 * Декор — свободные предметы поверх блоков (wiki/design-level-decor.md): ставятся с шагом 1/16 и под любым углом,
 * но «сделаны из блоков» — размеры кратны 1/16, а UV идут в метрах, поэтому пиксели те же 16 на метр, что у блоков.
 * Начало координат — точка опоры:
 *   floor   — центр низа, предмет стоит на y = 0 и растёт вверх;
 *   wall    — точка на стене, предмет «спиной» к плоскости z = 0 и выступает к +Z;
 *   ceiling — точка на потолке, предмет свисает вниз (y ≤ 0).
 * Части строятся по центру начала координат (tbox режет грани по сетке клеток), потом поворачиваются и сдвигаются (xf).
 *
 *   node scripts/gen-decor.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Obj } from './obj-writer.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'decor');
const P = 1 / 16;

const shapes = [];
const shape = (name, build) => { const o = new Obj(name); build(o); shapes.push(o); };
/** Бокс w × h × d с центром низа в нуле */
const cbox = (o, w, h, d, groups = {}) => o.tbox(-w / 2, 0, -d / 2, w / 2, h, d / 2, groups);
/** Детерминированный шум для россыпей */
const rand = (seed) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
const snap = (v) => Math.round(v / P) * P;

// --- камень ---
// упавшая колонна: три обломка ствола 14/16 лёжа вдоль X (поворот −90° вокруг Z кладёт +Y на +X), капитель у конца
shape('column_fallen', (o) => {
  const T = 14 * P, ends = { py: 'top', ny: 'top' };
  for (const [xs, len, yaw] of [[-1.2, 0.9, 0], [-0.24, 0.75, 7], [0.62, 0.55, -16]]) {
    o.xf({ rot: [0, yaw, -90], move: [xs, T / 2, 0] }, () => o.tbox(-T / 2, 0, -T / 2, T / 2, len, T / 2, ends));
  }
  o.xf({ rot: [0, 0, -90], move: [-1.2 - 4 * P, 0.5, 0] }, () => o.tbox(-0.5, 0, -0.5, 0.5, 4 * P, 0.5, ends));
});
// обломок колонны стоя: база, ствол 14/16 и рваный верх
shape('column_stump', (o) => {
  cbox(o, 1, 3 * P, 1, { py: 'top', ny: 'top' });
  o.tbox(-7 * P, 3 * P, -7 * P, 7 * P, 1.1, 7 * P, { py: 'top' });
  o.tbox(-7 * P, 1.1, -7 * P, -P, 1.35, 0, { py: 'top', ny: null });
  o.tbox(P, 1.1, -7 * P, 7 * P, 1.22, -2 * P, { py: 'top', ny: null });
  o.tbox(-4 * P, 1.1, 2 * P, 3 * P, 1.45, 7 * P, { py: 'top', ny: null });
});
// россыпь щебня: кубики 3–6/16 под разными углами
shape('rubble', (o) => {
  const r = rand(7);
  for (let i = 0; i < 11; i++) {
    const s = snap((3 + r() * 3) * P), a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.6;
    o.xf({ rot: [r() * 30 - 15, r() * 90, r() * 30 - 15], move: [Math.cos(a) * d, 0, Math.sin(a) * d] }, () => cbox(o, s, s, s));
  }
  o.xf({ move: [0.1, 0, -0.05], rot: [0, 20, 0] }, () => cbox(o, 7 * P, 5 * P, 6 * P));
});
// выпавшие кирпичи: брусок 8 × 3 × 4 /16
shape('bricks_loose', (o) => {
  const r = rand(11);
  for (let i = 0; i < 5; i++) {
    const a = r() * Math.PI * 2, d = 0.15 + r() * 0.45;
    o.xf({ rot: [0, r() * 180, i === 4 ? 25 : 0], move: [Math.cos(a) * d, i === 4 ? 2 * P : 0, Math.sin(a) * d] }, () => cbox(o, 8 * P, 3 * P, 4 * P));
  }
});

// --- цепи, корни, паутина ---
// цепь с потолка: 9 звеньев по 4/16, через одно повёрнуты на 90°
shape('chain', (o) => {
  for (let i = 0; i < 9; i++) {
    const y = -(i + 1) * 3.5 * P;
    o.xf({ rot: [0, i % 2 ? 90 : 0, 0], move: [0, y, 0] }, () => {
      o.tbox(-2 * P, 0, -P / 2, -P, 5 * P, P / 2, 'side');
      o.tbox(P, 0, -P / 2, 2 * P, 5 * P, P / 2, 'side');
      o.tbox(-P, 0, -P / 2, P, P, P / 2, 'side');
      o.tbox(-P, 4 * P, -P / 2, P, 5 * P, P / 2, 'side');
    });
  }
  o.tbox(-3 * P, -P, -3 * P, 3 * P, 0, 3 * P, 'side'); // крепление
});
// корни по стене: свисают от точки крепления вниз, чуть отходят от стены
shape('roots', (o) => {
  const r = rand(5);
  o.tbox(-0.6, -2 * P, 0, 0.6, P, 2 * P, 'side');
  for (let i = 0; i < 6; i++) {
    const x = snap(-0.5 + i * 0.2 + (r() - 0.5) * 0.08), len = snap(0.5 + r() * 0.9), t = (i % 2 ? 2 : 3) * P;
    o.xf({ rot: [-4 - r() * 6, 0, (r() - 0.5) * 10], move: [x, 0, P] }, () => o.tbox(-t / 2, -len, 0, t / 2, 0, t, 'side'));
    if (i % 2 === 0) o.xf({ rot: [0, 0, 35], move: [x, -len * 0.6, P] }, () => o.tbox(-P / 2, -0.25, 0, P / 2, 0, P, 'side'));
  }
});
// паутина: вырезная плоскость 1 × 1 м с двух сторон, на стене или в углу
shape('cobweb', (o) => {
  o.xf({ move: [0, -0.5, P] }, () => o.tbox(-0.5, 0, 0, 0.5, 1, 0, { pz: 'side', nz: null, px: null, nx: null, py: null, ny: null }));
});

// --- знамя и факел ---
// знамя: древко от стены, полотнище 12/16 × 1,5 м свисает вниз
shape('banner', (o) => {
  o.tbox(-8 * P, -P, P, 8 * P, P, 3 * P, 'pole');
  o.tbox(-P / 2, -P / 2, 0, P / 2, P / 2, 3 * P, 'pole');
  o.tbox(-6 * P, -1.5, 2 * P + P / 4, 6 * P, -P, 3 * P - P / 4, { pz: 'cloth', nz: 'cloth', px: 'cloth', nx: 'cloth', py: 'cloth', ny: 'cloth' });
});
// настенный факел: скоба на стене, палка 2/16 наклонена от стены, пламя на конце
shape('torch_wall', (o) => {
  o.tbox(-2 * P, -3 * P, 0, 2 * P, -P, 2 * P, 'iron');
  o.xf({ rot: [25, 0, 0], move: [0, -4 * P, 2 * P] }, () => o.tbox(-P, 0, -P, P, 10 * P, P, { py: 'tip', ny: 'stick', px: 'stick', nx: 'stick', pz: 'stick', nz: 'stick' }));
});
shape('torch_wall_flame', (o) => {
  const ty = -4 * P + Math.cos(25 * Math.PI / 180) * 10 * P, tz = 2 * P + Math.sin(25 * Math.PI / 180) * 10 * P;
  o.xf({ move: [-0.5, ty - P, tz - 0.5] }, () => o.cross('side', 5 * P, 11 * P, 0, 7 * P));
});

// --- свечи, кости, грибы ---
const CANDLES = [[-3 * P, -2 * P, 6 * P], [2 * P, 1 * P, 4 * P], [-1 * P, 4 * P, 3 * P], [4 * P, -4 * P, 2 * P]];
shape('candles', (o) => {
  for (const [x, z, h] of CANDLES) o.xf({ move: [x, 0, z] }, () => cbox(o, 2 * P, h, 2 * P));
  o.xf({ move: [0, 0, 0] }, () => cbox(o, 12 * P, P / 2, 12 * P, 'drip'));
});
shape('candles_flame', (o) => {
  for (const [x, z, h] of CANDLES) o.xf({ move: [x - 0.5, h, z - 0.5] }, () => o.cross('side', 7 * P, 9 * P, 0, 3 * P));
});
// череп с глазницами и две кости крест-накрест
shape('bones', (o) => {
  o.xf({ rot: [0, -20, 0], move: [-2 * P, 0, 0] }, () => {
    cbox(o, 5 * P, 5 * P, 5 * P, 'bone');
    o.tbox(-2 * P, 2 * P, 2.5 * P, -0.5 * P, 3.5 * P, 2.6 * P, 'dark');
    o.tbox(0.5 * P, 2 * P, 2.5 * P, 2 * P, 3.5 * P, 2.6 * P, 'dark');
    o.tbox(-1.5 * P, 0, 2.5 * P, 1.5 * P, P, 2.7 * P, 'bone');
  });
  for (const [a, x] of [[35, 5 * P], [-40, 5 * P]]) o.xf({ rot: [0, a, 0], move: [x, 0, 3 * P] }, () => {
    o.tbox(-5 * P, 0, -P / 2, 5 * P, P, P / 2, 'bone');
    for (const s of [-1, 1]) o.tbox(s * 5 * P - P, 0, -P, s * 5 * P + P, 1.5 * P, P, 'bone');
  });
});
// грибы: ножки 2/16, шляпки 6/16 разной высоты
const mushrooms = (name) => shape(name, (o) => {
  for (const [x, z, h, w] of [[-3 * P, -2 * P, 6 * P, 6 * P], [4 * P, 2 * P, 4 * P, 5 * P], [-1 * P, 5 * P, 3 * P, 4 * P]]) {
    o.xf({ move: [x, 0, z] }, () => {
      cbox(o, 2 * P, h, 2 * P, 'stem');
      o.xf({ move: [0, h, 0] }, () => cbox(o, w, 2 * P, w, 'cap'));
    });
  }
});
mushrooms('mushrooms');

// --- двор: фонарь на столбе, ящик с цветами, кривая стопка ящиков (по скриншотам Minecraft Dungeons) ---
shape('lantern_post', (o) => {
  cbox(o, 5 * P, P, 5 * P, 'post');
  cbox(o, 3 * P, 2.2, 3 * P, { py: 'post', ny: 'post', px: 'post', nx: 'post', pz: 'post', nz: 'post' });
  o.tbox(-1.5 * P, 2.05, -1.5 * P, 10 * P, 2.2, 1.5 * P, 'post');
  o.tbox(8 * P, 1.9, -P / 2, 9 * P, 2.05, P / 2, 'iron');
  o.xf({ move: [8.5 * P, 1.55, 0] }, () => {
    cbox(o, 5 * P, P, 5 * P, 'iron');
    o.xf({ move: [0, 5 * P, 0] }, () => cbox(o, 5 * P, P, 5 * P, 'iron'));
    o.xf({ move: [0, 6 * P, 0] }, () => cbox(o, 3 * P, P, 3 * P, 'iron'));
    for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) o.xf({ move: [x * P, P, z * P] }, () => cbox(o, P, 4 * P, P, 'iron'));
  });
});
shape('lantern_post_glass', (o) => o.xf({ move: [8.5 * P, 1.55 + P, 0] }, () => cbox(o, 3 * P, 4 * P, 3 * P, 'side')));
shape('planter', (o) => {
  // ящик 1 × 12/16 × 6/16: четыре доски и земля на 5/16
  o.tbox(-0.5, 0, -6 * P, 0.5, 6 * P, -5 * P);
  o.tbox(-0.5, 0, 5 * P, 0.5, 6 * P, 6 * P);
  o.tbox(-0.5, 0, -5 * P, -0.5 + P, 6 * P, 5 * P);
  o.tbox(0.5 - P, 0, -5 * P, 0.5, 6 * P, 5 * P);
  o.tbox(-0.5 + P, 0, -5 * P, 0.5 - P, 5 * P, 5 * P, { py: 'soil', px: null, nx: null, pz: null, nz: null, ny: null });
});
shape('planter_flowers', (o) => {
  for (const x of [-5 * P, 0, 5 * P]) o.xf({ move: [x - 0.5, 5 * P, -0.5] }, () => o.cross('side', 3 * P, 13 * P, 0, 10 * P));
});
shape('crates_tilted', (o) => {
  const C = 15 * P;
  o.xf({ move: [-0.5, 0, 0] }, () => cbox(o, C, C, C));
  o.xf({ rot: [0, 14, 0], move: [0.52, 0, 0.08] }, () => cbox(o, C, C, C));
  o.xf({ rot: [0, 32, 0], move: [0.05, C, 0.02] }, () => cbox(o, C, C, C));
});

mkdirSync(OUT, { recursive: true });
for (const s of shapes) writeFileSync(join(OUT, `${s.name}.obj`), s.text());
console.log(`${shapes.length} форм декора → ${OUT}`);
