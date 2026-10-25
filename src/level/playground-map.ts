import { Level } from './level.ts';
import { BLOCKS, WORLD_CATEGORIES } from './palette.ts';
import { DECOR, WORLD_DECOR_CATEGORIES } from './decor.ts';
import { buildWorldZone } from './world-zone.ts';

/**
 * Карта плейграунда: арена 48 × 48 м из блоков (трава, стены, укрытия, колонна, диагональ, угол, коридор, пруд, площадка со ступенями)
 * и «витрина» за южной стеной — все блоки палитры, вода, дерево, лестницы, забор, костёр, весь декор.
 * `npm run map:playground` пишет assets/maps/playground.json; дальше карту можно править в редакторе.
 */

export const PG_HALF = 24;
/** Надписи на полу витрины: [подпись, x, z] */
export interface PgLabel { text: string; x: number; z: number; size?: number }

/** Плавный шум 0..1 с шагом 3 м для края дорог (детерминированный) */
function wobble(x: number, z: number): number {
  const h = (i: number, j: number) => { let v = Math.imul(i, 374761393) + Math.imul(j, 668265263); v = Math.imul(v ^ (v >>> 13), 1274126177); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };
  const gx = Math.floor(x / 3), gz = Math.floor(z / 3), fx = x / 3 - gx, fz = z / 3 - gz;
  const sm = (t: number) => t * t * (3 - 2 * t), u = sm(fx), v = sm(fz);
  return (h(gx, gz) * (1 - u) + h(gx + 1, gz) * u) * (1 - v) + (h(gx, gz + 1) * (1 - u) + h(gx + 1, gz + 1) * u) * v;
}

export function buildPlaygroundLevel(): { level: Level; labels: PgLabel[] } {
  const L = new Level('Плейграунд');
  const labels: PgLabel[] = [];
  /** Предмет декора: rot — рыск в градусах (как у блоков), on — клетка, к которой прикреплён */
  const dec = (name: string, x: number, y: number, z: number, rot = 0, on?: [number, number, number]) =>
    L.addDecor({ name, pos: [x, y, z], ...(rot ? { rot: [rot] } : {}), ...(on ? { on } : {}) });
  const H = PG_HALF;

  // ---------- арена ----------
  // пол — трава, у нулевой точки площадка из плит; разметка 10 м — дороги (видно расстояния, но это кусочек мира, а не серая сетка)
  for (let x = -H; x <= H; x++) for (let z = -H; z <= H; z++) {
    const plaza = Math.max(Math.abs(x), Math.abs(z)) <= 2;
    // дороги 3 м по отметкам через 10 м (как в Minecraft Dungeons — широкие, с рваным краем травы)
    const on10 = (v: number) => [0, 1, 9].includes(((v % 10) + 10) % 10);
    const mark = (on10(x) && Math.abs(z) <= H - 1) || (on10(z) && Math.abs(x) <= H - 1);
    L.set(x, -1, z, plaza ? 'tiles' : mark ? 'path' : 'grass');
  }
  // край дороги не по линейке: по плавному шуму клетки у края дороги зарастают травой, а трава у края вытоптана в дорогу —
  // заливы и мысы в метр-два; внутри клетки край рвёт ещё маска мешера (bleed)
  const isPath = (x: number, z: number) => L.nameAt(x, -1, z) === 'path';
  const flips: [number, number, string][] = [];
  for (let x = -H + 1; x <= H - 1; x++) for (let z = -H + 1; z <= H - 1; z++) {
    const me = L.nameAt(x, -1, z);
    if (me !== 'path' && me !== 'grass') continue;
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => isPath(x + dx, z + dz) !== (me === 'path')).length;
    if (!near) continue;
    const n = wobble(x, z);
    if (me === 'path' && n < 0.3) flips.push([x, z, 'grass']);
    else if (me === 'grass' && n > 0.68) flips.push([x, z, 'path']);
  }
  for (const [x, z, name] of flips) L.set(x, -1, z, name);
  // стены по периметру: дальние (−X, −Z) 3 блока, со стороны камеры (+X, +Z) — 1 блок; на юге проём к витрине, на востоке — в зону «мир»
  const W = H + 1;
  for (let i = -W; i <= W; i++) {
    for (let y = 0; y < 3; y++) { L.set(i, y, -W, y === 2 ? 'bricks' : 'bricks_old'); L.set(-W, y, i, y === 2 ? 'bricks' : 'bricks_old'); }
    if (Math.abs(i) > 1) L.set(W, 0, i, 'bricks_mossy'); // проём на восток — в зону «мир»
    if (Math.abs(i) > 1) L.set(i, 0, W, 'bricks_mossy');
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

  // травяной холм в три яруса у западной стены: уступы по 1 м с рваным краем — на них видна бахрома травы
  const tier = (x0: number, x1: number, z0: number, z1: number, y: number) => {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const edge = x === x0 || x === x1 || z === z0 || z === z1;
      if (edge && ((x * 7 + z * 13 + y * 5) % 4 === 0)) continue; // рваный край
      for (let k = 0; k < y; k++) L.set(x, k, z, 'dirt');
      L.set(x, y, z, 'grass');
    }
  };
  tier(-23, -16, 11, 22, 0);
  tier(-23, -19, 13, 21, 1);
  tier(-23, -21, 15, 19, 2);
  // подъём: ступени с травы на 1-й ярус и с 1-го на 2-й
  for (const z of [16, 17]) { L.set(-15, 0, z, 'cobble_stairs', 2); L.set(-18, 1, z, 'cobble_stairs', 2); }
  labels.push({ text: 'уступы: трава свисает с края', x: -19.5, z: 23.6, size: 0.7 });

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
  const Z0 = W + 1, Z1 = W + 30;
  for (let x = -W; x <= W; x++) for (let z = Z0; z <= Z1; z++) L.set(x, -1, z, Math.abs(x) <= 1 && z <= Z0 + 3 ? 'gravel' : 'grass');
  // низкая ограда витрины
  for (let x = -W; x <= W; x++) L.set(x, 0, Z1, 'fence');
  for (let z = Z0; z <= Z1; z++) { L.set(-W, 0, z, 'fence'); L.set(W, 0, z, 'fence'); }
  labels.push({ text: 'витрина блоков: все блоки палитры', x: 0, z: Z0 + 1.2, size: 1.1 });

  // ряды 1–3: все «твёрдые» блоки палитры по одному, подпись под каждым
  const solids = BLOCKS.filter((b) => b.category !== 'служебные' && !WORLD_CATEGORIES.includes(b.category) && !b.scatter && !b.name.endsWith('_stairs') && b.parts.length && b.collide > 0 && b.name !== 'water' && b.name !== 'acid');
  let i = 0;
  for (const b of solids) {
    const x = -22 + (i % 23) * 2, z = Z0 + 4 + Math.floor(i / 23) * 3;
    L.set(x, 0, z, b.name);
    labels.push({ text: b.title, x, z: z + 1, size: 0.5 });
    i++;
  }
  // ряд 3: ступени в четырёх поворотах и проходимые блоки
  const stairs = BLOCKS.filter((b) => b.name.endsWith('_stairs') && !WORLD_CATEGORIES.includes(b.category));
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

  // ряд 5: декор — свободные предметы поверх блоков; у стены — настенный и потолочный, перед ней — напольный
  const zw = Z0 + 22;
  for (let x = -22; x <= 22; x++) for (let y = 0; y < 3; y++) L.set(x, y, zw, y === 2 ? 'bricks' : 'bricks_old');
  for (let x = 6; x <= 12; x++) L.set(x, 2, zw + 1, 'bricks_slab');
  labels.push({ text: 'декор: стоит где угодно, под любым углом, из кубиков 1/16', x: 0, z: zw - 1.3, size: 0.9 });
  const face = zw + 0.5;
  const onWall: [string, number, number][] = [['roots', -19, 2.3], ['cobweb', -15, 2.3], ['banner', -11, 2.6], ['torch_wall', -7, 1.4], ['banner', -3, 2.6], ['torch_wall', 1, 1.4]];
  for (const [name, x, y] of onWall) {
    dec(name, x, y, face, 0, [x, Math.floor(y), zw]);
    labels.push({ text: DECOR.find((d) => d.name === name)!.title, x, z: face + 1, size: 0.45 });
  }
  for (const x of [7, 9, 11]) dec('chain', x, 2, zw + 1, x * 30, [x, 2, zw + 1]);
  labels.push({ text: 'Цепь', x: 9, z: face + 1.4, size: 0.45 });
  const floorItems = DECOR.filter((d) => d.anchor === 'floor' && !WORLD_DECOR_CATEGORIES.includes(d.category));
  floorItems.forEach((d, k) => {
    const x = -21 + k * 4, z = zw + 4;
    dec(d.name, x, 0, z, d.name === 'column_fallen' ? 0 : 20);
    labels.push({ text: d.title, x, z: z + 1.7, size: 0.45 });
  });

  // декор в арене: знамёна между факелами, корни и паутина на дальних стенах, руины, фонари, ящики с цветами
  for (const x of [-16, -8, 8, 16]) dec('banner', x, 2.6, -H - 0.5, 0, [x, 2, -W]);
  dec('cobweb', -23.4, 2.4, -H - 0.5, 0, [-23, 2, -W]);
  for (const [z, name] of [[-14, 'roots'], [-6, 'torch_wall'], [14, 'roots']] as [number, string][]) dec(name, -H - 0.5, name === 'roots' ? 2.5 : 1.4, z, -90, [-W, 2, z]);
  dec('column_fallen', 13, 0, -20, 25);
  dec('column_stump', -2, 0, -21.5, 10);
  dec('rubble', 11, 0, -2);
  dec('bricks_loose', 8, 0, -1.5, 40);
  dec('bones', -0.5, 0, -19.6, 15);
  dec('lantern_post', -13.5, 0, 8.5, 90);
  dec('lantern_post', 22, 0, -22, 180);
  dec('mushrooms_glow', -22, 0, -10, 30);
  dec('mushrooms_glow', -21.4, 0, -11.2, 75);
  dec('mushrooms', -19.5, 0, 9.5, 10);
  dec('planter', 5, 0, 23.6);
  dec('planter', 8, 0, 23.6);
  dec('crates_tilted', 21, 0, 21, -30);
  dec('candles', -17.6, 2, -20.4);

  // ---------- зона «мир» за восточной стеной: наборы по скриншотам Minecraft Dungeons ----------
  buildWorldZone(L, labels, (name, x, y, z, rot = 0, on) => { dec(name, x, y, z, rot, on); });

  buildBossArena(L, labels, W);
  buildBarracks(L, labels, W, dec);
  buildGarden(L, labels, dec);

  L.spawn = [0, 0, 0];
  L.meta = { labels };
  L.dirty.clear();
  return { level: L, labels };
}

/** Арена стража: пол, ворота в коридор, невидимый квадрат-триггер, точка возврата */
export interface BossArenaSpec {
  id: string;
  title: string;
  x0: number; x1: number; z0: number; z1: number;
  /** Ворота в стене коридора: центр, поворот (90° — вдоль Z) */
  gate: { x: number; z: number; rot: number };
  trigger: { x0: number; x1: number; z0: number; z1: number };
  exit: { x: number; z: number; yaw: number };
}

/**
 * Зал стражей за северной стеной (wiki/design-bosses.md, раздел 1): коридор x −1…1 на север, по сторонам — восемь арен
 * 21 × 20 м, по четыре с каждой стороны; ворота — в стене коридора, квадрат-триггер — сразу за воротами.
 */
const HALL = [
  ['cauldron', 'Котёл Ордена'], ['boar', 'Морозный кабан'], ['storm', 'Грозовой голем'], ['golden', 'Золотой страж'],
  ['night', 'Ночной всадник'], ['druse', 'Друзовый голем'], ['gatherer', 'Скорбная Сборщица'], ['cat', 'Кот-могильщик'],
] as const;
/** Боссы этажа — дальше по коридору, арены просторнее (27 × 24 м) */
const HALL_BOSSES = [
  ['serpent', 'Рдяный Змей'], ['beast', 'Громовой Зверь'], ['queen', 'Королева Звёздного Сада'], ['judge', 'Судия Ордена'], ['general', 'Генерал Рдян'],
] as const;
/** Финальные стражи — в самом конце коридора, арены 31 × 30 м */
const HALL_FINALS = [['winter', 'Хозяйка Вечной Зимы'], ['star', 'Павшая Звезда'], ['gardener', 'Первый Садовник']] as const;
/** Акцент пола по стражу: блоки, которыми усыпан пол, и декор у стен */
const THEME: Record<string, { floor: string[]; dots: string[] }> = {
  cauldron: { floor: ['cobble', 'stone', 'bricks_cracked'], dots: ['fire', 'campfire'] },
  boar: { floor: ['stone', 'gravel', 'tiles'], dots: ['dry_grass'] },
  storm: { floor: ['tiles', 'stone', 'bricks'], dots: ['torch'] },
  golden: { floor: ['tiles', 'path', 'grass'], dots: ['flower_yellow', 'tall_grass'] },
  night: { floor: ['cobble', 'mossy', 'gravel'], dots: ['fern', 'tall_grass'] },
  druse: { floor: ['stone', 'cobble', 'gravel'], dots: ['dry_grass'] },
  gatherer: { floor: ['dirt', 'mossy', 'grass'], dots: ['fern', 'flower_white'] },
  cat: { floor: ['bricks_old', 'cobble', 'mossy'], dots: ['torch', 'fern'] },
  serpent: { floor: ['cobble', 'gravel', 'bricks_cracked'], dots: ['fire', 'campfire', 'berry_bush'] },
  beast: { floor: ['stone', 'gravel', 'cobble'], dots: ['dry_grass', 'torch'] },
  queen: { floor: ['tiles', 'grass', 'path'], dots: ['flower_white', 'flower_blue', 'daisies'] },
  judge: { floor: ['tiles', 'bricks', 'stone'], dots: ['torch', 'flower_white'] },
  general: { floor: ['path', 'grass', 'cobble'], dots: ['berry_bush', 'tall_grass', 'flower_red'] },
  // тёмный пол: белая ледяная Хозяйка на нём читается
  winter: { floor: ['cobble', 'bricks_old', 'mossy'], dots: ['dry_grass', 'torch'] },
  star: { floor: ['bricks_cracked', 'stone', 'gravel'], dots: ['torch', 'dry_grass'] },
  gardener: { floor: ['grass', 'dirt', 'path'], dots: ['berry_bush', 'flower_red', 'tall_grass', 'daisies'] },
};

/** Арена: сторона, верхний край по z, ширина, глубина */
function arenaSpec(id: string, title: string, left: boolean, z1: number, w: number, d: number): BossArenaSpec {
  const z0 = z1 - d + 1, zc = (z0 + z1) / 2;
  const x0 = left ? -3 - w + 1 : 3, x1 = left ? -3 : 3 + w - 1;
  return {
    id, title, x0, x1, z0, z1,
    gate: { x: left ? -2 : 2, z: zc, rot: Math.PI / 2 },
    trigger: left ? { x0: -6.5, x1: -3, z0: zc - 2, z1: zc + 2 } : { x0: 3, x1: 6.5, z0: zc - 2, z1: zc + 2 },
    exit: { x: 0, z: zc, yaw: left ? Math.PI / 2 : -Math.PI / 2 },
  };
}

const MINI_END = -28 - 23 * 3 - 19;
export const BOSS_ARENAS: BossArenaSpec[] = [
  ...HALL.map(([id, title], i) => arenaSpec(id, title, i % 2 === 0, -28 - 23 * Math.floor(i / 2), 21, 20)),
  ...HALL_BOSSES.map(([id, title], i) => arenaSpec(id, title, i % 2 === 0, MINI_END - 4 - 28 * Math.floor(i / 2), 27, 24)),
  ...HALL_FINALS.map(([id, title], i) => arenaSpec(id, title, i % 2 === 0, MINI_END - 4 - 28 * 3 - 4 - 34 * Math.floor(i / 2), 31, 30)),
];
export const BOSS_HALL_END = Math.min(...BOSS_ARENAS.map((a) => a.z0)) - 1;

function buildBossArena(L: Level, labels: PgLabel[], W: number): void {
  const hash = (x: number, z: number, s = 0) => (((x * 73856093) ^ (z * 19349663) ^ (s * 83492791)) >>> 0) % 1000 / 1000;
  const END = BOSS_HALL_END;
  // проход в северной стене плейграунда и коридор на север
  for (let x = -1; x <= 1; x++) for (let y = 0; y < 3; y++) L.set(x, y, -W, 'air');
  for (let z = END; z <= -W; z++) {
    for (let x = -1; x <= 1; x++) { L.set(x, -1, z, 'tiles'); L.set(x, -2, z, 'stone'); }
    L.set(-2, -1, z, 'stone'); L.set(2, -1, z, 'stone');
    L.set(-2, 0, z, 'bricks_old'); L.set(2, 0, z, 'bricks_mossy');
  }
  for (let x = -35; x <= 35; x++) for (let y = 0; y < 3; y++) L.set(x, y, END - 1, 'cliff_dark');
  for (const A of BOSS_ARENAS) {
    const T = THEME[A.id];
    const left = A.x0 < 0;
    for (let x = A.x0; x <= A.x1; x++) for (let z = A.z0; z <= A.z1; z++) {
      const n = hash(x, z, 1);
      L.set(x, -1, z, n < 0.5 ? T.floor[0] : n < 0.82 ? T.floor[1] : T.floor[2]);
      L.set(x, -2, z, 'stone');
    }
    // стены: дальняя (запад у левых, север) — скала 3 блока, остальные 1 блок; между аренами — одна стена
    const ox = left ? A.x0 - 1 : A.x1 + 1;
    for (let z = A.z0 - 1; z <= A.z1 + 1; z++) {
      L.set(ox, -1, z, 'stone');
      for (let y = 0; y < (left ? 3 : 1); y++) L.set(ox, y, z, left ? 'cliff_dark' : 'cliff');
    }
    for (let x = Math.min(A.x0, ox); x <= Math.max(A.x1, ox); x++) for (const z of [A.z0 - 1, A.z1 + 1]) {
      L.set(x, -1, z, 'stone');
      for (let y = 0; y < (z === A.z0 - 1 ? 2 : 1); y++) L.set(x, y, z, z === A.z0 - 1 ? 'cliff_dark' : 'cliff');
    }
    // ворота: проём 3 м в стене коридора
    for (let dz = -1; dz <= 1; dz++) { L.set(A.gate.x, 0, Math.round(A.gate.z) + dz, 'air'); L.set(A.gate.x, -1, Math.round(A.gate.z) + dz, 'tiles'); }
    // россыпь декора у стен — по теме стража
    for (let j = 0; j < 9; j++) {
      const x = Math.round(A.x0 + 1 + hash(j, A.z0, 3) * (A.x1 - A.x0 - 2)), z = Math.round(A.z0 + 1 + hash(j, A.z1, 5) * (A.z1 - A.z0 - 2));
      const nearWall = x <= A.x0 + 2 || x >= A.x1 - 2 || z <= A.z0 + 2 || z >= A.z1 - 2;
      if (nearWall && L.nameAt(x, 0, z) === 'air') L.set(x, 0, z, T.dots[j % T.dots.length]);
    }
    labels.push({ text: A.title, x: left ? -1.6 : 1.6, z: Math.round(A.gate.z) + (left ? 2.4 : -2.4), size: 0.55 });
  }
  labels.push({ text: 'зал стражей ↑', x: 0, z: -22.6, size: 0.8 });
}

/**
 * Комнаты мобов за западной стеной (wiki/design-mobs.md): казарма Ордена (проход в западной стене плейграунда, z −1…1)
 * и Терновый сад южнее (проход из казармы). Гарнизон стоит группами на постах и просыпается, когда герой подходит
 * (src/mobs/, playground.ts). Группы — дальше 8 м друг от друга: соседи в 8 м просыпаются вместе.
 */
export interface MobRoomSpec {
  id: string;
  title: string;
  x0: number; x1: number; z0: number; z1: number;
  posts: { kind: string; x: number; z: number }[];
  /** Куда встать у входа (кнопка в F1) */
  enter: { x: number; z: number; yaw: number };
}

const at = (kind: string, pts: number[][]) => pts.map(([x, z]) => ({ kind, x, z }));

export const MOB_ROOMS: MobRoomSpec[] = [
  {
    id: 'barracks', title: 'Казарма Ордена', x0: -58, x1: -26, z0: -10, z1: 10,
    enter: { x: -22, z: 0, yaw: -Math.PI / 2 },
    posts: [
      // у входа — мелочь: малинёныши и садовники
      ...at('berryling', [[-30, -7], [-31, -5.6], [-29.6, -5], [-31.2, -7.6]]),
      ...at('gardener', [[-30, 5], [-31.5, 6.8], [-29.5, 7.4]]),
      // дальше — волки и рыцари; за рыцарями — целительница, за волками — маги
      ...at('wolf', [[-40, -6], [-41.5, -7.5], [-41.5, -4.5]]),
      ...at('shield', [[-40.5, 6]]), ...at('squire', [[-41.5, 4.2], [-41.5, 7.8]]),
      ...at('healer', [[-45, 6]]),
      ...at('pyro', [[-44, -3.5]]), ...at('summoner', [[-44, -8]]),
      // в глубине — гвардия со знаменем: молотобоец впереди, копейщики, арбалетчики у стены
      ...at('hammer', [[-52.5, 0]]), ...at('spear', [[-53.5, -2.5], [-53.5, 2.5]]),
      ...at('banner', [[-56, 0]]), ...at('crossbow', [[-57, -4], [-57, 4]]),
    ],
  },
  {
    id: 'garden', title: 'Терновый сад', x0: -50, x1: -27, z0: 12, z1: 35,
    enter: { x: -35, z: 9, yaw: 0 },
    posts: [
      // у входа — лозы стерегут дорожку; справа слизни, слева клубки, в глубине — чудище и бутоны
      ...at('vine', [[-37, 15], [-33, 15], [-35, 17]]),
      ...at('slime', [[-28.5, 24], [-29, 27.5]]),
      ...at('hedgehog', [[-46, 22], [-47, 25.5]]),
      ...at('horror', [[-39, 32]]), ...at('bud', [[-42, 34], [-36, 34]]),
    ],
  },
];

type Dec = (name: string, x: number, y: number, z: number, rot?: number, on?: [number, number, number]) => void;

function buildBarracks(L: Level, labels: PgLabel[], W: number, dec: Dec): void {
  const B = MOB_ROOMS[0];
  const hash = (x: number, z: number) => (((x * 73856093) ^ (z * 19349663)) >>> 0) % 1000 / 1000;
  // пол: плиты с булыжником, дорожка от входа
  for (let x = B.x0; x <= B.x1; x++) for (let z = B.z0; z <= B.z1; z++) {
    const n = hash(x, z);
    L.set(x, -1, z, Math.abs(z) <= 1 ? 'path' : n < 0.55 ? 'tiles' : n < 0.85 ? 'cobble' : 'stone');
    L.set(x, -2, z, 'stone');
  }
  // проход в западной стене плейграунда
  for (let z = -1; z <= 1; z++) { for (let y = 0; y < 3; y++) L.set(-W, y, z, 'air'); L.set(-W, -1, z, 'path'); }
  // стены: дальняя (запад) и северная — 3 блока, южная (к камере) — 1 блок
  for (let z = B.z0 - 1; z <= B.z1 + 1; z++) { L.set(B.x0 - 1, -1, z, 'stone'); for (let y = 0; y < 3; y++) L.set(B.x0 - 1, y, z, y === 2 ? 'bricks' : 'bricks_old'); }
  for (let x = B.x0 - 1; x <= B.x1; x++) {
    L.set(x, -1, B.z0 - 1, 'stone'); L.set(x, -1, B.z1 + 1, 'stone');
    for (let y = 0; y < 3; y++) L.set(x, y, B.z0 - 1, y === 2 ? 'bricks' : 'bricks_old');
    L.set(x, 0, B.z1 + 1, 'bricks_mossy');
  }
  // знамёна Ордена и факелы на дальних стенах, стойки и ящики по углам
  for (const x of [-54, -42, -34]) dec('banner', x, 2.6, B.z0 - 0.5, 0, [x, 2, B.z0 - 1]);
  for (const z of [-5, 5]) dec('banner', B.x0 - 0.5, 2.6, z, -90, [B.x0 - 1, 2, z]);
  for (const x of [-58, -50, -46, -38, -30]) L.set(x, 0, B.z0, 'torch');
  L.set(B.x0, 0, 0, 'torch');
  dec('crates_tilted', -57, 0, 9, 20);
  dec('bones', -27.5, 0, -9, 40);
  dec('lantern_post', -27, 0, 2.6, 90);
  dec('lantern_post', -27, 0, -2.6, 90);
  labels.push({ text: 'казарма Ордена ←', x: -21.6, z: 0, size: 0.8 });
  labels.push({ text: 'малинёныши', x: -30.5, z: -9, size: 0.55 });
  labels.push({ text: 'садовники', x: -30.5, z: 9.2, size: 0.55 });
  labels.push({ text: 'волки', x: -40, z: -9.2, size: 0.55 });
  labels.push({ text: 'рыцари и целительница', x: -41, z: 9.2, size: 0.55 });
  labels.push({ text: 'маги', x: -44, z: -1.6, size: 0.55 });
  labels.push({ text: 'гвардия со знаменем', x: -54, z: 8.6, size: 0.55 });
  labels.push({ text: 'Терновый сад ↓', x: -35, z: 8.4, size: 0.6 });
}

/** Терновый сад: трава и мох, кусты малины по краю, живая изгородь вместо стен; проход — из казармы */
function buildGarden(L: Level, labels: PgLabel[], dec: Dec): void {
  const G = MOB_ROOMS[1];
  const hash = (x: number, z: number) => (((x * 73856093) ^ (z * 19349663)) >>> 0) % 1000 / 1000;
  for (let x = G.x0; x <= G.x1; x++) for (let z = G.z0 - 1; z <= G.z1; z++) {
    const n = hash(x, z);
    L.set(x, -1, z, Math.abs(x + 35) <= 1 && z <= 20 ? 'path' : n < 0.78 ? 'grass' : 'dirt');
    L.set(x, -2, z, 'stone');
  }
  // проход в южной стене казармы
  for (let x = -36; x <= -34; x++) { L.set(x, 0, G.z0 - 1, 'air'); L.set(x, -1, G.z0 - 1, 'path'); }
  // стены: запад — 3 блока скалы, юг и восток (к камере) — 1 блок
  for (let z = G.z0 - 1; z <= G.z1 + 1; z++) {
    L.set(G.x0 - 1, -1, z, 'stone'); for (let y = 0; y < 3; y++) L.set(G.x0 - 1, y, z, 'cliff_dark');
    L.set(G.x1 + 1, -1, z, 'stone'); L.set(G.x1 + 1, 0, z, 'bricks_mossy');
  }
  for (let x = G.x0 - 1; x <= G.x1 + 1; x++) { L.set(x, -1, G.z1 + 1, 'stone'); L.set(x, 0, G.z1 + 1, 'bricks_mossy'); }
  // кусты малины и цветы вдоль стен
  for (let j = 0; j < 26; j++) {
    const side = j % 3, t = hash(j, 7);
    const x = side === 0 ? G.x0 : Math.round(G.x0 + 1 + t * (G.x1 - G.x0 - 2)), z = side === 0 ? Math.round(G.z0 + 1 + t * (G.z1 - G.z0 - 2)) : side === 1 ? G.z1 : G.z0;
    if (L.nameAt(x, 0, z) === 'air' && L.nameAt(x, -1, z) !== 'path') L.set(x, 0, z, ['berry_bush', 'berry_bush', 'flower_red', 'tall_grass'][j % 4]);
  }
  dec('mushrooms_glow', -48.5, 0, 30, 30);
  dec('roots', G.x0 - 0.5, 2.5, 20, -90, [G.x0 - 1, 2, 20]);
  dec('roots', G.x0 - 0.5, 2.5, 30, -90, [G.x0 - 1, 2, 30]);
  labels.push({ text: 'лозы', x: -35, z: 13.2, size: 0.5 });
  labels.push({ text: 'слизни', x: -29, z: 21.6, size: 0.5 });
  labels.push({ text: 'клубки', x: -46.5, z: 19.6, size: 0.5 });
  labels.push({ text: 'чудище и бутоны', x: -39, z: 29.4, size: 0.5 });
}
