import { rng, type Rand } from './textures';

/**
 * Предметы, снаряжение и прокачка в духе Minecraft Dungeons (wiki/design-inventory.md).
 * Четыре вида предметов: ближнее оружие (модель и удары — src/weapons.ts), дальнее, броня, артефакты.
 * У предмета — сила (power): от неё растут урон, здоровье брони и сила артефакта. Прокачка — зачарования:
 * у предмета 1–3 гнезда (по редкости), в гнезде три варианта на выбор; выбранный качается до III за очки
 * зачарования (1 очко за уровень героя). Разбор предмета возвращает потраченные очки и даёт малину.
 * Здесь только данные и правила — без DOM и three: HUD и инвентарь (src/hud/) и сцена (src/dev/gear.ts) читают отсюда.
 */

export type ItemSlot = 'melee' | 'ranged' | 'armor' | 'artifact' | 'aura';
export type Rarity = 'common' | 'rare' | 'unique';

export const SLOT_TITLE: Record<ItemSlot, string> = { melee: 'Ближний бой', ranged: 'Дальний бой', armor: 'Броня', artifact: 'Артефакты', aura: 'Ауры' };
/** Редкость: подпись и цвет рамки, как в Minecraft Dungeons */
export const RARITY: Record<Rarity, { title: string; color: string; salvage: number; slots: number }> = {
  common: { title: 'Обычное', color: '#a7abb3', salvage: 1, slots: 1 },
  rare: { title: 'Редкое', color: '#3fd67a', salvage: 2, slots: 2 },
  unique: { title: 'Уникальное', color: '#f59a23', salvage: 4, slots: 3 },
};

// ---------- каталог ----------

/** Заклинания с боссов (src/magic/, wiki/design-spells.md, раздел 3) */
export type BossSpellKind =
  | 'meteor' | 'flameserpent' | 'ashcrown' | 'icetomb' | 'frostridge' | 'absolutezero'
  | 'thunderspear' | 'thunderleap' | 'stormcloud' | 'starfall' | 'starbeam' | 'judgement'
  | 'deadchoir' | 'gravitywell' | 'skullscythe' | 'fallenguards'
  | 'rift' | 'raspberrybush' | 'titanform' | 'bladephalanx' | 'blink'
  // базовые: огонь, призыв, малиновая кровь, свет — у торговца (src/magic/base-*.ts)
  | 'firewall' | 'firestorm' | 'armageddon' | 'wolves' | 'elemental' | 'golem' | 'bloodclaws' | 'bloodswarm' | 'bloodblade' | 'blindflash';
/** Стартовые заклинания (src/magic/starters.ts) */
export type StarterSpellKind = 'spark' | 'fireball' | 'icerain' | 'heal';
/** Любое заклинание — есть в реестре SPELLS (src/magic/registry.ts) */
export type SpellKind = StarterSpellKind | BossSpellKind;
/** Артефакты без каста: срабатывают в src/gear.ts */
export type PlainArtifactKind = 'firework' | 'totem' | 'boots' | 'horn' | 'harvester' | 'lightning';
export type ArtifactKind = PlainArtifactKind | SpellKind;
export type PerkKind = 'souls' | 'artifactDmg' | 'cooldown' | 'meleeDmg' | 'rangedDmg' | 'speed' | 'potion' | 'roll' | 'arrows';

export interface Perk { kind: PerkKind; value: number }

export const PERK_TEXT: Record<PerkKind, (v: number) => string> = {
  souls: (v) => `+${v}% собранных душ`,
  artifactDmg: (v) => `+${v}% урона артефактов`,
  cooldown: (v) => `−${v}% перезарядки артефактов`,
  meleeDmg: (v) => `+${v}% урона в ближнем бою`,
  rangedDmg: (v) => `+${v}% урона стрел`,
  speed: (v) => `+${v}% скорости движения`,
  potion: (v) => `+${v}% лечения зельем`,
  roll: (v) => `−${v}% перезарядки переката`,
  arrows: (v) => `+${v} стрел в связке`,
};

export interface RangedStats {
  /** Урон стрелы при силе 1 */
  dmg: number;
  /** Пауза между выстрелами, с */
  cd: number;
  /** Скорость стрелы, м/с */
  speed: number;
  /** Дальность, м */
  range: number;
  /** Стрел за выстрел (веер) */
  shots?: number;
  knock: number;
}

/** Как броня выглядит на герое (Knight.setArmor): цвета и детали */
export interface ArmorLook {
  /** Нагрудник и рукава */
  body: string;
  /** Пояс, ворот, кант */
  trim: string;
  /** Наплечники */
  pauldron?: string;
  /** Головной убор: капюшон, шлем, шапка, волчья голова */
  head?: { kind: 'hood' | 'helmet' | 'cap' | 'wolf'; color: string; accent?: string };
  /** Подол ниже пояса (роба) */
  skirt?: string;
  /** Цвет плаща */
  cape?: string;
  /** Светящийся камень на груди */
  glow?: string;
}

/** Как лук выглядит в руке при выстреле (Knight.setBow) */
export interface BowLook { kind: 'bow' | 'crossbow'; wood: string; string: string; glow?: string; size?: number }

export interface ArtifactStats {
  kind: ArtifactKind;
  /** Перезарядка, с */
  cd: number;
  /** Урон или лечение при силе 1 */
  power: number;
  /** Радиус действия, м */
  radius?: number;
  /** Длительность эффекта, с */
  duration?: number;
  /** Сколько душ тратит */
  souls?: number;
  /** Заклинание: время полного заряда, с (держать клавишу — сильнее) */
  charge?: number;
  /** Строка свойств в карточке: {v} — сила с учётом предмета, {r} — радиус, {d} — длительность */
  info?: string;
}

/** Ауры (wiki/design-spells.md, раздел 4): действуют всегда, по шкале — вспышка ×3 */
export type AuraKind = 'pact' | 'bastion' | 'rage' | 'clarity' | 'thorns' | OffenseKind;
/** Наступательные ауры (src/aura-offense.ts): сами бьют врагов вокруг героя */
export type OffenseKind = 'inferno' | 'frost' | 'storm' | 'halo' | 'shade' | 'quake' | 'blades';
export interface AuraStats {
  kind: AuraKind;
  /** Сила эффекта, % при силе предмета 1; у наступательных — урон за раз (у «Голодной тени» — % ослабления) */
  value: number;
  /** Радиус: союзники в нём получают эффект, м */
  radius: number;
}

export interface ItemDef {
  id: string;
  slot: ItemSlot;
  title: string;
  rarity: Rarity;
  /** Иконка из src/icons.ts */
  icon: string;
  description: string;
  /** Ближний бой: id оружия в src/weapons.ts */
  weapon?: string;
  ranged?: RangedStats & { look: BowLook };
  /** Броня: здоровье при силе 1, особые свойства и вид на герое */
  armor?: { health: number; perks: Perk[]; look: ArmorLook };
  artifact?: ArtifactStats;
  aura?: AuraStats;
  /**
   * Заклинание (wiki/design-spells.md): стартовое; 'shop' — обычное, продаёт торговец за малину; 'boss' — редкое и выше, только с боссов.
   * В сундуки и в случайный товар не попадает
   */
  spell?: 'starter' | 'shop' | 'boss';
  /** Особые свойства оружия (строки как в MCD: «Широкие удары») */
  traits?: string[];
}

const A = (kind: ArtifactKind, cd: number, power: number, more: Partial<ArtifactStats> = {}): ArtifactStats => ({ kind, cd, power, ...more });

export const ITEMS: readonly ItemDef[] = [
  // ближний бой — модели и удары в src/weapons.ts
  { id: 'sword', slot: 'melee', weapon: 'sword', title: 'Меч стража', rarity: 'common', icon: 'sword', description: 'Надёжный клинок, с которым начинается любой поход.', traits: ['Комбо из трёх ударов'] },
  { id: 'axe', slot: 'melee', weapon: 'axe', title: 'Топор лесоруба', rarity: 'common', icon: 'axe', description: 'Рубит и дрова, и тех, кто прячется за ними.', traits: ['Сильное отбрасывание'] },
  { id: 'mace', slot: 'melee', weapon: 'mace', title: 'Булава', rarity: 'common', icon: 'mace', description: 'Шипы на шаре делают каждое слово весомее.', traits: ['Большая ударная волна'] },
  { id: 'spear', slot: 'melee', weapon: 'spear', title: 'Копьё', rarity: 'common', icon: 'spear', description: 'Держит врагов на почтительном расстоянии.', traits: ['Длинные выпады'] },
  { id: 'claymore', slot: 'melee', weapon: 'claymore', title: 'Клеймор', rarity: 'rare', icon: 'claymore', description: 'Двуручный меч, выкованный для тех, кто не отступает.', traits: ['Широкие удары', 'Сильное отбрасывание'] },
  { id: 'dagger', slot: 'melee', weapon: 'dagger', title: 'Кинжал тени', rarity: 'rare', icon: 'dagger', description: 'Быстрый, как мысль, и тихий, как тень.', traits: ['Быстрые удары', 'Частые криты'] },
  { id: 'hammer', slot: 'melee', weapon: 'hammer', title: 'Великий молот', rarity: 'rare', icon: 'hammer', description: 'Каждый удар отзывается гулом в камне.', traits: ['Огромная ударная волна'] },
  { id: 'scythe', slot: 'melee', weapon: 'scythe', title: 'Коса жнеца', rarity: 'unique', icon: 'scythe', description: 'Говорят, коса сама выбирает, кого жать.', traits: ['Очень широкие взмахи', 'Круговой вихрь'] },
  { id: 'katana', slot: 'melee', weapon: 'katana', title: 'Катана', rarity: 'rare', icon: 'katana', description: 'Тонкий изогнутый клинок: режет раньше, чем враг поймёт, что бой начался.', traits: ['Быстрые длинные разрезы', 'Частые криты'] },
  { id: 'nagakiba', slot: 'melee', weapon: 'nagakiba', title: 'Нагакиба', rarity: 'unique', icon: 'nagakiba', description: 'Катана длиной с шест для сушки белья. Носить неудобно, зато враги кончаются ещё на подходе.', traits: ['Дальность больше копья', 'Двуручная'] },
  { id: 'dragonslayer', slot: 'melee', weapon: 'dragonslayer', title: 'Убийца драконов', rarity: 'unique', icon: 'dragonslayer', description: 'Слишком большой, слишком толстый, слишком тяжёлый и слишком грубый. Настоящая груда железа.', traits: ['Самый сильный удар', 'Очень медленный'] },
  { id: 'pontiff', slot: 'melee', weapon: 'pontiff', title: 'Клинки понтифика', rarity: 'unique', icon: 'pontiff', description: 'Пламя в правой руке, звёздный свет в левой. Понтифик Маливин не любил ждать.', traits: ['Парное оружие', 'Огонь и свет по очереди'] },
  { id: 'staff', slot: 'melee', weapon: 'staff', title: 'Посох звездочёта', rarity: 'rare', icon: 'staff', description: 'Кристалл на навершии помнит каждую звезду, на которую смотрел хозяин.', traits: ['Дальние удары', 'Большая волна'] },
  { id: 'halberd', slot: 'melee', weapon: 'halberd', title: 'Алебарда стражи', rarity: 'rare', icon: 'halberd', description: 'Стража Малины держит ворота именно такими.', traits: ['Длинное древко', 'Широкая дуга'] },
  { id: 'rapier', slot: 'melee', weapon: 'rapier', title: 'Рапира дуэлянта', rarity: 'common', icon: 'rapier', description: 'Укол, ещё укол — и вежливый поклон.', traits: ['Молниеносные уколы', 'Частые криты'] },
  { id: 'knuckles', slot: 'melee', weapon: 'knuckles', title: 'Кастеты кузнеца', rarity: 'common', icon: 'knuckles', description: 'Кузнец ковал их для себя — на случай, если молот далеко.', traits: ['Парное оружие', 'Самые быстрые удары'] },
  // дальний бой
  { id: 'bow', slot: 'ranged', title: 'Лук', rarity: 'common', icon: 'bow', description: 'Простой лук из гибкого тиса.', ranged: { dmg: 8, cd: 0.55, speed: 26, range: 20, knock: 0.3, look: { kind: 'bow', wood: '#8a5a32', string: '#e8e2d0' } } },
  { id: 'longbow', slot: 'ranged', title: 'Длинный лук', rarity: 'rare', icon: 'longbow', description: 'Стрелы летят дальше и бьют сильнее, но тетиву тянуть дольше.', ranged: { dmg: 14, cd: 0.85, speed: 34, range: 28, knock: 0.5, look: { kind: 'bow', wood: '#4f7a3a', string: '#e8e2d0', size: 1.25 } } },
  { id: 'crossbow', slot: 'ranged', title: 'Арбалет', rarity: 'common', icon: 'crossbow', description: 'Тяжёлый болт сбивает с ног.', ranged: { dmg: 12, cd: 0.95, speed: 30, range: 22, knock: 1.2, look: { kind: 'crossbow', wood: '#6a4024', string: '#d8d2c0' } } },
  { id: 'twinbow', slot: 'ranged', title: 'Звёздный лук', rarity: 'unique', icon: 'starbow', description: 'Каждый выстрел — веер из трёх светящихся стрел.', ranged: { dmg: 7, cd: 0.6, speed: 30, range: 22, shots: 3, knock: 0.3, look: { kind: 'bow', wood: '#2f8fd0', string: '#ffffff', glow: '#5ad8ff' } } },
  // броня
  { id: 'tunic', slot: 'armor', title: 'Куртка странника', rarity: 'common', icon: 'tunic', description: 'Тёплая, удобная и с карманом для малины.', armor: { health: 20, perks: [{ kind: 'potion', value: 25 }], look: { body: '#5e8f46', trim: '#7a5230' } } },
  { id: 'soulrobe', slot: 'armor', title: 'Роба душ', rarity: 'common', icon: 'soulrobe', description: 'В особом свете души, вплетённые в ткань, мерцают силой.', armor: { health: 30, perks: [{ kind: 'souls', value: 50 }, { kind: 'artifactDmg', value: 50 }], look: { body: '#4a4f8a', trim: '#6b72b8', skirt: '#454a82', head: { kind: 'hood', color: '#3d4278' }, cape: '#2e3160', glow: '#7ae0ff' } } },
  { id: 'wolf', slot: 'armor', title: 'Волчья броня', rarity: 'common', icon: 'wolf', description: 'Шкура старого вожака всё ещё помнит лес.', armor: { health: 35, perks: [{ kind: 'potion', value: 50 }], look: { body: '#9a9ea6', trim: '#5e6269', pauldron: '#c9ccd2', head: { kind: 'wolf', color: '#9a9ea6', accent: '#c9ccd2' }, cape: '#6f747c' } } },
  { id: 'mercenary', slot: 'armor', title: 'Доспех наёмника', rarity: 'common', icon: 'mercenary', description: 'Плотная кожа с заклёпками, проверенная в сотне стычек.', armor: { health: 40, perks: [{ kind: 'meleeDmg', value: 15 }], look: { body: '#8a5a32', trim: '#c03a3a', pauldron: '#6a4024', head: { kind: 'cap', color: '#6a4024' }, cape: '#a8302e' } } },
  { id: 'scale', slot: 'armor', title: 'Чешуйчатый доспех', rarity: 'rare', icon: 'scale', description: 'Тысяча пластин звенит на каждом шагу.', armor: { health: 50, perks: [{ kind: 'meleeDmg', value: 20 }, { kind: 'roll', value: 25 }], look: { body: '#5f8f7a', trim: '#2f4a3e', pauldron: '#8fc0a6', skirt: '#456b5a', head: { kind: 'helmet', color: '#5f8f7a', accent: '#8fc0a6' } } } },
  { id: 'champion', slot: 'armor', title: 'Доспех чемпиона', rarity: 'unique', icon: 'champion', description: 'Сияющие латы того, кто выстоял на арене сто дней.', armor: { health: 65, perks: [{ kind: 'cooldown', value: 25 }, { kind: 'arrows', value: 10 }, { kind: 'meleeDmg', value: 10 }], look: { body: '#d6dbe2', trim: '#f2b632', pauldron: '#e8ecf2', head: { kind: 'helmet', color: '#d6dbe2', accent: '#f2b632' }, cape: '#c42a3a', glow: '#ff3a5a' } } },
  // артефакты
  { id: 'firework', slot: 'artifact', title: 'Огненная стрела', rarity: 'common', icon: 'firework', description: 'Ракета летит к курсору и взрывается снопом искр.', artifact: A('firework', 9, 30, { radius: 3 }) },
  { id: 'totem', slot: 'artifact', title: 'Тотем исцеления', rarity: 'common', icon: 'totem', description: 'Ставит тотем, который лечит всех рядом.', artifact: A('totem', 22, 6, { radius: 3.5, duration: 8 }) },
  { id: 'boots', slot: 'artifact', title: 'Сапоги скорости', rarity: 'common', icon: 'boots', description: 'Короткий рывок скорости.', artifact: A('boots', 4, 1.6, { duration: 2 }) },
  { id: 'horn', slot: 'artifact', title: 'Рог ветра', rarity: 'rare', icon: 'horn', description: 'Порыв ветра отбрасывает всех вокруг.', artifact: A('horn', 8, 6, { radius: 5 }) },
  { id: 'lightning', slot: 'artifact', title: 'Молниевый куб', rarity: 'rare', icon: 'lightning', description: 'Молния бьёт по трём ближайшим врагам.', artifact: A('lightning', 12, 28, { radius: 9 }) },
  // заклинания — src/spells.ts
  { id: 'spark', slot: 'artifact', spell: 'starter', title: 'Искра', rarity: 'common', icon: 'spark', description: 'Молния с неба бьёт в цель и перескакивает на соседей. Держи клавишу — перескоков больше.', artifact: A('spark', 4, 18, { radius: 12, charge: 0.9 }) },
  { id: 'fireball', slot: 'artifact', spell: 'starter', title: 'Огненный шар', rarity: 'common', icon: 'fireball', description: 'Шар пламени летит к курсору и взрывается. Держи клавишу — шар растёт.', artifact: A('fireball', 6, 26, { radius: 2.2, charge: 1.1 }) },
  { id: 'icerain', slot: 'artifact', spell: 'starter', title: 'Ледяной дождь', rarity: 'common', icon: 'icerain', description: 'Сосульки падают с неба на место у курсора. Держи клавишу — зона шире.', artifact: A('icerain', 10, 7, { radius: 3, duration: 2, charge: 1 }) },
  { id: 'heal', slot: 'artifact', spell: 'starter', title: 'Слабое лечение', rarity: 'common', icon: 'heal', description: 'Листья и лепестки малины затягивают раны. Держи клавишу — лечит сильнее.', artifact: A('heal', 12, 22, { radius: 4, charge: 0.8 }) },
  // ауры — src/auras.ts; как заклинания, падают только с боссов
  { id: 'pact', slot: 'aura', spell: 'boss', title: 'Кровавый пакт', rarity: 'unique', icon: 'a-pact', description: 'Каждый удар возвращает герою часть отнятой жизни: красные нити тянутся от ран врага.', aura: { kind: 'pact', value: 8, radius: 8 } },
  { id: 'bastion', slot: 'aura', spell: 'boss', title: 'Бастион', rarity: 'unique', icon: 'a-bastion', description: 'Вокруг кружат щиты-руны и принимают часть ударов на себя.', aura: { kind: 'bastion', value: 20, radius: 8 } },
  { id: 'rage', slot: 'aura', spell: 'boss', title: 'Ярость', rarity: 'unique', icon: 'a-rage', description: 'Оружие тлеет, удары бьют сильнее и чаще бывают сокрушительными.', aura: { kind: 'rage', value: 15, radius: 8 } },
  { id: 'clarity', slot: 'aura', spell: 'boss', title: 'Ясность', rarity: 'unique', icon: 'a-clarity', description: 'Голубые огоньки ускоряют мысль: заклинания и артефакты перезаряжаются быстрее, души липнут к рукам.', aura: { kind: 'clarity', value: 25, radius: 8 } },
  { id: 'thorns', slot: 'aura', spell: 'boss', title: 'Терновый венец', rarity: 'unique', icon: 'a-thorns', description: 'Колючие лозы под ногами хлещут каждого, кто бьёт героя вблизи.', aura: { kind: 'thorns', value: 30, radius: 8 } },
  // наступательные ауры — src/aura-offense.ts
  { id: 'inferno', slot: 'aura', spell: 'boss', title: 'Горнило', rarity: 'unique', icon: 'a-inferno', description: 'Вокруг героя тлеет кольцо углей и жжёт каждого, кто подойдёт.', aura: { kind: 'inferno', value: 3, radius: 8 } },
  { id: 'frost', slot: 'aura', spell: 'boss', title: 'Стужа', rarity: 'unique', icon: 'a-frost', description: 'Иней стелется по земле: враги рядом мёрзнут и вязнут в холоде.', aura: { kind: 'frost', value: 2, radius: 8 } },
  { id: 'storm', slot: 'aura', spell: 'boss', title: 'Грозовой венец', rarity: 'unique', icon: 'a-storm', description: 'По доспеху бегут искры, а молния сама находит врага и перескакивает дальше.', aura: { kind: 'storm', value: 8, radius: 8 } },
  { id: 'halo', slot: 'aura', spell: 'boss', title: 'Карающий ореол', rarity: 'unique', icon: 'a-halo', description: 'Золотой нимб над головой: каждый четвёртый удар зовёт луч с неба.', aura: { kind: 'halo', value: 12, radius: 8 } },
  { id: 'shade', slot: 'aura', spell: 'boss', title: 'Голодная тень', rarity: 'unique', icon: 'a-shade', description: 'Тень у ног слабит врагов рядом, а во вспышке тянет из них жизнь.', aura: { kind: 'shade', value: 15, radius: 8 } },
  { id: 'quake', slot: 'aura', spell: 'boss', title: 'Каменная поступь', rarity: 'unique', icon: 'a-quake', description: 'Земля под героем вздрагивает и раз в несколько секунд отбрасывает врагов.', aura: { kind: 'quake', value: 10, radius: 8 } },
  { id: 'blades', slot: 'aura', spell: 'boss', title: 'Вихрь клинков', rarity: 'unique', icon: 'a-blades', description: 'Призрачные мечи кружат вокруг героя и режут всех, кого заденут.', aura: { kind: 'blades', value: 4, radius: 8 } },
  // заклинания — src/magic/; редкость: обычное → common (продаёт торговец), редкое → rare, легендарное и мифическое → unique (с боссов)
  { id: 'meteor', slot: 'artifact', spell: 'boss', title: 'Небесный молот', rarity: 'rare', icon: 'meteor', description: 'С неба падает пылающий камень: кратер, оглушение и горящая земля.', artifact: A('meteor', 14, 70, { radius: 3.5, charge: 1.2, info: 'Метеор: {v} урона в радиусе {r} м' }) },
  { id: 'flameserpent', slot: 'artifact', spell: 'boss', title: 'Пламенный змей', rarity: 'unique', icon: 'flameserpent', description: 'Огненный змей ползёт по земле, петляет между врагами и оставляет горящую колею.', artifact: A('flameserpent', 18, 22, { radius: 1.6, duration: 3.5, charge: 1.2, info: 'Змей: {v} урона за касание, {d} с' }) },
  { id: 'ashcrown', slot: 'artifact', spell: 'shop', title: 'Пепельная корона', rarity: 'common', icon: 'ashcrown', description: 'Кольцо огня волной расходится от героя и отбрасывает всех.', artifact: A('ashcrown', 8, 24, { radius: 5, charge: 0.8, info: 'Волна огня: {v} урона до {r} м' }) },
  { id: 'icetomb', slot: 'artifact', spell: 'boss', title: 'Ледяная гробница', rarity: 'rare', icon: 'icetomb', description: 'Враг вмерзает в кристалл, а через миг кристалл разлетается веером осколков.', artifact: A('icetomb', 14, 60, { radius: 3.5, duration: 2, charge: 1, info: 'Гробница: {v} урона, осколки до {r} м' }) },
  { id: 'frostridge', slot: 'artifact', spell: 'shop', title: 'Морозный гребень', rarity: 'common', icon: 'frostridge', description: 'Веер ледяных шипов вырастает из земли и подбрасывает врагов.', artifact: A('frostridge', 7, 26, { radius: 7, charge: 0.9, info: 'Шипы: {v} урона, веер на {r} м' }) },
  { id: 'absolutezero', slot: 'artifact', spell: 'boss', title: 'Абсолютный ноль', rarity: 'unique', icon: 'absolutezero', description: 'Купол стужи: внутри время почти стоит, враги покрываются льдом и замирают.', artifact: A('absolutezero', 30, 40, { radius: 8, duration: 4, charge: 1.6, info: 'Купол: {v} урона волнами, {d} с в радиусе {r} м' }) },
  { id: 'thunderspear', slot: 'artifact', spell: 'boss', title: 'Копьё громовержца', rarity: 'rare', icon: 'thunderspear', description: 'Копьё молнии растёт в руке и пронзает всю линию.', artifact: A('thunderspear', 9, 55, { radius: 18, charge: 1.2, info: 'Копьё: {v} урона по линии {r} м' }) },
  { id: 'thunderleap', slot: 'artifact', spell: 'boss', title: 'Громовой прыжок', rarity: 'unique', icon: 'thunderleap', description: 'Герой взлетает и бьёт в землю: цепные молнии во все стороны.', artifact: A('thunderleap', 14, 45, { radius: 4.5, charge: 1, info: 'Удар: {v} урона в радиусе {r} м и молнии' }) },
  { id: 'stormcloud', slot: 'artifact', spell: 'shop', title: 'Грозовая туча', rarity: 'common', icon: 'stormcloud', description: 'Над героем висит туча и сама бьёт ближайших врагов.', artifact: A('stormcloud', 16, 16, { radius: 7, duration: 8, charge: 0.8, info: 'Туча: {v} урона за молнию, {d} с' }) },
  { id: 'starfall', slot: 'artifact', spell: 'boss', title: 'Звездопад', rarity: 'unique', icon: 'starfall', description: 'Звёзды падают с неба по всей зоне, а герой парит в столбе света.', artifact: A('starfall', 22, 18, { radius: 6, duration: 5, charge: 1.2, info: 'Звёзды: {v} урона каждая, {d} с в радиусе {r} м' }) },
  { id: 'starbeam', slot: 'artifact', spell: 'boss', title: 'Луч павшей звезды', rarity: 'unique', icon: 'starbeam', description: 'Огромный луч из рук: герой медленно ведёт им за курсором.', artifact: A('starbeam', 30, 30, { radius: 16, duration: 3, charge: 1.6, info: 'Луч: {v} урона за касание, {d} с, длина {r} м' }) },
  { id: 'judgement', slot: 'artifact', spell: 'boss', title: 'Небесный суд', rarity: 'unique', icon: 'judgement', description: 'Столп света бьёт врагов, лечит союзников и поднимает павших.', artifact: A('judgement', 24, 60, { radius: 4, charge: 1.3, info: 'Суд: {v} урона и лечения в радиусе {r} м' }) },
  { id: 'deadchoir', slot: 'artifact', spell: 'boss', title: 'Хор мёртвых', rarity: 'rare', icon: 'deadchoir', description: 'Призрачные руки тянутся из земли, держат врагов и утаскивают вниз.', artifact: A('deadchoir', 14, 14, { radius: 4, duration: 3, charge: 1, info: 'Руки: {v} урона волнами, {d} с в радиусе {r} м' }) },
  { id: 'gravitywell', slot: 'artifact', spell: 'boss', title: 'Гравитационный колодец', rarity: 'unique', icon: 'gravitywell', description: 'Чёрная сфера стягивает врагов, а потом схлопывается и выбрасывает их.', artifact: A('gravitywell', 20, 70, { radius: 6, duration: 2, charge: 1.2, info: 'Колодец: тянет {d} с, взрыв {v} урона' }) },
  { id: 'skullscythe', slot: 'artifact', spell: 'shop', title: 'Коса-череп', rarity: 'common', icon: 'skullscythe', description: 'Летящий череп: врагу — урон, герою — немного жизни.', artifact: A('skullscythe', 5, 30, { radius: 14, charge: 0.7, info: 'Череп: {v} урона, дальность {r} м' }) },
  { id: 'fallenguards', slot: 'artifact', spell: 'boss', title: 'Павшие стражи', rarity: 'rare', icon: 'fallenguards', description: 'Три призрачных рыцаря выходят из порталов и сражаются рядом.', artifact: A('fallenguards', 30, 12, { duration: 15, souls: 50, charge: 1.2, info: 'Стражи: {v} урона за удар, {d} с' }) },
  { id: 'rift', slot: 'artifact', spell: 'boss', title: 'Разлом', rarity: 'rare', icon: 'rift', description: 'Трещина бежит вперёд, из неё вырастают каменные шипы.', artifact: A('rift', 10, 40, { radius: 10, charge: 1, info: 'Разлом: {v} урона по линии {r} м' }) },
  // базовые заклинания — src/magic/base-*.ts; не слишком сильные, все у торговца
  { id: 'firewall', slot: 'artifact', spell: 'shop', title: 'Огненная стена', rarity: 'common', icon: 'firewall', description: 'Поперёк пути к курсору встаёт стена огня и жжёт всех, кто в ней или идёт сквозь. Держи клавишу — стена длиннее и жарче.', artifact: A('firewall', 10, 8, { radius: 5, duration: 4, charge: 1, info: 'Стена {r} м: {v} урона каждые 0,5 с, {d} с' }) },
  { id: 'firestorm', slot: 'artifact', spell: 'shop', title: 'Огненный ураган', rarity: 'common', icon: 'firestorm', description: 'Огненный смерч медленно катится к курсору, затягивает и замедляет врагов.', artifact: A('firestorm', 12, 6, { radius: 1.8, duration: 4, charge: 1, info: 'Смерч: {v} урона каждые 0,3 с, −30 % скорости, {d} с' }) },
  { id: 'armageddon', slot: 'artifact', spell: 'shop', title: 'Малый армагеддон', rarity: 'common', icon: 'armageddon', description: 'Три секунды вокруг героя падают огненные шары.', artifact: A('armageddon', 16, 14, { radius: 5, duration: 3, charge: 1.1, info: 'Дождь шаров: {v} урона каждый, круг {r} м, {d} с' }) },
  { id: 'wolves', slot: 'artifact', spell: 'shop', title: 'Стая волков', rarity: 'common', icon: 'wolves', description: 'Из порталов выбегают волки и гонят ближайших врагов; укус замедляет. Держи клавишу — волков трое.', artifact: A('wolves', 20, 8, { duration: 12, charge: 1, info: 'Волки: {v} урона за укус, {d} с' }) },
  { id: 'elemental', slot: 'artifact', spell: 'shop', title: 'Малый элементаль', rarity: 'common', icon: 'elemental', description: 'Рядом парит элементаль и стреляет огоньками; стихия меняется по очереди — огонь, лёд, молния.', artifact: A('elemental', 22, 10, { radius: 6, duration: 15, charge: 1, info: 'Элементаль: {v} урона за огонёк, {d} с' }) },
  { id: 'golem', slot: 'artifact', spell: 'shop', title: 'Каменный голем', rarity: 'common', icon: 'golem', description: 'Медленный каменный голем бьёт кулаком в землю и держит врагов на себе.', artifact: A('golem', 28, 18, { radius: 2, duration: 18, charge: 1.1, info: 'Голем: {v} урона по кругу {r} м, оглушение, {d} с' }) },
  { id: 'bloodclaws', slot: 'artifact', spell: 'shop', title: 'Малиновые когти', rarity: 'common', icon: 'bloodclaws', description: 'Перед героем из земли вырываются три когтя малинового пламени. Стоит здоровья, копит кровотечение.', artifact: A('bloodclaws', 5, 22, { radius: 3, charge: 0.8, info: 'Когти: {v} урона, кровотечение; цена — 6 % здоровья' }) },
  { id: 'bloodswarm', slot: 'artifact', spell: 'shop', title: 'Рой малинок', rarity: 'common', icon: 'bloodswarm', description: 'Поток крошечных малиновых мушек конусом жалит и копит кровотечение. Стоит здоровья.', artifact: A('bloodswarm', 6, 4, { radius: 5, duration: 1.5, charge: 0.8, info: 'Рой: {v} урона за укус, {d} с; цена — 8 % здоровья' }) },
  { id: 'bloodblade', slot: 'artifact', spell: 'shop', title: 'Малиновый клинок', rarity: 'common', icon: 'bloodblade', description: 'Оружие покрывается малиновым соком: удары сильнее и копят кровотечение. Стоит здоровья.', artifact: A('bloodblade', 25, 10, { duration: 15, charge: 1, info: 'Клинок: +{v}% урона мечом и кровотечение, {d} с; цена — 10 % здоровья' }) },
  { id: 'blindflash', slot: 'artifact', spell: 'shop', title: 'Ослепляющая вспышка', rarity: 'common', icon: 'blindflash', description: 'Вспышка света вокруг героя: урон, отброс и оглушение рядовых врагов (боссов — нет).', artifact: A('blindflash', 14, 12, { radius: 4, duration: 1.5, charge: 0.9, info: 'Вспышка: {v} урона в радиусе {r} м, оглушение {d} с' }) },
  { id: 'raspberrybush', slot: 'artifact', spell: 'shop', title: 'Малиновый куст', rarity: 'common', icon: 'raspberrybush', description: 'Колючий куст держит врагов, а потом лопается ягодами, которые лечат.', artifact: A('raspberrybush', 12, 20, { radius: 3, duration: 4, charge: 0.9, info: 'Куст: {v} урона колючками, лечит ягодами' }) },
  { id: 'titanform', slot: 'artifact', spell: 'boss', title: 'Облик титана', rarity: 'unique', icon: 'titanform', description: 'Герой становится огромным каменным великаном: удары трясут землю.', artifact: A('titanform', 40, 60, { duration: 10, charge: 1.5, info: 'Титан: +{v}% урона, −50% получаемого, {d} с' }) },
  { id: 'bladephalanx', slot: 'artifact', spell: 'boss', title: 'Фаланга клинков', rarity: 'rare', icon: 'bladephalanx', description: 'Над головой веером раскрываются семь призрачных мечей и летят по очереди.', artifact: A('bladephalanx', 10, 20, { radius: 14, charge: 1, info: 'Клинки: 7 × {v} урона' }) },
  { id: 'blink', slot: 'artifact', spell: 'boss', title: 'Разрыв', rarity: 'rare', icon: 'blink', description: 'Рывок сквозь пространство: взрыв там, где исчез, и там, где появился.', artifact: A('blink', 8, 45, { radius: 8, charge: 0.8, info: 'Разрыв: {v} урона дважды, рывок до {r} м' }) },
  { id: 'harvester', slot: 'artifact', title: 'Жнец душ', rarity: 'unique', icon: 'harvester', description: 'Высвобождает собранные души взрывом вокруг героя.', artifact: A('harvester', 3, 45, { radius: 4, souls: 40 }) },
];

/** Стартовые заклинания (wiki/design-spells.md, раздел 2) */
export const STARTER_SPELLS = ['fireball', 'spark', 'heal', 'icerain'] as const;
export const AURAS = ['pact', 'bastion', 'rage', 'clarity', 'thorns', 'inferno', 'frost', 'storm', 'halo', 'shade', 'quake', 'blades'] as const;
/** Заклинания, которые продаёт торговец (обычные) */
export const SHOP_SPELLS = (): string[] => ITEMS.filter((d) => d.spell === 'shop').map((d) => d.id);
/** Заклинания с боссов — пока боссов нет, лежат в инвентаре с начала */
const BOSS_SPELL_IDS = (): string[] => ITEMS.filter((d) => d.spell === 'boss' && d.slot === 'artifact').map((d) => d.id);
/** Базовые заклинания (src/magic/base-*.ts): продаёт торговец, а в плейграунде они у героя с начала */
export const BASE_SPELLS = ['firewall', 'firestorm', 'armageddon', 'wolves', 'elemental', 'golem', 'bloodclaws', 'bloodswarm', 'bloodblade', 'blindflash'];

export const itemDef = (id: string): ItemDef => {
  const d = ITEMS.find((x) => x.id === id);
  if (!d) throw new Error(`Нет предмета ${id}`);
  return d;
};

// ---------- зачарования ----------

export type EnchantId =
  | 'sharpness' | 'critical' | 'leeching' | 'knockback' | 'swirling' | 'fireAspect' | 'soulSiphon' | 'smiting'
  | 'power' | 'multishot' | 'infinity' | 'accelerate' | 'punch' | 'piercing'
  | 'health' | 'cooldown' | 'soulGather' | 'potionBoost' | 'acrobat' | 'regen';

export interface EnchantDef {
  id: EnchantId;
  title: string;
  slot: Exclude<ItemSlot, 'artifact' | 'aura'>;
  /** Мощное: дороже на 1 очко за ступень, выпадает только на уникальных */
  powerful?: boolean;
  /** Значение на ступенях I, II, III */
  tiers: [number, number, number];
  /** Иконка и цвет ромба */
  icon: string;
  color: string;
  text: (v: number) => string;
}

export const ENCHANTS: readonly EnchantDef[] = [
  { id: 'sharpness', slot: 'melee', title: 'Острота', tiers: [10, 20, 30], icon: 'e-blade', color: '#5ab8ff', text: (v) => `+${v}% урона в ближнем бою` },
  { id: 'critical', slot: 'melee', title: 'Критический удар', tiers: [10, 15, 20], icon: 'e-star', color: '#ffcf3a', text: (v) => `${v}% шанс нанести тройной урон` },
  { id: 'leeching', slot: 'melee', title: 'Вампиризм', tiers: [4, 8, 12], icon: 'e-drop', color: '#e2304a', text: (v) => `Удар лечит на ${v}% от урона` },
  { id: 'knockback', slot: 'melee', title: 'Отбрасывание', tiers: [30, 60, 90], icon: 'e-fist', color: '#c08a5a', text: (v) => `+${v}% к отбрасыванию` },
  { id: 'swirling', slot: 'melee', title: 'Вихрь', tiers: [15, 30, 45], icon: 'e-swirl', color: '#7ae0d0', text: (v) => `Ударная волна добивающего шире на ${v}%` },
  { id: 'fireAspect', slot: 'melee', title: 'Огненный аспект', tiers: [3, 6, 9], icon: 'e-flame', color: '#ff7a2a', text: (v) => `Поджигает цель: +${v} урона огнём` },
  { id: 'soulSiphon', slot: 'melee', title: 'Вытягивание душ', tiers: [1, 2, 3], icon: 'soul', color: '#5ae0ff', text: (v) => `+${v} души за удар` },
  { id: 'smiting', slot: 'melee', title: 'Сокрушение', powerful: true, tiers: [15, 30, 45], icon: 'e-bolt', color: '#c27aff', text: (v) => `${v}% шанс, что любой удар даст ударную волну` },
  { id: 'power', slot: 'ranged', title: 'Сила', tiers: [20, 35, 50], icon: 'e-arrow', color: '#5ab8ff', text: (v) => `+${v}% урона стрел` },
  { id: 'multishot', slot: 'ranged', title: 'Мультивыстрел', tiers: [20, 35, 50], icon: 'e-multi', color: '#5ad86a', text: (v) => `${v}% шанс выпустить ещё 2 стрелы` },
  { id: 'infinity', slot: 'ranged', title: 'Бесконечность', tiers: [25, 50, 75], icon: 'e-inf', color: '#a77aff', text: (v) => `${v}% шанс не потратить стрелу` },
  { id: 'accelerate', slot: 'ranged', title: 'Ускорение', tiers: [10, 20, 30], icon: 'e-clock', color: '#ffcf3a', text: (v) => `Стреляет на ${v}% чаще` },
  { id: 'punch', slot: 'ranged', title: 'Отдача', tiers: [50, 100, 150], icon: 'e-fist', color: '#c08a5a', text: (v) => `+${v}% к отбрасыванию стрел` },
  { id: 'piercing', slot: 'ranged', title: 'Пронзание', powerful: true, tiers: [1, 2, 3], icon: 'e-pierce', color: '#c27aff', text: (v) => `Стрела пробивает ${v} ${v === 1 ? 'цель' : 'цели'}` },
  { id: 'health', slot: 'armor', title: 'Крепость', tiers: [10, 20, 30], icon: 'heart', color: '#e2304a', text: (v) => `+${v} к здоровью` },
  { id: 'cooldown', slot: 'armor', title: 'Перезарядка', tiers: [10, 18, 25], icon: 'e-clock', color: '#ffcf3a', text: (v) => `−${v}% перезарядки артефактов` },
  { id: 'soulGather', slot: 'armor', title: 'Сборщик душ', tiers: [25, 50, 75], icon: 'soul', color: '#5ae0ff', text: (v) => `+${v}% собранных душ` },
  { id: 'potionBoost', slot: 'armor', title: 'Лекарь', tiers: [20, 40, 60], icon: 'potion', color: '#ff5a7a', text: (v) => `Зелье лечит на ${v}% больше` },
  { id: 'acrobat', slot: 'armor', title: 'Акробат', tiers: [15, 30, 45], icon: 'roll', color: '#5ab8ff', text: (v) => `−${v}% перезарядки переката` },
  { id: 'regen', slot: 'armor', title: 'Восстановление', powerful: true, tiers: [1, 2, 3], icon: 'e-leaf', color: '#5ad86a', text: (v) => `+${v} здоровья в секунду` },
];

export const enchantDef = (id: EnchantId): EnchantDef => {
  const d = ENCHANTS.find((e) => e.id === id);
  if (!d) throw new Error(`Нет зачарования ${id}`);
  return d;
};

/** Цена ступени tier (1..3): обычное — tier очков, мощное — tier + 1 */
export const enchantCost = (e: EnchantDef, tier: number): number => tier + (e.powerful ? 1 : 0);

// ---------- экземпляры ----------

export interface EnchantSlot {
  /** Три варианта на выбор */
  options: EnchantId[];
  /** Выбранный вариант (индекс в options) или −1 */
  chosen: number;
  /** Ступень 0..3 */
  tier: number;
}

export interface Item {
  uid: string;
  def: string;
  power: number;
  enchants: EnchantSlot[];
  /** Ещё не смотрели в инвентаре — жёлтый уголок */
  isNew?: boolean;
}

export interface Equipment {
  melee: string | null;
  ranged: string | null;
  armor: string | null;
  artifacts: [string | null, string | null, string | null];
  /** Четвёртое гнездо — аура */
  aura: string | null;
}

export interface ProfileData {
  version: 1;
  level: number;
  xp: number;
  /** Свободные очки зачарования */
  points: number;
  /** Малина — валюта, как изумруды в MCD */
  berries: number;
  souls: number;
  arrows: number;
  seq: number;
  items: Item[];
  equip: Equipment;
}

/** Множитель от силы предмета: +6% за единицу */
export const powerMult = (power: number): number => 1 + (power - 1) * 0.06;
/** Опыт до следующего уровня */
export const xpToNext = (level: number): number => 40 + (level - 1) * 20;
export const MAX_SOULS = 100;
export const MAX_ARROWS = 200;
export const ARROW_BUNDLE = 12;

const hash = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

/** Гнёзда зачарований: по редкости, в каждом три разных варианта; на уникальном один вариант — мощный */
export function rollEnchantSlots(def: ItemDef, r: Rand): EnchantSlot[] {
  if (def.slot === 'artifact' || def.slot === 'aura') return [];
  const pool = ENCHANTS.filter((e) => e.slot === def.slot);
  const normal = pool.filter((e) => !e.powerful), strong = pool.filter((e) => e.powerful);
  const out: EnchantSlot[] = [];
  for (let s = 0; s < RARITY[def.rarity].slots; s++) {
    const bag = [...normal];
    const options: EnchantId[] = [];
    if (def.rarity === 'unique' && s === 0 && strong.length) options.push(strong[Math.floor(r() * strong.length)].id);
    while (options.length < 3 && bag.length) options.push(bag.splice(Math.floor(r() * bag.length), 1)[0].id);
    out.push({ options, chosen: -1, tier: 0 });
  }
  return out;
}

/** Очки, вложенные в предмет */
export function spentPoints(it: Item): number {
  let n = 0;
  for (const s of it.enchants) {
    if (s.chosen < 0) continue;
    const e = enchantDef(s.options[s.chosen]);
    for (let t = 1; t <= s.tier; t++) n += enchantCost(e, t);
  }
  return n;
}

/** Цены лавок (src/hud/shop.ts): перековка, стрелы, обычное заклинание; остальное — по характеристикам (src/prices.ts) */
export const PRICE = {
  arrows: 20,
  reforge: (power: number): number => 30 + power * 15,
  /** Обычное заклинание у торговца */
  spell: (power: number): number => 110 + power * 12,
};

/** Малина за разбор */
export const salvageValue = (it: Item): number => Math.round((8 + it.power * 5) * RARITY[itemDef(it.def).rarity].salvage);

/** Значение зачарования на предмете (сумма по гнёздам), 0 — нет */
export function enchantValue(it: Item | null | undefined, id: EnchantId): number {
  if (!it) return 0;
  let v = 0;
  for (const s of it.enchants) if (s.chosen >= 0 && s.tier > 0 && s.options[s.chosen] === id) v += enchantDef(id).tiers[s.tier - 1];
  return v;
}

/** Числа предмета для карточки: здоровье брони, урон стрелы и артефакта с учётом силы */
export function armorHealth(it: Item): number { return Math.round((itemDef(it.def).armor?.health ?? 0) * powerMult(it.power)); }

// ---------- профиль героя ----------

const KEY = 'malina.profile';

/** Сводка снаряжения — её читает сцена */
export interface GearStats {
  meleeMult: number;
  critChance: number;
  leech: number;
  knockMult: number;
  waveMult: number;
  fireDmg: number;
  soulsPerHit: number;
  smiteChance: number;
  rangedMult: number;
  rangedCdMult: number;
  multishot: number;
  infinity: number;
  rangedKnock: number;
  pierce: number;
  maxHpBonus: number;
  soulsMult: number;
  artifactCdMult: number;
  artifactMult: number;
  potionMult: number;
  rollCdMult: number;
  regen: number;
  speedMult: number;
  arrowBundle: number;
}

export class Profile {
  data: ProfileData;
  private readonly listeners = new Set<() => void>();
  private rand: Rand;

  constructor(data?: ProfileData, private readonly persist = true) {
    const loaded = data ? null : Profile.load();
    this.data = data ?? loaded ?? Profile.starter();
    this.rand = rng(hash(String(this.data.seq)) || 1);
    this.data.equip.aura ??= null;
    if (loaded) this.addStarterSpells();
  }

  /** Сохранения до заклинаний: стартовые четыре — в инвентарь, свободные гнёзда занять ими */
  private addStarterSpells(): void {
    const have = new Set(this.data.items.map((i) => i.def));
    const add = STARTER_SPELLS.filter((d) => !have.has(d));
    // пока боссов нет — ауры и заклинания с боссов кладём в инвентарь, чтобы их можно было примерить
    // плейграунд: всё оружие ближнего боя — в инвентаре, новое оружие тоже доходит до старых сохранений
    const extra = [...AURAS, ...BOSS_SPELL_IDS(), ...BASE_SPELLS, ...ITEMS.filter((d) => d.slot === 'melee').map((d) => d.id)].filter((d) => !have.has(d));
    if (!add.length && !extra.length) return;
    for (const d of add) {
      const it = this.add(d, 1);
      const free = this.data.equip.artifacts.indexOf(null);
      if (free >= 0) this.data.equip.artifacts[free] = it.uid;
    }
    for (const d of extra) this.add(d, itemDef(d).rarity === 'unique' ? 3 : itemDef(d).rarity === 'rare' ? 2 : 1);
    if (this.persist) try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* закрытое хранилище */ }
  }

  /** Стартовый набор: экипировка новичка и сундук трофеев, чтобы было что примерить и зачаровать */
  static starter(): ProfileData {
    const p = new Profile({ version: 1, level: 1, xp: 0, points: 3, berries: 250, souls: 0, arrows: 40, seq: 0, items: [], equip: { melee: null, ranged: null, armor: null, artifacts: [null, null, null], aura: null } }, false);
    const eq = (def: string, power: number): string => p.add(def, power, false).uid;
    p.data.equip = { melee: eq('sword', 1), armor: eq('tunic', 1), ranged: eq('bow', 1), artifacts: [eq('fireball', 1), eq('spark', 1), eq('heal', 1)], aura: null };
    for (const [def, power] of [
      ['icerain', 1], ['firework', 1], ['totem', 1], ...AURAS.map((id): [string, number] => [id, 1]),
      ...BOSS_SPELL_IDS().map((id): [string, number] => [id, 1]),
      ...BASE_SPELLS.map((id): [string, number] => [id, 1]),
      ['claymore', 3], ['axe', 2], ['dagger', 2], ['hammer', 3], ['scythe', 4], ['mace', 1], ['spear', 2],
      ['katana', 3], ['nagakiba', 4], ['dragonslayer', 4], ['pontiff', 4], ['staff', 3], ['halberd', 3], ['rapier', 2], ['knuckles', 2],
      ['crossbow', 2], ['longbow', 3], ['twinbow', 4],
      ['soulrobe', 2], ['wolf', 2], ['mercenary', 1], ['scale', 3], ['champion', 4],
      ['boots', 2], ['horn', 2], ['lightning', 3], ['harvester', 3],
    ] as [string, number][]) p.add(def, power, false);
    return p.data;
  }

  /**
   * Набор обороны куста (wiki/design-tower-defence.md, раздел 12): в бой — как новый герой, всё силы 1 — меч стража,
   * куртка странника, лук и три стартовых заклинания, без ауры; остальное покупается у маркитанта за малину боя.
   * Своё снаряжение героя откладывается на время боя и возвращается в лагере (src/menu/session.ts)
   */
  tdKit(): void {
    const D = this.data;
    D.items = [];
    const eq = (def: string): string => this.add(def, 1, false).uid;
    D.equip = { melee: eq('sword'), armor: eq('tunic'), ranged: eq('bow'), artifacts: [eq('fireball'), eq('spark'), eq('heal')], aura: null };
    D.arrows = 40;
    this.save();
  }

  static load(): ProfileData | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const d = JSON.parse(raw) as ProfileData;
      if (d.version !== 1 || !Array.isArray(d.items)) return null;
      // предметы, которых больше нет в каталоге, выбрасываем
      d.items = d.items.filter((i) => ITEMS.some((x) => x.id === i.def));
      return d;
    } catch { return null; }
  }

  save(): void {
    if (this.persist) try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* закрытое хранилище */ }
    for (const f of this.listeners) f();
  }

  onChange(f: () => void): () => void { this.listeners.add(f); return () => { this.listeners.delete(f); }; }

  /** Начать заново со стартового набора */
  reset(): void { this.data = Profile.starter(); this.save(); }

  get(uid: string | null | undefined): Item | null { return uid ? this.data.items.find((i) => i.uid === uid) ?? null : null; }

  /** Новый предмет в инвентарь */
  add(def: string, power: number, isNew = true): Item {
    const d = itemDef(def);
    const uid = `i${++this.data.seq}`;
    const it: Item = { uid, def, power: Math.max(1, Math.round(power)), enchants: rollEnchantSlots(d, rng(hash(uid + def) || 1)), isNew };
    this.data.items.push(it);
    return it;
  }

  /** Случайный трофей около силы героя: обычные чаще, уникальные редко. В инвентарь — через add, когда подобрали */
  rollLoot(r: Rand = this.rand, slots?: ItemSlot[]): { def: string; power: number } {
    const x = r();
    const rarity: Rarity = x < 0.06 ? 'unique' : x < 0.32 ? 'rare' : 'common';
    // заклинания выпадают только из боссов — не из сундуков и не у торговцев
    const of = (rr: Rarity): ItemDef[] => ITEMS.filter((d) => d.rarity === rr && !d.spell && (!slots || slots.includes(d.slot)));
    const pool = of(rarity).length ? of(rarity) : of('common');
    return { def: pool[Math.floor(r() * pool.length)].id, power: Math.max(1, this.power + Math.floor(r() * 3) - 1) };
  }

  /** Купить за малину: false — не хватает */
  pay(price: number): boolean {
    if (this.data.berries < price) return false;
    this.data.berries -= price;
    this.save();
    return true;
  }

  /** Перековка у кузнеца: +1 к силе предмета */
  reforge(uid: string, price: number): boolean {
    const it = this.get(uid);
    if (!it || !this.pay(price)) return false;
    it.power++;
    this.save();
    return true;
  }

  equipped(slot: 'melee' | 'ranged' | 'armor'): Item | null { return this.get(this.data.equip[slot]); }
  artifacts(): (Item | null)[] { return this.data.equip.artifacts.map((u) => this.get(u)); }

  isEquipped(uid: string): boolean {
    const e = this.data.equip;
    return e.melee === uid || e.ranged === uid || e.armor === uid || e.artifacts.includes(uid) || e.aura === uid;
  }

  /** Надеть; артефакт — в гнездо at или в первое свободное (нет свободного — вместо первого) */
  equip(uid: string, at?: number): boolean {
    const it = this.get(uid);
    if (!it) return false;
    const slot = itemDef(it.def).slot, e = this.data.equip;
    if (slot === 'artifact') {
      const was = e.artifacts.indexOf(uid);
      let i = at ?? e.artifacts.indexOf(null);
      if (i < 0) i = 0;
      if (was >= 0) e.artifacts[was] = e.artifacts[i];
      e.artifacts[i] = uid;
    } else if (slot === 'aura') e.aura = uid;
    else e[slot] = uid;
    it.isNew = false;
    this.save();
    return true;
  }

  /** Снять артефакт из гнезда (оружие и броню снять нельзя — только заменить) */
  unequipArtifact(i: number): void { this.data.equip.artifacts[i] = null; this.save(); }

  /** Надетая аура */
  aura(): Item | null { return this.get(this.data.equip.aura); }
  unequipAura(): void { this.data.equip.aura = null; this.save(); }

  /** Разобрать: малина и потраченные очки назад. Надетое не разбирается */
  salvage(uid: string): { berries: number; points: number } | null {
    const it = this.get(uid);
    if (!it || this.isEquipped(uid)) return null;
    const res = { berries: salvageValue(it), points: spentPoints(it) };
    this.data.items = this.data.items.filter((i) => i.uid !== uid);
    this.data.berries += res.berries;
    this.data.points += res.points;
    this.save();
    return res;
  }

  /** Цена следующего шага в гнезде (выбор варианта = ступень I) или null — нельзя */
  nextCost(it: Item, slot: number, option: number): number | null {
    const s = it.enchants[slot];
    if (!s) return null;
    if (s.chosen >= 0 && s.chosen !== option) return null;
    if (s.tier >= 3) return null;
    return enchantCost(enchantDef(s.options[option]), s.tier + 1);
  }

  /** Выбрать вариант в гнезде или поднять его ступень */
  enchant(uid: string, slot: number, option: number): boolean {
    const it = this.get(uid);
    if (!it) return false;
    const cost = this.nextCost(it, slot, option);
    if (cost === null || cost > this.data.points) return false;
    const s = it.enchants[slot];
    s.chosen = option;
    s.tier++;
    this.data.points -= cost;
    this.save();
    return true;
  }

  /** Опыт; возвращает, сколько уровней взято (каждый — очко зачарования) */
  addXp(n: number): number {
    const d = this.data;
    d.xp += n;
    let ups = 0;
    while (d.xp >= xpToNext(d.level)) { d.xp -= xpToNext(d.level); d.level++; d.points++; ups++; }
    this.save();
    return ups;
  }

  addSouls(n: number): void { this.data.souls = Math.min(MAX_SOULS, this.data.souls + n); }
  addBerries(n: number): void { this.data.berries += n; this.save(); }
  addArrows(n: number): void { this.data.arrows = Math.min(MAX_ARROWS, this.data.arrows + n); this.save(); }

  /** Сила героя: среднее оружия, брони, лука и артефактов (как в MCD) */
  get power(): number {
    const p = (it: Item | null): number => it?.power ?? 0;
    const arts = this.artifacts().filter((x): x is Item => !!x);
    const art = arts.length ? arts.reduce((a, x) => a + x.power, 0) / arts.length : 0;
    return Math.max(1, Math.round((p(this.equipped('melee')) + p(this.equipped('armor')) + p(this.equipped('ranged')) + art) / 4));
  }

  stats(): GearStats {
    const m = this.equipped('melee'), r = this.equipped('ranged'), a = this.equipped('armor');
    const perk = (k: PerkKind): number => (a ? itemDef(a.def).armor?.perks.filter((p) => p.kind === k).reduce((s, p) => s + p.value, 0) ?? 0 : 0);
    return {
      meleeMult: (m ? powerMult(m.power) : 1) * (1 + (enchantValue(m, 'sharpness') + perk('meleeDmg')) / 100),
      critChance: enchantValue(m, 'critical') / 100,
      leech: enchantValue(m, 'leeching') / 100,
      knockMult: 1 + enchantValue(m, 'knockback') / 100,
      waveMult: 1 + enchantValue(m, 'swirling') / 100,
      fireDmg: enchantValue(m, 'fireAspect'),
      soulsPerHit: 1 + enchantValue(m, 'soulSiphon'),
      smiteChance: enchantValue(m, 'smiting') / 100,
      rangedMult: (r ? powerMult(r.power) : 1) * (1 + (enchantValue(r, 'power') + perk('rangedDmg')) / 100),
      rangedCdMult: 1 - enchantValue(r, 'accelerate') / 100,
      multishot: enchantValue(r, 'multishot') / 100,
      infinity: enchantValue(r, 'infinity') / 100,
      rangedKnock: 1 + enchantValue(r, 'punch') / 100,
      pierce: enchantValue(r, 'piercing'),
      maxHpBonus: (a ? armorHealth(a) : 0) + enchantValue(a, 'health'),
      soulsMult: 1 + (perk('souls') + enchantValue(a, 'soulGather')) / 100,
      artifactCdMult: Math.max(0.3, 1 - (perk('cooldown') + enchantValue(a, 'cooldown')) / 100),
      artifactMult: 1 + perk('artifactDmg') / 100,
      potionMult: 1 + (perk('potion') + enchantValue(a, 'potionBoost')) / 100,
      rollCdMult: Math.max(0.3, 1 - (perk('roll') + enchantValue(a, 'acrobat')) / 100),
      regen: enchantValue(a, 'regen'),
      speedMult: 1 + perk('speed') / 100,
      arrowBundle: ARROW_BUNDLE + perk('arrows'),
    };
  }
}
