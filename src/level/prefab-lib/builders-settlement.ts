import { stairway } from '../kit.ts';
import type { BuildCtx, Builder } from './build.ts';

/**
 * Партия «Поселение» (wiki/design-prefab-library.md, раздел D; референсы 6, 7, 11, 12, 14, 15): мельница, дома, хижина,
 * навесы, заборы, колодец, грядки, прилавок, вышка, пирс, мостик, сломанная телега. У каждой постройки обжитое окружение —
 * бочка, ящик или фонарь у входа, дрова, мешки, грядка.
 */

const pick = <T,>(c: BuildCtx, list: T[]): T => list[Math.floor(c.rnd() * list.length)];
const yaw = (c: BuildCtx): number => Math.floor(c.rnd() * 360);
/** Настенный декор на грани клетки (x, y, z); рыск как у блоков: 0 — к +Z, 90 — к −X, 180 — к −Z, 270 — к +X */
function onWall(c: BuildCtx, name: string, x: number, y: number, z: number, face: '+z' | '-z' | '+x' | '-x'): void {
  const [dx, dz, rot] = face === '+z' ? [0, 0.5, 0] : face === '-z' ? [0, -0.5, 180] : face === '+x' ? [0.5, 0, 270] : [-0.5, 0, 90];
  c.dec(name, x + dx, y, z + dz, rot, [x, Math.floor(y), z]);
}

/** Коробка стен x0..x1 × z0..z1 высотой h из блока wall; дверь — проём 1 × 2 в клетке door; окна — клетки с блоком window (поворот по стене) */
function walls(c: BuildCtx, x0: number, z0: number, x1: number, z1: number, h: number, wall: string, door: [number, number], windows: [number, number][] = []): void {
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    if (x !== x0 && x !== x1 && z !== z0 && z !== z1) continue;
    for (let y = 0; y < h; y++) c.L.set(x, y, z, wall);
  }
  c.L.set(door[0], 0, door[1], 'air'); c.L.set(door[0], 1, door[1], 'air');
  for (const [x, z] of windows) c.L.set(x, 1, z, 'window', z === z0 || z === z1 ? 0 : 1);
}
/** Двускатная крыша с коньком вдоль X над x0..x1 × z0..z1 с низом на y: ступени по скатам, конёк из полублоков */
function gableX(c: BuildCtx, x0: number, z0: number, x1: number, z1: number, y: number, roof: string, fill: string): void {
  for (let k = 0; ; k++) {
    const za = z0 - 1 + k, zb = z1 + 1 - k;
    if (za > zb) break;
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      if (za === zb) { c.L.set(x, y + k, za, `${roof}_slab`); break; }
      c.L.set(x, y + k, za, `${roof}_stairs`, 1);
      c.L.set(x, y + k, zb, `${roof}_stairs`, 3);
      for (let z = za + 1; z < zb; z++) if (x >= x0 && x <= x1) c.L.set(x, y + k, z, fill);
    }
  }
}
/** Четырёхскатная (шатровая) крыша над квадратом: кольца ступеней наружу, в середине полублок */
function hipRoof(c: BuildCtx, x0: number, z0: number, x1: number, z1: number, y: number, roof: string, fill: string): void {
  for (let k = 0; ; k++) {
    const xa = x0 - 1 + k, xb = x1 + 1 - k, za = z0 - 1 + k, zb = z1 + 1 - k;
    if (xa > xb || za > zb) break;
    for (let x = xa; x <= xb; x++) for (let z = za; z <= zb; z++) {
      const edge = x === xa ? 0 : x === xb ? 2 : z === za ? 1 : z === zb ? 3 : -1;
      if (xa === xb || za === zb) c.L.set(x, y + k, z, `${roof}_slab`);
      else if (edge >= 0) c.L.set(x, y + k, z, `${roof}_stairs`, edge);
      else c.L.set(x, y + k, z, fill);
    }
  }
}
/** Забор по списку клеток, иногда с пропуском (покосился) */
function fenceRun(c: BuildCtx, cells: [number, number][], gaps = 0.1): void {
  for (const [x, z] of cells) if (c.rnd() >= gaps) c.L.set(x, 0, z, 'fence');
}

export const SETTLEMENT: Builder[] = [
  {
    id: 'windmill', title: 'Мельница', category: 'поселение', hint: 'каменная башня 5 × 5 высотой 8 с конусной крышей, крылья на +Z; вариант 2 — крыло сломано', variants: 2,
    build(c) {
      for (let y = 0; y < 8; y++) for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
        const d = Math.abs(x) + Math.abs(z), m = Math.max(Math.abs(x), Math.abs(z));
        const ring = y < 5 ? d >= 2 && d <= 3 : m === 1;
        if (ring) c.L.set(x, y, z, y === 0 && c.rnd() < 0.3 ? 'mossy' : y < 5 ? 'cobble' : 'planks_dark');
      }
      for (let y = 0; y <= 1; y++) c.L.set(0, y, -2, 'air');
      c.L.set(2, 3, 0, 'window', 1); c.L.set(-2, 3, 0, 'window', 1);
      hipRoof(c, -1, -1, 1, 1, 8, 'roof_dark', 'planks_dark');
      onWall(c, c.seed === 1 ? 'windmill_sails' : 'windmill_sails_broken', 0, 6.5, 1, '+z');
      c.dec('sacks_pile', -2, 0, -3, yaw(c));
      c.dec('sack', 3, 0, -2, yaw(c));
      c.dec('barrel', 3, 0, 1, yaw(c));
      c.dec('lantern_wall', 1, 1.6, -2.5, 180, [1, 1, -2]);
      c.dec('cart', -4, 0, 1, 90);
      c.L.set(-3, 0, -2, 'tall_grass');
    },
  },
  {
    id: 'house_wood_small', title: 'Сарай деревянный', category: 'поселение', hint: '5 × 4 из тёмных досок, тёмная черепица, бочка, ящик и фонарь у двери', variants: 2,
    build(c) {
      walls(c, -2, -1, 2, 2, 3, 'planks_dark', [0, -1], [[-2, 0], [2, 1]]);
      gableX(c, -2, -1, 2, 2, 3, 'roof_dark', 'planks_dark');
      c.dec('lantern_wall', 1, 1.6, -1.5, 180, [1, 1, -1]);
      c.dec('barrel', -2, 0, -2, yaw(c));
      c.dec(pick(c, ['crate_small', 'crate_banded']), 3, 0, -1, pick(c, [0, 20]));
      c.dec('firewood_pile', 3, 0, 2, 90);
      c.L.set(-3, 0, 1, pick(c, ['tall_grass', 'fern']));
    },
  },
  {
    id: 'house_wood_big', title: 'Дом деревянный двухэтажный', category: 'поселение', hint: '7 × 6, внешняя лестница на балкон с +Z, дрова и мешки', variants: 2,
    build(c) {
      walls(c, -3, -2, 3, 3, 5, 'planks', [0, -2], [[-3, 0], [3, 0], [-1, 3], [1, 3]]);
      for (const [x, z] of [[-3, 1], [3, 1], [-2, -2], [2, -2]]) c.L.set(x, 3, z, 'window', z === -2 ? 0 : 1);
      for (let x = -3; x <= 3; x++) c.L.set(x, 2, 3, 'planks_dark'); // балка второго этажа
      gableX(c, -3, -2, 3, 3, 5, 'roof_dark', 'planks');
      // балкон с +Z на высоте 3 и лестница к нему вдоль стены
      for (let x = -3; x <= 3; x++) c.L.set(x, 2, 4, 'planks_slab');
      for (let x = -3; x <= 3; x++) if (x !== 3) c.L.set(x, 3, 5, 'fence');
      stairway(c.L, 4, 0, 1, 0, 1, 3, 1, 'planks');
      c.L.set(0, 3, 3, 'air'); c.L.set(0, 4, 3, 'air');
      c.dec('lantern_wall', 1, 1.6, -2.5, 180, [1, 1, -2]);
      c.dec('firewood_pile', -4, 0, 0, 0);
      c.dec('sacks_pile', 4, 0, -2, yaw(c));
      c.dec('barrel', -4, 0, 3, yaw(c));
      c.dec('planter', -1, 0, -3, 0);
      c.L.set(2, 0, -3, 'tall_grass');
    },
  },
  {
    id: 'house_stone', title: 'Дом каменный', category: 'поселение', hint: '6 × 5 из булыжника, красная черепица, труба, цветы под окном', variants: 2,
    build(c) {
      walls(c, -3, -2, 2, 2, 3, 'cobble', [0, -2], [[-3, 0], [2, 0], [-1, 2]]);
      for (let x = -3; x <= 2; x++) for (const z of [-2, 2]) if (c.rnd() < 0.3) c.L.set(x, 0, z, 'mossy');
      gableX(c, -3, -2, 2, 2, 3, 'roof', 'planks');
      for (let y = 3; y <= 5; y++) c.L.set(-2, y, 1, 'cobble'); // труба
      c.dec('lantern_wall', 1, 1.6, -2.5, 180, [1, 1, -2]);
      c.dec('planter', -2, 0, -3, 0);
      c.dec('barrel', 3, 0, -1, yaw(c));
      c.dec('bucket', -1, 0, -3, yaw(c));
      c.dec('firewood_pile', 3, 0, 2, 90);
      c.L.set(-4, 0, 1, 'tall_grass');
    },
  },
  {
    id: 'house_straw_hut', title: 'Хижина соломенная', category: 'поселение', hint: '4 × 4 из брёвен, шатровая соломенная крыша, костёр у входа', variants: 2,
    build(c) {
      walls(c, -1, -1, 2, 2, 2, 'log', [0, -1]);
      hipRoof(c, -1, -1, 2, 2, 2, 'roof_thatch', 'hay');
      c.L.set(0, 0, -3, 'campfire');
      c.dec('sack', 3, 0, -1, yaw(c));
      c.dec('pot_clay', -2, 0, 0, yaw(c));
      c.dec('firewood_pile', 3, 0, 2, 90);
      c.L.set(-2, 0, 2, pick(c, ['fern', 'tall_grass']));
    },
  },
  {
    id: 'house_ruined', title: 'Дом разрушенный', category: 'поселение', hint: '6 × 5 без крыши, стены обломаны, внутри трава и горшки', variants: 2,
    build(c) {
      for (let x = -3; x <= 2; x++) for (let z = -2; z <= 2; z++) {
        if (x !== -3 && x !== 2 && z !== -2 && z !== 2) { if (c.rnd() < 0.5) c.L.set(x, 0, z, pick(c, ['tall_grass', 'dry_grass', 'fern'])); continue; }
        const h = c.rnd() < 0.5 ? 1 : 2;
        for (let y = 0; y < h; y++) c.L.set(x, y, z, y === 0 && c.rnd() < 0.3 ? 'mossy' : 'cobble');
        if (c.rnd() < 0.3) c.L.set(x, h, z, 'cobble_slab');
      }
      c.L.set(0, 0, -2, 'air'); c.L.set(0, 1, -2, 'air');
      c.dec('pot_clay', -1, 0, 1, yaw(c));
      c.dec('barrel_broken', 1, 0, -1, yaw(c));
      c.dec('rubble', 3, 0, 1, yaw(c));
      c.dec('bricks_loose', -4, 0, -1, yaw(c));
      onWall(c, 'ivy', 2, 1.5, 1, '+x');
    },
  },
  {
    id: 'shed_open', title: 'Навес', category: 'поселение', hint: '4 × 3 на столбах, тёмная черепица, дрова и бочка внутри', variants: 2,
    build(c) {
      for (const [x, z] of [[-1, -1], [2, -1], [-1, 1], [2, 1]]) for (let y = 0; y < 2; y++) c.L.set(x, y, z, 'log');
      gableX(c, -1, -1, 2, 1, 2, 'roof_dark', 'planks_dark');
      c.dec('firewood_pile', 0, 0, 0, 0);
      c.dec('firewood_pile', 1, 0, 0, 0);
      c.dec('barrel', 2, 0, 0, yaw(c));
      c.dec(pick(c, ['sack', 'crate_small']), -1, 0, 0, yaw(c));
      c.L.set(3, 0, 1, 'tall_grass');
    },
  },
  {
    id: 'fence_straight', title: 'Забор', category: 'поселение', hint: '6 м вдоль X; вариант 2 — покосившийся с пропусками', variants: 2,
    build(c) {
      fenceRun(c, [[-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0]], c.seed === 1 ? 0 : 0.25);
      c.L.set(pick(c, [-2, 1]), 0, 1, 'tall_grass');
      c.dec('rock_small', pick(c, [-3, 2]), 0, -1, yaw(c));
    },
  },
  {
    id: 'fence_corner', title: 'Забор: угол', category: 'поселение', hint: 'две стороны по 3 м', variants: 2,
    build(c) {
      fenceRun(c, [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2]], c.seed === 1 ? 0 : 0.2);
      c.dec('sack', 1, 0, 1, yaw(c));
      c.L.set(2, 0, 2, 'dry_grass');
    },
  },
  {
    id: 'fence_gate', title: 'Забор с воротами', category: 'поселение', hint: '6 м с проёмом 2 м между столбами, фонарь у входа', variants: 2,
    build(c) {
      fenceRun(c, [[-3, 0], [-2, 0], [2, 0], [3, 0]], 0);
      c.L.set(-1, 0, 0, 'log'); c.L.set(1, 0, 0, 'log');
      c.L.set(-1, 1, 0, 'planks_dark_slab'); c.L.set(0, 1, 0, 'planks_dark_slab'); c.L.set(1, 1, 0, 'planks_dark_slab');
      c.dec('lantern_short', -2, 0, 1, 0);
      c.dec('signpost', 3, 0, 1, yaw(c));
      c.L.set(2, 0, -1, 'tall_grass');
    },
  },
  {
    id: 'well', title: 'Колодец', category: 'поселение', hint: 'кольцо булыжника 3 × 3, навес с воротом, ведро', variants: 2,
    build(c) {
      for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) if (x || z) c.L.set(x, 0, z, c.rnd() < 0.25 ? 'mossy' : 'cobble');
      c.L.set(0, -1, 0, 'water'); c.L.set(0, -2, 0, 'cobble');
      c.dec('well_roof', 0, 1, 0, 0);
      c.dec('bucket', 2, 0, 1, yaw(c));
      c.dec(pick(c, ['barrel', 'sack']), -2, 0, 1, yaw(c));
      c.L.set(2, 0, -1, 'tall_grass');
    },
  },
  {
    id: 'garden_beds', title: 'Грядки', category: 'поселение', hint: '6 × 4: две грядки с ростками, пугало, забор с одной стороны', variants: 2,
    build(c) {
      for (const z of [-1, 1]) for (let x = -3; x <= 2; x++) {
        c.L.set(x, -1, z, 'farm');
        c.L.set(x, 0, z, c.rnd() < (c.seed === 1 ? 0.35 : 0.7) ? 'crops_ripe' : 'crops');
      }
      for (let x = -3; x <= 2; x++) c.L.set(x, 0, -2, 'fence');
      c.dec('scarecrow', 3, 0, 0, 180);
      c.dec('bucket', -4, 0, 1, yaw(c));
      c.dec('sack', 3, 0, 2, yaw(c));
    },
  },
  {
    id: 'market_stall', title: 'Прилавок', category: 'поселение', hint: '4 × 3: навес из черепицы на столбах, прилавок, ящики и мешки', variants: 2,
    build(c) {
      for (const x of [-1, 2]) for (let y = 0; y < 2; y++) c.L.set(x, y, 1, 'log');
      for (let x = -1; x <= 2; x++) { c.L.set(x, 0, -1, 'planks_dark_slab'); c.L.set(x, 2, 1, 'roof_stairs', 3); c.L.set(x, 2, 0, 'roof_stairs', 3); c.L.set(x, 2, -1, 'roof_slab'); }
      c.dec('crates_banded_stack', 3, 0, 0, pick(c, [0, 15]));
      c.dec('sacks_pile', -2, 0, 0, yaw(c));
      c.dec('barrel', 0, 0, 0, yaw(c));
      c.dec('lantern_short', -2, 0, -2, 0);
    },
  },
  {
    id: 'watchtower_wood', title: 'Вышка деревянная', category: 'поселение', hint: '3 × 3 на столбах высотой 5, площадка с перилами, лестница, факел', variants: 2,
    build(c) {
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) for (let y = 0; y < 5; y++) c.L.set(x, y, z, 'log');
      for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) c.L.set(x, 5, z, 'planks_dark');
      for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) if ((x === -1 || x === 1 || z === -1 || z === 1) && !(x === 0 && z === -1)) c.L.set(x, 6, z, 'fence');
      c.L.set(0, 6, 0, 'torch');
      for (let y = 1; y < 4; y += 1) { c.L.set(-1, y, 0, 'planks_dark'); c.L.set(1, y, 0, 'planks_dark'); } // раскосы
      c.dec('ladder', 0, 5.4, -1.5, 180, [0, 5, -1]);
      c.dec('barrel', 2, 0, 1, yaw(c));
      c.dec('crate_small', -2, 0, -1, yaw(c));
      c.L.set(2, 0, -1, 'tall_grass');
    },
  },
  {
    id: 'dock_pier', title: 'Пирс', category: 'поселение', hint: 'настил 3 × 8 над водой на столбах, бочки и тростник у берега', variants: 2,
    build(c) {
      for (let x = -4; x <= 5; x++) for (let z = -3; z <= 3; z++) { c.L.set(x, -1, z, x >= -3 ? 'water' : c.rnd() < 0.6 ? 'sand' : 'grass'); if (x >= -3) c.L.set(x, -2, z, 'sand'); }
      for (let x = -4; x <= 3; x++) for (let z = -1; z <= 1; z++) c.L.set(x, 0, z, 'planks_dark_slab');
      for (const [x, z] of [[-2, -1], [-2, 1], [1, -1], [1, 1], [3, -1], [3, 1]]) c.L.set(x, -1, z, 'log');
      c.dec('barrel', -3, 0.5, 1, yaw(c));
      c.dec('crate_small', 2, 0.5, -1, yaw(c));
      c.dec('lantern_short', 3, 0.5, 1, 0);
      c.dec('reeds', -4, 0, -2, yaw(c));
      c.dec('reeds', -4, 0, 3, yaw(c));
      c.dec('foam_patch', 0, -0.12, 2, yaw(c));
      c.dec('bucket', -5, 0, 0, yaw(c));
    },
  },
  {
    id: 'bridge_stone_small', title: 'Мостик каменный', category: 'поселение', hint: 'булыжник 3 × 6 через ручей 2 м, столбики по углам', variants: 2,
    build(c) {
      for (let x = -3; x <= 2; x++) for (const z of [-1, 0]) { c.L.set(x, -1, z, 'water'); c.L.set(x, -2, z, 'sand'); }
      for (const x of [-1, 1]) for (const z of [-1, 0]) c.L.set(x, -1, z, 'cobble');
      for (let x = -1; x <= 1; x++) for (let z = -3; z <= 2; z++) c.L.set(x, 0, z, z === -3 ? 'cobble_stairs' : z === 2 ? 'cobble_stairs' : 'cobble_slab', z === -3 ? 1 : 3);
      for (const [x, z] of [[-1, -2], [1, -2], [-1, 1], [1, 1]]) c.L.set(x, 1, z, 'cobble_slab');
      c.dec('reeds', -3, 0, 1, yaw(c));
      c.dec('rock_small', 3, 0, -2, yaw(c));
      c.dec('lantern_short', 2, 0, 2, 0);
      c.dec('foam_patch', -2, -0.12, -0.5, yaw(c));
    },
  },
  {
    id: 'cart_broken', title: 'Телега сломанная', category: 'поселение', hint: 'кузов на боку, колесо рядом, рассыпанные ящики', variants: 2,
    build(c) {
      c.dec('cart_broken', 0, 0, 0, yaw(c));
      c.dec('crate_small', 1, 0, 1, pick(c, [20, -30]));
      c.dec(pick(c, ['sack', 'barrel_broken']), -1, 0, 1, yaw(c));
      c.L.set(1, 0, -1, 'dry_grass');
    },
  },
];
