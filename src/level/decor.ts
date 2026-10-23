import type { Part } from './palette.ts';

/**
 * Реестр декора: свободные предметы поверх блоков — упавшие колонны, щебень, цепи, корни, паутина, знамёна, фонари.
 * Как в Minecraft Dungeons: по чему ходят — блоки, а декор лежит, висит и стоит где угодно и под любым углом,
 * но собран из кубиков 1/16 с теми же пиксельными текстурами 16 на метр (wiki/design-level-decor.md).
 * Формы — assets/decor/*.obj (scripts/gen-decor.mjs, `npm run decor`). Карты ссылаются на декор по имени — не переименовывать.
 */

/** Куда крепится: на пол, на стену (спиной к стене, смотрит наружу по +Z формы), к потолку (свисает вниз) */
export type Anchor = 'floor' | 'wall' | 'ceiling';

/** Бокс столкновений в локальных координатах формы, м: ширина вдоль X, глубина вдоль Z, высота; x, z — сдвиг центра */
export interface DecorBox { w: number; d: number; h: number; x?: number; z?: number }

export interface DecorDef {
  name: string;
  title: string;
  category: string;
  /** Части: форма из assets/decor (или блочная) и текстуры в её слотах; слой — как у блоков, плюс glow */
  parts: Part[];
  anchor: Anchor;
  /** Мешает пройти: боксы для героя, пути и врагов (поворачиваются вместе с предметом, наклон не учитывается) */
  solid?: DecorBox[];
  /** Источник света; at — точка в локальных координатах формы */
  /** Источник света; at — точка в локальных координатах формы; baked — без PointLight, тёплый цвет «запекается» в вершины блоков рядом */
  light?: { color: string; intensity: number; dist: number; at: [number, number, number]; baked?: boolean };
}

const D = (name: string, title: string, category: string, anchor: Anchor, parts: Part[], o: Partial<DecorDef> = {}): DecorDef =>
  ({ name, title, category, anchor, parts, ...o });
const p = (obj: string, tex: Record<string, string>, layer?: Part['layer']): Part => ({ obj, tex, ...(layer ? { layer } : {}) });

export const DECOR: DecorDef[] = [
  // --- руины ---
  D('column_fallen', 'Упавшая колонна', 'руины', 'floor', [p('column_fallen', { side: 'stoneBricks', top: 'stone' })],
    { solid: [{ w: 2.7, d: 1, h: 0.9, x: -0.1 }] }),
  D('column_stump', 'Обломок колонны', 'руины', 'floor', [p('column_stump', { side: 'stoneBricksOld', top: 'stone' })],
    { solid: [{ w: 1, d: 1, h: 1.45 }] }),
  D('rubble', 'Щебень', 'руины', 'floor', [p('rubble', { side: 'cobble', top: 'stone', bottom: 'stone' })]),
  D('bricks_loose', 'Выпавшие кирпичи', 'руины', 'floor', [p('bricks_loose', { side: 'stoneBricks', top: 'stoneBricks', bottom: 'stone' })]),
  D('bones', 'Кости и череп', 'руины', 'floor', [p('bones', { bone: 'bone', dark: 'ironDark' })]),

  // --- стены и потолок ---
  D('chain', 'Цепь', 'стены', 'ceiling', [p('chain', { side: 'ironDark' })]),
  D('roots', 'Корни', 'стены', 'wall', [p('roots', { side: 'roots' })]),
  D('cobweb', 'Паутина', 'стены', 'wall', [p('cobweb', { side: 'cobweb' }, 'cutout')]),
  D('banner', 'Знамя', 'стены', 'wall', [p('banner', { pole: 'planksDark', cloth: 'banner' })]),

  // --- свет ---
  D('torch_wall', 'Настенный факел', 'свет', 'wall',
    [p('torch_wall', { iron: 'ironDark', tip: 'ash', stick: 'logSide' }), p('torch_wall_flame', { side: 'fire' }, 'fire')],
    { light: { color: '#ffa040', intensity: 6, dist: 7, at: [0, 0.35, 0.45] } }),
  D('candles', 'Свечи', 'свет', 'floor', [p('candles', { side: 'candle', top: 'candle', bottom: 'candle', drip: 'candle' }), p('candles_flame', { side: 'fire' }, 'fire')],
    { light: { color: '#ffb860', intensity: 2.5, dist: 4, at: [0, 0.5, 0] } }),
  D('mushrooms_glow', 'Светящиеся грибы', 'свет', 'floor', [p('mushrooms', { stem: 'mushroomStem', cap: 'mushroomGlow' }, 'glow')],
    { light: { color: '#ffd24a', intensity: 1.6, dist: 3.5, at: [0, 0.4, 0] } }),
  D('lantern_post', 'Фонарь на столбе', 'свет', 'floor', [p('lantern_post', { post: 'planksDark', iron: 'ironDark' }), p('lantern_post_glass', { side: 'lanternGlass' }, 'glow')],
    { solid: [{ w: 0.35, d: 0.35, h: 2.2 }], light: { color: '#ffc870', intensity: 6, dist: 8, at: [0.53, 1.75, 0] } }),

  // --- двор ---
  D('mushrooms', 'Грибы', 'двор', 'floor', [p('mushrooms', { stem: 'mushroomStem', cap: 'mushroomRed' })]),
  D('planter', 'Ящик с цветами', 'двор', 'floor', [p('planter', { side: 'planks', top: 'planks', bottom: 'planks', soil: 'farm' }), p('planter_flowers', { side: 'flowerRed' }, 'cutout')],
    { solid: [{ w: 1, d: 0.75, h: 0.6 }] }),
  D('crates_tilted', 'Стопка ящиков', 'двор', 'floor', [p('crates_tilted', { side: 'crate', top: 'crate', bottom: 'crate' })],
    { solid: [{ w: 2, d: 1.1, h: 1.9 }] }),

  // --- мир: двор (скриншот 10, wiki/style-world.md) ---
  D('crate_banded', 'Ящик с полосами', 'склад', 'floor', [p('crate_banded', { side: 'crateBand', top: 'crateBandTop', bottom: 'crateBandTop' })], { solid: [{ w: 0.95, d: 0.95, h: 0.95 }] }),
  D('crates_banded_stack', 'Стопка ящиков с полосами', 'склад', 'floor', [p('crates_banded_stack', { side: 'crateBand', top: 'crateBandTop', bottom: 'crateBandTop' })], { solid: [{ w: 2, d: 1.05, h: 1.9 }] }),
  D('crate_small', 'Ящичек', 'склад', 'floor', [p('crate_small', { side: 'crate', top: 'crate', bottom: 'crate', rim: 'planksDark' })], { solid: [{ w: 0.65, d: 0.65, h: 0.6 }] }),
  D('chest', 'Сундук', 'склад', 'floor', [p('chest', { side: 'chestWood', top: 'chestWood', bottom: 'chestWood', lid: 'chestWood', trim: 'chestTrim' })], { solid: [{ w: 0.9, d: 0.65, h: 0.75 }] }),
  D('cart', 'Телега', 'склад', 'floor', [p('cart', { side: 'cartWood', top: 'cartWood', bottom: 'cartWood', wheel: 'planksDark', iron: 'ironDark' })], { solid: [{ w: 1.1, d: 1.35, h: 0.9, z: -0.05 }] }),
  D('cart_loaded', 'Телега с грузом', 'склад', 'floor', [p('cart_loaded', { side: 'cartWood', top: 'cartWood', bottom: 'cartWood', wheel: 'planksDark', iron: 'ironDark', hay: 'hay', hayTop: 'hayTop', box: 'crateBand' })], { solid: [{ w: 1.1, d: 1.35, h: 1.3, z: -0.05 }] }),
  D('bench', 'Скамья', 'склад', 'floor', [p('bench', { side: 'planks', top: 'planks', bottom: 'planks' })], { solid: [{ w: 1.3, d: 0.4, h: 0.55 }] }),
  D('lantern_post_double', 'Фонарь двойной', 'фонари', 'floor', [p('lantern_post_double', { post: 'planksDark', iron: 'ironDark' }), p('lantern_post_double_glass', { side: 'lanternGlass' }, 'glow')],
    { solid: [{ w: 0.35, d: 0.35, h: 2.4 }], light: { color: '#ffc870', intensity: 7, dist: 9, at: [0, 1.85, 0] } }),
  D('lantern_wall', 'Фонарь настенный', 'фонари', 'wall', [p('lantern_wall', { iron: 'ironDark' }), p('lantern_wall_glass', { side: 'lanternGlass' }, 'glow')],
    { light: { color: '#ffc870', intensity: 5, dist: 7, at: [0, -0.45, 0.4] } }),
  D('lantern_short', 'Фонарь низкий', 'фонари', 'floor', [p('lantern_short', { post: 'planksDark', iron: 'ironDark' }), p('lantern_short_glass', { side: 'lanternGlass' }, 'glow')],
    { solid: [{ w: 0.3, d: 0.3, h: 1.4 }], light: { color: '#ffc870', intensity: 4, dist: 6, at: [0, 1.2, 0] } }),
  // --- мир: вода (скриншот 11) ---
  D('waterfall_splash', 'Брызги водопада', 'вода', 'floor', [p('waterfall_splash', { side: 'foam', top: 'foam', bottom: 'foam' })]),
  D('waterfall_foam', 'Пена у камней', 'вода', 'floor', [p('waterfall_foam', { side: 'foam', top: 'foam', bottom: 'foam' })]),
  D('foam_patch', 'Пена на воде', 'вода', 'floor', [p('foam_patch', { side: 'foam', top: 'foam', bottom: 'foam' })]),
  // --- мир: свечи (скриншот 13) — свет запечён в соседние блоки, PointLight нет ---
  D('candles_group', 'Свечи кучкой', 'свечи', 'floor', [p('candles_group', { side: 'candle', top: 'candle', bottom: 'candle' }), p('candles_group_flame', { side: 'fire' }, 'fire')],
    { light: { color: '#ffb25a', intensity: 0.9, dist: 2.6, at: [0, 0.4, 0], baked: true } }),
  D('candles_row', 'Свечи в ряд', 'свечи', 'floor', [p('candles_row', { side: 'candle', top: 'candle', bottom: 'candle' }), p('candles_row_flame', { side: 'fire' }, 'fire')],
    { light: { color: '#ffb25a', intensity: 0.8, dist: 3, at: [0, 0.4, 0], baked: true } }),
  D('candle_tall', 'Свеча высокая', 'свечи', 'floor', [p('candle_tall', { side: 'candle', top: 'candle', bottom: 'candle' }), p('candle_tall_flame', { side: 'fire' }, 'fire')],
    { light: { color: '#ffb25a', intensity: 0.6, dist: 2, at: [0, 0.8, 0], baked: true } }),
];

export const DECOR_BY_NAME: Record<string, DecorDef> = Object.fromEntries(DECOR.map((d) => [d.name, d]));

export function decorDef(name: string): DecorDef {
  const d = DECOR_BY_NAME[name];
  if (!d) throw new Error(`Нет декора «${name}» в реестре`);
  return d;
}

/** Все имена текстур декора (для атласа) */
export function decorTextures(): string[] {
  const s = new Set<string>();
  for (const d of DECOR) for (const part of d.parts) if (part.layer !== 'fire') for (const t of Object.values(part.tex)) for (const n of Array.isArray(t) ? t : [t]) s.add(n);
  return [...s];
}

export const DECOR_CATEGORIES: string[] = [...new Set(DECOR.map((d) => d.category))];
/** Категории набора «мир» — в зоне «мир» плейграунда, а не в витрине декора */
export const WORLD_DECOR_CATEGORIES = ['склад', 'фонари', 'вода', 'свечи'];

/** Поворот декора [рыск, наклон, крен] в градусах → углы Эйлера three (порядок YXZ); рыск как у блоков: 90° переводит +X в +Z */
export function decorEuler(rot: readonly number[] | undefined): [number, number, number] {
  const k = Math.PI / 180;
  return [(rot?.[1] ?? 0) * k, -(rot?.[0] ?? 0) * k, (rot?.[2] ?? 0) * k];
}
