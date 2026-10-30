/**
 * Палитра блоков: из каких форм (assets/blocks/*.obj) и текстур (textures.ts) собирается каждый блок,
 * как он сталкивается с героем и как рисуется. Карты (assets/maps/*.json) ссылаются на блоки по имени,
 * поэтому имена не переименовывать — только добавлять.
 */

/** detail — мелкая трава поверх блоков: как cutout, но без теней (дёшево) */
export type Layer = 'opaque' | 'cutout' | 'water' | 'acid' | 'fire' | 'glow' | 'detail' | 'river' | 'falls' | 'portal' | 'lava';

export interface Part {
  /** Имя формы — файл assets/blocks/<obj>.obj */
  obj: string;
  layer?: Layer;
  /** Слот текстуры формы (usemtl) → имя текстуры из textures.ts; массив — варианты, выбираются по хэшу клетки */
  tex: Record<string, string | string[]>;
  /** Ставить копию в сторону каждого соседа, который соединяется (перекладины забора, сегменты стенки) */
  connect?: boolean;
}

export interface BlockDef {
  name: string;
  title: string;
  category: string;
  parts: Part[];
  /** Высота для столкновений, м; 0 — можно ходить сквозь */
  collide: number;
  /** Полный непрозрачный куб: прячет грани соседей и затеняет углы */
  full: boolean;
  /** Прятать грани между двумя одинаковыми блоками (вода) */
  cullSame?: boolean;
  /** Разброс яркости между блоками, 0..1 */
  jitter?: number;
  /** Случайный поворот, сдвиг и размер внутри клетки (трава, цветы) */
  scatter?: boolean;
  /** Редактор ставит новый блок прямо на место этого (трава, цветы, огонь) */
  replaceable?: boolean;
  /** Источник света в центре блока */
  light?: { color: string; intensity: number; dist: number };
  /** К нему тянутся перекладины заборов и стенок */
  connects?: boolean;
  /** Есть смысл поворачивать (ступени, брёвна) */
  rotatable?: boolean;
  /** Ступени: низкая половина 0,5, высокая 1 — по ним поднимаются на блок */
  stairs?: boolean;
  /** Бахрома: свисает с верхнего края на сторону, где сосед ниже (уступ, берег) — текстура */
  fringe?: string;
  /** Мелкие пучки на открытом верху, гуще пятнами — текстуры (выбор по хэшу) */
  tufts?: string[];
  /**
   * Рваный край: верх этого блока «заходит» на верх соседа другой природной земли (трава ↔ дорожка) —
   * текстуры-маски, выбор по хэшу; так граница не идёт по линейке клеток
   */
  bleed?: string[];
  /** Запечённый свет: без PointLight, цвет подмешивается в вершины блоков вокруг (портал, свечи — mesher.ts) */
  bakedLight?: { color: string; intensity: number; dist: number };
  /** Течение жидкости, м/с: блики и полосы бегут по направлению поворота (rot 0 — к +X) */
  flow?: number;
  /** Природная земля: цвет плавно гуляет крупными пятнами по миру (светлее-желтее / темнее), а не по блокам */
  natural?: boolean;
}

const cube = (tex: Record<string, string | string[]>, obj = 'cube'): Part => ({ obj, tex });
const same = (t: string | string[]): Record<string, string | string[]> => ({ top: t, side: t, bottom: t });

type Opts = Partial<Omit<BlockDef, 'name' | 'title' | 'category' | 'parts'>>;
const B = (name: string, title: string, category: string, parts: Part[], o: Opts = {}): BlockDef =>
  ({ name, title, category, parts, collide: 1, full: false, ...o });

/** Полный куб из одной текстуры (или top/side/bottom) */
const solid = (name: string, title: string, cat: string, tex: string | string[] | Record<string, string | string[]>, o: Opts = {}): BlockDef =>
  // камень — почти без разброса между блоками (ровные стены Minecraft Dungeons), остальное — 0,08
  B(name, title, cat, [cube(typeof tex === 'string' || Array.isArray(tex) ? same(tex) : tex)], { full: true, connects: true, jitter: cat === 'камень' ? 0.03 : 0.08, ...o });
/** Набор куб + ступени + полублок + стенка из одного камня */
function stoneSet(name: string, title: string, cat: string, tex: string | string[], wall = true): BlockDef[] {
  const out = [
    solid(name, title, cat, tex),
    B(`${name}_stairs`, `${title}: ступени`, cat, [cube(same(tex), 'stairs')], { rotatable: true, collide: 0.5, stairs: true, connects: true }),
    B(`${name}_slab`, `${title}: полублок`, cat, [cube(same(tex), 'slab')], { collide: 0.5, connects: true }),
  ];
  if (wall) out.push(B(`${name}_wall`, `${title}: стенка`, cat, [cube(same(tex), 'wall_post'), { obj: 'wall_seg', tex: same(tex), connect: true }], { collide: 1.5, connects: true }));
  return out;
}

export const BLOCKS: BlockDef[] = [
  B('air', 'Воздух', 'служебные', [], { collide: 0 }),

  // --- земля ---
  solid('grass', 'Трава', 'земля', { top: 'grassTop', side: 'grassSide', bottom: 'dirt' }, { jitter: 0.02, natural: true, bleed: ['grassEdge0', 'grassEdge1', 'grassEdge2', 'grassEdge3'], fringe: 'grassFringe', tufts: ['grassTuft', 'grassTuft', 'grassTuft', 'flowerTuft'] }),
  solid('dirt', 'Земля', 'земля', 'dirt', { jitter: 0.02, natural: true }),
  solid('path', 'Тропинка', 'земля', 'path', { jitter: 0.02, natural: true, bleed: ['pathEdge0', 'pathEdge1', 'pathEdge2', 'pathEdge3'] }),
  solid('gravel', 'Гравий', 'земля', 'gravel', { jitter: 0.03, natural: true }),
  solid('sand', 'Песок', 'земля', 'sand', { jitter: 0.02, natural: true }),
  solid('farm', 'Грядка', 'земля', { top: 'farm', side: 'dirt', bottom: 'dirt' }),
  // вброд: пол в жидкости на полблока ниже верха клетки — заходишь по колено и выходишь обычным шагом (прыжка нет)
  B('water', 'Вода', 'земля', [{ obj: 'water', layer: 'water', tex: same('water') }], { collide: 0.5, cullSame: true, jitter: 0 }),
  B('acid', 'Кислота', 'земля', [{ obj: 'water', layer: 'acid', tex: same('acid') }], { collide: 0.5, cullSame: true, jitter: 0, light: { color: '#7dff5a', intensity: 3, dist: 5 } }),
  B('hole', 'Нора жуков', 'земля', [cube(same('hole'), 'layer')], { collide: 0, replaceable: true }),

  // --- камень ---
  ...stoneSet('stone', 'Камень', 'камень', 'stone'),
  ...stoneSet('cobble', 'Булыжник', 'камень', 'cobble'),
  solid('mossy', 'Булыжник мшистый', 'камень', 'mossy'),
  ...stoneSet('bricks', 'Каменный кирпич', 'камень', 'stoneBricks'),
  solid('bricks_mossy', 'Кирпич мшистый', 'камень', 'stoneBricksMossy'),
  solid('bricks_cracked', 'Кирпич треснутый', 'камень', 'stoneBricksCracked'),
  solid('bricks_old', 'Кирпич руинный', 'камень', ['stoneBricksOld', 'stoneBricksOld', 'stoneBricksOld', 'stoneBricksOldMossy']),
  // руинный кирпич: ступени, полублок и стенка — для арок, обломанных стен и зубцов (библиотека пресетов, партия «Руины»)
  B('bricks_old_stairs', 'Кирпич руинный: ступени', 'камень', [cube(same(['stoneBricksOld', 'stoneBricksOld', 'stoneBricksOldMossy']), 'stairs')], { rotatable: true, collide: 0.5, stairs: true, connects: true }),
  B('bricks_old_slab', 'Кирпич руинный: полублок', 'камень', [cube(same(['stoneBricksOld', 'stoneBricksOld', 'stoneBricksOldMossy']), 'slab')], { collide: 0.5, connects: true }),
  B('bricks_old_wall', 'Кирпич руинный: стенка', 'камень', [cube(same('stoneBricksOld'), 'wall_post'), { obj: 'wall_seg', tex: same('stoneBricksOld'), connect: true }], { collide: 1.5, connects: true }),
  ...stoneSet('tiles', 'Плиты мостовой', 'камень', 'tiles', false),
  // битые плиты (дорога Лимгрейва): одна плита выпала, под ней земля — два варианта по хэшу клетки
  solid('tiles_broken', 'Плиты битые', 'камень', { top: ['tilesBroken0', 'tilesBroken1'], side: 'tiles', bottom: 'tiles' }),
  B('bricks_low', 'Кирпич: низкое укрытие', 'камень', [cube(same('stoneBricks'), 'low')], { collide: 0.875, connects: true }),
  B('cobble_low', 'Булыжник: низкое укрытие', 'камень', [cube(same('cobble'), 'low')], { collide: 0.875, connects: true }),

  // --- дерево ---
  solid('log', 'Бревно', 'дерево', { top: 'logTop', side: 'logSide', bottom: 'logTop' }),
  B('log_x', 'Бревно лёжа', 'дерево', [cube({ top: 'logTop', side: 'logSide', bottom: 'logSide' }, 'cube_x')], { full: true, connects: true, rotatable: true }),
  ...stoneSet('planks', 'Доски', 'дерево', 'planks', false),
  ...stoneSet('planks_dark', 'Доски тёмные', 'дерево', 'planksDark', false),
  B('fence', 'Забор', 'дерево', [cube(same('planks'), 'fence_post'), { obj: 'fence_rail', tex: same('planks'), connect: true }], { collide: 1.5, connects: true }),
  B('crate', 'Ящик', 'дерево', [cube(same('crate'), 'crate')], { connects: true }),
  B('rail', 'Бортик грядки', 'дерево', [cube(same('logSide'), 'rail')], { collide: 0, rotatable: true }),
  B('roof_stairs', 'Черепица: ступени', 'дерево', [cube(same('roof'), 'stairs')], { rotatable: true, collide: 0.5, stairs: true, connects: true }),
  B('roof_slab', 'Черепица: полублок', 'дерево', [cube(same('roof'), 'slab')], { collide: 0.5, connects: true }),
  B('roof_dark_stairs', 'Черепица тёмная: ступени', 'дерево', [cube(same('roofDark'), 'stairs')], { rotatable: true, collide: 0.5, stairs: true, connects: true }),
  B('roof_dark_slab', 'Черепица тёмная: полублок', 'дерево', [cube(same('roofDark'), 'slab')], { collide: 0.5, connects: true }),
  solid('hay', 'Сено', 'дерево', { top: 'hayTop', side: 'hay', bottom: 'hayTop' }),
  // частокол лагеря (библиотека пресетов, партия 5): заострённый кол 12/16, через него не перешагнуть
  B('stake_fence', 'Частокол', 'дерево', [cube({ side: 'stake', top: 'stakeTop', bottom: 'logTop' }, 'post')], { collide: 1.5 }),
  // крыши поселения (библиотека пресетов, партия 4): солома и тёмная черепица
  B('roof_thatch_stairs', 'Солома: ступени', 'дерево', [cube(same('thatch'), 'stairs')], { rotatable: true, collide: 0.5, stairs: true, connects: true }),
  B('roof_thatch_slab', 'Солома: полублок', 'дерево', [cube(same('thatch'), 'slab')], { collide: 0.5, connects: true }),
  B('shingles_stairs', 'Черепица бурая: ступени', 'дерево', [cube(same('shingles'), 'stairs')], { rotatable: true, collide: 0.5, stairs: true, connects: true }),
  B('shingles_slab', 'Черепица бурая: полублок', 'дерево', [cube(same('shingles'), 'slab')], { collide: 0.5, connects: true }),

  // --- снег (биом «снег», wiki/design-prefab-library.md) ---
  solid('snow', 'Снег', 'снег', { top: 'snowTop', side: 'snowSide', bottom: 'dirt' }, { jitter: 0.02, natural: true, bleed: ['snowEdge0', 'snowEdge1', 'snowEdge2', 'snowEdge3'], fringe: 'snowFringe' }),
  B('snow_slab', 'Снег: полублок', 'снег', [cube({ top: 'snowTop', side: 'snowSide', bottom: 'dirt' }, 'slab')], { collide: 0.5, connects: true, jitter: 0.02, natural: true, fringe: 'snowFringe' }),
  B('snow_layer', 'Снег: слой', 'снег', [cube(same('snowTop'), 'layer')], { collide: 0, replaceable: true, jitter: 0.02, natural: true }),
  solid('cliff_snow', 'Скала под снегом', 'снег', { top: 'snowTop', side: 'cliffSnowSide', bottom: 'cliff' }, { jitter: 0.02, natural: true, fringe: 'snowFringe' }),
  solid('ice', 'Лёд', 'снег', 'ice', { jitter: 0 }),
  solid('ice_cracked', 'Лёд треснутый', 'снег', 'iceCracked', { jitter: 0 }),
  B('ice_slab', 'Лёд: полублок', 'снег', [cube(same('ice'), 'slab')], { collide: 0.5, connects: true, jitter: 0 }),
  solid('frozen_water', 'Вода замёрзшая', 'снег', 'frozenWater', { jitter: 0 }),
  B('leaves_snow', 'Хвоя под снегом', 'снег', [{ obj: 'cube', layer: 'cutout', tex: { top: 'snowTop', side: 'leavesSnowCut', bottom: 'leavesSnowCut' } }], { jitter: 0.08 }),
  B('dead_bush_snow', 'Куст сухой в снегу', 'снег', [{ obj: 'cross', layer: 'cutout', tex: { side: 'deadBushSnow' } }], { collide: 0, scatter: true, replaceable: true, jitter: 0.1 }),

  // --- джунгли с кристаллами (биом «джунгли», wiki/design-prefab-library.md, референс 16) ---
  // земля — мозаика ровных блоков, как на референсе: оранжевая, тёмно-красная, бирюзовый мох; раскладка пятнами по шуму — jungleGroundAt (kit.ts)
  solid('jungle_floor', 'Земля джунглей', 'джунгли', { top: 'jungleTop', side: 'jungleSide', bottom: 'dirt' }, { jitter: 0.03, natural: true, bleed: ['jungleEdge0', 'jungleEdge1', 'jungleEdge2', 'jungleEdge3'], fringe: 'jungleFringe' }),
  B('jungle_floor_slab', 'Земля джунглей: полублок', 'джунгли', [cube({ top: 'jungleTop', side: 'jungleSide', bottom: 'dirt' }, 'slab')], { collide: 0.5, connects: true, jitter: 0.03, natural: true, fringe: 'jungleFringe', bleed: ['jungleEdge0', 'jungleEdge1', 'jungleEdge2', 'jungleEdge3'] }),
  solid('jungle_floor_red', 'Земля джунглей красная', 'джунгли', { top: 'jungleRed', side: 'jungleSide', bottom: 'dirt' }, { jitter: 0.03, natural: true, bleed: ['jungleRedEdge0', 'jungleRedEdge1', 'jungleRedEdge2', 'jungleRedEdge3'] }),
  solid('moss_teal', 'Мох бирюзовый', 'джунгли', { top: 'mossTeal', side: 'jungleSide', bottom: 'dirt' }, { jitter: 0.03, natural: true, fringe: 'jungleFringe', bleed: ['mossTealEdge0', 'mossTealEdge1', 'mossTealEdge2', 'mossTealEdge3'] }),
  solid('cliff_jungle', 'Скала во мху', 'джунгли', { top: 'jungleTop', side: 'cliffJungleSide', bottom: 'cliff' }, { jitter: 0.03, natural: true, fringe: 'jungleFringe' }),
  solid('moss_block', 'Мох', 'джунгли', 'mossBlock', { jitter: 0.06, natural: true, bleed: ['mossEdge0', 'mossEdge1', 'mossEdge2', 'mossEdge3'] }),
  B('moss_carpet', 'Мох: ковёр', 'джунгли', [cube(same('mossBlock'), 'layer')], { collide: 0, replaceable: true, jitter: 0.06, natural: true }),
  B('leaves_jungle', 'Листва джунглей', 'джунгли', [{ obj: 'leaves_fluffy', layer: 'cutout', tex: { side: 'leavesJungle', puff: 'leavesJunglePuff' } }], { jitter: 0.1 }),
  solid('log_jungle', 'Бревно джунглей', 'джунгли', { top: 'logJungleTop', side: 'logJungleSide', bottom: 'logJungleTop' }),
  B('vine', 'Лиана', 'джунгли', [{ obj: 'cross', layer: 'cutout', tex: { side: 'vine' } }], { collide: 0, scatter: true, replaceable: true, jitter: 0.15 }),
  B('fern_big', 'Папоротник большой', 'джунгли', [{ obj: 'cross', layer: 'cutout', tex: { side: 'fernBig' } }], { collide: 0, scatter: true, replaceable: true, jitter: 0.15 }),
  B('flower_pink', 'Цветок розовый', 'джунгли', [{ obj: 'cross', layer: 'cutout', tex: { side: 'flowerPink' } }], { collide: 0, scatter: true, replaceable: true }),
  ...stoneSet('temple_stone', 'Храмовый камень', 'джунгли', 'templeStone'),
  solid('temple_stone_carved', 'Храмовый камень: резной', 'джунгли', { top: 'templeStoneTop', side: 'templeStoneCarved', bottom: 'templeStoneTop' }),
  solid('temple_stone_mossy', 'Храмовый камень: мшистый', 'джунгли', 'templeStoneMossy'),
  // кристалл: три призмы, слой glow (не тонмапится, светится под bloom), запечённый бирюзовый свет на 4 м
  B('crystal', 'Кристалл', 'джунгли', [{ obj: 'crystal', layer: 'glow', tex: same('crystal') }], { collide: 1, jitter: 0, bakedLight: { color: '#6fe8e0', intensity: 1.0, dist: 4 } }),
  B('crystal_small', 'Кристалл малый', 'джунгли', [{ obj: 'crystal_small', layer: 'glow', tex: same('crystal') }], { collide: 0, scatter: true, replaceable: true, jitter: 0, bakedLight: { color: '#6fe8e0', intensity: 0.5, dist: 2.5 } }),

  // --- растения ---
  B('leaves', 'Листва', 'растения', [{ obj: 'cube', layer: 'cutout', tex: same('leavesCut') }], { jitter: 0.12 }),
  B('berry_bush', 'Куст с ягодами', 'растения', [{ obj: 'cube', layer: 'cutout', tex: same('berryBush') }], { jitter: 0.1 }),
  B('tall_grass', 'Трава высокая', 'растения', [{ obj: 'cross', layer: 'cutout', tex: { side: 'tallGrass' } }], { collide: 0, scatter: true, replaceable: true, jitter: 0.3 }),
  B('fern', 'Папоротник', 'растения', [{ obj: 'cross', layer: 'cutout', tex: { side: 'fern' } }], { collide: 0, scatter: true, replaceable: true, jitter: 0.2 }),
  B('flower_red', 'Цветок красный', 'растения', [{ obj: 'cross', layer: 'cutout', tex: { side: 'flowerRed' } }], { collide: 0, scatter: true, replaceable: true }),
  B('flower_blue', 'Цветок синий', 'растения', [{ obj: 'cross', layer: 'cutout', tex: { side: 'flowerBlue' } }], { collide: 0, scatter: true, replaceable: true }),
  B('flower_white', 'Цветок белый', 'растения', [{ obj: 'cross', layer: 'cutout', tex: { side: 'flowerWhite' } }], { collide: 0, scatter: true, replaceable: true }),
  B('flower_yellow', 'Цветок жёлтый', 'растения', [{ obj: 'cross', layer: 'cutout', tex: { side: 'flowerYellow' } }], { collide: 0, scatter: true, replaceable: true }),
  B('crops', 'Ростки', 'растения', [{ obj: 'cross', layer: 'cutout', tex: { side: 'crops' } }], { collide: 0, replaceable: true, jitter: 0.1 }),
  B('crops_ripe', 'Ростки спелые', 'растения', [{ obj: 'cross', layer: 'cutout', tex: { side: 'cropsRipe' } }], { collide: 0, replaceable: true, jitter: 0.1 }),
  B('flower_orange', 'Цветок оранжевый', 'растения', [{ obj: 'cross', layer: 'cutout', tex: { side: 'flowerOrange' } }], { collide: 0, scatter: true, replaceable: true }),

  // --- дом: стены, окно, перила ---
  solid('plaster_teal', 'Штукатурка бирюзовая', 'дом', 'plasterTeal'),
  solid('plaster_white', 'Штукатурка белая', 'дом', 'plasterWhite'),
  solid('plaster_rust', 'Штукатурка оранжевая', 'дом', 'plasterRust'),
  solid('brick_brown', 'Кирпич бурый', 'дом', 'brickBrown'),
  solid('concrete', 'Бетон', 'дом', 'concrete'),
  B('window', 'Окно', 'дом', [cube(same('window'), 'pane')], { rotatable: true, jitter: 0 }),
  B('rust_rail', 'Перила ржавые', 'дом', [cube(same('rustMetal'), 'fence_post'), { obj: 'fence_rail', tex: same('rustMetal'), connect: true }], { collide: 1.5, connects: true }),

  // --- мебель: смотрит к +X, поворот разворачивает ---
  B('table', 'Стол', 'мебель', [cube(same('planks'), 'table')], { collide: 13 / 16 }),
  B('chair', 'Стул', 'мебель', [cube(same('planksDark'), 'chair')], { collide: 9 / 16, rotatable: true }),
  B('sofa', 'Диван', 'мебель', [cube({ top: 'fabricRed', side: 'fabricRed', bottom: 'ironDark' }, 'sofa')], { collide: 14 / 16, rotatable: true, connects: true }),
  B('bed', 'Кровать: изножье', 'мебель', [cube({ top: 'blanket', side: 'blanket', bottom: 'planksDark' }, 'bed')], { collide: 9 / 16, rotatable: true }),
  B('bed_head', 'Кровать: изголовье', 'мебель', [cube({ top: 'blanket', side: 'blanket', bottom: 'planksDark', pillow: 'pillow', wood: 'planksDark' }, 'bed_head')], { collide: 9 / 16, rotatable: true }),
  B('lamp', 'Торшер', 'мебель', [cube({ pole: 'ironDark', shade: 'lampShade' }, 'lamp')], { light: { color: '#ffd28a', intensity: 5, dist: 7 } }),
  B('counter', 'Кухонная тумба', 'мебель', [cube({ top: 'counterTop', side: 'cabinet', bottom: 'planksDark' }, 'low')], { collide: 0.875, connects: true }),
  B('stove', 'Плита', 'мебель', [cube({ top: 'stoveTop', side: 'cabinet', bottom: 'planksDark' }, 'low')], { collide: 0.875, connects: true }),
  B('cabinet_low', 'Тумбочка', 'мебель', [cube({ top: 'planksDark', side: 'cabinet', bottom: 'planksDark' }, 'low')], { collide: 0.875, connects: true }),
  solid('cabinet', 'Шкаф', 'мебель', { top: 'planksDark', side: 'cabinet', bottom: 'planksDark' }, { jitter: 0.04 }),
  solid('bookshelf', 'Книжный шкаф', 'мебель', { top: 'planksDark', side: 'bookshelf', bottom: 'planksDark' }, { jitter: 0.04 }),
  solid('fridge', 'Холодильник', 'мебель', { top: 'fridgeTop', side: 'fridge', bottom: 'fridgeTop' }, { jitter: 0 }),
  B('rug', 'Ковёр', 'мебель', [cube(same('rug'), 'carpet')], { collide: 0, jitter: 0 }),

  // --- мир (скриншоты Minecraft Dungeons 10–15, wiki/style-world.md): двор — ограды и пол ---
  ...stoneSet('wall_stone', 'Камень ограды', 'двор', 'wallStone'),
  ...stoneSet('yard_floor', 'Пол двора', 'двор', 'yardFloor', false),

  // скалы и вода (скриншоты 11, 12): скалы по краю уровня, водопад, река с течением, мост
  ...stoneSet('cliff', 'Скала', 'скалы и вода', 'cliff', false),
  solid('cliff_dark', 'Скала тёмная', 'скалы и вода', 'cliffDark'),
  solid('cliff_grass', 'Скала с травой', 'скалы и вода', { top: 'grassTop', side: 'cliffGrassSide', bottom: 'cliff' }, {
    jitter: 0.02, natural: true, fringe: 'grassFringe', tufts: ['grassTuft', 'grassTuft', 'grassTuft', 'flowerTuft'], bleed: ['grassEdge0', 'grassEdge1', 'grassEdge2', 'grassEdge3'],
  }),
  B('waterfall', 'Водопад', 'скалы и вода', [{ obj: 'cube', layer: 'falls', tex: same('waterfall') }], { cullSame: true, jitter: 0 }),
  B('river', 'Река', 'скалы и вода', [{ obj: 'water', layer: 'river', tex: same('river') }], { collide: 0.5, cullSame: true, jitter: 0, rotatable: true, flow: 1.2 }),
  B('bridge_deck', 'Настил моста', 'скалы и вода', [cube(same('bridgePlank'))], { full: true, connects: true, rotatable: true, jitter: 0.04 }),
  B('bridge_beam', 'Брус моста', 'скалы и вода', [cube({ top: 'bridgePost', side: 'bridgePost', bottom: 'bridgePost' }, 'cube_x')], { full: true, connects: true, rotatable: true, jitter: 0.04 }),
  // портал (скриншот 14): золотое сияние с анимацией и запечённым светом, тёмная рама, перемычка с инкрустацией, светлый пол
  B('portal', 'Портал: сияние', 'портал', [{ obj: 'pane', layer: 'portal', tex: same('portal') }], { collide: 0, rotatable: true, jitter: 0, bakedLight: { color: '#ffc248', intensity: 1.1, dist: 4.5 } }),
  solid('portal_frame', 'Портал: рама', 'портал', 'portalFrame', { jitter: 0.02 }),
  solid('portal_trim', 'Портал: перемычка', 'портал', { top: 'portalFrame', side: 'portalTrim', bottom: 'portalFrame' }, { jitter: 0.02 }),
  solid('portal_floor', 'Портал: пол', 'портал', 'portalFloor', { jitter: 0.02, natural: true }),

  // холмы (скриншоты 13, 15): полублок травы для мягких уступов, пышная листва, сухая трава, ромашки, ступени тропинки
  B('grass_slab', 'Трава: полублок', 'холмы', [cube({ top: 'grassTop', side: 'grassSide', bottom: 'dirt' }, 'slab')], {
    collide: 0.5, connects: true, jitter: 0.02, natural: true, fringe: 'grassFringe', tufts: ['grassTuft', 'grassTuft', 'flowerTuft'], bleed: ['grassEdge0', 'grassEdge1', 'grassEdge2', 'grassEdge3'],
  }),
  B('leaves_fluffy', 'Листва пышная', 'холмы', [{ obj: 'leaves_fluffy', layer: 'cutout', tex: { side: 'leavesClump', puff: 'leavesPuff' } }], { jitter: 0.1 }),
  // золотая осень: жёлтый и оранжевый тон выбираются по хэшу клетки — крона пятнистая, как лиственницы на референсах 2, 3, 8
  B('leaves_gold', 'Листва золотая', 'холмы', [{ obj: 'leaves_fluffy', layer: 'cutout', tex: { side: ['leavesGold', 'leavesOrange'], puff: ['leavesGoldPuff', 'leavesOrangePuff'] } }], { jitter: 0.1 }),
  B('dry_grass', 'Сухая трава', 'холмы', [{ obj: 'cross', layer: 'cutout', tex: { side: 'dryGrass' } }], { collide: 0, scatter: true, replaceable: true, jitter: 0.1 }),
  B('daisies', 'Ромашки', 'холмы', [{ obj: 'cross', layer: 'cutout', tex: { side: 'daisies' } }], { collide: 0, scatter: true, replaceable: true, jitter: 0.05 }),
  B('path_stairs', 'Тропинка: ступени', 'холмы', [cube(same('path'), 'stairs')], { rotatable: true, collide: 0.5, stairs: true, connects: true, jitter: 0.02, natural: true }),
  B('path_slab', 'Тропинка: полублок', 'холмы', [cube(same('path'), 'slab')], { collide: 0.5, connects: true, jitter: 0.02, natural: true }),
  B('bridge_post', 'Столб моста', 'скалы и вода', [cube(same('bridgePost'), 'post')], { collide: 1.5, connects: true, jitter: 0.04 }),

  // --- служебные блоки плейграунда: нейтральная сетка и клетчатые стены, стиль игры не задают ---
  solid('dev_light', 'Сетка: светлая', 'служебные', 'devLight', { jitter: 0 }),
  solid('dev_dark', 'Сетка: тёмная', 'служебные', 'devDark', { jitter: 0 }),
  solid('dev_light_line', 'Сетка: светлая с линией', 'служебные', 'devLightLine', { jitter: 0, rotatable: true }),
  solid('dev_dark_line', 'Сетка: тёмная с линией', 'служебные', 'devDarkLine', { jitter: 0, rotatable: true }),
  solid('dev_light_corner', 'Сетка: светлая, угол', 'служебные', 'devLightCorner', { jitter: 0, rotatable: true }),
  solid('dev_dark_corner', 'Сетка: тёмная, угол', 'служебные', 'devDarkCorner', { jitter: 0, rotatable: true }),
  solid('dev_wall', 'Стена плейграунда', 'служебные', 'devWall', { jitter: 0 }),
  solid('dev_cover', 'Укрытие плейграунда', 'служебные', 'devCover', { jitter: 0 }),
  B('dev_cover_low', 'Укрытие плейграунда низкое', 'служебные', [cube(same('devCover'), 'low')], { collide: 0.875, connects: true, jitter: 0 }),

  // --- лава (wiki/design-tower-defence.md, раздел 7): пепельная земля, базальт, обожжённая скала, лава вброд (жжёт) ---
  solid('ash_ground', 'Пепельная земля', 'лава', { top: 'ashTop', side: 'ashSide', bottom: 'ashSide' }, { jitter: 0.03, natural: true }),
  solid('basalt', 'Базальт', 'лава', 'basalt', { jitter: 0.03 }),
  B('basalt_slab', 'Базальт: полублок', 'лава', [cube(same('basalt'), 'slab')], { collide: 0.5, connects: true, jitter: 0.03 }),
  B('basalt_stairs', 'Базальт: ступени', 'лава', [cube(same('basalt'), 'stairs')], { rotatable: true, collide: 0.5, stairs: true, connects: true, jitter: 0.03 }),
  solid('cliff_lava', 'Скала обожжённая', 'лава', 'cliffLava', { jitter: 0.03 }),
  solid('cliff_lava_top', 'Скала обожжённая с пеплом', 'лава', { top: 'ashTop', side: 'cliffLava', bottom: 'cliffLava' }, { jitter: 0.02, natural: true }),
  // лава: жидкость по колено с запечённым тёплым светом на блоки вокруг; герой в ней горит (src/dev/playground.ts)
  B('lava', 'Лава', 'лава', [{ obj: 'water', layer: 'lava', tex: same('lava') }], { collide: 0.5, cullSame: true, jitter: 0, bakedLight: { color: '#ff7a2a', intensity: 0.9, dist: 4 } }),

  // --- огонь и свет ---
  B('torch', 'Факел', 'свет', [cube({ side: 'logSide' }, 'torch'), { obj: 'torch_flame', layer: 'fire', tex: { side: 'fire' } }], { collide: 0, light: { color: '#ffa040', intensity: 6, dist: 7 } }),
  B('campfire', 'Костёр', 'свет', [cube({ top: 'logTop', side: 'logSide', bottom: 'ash' }, 'campfire_logs'), { obj: 'campfire_fire', layer: 'fire', tex: { side: 'fire' } }], { collide: 1, light: { color: '#ff9a3a', intensity: 12, dist: 10 } }),
  B('fire', 'Огонь', 'свет', [{ obj: 'fire', layer: 'fire', tex: { side: 'fire' } }], { collide: 0, replaceable: true, light: { color: '#ff8a2a', intensity: 8, dist: 8 } }),
];

/** Категории набора «мир» — показываются в зоне «мир» плейграунда, а не в рядах витрины */
export const WORLD_CATEGORIES = ['двор', 'скалы и вода', 'холмы', 'портал'];

export const BLOCK_BY_NAME: Record<string, BlockDef> = Object.fromEntries(BLOCKS.map((b) => [b.name, b]));

export function blockDef(name: string): BlockDef {
  const b = BLOCK_BY_NAME[name];
  if (!b) throw new Error(`Нет блока «${name}» в палитре`);
  return b;
}

/** Все имена текстур, которые нужны палитре (для атласа) */
export function paletteTextures(): string[] {
  const s = new Set<string>();
  for (const b of BLOCKS) {
    for (const p of b.parts) for (const t of Object.values(p.tex)) for (const n of Array.isArray(t) ? t : [t]) s.add(n);
    if (b.fringe) s.add(b.fringe);
    for (const t of b.tufts ?? []) s.add(t);
    for (const t of b.bleed ?? []) s.add(t);
  }
  return [...s];
}

export const CATEGORIES: string[] = [...new Set(BLOCKS.filter((b) => b.name !== 'air').map((b) => b.category))];
