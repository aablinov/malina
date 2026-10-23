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

  L.spawn = [0, 0, 0];
  L.meta = { labels };
  L.dirty.clear();
  return { level: L, labels };
}
