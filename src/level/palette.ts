/**
 * Палитра блоков: из каких форм (assets/blocks/*.obj) и текстур (textures.ts) собирается каждый блок,
 * как он сталкивается с героем и как рисуется. Карты (assets/maps/*.json) ссылаются на блоки по имени,
 * поэтому имена не переименовывать — только добавлять.
 */

/** detail — мелкая трава поверх блоков: как cutout, но без теней (дёшево) */
export type Layer = 'opaque' | 'cutout' | 'water' | 'acid' | 'fire' | 'glow' | 'detail';

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
  solid('grass', 'Трава', 'земля', { top: 'grassTop', side: 'grassSide', bottom: 'dirt' }, { jitter: 0.02, natural: true, fringe: 'grassFringe', tufts: ['grassTuft', 'grassTuft', 'grassTuft', 'flowerTuft'] }),
  solid('dirt', 'Земля', 'земля', 'dirt', { jitter: 0.02, natural: true }),
  solid('path', 'Тропинка', 'земля', 'path', { jitter: 0.02, natural: true }),
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
  ...stoneSet('tiles', 'Плиты мостовой', 'камень', 'tiles', false),
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

  // --- растения ---
  B('leaves', 'Листва', 'растения', [{ obj: 'cube', layer: 'cutout', tex: same('leavesCut') }], { jitter: 0.12 }),
  B('berry_bush', 'Куст с ягодами', 'растения', [{ obj: 'cube', layer: 'cutout', tex: same('berryBush') }], { jitter: 0.1 }),
  B('tall_grass', 'Трава высокая', 'растения', [{ obj: 'cross', layer: 'cutout', tex: { side: 'tallGrass' } }], { collide: 0, scatter: true, replaceable: true, jitter: 0.3 }),
  B('fern', 'Папоротник', 'растения', [{ obj: 'cross', layer: 'cutout', tex: { side: 'fern' } }], { collide: 0, scatter: true, replaceable: true, jitter: 0.2 }),
  B('flower_red', 'Цветок красный', 'растения', [{ obj: 'cross', layer: 'cutout', tex: { side: 'flowerRed' } }], { collide: 0, scatter: true, replaceable: true }),
  B('flower_blue', 'Цветок синий', 'растения', [{ obj: 'cross', layer: 'cutout', tex: { side: 'flowerBlue' } }], { collide: 0, scatter: true, replaceable: true }),
  B('flower_white', 'Цветок белый', 'растения', [{ obj: 'cross', layer: 'cutout', tex: { side: 'flowerWhite' } }], { collide: 0, scatter: true, replaceable: true }),
  B('flower_yellow', 'Цветок жёлтый', 'растения', [{ obj: 'cross', layer: 'cutout', tex: { side: 'flowerYellow' } }], { collide: 0, scatter: true, replaceable: true }),

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

  // --- огонь и свет ---
  B('torch', 'Факел', 'свет', [cube({ side: 'logSide' }, 'torch'), { obj: 'torch_flame', layer: 'fire', tex: { side: 'fire' } }], { collide: 0, light: { color: '#ffa040', intensity: 6, dist: 7 } }),
  B('campfire', 'Костёр', 'свет', [cube({ top: 'logTop', side: 'logSide', bottom: 'ash' }, 'campfire_logs'), { obj: 'campfire_fire', layer: 'fire', tex: { side: 'fire' } }], { collide: 1, light: { color: '#ff9a3a', intensity: 12, dist: 10 } }),
  B('fire', 'Огонь', 'свет', [{ obj: 'fire', layer: 'fire', tex: { side: 'fire' } }], { collide: 0, replaceable: true, light: { color: '#ff8a2a', intensity: 8, dist: 8 } }),
];

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
  }
  return [...s];
}

export const CATEGORIES: string[] = [...new Set(BLOCKS.filter((b) => b.name !== 'air').map((b) => b.category))];
