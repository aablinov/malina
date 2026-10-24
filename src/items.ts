import { rng, type Rand } from './textures';

/**
 * Предметы, снаряжение и прокачка в духе Minecraft Dungeons (wiki/design-inventory.md).
 * Четыре вида предметов: ближнее оружие (модель и удары — src/weapons.ts), дальнее, броня, артефакты.
 * У предмета — сила (power): от неё растут урон, здоровье брони и сила артефакта. Прокачка — зачарования:
 * у предмета 1–3 гнезда (по редкости), в гнезде три варианта на выбор; выбранный качается до III за очки
 * зачарования (1 очко за уровень героя). Разбор предмета возвращает потраченные очки и даёт малину.
 * Здесь только данные и правила — без DOM и three: HUD и инвентарь (src/hud/) и сцена (src/dev/gear.ts) читают отсюда.
 */

export type ItemSlot = 'melee' | 'ranged' | 'armor' | 'artifact';
export type Rarity = 'common' | 'rare' | 'unique';

export const SLOT_TITLE: Record<ItemSlot, string> = { melee: 'Ближний бой', ranged: 'Дальний бой', armor: 'Броня', artifact: 'Артефакты' };
/** Редкость: подпись и цвет рамки, как в Minecraft Dungeons */
export const RARITY: Record<Rarity, { title: string; color: string; salvage: number; slots: number }> = {
  common: { title: 'Обычное', color: '#a7abb3', salvage: 1, slots: 1 },
  rare: { title: 'Редкое', color: '#3fd67a', salvage: 2, slots: 2 },
  unique: { title: 'Уникальное', color: '#f59a23', salvage: 4, slots: 3 },
};

// ---------- каталог ----------

export type ArtifactKind = 'firework' | 'totem' | 'boots' | 'horn' | 'harvester' | 'lightning';
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
  ranged?: RangedStats;
  /** Броня: здоровье при силе 1 и особые свойства */
  armor?: { health: number; perks: Perk[] };
  artifact?: ArtifactStats;
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
  // дальний бой
  { id: 'bow', slot: 'ranged', title: 'Лук', rarity: 'common', icon: 'bow', description: 'Простой лук из гибкого тиса.', ranged: { dmg: 8, cd: 0.55, speed: 26, range: 20, knock: 0.3 } },
  { id: 'longbow', slot: 'ranged', title: 'Длинный лук', rarity: 'rare', icon: 'longbow', description: 'Стрелы летят дальше и бьют сильнее, но тетиву тянуть дольше.', ranged: { dmg: 14, cd: 0.85, speed: 34, range: 28, knock: 0.5 } },
  { id: 'crossbow', slot: 'ranged', title: 'Арбалет', rarity: 'common', icon: 'crossbow', description: 'Тяжёлый болт сбивает с ног.', ranged: { dmg: 12, cd: 0.95, speed: 30, range: 22, knock: 1.2 } },
  { id: 'twinbow', slot: 'ranged', title: 'Звёздный лук', rarity: 'unique', icon: 'starbow', description: 'Каждый выстрел — веер из трёх светящихся стрел.', ranged: { dmg: 7, cd: 0.6, speed: 30, range: 22, shots: 3, knock: 0.3 } },
  // броня
  { id: 'tunic', slot: 'armor', title: 'Куртка странника', rarity: 'common', icon: 'tunic', description: 'Тёплая, удобная и с карманом для малины.', armor: { health: 20, perks: [{ kind: 'potion', value: 25 }] } },
  { id: 'soulrobe', slot: 'armor', title: 'Роба душ', rarity: 'common', icon: 'soulrobe', description: 'В особом свете души, вплетённые в ткань, мерцают силой.', armor: { health: 30, perks: [{ kind: 'souls', value: 50 }, { kind: 'artifactDmg', value: 50 }] } },
  { id: 'wolf', slot: 'armor', title: 'Волчья броня', rarity: 'common', icon: 'wolf', description: 'Шкура старого вожака всё ещё помнит лес.', armor: { health: 35, perks: [{ kind: 'potion', value: 50 }] } },
  { id: 'mercenary', slot: 'armor', title: 'Доспех наёмника', rarity: 'common', icon: 'mercenary', description: 'Плотная кожа с заклёпками, проверенная в сотне стычек.', armor: { health: 40, perks: [{ kind: 'meleeDmg', value: 15 }] } },
  { id: 'scale', slot: 'armor', title: 'Чешуйчатый доспех', rarity: 'rare', icon: 'scale', description: 'Тысяча пластин звенит на каждом шагу.', armor: { health: 50, perks: [{ kind: 'meleeDmg', value: 20 }, { kind: 'roll', value: 25 }] } },
  { id: 'champion', slot: 'armor', title: 'Доспех чемпиона', rarity: 'unique', icon: 'champion', description: 'Сияющие латы того, кто выстоял на арене сто дней.', armor: { health: 65, perks: [{ kind: 'cooldown', value: 25 }, { kind: 'arrows', value: 10 }, { kind: 'meleeDmg', value: 10 }] } },
  // артефакты
  { id: 'firework', slot: 'artifact', title: 'Огненная стрела', rarity: 'common', icon: 'firework', description: 'Ракета летит к курсору и взрывается снопом искр.', artifact: A('firework', 9, 30, { radius: 3 }) },
  { id: 'totem', slot: 'artifact', title: 'Тотем исцеления', rarity: 'common', icon: 'totem', description: 'Ставит тотем, который лечит всех рядом.', artifact: A('totem', 22, 6, { radius: 3.5, duration: 8 }) },
  { id: 'boots', slot: 'artifact', title: 'Сапоги скорости', rarity: 'common', icon: 'boots', description: 'Короткий рывок скорости.', artifact: A('boots', 4, 1.6, { duration: 2 }) },
  { id: 'horn', slot: 'artifact', title: 'Рог ветра', rarity: 'rare', icon: 'horn', description: 'Порыв ветра отбрасывает всех вокруг.', artifact: A('horn', 8, 6, { radius: 5 }) },
  { id: 'lightning', slot: 'artifact', title: 'Молниевый куб', rarity: 'rare', icon: 'lightning', description: 'Молния бьёт по трём ближайшим врагам.', artifact: A('lightning', 12, 28, { radius: 9 }) },
  { id: 'harvester', slot: 'artifact', title: 'Жнец душ', rarity: 'unique', icon: 'harvester', description: 'Высвобождает собранные души взрывом вокруг героя.', artifact: A('harvester', 3, 45, { radius: 4, souls: 40 }) },
];

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
  slot: Exclude<ItemSlot, 'artifact'>;
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
  if (def.slot === 'artifact') return [];
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
    this.data = data ?? Profile.load() ?? Profile.starter();
    this.rand = rng(hash(String(this.data.seq)) || 1);
  }

  /** Стартовый набор: экипировка новичка и сундук трофеев, чтобы было что примерить и зачаровать */
  static starter(): ProfileData {
    const p = new Profile({ version: 1, level: 1, xp: 0, points: 3, berries: 0, souls: 0, arrows: 40, seq: 0, items: [], equip: { melee: null, ranged: null, armor: null, artifacts: [null, null, null] } }, false);
    const eq = (def: string, power: number): string => p.add(def, power, false).uid;
    p.data.equip = { melee: eq('sword', 1), armor: eq('tunic', 1), ranged: eq('bow', 1), artifacts: [eq('firework', 1), eq('totem', 1), null] };
    for (const [def, power] of [
      ['claymore', 3], ['axe', 2], ['dagger', 2], ['hammer', 3], ['scythe', 4], ['mace', 1], ['spear', 2],
      ['crossbow', 2], ['longbow', 3], ['twinbow', 4],
      ['soulrobe', 2], ['wolf', 2], ['mercenary', 1], ['scale', 3], ['champion', 4],
      ['boots', 2], ['horn', 2], ['lightning', 3], ['harvester', 3],
    ] as [string, number][]) p.add(def, power, false);
    return p.data;
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
  rollLoot(r: Rand = this.rand): { def: string; power: number } {
    const x = r();
    const rarity: Rarity = x < 0.06 ? 'unique' : x < 0.32 ? 'rare' : 'common';
    const pool = ITEMS.filter((d) => d.rarity === rarity);
    return { def: pool[Math.floor(r() * pool.length)].id, power: Math.max(1, this.power + Math.floor(r() * 3) - 1) };
  }

  equipped(slot: 'melee' | 'ranged' | 'armor'): Item | null { return this.get(this.data.equip[slot]); }
  artifacts(): (Item | null)[] { return this.data.equip.artifacts.map((u) => this.get(u)); }

  isEquipped(uid: string): boolean {
    const e = this.data.equip;
    return e.melee === uid || e.ranged === uid || e.armor === uid || e.artifacts.includes(uid);
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
    } else e[slot] = uid;
    it.isNew = false;
    this.save();
    return true;
  }

  /** Снять артефакт из гнезда (оружие и броню снять нельзя — только заменить) */
  unequipArtifact(i: number): void { this.data.equip.artifacts[i] = null; this.save(); }

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
