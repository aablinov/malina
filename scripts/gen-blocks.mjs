#!/usr/bin/env node
/**
 * Генератор форм блоков: пишет assets/blocks/*.obj.
 *
 * Все формы живут в кубе 1 × 1 × 1 м с началом в нижнем ближнем углу (0,0,0),
 * размеры кратны 1/16 — так любые блоки стыкуются друг с другом.
 * Группа `usemtl <имя>` — слот текстуры, его заполняет палитра (src/level/palette.ts).
 * UV идут в долях блока: грань полублока берёт нижнюю половину текстуры, и пиксели сходятся по сетке.
 *
 * Файлы можно править и руками (Blockbench, Blender): нужны только v / vt / vn / usemtl / f.
 *
 *   node scripts/gen-blocks.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Obj } from './obj-writer.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'blocks');
const P = 1 / 16;

const shapes = [];
const shape = (name, build) => { const o = new Obj(name); build(o); shapes.push(o); };

// --- целые и половинки ---
shape('cube', (o) => o.box(0, 0, 0, 1, 1, 1, {}));
// бревно лёжа вдоль X: срезы на торцах ±X
shape('cube_x', (o) => o.box(0, 0, 0, 1, 1, 1, { px: 'top', nx: 'top', py: 'side', ny: 'side' }));
shape('slab', (o) => o.box(0, 0, 0, 1, 0.5, 1, {}));
// ступени: низкая часть во весь блок, высокая — у дальней грани +X
shape('stairs', (o) => {
  o.box(0, 0, 0, 1, 0.5, 1, { py: null }).box(0.5, 0.5, 0, 1, 1, 1, { ny: null });
  o.quad([[0, 0.5, 0], [0, 0.5, 1], [0.5, 0.5, 1], [0.5, 0.5, 0]], [[0, 1], [0, 0], [0.5, 0], [0.5, 1]], 'top', [0, 1, 0]);
});
shape('layer', (o) => o.box(0, 0, 0, 1, 2 * P, 1, {}));
// низкое укрытие: 14/16 — не перешагнуть, но стоя стрелять поверх можно
shape('low', (o) => o.box(0, 0, 0, 1, 14 * P, 1, {}));
// бортик грядки: тонкий брус вдоль X у ближнего края (z = 0)
shape('rail', (o) => o.box(0, 0, 0, 1, 2.5 * P, 2.25 * P, {}));

// --- стенка 8/16 (столбик + сегменты к соседям) и забор ---
shape('wall_post', (o) => o.box(4 * P, 0, 4 * P, 12 * P, 1, 12 * P, {}));
shape('wall_seg', (o) => o.box(0.5, 0, 5 * P, 1, 14 * P, 11 * P, { nx: null }));
shape('fence_post', (o) => o.box(6 * P, 0, 6 * P, 10 * P, 1, 10 * P, {}));
shape('fence_rail', (o) => o.box(0.5, 6 * P, 7 * P, 1, 9 * P, 9 * P, { nx: null }).box(0.5, 12 * P, 7 * P, 1, 15 * P, 9 * P, { nx: null }));

// --- вода: верх на 14/16, чтобы берег читался ---
shape('water', (o) => o.box(0, 0, 0, 1, 14 * P, 1, {}));

// --- растения и огонь ---
shape('cross', (o) => o.cross('side'));
shape('fire', (o) => o.cross('side').cross('side', 2 * P, 14 * P, 0, 12 * P));
shape('torch', (o) => o.box(7 * P, 0, 7 * P, 9 * P, 10 * P, 9 * P, 'side'));
shape('torch_flame', (o) => o.cross('side', 5 * P, 11 * P, 9 * P, 15 * P));
// костёр: два бревна вдоль X снизу, два вдоль Z сверху, зола в центре
shape('campfire_logs', (o) => {
  o.box(0, 0, 2 * P, 1, 4 * P, 6 * P, { px: 'top', nx: 'top', py: 'side', ny: 'side' });
  o.box(0, 0, 10 * P, 1, 4 * P, 14 * P, { px: 'top', nx: 'top', py: 'side', ny: 'side' });
  o.box(2 * P, 4 * P, 0, 6 * P, 8 * P, 1, { pz: 'top', nz: 'top', py: 'side', ny: 'side', px: 'side', nx: 'side' });
  o.box(10 * P, 4 * P, 0, 14 * P, 8 * P, 1, { pz: 'top', nz: 'top', py: 'side', ny: 'side', px: 'side', nx: 'side' });
  o.box(4 * P, 0, 4 * P, 12 * P, 1 * P, 12 * P, 'bottom');
});
shape('campfire_fire', (o) => o.cross('side', 3 * P, 13 * P, 4 * P, 1));
// столб моста: брус 12/16 во всю высоту, сверху и снизу торцы
shape('post', (o) => o.box(2 * P, 0, 2 * P, 14 * P, 1, 14 * P, {}));
// ящик чуть меньше блока, чтобы в стопке читались щели
shape('crate', (o) => o.box(0.5 * P, 0, 0.5 * P, 15.5 * P, 15 * P, 15.5 * P, {}));


// --- дом ---
// окно: стекло толщиной 2/16 посередине клетки, вдоль X (в стене вдоль Z — поворот 1)
shape('pane', (o) => o.box(0, 0, 7 * P, 1, 1, 9 * P, {}));
// ковёр: 1/16
shape('carpet', (o) => o.box(0, 0, 0, 1, P, 1, {}));

// --- мебель: «смотрит» к +X (спинка у −X), поворот разворачивает ---
const legs = (o, h, inset, t, g = 'side') => {
  for (const [x, z] of [[inset, inset], [1 - inset - t, inset], [inset, 1 - inset - t], [1 - inset - t, 1 - inset - t]]) o.box(x, 0, z, x + t, h, z + t, g);
};
// стол: столешница 2/16 на высоте 11–13/16, ножки 2/16
shape('table', (o) => { o.box(0, 11 * P, 0, 1, 13 * P, 1, {}); legs(o, 11 * P, P, 2 * P); });
// стул: сиденье 7–9/16, спинка у −X до верха клетки
shape('chair', (o) => {
  o.box(2 * P, 7 * P, 2 * P, 14 * P, 9 * P, 14 * P, {});
  legs(o, 7 * P, 2 * P, 2 * P);
  o.box(2 * P, 9 * P, 2 * P, 4 * P, 1, 14 * P, 'side');
});
// диван: основание 7/16, спинка у −X, подлокотники не нужны — секции стыкуются в ряд
shape('sofa', (o) => { o.box(0, P, 0, 1, 7 * P, 1, {}); o.box(0, 7 * P, 0, 4 * P, 14 * P, 1, {}); legs(o, P, P, 2 * P, 'bottom'); });
// кровать: изножье — матрас 9/16; изголовье — матрас, подушка и спинка у −X
shape('bed', (o) => o.box(0, 0, 0, 1, 9 * P, 1, {}));
shape('bed_head', (o) => {
  o.box(2 * P, 0, 0, 1, 9 * P, 1, {});
  o.box(3 * P, 9 * P, 2 * P, 9 * P, 11 * P, 14 * P, 'pillow');
  o.box(0, 0, 0, 2 * P, 14 * P, 1, 'wood');
});
// торшер: подставка, стойка и абажур
shape('lamp', (o) => {
  o.box(5 * P, 0, 5 * P, 11 * P, P, 11 * P, 'pole');
  o.box(7.5 * P, P, 7.5 * P, 8.5 * P, 11 * P, 8.5 * P, 'pole');
  o.box(4 * P, 11 * P, 4 * P, 12 * P, 16 * P, 12 * P, { px: 'shade', nx: 'shade', pz: 'shade', nz: 'shade', py: null, ny: 'shade' });
});

mkdirSync(OUT, { recursive: true });
for (const s of shapes) writeFileSync(join(OUT, `${s.name}.obj`), s.text());
console.log(`${shapes.length} форм → ${OUT}`);
