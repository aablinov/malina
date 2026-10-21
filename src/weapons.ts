import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type WeaponId = 'rifle' | 'uzi' | 'shotgun' | 'chaingun' | 'plasma' | 'launcher' | 'superShotgun' | 'bfg';
export type AmmoType = 'bullets' | 'shells' | 'cells' | 'grenades';
/** Чем стреляет основной режим */
export type ShotKind = 'bullet' | 'pellet' | 'plasma' | 'grenade' | 'bfg';
/** Второй режим ствола (мод), на клавише Q / ПКМ */
export type ModKind = 'microMissiles' | 'akimbo' | 'explosiveShot' | 'turret' | 'heatBlast' | 'detonate' | 'meatHook' | 'overload';
/** Вид прицела у курсора */
export type ReticleKind = 'dot' | 'wide' | 'ring' | 'spin' | 'diamond' | 'arc' | 'brackets' | 'triple';
/** Звук выстрела */
export type GunSound = 'rifle' | 'uzi' | 'shotgun' | 'chaingun' | 'plasma' | 'launcher' | 'super' | 'bfg';

export interface ModDef {
  kind: ModKind;
  name: string;
  desc: string;
  /** Перезарядка, с */
  cd: number;
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** Цена в ягодах, 0 — есть с начала */
  price: number;
  ammo: AmmoType;
  ammoPerShot: number;
  /** Выстрелов в секунду */
  rate: number;
  /** Урон одного снаряда (на экране ×10) */
  dmg: number;
  /** Снарядов за выстрел */
  pellets: number;
  /** Разброс в радианах */
  spread: number;
  speed: number;
  range: number;
  shot: ShotKind;
  knock: number;
  /** Отдача модели, 0..1 */
  recoil: number;
  shake: number;
  /** Сколько секунд раскручивается (пулемёт) */
  spinUp?: number;
  explode?: { r: number; dmg: number };
  /** Сквозь сколько жуков пролетает снаряд */
  pierce?: number;
  mod: ModDef;
  perk: string;
  /** Цвет светящихся деталей и вспышки (HDR) */
  glow: [number, number, number];
  /** Цвет трассера */
  tracer: [number, number, number];
  sound: GunSound;
  reticle: ReticleKind;
}

export interface AmmoDef {
  name: string;
  max: number;
  /** Сколько выпадает из жука */
  drop: number;
  /** Пачка в лавке: сколько и почём */
  pack: number;
  packPrice: number;
  /** Цвет подбираемой коробки */
  color: [number, number, number];
}

export const AMMO: Record<AmmoType, AmmoDef> = {
  bullets: { name: 'Пули', max: 300, drop: 18, pack: 80, packPrice: 8, color: [3, 2.4, 0.6] },
  shells: { name: 'Дробь', max: 50, drop: 4, pack: 16, packPrice: 8, color: [3, 1.2, 0.3] },
  cells: { name: 'Энергия', max: 300, drop: 24, pack: 100, packPrice: 12, color: [0.6, 2.4, 3.4] },
  grenades: { name: 'Гранаты', max: 24, drop: 2, pack: 8, packPrice: 12, color: [3.2, 0.5, 0.4] },
};
export const AMMO_TYPES = Object.keys(AMMO) as AmmoType[];

export const WEAPONS: readonly WeaponDef[] = [
  {
    id: 'rifle', name: 'Тяжёлый автомат', price: 0, ammo: 'bullets', ammoPerShot: 1,
    rate: 7, dmg: 3, pellets: 1, spread: 0.03, speed: 46, range: 16, shot: 'bullet', knock: 0.8, recoil: 0.5, shake: 0.08,
    mod: { kind: 'microMissiles', name: 'Микроракеты', desc: 'Залп из шести самонаводящихся ракет', cd: 6 },
    perk: 'Точный и надёжный, пули немного копятся сами',
    glow: [3, 1.2, 0.3], tracer: [3, 2.2, 0.8], sound: 'rifle', reticle: 'dot',
  },
  {
    id: 'uzi', name: 'Узи', price: 40, ammo: 'bullets', ammoPerShot: 1,
    rate: 16, dmg: 1.6, pellets: 1, spread: 0.14, speed: 40, range: 12, shot: 'bullet', knock: 0.4, recoil: 0.35, shake: 0.05,
    mod: { kind: 'akimbo', name: 'Два ствола', desc: 'Второй узи в руку: вдвое быстрее 4 секунды', cd: 10 },
    perk: 'Шквал пуль вблизи, но сильный разброс',
    glow: [3, 2.4, 0.6], tracer: [3, 2.6, 1.2], sound: 'uzi', reticle: 'wide',
  },
  {
    id: 'shotgun', name: 'Боевой дробовик', price: 60, ammo: 'shells', ammoPerShot: 1,
    rate: 1.4, dmg: 1.3, pellets: 9, spread: 0.2, speed: 38, range: 9, shot: 'pellet', knock: 1.4, recoil: 1, shake: 0.35,
    mod: { kind: 'explosiveShot', name: 'Взрывной заряд', desc: 'Снаряд взрывается и бьёт всех рядом', cd: 2.5 },
    perk: 'Девять дробин в упор, отбрасывает жуков',
    glow: [3, 1.0, 0.25], tracer: [3, 1.8, 0.6], sound: 'shotgun', reticle: 'ring',
  },
  {
    id: 'chaingun', name: 'Пулемёт', price: 110, ammo: 'bullets', ammoPerShot: 1,
    rate: 20, dmg: 2.2, pellets: 1, spread: 0.06, speed: 50, range: 18, shot: 'bullet', knock: 0.6, recoil: 0.3, shake: 0.07, spinUp: 0.55,
    mod: { kind: 'turret', name: 'Мобильная турель', desc: 'Три ствола: втрое больше пуль 4 секунды, но идёшь медленно', cd: 12 },
    perk: 'Раскручивается полсекунды, потом не остановить',
    glow: [3, 1.6, 0.4], tracer: [3, 2.0, 0.7], sound: 'chaingun', reticle: 'spin',
  },
  {
    id: 'plasma', name: 'Плазменная винтовка', price: 120, ammo: 'cells', ammoPerShot: 1,
    rate: 12, dmg: 2, pellets: 1, spread: 0.04, speed: 30, range: 15, shot: 'plasma', knock: 0.3, recoil: 0.25, shake: 0.04,
    mod: { kind: 'heatBlast', name: 'Тепловой взрыв', desc: 'Стрельба копит жар; выпусти его волной вокруг себя', cd: 1 },
    perk: 'Быстрые сгустки плазмы, копят жар для взрыва',
    glow: [0.6, 2.6, 3.6], tracer: [0.8, 2.8, 3.6], sound: 'plasma', reticle: 'diamond',
  },
  {
    id: 'launcher', name: 'Гранатомёт', price: 140, ammo: 'grenades', ammoPerShot: 1,
    rate: 1.5, dmg: 4, pellets: 1, spread: 0.02, speed: 15, range: 14, shot: 'grenade', knock: 2.5, recoil: 0.9, shake: 0.2,
    explode: { r: 2.6, dmg: 11 },
    mod: { kind: 'detonate', name: 'Дистанционный подрыв', desc: 'Взорвать все гранаты в полёте разом, сильнее обычного', cd: 0.5 },
    perk: 'Гранаты скачут и взрываются через секунду или от удара о жука',
    glow: [3.2, 0.5, 0.3], tracer: [3, 1, 0.4], sound: 'launcher', reticle: 'arc',
  },
  {
    id: 'superShotgun', name: 'Супердробовик', price: 180, ammo: 'shells', ammoPerShot: 2,
    rate: 0.95, dmg: 1.6, pellets: 16, spread: 0.26, speed: 40, range: 9, shot: 'pellet', knock: 2.4, recoil: 1, shake: 0.55,
    mod: { kind: 'meatHook', name: 'Мясной крюк', desc: 'Цепь цепляет жука и подтягивает героя к нему', cd: 4 },
    perk: 'Два ствола — шестнадцать дробин разом',
    glow: [3.2, 2.2, 0.6], tracer: [3, 1.9, 0.6], sound: 'super', reticle: 'brackets',
  },
  {
    id: 'bfg', name: 'Лучевая пушка Б-9000', price: 260, ammo: 'cells', ammoPerShot: 30,
    rate: 0.6, dmg: 3, pellets: 1, spread: 0, speed: 9, range: 16, shot: 'bfg', knock: 3, recoil: 1, shake: 0.6,
    explode: { r: 4.5, dmg: 30 },
    mod: { kind: 'overload', name: 'Перегрузка', desc: 'Сплошной луч две секунды прожигает всё на пути', cd: 14 },
    perk: 'Зелёный шар бьёт лучами всех вокруг и взрывается',
    glow: [0.6, 3.6, 0.8], tracer: [0.6, 3.6, 0.8], sound: 'bfg', reticle: 'triple',
  },
];

export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w])) as Record<WeaponId, WeaponDef>;

// ---------- Улучшения ----------
export const MAX_LEVEL = 5;
/** Множитель урона на уровне */
export const levelMul = (lvl: number): number => 1 + 0.2 * (lvl - 1);
/** Насколько короче перезарядка мода на уровне */
export const modCdMul = (lvl: number): number => 1 - 0.08 * (lvl - 1);
/** Цена перехода с уровня lvl на lvl + 1 */
export const upgradeCost = (w: WeaponDef, lvl: number): number => Math.round((12 + w.price * 0.25) * lvl / 5) * 5;

// ---------- Модели ----------
/** Материалы в духе референсов: оружейный металл, белые и жёлтые панели, полосы опасности */
type MatKey = 'dark' | 'gun' | 'light' | 'yellow' | 'orange' | 'red' | 'olive' | 'wood' | 'gold' | 'black' | 'hazard' | 'glow' | 'lens' | 'copper';

interface Part {
  /** box — брусок, cyl — цилиндр вдоль Z */
  s: 'box' | 'cyl';
  w: number; h: number; d: number;
  x: number; y: number; z: number;
  m: MatKey;
  /** Наклон вокруг X (рукояти, магазины, приклады) */
  rx?: number;
}
const B = (w: number, h: number, d: number, x: number, y: number, z: number, m: MatKey, rx = 0): Part => ({ s: 'box', w, h, d, x, y, z, m, rx });
/** Цилиндр радиуса r и длины len вдоль Z */
const C = (r: number, len: number, x: number, y: number, z: number, m: MatKey): Part => ({ s: 'cyl', w: r, h: r, d: len, x, y, z, m });

/** Стандартные узлы, из которых собираются стволы */
const grip = (z: number, m: MatKey = 'black'): Part[] => [B(0.06, 0.18, 0.08, 0, -0.14, z, m, 0.35), B(0.065, 0.02, 0.1, 0, -0.06, z + 0.02, 'dark')];
const vents = (z0: number, n: number, y: number, step = 0.06): Part[] => Array.from({ length: n }, (_, i) => B(0.112, 0.025, 0.03, 0, y, z0 + i * step, 'black'));

/** Стволы смотрят вдоль +Z, начало координат — у рукояти */
const PARTS: Record<WeaponId, Part[]> = {
  // штурмовая винтовка: тёмный металл, жёлтая полоса, оптика
  rifle: [
    B(0.1, 0.15, 0.5, 0, 0, 0.1, 'gun'),
    B(0.08, 0.03, 0.62, 0, 0.09, 0.16, 'dark'),
    B(0.11, 0.12, 0.34, 0, 0.0, 0.52, 'dark'),
    ...vents(0.4, 4, 0.02),
    C(0.024, 0.3, 0, 0.02, 0.82, 'gun'),
    B(0.06, 0.06, 0.09, 0, 0.02, 0.99, 'dark'),
    B(0.064, 0.02, 0.03, 0, 0.02, 0.97, 'black'),
    B(0.06, 0.24, 0.1, 0, -0.16, 0.24, 'dark', -0.28),
    ...grip(-0.02),
    B(0.07, 0.11, 0.3, 0, -0.02, -0.3, 'gun'),
    B(0.03, 0.05, 0.14, 0, -0.03, -0.3, 'black'),
    B(0.08, 0.17, 0.04, 0, -0.03, -0.47, 'black'),
    C(0.034, 0.22, 0, 0.16, 0.12, 'dark'),
    B(0.03, 0.05, 0.06, 0, 0.12, 0.12, 'dark'),
    C(0.03, 0.01, 0, 0.16, 0.235, 'lens'),
    B(0.105, 0.03, 0.26, 0, 0.045, 0.1, 'yellow'),
  ],
  // пистолет-пулемёт: красный магазин и вставки
  uzi: [
    B(0.09, 0.13, 0.32, 0, 0, 0.08, 'gun'),
    B(0.08, 0.04, 0.3, 0, 0.08, 0.08, 'dark'),
    C(0.02, 0.16, 0, 0.02, 0.31, 'gun'),
    C(0.032, 0.14, 0, 0.02, 0.42, 'black'),
    B(0.06, 0.28, 0.07, 0, -0.2, 0.06, 'black', 0.12),
    B(0.066, 0.07, 0.076, 0, -0.33, 0.04, 'red', 0.12),
    B(0.02, 0.02, 0.24, 0.03, -0.01, -0.19, 'dark'),
    B(0.02, 0.02, 0.24, -0.03, -0.01, -0.19, 'dark'),
    B(0.07, 0.12, 0.025, 0, -0.04, -0.31, 'dark'),
    B(0.095, 0.05, 0.14, 0, -0.01, 0.16, 'red'),
    B(0.03, 0.04, 0.05, 0, 0.12, 0.0, 'dark'),
    B(0.03, 0.04, 0.05, 0, 0.12, 0.2, 'dark'),
  ],
  // помповый дробовик: светлый корпус, оранжевое цевьё, патроны на боку
  shotgun: [
    B(0.1, 0.15, 0.36, 0, 0, 0.06, 'light'),
    B(0.06, 0.02, 0.32, 0, 0.085, 0.06, 'dark'),
    C(0.03, 0.56, 0, 0.04, 0.5, 'gun'),
    C(0.025, 0.42, 0, -0.04, 0.44, 'dark'),
    B(0.09, 0.08, 0.2, 0, -0.035, 0.42, 'orange'),
    B(0.092, 0.012, 0.18, 0, -0.01, 0.42, 'black'),
    B(0.092, 0.012, 0.18, 0, -0.05, 0.42, 'black'),
    ...grip(-0.06),
    B(0.07, 0.11, 0.3, 0, -0.03, -0.3, 'dark', 0.08),
    B(0.08, 0.15, 0.04, 0, -0.05, -0.46, 'black'),
    ...[0, 1, 2, 3].map((i) => B(0.02, 0.05, 0.03, 0.06, 0.0, -0.04 + i * 0.045, 'red')),
    B(0.1, 0.03, 0.12, 0, 0.0, 0.18, 'orange'),
  ],
  // пулемёт: корпус с полосой опасности, короб с лентой
  chaingun: [
    B(0.2, 0.2, 0.36, 0, 0, 0.0, 'gun'),
    B(0.205, 0.07, 0.24, 0, 0.04, 0.02, 'hazard'),
    C(0.09, 0.14, 0, 0, 0.25, 'dark'),
    C(0.1, 0.04, 0, 0, 0.92, 'dark'),
    B(0.04, 0.1, 0.04, 0, 0.14, -0.1, 'dark'),
    B(0.04, 0.1, 0.04, 0, 0.14, 0.12, 'dark'),
    B(0.04, 0.03, 0.28, 0, 0.2, 0.01, 'black'),
    B(0.16, 0.2, 0.22, -0.18, -0.05, -0.02, 'olive'),
    B(0.165, 0.03, 0.22, -0.18, 0.04, -0.02, 'yellow'),
    B(0.08, 0.03, 0.16, -0.08, 0.0, 0.06, 'gold'),
    B(0.06, 0.16, 0.07, 0, -0.14, -0.14, 'black', 0.3),
  ],
  // энергетическая винтовка: жёлтый корпус, золотая катушка в окне
  plasma: [
    B(0.1, 0.15, 0.56, 0, 0, 0.12, 'yellow'),
    B(0.09, 0.06, 0.52, 0, -0.08, 0.12, 'dark'),
    B(0.106, 0.075, 0.28, 0, 0.02, 0.1, 'black'),
    C(0.034, 0.3, 0, 0.02, 0.1, 'gold'),
    ...[0, 1, 2, 3].map((i) => C(0.045, 0.014, 0, 0.02, -0.02 + i * 0.08, 'glow')),
    C(0.028, 0.22, 0, 0.02, 0.5, 'gun'),
    C(0.034, 0.06, 0, 0.02, 0.63, 'copper'),
    B(0.04, 0.035, 0.3, 0, 0.04, -0.28, 'dark'),
    B(0.04, 0.035, 0.32, 0, -0.08, -0.27, 'dark', -0.18),
    B(0.06, 0.16, 0.04, 0, -0.03, -0.44, 'black'),
    ...grip(0.0),
    B(0.05, 0.13, 0.05, 0, -0.15, 0.34, 'black'),
    C(0.026, 0.13, 0, 0.12, 0.08, 'dark'),
    B(0.04, 0.04, 0.05, 0, 0.1, 0.08, 'yellow'),
    C(0.022, 0.01, 0, 0.12, 0.15, 'lens'),
    B(0.02, 0.02, 0.22, 0.056, -0.03, 0.06, 'red'),
  ],
  // гранатомёт: толстая труба, красный барабан, оранжевое кольцо
  launcher: [
    C(0.085, 0.6, 0, 0.04, 0.3, 'gun'),
    C(0.095, 0.06, 0, 0.04, 0.58, 'orange'),
    C(0.06, 0.01, 0, 0.04, 0.612, 'glow'),
    C(0.13, 0.15, 0, -0.06, 0.02, 'red'),
    ...[0, 1, 2, 3, 4, 5].map((i) => { const a = (i / 6) * Math.PI * 2; return C(0.03, 0.155, Math.cos(a) * 0.09, -0.06 + Math.sin(a) * 0.09, 0.02, 'dark'); }),
    B(0.12, 0.03, 0.22, 0, 0.13, 0.28, 'orange'),
    B(0.03, 0.06, 0.05, 0, 0.16, 0.44, 'dark'),
    ...grip(-0.12),
    B(0.07, 0.1, 0.26, 0, -0.02, -0.32, 'dark'),
    B(0.08, 0.15, 0.04, 0, -0.03, -0.46, 'black'),
  ],
  // двустволка: сталь, дерево, золотые накладки, крюк под стволами
  superShotgun: [
    C(0.03, 0.62, 0.032, 0.03, 0.43, 'gun'),
    C(0.03, 0.62, -0.032, 0.03, 0.43, 'gun'),
    B(0.02, 0.015, 0.6, 0, 0.064, 0.43, 'gold'),
    B(0.1, 0.12, 0.2, 0, 0, 0.03, 'gold'),
    B(0.09, 0.06, 0.26, 0, -0.035, 0.3, 'wood'),
    B(0.07, 0.13, 0.36, 0, -0.07, -0.22, 'wood', 0.2),
    B(0.075, 0.16, 0.04, 0, -0.13, -0.4, 'black', 0.2),
    B(0.05, 0.05, 0.12, 0, -0.075, 0.56, 'gun'),
    B(0.03, 0.03, 0.03, 0, -0.1, 0.63, 'glow'),
    ...[0, 1].map((i) => B(0.02, 0.05, 0.03, 0.04, -0.06, -0.14 - i * 0.05, 'red', 0.2)),
  ],
  // лучевая пушка: белый корпус, жёлтые панели, зелёное ядро в клетке
  bfg: [
    B(0.22, 0.24, 0.62, 0, 0, 0.12, 'light'),
    B(0.226, 0.1, 0.42, 0, -0.05, 0.1, 'yellow'),
    B(0.16, 0.08, 0.3, 0, 0.15, 0.12, 'glow'),
    ...[0, 1, 2, 3].map((i) => B(0.17, 0.09, 0.012, 0, 0.15, 0.0 + i * 0.08, 'dark')),
    C(0.13, 0.12, 0, 0.02, 0.48, 'dark'),
    C(0.1, 0.02, 0, 0.02, 0.548, 'glow'),
    ...[0, 1, 2].map((i) => { const a = (i / 3) * Math.PI * 2 + Math.PI / 2; return B(0.03, 0.03, 0.16, Math.cos(a) * 0.11, 0.02 + Math.sin(a) * 0.11, 0.6, 'gun'); }),
    C(0.05, 0.1, 0.12, -0.06, -0.12, 'gold'),
    C(0.05, 0.1, -0.12, -0.06, -0.12, 'gold'),
    B(0.04, 0.03, 0.3, 0, 0.21, 0.1, 'black'),
    ...grip(-0.08),
    B(0.08, 0.12, 0.2, 0, -0.03, -0.28, 'dark'),
  ],
};

/** Где дуло, относительно рукояти */
const MUZZLE: Record<WeaponId, number> = { rifle: 1.04, uzi: 0.49, shotgun: 0.79, chaingun: 0.95, plasma: 0.67, launcher: 0.62, superShotgun: 0.75, bfg: 0.68 };

let hazardTex: THREE.CanvasTexture | null = null;
/** Жёлто-чёрная диагональная полоса */
function hazard(): THREE.CanvasTexture {
  if (hazardTex) return hazardTex;
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  if (g) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    g.fillStyle = Math.floor((x + y) / 4) % 2 ? '#1a1a1a' : '#e8c21a';
    g.fillRect(x, y, 1, 1);
  }
  hazardTex = new THREE.CanvasTexture(c);
  hazardTex.magFilter = THREE.NearestFilter;
  hazardTex.colorSpace = THREE.SRGBColorSpace;
  return hazardTex;
}

const cylGeo = new Map<string, THREE.CylinderGeometry>();
function cylinder(r: number, len: number): THREE.CylinderGeometry {
  const k = `${r}:${len}`;
  let g = cylGeo.get(k);
  if (!g) { g = new THREE.CylinderGeometry(r, r, len, 12); g.rotateX(Math.PI / 2); cylGeo.set(k, g); }
  return g;
}

/** Модель ствола; в userData — точка дула и (у пулемёта) вращающийся блок стволов */
export function buildGunModel(def: WeaponDef, level = 1): THREE.Group {
  const g = new THREE.Group();
  const glow = new THREE.Color(...def.glow).multiplyScalar(1 / 3.6);
  const lvlGlow = 1 + (level - 1) * 0.4;
  const std = (color: string, metal = 0.5, rough = 0.45, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, ...extra });
  const mats: Record<MatKey, THREE.Material> = {
    dark: std('#3a3d44', 0.35, 0.5),
    gun: std('#666c76', 0.45, 0.35),
    light: std('#c9ccd1', 0.3, 0.45),
    yellow: std('#e3bd1c', 0.25, 0.45, { emissive: '#3a2e00', emissiveIntensity: 0.3 }),
    orange: std('#d0581c', 0.3, 0.5),
    red: std('#b8261c', 0.3, 0.5),
    olive: std('#5d6a3a', 0.3, 0.6),
    wood: std('#7a4a26', 0.05, 0.7),
    gold: std('#d4a63a', 0.6, 0.3),
    black: std('#1e2024', 0.2, 0.75),
    hazard: std('#ffffff', 0.2, 0.6, { map: hazard() }),
    glow: std('#000000', 0, 0.4, { color: glow, emissive: glow, emissiveIntensity: 2.4 * lvlGlow }),
    lens: std('#000000', 0, 0.2, { color: new THREE.Color(0.2, 0.6, 1), emissive: new THREE.Color(0.2, 0.6, 1), emissiveIntensity: 1.6 }),
    copper: std('#c07a46', 0.6, 0.3),
  };
  for (const p of PARTS[def.id]) {
    const geo = p.s === 'box' ? new THREE.BoxGeometry(p.w, p.h, p.d) : cylinder(p.w, p.d);
    const mesh = new THREE.Mesh(geo, mats[p.m]);
    mesh.position.set(p.x, p.y, p.z);
    if (p.rx) mesh.rotation.x = p.rx;
    mesh.castShadow = true;
    g.add(mesh);
  }
  if (def.id === 'chaingun') {
    // блок из шести стволов крутится при стрельбе
    const spin = new THREE.Group();
    spin.position.set(0, 0, 0.6);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const b = new THREE.Mesh(cylinder(0.022, 0.66), mats.gun);
      b.position.set(Math.cos(a) * 0.065, Math.sin(a) * 0.065, 0);
      b.castShadow = true;
      spin.add(b);
    }
    spin.add(new THREE.Mesh(cylinder(0.03, 0.66), mats.dark));
    g.add(spin);
    g.userData.spin = spin;
  }
  // золотые заклёпки за уровни
  for (let i = 1; i < level; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), new THREE.MeshStandardMaterial({ color: '#ffcf5a', emissive: '#ffb020', emissiveIntensity: 0.8 }));
    s.position.set(0.07, 0.07, -0.05 + i * 0.06);
    g.add(s);
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.03, MUZZLE[def.id]);
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}

// ---------- Превью для лавки и HUD ----------
let previewRenderer: THREE.WebGLRenderer | null = null;
let previewEnv: THREE.Texture | null = null;
const previewCache = new Map<string, string>();

/** Картинка ствола сбоку, дулом вправо — как в оружейных меню */
export function gunPreview(def: WeaponDef, level = 1): string {
  const key = `${def.id}:${level}`;
  const hit = previewCache.get(key);
  if (hit) return hit;
  const W = 360, H = 150;
  if (!previewRenderer) {
    previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    previewRenderer.setPixelRatio(1);
    previewRenderer.setSize(W, H, false);
    previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
    previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  }
  const scene = new THREE.Scene();
  if (!previewEnv) previewEnv = new THREE.PMREMGenerator(previewRenderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = previewEnv;
  scene.add(new THREE.HemisphereLight('#ffffff', '#50545c', 1.2));
  const key1 = new THREE.DirectionalLight('#ffffff', 2.4); key1.position.set(-4, 4, 1); scene.add(key1);
  const rim = new THREE.DirectionalLight('#9fc0ff', 1.6); rim.position.set(2, 2, -3); scene.add(rim);
  const model = buildGunModel(def, level);
  scene.add(model);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const aspect = W / H;
  const halfW = Math.max(size.z / 2, (size.y / 2) * aspect) * 1.12;
  const halfH = halfW / aspect;
  const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 20);
  // смотрим с левого бока чуть сверху: дуло оказывается справа
  cam.position.set(center.x - 5, center.y + 0.9, center.z + 0.35);
  cam.lookAt(center);
  previewRenderer.render(scene, cam);
  const url = previewRenderer.domElement.toDataURL('image/png');
  model.traverse((o) => { if (o instanceof THREE.Mesh) { if (o.geometry.type === 'BoxGeometry') o.geometry.dispose(); } });
  previewCache.set(key, url);
  return url;
}
