import { enchantDef, type EnchantId, type Item } from './items';
import type { WeaponCategory } from './weapons';

/**
 * Закалка оружия (wiki/design-weapon-arts.md): зачарования ближнего боя меняют, как выглядит и бьёт оружие.
 * Каждое из восьми — свой цвет клинка, шлейф, искры у лезвия и эффект попадания; каждая пара — именная синергия,
 * которая срабатывает на добивающем и на спец-ударе; три сразу — «резонанс» из трёх синергий.
 * Спец-удар (Q) у каждого вида оружия свой, шкала копится попаданиями.
 * Здесь только данные — без three: эффекты рисует src/weapon-arts.ts, карточку — src/hud/inventory.ts.
 */

export type MeleeEnchant = 'sharpness' | 'critical' | 'leeching' | 'knockback' | 'swirling' | 'fireAspect' | 'soulSiphon' | 'smiting';
export const MELEE_ENCHANTS: readonly MeleeEnchant[] = ['sharpness', 'critical', 'leeching', 'knockback', 'swirling', 'fireAspect', 'soulSiphon', 'smiting'];

export interface TemperLook {
  /** Как зовут закалку на клинке */
  name: string;
  /** HDR-цвет шлейфа и свечения (больше 1 — для bloom; слабые составляющие ниже 1, иначе bloom выжигает в белый) */
  rgb: readonly [number, number, number];
  /** Что сыплется с клинка */
  spark: string;
  /** Что видно при попадании */
  hit: string;
}

export const TEMPER_LOOK: Record<MeleeEnchant, TemperLook> = {
  sharpness: { name: 'Ледяная сталь', rgb: [0.9, 1.9, 2.8], spark: 'белые блёстки', hit: 'крест-накрест разрез' },
  critical: { name: 'Звёздная', rgb: [2.8, 1.9, 0.3], spark: 'золотые звёздочки', hit: 'звезда, крит — лучи и вспышка' },
  leeching: { name: 'Багровая', rgb: [2.8, 0.25, 0.45], spark: 'алые капли', hit: 'капли летят к герою' },
  knockback: { name: 'Ураганная', rgb: [2.4, 1.5, 0.6], spark: 'пыль', hit: 'волна воздуха и пыль' },
  swirling: { name: 'Вихревая', rgb: [0.3, 2.6, 1.9], spark: 'бирюзовые завитки', hit: 'бирюзовый завиток вокруг цели' },
  fireAspect: { name: 'Огненная', rgb: [2.8, 0.8, 0.12], spark: 'угольки', hit: 'пламя и горящие кубики' },
  soulSiphon: { name: 'Призрачная', rgb: [0.35, 1.9, 2.8], spark: 'огоньки душ', hit: 'душа летит к герою' },
  smiting: { name: 'Грозовая', rgb: [1.7, 0.5, 2.8], spark: 'фиолетовые разряды', hit: 'разряд молнии' },
};

/** Синергия пары зачарований: срабатывает на добивающем ударе и на спец-ударе */
export interface Synergy {
  id: string;
  pair: readonly [MeleeEnchant, MeleeEnchant];
  title: string;
  text: string;
}

const S = (id: string, a: MeleeEnchant, b: MeleeEnchant, title: string, text: string): Synergy => ({ id, pair: [a, b], title, text });

/** 28 пар из восьми зачарований — у каждой свой эффект (src/weapon-arts.ts, SYNERGY_FX) */
export const SYNERGIES: readonly Synergy[] = [
  S('starCross', 'sharpness', 'critical', 'Звёздный разрез', 'Четыре лезвия света крест-накрест режут всё на 3,5 м'),
  S('bleed', 'sharpness', 'leeching', 'Кровавый порез', 'Задетые кровоточат 1,2 с, каждая капля лечит героя'),
  S('windBlade', 'sharpness', 'knockback', 'Воздушный клинок', 'Вперёд летит серп ветра: режет и отбрасывает на 9 м'),
  S('bladeOrbit', 'sharpness', 'swirling', 'Стальной смерч', 'Пять клинков 2 с кружат вокруг героя и режут касанием'),
  S('fireLine', 'sharpness', 'fireAspect', 'Огненный разрез', 'Разрез поджигает землю перед героем на 6 м'),
  S('phantomEcho', 'sharpness', 'soulSiphon', 'Призрачное эхо', 'Призрачная копия оружия повторяет удар'),
  S('skySword', 'sharpness', 'smiting', 'Небесный меч', 'С неба падает огромный клинок и взрывается'),
  S('heartStar', 'critical', 'leeching', 'Сердце звезды', 'Лечит героя, три следующих удара — критические'),
  S('cometKick', 'critical', 'knockback', 'Кометный пинок', 'Цель улетает кометой и взрывается звездой'),
  S('starSpiral', 'critical', 'swirling', 'Звёздная спираль', 'Восемь звёзд разлетаются спиралью'),
  S('supernova', 'critical', 'fireAspect', 'Сверхновая', 'Золотой огненный взрыв в точке удара'),
  S('starfall', 'critical', 'soulSiphon', 'Звездопад', 'Пять звёзд падают вокруг, каждая дарит душу'),
  S('wrath', 'critical', 'smiting', 'Гнев небес', 'Золотая молния прыгает по пяти целям'),
  S('bloodRam', 'leeching', 'knockback', 'Кровавый таран', 'Волна вперёд отбрасывает и лечит за каждого задетого'),
  S('crimsonVortex', 'leeching', 'swirling', 'Багровый водоворот', 'Водоворот 1,5 с стягивает врагов и пьёт их силы'),
  S('lifeFlame', 'leeching', 'fireAspect', 'Пламя жизни', 'Огненное кольцо вокруг героя жжёт врагов и лечит'),
  S('harvest', 'leeching', 'soulSiphon', 'Жатва жизни', 'Все рядом отдают герою здоровье и души'),
  S('bloodBolt', 'leeching', 'smiting', 'Багровая молния', 'Алые молнии бьют в три цели и лечат'),
  S('tornado', 'knockback', 'swirling', 'Ураган', 'Смерч идёт вперёд, затягивает и подбрасывает'),
  S('flameRam', 'knockback', 'fireAspect', 'Огненный таран', 'Конус пламени отбрасывает и поджигает'),
  S('spiritFist', 'knockback', 'soulSiphon', 'Кулак духа', 'Призрачный кулак летит вперёд и взрывается'),
  S('thunderclap', 'knockback', 'smiting', 'Раскат грома', 'Молния в землю и двойная волна'),
  S('fireTornado', 'swirling', 'fireAspect', 'Огненный смерч', 'Пламя 2 с кружит вокруг героя'),
  S('soulWheel', 'swirling', 'soulSiphon', 'Колесо душ', 'Шесть душ кружат и летят в ближайших врагов'),
  S('stormRing', 'swirling', 'smiting', 'Грозовое кольцо', 'Молнии бьют по кругу вокруг героя'),
  S('blueFlame', 'fireAspect', 'soulSiphon', 'Синее пламя', 'Призрачный огонь жжёт 2 с и вытягивает души'),
  S('meteor', 'fireAspect', 'smiting', 'Метеор', 'С неба падает огненный метеор'),
  S('spiritChain', 'soulSiphon', 'smiting', 'Призрачная цепь', 'Голубая молния прыгает по шести целям, каждая — душа'),
];

export const synergyOf = (a: MeleeEnchant, b: MeleeEnchant): Synergy => {
  const s = SYNERGIES.find((x) => (x.pair[0] === a && x.pair[1] === b) || (x.pair[0] === b && x.pair[1] === a));
  if (!s) throw new Error(`Нет синергии ${a} + ${b}`);
  return s;
};

/** Закалка на клинке: зачарование и его ступень 1..3 */
export interface TemperSlot { id: MeleeEnchant; tier: number }

const isMelee = (id: EnchantId): id is MeleeEnchant => (MELEE_ENCHANTS as readonly string[]).includes(id);

/** Выбранные и вкачанные зачарования ближнего оружия по порядку гнёзд, без повторов */
export function temperOf(it: Item | null | undefined): TemperSlot[] {
  const out: TemperSlot[] = [];
  if (!it) return out;
  for (const s of it.enchants) {
    if (s.chosen < 0 || s.tier <= 0) continue;
    const id = s.options[s.chosen];
    if (!isMelee(id) || enchantDef(id).slot !== 'melee') continue;
    const had = out.find((o) => o.id === id);
    if (had) had.tier = Math.max(had.tier, s.tier); else out.push({ id, tier: s.tier });
  }
  return out;
}

/** Синергии закалки: одна на пару, у трёх зачарований — три (резонанс) */
export function synergiesOf(t: readonly TemperSlot[]): Synergy[] {
  const out: Synergy[] = [];
  for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) out.push(synergyOf(t[i].id, t[j].id));
  return out;
}

export const RESONANCE = { title: 'Резонанс', text: 'Три закалки сразу: на добивающем срабатывают все три синергии и тройное кольцо' };

/** Спец-удар (Q) вида оружия */
export interface WeaponSpecial { title: string; text: string }

export const WEAPON_SPECIAL: Record<WeaponCategory, WeaponSpecial> = {
  'меч': { title: 'Вихрь клинка', text: 'Два оборота с вытянутым клинком: четыре удара по всем вокруг, можно идти' },
  'топор': { title: 'Бумеранг', text: 'Топор летит вперёд на 8 м, крутясь, и возвращается — режет всех на пути туда и обратно' },
  'булава': { title: 'Тройная волна', text: 'Удар о землю: три волны одна за другой, всё дальше и сильнее отбрасывают' },
  'кинжал': { title: 'Шаг тени', text: 'Рывок сквозь врагов на 6 м, неуязвим; все на пути получают три быстрых разреза' },
  'копьё': { title: 'Пронзающий рывок', text: 'Выпад на 5 м: копьё пробивает всех на линии и расталкивает их в стороны' },
  'молот': { title: 'Удар земли', text: 'Прыжок и удар о землю: огромная волна, из земли вылетают камни' },
  'посох': { title: 'Звёздная волна', text: 'Серп силы летит вперёд на 10 м и пробивает всех' },
  'коса': { title: 'Жатва душ', text: 'Широкий оборот: стягивает врагов к герою, каждый задетый отдаёт душу' },
  'катана': { title: 'Иайдо', text: 'Клинок в ножнах, миг тишины — и мгновенный разрез с шагом вперёд: все в широкой дуге рассечены разом' },
  'великий меч': { title: 'Ярость берсерка', text: 'Три тяжёлых оборота с вытянутым клинком: пять сокрушительных ударов и багровая волна' },
  'парные клинки': { title: 'Танец понтифика', text: 'Восемь ударов пламенем и светом по очереди, в конце — клинки крест-накрест и взрыв' },
  'алебарда': { title: 'Мельница', text: 'Два с половиной оборота с шагом вперёд на 4 м: древко сметает всех вокруг' },
  'рапира': { title: 'Шквал уколов', text: 'Семь уколов вперёд за миг и последний — пробивающий, с отбрасыванием' },
  'кастеты': { title: 'Град ударов', text: 'Восемь ударов кулаками и апперкот: волна подбрасывает всех вокруг' },
};

/** Сколько ударов, попавших по цели, наполняют шкалу спец-удара */
export const SPECIAL_HITS = 8;
