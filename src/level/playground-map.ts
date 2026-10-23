import { Level } from './level.ts';
import { BLOCKS } from './palette.ts';

/**
 * Карта плейграунда: арена 48 × 48 м из блоков (трава, стены, укрытия, колонна, диагональ, угол, коридор, пруд, площадка со ступенями)
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
  // пол — трава, у нулевой точки площадка из плит; разметка 5 м — тропинки (видно расстояния, но это кусочек мира, а не серая сетка)
  for (let x = -H; x <= H; x++) for (let z = -H; z <= H; z++) {
    const plaza = Math.max(Math.abs(x), Math.abs(z)) <= 2;
    const mark = (x % 10 === 0 && Math.abs(z) <= H - 1) || (z % 10 === 0 && Math.abs(x) <= H - 1);
    L.set(x, -1, z, plaza ? 'tiles' : mark ? 'path' : 'grass');
  }
  // стены по периметру: дальние (−X, −Z) 3 блока, со стороны камеры (+X, +Z) — 1 блок; на юге проём к витрине, на востоке — во двор с домом
  const W = H + 1;
  for (let i = -W; i <= W; i++) {
    for (let y = 0; y < 3; y++) { L.set(i, y, -W, y === 2 ? 'bricks' : 'bricks_old'); L.set(-W, y, i, y === 2 ? 'bricks' : 'bricks_old'); }
    if (Math.abs(i) > 1) { L.set(W, 0, i, 'bricks_mossy'); L.set(i, 0, W, 'bricks_mossy'); }
  }
  for (let i = -W; i <= W; i++) { L.set(i, -1, -W, 'stone'); L.set(i, -1, W, 'stone'); L.set(-W, -1, i, 'stone'); L.set(W, -1, i, 'stone'); }
  // факелы на дальних стенах — тёплые пятна света
  for (let i = -20; i <= 20; i += 8) { L.set(i, 0, -H, 'torch'); L.set(-H, 0, i, 'torch'); }

  // укрытия: низкие (14/16) и высокие 2 блока
  for (let x = 5; x <= 7; x++) L.set(x, 0, -8, 'cobble_low');
  for (let z = -14; z <= -12; z++) L.set(10, 0, z, 'bricks_low');
  for (let x = 2; x <= 4; x++) L.fill(x, 0, -13, x, 1, -13, 'mossy');
  for (let x = 14; x <= 15; x++) L.fill(x, 0, -9, x, 1, -9, 'mossy');
  // колонна
  L.fill(9, 0, -3, 9, 2, -3, 'bricks');
  // диагональ: скольжение вдоль стены
  for (let k = 0; k < 5; k++) L.fill(17 + k, 0, -1 - k, 17 + k, 2, -1 - k, 'bricks_old');
  // угол комнаты
  for (let x = 16; x <= 21; x++) L.fill(x, 0, 5, x, 2, 5, 'bricks_old');
  for (let z = 5; z <= 10; z++) L.fill(16, 0, z, 16, 2, z, 'bricks_old');
  // коридор 3 м с проёмом 1 м посередине
  for (let x = 2; x <= 12; x++) { L.fill(x, 0, 13, x, 1, 13, 'bricks'); L.fill(x, 0, 17, x, 1, 17, 'bricks'); }
  L.fill(7, 0, 14, 7, 1, 14, 'bricks'); L.fill(7, 0, 16, 7, 1, 16, 'bricks');

  // площадка 2 блока с подъёмом по ступеням: прыжка нет, перепады высоты — ступени и полублоки
  L.fill(-20, 0, -21, -16, 1, -19, 'cobble');
  // подъём к −X: ступени (0,5 → 1) → блок с полублоком (1,5) → площадка (2)
  for (let z = -21; z <= -19; z++) { L.set(-14, 0, z, 'cobble_stairs', 2); L.set(-15, 0, z, 'cobble'); L.set(-15, 1, z, 'cobble_slab'); }
  L.set(-18, 2, -21, 'torch');
  labels.push({ text: 'площадка 2 м: ступени', x: -17, z: -17.6, size: 0.7 });

  // пруд: живая вода с песчаным дном, кувшинки-цветы по берегу
  L.fill(-21, -1, 2, -15, -1, 6, 'water');
  L.fill(-21, -2, 2, -15, -2, 6, 'sand');
  L.set(-15, -1, 2, 'sand'); L.set(-21, -1, 6, 'sand'); L.set(-16, -1, 6, 'grass');
  for (const [fx, fz, f] of [[-22, 3, 'flower_blue'], [-22, 5, 'fern'], [-14, 4, 'flower_yellow'], [-18, 7, 'tall_grass'], [-17, 1, 'flower_white']] as [number, number, string][]) L.set(fx, 0, fz, f);
  labels.push({ text: 'пруд', x: -18, z: 7.8, size: 0.7 });

  // трава и цветы россыпью по свободной траве (детерминированно)
  const FLORA = ['tall_grass', 'tall_grass', 'tall_grass', 'fern', 'flower_red', 'flower_yellow', 'flower_blue', 'flower_white'];
  for (let x = -H + 1; x <= H - 1; x++) for (let z = -H + 1; z <= H - 1; z++) {
    const h = ((x * 73856093) ^ (z * 19349663)) >>> 0;
    if (h % 100 >= 7 || L.nameAt(x, -1, z) !== 'grass' || L.nameAt(x, 0, z) !== 'air') continue;
    if (Math.abs(x) <= 4 && Math.abs(z) <= 6) continue; // у старта чисто
    if (x >= -14 && x <= -1 && z >= 9 && z <= 21) continue; // склад
    if (z >= -18 && z <= -16) continue; // рельс чучела
    L.set(x, 0, z, FLORA[(h >>> 8) % FLORA.length]);
  }

  // ---------- витрина ----------
  const Z0 = W + 1, Z1 = W + 20;
  for (let x = -W; x <= W; x++) for (let z = Z0; z <= Z1; z++) L.set(x, -1, z, Math.abs(x) <= 1 && z <= Z0 + 3 ? 'gravel' : 'grass');
  // низкая ограда витрины
  for (let x = -W; x <= W; x++) L.set(x, 0, Z1, 'fence');
  for (let z = Z0; z <= Z1; z++) { L.set(-W, 0, z, 'fence'); L.set(W, 0, z, 'fence'); }
  labels.push({ text: 'витрина блоков: все блоки палитры', x: 0, z: Z0 + 1.2, size: 1.1 });

  // ряды 1–3: все «твёрдые» блоки палитры по одному, подпись под каждым
  const solids = BLOCKS.filter((b) => b.category !== 'служебные' && !b.scatter && !b.name.endsWith('_stairs') && b.parts.length && b.collide > 0 && b.name !== 'water' && b.name !== 'acid');
  let i = 0;
  for (const b of solids) {
    const x = -22 + (i % 23) * 2, z = Z0 + 4 + Math.floor(i / 23) * 3;
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

  // ---------- двор с двухэтажным домом за восточной стеной ----------
  const X0 = W + 1, X1 = W + 30, YZ0 = -16, YZ1 = 14;
  for (let x = X0; x <= X1; x++) for (let z = YZ0; z <= YZ1; z++) L.set(x, -1, z, x < X0 + 4 && Math.abs(z) <= 1 ? 'path' : 'grass');
  for (let x = X0; x <= X1; x++) { L.set(x, 0, YZ0, 'fence'); L.set(x, 0, YZ1, 'fence'); }
  for (let z = YZ0; z <= YZ1; z++) L.set(X1, 0, z, 'fence');
  labels.push(...buildHouse(L, X0 + 4, -12));

  L.spawn = [0, 0, 0];
  L.meta = { labels };
  L.dirty.clear();
  return { level: L, labels };
}

/**
 * Двухэтажный дом по референсу: бирюзовый верх, белый и оранжевый низ, бурый кирпичный пояс и парапет.
 * Корпус 11 × 11 м, этажи по 3 м (пол второго — верх клеток y = 3), внутри лестница, кухня, столовая,
 * гостиная, на втором — коридор вдоль лестничного проёма, спальня и кабинет. Сбоку гараж-навес,
 * его крыша — терраса: на неё дверь со второго этажа и наружная лестница. (ox, oz) — северо-западный угол корпуса.
 * Двери 1 × 2 м, пол по обе стороны на одном уровне — иначе боец ростом 1,6 м цепляет перемычку.
 */
function buildHouse(L: Level, ox: number, oz: number): PgLabel[] {
  const set = (x: number, y: number, z: number, name: string, rot = 0) => L.set(ox + x, y, oz + z, name, rot);
  const fill = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, name: string, rot = 0) =>
    L.fill(ox + x0, y0, oz + z0, ox + x1, y1, oz + z1, name, rot);

  // ---------- корпус: x, z 0..10 ----------
  fill(0, -1, 0, 10, -1, 10, 'planks');
  for (let x = 0; x <= 10; x++) for (let z = 0; z <= 10; z++) {
    if (x > 0 && x < 10 && z > 0 && z < 10) continue;
    set(x, -1, z, 'brick_brown');
    fill(x, 0, z, x, 2, z, z === 10 ? 'plaster_rust' : 'plaster_white');
    set(x, 3, z, 'brick_brown');
    fill(x, 4, z, x, 6, z, 'plaster_teal');
    set(x, 7, z, 'brick_brown');
    set(x, 8, z, z === 10 ? 'rust_rail' : 'brick_brown');
  }
  fill(1, 3, 1, 9, 3, 9, 'planks'); // перекрытие = пол второго этажа
  fill(1, 7, 1, 9, 7, 9, 'concrete'); // плоская крыша
  fill(2, 8, 1, 3, 9, 2, 'brick_brown'); // труба

  // проёмы: двери на улицу и в гараж, окна на обоих этажах
  fill(6, 0, 10, 6, 1, 10, 'air');
  fill(10, 0, 5, 10, 1, 5, 'air');
  for (const y of [1, 5]) {
    for (const x of [2, 3, 8]) { set(x, y, 10, 'window'); }
    set(8, y, 0, 'window');
    for (const z of [3, 7]) set(0, y, z, 'window', 1);
  }
  set(10, 5, 4, 'window', 1); set(10, 5, 9, 'window', 1);
  fill(10, 4, 7, 10, 5, 7, 'air'); // дверь на террасу

  // лестница вдоль северной стены: 4 ступени к +X, шириной 2, под ней — опоры, над ней — проём в перекрытии
  for (let k = 0; k < 4; k++) {
    fill(3 + k, k, 1, 3 + k, k, 2, 'planks_stairs', 0);
    if (k > 0) fill(3 + k, 0, 1, 3 + k, k - 1, 2, 'planks');
  }
  fill(3, 3, 1, 5, 3, 2, 'air');
  fill(3, 4, 3, 5, 4, 3, 'fence'); fill(2, 4, 1, 2, 4, 2, 'fence'); // ограждение проёма

  // 1 этаж: кухня у западной стены, столовая, гостиная
  set(1, 0, 4, 'counter'); set(1, 0, 5, 'counter'); set(1, 0, 6, 'stove'); set(1, 0, 7, 'counter');
  fill(1, 0, 8, 1, 1, 8, 'fridge'); set(1, 0, 9, 'cabinet_low'); set(1, 0, 1, 'lamp');
  set(3, 0, 6, 'table'); set(4, 0, 6, 'table');
  for (const x of [3, 4]) { set(x, 0, 5, 'chair', 1); set(x, 0, 7, 'chair', 3); }
  fill(9, 0, 6, 9, 0, 8, 'sofa', 2); fill(6, 0, 6, 8, 0, 8, 'rug');
  set(7, 0, 9, 'cabinet_low'); set(9, 0, 9, 'lamp');
  fill(9, 0, 1, 9, 1, 2, 'bookshelf');

  // 2 этаж: коридор z 3..4, перегородка z = 5 с двумя дверями, спальня (x 1..5) и кабинет (x 7..9)
  fill(1, 4, 5, 9, 6, 5, 'plaster_white');
  fill(6, 4, 6, 6, 6, 9, 'plaster_white');
  fill(2, 4, 5, 2, 5, 5, 'air'); fill(8, 4, 5, 8, 5, 5, 'air');
  fill(1, 4, 7, 1, 4, 8, 'bed_head', 0); fill(2, 4, 7, 2, 4, 8, 'bed', 0);
  set(1, 4, 6, 'cabinet_low'); set(1, 4, 9, 'cabinet_low'); set(5, 4, 6, 'lamp');
  fill(4, 4, 9, 5, 5, 9, 'cabinet'); fill(3, 4, 7, 4, 4, 8, 'rug');
  set(8, 4, 9, 'table'); set(9, 4, 9, 'table'); set(8, 4, 8, 'chair', 1);
  fill(7, 4, 9, 7, 5, 9, 'bookshelf'); set(9, 4, 6, 'lamp');
  fill(1, 4, 1, 1, 5, 1, 'bookshelf'); set(9, 4, 1, 'lamp');

  // ---------- гараж-навес: x 10..18, z 2..14; крыша — терраса с бирюзовым парапетом ----------
  fill(11, -1, 3, 17, -1, 13, 'concrete');
  for (let x = 10; x <= 18; x++) for (let z = 2; z <= 14; z++) {
    if (x === 10 && z <= 10) continue; // стена корпуса
    if (x > 10 && x < 18 && z > 2 && z < 14) continue;
    set(x, -1, z, 'brick_brown');
    fill(x, 0, z, x, 2, z, 'plaster_white');
    fill(x, 3, z, x, 4, z, 'plaster_teal');
  }
  fill(11, 3, 3, 17, 3, 13, 'concrete');
  fill(11, 0, 14, 13, 1, 14, 'air'); fill(15, 0, 14, 17, 1, 14, 'air'); fill(14, 0, 14, 14, 1, 14, 'planks_dark');
  set(18, 1, 5, 'window', 1); set(18, 1, 9, 'window', 1);
  fill(16, 0, 3, 17, 0, 3, 'crate'); set(17, 0, 4, 'crate'); set(17, 1, 3, 'crate');
  set(12, 0, 3, 'table'); set(13, 0, 3, 'table'); set(12, 0, 4, 'chair', 3); fill(11, 0, 3, 11, 1, 3, 'cabinet');
  // терраса: столик, два стула, проход в парапете к наружной лестнице
  set(14, 4, 8, 'table'); set(13, 4, 8, 'chair', 0); set(15, 4, 8, 'chair', 2);
  fill(18, 4, 7, 18, 4, 8, 'air');

  // наружная лестница: площадка у парапета (верх 4) и 4 ступени вниз к +Z, шириной 2
  fill(19, -1, 6, 20, -1, 13, 'brick_brown');
  fill(19, 0, 7, 20, 3, 8, 'brick_brown');
  for (let k = 0; k < 4; k++) {
    fill(19, k, 12 - k, 20, k, 12 - k, 'bricks_stairs', 3);
    if (k > 0) fill(19, 0, 12 - k, 20, k - 1, 12 - k, 'brick_brown');
  }

  // крыльцо перед дверью
  fill(0, -1, 11, 9, -1, 13, 'cobble');
  set(4, 0, 11, 'torch'); set(8, 0, 11, 'torch');
  set(0, 0, 13, 'berry_bush'); set(9, 0, 13, 'berry_bush');

  return [
    { text: 'дом: 2 этажа, лестница, терраса', x: ox + 5, z: oz + 15, size: 0.9 },
    { text: 'наружная лестница', x: ox + 20, z: oz + 14.2, size: 0.6 },
  ];
}
