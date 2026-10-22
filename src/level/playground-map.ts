import { Level } from './level.ts';
import { BLOCKS } from './palette.ts';

/**
 * Карта плейграунда: арена 48 × 48 м из блоков (стены, укрытия, колонна, диагональ, угол, коридор)
 * и «витрина» за южной стеной — все блоки палитры, вода, дерево, лестницы, забор, костёр.
 * `npm run map:playground` пишет assets/maps/playground.json; дальше карту можно править в редакторе.
 */

export const PG_HALF = 24;
/** Надписи на полу витрины: [подпись, x, z] */
export interface PgLabel { text: string; x: number; z: number; size?: number }

export function buildPlaygroundLevel(): { level: Level; labels: PgLabel[] } {
  const L = new Level('Плейграунд');
  const labels: PgLabel[] = [];
  const H = PG_HALF;

  // ---------- арена ----------
  // пол: шахматный камень, каждые 5 м — светлая полоса гравия
  for (let x = -H; x <= H; x++) for (let z = -H; z <= H; z++) {
    L.set(x, -1, z, x % 5 === 0 || z % 5 === 0 ? 'gravel' : (x + z) % 2 ? 'stone' : 'tiles');
  }
  // стены по периметру: дальние (−X, −Z) 3 блока, со стороны камеры (+X, +Z) — 1 блок; на юге проём к витрине
  const W = H + 1;
  for (let i = -W; i <= W; i++) {
    for (let y = 0; y < 3; y++) { L.set(i, y, -W, 'bricks'); L.set(-W, y, i, 'bricks'); }
    L.set(W, 0, i, 'bricks');
    if (Math.abs(i) > 1) L.set(i, 0, W, 'bricks');
  }
  for (let i = -W; i <= W; i++) { L.set(i, -1, -W, 'bricks'); L.set(i, -1, W, 'bricks'); L.set(-W, -1, i, 'bricks'); L.set(W, -1, i, 'bricks'); }

  // укрытия: низкие (14/16 — стоя стрелять поверх можно) и высокие 2 блока
  for (let x = 5; x <= 7; x++) L.set(x, 0, -8, 'bricks_low');
  for (let z = -14; z <= -12; z++) L.set(10, 0, z, 'cobble_low');
  for (let x = 2; x <= 4; x++) L.fill(x, 0, -13, x, 1, -13, 'bricks');
  for (let x = 14; x <= 15; x++) L.fill(x, 0, -9, x, 1, -9, 'bricks');
  // колонна
  L.fill(9, 0, -3, 9, 2, -3, 'bricks');
  L.set(9, 3, -3, 'bricks_slab');
  // диагональ (бывшая стена под 45°): рикошеты и скольжение
  for (let k = 0; k < 5; k++) L.fill(17 + k, 0, -1 - k, 17 + k, 2, -1 - k, 'bricks_old');
  // угол комнаты
  for (let x = 16; x <= 21; x++) L.fill(x, 0, 5, x, 2, 5, 'bricks');
  for (let z = 5; z <= 10; z++) L.fill(16, 0, z, 16, 2, z, 'bricks');
  // коридор 3 м с проёмом 1 м посередине
  for (let x = 2; x <= 12; x++) { L.fill(x, 0, 13, x, 1, 13, 'bricks'); L.fill(x, 0, 17, x, 1, 17, 'bricks'); }
  L.fill(7, 0, 14, 7, 1, 14, 'bricks'); L.fill(7, 0, 16, 7, 1, 16, 'bricks');
  // факелы по углам, чтобы было видно свет
  for (const [x, z] of [[-23, -23], [23, -23], [-23, 23]]) L.set(x, 0, z, 'torch');

  // ---------- витрина ----------
  const Z0 = W + 1, Z1 = W + 20;
  for (let x = -W; x <= W; x++) for (let z = Z0; z <= Z1; z++) L.set(x, -1, z, Math.abs(x) <= 1 && z <= Z0 + 3 ? 'gravel' : 'grass');
  // низкая ограда витрины
  for (let x = -W; x <= W; x++) L.set(x, 0, Z1, 'fence');
  for (let z = Z0; z <= Z1; z++) { L.set(-W, 0, z, 'fence'); L.set(W, 0, z, 'fence'); }
  labels.push({ text: 'витрина блоков: все блоки палитры', x: 0, z: Z0 + 1.2, size: 1.1 });

  // ряд 1–2: все «твёрдые» блоки палитры по одному, подпись под каждым
  const solids = BLOCKS.filter((b) => b.name !== 'air' && !b.scatter && !b.name.endsWith('_stairs') && b.parts.length && b.collide > 0);
  let i = 0;
  for (const b of solids) {
    const x = -22 + (i % 23) * 2, z = Z0 + 4 + Math.floor(i / 23) * 4;
    L.set(x, 0, z, b.name);
    labels.push({ text: b.title, x, z: z + 1, size: 0.5 });
    i++;
  }
  // ряд 3: ступени в четырёх поворотах и проходимые блоки
  const stairs = BLOCKS.filter((b) => b.name.endsWith('_stairs'));
  let x = -22;
  const zs = Z0 + 12;
  for (const b of stairs) {
    for (let r = 0; r < 4; r++) { L.set(x, 0, zs, b.name, r); x++; }
    labels.push({ text: `${b.title} ×4`, x: x - 2.5, z: zs + 1, size: 0.5 });
    x += 1;
  }
  for (const name of ['tall_grass', 'fern', 'flower_red', 'flower_blue', 'flower_white', 'flower_yellow', 'hole', 'fire']) { L.set(x, 0, zs, name); labels.push({ text: name, x, z: zs + 1, size: 0.4 }); x += 1; }

  // ряд 4: сборки — вода, кислота, дерево, забор с сеном, костёр, лестница на площадку, домик
  const zb = Z0 + 15;
  L.fill(-23, -1, zb, -19, -1, zb + 3, 'water');
  L.fill(-23, -2, zb, -19, -2, zb + 3, 'sand');
  labels.push({ text: 'вода', x: -21, z: zb + 4.4, size: 0.6 });
  L.fill(-16, -1, zb, -14, -1, zb + 3, 'acid');
  L.fill(-16, -2, zb, -14, -2, zb + 3, 'stone');
  labels.push({ text: 'кислота', x: -15, z: zb + 4.4, size: 0.6 });
  // дерево
  const tx = -10, tz = zb + 2;
  L.fill(tx, 0, tz, tx, 3, tz, 'log');
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 3; dy <= 5; dy++) {
    const d2 = dx * dx + dz * dz + (dy - 4) * (dy - 4) * 1.5;
    if (d2 <= 4.6 && !(dx === 0 && dz === 0 && dy === 3)) L.set(tx + dx, dy, tz + dz, 'leaves');
  }
  L.set(tx + 2, 0, tz + 1, 'berry_bush'); L.set(tx - 2, 0, tz - 1, 'berry_bush');
  labels.push({ text: 'дерево и кусты', x: tx, z: zb + 4.4, size: 0.6 });
  // загон с сеном
  for (let fx = -5; fx <= -1; fx++) { L.set(fx, 0, zb, 'fence'); L.set(fx, 0, zb + 3, 'fence'); }
  for (let fz = zb; fz <= zb + 3; fz++) { L.set(-5, 0, fz, 'fence'); L.set(-1, 0, fz, 'fence'); }
  L.set(-3, 0, zb + 1, 'hay'); L.set(-4, 0, zb + 2, 'hay'); L.set(-3, 1, zb + 1, 'hay');
  labels.push({ text: 'забор, сено', x: -3, z: zb + 4.4, size: 0.6 });
  // костёр и факелы
  L.set(2, 0, zb + 1, 'campfire'); L.set(0, 0, zb + 3, 'torch'); L.set(4, 0, zb + 3, 'torch');
  for (const [cx, cz] of [[1, zb + 3], [3, zb + 3]]) L.set(cx, 0, cz, 'crate');
  labels.push({ text: 'костёр, факелы', x: 2, z: zb + 4.4, size: 0.6 });
  // лестница на площадку 2 блока: ступени → полублок → ступени; наверху стенка
  L.fill(8, 0, zb, 12, 1, zb + 3, 'stone');
  L.fill(8, 2, zb, 12, 2, zb + 3, 'cobble_wall'); L.fill(9, 2, zb + 1, 11, 2, zb + 2, 'air');
  L.fill(8, 2, zb + 1, 8, 2, zb + 2, 'air'); L.fill(12, 2, zb + 1, 12, 2, zb + 2, 'air'); // проходы для подъёма и спуска
  // подъём: ступени (0,5 → 1) → блок с полублоком (1,5) → площадка (2); спуск с другой стороны ступенями
  for (const dz of [1, 2]) {
    L.set(6, 0, zb + dz, 'stone_stairs', 0);
    L.set(7, 0, zb + dz, 'stone'); L.set(7, 1, zb + dz, 'stone_slab');
    L.set(13, 1, zb + dz, 'cobble_stairs', 2); L.set(13, 0, zb + dz, 'cobble');
    L.set(14, 0, zb + dz, 'cobble_stairs', 2);
  }
  labels.push({ text: 'ступени → площадка 2 м → спуск', x: 10, z: zb + 4.4, size: 0.6 });
  // домик с крышей из ступеней
  const hx = 19, hz = zb + 1;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -1; dz <= 2; dz++) {
    const edge = Math.abs(dx) === 2 || dz === -1 || dz === 2;
    if (!edge) continue;
    const corner = Math.abs(dx) === 2 && (dz === -1 || dz === 2);
    for (let y = 0; y < 2; y++) {
      if (dx === 0 && dz === -1) continue; // дверь на север
      L.set(hx + dx, y, hz + dz, corner ? 'log' : 'planks');
    }
  }
  for (let dz = -2; dz <= 3; dz++) {
    L.set(hx - 3, 2, hz + dz, 'roof_stairs', 0); L.set(hx + 3, 2, hz + dz, 'roof_stairs', 2);
    L.set(hx - 2, 2, hz + dz, 'planks'); L.set(hx + 2, 2, hz + dz, 'planks');
    L.set(hx - 2, 3, hz + dz, 'roof_dark_stairs', 0); L.set(hx + 2, 3, hz + dz, 'roof_dark_stairs', 2);
    L.set(hx - 1, 3, hz + dz, 'planks'); L.set(hx + 1, 3, hz + dz, 'planks'); L.set(hx, 3, hz + dz, 'planks');
    L.set(hx - 1, 4, hz + dz, 'roof_slab'); L.set(hx, 4, hz + dz, 'roof_slab'); L.set(hx + 1, 4, hz + dz, 'roof_slab');
  }
  L.set(hx - 1, 0, hz - 2, 'torch'); L.set(hx + 1, 0, hz - 2, 'torch');
  labels.push({ text: 'домик', x: hx, z: zb + 4.4, size: 0.6 });

  L.spawn = [0, 0, 0];
  L.meta = { labels };
  L.dirty.clear();
  return { level: L, labels };
}
