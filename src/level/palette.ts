/**
 * Палитра блоков: из каких форм (assets/blocks/*.obj) и текстур (textures.ts) собирается каждый блок,
 * как он сталкивается с героем и как рисуется. Карты (assets/maps/*.json) ссылаются на блоки по имени,
 * поэтому имена не переименовывать — только добавлять.
 */

export type Layer = 'opaque' | 'cutout' | 'water' | 'fire';

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
}

const cube = (tex: Record<string, string | string[]>, obj = 'cube'): Part => ({ obj, tex });
const same = (t: string | string[]): Record<string, string | string[]> => ({ top: t, side: t, bottom: t });

type Opts = Partial<Omit<BlockDef, 'name' | 'title' | 'category' | 'parts'>>;
const B = (name: string, title: string, category: string, parts: Part[], o: Opts = {}): BlockDef =>
  ({ name, title, category, parts, collide: 1, full: false, ...o });

/** Полный куб из одной текстуры (или top/side/bottom) */
const solid = (name: string, title: string, cat: string, tex: string | string[] | Record<string, string | string[]>, o: Opts = {}): BlockDef =>
  B(name, title, cat, [cube(typeof tex === 'string' || Array.isArray(tex) ? same(tex) : tex)], { full: true, connects: true, jitter: 0.08, ...o });
/** Набор куб + ступени + полублок + стенка из одного камня */
function stoneSet(name: string, title: string, cat: string, tex: string | string[], wall = true): BlockDef[] {
  const out = [
    solid(name, title, cat, tex),
    B(`${name}_stairs`, `${title}: ступени`, cat, [cube(same(tex), 'stairs')], { rotatable: true, collide: 0.5, connects: true }),
    B(`${name}_slab`, `${title}: полублок`, cat, [cube(same(tex), 'slab')], { collide: 0.5, connects: true }),
  ];
  if (wall) out.push(B(`${name}_wall`, `${title}: стенка`, cat, [cube(same(tex), 'wall_post'), { obj: 'wall_seg', tex: same(tex), connect: true }], { collide: 1.5, connects: true }));
  return out;
}

export const BLOCKS: BlockDef[] = [
  B('air', 'Воздух', 'служебные', [], { collide: 0 }),

  // --- земля ---
  solid('grass', 'Трава', 'земля', { top: 'grassTop', side: 'grassSide', bottom: 'dirt' }, { jitter: 0.14 }),
  solid('dirt', 'Земля', 'земля', 'dirt', { jitter: 0.12 }),
  solid('path', 'Тропинка', 'земля', 'path'),
  solid('gravel', 'Гравий', 'земля', 'gravel'),
  solid('sand', 'Песок', 'земля', 'sand'),
  solid('farm', 'Грядка', 'земля', { top: 'farm', side: 'dirt', bottom: 'dirt' }),
  B('water', 'Вода', 'земля', [{ obj: 'water', layer: 'water', tex: same('water') }], { collide: 0, cullSame: true, jitter: 0 }),

  // --- камень ---
  ...stoneSet('stone', 'Камень', 'камень', 'stone'),
  ...stoneSet('cobble', 'Булыжник', 'камень', 'cobble'),
  solid('mossy', 'Булыжник мшистый', 'камень', 'mossy'),
  ...stoneSet('bricks', 'Каменный кирпич', 'камень', 'stoneBricks'),
  solid('bricks_mossy', 'Кирпич мшистый', 'камень', 'stoneBricksMossy'),
  solid('bricks_cracked', 'Кирпич треснутый', 'камень', 'stoneBricksCracked'),
  solid('bricks_old', 'Кирпич руинный', 'камень', ['stoneBricksOld', 'stoneBricksOld', 'stoneBricksMossy', 'stoneBricksCracked']),
  ...stoneSet('tiles', 'Плиты мостовой', 'камень', 'tiles', false),

  // --- дерево ---
  solid('log', 'Бревно', 'дерево', { top: 'logTop', side: 'logSide', bottom: 'logTop' }),
  B('log_x', 'Бревно лёжа', 'дерево', [cube({ top: 'logTop', side: 'logSide', bottom: 'logSide' }, 'cube_x')], { full: true, connects: true, rotatable: true }),
  ...stoneSet('planks', 'Доски', 'дерево', 'planks', false),
  ...stoneSet('planks_dark', 'Доски тёмные', 'дерево', 'planksDark', false),
  B('fence', 'Забор', 'дерево', [cube(same('planks'), 'fence_post'), { obj: 'fence_rail', tex: same('planks'), connect: true }], { collide: 1.5, connects: true }),
  B('crate', 'Ящик', 'дерево', [cube(same('crate'), 'crate')], { connects: true }),
  B('rail', 'Бортик грядки', 'дерево', [cube(same('logSide'), 'rail')], { collide: 0, rotatable: true }),
  B('roof_stairs', 'Черепица: ступени', 'дерево', [cube(same('roof'), 'stairs')], { rotatable: true, collide: 0.5, connects: true }),
  B('roof_slab', 'Черепица: полублок', 'дерево', [cube(same('roof'), 'slab')], { collide: 0.5, connects: true }),
  B('roof_dark_stairs', 'Черепица тёмная: ступени', 'дерево', [cube(same('roofDark'), 'stairs')], { rotatable: true, collide: 0.5, connects: true }),
  B('roof_dark_slab', 'Черепица тёмная: полублок', 'дерево', [cube(same('roofDark'), 'slab')], { collide: 0.5, connects: true }),
  solid('hay', 'Сено', 'дерево', { top: 'hayTop', side: 'hay', bottom: 'hayTop' }),

  // --- растения ---
  B('leaves', 'Листва', 'растения', [{ obj: 'cube', layer: 'cutout', tex: same('leavesCut') }], { jitter: 0.2 }),
  B('berry_bush', 'Куст с ягодами', 'растения', [{ obj: 'cube', layer: 'cutout', tex: same('berryBush') }], { jitter: 0.1 }),
  B('tall_grass', 'Трава высокая', 'растения', [{ obj: 'cross', layer: 'cutout', tex: { side: 'tallGrass' } }], { collide: 0, scatter: true, replaceable: true, jitter: 0.3 }),
  B('fern', 'Папоротник', 'растения', [{ obj: 'cross', layer: 'cutout', tex: { side: 'fern' } }], { collide: 0, scatter: true, replaceable: true, jitter: 0.2 }),
  B('flower_red', 'Цветок красный', 'растения', [{ obj: 'cross', layer: 'cutout', tex: { side: 'flowerRed' } }], { collide: 0, scatter: true, replaceable: true }),
  B('flower_blue', 'Цветок синий', 'растения', [{ obj: 'cross', layer: 'cutout', tex: { side: 'flowerBlue' } }], { collide: 0, scatter: true, replaceable: true }),
  B('flower_white', 'Цветок белый', 'растения', [{ obj: 'cross', layer: 'cutout', tex: { side: 'flowerWhite' } }], { collide: 0, scatter: true, replaceable: true }),
  B('flower_yellow', 'Цветок жёлтый', 'растения', [{ obj: 'cross', layer: 'cutout', tex: { side: 'flowerYellow' } }], { collide: 0, scatter: true, replaceable: true }),

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
  for (const b of BLOCKS) for (const p of b.parts) for (const t of Object.values(p.tex)) for (const n of Array.isArray(t) ? t : [t]) s.add(n);
  return [...s];
}

export const CATEGORIES: string[] = [...new Set(BLOCKS.filter((b) => b.name !== 'air').map((b) => b.category))];
