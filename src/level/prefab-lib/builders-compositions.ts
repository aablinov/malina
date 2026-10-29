import { rockOutcrop, stairway, surfaceAt } from '../kit.ts';
import { bake, stampInto, type BuildCtx, type Builder } from './build.ts';
import { BUILDERS } from './builders.ts';

/**
 * Партия «Композиции» (wiki/design-prefab-library.md, раздел E; референсы 1, 3, 7, 12, 15): крупные пресеты из средних.
 * Средний пресет запекается своим строителем (`bake`) и вкладывается со сдвигом и поворотом (`stampInto`) —
 * код построек не дублируется, а JSON средних пресетов не меняется. Между постройками — дорога, заборы, мелочи.
 */

const pick = <T,>(c: BuildCtx, list: T[]): T => list[Math.floor(c.rnd() * list.length)];
const yaw = (c: BuildCtx): number => Math.floor(c.rnd() * 360);
/** Вложить средний пресет по id строителя: вариант — своё зерно, поворот — четверти */
function use(c: BuildCtx, id: string, x: number, z: number, quarter = 0, seed?: number): void {
  const b = BUILDERS.find((b) => b.id === id);
  if (!b) throw new Error(`Нет строителя «${id}»`);
  stampInto(c, bake(b, seed ?? 1 + Math.floor(c.rnd() * (b.variants ?? 1))), x, z, quarter);
}
/** Земляная дорога шириной 3 вдоль X от x0 до x1 на линии z, обочина вытоптана пятнами */
function dirtRoadX(c: BuildCtx, x0: number, x1: number, z: number): void {
  for (let x = x0; x <= x1; x++) for (let dz = -2; dz <= 2; dz++) if (Math.abs(dz) <= 1 || c.rnd() < 0.35) c.L.set(x, -1, z + dz, 'path');
}
const sprinkle = (c: BuildCtx, items: [string, number, number][]): void => { for (const [n, x, z] of items) if (c.L.nameAt(x, 0, z) === 'air') c.dec(n, x, 0, z, yaw(c)); };
const grassBits = (c: BuildCtx, n: number, r: number): void => {
  for (let i = 0; i < n; i++) { const x = Math.floor((c.rnd() - 0.5) * 2 * r), z = Math.floor((c.rnd() - 0.5) * 2 * r); if (c.L.nameAt(x, 0, z) === 'air' && c.L.nameAt(x, -1, z) === 'grass') c.L.set(x, 0, z, pick(c, ['tall_grass', 'dry_grass', 'daisies', 'flower_white'])); }
};

export const COMPOSITIONS: Builder[] = [
  {
    id: 'village_windmill', title: 'Деревня с мельницей', category: 'композиции', hint: '24 × 24: мельница, три дома, колодец, грядки, заборы, дорога сквозь (референс 7)', variants: 2,
    build(c) {
      dirtRoadX(c, -12, 11, 0);
      use(c, 'windmill', 6, -8);
      use(c, 'house_stone', -7, -7, 2);
      use(c, 'house_wood_small', -7, 7, 0);
      use(c, 'house_straw_hut', 7, 8, 0);
      use(c, 'well', 1, 5);
      use(c, 'garden_beds', -2, 9, 0, c.seed);
      use(c, 'hay_stack', 11, 4, 1);
      use(c, 'fence_straight', -7, -3, 0, 2); use(c, 'fence_straight', 6, 4, 0, 2);
      use(c, 'fence_gate', -1, -4, 0, 1);
      c.dec('lantern_post', -4, 0, 2, 0);
      c.dec('signpost', 9, 0, 2, yaw(c));
      sprinkle(c, [['barrel', 3, 3], ['sack', -3, 5], ['cart', 10, -3], ['rock_small', -11, 3], ['mushrooms', -10, -10]]);
      grassBits(c, 16, 12);
    },
  },
  {
    id: 'hamlet_road', title: 'Хутор у дороги', category: 'композиции', hint: '16 × 16: два дома, навес, стог, фонарь у дороги (референсы 12, 15)', variants: 2,
    build(c) {
      dirtRoadX(c, -8, 7, 0);
      use(c, 'house_wood_small', -4, -5, 2);
      use(c, pick(c, ['house_stone', 'house_wood_small']), 4, 5, 0);
      use(c, 'shed_open', -5, 5, 0);
      use(c, 'hay_stack', 5, -5, 0);
      use(c, 'fence_corner', -8, 2, 0, 1);
      c.dec('lantern_post', 1, 0, -2, 0);
      c.dec('lantern_short', -1, 0, 2, 0);
      sprinkle(c, [['barrel', 1, 3], ['crate_small', 7, -2], ['bucket', -7, -4], ['rock_small', 7, 2]]);
      grassBits(c, 10, 8);
    },
  },
  {
    id: 'camp_bandits', title: 'Лагерь разбойников', category: 'композиции', hint: '12 × 12: две палатки, костёр, частокол с знамёнами, ящики (референс 1)', variants: 2,
    build(c) {
      use(c, 'campfire_camp', 0, 1, 0, c.seed);
      c.dec('tent', -4, 0, -3, 180 + Math.floor(c.rnd() * 20 - 10));
      c.dec('tent', 4, 0, -3, 180 + Math.floor(c.rnd() * 20 - 10));
      // частокол по периметру с разрывом-входом на +Z, через кол — выше
      for (let i = -6; i <= 5; i++) {
        for (const z of [-6, 5]) if (!(z === 5 && Math.abs(i + 0.5) < 2) && c.rnd() < 0.9) { c.L.set(i, 0, z, 'stake_fence'); if (i % 2 === 0) c.L.set(i, 1, z, 'stake_fence'); }
        for (const x of [-6, 5]) if (c.rnd() < 0.9) { c.L.set(x, 0, i, 'stake_fence'); if (i % 2 === 0) c.L.set(x, 1, i, 'stake_fence'); }
      }
      c.dec('banner', -2, 1.4, 5.4, 0, [-2, 1, 5]);
      c.dec('banner', 2, 1.4, 5.4, 0, [2, 1, 5]);
      sprinkle(c, [['crates_banded_stack', -4, 2], ['barrel', 4, 2], ['sacks_pile', -2, 4], ['bones', 3, 4], ['skull', -4, 0], ['firewood_pile', 2, -1]]);
      c.dec('signpost', 3, 0, 6, yaw(c));
      grassBits(c, 6, 5);
    },
  },
  {
    id: 'ruin_cluster', title: 'Руины у кладбища', category: 'композиции', hint: '16 × 16: капелла, арка, ряд колонн, кладбище, мёртвые деревья', variants: 2,
    build(c) {
      use(c, 'ruin_chapel', -1, -3, 0, c.seed);
      use(c, 'graveyard_small', 5, 6);
      use(c, 'ruin_arch', -6, 6, 1);
      use(c, 'ruin_bowls', -7, -7);
      c.dec('tree_dead', -8, 0, 4, yaw(c));
      c.dec('tree_dead', 8, 0, -6, yaw(c));
      c.dec('column_fallen', 2, 0, 6, pick(c, [10, -25]));
      sprinkle(c, [['rubble', 7, 0], ['bricks_loose', -4, 3], ['pot_clay', 7, -4], ['gravestone_fallen', -3, 8]]);
      grassBits(c, 14, 8);
    },
  },
  {
    id: 'overlook_cliff', title: 'Обрыв со статуей', category: 'композиции', hint: '12 × 8: скальный выступ высотой 3 с площадкой из плит, статуя на краю, ступени с −X (референс 3)', variants: 2,
    build(c) {
      rockOutcrop(c.L, 0, 0, 5.5, 3.5, 3, 0, c.seed * 11);
      const top = surfaceAt(c.L, 0, 0) + 1;
      for (let x = -2; x <= 2; x++) for (let z = -1; z <= 1; z++) if (c.L.nameAt(x, top - 1, z) !== 'air') c.L.set(x, top - 1, z, c.rnd() < 0.7 ? 'tiles' : 'tiles_broken');
      c.dec('statue_hooded', 2, top, 2, 0);
      c.dec('candles_group', -1, top, 0, yaw(c));
      c.dec('stone_bowl', -2, top, -1, yaw(c));
      // ступени на выступ с −X: от земли до верха
      stairway(c.L, -7, 0, -1, 1, 0, top, 2, 'cliff');
      sprinkle(c, [['rock_small', -8, 2], ['rubble', 7, 1], ['bones', 6, -3]]);
      c.L.set(-8, 0, -3, 'dry_grass'); c.L.set(7, 0, 3, 'tall_grass');
    },
  },
];
