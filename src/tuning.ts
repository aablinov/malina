/**
 * Все настраиваемые числа передвижения, стрельбы и брони.
 * Их читают игра и панель плейграунда (F1). Объекты изменяемые: панель правит их на лету.
 * Единицы: метры, секунды, градусы (где написано «°»).
 */

export const HERO = {
  hp: 100,
  /** Радиус тела для коллизий, м */
  radius: 0.34,

  // ---------- Скорости, м/с ----------
  walk: 4.4,
  run: 6.6,
  aim: 2.6,
  crouch: 2.2,
  crouchAim: 1.6,
  /** Ход спиной: множитель скорости */
  backMul: 0.8,
  /** Разгон и торможение, м/с² */
  accel: 30,
  decel: 36,

  // ---------- Перекат ----------
  rollDist: 5,
  rollTime: 0.45,
  /** Неуязвимость с начала переката, с */
  rollIframes: 0.2,

  // ---------- Выносливость ----------
  stamina: 100,
  runDrain: 12,
  rollCost: 30,
  regen: 25,
  /** Пауза перед восстановлением, с */
  regenDelay: 0.8,
  /** Если выносливость кончилась — бег и перекат недоступны столько секунд */
  exhaust: 2,

  // ---------- Стойка и шаг ----------
  /** Длина шага, м */
  step: 0.9,
  runStep: 1.35,
  crouchStep: 0.6,
  /** Высота подъёма стопы в шаге, м */
  stepLift: 0.14,
  /** Насколько опущен таз в тактической стойке и в приседе, м */
  stanceDrop: 0.07,
  crouchDrop: 0.3,
  /** Наклон корпуса вперёд: стойка / бег, ° */
  lean: 8,
  runLean: 20,
  /** Покачивание корпуса при ходьбе, ° */
  sway: 2,
  /** Предельный поворот корпуса относительно ног, ° */
  twist: 70,
  /** Скорость поворота корпуса к прицелу, 1/с */
  turnRate: 18,

  /** Переключение основной / пистолет, с */
  switchTime: 0.4,
  /** Сдвиг камеры к прицелу при прицеливании, доля */
  aimCamShift: 0.15,
};

/** Множители разброса */
export const SPREAD = {
  aim: 0.4,
  crouch: 0.7,
  /** При полной скорости ходьбы; между стоянием и ходьбой — плавно */
  move: 1.3,
};

/** Рикошеты пуль и дробин от стен */
export const RICOCHET = {
  chance: 0.5,
  /** Доля урона после отскока */
  dmgMul: 0.5,
};

export type Caliber = '9mm' | '545' | '556' | '12g' | '762r';

export const CALIBERS: Record<Caliber, { name: string; max: number }> = {
  '9mm': { name: '9 мм', max: 120 },
  '545': { name: '5,45×39', max: 180 },
  '556': { name: '5,56×45', max: 180 },
  '12g': { name: '12 калибр', max: 32 },
  '762r': { name: '7,62×54R', max: 150 },
};

export type FireMode = 'semi' | 'auto' | 'double';
export type GunClass = 'pistol' | 'rifle' | 'shotgun';
export type Weight = 'light' | 'medium' | 'heavy';

export const WEIGHT_MUL: Record<Weight, number> = { light: 1, medium: 0.95, heavy: 0.85 };

export interface GunTuning {
  /** Урон одной пули или дробины */
  dmg: number;
  /** Дробин за выстрел */
  pellets: number;
  /** Выстрелов в секунду */
  rate: number;
  mag: number;
  /** Тактическая перезарядка (патрон в патроннике), с; 0 — не бывает */
  reloadTac: number;
  /** Полная перезарядка, с */
  reloadFull: number;
  /** Дальность полного урона, м; дальше урон падает до 50% к 1,5 × дальности */
  range: number;
  /** Базовый разброс, ° (полуугол конуса) */
  spread: number;
  /** Раскачка от одного выстрела, доля 0..1 */
  bloomShot: number;
  /** Сколько градусов добавляет полная раскачка */
  bloomDeg: number;
  /** За сколько секунд раскачка спадает до нуля */
  bloomDecay: number;
  /** Подброс оружия и плеч, 0..1 */
  kick: number;
  /** Наклон плеч назад от выстрела, ° */
  shoulderKick: number;
  /** Отбрасывание цели (дуплет двустволки) */
  knock: number;
}

export const GUNS: Record<'pm' | 'ak74' | 'dbl' | 'ar15', GunTuning> = {
  pm: {
    dmg: 9, pellets: 1, rate: 4, mag: 8, reloadTac: 1.1, reloadFull: 1.5, range: 14,
    spread: 1.6, bloomShot: 0.22, bloomDeg: 3, bloomDecay: 0.3, kick: 0.35, shoulderKick: 3, knock: 0,
  },
  ak74: {
    dmg: 11, pellets: 1, rate: 10, mag: 30, reloadTac: 2.4, reloadFull: 3.0, range: 20,
    spread: 1.4, bloomShot: 0.1, bloomDeg: 5, bloomDecay: 0.35, kick: 0.45, shoulderKick: 4, knock: 0,
  },
  dbl: {
    dmg: 6, pellets: 8, rate: 2.5, mag: 2, reloadTac: 0, reloadFull: 2.0, range: 8,
    spread: 6, bloomShot: 0.5, bloomDeg: 2, bloomDecay: 0.4, kick: 1, shoulderKick: 6, knock: 1.2,
  },
  ar15: {
    dmg: 10, pellets: 1, rate: 12, mag: 30, reloadTac: 2.1, reloadFull: 2.6, range: 22,
    spread: 1.12, bloomShot: 0.085, bloomDeg: 4, bloomDecay: 0.3, kick: 0.38, shoulderKick: 3.5, knock: 0,
  },
};

/** Дуплет двустволки: удерживать ЛКМ столько секунд */
export const DOUBLE_HOLD = 0.3;

// ---------- Арахниды (как в «Звёздном десанте») ----------

export type ArachnidKind = 'warrior' | 'spinner' | 'leaper';

export interface ArachnidTuning {
  hp: number;
  /** Бег, м/с */
  speed: number;
  /** Размер модели (×) и длина тела, м */
  scale: number;
  /** Через сколько секунд замечает, что на него навели ствол */
  reaction: number;
  /** Шанс отпрыгнуть, когда заметил прицел (0..1) */
  dodgeChance: number;
  /** Пауза между уклонами, с */
  dodgeCd: number;
  /** Длина и время отскока */
  dodgeDist: number;
  dodgeTime: number;
  /** Ближний бой: дистанция, урон, замах, пауза */
  meleeRange: number;
  meleeDmg: number;
  meleeWindup: number;
  meleeCd: number;
  /** Ткач: держит дистанцию keepMin..keepMax и плюётся паутиной */
  keepMin: number;
  keepMax: number;
  webRange: number;
  webCd: number;
  webSpeed: number;
  webDmg: number;
  /** Замедление героя паутиной (× скорость) и сколько длится */
  webSlow: number;
  webSlowTime: number;
  /** Яд: урон в секунду и длительность */
  poisonDps: number;
  poisonTime: number;
  /** Прыгун: прыжок на героя — дальность в длинах тела, урон, замах, пауза, время полёта */
  pounceMul: number;
  pounceDmg: number;
  pounceWindup: number;
  pounceCd: number;
  pounceTime: number;
}

const ARACH_BASE: ArachnidTuning = {
  hp: 120, speed: 6, scale: 1, reaction: 0.15, dodgeChance: 0.8, dodgeCd: 1, dodgeDist: 3, dodgeTime: 0.32,
  meleeRange: 1.9, meleeDmg: 10, meleeWindup: 0.3, meleeCd: 1.2,
  keepMin: 0, keepMax: 0, webRange: 0, webCd: 0, webSpeed: 0, webDmg: 0, webSlow: 1, webSlowTime: 0, poisonDps: 0, poisonTime: 0,
  pounceMul: 0, pounceDmg: 0, pounceWindup: 0, pounceCd: 0, pounceTime: 0,
};

export const ARACHNIDS: Record<ArachnidKind, ArachnidTuning> = {
  /** Воин: самый ловкий и умный, ближний бой, заходит с фланга, давит на перезарядке */
  warrior: { ...ARACH_BASE, hp: 140, speed: 6.4, scale: 1, reaction: 0.12, dodgeChance: 0.9, dodgeCd: 0.8, dodgeDist: 3, dodgeTime: 0.3, meleeRange: 2, meleeDmg: 18, meleeWindup: 0.25, meleeCd: 1.1 },
  /** Ткач: держит дистанцию, кидает ядовитую паутину (замедляет и травит) */
  spinner: {
    ...ARACH_BASE, hp: 110, speed: 5.6, scale: 0.85, reaction: 0.18, dodgeChance: 0.8, dodgeCd: 0.9, dodgeDist: 2.8, dodgeTime: 0.3,
    meleeRange: 1.6, meleeDmg: 8, meleeWindup: 0.3, meleeCd: 1.4,
    keepMin: 6, keepMax: 11, webRange: 13, webCd: 2.4, webSpeed: 13, webDmg: 5, webSlow: 0.45, webSlowTime: 2.5, poisonDps: 4, poisonTime: 3,
  },
  /** Прыгун: быстрый, прыгает прямо на героя на 3 длины тела */
  leaper: {
    ...ARACH_BASE, hp: 110, speed: 7.2, scale: 0.8, reaction: 0.18, dodgeChance: 0.75, dodgeCd: 1, dodgeDist: 3.2, dodgeTime: 0.3,
    meleeRange: 1.6, meleeDmg: 10, meleeWindup: 0.25, meleeCd: 1.2,
    pounceMul: 3, pounceDmg: 26, pounceWindup: 0.4, pounceCd: 2.6, pounceTime: 0.45,
  },
};

/** Длина тела арахнида при scale = 1, м */
export const ARACHNID_LENGTH = 2.2;

// ---------- Сброс и экспорт для панели ----------

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;


let DEFAULTS: { HERO: typeof HERO; SPREAD: typeof SPREAD; RICOCHET: typeof RICOCHET; GUNS: typeof GUNS; BEETLES: typeof BEETLES; ARACHNIDS: typeof ARACHNIDS } | null = null;
/** Запомнить стартовые значения (вызывается при запуске) */
export function snapshotTuning(): void {
  DEFAULTS ??= { HERO: clone(HERO), SPREAD: clone(SPREAD), RICOCHET: clone(RICOCHET), GUNS: clone(GUNS), BEETLES: clone(BEETLES), ARACHNIDS: clone(ARACHNIDS) };
}

export function resetTuning(): void {
  if (!DEFAULTS) return;
  Object.assign(HERO, clone(DEFAULTS.HERO));
  Object.assign(SPREAD, clone(DEFAULTS.SPREAD));
  Object.assign(RICOCHET, clone(DEFAULTS.RICOCHET));
  Object.assign(BEETLES, clone(DEFAULTS.BEETLES));
  for (const k of Object.keys(ARACHNIDS) as ArachnidKind[]) Object.assign(ARACHNIDS[k], clone(DEFAULTS.ARACHNIDS[k]));
  for (const k of Object.keys(GUNS) as (keyof typeof GUNS)[]) Object.assign(GUNS[k], clone(DEFAULTS.GUNS[k]));
}

export function tuningJSON(): string {
  return JSON.stringify({ HERO, SPREAD, RICOCHET, GUNS, BEETLES, ARACHNIDS }, null, 2);
}

/** Жуки в плейграунде: их здоровье ещё в старом масштабе (×10), до перебалансировки на этапе 1a */
export const BEETLES = {
  /** Множитель урона пуль по жукам */
  dmgScale: 0.25,
  /** Укус ближнего жука по герою: урон в секунду на единицу bite */
  biteMul: 3.5,
};
