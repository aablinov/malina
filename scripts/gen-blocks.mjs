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

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'blocks');
const P = 1 / 16;

class Obj {
  constructor(name) { this.name = name; this.v = []; this.vt = []; this.vn = []; this.faces = []; this.group = ''; }
  /** Четырёхугольник: 4 точки [x,y,z], 4 uv [u,v], группа. Обход против часовой снаружи. */
  quad(pts, uvs, group, normal) {
    const [a, b, c] = pts;
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const len = Math.hypot(...n) || 1;
    n = n.map((k) => k / len);
    if (normal && n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2] < 0) { pts = [pts[0], pts[3], pts[2], pts[1]]; uvs = [uvs[0], uvs[3], uvs[2], uvs[1]]; n = n.map((k) => -k); }
    const vi = pts.map((p) => this.v.push(p)), ti = uvs.map((t) => this.vt.push(t));
    const ni = this.vn.push(n);
    this.faces.push({ group, idx: [0, 1, 2].map((k) => `${vi[k]}/${ti[k]}/${ni}`) }, { group, idx: [0, 2, 3].map((k) => `${vi[k]}/${ti[k]}/${ni}`) });
  }
  /** Бокс от (x0,y0,z0) до (x1,y1,z1); groups — слот для каждой грани px/nx/py/ny/pz/nz (null — грани нет) */
  box(x0, y0, z0, x1, y1, z1, groups) {
    const g = typeof groups === 'string' ? { px: groups, nx: groups, py: groups, ny: groups, pz: groups, nz: groups } : { px: 'side', nx: 'side', pz: 'side', nz: 'side', py: 'top', ny: 'bottom', ...groups };
    if (g.py) this.quad([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [[x0, 1 - z0], [x0, 1 - z1], [x1, 1 - z1], [x1, 1 - z0]], g.py, [0, 1, 0]);
    if (g.ny) this.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [[x0, 1 - z0], [x1, 1 - z0], [x1, 1 - z1], [x0, 1 - z1]], g.ny, [0, -1, 0]);
    if (g.px) this.quad([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [[1 - z0, y0], [1 - z0, y1], [1 - z1, y1], [1 - z1, y0]], g.px, [1, 0, 0]);
    if (g.nx) this.quad([[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]], [[z1, y0], [z1, y1], [z0, y1], [z0, y0]], g.nx, [-1, 0, 0]);
    if (g.pz) this.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], g.pz, [0, 0, 1]);
    if (g.nz) this.quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [[1 - x1, y0], [1 - x0, y0], [1 - x0, y1], [1 - x1, y1]], g.nz, [0, 0, -1]);
    return this;
  }
  /** Две скрещённые по диагонали плоскости (трава, цветы, огонь); рисуются с двух сторон */
  cross(group, x0 = 0, x1 = 1, y0 = 0, y1 = 1) {
    const m = (x0 + x1) / 2, h = (x1 - x0) / 2;
    this.quad([[m - h, y0, m - h], [m + h, y0, m + h], [m + h, y1, m + h], [m - h, y1, m - h]], [[0, y0], [1, y0], [1, y1], [0, y1]], group);
    this.quad([[m + h, y0, m - h], [m - h, y0, m + h], [m - h, y1, m + h], [m + h, y1, m - h]], [[0, y0], [1, y0], [1, y1], [0, y1]], group);
    return this;
  }
  text() {
    const r = (n) => +n.toFixed(5);
    const out = [`# ${this.name} — форма блока «Малины», 1 блок = 1 м, сетка 1/16`, `o ${this.name}`];
    for (const p of this.v) out.push(`v ${r(p[0])} ${r(p[1])} ${r(p[2])}`);
    for (const t of this.vt) out.push(`vt ${r(t[0])} ${r(t[1])}`);
    for (const n of this.vn) out.push(`vn ${r(n[0])} ${r(n[1])} ${r(n[2])}`);
    let g = null;
    for (const f of this.faces) {
      if (f.group !== g) { g = f.group; out.push(`usemtl ${g}`); }
      out.push(`f ${f.idx.join(' ')}`);
    }
    return out.join('\n') + '\n';
  }
}

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
// ящик чуть меньше блока, чтобы в стопке читались щели
shape('crate', (o) => o.box(0.5 * P, 0, 0.5 * P, 15.5 * P, 15 * P, 15.5 * P, {}));

mkdirSync(OUT, { recursive: true });
for (const s of shapes) writeFileSync(join(OUT, `${s.name}.obj`), s.text());
console.log(`${shapes.length} форм → ${OUT}`);
