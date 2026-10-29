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
  // партия «Руины» (wiki/design-prefab-library.md): надгробия, крест, статуя, чаша, горшки, плющ, череп
  D('gravestone', 'Надгробие', 'руины', 'floor', [p('gravestone', { side: 'stone', top: 'stone', bottom: 'stone' })], { solid: [{ w: 0.5, d: 0.2, h: 0.9 }] }),
  D('gravestone_wide', 'Надгробие широкое', 'руины', 'floor', [p('gravestone_wide', { side: 'stoneBricksOld', top: 'stone', bottom: 'stone' })], { solid: [{ w: 0.75, d: 0.2, h: 0.6 }] }),
  D('gravestone_fallen', 'Надгробие упавшее', 'руины', 'floor', [p('gravestone_fallen', { side: 'stone', top: 'stone', bottom: 'stone' })]),
  D('grave_cross', 'Крест могильный', 'руины', 'floor', [p('grave_cross', { side: 'planksDark', top: 'planksDark', bottom: 'planksDark' })]),
  D('statue_hooded', 'Статуя в капюшоне', 'руины', 'floor', [p('statue_hooded', { side: 'stone', top: 'stone', bottom: 'stone', hood: 'stoneBricksOld' })], { solid: [{ w: 0.9, d: 0.9, h: 2.2 }] }),
  D('stone_bowl', 'Каменная чаша', 'руины', 'floor', [p('stone_bowl', { side: 'stone', top: 'stone', bottom: 'stone', inner: 'cobble' })], { solid: [{ w: 0.9, d: 0.9, h: 0.55 }] }),
  D('pot_clay', 'Горшки глиняные', 'руины', 'floor', [p('pot_clay', { side: 'clay', top: 'clay', bottom: 'clay' })]),
  D('ivy', 'Плющ', 'руины', 'wall', [p('ivy', { side: 'ivy' }, 'cutout')]),
  D('skull', 'Череп', 'руины', 'floor', [p('skull', { bone: 'bone', dark: 'ironDark' })]),

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
  // --- природа (wiki/design-prefab-library.md, партия «Дорога и природа») ---
  D('tree_dead', 'Мёртвое дерево', 'природа', 'floor', [p('tree_dead', { side: 'barkDead', top: 'barkDead', bottom: 'barkDead' })],
    { solid: [{ w: 0.5, d: 0.5, h: 2.3 }] }),
  D('reeds', 'Тростник', 'природа', 'floor', [p('reeds', { side: 'reeds' }, 'cutout')]),
  D('stump', 'Пень', 'природа', 'floor', [p('stump', { side: 'logSide', top: 'logTop', bottom: 'logTop' })], { solid: [{ w: 0.65, d: 0.65, h: 0.4 }] }),
  D('rock_small', 'Камешки', 'природа', 'floor', [p('rock_small', { side: 'cliff', top: 'stone', bottom: 'stone' })]),
  D('leaf_litter', 'Опавшие листья', 'природа', 'floor', [p('leaf_litter', { side: 'leafLitter', top: 'leafLitter', bottom: 'leafLitter' }, 'cutout')]),

  // --- поселение (партия 4): крылья мельницы, бочки, мешки, колодец, ведро, лестница, палатка, пугало, дрова, указатель, сломанная телега ---
  D('windmill_sails', 'Крылья мельницы', 'поселение', 'wall', [p('windmill_sails', { side: 'planksDark', lattice: 'planks', iron: 'ironDark' })]),
  D('windmill_sails_broken', 'Крылья мельницы: сломанные', 'поселение', 'wall', [p('windmill_sails_broken', { side: 'planksDark', lattice: 'planks', iron: 'ironDark' })]),
  D('barrel', 'Бочка', 'поселение', 'floor', [p('barrel', { side: 'barrel', top: 'barrelTop', bottom: 'barrelTop' })], { solid: [{ w: 0.75, d: 0.75, h: 0.9 }] }),
  D('barrel_broken', 'Бочка разбитая', 'поселение', 'floor', [p('barrel_broken', { side: 'barrel', top: 'barrelTop', bottom: 'barrelTop' })]),
  D('sack', 'Мешок', 'поселение', 'floor', [p('sack', { side: 'burlap', top: 'burlap', bottom: 'burlap' })]),
  D('sacks_pile', 'Мешки горкой', 'поселение', 'floor', [p('sacks_pile', { side: 'burlap', top: 'burlap', bottom: 'burlap' })], { solid: [{ w: 1.2, d: 1, h: 0.7 }] }),
  D('well_roof', 'Навес колодца', 'поселение', 'floor', [p('well_roof', { post: 'planksDark', roof: 'shingles', iron: 'ironDark', rope: 'burlap' })]),
  D('bucket', 'Ведро', 'поселение', 'floor', [p('bucket', { side: 'planksDark', top: 'planksDark', bottom: 'planksDark', iron: 'ironDark' })]),
  D('ladder', 'Лестница приставная', 'поселение', 'wall', [p('ladder', { side: 'planksDark', top: 'planksDark', bottom: 'planksDark' })]),
  D('tent', 'Палатка', 'поселение', 'floor', [p('tent', { cloth: 'tentCloth', pole: 'planksDark' })], { solid: [{ w: 2, d: 2, h: 1.4 }] }),
  D('scarecrow', 'Пугало', 'поселение', 'floor', [p('scarecrow', { pole: 'planksDark', hay: 'hay', hayTop: 'hayTop', cloth: 'tentCloth' })], { solid: [{ w: 0.3, d: 0.3, h: 2 }] }),
  D('firewood_pile', 'Дрова', 'поселение', 'floor', [p('firewood_pile', { side: 'logSide', end: 'logTop' })], { solid: [{ w: 1, d: 0.6, h: 0.6 }] }),
  D('signpost', 'Указатель', 'поселение', 'floor', [p('signpost', { post: 'planksDark', board: 'planks' })]),
  D('cart_broken', 'Телега сломанная', 'поселение', 'floor', [p('cart_broken', { side: 'cartWood', top: 'cartWood', bottom: 'cartWood', wheel: 'planksDark', iron: 'ironDark' })], { solid: [{ w: 1.4, d: 1.4, h: 0.8 }] }),

  // --- снег (биом «снег»): сугробы, сосульки, ледяные шипы, снеговик, брёвна и камни под снегом ---
  D('snow_pile', 'Сугроб', 'снег', 'floor', [p('snow_pile', { side: 'snowTop', top: 'snowTop', bottom: 'snowTop' })]),
  D('snowdrift', 'Сугроб у стены', 'снег', 'wall', [p('snowdrift', { side: 'snowTop', top: 'snowTop', bottom: 'snowTop' })]),
  D('icicles', 'Сосульки', 'снег', 'ceiling', [p('icicles', { side: 'ice', top: 'ice', bottom: 'ice' })]),
  D('icicles_wall', 'Сосульки на стене', 'снег', 'wall', [p('icicles_wall', { side: 'ice', top: 'ice', bottom: 'ice' })]),
  D('ice_spikes', 'Ледяные шипы', 'снег', 'floor', [p('ice_spikes', { side: 'ice', top: 'ice', bottom: 'iceCracked' })], { solid: [{ w: 0.9, d: 0.9, h: 1.1 }] }),
  D('frozen_bush', 'Куст обледенелый', 'снег', 'floor', [p('frozen_bush', { side: 'barkDead', top: 'snowTop', bottom: 'barkDead', snow: 'snowTop' })]),
  D('snowman', 'Снеговик', 'снег', 'floor', [p('snowman', { side: 'snowTop', top: 'snowTop', bottom: 'snowTop', iron: 'ironDark', carrot: 'clay', stick: 'barkDead' })], { solid: [{ w: 0.7, d: 0.7, h: 1.6 }] }),
  D('log_snow', 'Бревно под снегом', 'снег', 'floor', [p('log_snow', { side: 'logSide', end: 'logTop', snow: 'snowTop' })], { solid: [{ w: 1.3, d: 0.4, h: 0.4 }] }),
  D('rock_snow', 'Камешки под снегом', 'снег', 'floor', [p('rock_snow', { side: 'cliff', top: 'snowTop', bottom: 'stone' })]),

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
