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

// --- мир: двор (скриншот 10) ---
const CR = 15 * P;
// ящик склада: дощатый, полосы и краска — в текстуре
shape('crate_banded', (o) => cbox(o, CR, CR, CR));
shape('crates_banded_stack', (o) => {
  o.xf({ move: [-0.5, 0, 0], rot: [0, 4, 0] }, () => cbox(o, CR, CR, CR));
  o.xf({ move: [0.5, 0, 0.1], rot: [0, -8, 0] }, () => cbox(o, CR, CR, CR));
  o.xf({ move: [0.02, CR, 0.04], rot: [0, 22, 0] }, () => cbox(o, CR, CR, CR));
});
shape('crate_small', (o) => {
  cbox(o, 10 * P, 9 * P, 10 * P);
  o.xf({ move: [0, 9 * P, 0] }, () => cbox(o, 11 * P, P, 11 * P, 'rim'));
});
// сундук: корпус, крышка, золотая окантовка и замок спереди (+Z)
shape('chest', (o) => {
  cbox(o, 14 * P, 8 * P, 10 * P);
  o.xf({ move: [0, 8 * P, 0] }, () => cbox(o, 14 * P, 4 * P, 10 * P, { py: 'lid', px: 'side', nx: 'side', pz: 'side', nz: 'side', ny: null }));
  for (const x of [-6.5 * P, 6.5 * P]) o.xf({ move: [x, 0, 0] }, () => cbox(o, 1.2 * P, 12.2 * P, 10.2 * P, 'trim'));
  o.xf({ move: [0, 6 * P, 5 * P] }, () => cbox(o, 3 * P, 4 * P, 0.6 * P, 'trim'));
});
// колесо: два квадрата под 45° — восьмиугольник из кубиков
const wheel = (o, x, y, z) => {
  for (const a of [0, 45]) o.xf({ rot: [a, 0, 0], move: [x, y, z], pivot: [0, 0, 0] }, () => o.tbox(-P, -4.5 * P, -4.5 * P, P, 4.5 * P, 4.5 * P, 'wheel'));
  o.xf({ move: [x, y, z] }, () => o.tbox(-1.6 * P, -1.2 * P, -1.2 * P, 1.6 * P, 1.2 * P, 1.2 * P, 'iron'));
};
// телега: короб на двух колёсах, оглобли вперёд (+Z) до земли
const cartBody = (o) => {
  o.xf({ move: [0, 6 * P, 0] }, () => {
    cbox(o, 14 * P, 2 * P, 20 * P);
    o.tbox(-7 * P, 2 * P, -10 * P, 7 * P, 7 * P, -9 * P);
    o.tbox(-7 * P, 2 * P, 9 * P, 7 * P, 6 * P, 10 * P);
    o.tbox(-7 * P, 2 * P, -9 * P, -6 * P, 7 * P, 9 * P);
    o.tbox(6 * P, 2 * P, -9 * P, 7 * P, 7 * P, 9 * P);
  });
  wheel(o, -8 * P, 4.5 * P, 0);
  wheel(o, 8 * P, 4.5 * P, 0);
  for (const x of [-5 * P, 5 * P]) o.xf({ rot: [16, 0, 0], move: [x, 7 * P, 10 * P] }, () => o.tbox(-0.75 * P, -0.75 * P, 0, 0.75 * P, 0.75 * P, 14 * P, 'side'));
};
shape('cart', (o) => cartBody(o));
shape('cart_loaded', (o) => {
  cartBody(o);
  o.xf({ move: [-2.5 * P, 8 * P, -4 * P], rot: [0, 8, 0] }, () => cbox(o, 8 * P, 6 * P, 9 * P, { side: 'hay', py: 'hayTop', ny: 'hayTop', px: 'hay', nx: 'hay', pz: 'hay', nz: 'hay' }));
  o.xf({ move: [3 * P, 8 * P, 4 * P], rot: [0, -12, 0] }, () => cbox(o, 7 * P, 6 * P, 7 * P, 'box'));
  o.xf({ move: [2 * P, 14 * P, -3 * P], rot: [0, 30, 0] }, () => cbox(o, 6 * P, 5 * P, 6 * P, 'box'));
});
// скамья: сиденье 2/16 на высоте 7/16, две ножки-доски
shape('bench', (o) => {
  o.xf({ move: [0, 7 * P, 0] }, () => cbox(o, 20 * P, 2 * P, 6 * P));
  for (const x of [-8 * P, 8 * P]) o.xf({ move: [x, 0, 0] }, () => cbox(o, 2 * P, 7 * P, 5 * P));
});
// фонари: каркас и стекло (стекло — отдельная форма в слое glow)
const lanternCage = (o, at) => o.xf({ move: at }, () => {
  cbox(o, 5 * P, P, 5 * P, 'iron');
  o.xf({ move: [0, 5 * P, 0] }, () => cbox(o, 5 * P, P, 5 * P, 'iron'));
  o.xf({ move: [0, 6 * P, 0] }, () => cbox(o, 3 * P, P, 3 * P, 'iron'));
  for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) o.xf({ move: [x * P, P, z * P] }, () => cbox(o, P, 4 * P, P, 'iron'));
});
const lanternGlass = (o, at) => o.xf({ move: [at[0], at[1] + P, at[2]] }, () => cbox(o, 3 * P, 4 * P, 3 * P, 'side'));
// двойной: столб 2,4 м и перекладина с фонарями с обеих сторон
const DOUBLE = [[-9 * P, 1.75, 0], [9 * P, 1.75, 0]];
shape('lantern_post_double', (o) => {
  cbox(o, 5 * P, P, 5 * P, 'post');
  cbox(o, 3 * P, 2.4, 3 * P, 'post');
  o.tbox(-11 * P, 2.25, -1.5 * P, 11 * P, 2.4, 1.5 * P, 'post');
  for (const [x, y] of DOUBLE) { o.tbox(x - P / 2, y + 7 * P, -P / 2, x + P / 2, 2.25, P / 2, 'iron'); lanternCage(o, [x, y, 0]); }
});
shape('lantern_post_double_glass', (o) => { for (const at of DOUBLE) lanternGlass(o, at); });
// настенный: скоба от стены (+Z) и фонарь на ней
const WALL_AT = [0, -9 * P, 6 * P];
shape('lantern_wall', (o) => {
  o.tbox(-2 * P, -2 * P, 0, 2 * P, 2 * P, P, 'iron');
  o.tbox(-P / 2, -P / 2, P, P / 2, P / 2, 7 * P, 'iron');
  o.tbox(-P / 2, -2 * P, 6 * P - P / 2, P / 2, -P / 2, 6 * P + P / 2, 'iron');
  lanternCage(o, WALL_AT);
});
shape('lantern_wall_glass', (o) => lanternGlass(o, WALL_AT));
// низкий: столбик 1 м и фонарь сверху
const SHORT_AT = [0, 1.0, 0];
shape('lantern_short', (o) => { cbox(o, 5 * P, P, 5 * P, 'post'); cbox(o, 3 * P, 1.0, 3 * P, 'post'); lanternCage(o, SHORT_AT); });
shape('lantern_short_glass', (o) => lanternGlass(o, SHORT_AT));

// --- мир: вода (скриншот 11) ---
// брызги у подножия водопада: белые «облака» из кубов разного размера
const puffs = (o, seed, n, spread, sz, rise) => {
  const r = rand(seed);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * spread, s = snap(sz[0] + r() * (sz[1] - sz[0]));
    o.xf({ rot: [r() * 20 - 10, r() * 90, r() * 20 - 10], move: [Math.cos(a) * d, r() * rise, Math.sin(a) * d] }, () => cbox(o, s, s * 0.8, s));
  }
};
shape('waterfall_splash', (o) => puffs(o, 31, 9, 0.9, [0.35, 0.75], 0.6));
shape('waterfall_foam', (o) => puffs(o, 32, 7, 0.7, [0.25, 0.5], 0.15));
// пена на воде: плоские пятна 1/16 над поверхностью
shape('foam_patch', (o) => {
  const r = rand(33);
  for (let i = 0; i < 8; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.8, w = snap(0.2 + r() * 0.4), dd = snap(0.15 + r() * 0.3);
    o.xf({ rot: [0, r() * 90, 0], move: [Math.cos(a) * d, 0, Math.sin(a) * d] }, () => cbox(o, w, P, dd, 'side'));
  }
});

// --- мир: свечи на стенах (скриншот 13) — свет запекается в блоки, без PointLight ---
const candleSet = (name, list) => {
  shape(name, (o) => { for (const [x, z, h] of list) o.xf({ move: [x, 0, z] }, () => cbox(o, 2 * P, h, 2 * P)); });
  shape(`${name}_flame`, (o) => { for (const [x, z, h] of list) o.xf({ move: [x - 0.5, h, z - 0.5] }, () => o.cross('side', 6.5 * P, 9.5 * P, 0, 3.5 * P)); });
};
candleSet('candles_group', [[-4 * P, -3 * P, 7 * P], [2 * P, -1 * P, 5 * P], [-1 * P, 4 * P, 4 * P], [5 * P, 4 * P, 6 * P], [-5 * P, 3 * P, 3 * P]]);
candleSet('candles_row', [[-12 * P, 0, 5 * P], [-6 * P, P, 7 * P], [0, -P, 4 * P], [6 * P, 0, 6 * P], [12 * P, P, 5 * P]]);
candleSet('candle_tall', [[0, 0, 11 * P]]);

// --- природа (партия «Дорога и природа»): мёртвое дерево, тростник, пень, камешки, опавшие листья ---
// мёртвое дерево: ствол 6/16 высотой 2,3 м с расширением у корней, четыре голые ветки под углом (референсы 1, 4, 10)
shape('tree_dead', (o) => {
  cbox(o, 6 * P, 2.3, 6 * P, 'side');
  cbox(o, 10 * P, 4 * P, 10 * P, 'side');
  for (const [h, yaw, tilt, len] of [[1.25, 20, 55, 0.85], [1.65, 140, 50, 0.7], [1.95, 260, 45, 0.6], [2.2, 70, 30, 0.45]]) {
    o.xf({ rot: [0, yaw, 0] }, () => o.xf({ rot: [0, 0, -tilt], move: [0, h, 0] }, () => o.tbox(-1.5 * P, 0, -1.5 * P, 1.5 * P, len, 1.5 * P, 'side')));
  }
});
// тростник: пять скрещённых стеблей 8/16 шириной, 14/16 высотой, под разными углами
shape('reeds', (o) => {
  for (const [x, z, yaw, h] of [[-4 * P, -3 * P, 10, 14 * P], [3 * P, -4 * P, 50, 12 * P], [0, 3 * P, 80, 15 * P], [5 * P, 3 * P, 25, 11 * P], [-5 * P, 4 * P, 65, 13 * P]]) {
    o.xf({ rot: [0, yaw, 0], move: [x, 0, z] }, () => o.cross('side', -4 * P, 4 * P, 0, h));
  }
});
// пень: кругляк 10/16 высотой 6/16 и три корня
shape('stump', (o) => {
  cbox(o, 10 * P, 6 * P, 10 * P, { py: 'top', ny: 'bottom' });
  for (const yaw of [15, 140, 250]) o.xf({ rot: [0, yaw, 0] }, () => o.tbox(4 * P, 0, -1.5 * P, 9 * P, 2 * P, 1.5 * P, 'side'));
});
// камешки: три валунка 4–7/16 под разными углами
shape('rock_small', (o) => {
  for (const [x, z, s, yaw] of [[-3 * P, -2 * P, 7 * P, 20], [4 * P, 1 * P, 5 * P, 65], [-1 * P, 5 * P, 4 * P, 40]]) {
    o.xf({ rot: [0, yaw, 0], move: [x, 0, z] }, () => cbox(o, s, s * 0.8, s * 0.9, { py: 'top', ny: 'bottom' }));
  }
});
// опавшие листья: плоские пятна 1/16 на земле, как пена на воде
shape('leaf_litter', (o) => {
  const r = rand(37);
  for (let i = 0; i < 7; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.75, w = snap(0.3 + r() * 0.5), dd = snap(0.25 + r() * 0.4);
    o.xf({ rot: [0, r() * 90, 0], move: [Math.cos(a) * d, 0, Math.sin(a) * d] }, () => cbox(o, w, P, dd, 'top'));
  }
});

// --- руины (партия «Руины»): надгробия, крест, статуя в капюшоне, чаша, горшки, плющ, череп (референсы 2, 8, 10) ---
// надгробие: плита 8/16 × 14/16 × 3/16 со скруглённым верхом (ступенька), чуть наклонено
shape('gravestone', (o) => {
  o.xf({ rot: [0, 0, -4] }, () => {
    o.tbox(-4 * P, 0, -1.5 * P, 4 * P, 12 * P, 1.5 * P, { py: 'top', ny: 'bottom' });
    o.tbox(-3 * P, 12 * P, -1.5 * P, 3 * P, 14 * P, 1.5 * P, { py: 'top', ny: null });
    o.tbox(-5 * P, 0, -2.5 * P, 5 * P, 2 * P, 2.5 * P, { py: 'top', ny: 'bottom' });
  });
});
// широкое надгробие: 12/16 × 9/16, плоский верх с выщербиной
shape('gravestone_wide', (o) => {
  o.xf({ rot: [0, 0, 3] }, () => {
    o.tbox(-6 * P, 0, -1.5 * P, 6 * P, 8 * P, 1.5 * P, { py: 'top', ny: 'bottom' });
    o.tbox(-6 * P, 8 * P, -1.5 * P, 2 * P, 9 * P, 1.5 * P, { py: 'top', ny: null });
  });
});
// упавшее надгробие: плита лежит на земле под углом, край приподнят
shape('gravestone_fallen', (o) => {
  o.xf({ rot: [8, 25, 0], move: [0, P, 0] }, () => o.tbox(-7 * P, 0, -4 * P, 7 * P, 3 * P, 4 * P, { py: 'top', ny: 'bottom' }));
});
// могильный крест: столбик 2/16 и перекладина, покосился
shape('grave_cross', (o) => {
  o.xf({ rot: [0, 0, 6] }, () => {
    o.tbox(-P, 0, -P, P, 14 * P, P, { py: 'top', ny: 'bottom' });
    o.tbox(-5 * P, 9 * P, -P, 5 * P, 11 * P, P, { py: 'top', ny: 'bottom' });
  });
});
// статуя в капюшоне на постаменте (референс 2): постамент 14/16, тело сужается кверху, капюшон нависает, руки сложены
shape('statue_hooded', (o) => {
  cbox(o, 14 * P, 8 * P, 14 * P, { py: 'top', ny: 'bottom' });
  o.tbox(-5 * P, 8 * P, -4 * P, 5 * P, 20 * P, 4 * P, { py: 'top', ny: null });
  o.tbox(-4 * P, 20 * P, -3 * P, 4 * P, 27 * P, 3 * P, { py: 'top', ny: null });
  o.tbox(-4 * P, 15 * P, 4 * P, 4 * P, 18 * P, 6 * P, { py: 'top', ny: 'bottom' });
  o.tbox(-3 * P, 27 * P, -3 * P, 3 * P, 33 * P, 3 * P, { py: 'hood', ny: null, px: 'hood', nx: 'hood', pz: 'hood', nz: 'hood' });
  o.tbox(-4 * P, 30 * P, -4 * P, 4 * P, 35 * P, 4 * P, { py: 'hood', ny: 'hood', px: 'hood', nx: 'hood', pz: 'hood', nz: 'hood' });
});
// каменная чаша: ножка 6/16, чаша 14/16 с углублением
shape('stone_bowl', (o) => {
  cbox(o, 6 * P, 3 * P, 6 * P, { py: 'top', ny: 'bottom' });
  o.tbox(-7 * P, 3 * P, -7 * P, 7 * P, 5 * P, 7 * P, { py: 'inner', ny: 'bottom' });
  for (const [x0, z0, x1, z1] of [[-7, -7, 7, -5], [-7, 5, 7, 7], [-7, -5, -5, 5], [5, -5, 7, 5]]) o.tbox(x0 * P, 5 * P, z0 * P, x1 * P, 9 * P, z1 * P, { py: 'top', ny: null });
});
// горшки: большой 8/16 с горлышком и малый 5/16, один накренён
shape('pot_clay', (o) => {
  o.xf({ move: [-3 * P, 0, -2 * P] }, () => {
    cbox(o, 8 * P, 9 * P, 8 * P, { py: 'top', ny: 'bottom' });
    o.tbox(-3 * P, 9 * P, -3 * P, 3 * P, 11 * P, 3 * P, { py: null, ny: null });
    o.tbox(-3.5 * P, 11 * P, -3.5 * P, 3.5 * P, 12 * P, 3.5 * P, { py: 'top', ny: 'bottom' });
  });
  o.xf({ rot: [0, 30, 12], move: [4 * P, 0, 3 * P] }, () => {
    cbox(o, 5 * P, 6 * P, 5 * P, { py: 'top', ny: 'bottom' });
    o.tbox(-2 * P, 6 * P, -2 * P, 2 * P, 7 * P, 2 * P, { py: 'top', ny: null });
  });
});
// плющ: три плоские полосы 1/16 от стены, свисают от точки крепления вниз (вырезная текстура)
shape('ivy', (o) => {
  for (const [x, w, top, len] of [[-5 * P, 6 * P, 2 * P, 1.3], [1 * P, 7 * P, 1 * P, 0.9], [-1 * P, 5 * P, 3 * P, 1.6]]) {
    o.tbox(x - w / 2, top - len, P, x + w / 2, top, P, { pz: 'side', nz: 'side', px: null, nx: null, py: null, ny: null });
  }
});
// череп: 5/16 с глазницами и челюстью, чуть повёрнут
shape('skull', (o) => {
  o.xf({ rot: [0, 35, 0] }, () => {
    cbox(o, 5 * P, 5 * P, 5 * P, 'bone');
    o.tbox(-2 * P, 2 * P, 2.5 * P, -0.5 * P, 3.5 * P, 2.6 * P, 'dark');
    o.tbox(0.5 * P, 2 * P, 2.5 * P, 2 * P, 3.5 * P, 2.6 * P, 'dark');
    o.tbox(-1.5 * P, 0, 2.5 * P, 1.5 * P, P, 2.7 * P, 'bone');
  });
});

// --- поселение (партия «Поселение», референсы 6, 7, 11, 12, 15) ---
// крылья мельницы: ступица на стене, четыре решётчатых крыла 3 м (брус + две рейки + перекладины); сломанные — три крыла, у одного обломок
const sails = (name, arms) => shape(name, (o) => {
  o.tbox(-3 * P, -3 * P, 0, 3 * P, 3 * P, 8 * P, 'iron');
  for (const [ang, len] of arms) o.xf({ rot: [0, 0, ang], move: [0, 0, 5 * P] }, () => {
    o.tbox(-1.5 * P, 0, -1.5 * P, 1.5 * P, len, 1.5 * P, 'side');
    if (len > 1.5) {
      o.tbox(2 * P, 0.4, -P / 2, 3 * P, len, P / 2, 'lattice');
      o.tbox(9 * P, 0.4, -P / 2, 10 * P, len, P / 2, 'lattice');
      for (let y = 0.5; y < len - 0.1; y += 0.3) o.tbox(1.5 * P, y, -P / 2, 10 * P, y + P, P / 2, 'lattice');
    }
  });
});
sails('windmill_sails', [[0, 4.2], [90, 4.2], [180, 4.2], [270, 4.2]]);
sails('windmill_sails_broken', [[10, 4.2], [100, 4.2], [190, 4.2], [280, 1.1]]);
// бочка: 12/16 × 14/16, обручи выступают на 1/16
shape('barrel', (o) => {
  cbox(o, 12 * P, 14 * P, 12 * P, { py: 'top', ny: 'bottom' });
  for (const y of [2 * P, 11 * P]) o.tbox(-6.5 * P, y, -6.5 * P, 6.5 * P, y + 2 * P, 6.5 * P, { py: null, ny: null });
});
// разбитая бочка: лежит на боку, половина клёпок выпала, доски рядом
shape('barrel_broken', (o) => {
  o.xf({ rot: [0, 25, 90], move: [0, 6 * P, 0] }, () => {
    o.tbox(-6 * P, -6 * P, -6 * P, 6 * P, 7 * P, 0, { py: 'top', ny: 'bottom' });
    o.tbox(-6 * P, -6 * P, 0, -2 * P, 7 * P, 4 * P, { py: 'top', ny: 'bottom' });
  });
  for (const [x, z, a] of [[7 * P, 5 * P, 20], [-6 * P, 8 * P, -35]]) o.xf({ rot: [0, a, 0], move: [x, 0, z] }, () => cbox(o, 2 * P, P, 10 * P, 'side'));
});
// мешок 8/16 с перетянутым горлом
const sackAt = (o, x, z, yaw, h = 9 * P) => o.xf({ rot: [0, yaw, 0], move: [x, 0, z] }, () => {
  cbox(o, 8 * P, h, 7 * P);
  o.tbox(-2 * P, h, -2 * P, 2 * P, h + 2 * P, 2 * P);
  o.tbox(-3 * P, h + 2 * P, -3 * P, 3 * P, h + 3 * P, 3 * P);
});
shape('sack', (o) => sackAt(o, 0, 0, 15));
shape('sacks_pile', (o) => { sackAt(o, -5 * P, -3 * P, 10); sackAt(o, 5 * P, 2 * P, -20); o.xf({ rot: [0, 40, 0], move: [0, 8 * P, 0] }, () => cbox(o, 9 * P, 6 * P, 7 * P)); });
// навес колодца: два столба 2/16 высотой 1,5 м, ворот с ручкой, двускатная крыша 1,2 × 0,9
shape('well_roof', (o) => {
  for (const x of [-9 * P, 9 * P]) o.xf({ move: [x, 0, 0] }, () => cbox(o, 2 * P, 1.5, 2 * P, 'post'));
  o.tbox(-9 * P, 1.15, -P, 9 * P, 1.15 + 2 * P, P, 'post');
  o.tbox(-11 * P, 1.0, -P / 2, -9 * P, 1.15, P / 2, 'iron');
  o.tbox(-0.5 * P, 0.7, -0.5 * P, 0.5 * P, 1.15, 0.5 * P, 'rope');
  for (const [sgn] of [[1], [-1]]) o.xf({ rot: [0, 0, sgn * 35], move: [sgn * 8 * P, 1.5, 0] }, () => o.tbox(-9 * P, 0, -8 * P, 0, 2 * P, 8 * P, 'roof'));
  o.tbox(-2 * P, 1.75, -8 * P, 2 * P, 1.75 + 2 * P, 8 * P, 'roof');
});
// ведро 6/16 с дужкой
shape('bucket', (o) => {
  cbox(o, 6 * P, 6 * P, 6 * P, { py: 'top', ny: 'bottom' });
  o.tbox(-3.5 * P, 4 * P, -3.5 * P, 3.5 * P, 5 * P, 3.5 * P, { py: null, ny: null, px: 'iron', nx: 'iron', pz: 'iron', nz: 'iron' });
  o.tbox(-P / 2, 6 * P, -3 * P, P / 2, 9 * P, 3 * P, 'iron');
});
// приставная лестница на стене: две тетивы 2/16 от точки крепления вниз на 2,4 м, перекладины через 5/16
shape('ladder', (o) => {
  for (const x of [-5 * P, 5 * P]) o.tbox(x - P, -2.4, 2 * P, x + P, 0.1, 4 * P);
  for (let y = -2.3; y < 0; y += 5 * P) o.tbox(-5 * P, y, 2.5 * P, 5 * P, y + P, 3.5 * P);
});
// палатка: два ската ткани на коньке, две жерди, вход с +Z
shape('tent', (o) => {
  for (const sgn of [1, -1]) o.xf({ rot: [0, 0, sgn * 50], move: [sgn * 15 * P, 0, 0] }, () => o.tbox(0, 0, -16 * P, 2 * P, 1.45, 16 * P, 'cloth'));
  o.tbox(-P, 1.1, -17 * P, P, 1.1 + 2 * P, 17 * P, 'pole');
  for (const z of [-15 * P, 15 * P]) o.tbox(-P, 0, z - P, P, 1.1, z + P, 'pole');
  o.tbox(-9 * P, 0, -16.5 * P, 9 * P, 0.9, -15.5 * P, 'cloth');
});
// пугало: шест, перекладина, тело и голова из сена, шляпа
shape('scarecrow', (o) => {
  cbox(o, 2 * P, 1.9, 2 * P, 'pole');
  o.tbox(-9 * P, 1.25, -P, 9 * P, 1.25 + 2 * P, P, 'pole');
  o.tbox(-5 * P, 0.75, -3 * P, 5 * P, 1.45, 3 * P, 'cloth');
  o.tbox(-3 * P, 1.45, -3 * P, 3 * P, 1.8, 3 * P, { py: 'hayTop', ny: 'hayTop', px: 'hay', nx: 'hay', pz: 'hay', nz: 'hay' });
  o.tbox(-5 * P, 1.8, -5 * P, 5 * P, 1.85, 5 * P, 'pole');
  o.tbox(-3 * P, 1.85, -3 * P, 3 * P, 2.05, 3 * P, 'pole');
});
// дрова: поленница из брёвен 5/16 вдоль X в два ряда
shape('firewood_pile', (o) => {
  const log = (y, z, len) => o.xf({ rot: [0, 0, -90], move: [-len / 2, y, z] }, () => o.tbox(-2.5 * P, 0, -2.5 * P, 2.5 * P, len, 2.5 * P, { py: 'end', ny: 'end', px: 'side', nx: 'side', pz: 'side', nz: 'side' }));
  for (const [z, len] of [[-4 * P, 0.9], [1 * P, 0.95], [6 * P, 0.8]]) log(2.5 * P, z, len);
  for (const [z, len] of [[-1.5 * P, 0.85], [3.5 * P, 0.9]]) log(7.5 * P, z, len);
  log(12.5 * P, 1 * P, 0.7);
});
// указатель: столб и две стрелки-доски
shape('signpost', (o) => {
  cbox(o, 2 * P, 2.0, 2 * P, 'post');
  o.xf({ rot: [0, 10, 0], move: [0, 1.6, 0] }, () => o.tbox(-2 * P, 0, -P, 12 * P, 5 * P, P, 'board'));
  o.xf({ rot: [0, 200, 0], move: [0, 1.2, 0] }, () => o.tbox(-2 * P, 0, -P, 10 * P, 5 * P, P, 'board'));
});
// сломанная телега: кузов завалился на бок без колеса, колесо лежит рядом
shape('cart_broken', (o) => {
  o.xf({ rot: [0, 20, -28], move: [2 * P, 0, 0] }, () => cartBody(o));
  o.xf({ rot: [90, 0, 0], move: [-12 * P, 1.5 * P, 10 * P] }, () => wheel(o, 0, 0, 0));
});

mkdirSync(OUT, { recursive: true });
for (const s of shapes) writeFileSync(join(OUT, `${s.name}.obj`), s.text());
console.log(`${shapes.length} форм декора → ${OUT}`);
