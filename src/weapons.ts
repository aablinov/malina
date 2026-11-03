import * as THREE from 'three';
import { pixelTex } from './textures.ts';
import { SWORD, type SwingTuning } from './tuning.ts';

/**
 * Оружие ближнего боя: реестр, модели из блоков, баланс.
 * Модель — коробки в системе кисти героя (как меч в knight.ts): рукоять в начале координат, клинок вдоль +Z,
 * широкая сторона клинка — по Y. Боёк топора и молота, лезвие косы смотрят в −Y: в стойке — вперёд-вниз, в добивающем бьёт первым. Числа удара пишутся в изменяемый SWORD (tuning.ts) — их и читает игра.
 * Правки из редактора хранятся в localStorage поверх стандартных (по id).
 */

export type WeaponCategory = 'меч' | 'топор' | 'булава' | 'кинжал' | 'копьё' | 'молот' | 'посох' | 'коса'
  | 'катана' | 'великий меч' | 'парные клинки' | 'алебарда' | 'рапира' | 'кастеты';
export type WeaponRarity = 'обычное' | 'редкое' | 'уникальное';

export const CATEGORIES: readonly WeaponCategory[] = ['меч', 'топор', 'булава', 'кинжал', 'копьё', 'молот', 'посох', 'коса', 'катана', 'великий меч', 'парные клинки', 'алебарда', 'рапира', 'кастеты'];
export const RARITIES: readonly WeaponRarity[] = ['обычное', 'редкое', 'уникальное'];
/** Цвет редкости, как в Minecraft Dungeons */
export const RARITY_COLOR: Record<WeaponRarity, string> = { 'обычное': '#c9cbd0', 'редкое': '#45d39a', 'уникальное': '#f5a524' };

/** Деталь модели: коробка w×h×d с центром (x, y, z), м */
export interface WeaponPart {
  name?: string;
  w: number; h: number; d: number;
  x: number; y: number; z: number;
  color: string;
  /** Своё свечение (Lambert) и его сила */
  emissive?: string;
  ei?: number;
  /** Светится сама, без света: цвет × glow (больше 1 — ярко, для bloom) */
  glow?: number;
  /** Без пиксельной текстуры — ровный цвет */
  flat?: boolean;
}

export interface WeaponStats {
  /** Нажатие ещё успевает продолжить комбо после конца удара, с */
  comboWindow: number;
  /** С какой доли удара можно начать следующий */
  chainFrom: number;
  /** Пауза после добивающего, с */
  finisherCd: number;
  /** Заминка при попадании, с */
  hitStop: number;
  /** Радиус ударной волны добивающего, м */
  shockR: number;
  /** Ровно три удара: слева, справа, добивающий */
  swings: SwingTuning[];
  /** Шанс крита 0..1 и множитель урона (пока только в балансе) */
  critChance: number;
  critMult: number;
  /** Скорость атаки: длительности ударов делятся на неё */
  speed: number;
  /** Вес, кг (для описания и будущего замедления) */
  weight: number;
}

export interface WeaponDef {
  id: string;
  title: string;
  category: WeaponCategory;
  rarity: WeaponRarity;
  description: string;
  model: WeaponPart[];
  /** След клинка: от base до tip по Z кисти; без них — 0,22 и дальний край модели */
  bladeBase?: number;
  bladeTip?: number;
  /** Второе оружие в левой руке (парные клинки, кастеты): та же система кисти, свой след */
  offhand?: WeaponPart[];
  /** Свой цвет следа без закалки (пламя, звёздный свет); у второго оружия — offTrail */
  trail?: string;
  offTrail?: string;
  stats: WeaponStats;
}

const sw = (dmg: number, time: number, windup: number, strike: number, range: number, arc: number, lunge: number, knock: number): SwingTuning =>
  ({ dmg, time, windup, strike, range, arc, lunge, knock });
const part = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, color: string, more: Partial<WeaponPart> = {}): WeaponPart =>
  ({ name, w, h, d, x, y, z, color, ...more });
const GOLD = { emissive: '#f2a020', ei: 0.25, flat: true };

/** Стандартное оружие. Первый — меч героя с прежними числами SWORD */
export const DEFAULT_WEAPONS: readonly WeaponDef[] = [
  {
    id: 'sword', title: 'Меч стража', category: 'меч', rarity: 'обычное',
    description: 'Надёжный меч героя: быстрые удары слева и справа, добивающий сверху с ударной волной.',
    bladeBase: 0.22, bladeTip: 1.19,
    model: [
      part('Рукоять', 0.07, 0.07, 0.24, 0, 0, 0.02, '#5a3a22'),
      part('Навершие', 0.1, 0.1, 0.1, 0, 0, -0.14, '#ff2a5d', { glow: 3 }),
      part('Гарда', 0.36, 0.08, 0.09, 0, 0, 0.17, '#f2c040', GOLD),
      part('Клинок', 0.06, 0.15, 0.95, 0, 0, 0.675, '#dfe8f2', { emissive: '#7ad8ff', ei: 0.18 }),
      part('Лезвие', 0.025, 0.17, 0.87, 0, 0, 0.655, '#9dd8ff', { glow: 2.6 }),
      part('Кончик', 0.05, 0.08, 0.08, 0, 0, 1.19, '#dfe8f2', { emissive: '#7ad8ff', ei: 0.18 }),
    ],
    stats: {
      comboWindow: 0.35, chainFrom: 0.62, finisherCd: 0.22, hitStop: 0.055, shockR: 2.4,
      swings: [sw(10, 0.36, 0.22, 0.3, 2.1, 160, 0.35, 0.6), sw(12, 0.36, 0.2, 0.3, 2.1, 160, 0.35, 0.6), sw(24, 0.56, 0.36, 0.2, 2.5, 90, 0.7, 1.6)],
      critChance: 0.05, critMult: 1.5, speed: 1, weight: 2.5,
    },
  },
  {
    id: 'axe', title: 'Топор лесоруба', category: 'топор', rarity: 'обычное',
    description: 'Тяжёлые широкие рубящие удары вблизи. Медленнее меча, но сильнее отбрасывает.',
    bladeBase: 0.45, bladeTip: 0.8,
    model: [
      part('Топорище', 0.07, 0.07, 0.9, 0, 0, 0.3, '#7a5230'),
      part('Обмотка', 0.08, 0.08, 0.16, 0, 0, 0, '#3d2616'),
      part('Обух', 0.09, 0.1, 0.12, 0, 0.07, 0.62, '#8e97a3'),
      part('Щека', 0.1, 0.26, 0.22, 0, -0.14, 0.62, '#c9d2dc', { emissive: '#9ac8ff', ei: 0.1 }),
      part('Лезвие', 0.04, 0.06, 0.36, 0, -0.3, 0.62, '#bfe2ff', { glow: 2.2 }),
      part('Колпачок', 0.09, 0.09, 0.06, 0, 0, 0.77, '#f2c040', GOLD),
    ],
    stats: {
      comboWindow: 0.4, chainFrom: 0.65, finisherCd: 0.3, hitStop: 0.07, shockR: 2.2,
      swings: [sw(13, 0.46, 0.26, 0.28, 1.9, 180, 0.3, 0.9), sw(15, 0.46, 0.24, 0.28, 1.9, 180, 0.3, 0.9), sw(30, 0.7, 0.4, 0.2, 2.2, 120, 0.6, 2.0)],
      critChance: 0.05, critMult: 1.5, speed: 1, weight: 4,
    },
  },
  {
    id: 'claymore', title: 'Клеймор', category: 'меч', rarity: 'редкое',
    description: 'Двуручный меч: самые длинные взмахи, широкая волна. Медленный — держи врагов на расстоянии.',
    bladeBase: 0.34, bladeTip: 1.72,
    model: [
      part('Рукоять', 0.08, 0.08, 0.4, 0, 0, 0.05, '#4a2e1a'),
      part('Навершие', 0.12, 0.12, 0.12, 0, 0, -0.2, '#f2c040', GOLD),
      part('Гарда', 0.5, 0.1, 0.1, 0, 0, 0.28, '#c9a030', GOLD),
      part('Пята', 0.08, 0.12, 0.14, 0, 0, 0.4, '#a8b0bc'),
      part('Клинок', 0.07, 0.2, 1.35, 0, 0, 1.005, '#d0d8e4', { emissive: '#8ab8ff', ei: 0.12 }),
      part('Лезвие', 0.03, 0.22, 1.25, 0, 0, 0.98, '#a8c8ff', { glow: 2 }),
      part('Кончик', 0.06, 0.1, 0.1, 0, 0, 1.72, '#d0d8e4', { emissive: '#8ab8ff', ei: 0.12 }),
    ],
    stats: {
      comboWindow: 0.42, chainFrom: 0.68, finisherCd: 0.35, hitStop: 0.075, shockR: 3,
      swings: [sw(16, 0.6, 0.3, 0.26, 2.8, 170, 0.4, 1.0), sw(18, 0.6, 0.28, 0.26, 2.8, 170, 0.4, 1.0), sw(38, 0.85, 0.42, 0.18, 3.1, 100, 0.8, 2.2)],
      critChance: 0.08, critMult: 1.6, speed: 1, weight: 6,
    },
  },
  {
    id: 'dagger', title: 'Кинжал тени', category: 'кинжал', rarity: 'редкое',
    description: 'Короткий и быстрый: шквал уколов вплотную и частые криты. Мала дальность — подходи ближе.',
    bladeBase: 0.14, bladeTip: 0.55,
    model: [
      part('Рукоять', 0.06, 0.06, 0.16, 0, 0, 0, '#2b2b33'),
      part('Навершие', 0.07, 0.07, 0.07, 0, 0, -0.11, '#9b5cff', { glow: 2.5 }),
      part('Гарда', 0.2, 0.05, 0.06, 0, 0, 0.1, '#7b3fbf', { emissive: '#7b3fbf', ei: 0.3, flat: true }),
      part('Клинок', 0.04, 0.1, 0.4, 0, 0, 0.33, '#e6e9f0', { emissive: '#c08aff', ei: 0.2 }),
      part('Лезвие', 0.02, 0.11, 0.36, 0, 0, 0.32, '#c79bff', { glow: 2.4 }),
      part('Кончик', 0.03, 0.05, 0.05, 0, 0, 0.55, '#e6e9f0', { emissive: '#c08aff', ei: 0.2 }),
    ],
    stats: {
      comboWindow: 0.3, chainFrom: 0.55, finisherCd: 0.15, hitStop: 0.035, shockR: 1.6,
      swings: [sw(6, 0.24, 0.18, 0.32, 1.6, 120, 0.3, 0.3), sw(6, 0.24, 0.16, 0.32, 1.6, 120, 0.3, 0.3), sw(14, 0.4, 0.3, 0.22, 1.8, 70, 0.6, 0.9)],
      critChance: 0.25, critMult: 2, speed: 1, weight: 0.8,
    },
  },
  {
    id: 'mace', title: 'Булава', category: 'булава', rarity: 'обычное',
    description: 'Шипастая булава: сильное отбрасывание и большая ударная волна у добивающего.',
    bladeBase: 0.48, bladeTip: 0.8,
    model: [
      part('Рукоять', 0.07, 0.07, 0.6, 0, 0, 0.14, '#6b4a2c'),
      part('Обмотка', 0.08, 0.08, 0.16, 0, 0, -0.02, '#3d2616'),
      part('Навершие', 0.1, 0.1, 0.08, 0, 0, -0.16, '#f2c040', GOLD),
      part('Воротник', 0.12, 0.12, 0.06, 0, 0, 0.46, '#f2c040', GOLD),
      part('Шар', 0.26, 0.26, 0.26, 0, 0, 0.62, '#8f98a6', { emissive: '#ffb066', ei: 0.06 }),
      part('Шип ←', 0.08, 0.08, 0.08, 0.16, 0, 0.62, '#b5bcc6'),
      part('Шип →', 0.08, 0.08, 0.08, -0.16, 0, 0.62, '#b5bcc6'),
      part('Шип ↑', 0.08, 0.08, 0.08, 0, 0.16, 0.62, '#b5bcc6'),
      part('Шип ↓', 0.08, 0.08, 0.08, 0, -0.16, 0.62, '#b5bcc6'),
      part('Шип вперёд', 0.08, 0.08, 0.08, 0, 0, 0.79, '#b5bcc6'),
    ],
    stats: {
      comboWindow: 0.38, chainFrom: 0.64, finisherCd: 0.28, hitStop: 0.075, shockR: 2.8,
      swings: [sw(12, 0.44, 0.24, 0.28, 1.9, 140, 0.3, 1.2), sw(13, 0.44, 0.22, 0.28, 1.9, 140, 0.3, 1.2), sw(28, 0.62, 0.38, 0.2, 2.1, 100, 0.55, 2.4)],
      critChance: 0.1, critMult: 1.5, speed: 1, weight: 3.5,
    },
  },
  {
    id: 'spear', title: 'Копьё', category: 'копьё', rarity: 'обычное',
    description: 'Длинные узкие выпады: бьёт дальше всех, но в узкую дугу. Добивающий — рывок вперёд.',
    bladeBase: 1.26, bladeTip: 1.62,
    model: [
      part('Древко', 0.06, 0.06, 1.7, 0, 0, 0.35, '#8a6038'),
      part('Обмотка', 0.07, 0.07, 0.12, 0, 0, 0, '#c03a3a'),
      part('Обмотка 2', 0.07, 0.07, 0.1, 0, 0, 0.92, '#c03a3a'),
      part('Подток', 0.08, 0.08, 0.06, 0, 0, -0.52, '#f2c040', GOLD),
      part('Воротник', 0.09, 0.09, 0.08, 0, 0, 1.22, '#f2c040', GOLD),
      part('Наконечник', 0.05, 0.16, 0.32, 0, 0, 1.42, '#dfe8f2', { emissive: '#7ad8ff', ei: 0.15 }),
      part('Лезвие', 0.02, 0.18, 0.28, 0, 0, 1.42, '#9dd8ff', { glow: 2.2 }),
      part('Остриё', 0.04, 0.07, 0.08, 0, 0, 1.6, '#dfe8f2', { emissive: '#7ad8ff', ei: 0.15 }),
    ],
    stats: {
      comboWindow: 0.36, chainFrom: 0.6, finisherCd: 0.25, hitStop: 0.05, shockR: 1.6,
      swings: [sw(11, 0.38, 0.24, 0.28, 3, 50, 0.6, 0.5), sw(11, 0.38, 0.22, 0.28, 3, 50, 0.6, 0.5), sw(26, 0.6, 0.36, 0.2, 3.4, 30, 1.2, 1.4)],
      critChance: 0.15, critMult: 1.6, speed: 1, weight: 3,
    },
  },
  {
    id: 'hammer', title: 'Великий молот', category: 'молот', rarity: 'редкое',
    description: 'Огромный молот: медленные сокрушительные удары и самая большая ударная волна.',
    bladeBase: 0.7, bladeTip: 1.07,
    model: [
      part('Рукоять', 0.08, 0.08, 1, 0, 0, 0.3, '#6e4a2a'),
      part('Обмотка', 0.09, 0.09, 0.22, 0, 0, 0, '#3a2414'),
      part('Навершие', 0.12, 0.12, 0.12, 0, 0, -0.24, '#8a8f99'),
      part('Боёк', 0.3, 0.5, 0.3, 0, 0, 0.92, '#8a8f99'),
      part('Обод ↓', 0.32, 0.06, 0.32, 0, -0.27, 0.92, '#b7bcc4'),
      part('Обод ↑', 0.32, 0.06, 0.32, 0, 0.27, 0.92, '#b7bcc4'),
      part('Руна', 0.02, 0.14, 0.14, 0.155, 0, 0.92, '#ffb347', { glow: 2.5 }),
      part('Руна 2', 0.02, 0.14, 0.14, -0.155, 0, 0.92, '#ffb347', { glow: 2.5 }),
    ],
    stats: {
      comboWindow: 0.45, chainFrom: 0.7, finisherCd: 0.45, hitStop: 0.09, shockR: 3.8,
      swings: [sw(18, 0.7, 0.34, 0.24, 2.2, 150, 0.3, 1.6), sw(20, 0.7, 0.32, 0.24, 2.2, 150, 0.3, 1.6), sw(48, 1.05, 0.46, 0.16, 2.4, 90, 0.5, 3)],
      critChance: 0.05, critMult: 1.8, speed: 1, weight: 9,
    },
  },
  {
    id: 'scythe', title: 'Коса жнеца', category: 'коса', rarity: 'уникальное',
    description: 'Светящаяся коса: очень широкие взмахи, добивающий — круговой вихрь. Уникальное оружие.',
    bladeBase: 0.9, bladeTip: 1.16,
    model: [
      part('Древко', 0.06, 0.06, 1.4, 0, 0, 0.4, '#3b2a4a'),
      part('Обмотка', 0.07, 0.07, 0.16, 0, 0, 0, '#6a3fa0'),
      part('Подток', 0.08, 0.08, 0.06, 0, 0, -0.32, '#8a5cff', { glow: 2 }),
      part('Воротник', 0.1, 0.1, 0.08, 0, 0, 1.1, '#8a5cff', { emissive: '#8a5cff', ei: 0.4, flat: true }),
      part('Пята', 0.05, 0.14, 0.12, 0, -0.1, 1.12, '#cfc8e8', { emissive: '#a070ff', ei: 0.25 }),
      part('Полотно 1', 0.04, 0.2, 0.12, 0, -0.26, 1.08, '#cfc8e8', { emissive: '#a070ff', ei: 0.25 }),
      part('Полотно 2', 0.04, 0.2, 0.12, 0, -0.44, 1.0, '#cfc8e8', { emissive: '#a070ff', ei: 0.25 }),
      part('Полотно 3', 0.04, 0.16, 0.1, 0, -0.6, 0.9, '#cfc8e8', { emissive: '#a070ff', ei: 0.25 }),
      part('Остриё', 0.03, 0.1, 0.08, 0, -0.72, 0.8, '#cfc8e8', { emissive: '#a070ff', ei: 0.25 }),
      part('Лезвие 1', 0.02, 0.2, 0.03, 0, -0.26, 1.01, '#b98cff', { glow: 2.6 }),
      part('Лезвие 2', 0.02, 0.2, 0.03, 0, -0.44, 0.93, '#b98cff', { glow: 2.6 }),
      part('Лезвие 3', 0.02, 0.16, 0.03, 0, -0.6, 0.84, '#b98cff', { glow: 2.6 }),
    ],
    stats: {
      comboWindow: 0.38, chainFrom: 0.62, finisherCd: 0.25, hitStop: 0.05, shockR: 2.6,
      swings: [sw(12, 0.4, 0.24, 0.3, 2.6, 240, 0.3, 0.7), sw(12, 0.4, 0.22, 0.3, 2.6, 240, 0.3, 0.7), sw(28, 0.62, 0.34, 0.24, 2.4, 360, 0.2, 1.4)],
      critChance: 0.12, critMult: 1.8, speed: 1, weight: 3.2,
    },
  },
  // ---------- вторая партия (wiki/design-weapon-arts.md, раздел 1) ----------
  {
    id: 'katana', title: 'Катана', category: 'катана', rarity: 'редкое',
    description: 'Изогнутый клинок: быстрые длинные разрезы и выпад добивающего. Спец-удар — иайдо.',
    bladeBase: 0.3, bladeTip: 1.28,
    model: [
      part('Рукоять', 0.06, 0.07, 0.3, 0, 0, 0.02, '#2a2230'),
      part('Оплётка', 0.065, 0.075, 0.04, 0, 0, -0.06, '#c03a4a', { flat: true }),
      part('Оплётка 2', 0.065, 0.075, 0.04, 0, 0, 0.06, '#c03a4a', { flat: true }),
      part('Кашира', 0.07, 0.08, 0.04, 0, 0, -0.14, '#f2c040', GOLD),
      part('Цуба', 0.16, 0.16, 0.03, 0, 0, 0.19, '#2b2b33', { emissive: '#f2a020', ei: 0.1, flat: true }),
      part('Хабаки', 0.05, 0.1, 0.05, 0, 0, 0.23, '#f2c040', GOLD),
      part('Клинок 1', 0.035, 0.09, 0.26, 0, 0, 0.38, '#e6edf5', { emissive: '#bfe2ff', ei: 0.15 }),
      part('Клинок 2', 0.035, 0.085, 0.26, 0, 0.015, 0.63, '#e6edf5', { emissive: '#bfe2ff', ei: 0.15 }),
      part('Клинок 3', 0.035, 0.08, 0.26, 0, 0.035, 0.88, '#e6edf5', { emissive: '#bfe2ff', ei: 0.15 }),
      part('Клинок 4', 0.035, 0.07, 0.22, 0, 0.06, 1.11, '#e6edf5', { emissive: '#bfe2ff', ei: 0.15 }),
      part('Хамон', 0.02, 0.03, 0.92, 0, -0.04, 0.72, '#cfeaff', { glow: 2.2 }),
      part('Кончик', 0.03, 0.05, 0.08, 0, 0.075, 1.25, '#e6edf5', { emissive: '#bfe2ff', ei: 0.15 }),
    ],
    stats: {
      comboWindow: 0.32, chainFrom: 0.58, finisherCd: 0.18, hitStop: 0.045, shockR: 2,
      swings: [sw(11, 0.3, 0.2, 0.3, 2.3, 150, 0.45, 0.5), sw(11, 0.3, 0.18, 0.3, 2.3, 150, 0.45, 0.5), sw(26, 0.5, 0.32, 0.18, 2.6, 80, 0.9, 1.2)],
      critChance: 0.15, critMult: 1.8, speed: 1, weight: 1.6,
    },
  },
  {
    id: 'nagakiba', title: 'Нагакиба', category: 'катана', rarity: 'уникальное',
    description: 'Катана длиной с шест для сушки белья: двуручная, достаёт дальше копья и режет широкой дугой.',
    bladeBase: 0.5, bladeTip: 2.28,
    model: [
      part('Рукоять', 0.065, 0.075, 0.46, 0, 0, 0.05, '#1e1a26'),
      part('Оплётка', 0.07, 0.08, 0.05, 0, 0, -0.08, '#3a5ab8', { flat: true }),
      part('Оплётка 2', 0.07, 0.08, 0.05, 0, 0, 0.1, '#3a5ab8', { flat: true }),
      part('Кашира', 0.075, 0.085, 0.05, 0, 0, -0.2, '#c9d2dc'),
      part('Цуба', 0.2, 0.2, 0.035, 0, 0, 0.3, '#2b2b33', { emissive: '#7ad8ff', ei: 0.15, flat: true }),
      part('Хабаки', 0.055, 0.11, 0.06, 0, 0, 0.35, '#c9d2dc'),
      part('Клинок 1', 0.035, 0.09, 0.46, 0, 0, 0.6, '#e6edf5', { emissive: '#a8d8ff', ei: 0.15 }),
      part('Клинок 2', 0.035, 0.085, 0.46, 0, 0.02, 1.05, '#e6edf5', { emissive: '#a8d8ff', ei: 0.15 }),
      part('Клинок 3', 0.035, 0.08, 0.46, 0, 0.05, 1.5, '#e6edf5', { emissive: '#a8d8ff', ei: 0.15 }),
      part('Клинок 4', 0.035, 0.07, 0.4, 0, 0.09, 1.93, '#e6edf5', { emissive: '#a8d8ff', ei: 0.15 }),
      part('Хамон', 0.02, 0.03, 1.72, 0, -0.035, 1.25, '#bfe2ff', { glow: 2.3 }),
      part('Кончик', 0.03, 0.05, 0.1, 0, 0.12, 2.18, '#e6edf5', { emissive: '#a8d8ff', ei: 0.15 }),
    ],
    stats: {
      comboWindow: 0.38, chainFrom: 0.64, finisherCd: 0.28, hitStop: 0.06, shockR: 2.6,
      swings: [sw(15, 0.48, 0.24, 0.26, 3.3, 140, 0.4, 0.7), sw(15, 0.48, 0.22, 0.26, 3.3, 140, 0.4, 0.7), sw(34, 0.7, 0.36, 0.18, 3.6, 70, 0.9, 1.4)],
      critChance: 0.15, critMult: 1.8, speed: 1, weight: 4,
    },
  },
  {
    id: 'dragonslayer', title: 'Убийца драконов', category: 'великий меч', rarity: 'уникальное',
    description: 'Слишком большой, чтобы зваться мечом: кусок железа в рост героя. Медленный, но сносит всё перед собой.',
    bladeBase: 0.4, bladeTip: 2.05, trail: '#e8705a',
    model: [
      part('Рукоять', 0.08, 0.08, 0.44, 0, 0, 0.02, '#3a2a1e'),
      part('Обмотка', 0.09, 0.09, 0.08, 0, 0, -0.1, '#5a4030'),
      part('Навершие', 0.12, 0.12, 0.08, 0, 0, -0.22, '#4a4e56'),
      part('Гарда', 0.16, 0.42, 0.1, 0, 0, 0.26, '#4a4e56'),
      part('Клинок', 0.11, 0.36, 1.72, 0, 0, 1.17, '#6e737c', { emissive: '#3a1a10', ei: 0.15 }),
      part('Дол', 0.115, 0.06, 1.5, 0, 0.04, 1.12, '#4a4e56'),
      part('Зарубки', 0.116, 0.05, 0.2, 0, -0.16, 0.9, '#3a3e46'),
      part('Кромка', 0.03, 0.04, 1.6, 0, -0.19, 1.15, '#c9a090', { glow: 1.4 }),
      part('Кромка 2', 0.03, 0.04, 1.6, 0, 0.19, 1.15, '#c9a090', { glow: 1.4 }),
      part('Торец', 0.11, 0.36, 0.06, 0, 0, 2.06, '#5d626c'),
    ],
    stats: {
      comboWindow: 0.48, chainFrom: 0.72, finisherCd: 0.5, hitStop: 0.1, shockR: 3.6,
      swings: [sw(26, 0.85, 0.4, 0.22, 3, 200, 0.35, 2.2), sw(28, 0.85, 0.38, 0.22, 3, 200, 0.35, 2.2), sw(60, 1.2, 0.48, 0.16, 3.2, 120, 0.6, 3.4)],
      critChance: 0.08, critMult: 2, speed: 1, weight: 14,
    },
  },
  {
    id: 'pontiff', title: 'Клинки понтифика', category: 'парные клинки', rarity: 'уникальное',
    description: 'Два меча Понтифика Маливина: в правой — пламя, в левой — холодный звёздный свет. Шквал быстрых ударов обеими руками.',
    bladeBase: 0.2, bladeTip: 1.15, trail: '#ff6a1a', offTrail: '#8a6aff',
    model: [
      part('Рукоять', 0.06, 0.06, 0.22, 0, 0, 0.02, '#2a1a14'),
      part('Навершие', 0.08, 0.08, 0.08, 0, 0, -0.13, '#f2c040', GOLD),
      part('Гарда', 0.3, 0.07, 0.07, 0, 0, 0.16, '#8a2a1a', { emissive: '#ff5a1a', ei: 0.4, flat: true }),
      part('Клинок', 0.05, 0.12, 0.9, 0, 0, 0.65, '#ffd2a0', { emissive: '#ff7a2a', ei: 0.6 }),
      part('Пламя', 0.025, 0.14, 0.86, 0, 0, 0.64, '#ff6a1a', { glow: 3 }),
      part('Кончик', 0.04, 0.07, 0.07, 0, 0, 1.13, '#ffb060', { glow: 2.6 }),
    ],
    offhand: [
      part('Рукоять', 0.06, 0.06, 0.22, 0, 0, 0.02, '#1a1a2a'),
      part('Навершие', 0.08, 0.08, 0.08, 0, 0, -0.13, '#c9d2dc'),
      part('Гарда', 0.3, 0.07, 0.07, 0, 0, 0.16, '#3a2a8a', { emissive: '#8a5cff', ei: 0.4, flat: true }),
      part('Клинок', 0.05, 0.12, 0.9, 0, 0, 0.65, '#d8d0ff', { emissive: '#8a6aff', ei: 0.6 }),
      part('Свет', 0.025, 0.14, 0.86, 0, 0, 0.64, '#8a6aff', { glow: 3 }),
      part('Кончик', 0.04, 0.07, 0.07, 0, 0, 1.13, '#b8a8ff', { glow: 2.6 }),
    ],
    stats: {
      comboWindow: 0.32, chainFrom: 0.56, finisherCd: 0.18, hitStop: 0.04, shockR: 2.2,
      swings: [sw(9, 0.28, 0.18, 0.32, 2.0, 170, 0.35, 0.4), sw(9, 0.28, 0.16, 0.32, 2.0, 170, 0.35, 0.4), sw(22, 0.5, 0.3, 0.2, 2.3, 140, 0.6, 1.2)],
      critChance: 0.12, critMult: 1.6, speed: 1, weight: 3,
    },
  },
  {
    id: 'staff', title: 'Посох звездочёта', category: 'посох', rarity: 'редкое',
    description: 'Длинный посох с кристаллом: бьёт издалека, добивающий выпускает волну света. Спец-удар — звёздная волна.',
    bladeBase: 1.1, bladeTip: 1.5,
    model: [
      part('Древко', 0.06, 0.06, 1.6, 0, 0, 0.4, '#7a5230'),
      part('Обмотка', 0.07, 0.07, 0.14, 0, 0, 0, '#3a5ab8'),
      part('Подток', 0.08, 0.08, 0.06, 0, 0, -0.42, '#f2c040', GOLD),
      part('Оправа', 0.14, 0.14, 0.06, 0, 0, 1.2, '#f2c040', GOLD),
      part('Лапка ←', 0.03, 0.03, 0.22, 0.08, 0, 1.33, '#f2c040', GOLD),
      part('Лапка →', 0.03, 0.03, 0.22, -0.08, 0, 1.33, '#f2c040', GOLD),
      part('Кристалл', 0.12, 0.12, 0.24, 0, 0, 1.36, '#7ad8ff', { glow: 3 }),
      part('Звезда', 0.05, 0.05, 0.05, 0, 0, 1.52, '#fff2a0', { glow: 3.4 }),
    ],
    stats: {
      comboWindow: 0.38, chainFrom: 0.62, finisherCd: 0.25, hitStop: 0.05, shockR: 3,
      swings: [sw(10, 0.4, 0.24, 0.3, 2.6, 160, 0.3, 0.8), sw(10, 0.4, 0.22, 0.3, 2.6, 160, 0.3, 0.8), sw(24, 0.6, 0.36, 0.2, 2.8, 100, 0.5, 1.6)],
      critChance: 0.08, critMult: 1.6, speed: 1, weight: 2.2,
    },
  },
  {
    id: 'halberd', title: 'Алебарда стражи', category: 'алебарда', rarity: 'редкое',
    description: 'Топор на длинном древке с пикой: рубит издалека широкой дугой. Спец-удар — мельница с шагом вперёд.',
    bladeBase: 1.45, bladeTip: 2.0,
    model: [
      part('Древко', 0.065, 0.065, 2, 0, 0, 0.6, '#6e4a2a'),
      part('Обмотка', 0.075, 0.075, 0.16, 0, 0, 0, '#3a2414'),
      part('Подток', 0.08, 0.08, 0.08, 0, 0, -0.42, '#8a8f99'),
      part('Втулка', 0.1, 0.1, 0.14, 0, 0, 1.55, '#f2c040', GOLD),
      part('Лезвие', 0.05, 0.36, 0.38, 0, -0.22, 1.72, '#c9d2dc', { emissive: '#9ac8ff', ei: 0.1 }),
      part('Кромка', 0.02, 0.06, 0.4, 0, -0.42, 1.72, '#bfe2ff', { glow: 2.2 }),
      part('Клюв', 0.05, 0.16, 0.1, 0, 0.15, 1.72, '#8e97a3'),
      part('Пика', 0.05, 0.08, 0.36, 0, 0, 2.02, '#dfe8f2', { emissive: '#7ad8ff', ei: 0.15 }),
    ],
    stats: {
      comboWindow: 0.4, chainFrom: 0.66, finisherCd: 0.3, hitStop: 0.07, shockR: 2.6,
      swings: [sw(14, 0.5, 0.26, 0.28, 3.1, 120, 0.4, 1.1), sw(14, 0.5, 0.24, 0.28, 3.1, 120, 0.4, 1.1), sw(32, 0.72, 0.38, 0.2, 3.3, 90, 0.7, 2.0)],
      critChance: 0.08, critMult: 1.6, speed: 1, weight: 5,
    },
  },
  {
    id: 'rapier', title: 'Рапира дуэлянта', category: 'рапира', rarity: 'обычное',
    description: 'Тонкий длинный клинок: молниеносные уколы в узкий конус и частые криты. Спец-удар — шквал уколов.',
    bladeBase: 0.24, bladeTip: 1.26,
    model: [
      part('Рукоять', 0.05, 0.05, 0.2, 0, 0, 0, '#3a2a40'),
      part('Навершие', 0.07, 0.07, 0.07, 0, 0, -0.12, '#f2c040', GOLD),
      part('Чашка', 0.18, 0.18, 0.05, 0, 0, 0.13, '#f2c040', GOLD),
      part('Дужка', 0.03, 0.03, 0.16, 0, -0.1, 0.06, '#f2c040', GOLD),
      part('Клинок', 0.025, 0.04, 1.06, 0, 0, 0.7, '#e6edf5', { emissive: '#bfe2ff', ei: 0.2 }),
      part('Лезвие', 0.012, 0.045, 0.98, 0, 0, 0.7, '#cfeaff', { glow: 2.2 }),
    ],
    stats: {
      comboWindow: 0.3, chainFrom: 0.55, finisherCd: 0.15, hitStop: 0.035, shockR: 1.6,
      swings: [sw(8, 0.26, 0.2, 0.3, 2.6, 40, 0.5, 0.3), sw(8, 0.26, 0.18, 0.3, 2.6, 40, 0.5, 0.3), sw(20, 0.42, 0.3, 0.2, 2.9, 30, 1.0, 0.8)],
      critChance: 0.25, critMult: 2, speed: 1, weight: 1,
    },
  },
  {
    id: 'knuckles', title: 'Кастеты кузнеца', category: 'кастеты', rarity: 'обычное',
    description: 'По кастету на каждую руку: очень быстрые удары вплотную, добивающий — апперкот с волной.',
    bladeBase: 0.02, bladeTip: 0.2, trail: '#ffb347', offTrail: '#ffb347',
    model: [
      part('Обхват', 0.24, 0.16, 0.16, 0, 0, 0.06, '#8a8f99'),
      part('Костяшки', 0.26, 0.08, 0.08, 0, 0, 0.17, '#c9d2dc', { emissive: '#ffb347', ei: 0.3 }),
      part('Руна', 0.06, 0.04, 0.03, 0, 0, 0.22, '#ffb347', { glow: 2.6 }),
    ],
    offhand: [
      part('Обхват', 0.24, 0.16, 0.16, 0, 0, 0.06, '#8a8f99'),
      part('Костяшки', 0.26, 0.08, 0.08, 0, 0, 0.17, '#c9d2dc', { emissive: '#ffb347', ei: 0.3 }),
      part('Руна', 0.06, 0.04, 0.03, 0, 0, 0.22, '#ffb347', { glow: 2.6 }),
    ],
    stats: {
      comboWindow: 0.3, chainFrom: 0.52, finisherCd: 0.15, hitStop: 0.04, shockR: 2,
      swings: [sw(7, 0.22, 0.2, 0.3, 1.5, 110, 0.35, 0.6), sw(7, 0.22, 0.18, 0.3, 1.5, 110, 0.35, 0.6), sw(18, 0.42, 0.3, 0.2, 1.7, 90, 0.6, 1.8)],
      critChance: 0.1, critMult: 1.6, speed: 1, weight: 1.2,
    },
  },
];

// ---------- хранение ----------

const KEY = 'malina.weapons';
const KEY_ACTIVE = 'malina.weapon';
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
const defaultOf = (id: string): WeaponDef | undefined => DEFAULT_WEAPONS.find((w) => w.id === id);

/** Сохранённое поверх стандартного: недостающие поля берутся из стандартного (или из меча) */
function merge(saved: Partial<WeaponDef>, base: WeaponDef): WeaponDef {
  const st = { ...base.stats, ...(saved.stats ?? {}) } as WeaponStats;
  const sws = Array.isArray(saved.stats?.swings) ? saved.stats.swings : base.stats.swings;
  st.swings = [0, 1, 2].map((i) => ({ ...base.stats.swings[i], ...(sws[i] ?? {}) }));
  return { ...clone(base), ...saved, stats: clone(st), model: clone(Array.isArray(saved.model) ? saved.model : base.model) } as WeaponDef;
}

let cache: WeaponDef[] | null = null;

/** Все оружия: стандартные с правками и свои (дубликаты) */
export function loadWeapons(): WeaponDef[] {
  let saved: Record<string, Partial<WeaponDef>> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Partial<WeaponDef>>; } catch { /* нет хранилища */ }
  const list = DEFAULT_WEAPONS.map((d) => (saved[d.id] ? merge(saved[d.id], d) : clone(d)));
  for (const [id, w] of Object.entries(saved)) if (!defaultOf(id) && w) list.push(merge({ ...w, id }, DEFAULT_WEAPONS[0]));
  cache = list;
  return list;
}

/** Текущий список (загружается один раз) */
export function weapons(): WeaponDef[] { return cache ?? loadWeapons(); }

export function getWeapon(id: string): WeaponDef | undefined { return weapons().find((w) => w.id === id); }

export function isDefaultWeapon(id: string): boolean { return !!defaultOf(id); }

/** Сохранить отличия от стандартных и свои оружия */
export function saveWeapons(list: WeaponDef[] = weapons()): void {
  const out: Record<string, WeaponDef> = {};
  for (const w of list) {
    const d = defaultOf(w.id);
    if (!d || JSON.stringify(d) !== JSON.stringify(w)) out[w.id] = w;
  }
  try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* полное или закрытое хранилище */ }
  const act = getWeapon(activeWeaponId());
  if (act) emit(act);
}

/** Вернуть стандартные числа и модель; для своего оружия — ничего */
export function resetWeapon(id: string): WeaponDef | undefined {
  const d = defaultOf(id), list = weapons(), i = list.findIndex((w) => w.id === id);
  if (!d || i < 0) return list[i];
  list[i] = clone(d);
  saveWeapons(list);
  return list[i];
}

/** Копия с новым id сразу после исходного */
export function duplicateWeapon(id: string): WeaponDef | undefined {
  const list = weapons(), i = list.findIndex((w) => w.id === id);
  if (i < 0) return undefined;
  let n = 2, nid = `${id}-${n}`;
  while (list.some((w) => w.id === nid)) nid = `${id}-${++n}`;
  const w: WeaponDef = { ...clone(list[i]), id: nid, title: `${list[i].title} ${n}` };
  list.splice(i + 1, 0, w);
  saveWeapons(list);
  return w;
}

/** Удалить своё оружие (стандартные не удаляются) */
export function deleteWeapon(id: string): boolean {
  const list = weapons(), i = list.findIndex((w) => w.id === id);
  if (i < 0 || defaultOf(id)) return false;
  list.splice(i, 1);
  if (activeWeaponId() === id) setActiveWeapon(DEFAULT_WEAPONS[0].id);
  saveWeapons(list);
  return true;
}

export function activeWeaponId(): string {
  try { return localStorage.getItem(KEY_ACTIVE) ?? DEFAULT_WEAPONS[0].id; } catch { return DEFAULT_WEAPONS[0].id; }
}

export function setActiveWeapon(id: string): void {
  try { localStorage.setItem(KEY_ACTIVE, id); } catch { /* без хранилища — только в этой вкладке */ }
  const w = getWeapon(id);
  if (w) emit(w);
}

/** Оружие при запуске: ?weapon=<id>, иначе активное из хранилища, иначе меч */
export function pickWeapon(): WeaponDef {
  const q = new URLSearchParams(window.location.search).get('weapon');
  return (q && getWeapon(q)) || getWeapon(activeWeaponId()) || weapons()[0];
}

// ---------- подписка: активное оружие сменили или поправили (в этой вкладке или в другой) ----------

const listeners = new Set<(w: WeaponDef) => void>();
let storageHooked = false;
function emit(w: WeaponDef): void { for (const f of listeners) f(w); }

/** Активное оружие сменили или поправили; вернуть — отписка */
export function onWeaponChange(f: (w: WeaponDef) => void): () => void {
  listeners.add(f);
  if (!storageHooked) {
    storageHooked = true;
    window.addEventListener('storage', (e) => {
      if (e.key !== KEY && e.key !== KEY_ACTIVE) return;
      loadWeapons();
      const w = getWeapon(activeWeaponId());
      if (w) emit(w);
    });
  }
  return () => { listeners.delete(f); };
}

// ---------- игра ----------

/** Записать числа оружия в SWORD (или в числа удара другого героя, Knight.tune) — их читает герой и сцена */
export function applyWeapon(def: WeaponDef, into: typeof SWORD = SWORD): void {
  const s = def.stats, sp = s.speed > 0 ? s.speed : 1;
  into.comboWindow = s.comboWindow;
  into.chainFrom = s.chainFrom;
  into.finisherCd = s.finisherCd / sp;
  into.hitStop = s.hitStop;
  into.shockR = s.shockR;
  for (let i = 0; i < 3; i++) {
    const src = { ...s.swings[i], time: s.swings[i].time / sp };
    if (into.swings[i]) Object.assign(into.swings[i], src); else into.swings[i] = src;
  }
}

/** Отрезок следа клинка по Z кисти */
export function bladeOf(def: WeaponDef): { base: number; tip: number } {
  const far = def.model.reduce((m, p) => Math.max(m, p.z + p.d / 2), 0.4);
  return { base: def.bladeBase ?? 0.22, tip: def.bladeTip ?? far - 0.04 };
}

const texCache = new Map<string, THREE.CanvasTexture>();
function texOf(color: string): THREE.CanvasTexture {
  let t = texCache.get(color);
  if (!t) { t = pixelTex(color, 6, 78 + texCache.size); texCache.set(color, t); }
  return t;
}

function materialOf(p: WeaponPart): THREE.Material {
  if (p.glow) return new THREE.MeshBasicMaterial({ color: new THREE.Color(p.color).multiplyScalar(p.glow), toneMapped: false });
  const o: THREE.MeshLambertMaterialParameters = p.flat ? { color: p.color } : { map: texOf(p.color) };
  if (p.emissive) { o.emissive = p.emissive; o.emissiveIntensity = p.ei ?? 0.2; }
  return new THREE.MeshLambertMaterial(o);
}

/** Модель из коробок в системе кисти: рукоять в 0, клинок вдоль +Z; offhand — второе оружие (левая рука) */
export function buildWeaponModel(def: WeaponDef, offhand = false): THREE.Group {
  const g = new THREE.Group();
  g.name = def.id;
  for (const p of (offhand ? def.offhand : def.model) ?? []) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.d), materialOf(p));
    m.position.set(p.x, p.y, p.z);
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = p.name ?? '';
    g.add(m);
  }
  const b = offhand ? { base: def.bladeBase ?? 0.22, tip: (def.offhand ?? []).reduce((m, p) => Math.max(m, p.z + p.d / 2), 0.2) - 0.04 } : bladeOf(def);
  g.userData.bladeBase = b.base;
  g.userData.bladeTip = b.tip;
  return g;
}

/** Освободить геометрию и материалы модели (текстуры общие — остаются) */
export function disposeWeaponModel(o: THREE.Object3D): void {
  o.traverse((c) => {
    if (!(c instanceof THREE.Mesh)) return;
    c.geometry.dispose();
    for (const m of Array.isArray(c.material) ? c.material : [c.material]) (m as THREE.Material).dispose();
  });
}

// ---------- баланс ----------

export interface WeaponMetrics {
  /** Урон трёх ударов без крита */
  comboDmg: number;
  /** Цикл комбо при удержании: два удара до продолжения, добивающий целиком и пауза, с */
  comboTime: number;
  /** Средний множитель от критов */
  critFactor: number;
  /** Урон в секунду с учётом критов, по одной цели */
  dps: number;
  /** От нажатия до первого попадания, с */
  firstHit: number;
  /** Средняя и наибольшая (с выпадом) дальность, м */
  avgReach: number;
  maxReach: number;
  /** Средняя площадь удара (дуга × дальность; у добивающего — не меньше волны), м² */
  coverage: number;
  /** Площадь ударной волны, м² */
  shockArea: number;
  /** Сила в сравнении с мечом стража = 100 */
  score: number;
  /** Площадь и вклад в урон каждого удара */
  swings: { area: number; time: number; share: number }[];
}

function raw(def: WeaponDef): Omit<WeaponMetrics, 'score'> {
  const s = def.stats, sp = s.speed > 0 ? s.speed : 1, W = s.swings;
  const t = W.map((x) => x.time / sp);
  const comboTime = (t[0] + t[1]) * s.chainFrom + t[2] + s.finisherCd / sp;
  const comboDmg = W.reduce((a, x) => a + x.dmg, 0);
  const critFactor = 1 + s.critChance * (s.critMult - 1);
  const shockArea = Math.PI * s.shockR ** 2;
  const areas = W.map((x, i) => {
    const sector = 0.5 * x.range ** 2 * THREE.MathUtils.degToRad(x.arc);
    return i === 2 ? Math.max(sector, shockArea) : sector;
  });
  return {
    comboDmg, comboTime, critFactor, shockArea,
    dps: comboTime > 0 ? (comboDmg * critFactor) / comboTime : 0,
    firstHit: t[0] * (W[0].windup + W[0].strike / 2),
    avgReach: W.reduce((a, x) => a + x.range, 0) / 3,
    maxReach: Math.max(...W.map((x) => x.range + x.lunge)),
    coverage: areas.reduce((a, x) => a + x, 0) / 3,
    swings: W.map((x, i) => ({ area: areas[i], time: t[i], share: comboDmg > 0 ? x.dmg / comboDmg : 0 })),
  };
}

let REF: Omit<WeaponMetrics, 'score'> | null = null;

/** Производные числа баланса */
export function weaponMetrics(def: WeaponDef): WeaponMetrics {
  REF ??= raw(DEFAULT_WEAPONS[0]);
  const m = raw(def);
  const k = (a: number, b: number, p: number): number => (a > 0 && b > 0 ? (a / b) ** p : 0);
  const score = 100 * k(m.dps, REF.dps, 0.6) * k(m.coverage, REF.coverage, 0.25) * k(m.avgReach, REF.avgReach, 0.15);
  return { ...m, score };
}
