import * as THREE from 'three';
import { resolveCircle, type Obstacle } from './collision';
import { STEP, type Terrain } from './level/collide.ts';
import { pixelTex, type Textures } from './textures';
import { SwordTrail } from './trail';
import { HERO, SWORD } from './tuning';
import { buildWeaponModel, disposeWeaponModel, type WeaponCategory, type WeaponDef } from './weapons';
import type { ArmorLook, BowLook } from './items';

/**
 * Герой: блочный персонаж в духе Minecraft Dungeons (крупная голова, короткие руки и ноги, плащ) со стандартным мечом.
 * Ходьба, перекат-уклонение, падение с обрывов; меч — комбо из трёх ударов со светящимся следом клинка.
 * Прыжка нет, как в Minecraft Dungeons: перепады высоты — ступени и полублоки.
 * Симуляция (update) читает только KnightInput — под будущую сеть. Анимация процедурная: части поворачиваются целиком.
 */

export interface KnightInput {
  /** Направление движения в мире (x, z), длина 0..1 (клавиши или путь к точке клика — решает сцена) */
  move: THREE.Vector2;
  /** Точка курсора на земле: туда герой бьёт */
  aim: THREE.Vector3;
  /** ЛКМ удерживается: удар, удержание продолжает комбо */
  attack: boolean;
  /** Нажатие (true один кадр) */
  roll: boolean;
}

export function emptyInput(): KnightInput {
  return { move: new THREE.Vector2(), aim: new THREE.Vector3(0, 0, 5), attack: false, roll: false };
}

/** Удар достиг середины взмаха: кого задело — решает сцена */
export interface Strike {
  /** Номер удара в комбо: 0, 1, 2 (добивающий) */
  step: number;
  /** Центр удара — грудь героя */
  from: THREE.Vector3;
  yaw: number;
  range: number;
  /** Полуширина дуги, рад */
  half: number;
  dmg: number;
  knock: number;
}

export type KnightState = 'стоит' | 'идёт' | 'падает' | 'перекат' | 'удар 1' | 'удар 2' | 'удар 3' | 'спец-удар' | 'без сил';

/** Спец-удар оружия (Q, src/weapon-arts.ts): движение и поза героя; кого задело — решает сцена по доле specialK */
export type SpecialMove = 'spin' | 'throw' | 'dash' | 'lunge' | 'slam' | 'leap' | 'wave' | 'reap' | 'iai' | 'berserk' | 'flurry' | 'mill';

/** Облик взмаха от закалки (src/weapon-arts.ts): цвета следа, ширина и жизнь точки */
export interface SwingLook { color: THREE.Color; color2: THREE.Color; width: number; life: number; core: number }

// ---------- размеры модели, м ----------
const LEG = 0.62;
const BODY = 0.62;
const HEAD = 0.56;
const ARM = 0.58;
const SHOULDER_X = 0.37;
const BLADE = 0.95;

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (k: number, dt: number): number => 1 - Math.exp(-k * dt);
const smooth = (t: number): number => { const x = THREE.MathUtils.clamp(t, 0, 1); return x * x * (3 - 2 * x); };
const outCubic = (t: number): number => { const x = THREE.MathUtils.clamp(t, 0, 1); return 1 - (1 - x) ** 3; };

function box(w: number, h: number, d: number, m: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Поза рук и корпуса в ударе: ax/ay/az — правое плечо, w — кисть (наклон клинка), twist/lean — корпус, lx/ly — левое
 * плечо, wl — наклон второго клинка в левой кисти (парное оружие; без него — как w)
 */
interface Pose { ax: number; ay: number; az: number; w: number; twist: number; lean: number; lx: number; ly: number; wl?: number }
const P = (ax: number, ay: number, az: number, w: number, twist = 0, lean = 0, lx = 0.25, ly = 0, wl?: number): Pose => ({ ax, ay, az, w, twist, lean, lx, ly, wl });
const IDLE = P(-0.35, -0.1, 0.12, -0.45);
/** Стандартные цвета и ширина следа трёх шагов комбо */
const SWINGS: { from: Pose; to: Pose; trail: THREE.Color; width: number }[] = [
  // слева направо по экрану: от правого плеча через грудь налево, чуть сверху вниз
  { from: P(-1.95, -1.6, 0, 1.3, -0.6, 0.05, 0.5, 0.3), to: P(-1.15, 0.95, 0, 1.25, 0.55, 0.12, -0.2, 0), trail: new THREE.Color(0.6, 1.5, 3.0), width: 0.8 },
  // обратный: слева направо, снизу вверх
  { from: P(-1.3, 1.0, 0, 1.3, 0.65, 0.1, -0.2, 0), to: P(-1.85, -1.75, 0, 1.3, -0.55, 0.05, 0.5, 0.3), trail: new THREE.Color(1.5, 0.9, 3.0), width: 0.8 },
  // добивающий: сверху вниз двумя руками, с выпадом
  { from: P(-3.35, -0.12, 0, 1.45, 0, -0.28, -3.2, 0.15), to: P(-0.75, -0.05, 0, 1.0, 0, 0.42, -0.9, 0.2), trail: new THREE.Color(3.2, 1.9, 0.5), width: 0.95 },
];

/**
 * Стиль ударов вида оружия (wiki/design-weapon-arts.md, раздел 5): у каждого — свои три удара комбо, замах → удар.
 * Меч — слева, справа, сверху; тяжёлое — широкий разворот корпусом и удар двумя руками с глубоким замахом; катана —
 * выхват от левого бедра, косой разрез, вертикальный с шагом; выпад — три укола вперёд; кинжал — короткие обратные
 * взмахи и укол; древковое — низкий широкий мах двумя руками, обратный высокий, рубящий сверху; парное — правой,
 * левой, обеими крест-накрест; кулаки — правый, левый прямые и апперкот
 */
export type SwingStyle = 'sword' | 'heavy' | 'katana' | 'thrust' | 'dagger' | 'pole' | 'dual' | 'fist';
export const STYLE_OF: Record<WeaponCategory, SwingStyle> = {
  'меч': 'sword', 'топор': 'heavy', 'булава': 'heavy', 'молот': 'heavy', 'великий меч': 'heavy', 'кинжал': 'dagger',
  'копьё': 'thrust', 'рапира': 'thrust', 'посох': 'pole', 'коса': 'pole', 'алебарда': 'pole', 'катана': 'katana',
  'парные клинки': 'dual', 'кастеты': 'fist',
};
type Swing3 = [[Pose, Pose], [Pose, Pose], [Pose, Pose]];
const STYLES: Record<SwingStyle, Swing3> = {
  sword: [[SWINGS[0].from, SWINGS[0].to], [SWINGS[1].from, SWINGS[1].to], [SWINGS[2].from, SWINGS[2].to]],
  heavy: [
    [P(-2.1, -1.9, 0, 1.35, -0.9, -0.1, 0.4, 0.3), P(-1.1, 1.1, 0, 1.3, 0.8, 0.2, -0.4, 0)],
    [P(-1.0, 1.2, 0, 1.3, 0.8, 0.15, -0.3, 0), P(-2.0, -1.8, 0, 1.3, -0.8, 0, 0.5, 0.3)],
    [P(-3.4, -0.1, 0, 1.5, 0, -0.4, -3.3, 0.15), P(-0.55, -0.05, 0, 0.95, 0, 0.55, -0.7, 0.2)],
  ],
  katana: [
    [P(-0.7, 1.0, 0, -0.1, 0.7, 0.2, 0.5, 0), P(-1.5, -1.5, 0, 1.45, -0.7, 0.05, 0.6, 0.3)],
    [P(-2.6, -0.9, 0, 1.4, -0.5, -0.15, -1.2, 0.2), P(-0.8, 0.8, 0, 1.2, 0.6, 0.3, -0.5, 0)],
    [P(-3.2, 0, 0, 1.5, 0, -0.3, -3.0, 0), P(-1.0, 0, 0, 1.25, 0, 0.45, -1.1, 0)],
  ],
  thrust: [
    [P(-1.1, -0.6, 0, 1.55, -0.5, -0.1, 0.5, 0), P(-1.62, -0.1, 0, 1.55, 0.35, 0.3, 0.6, 0)],
    [P(-1.2, -0.7, 0, 1.55, -0.6, -0.1, 0.5, 0), P(-1.6, 0.2, 0, 1.55, 0.45, 0.32, 0.6, 0)],
    [P(-0.9, -0.9, 0, 1.55, -0.8, -0.2, 0.8, 0), P(-1.65, 0, 0, 1.57, 0.5, 0.5, 0.9, 0)],
  ],
  dagger: [
    [P(-1.6, -1.2, 0, 0.9, -0.4, 0.1, 0.4, 0), P(-1.3, 0.7, 0, 1.0, 0.45, 0.15, 0.2, 0)],
    [P(-1.2, 0.8, 0, 1.0, 0.5, 0.15, 0.2, 0), P(-1.6, -1.2, 0, 0.9, -0.45, 0.1, 0.4, 0)],
    [P(-1.0, -0.4, 0, 1.5, -0.5, -0.1, 0.4, 0), P(-1.6, 0, 0, 1.55, 0.4, 0.4, 0.5, 0)],
  ],
  pole: [
    [P(-1.3, -1.8, 0, 1.4, -0.9, 0.15, -1.0, -0.4), P(-1.0, 1.3, 0, 1.4, 0.9, 0.2, -1.1, 0.5)],
    [P(-1.9, 1.3, 0, 1.35, 0.8, 0, -1.4, 0.5), P(-1.6, -1.7, 0, 1.4, -0.8, 0.1, -1.0, -0.4)],
    [P(-3.3, -0.1, 0, 1.4, 0, -0.35, -3.1, 0.1), P(-0.9, 0, 0, 1.1, 0, 0.45, -0.9, 0.1)],
  ],
  dual: [
    [P(-1.95, -1.6, 0, 1.3, -0.6, 0.05, -0.4, 0, -0.45), P(-1.15, 0.95, 0, 1.25, 0.55, 0.12, -0.3, 0, -0.45)],
    [P(-0.5, -0.2, 0, 0.3, 0.6, 0.05, -1.95, 1.6, 1.3), P(-0.5, -0.2, 0, 0.3, -0.55, 0.12, -1.15, -0.95, 1.25)],
    [P(-2.4, -1.2, 0, 1.3, 0, -0.2, -2.4, 1.2, 1.3), P(-1.2, 0.8, 0, 1.3, 0, 0.35, -1.2, -0.8, 1.3)],
  ],
  fist: [
    [P(-0.6, -0.3, 0, 1.5, -0.4, 0.05, -0.9, 0, 1.5), P(-1.6, 0.05, 0, 1.5, 0.4, 0.25, -0.5, 0, 1.5)],
    [P(-1.0, -0.2, 0, 1.5, 0.4, 0.05, -0.5, 0, 1.5), P(-0.7, -0.2, 0, 1.5, -0.45, 0.25, -1.6, -0.05, 1.5)],
    [P(-0.2, -0.3, 0, 1.5, -0.4, 0.2, -0.8, 0, 1.5), P(-2.7, 0, 0, 1.5, 0.2, -0.25, -0.6, 0, 1.5)],
  ],
};

/**
 * Спец-удары: замах from → удар to на доле [a, b] длительности. dash — рывок [метры, с доли, до доли], turns — обороты
 * за [a, b], hop — высота прыжка, iframes — до какой доли неуязвим, walk — доля скорости ходьбы во время удара
 */
interface SpecialPose { from: Pose; to: Pose; a: number; b: number; dash?: [number, number, number]; turns?: number; hop?: number; iframes?: number; walk?: number }
const SPIN = P(-1.55, -1.25, 0, 1.45, 0, 0.05, -0.6, 0.4);
const THRUST = P(-1.6, -0.15, 0, 1.5, 0.35, 0.35, 0.5, 0);
const SPECIALS: Record<SpecialMove, SpecialPose> = {
  spin: { from: SPIN, to: SPIN, a: 0.1, b: 0.92, turns: 2, walk: 0.6 },
  reap: { from: P(-1.55, 1.0, 0, 1.45, 0.6, 0.1, -0.4, 0), to: SPIN, a: 0.22, b: 0.85, turns: 1 },
  throw: { from: P(-2.9, -0.4, 0, 1.0, -0.5, -0.2, 0.6, 0), to: P(-1.4, 0.1, 0, 0.3, 0.35, 0.3, 0.3, 0), a: 0.45, b: 0.65 },
  dash: { from: P(-1.0, -1.4, 0, 1.3, -0.6, 0.1, 0.4, 0), to: THRUST, a: 0.12, b: 0.3, dash: [6, 0.12, 0.5], iframes: 0.7 },
  lunge: { from: P(-1.2, -0.3, 0, 1.5, -0.4, -0.1, 0.5, 0), to: THRUST, a: 0.25, b: 0.4, dash: [5, 0.25, 0.6], iframes: 0.65 },
  slam: { from: P(-3.35, -0.12, 0, 1.45, 0, -0.28, -3.2, 0.15), to: P(-0.75, -0.05, 0, 1.0, 0, 0.42, -0.9, 0.2), a: 0.42, b: 0.52 },
  leap: { from: P(-3.35, -0.12, 0, 1.45, 0, -0.28, -3.2, 0.15), to: P(-0.75, -0.05, 0, 1.0, 0, 0.42, -0.9, 0.2), a: 0.5, b: 0.62, dash: [2.5, 0.12, 0.6], hop: 1.8, iframes: 0.65 },
  wave: { from: P(-2.8, 0, 0, 0.9, 0, -0.2, -2.6, 0), to: P(-1.5, 0, 0, 1.3, 0, 0.3, -1.4, 0), a: 0.35, b: 0.5 },
  // иайдо: клинок у левого бедра, долгая пауза — и мгновенный широкий разрез с шагом вперёд
  iai: { from: P(-0.6, 0.9, 0, -0.2, 0.6, 0.25, 0.6, 0), to: P(-1.3, -1.6, 0, 1.35, -0.7, 0.1, 0.5, 0.3), a: 0.55, b: 0.62, dash: [3.5, 0.55, 0.62], iframes: 0.62 },
  berserk: { from: SPIN, to: SPIN, a: 0.08, b: 0.94, turns: 3, walk: 0.4 },
  // шквал: руки бьют по очереди (specialPose)
  flurry: { from: THRUST, to: THRUST, a: 0.1, b: 0.9, walk: 0.3 },
  mill: { from: SPIN, to: SPIN, a: 0.1, b: 0.9, turns: 2.5, dash: [4, 0.1, 0.9] },
};
const _tint = new THREE.Color();

const lerpPose = (a: Pose, b: Pose, k: number): Pose => ({
  ax: a.ax + (b.ax - a.ax) * k, ay: a.ay + (b.ay - a.ay) * k, az: a.az + (b.az - a.az) * k, w: a.w + (b.w - a.w) * k,
  twist: a.twist + (b.twist - a.twist) * k, lean: a.lean + (b.lean - a.lean) * k, lx: a.lx + (b.lx - a.lx) * k, ly: a.ly + (b.ly - a.ly) * k,
  wl: a.wl === undefined && b.wl === undefined ? undefined : (a.wl ?? a.w) + ((b.wl ?? b.w) - (a.wl ?? a.w)) * k,
});

export class Knight {
  readonly pos = new THREE.Vector3();
  /** Горизонтальная скорость, м/с */
  readonly vel = new THREE.Vector3();
  /** Вертикальная скорость, м/с */
  vy = 0;
  grounded = true;
  hp: number = HERO.hp;
  maxHp: number = HERO.hp;
  down = false;
  god = false;
  /** Куда смотрит, рад (0 — +Z) */
  yaw = 0;
  /** Фактическая скорость по перемещению, м/с (для телеметрии) */
  speed = 0;
  touching = false;

  /** Текущий удар комбо (0..2) или −1 */
  combo = -1;
  /** Сколько ударов сделано всего (для телеметрии и тестов) */
  swings = 0;
  private swingT = 0;
  private struck = false;
  private queued = false;
  /** После удара: сколько прошло (окно продолжения комбо) и перезарядка после добивающего */
  private sinceSwing = 99;
  private lastCombo = -1;
  private attackCd = 0;
  private hitStopT = 0;
  /** Идёт спец-удар: движение, время и направление */
  private sp: { move: SpecialMove; t: number; prev: number; dur: number; yaw: number } | null = null;
  /** Облик взмахов от закалки: три шага комбо и спец-удар; null — стандартные цвета */
  swingLooks: SwingLook[] | null = null;

  private rollT = 0;
  rollCdT = 0;
  /** Множители снаряжения (src/gear.ts): скорость ходьбы и перезарядка переката */
  speedMul = 1;
  /** Замедление от зон на полу (паутина мобов), 0..1 — выставляется каждый тик */
  slow = 0;
  /** Множитель получаемого урона (аура «Бастион») */
  dmgTakenMul = 1;
  rollCdMul = 1;
  private readonly rollDir = new THREE.Vector3();
  private hurtT = 0;
  private downT = 0;

  /** Удар достиг середины: вернуть, сколько целей задето (для заминки) */
  onStrike?: (s: Strike) => number;
  onSwing?: (step: number) => void;
  onLand?: (fallSpeed: number) => void;
  onRoll?: () => void;
  onStep?: () => void;

  readonly trail: SwordTrail;
  private simTime = 0;

  // анимация
  private phase = 0;
  private gait = 0;
  private lastStepSide = 0;
  private cape = 0.15;
  private readonly root = new THREE.Group();
  private readonly spin = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly arms: THREE.Group[] = [];
  private readonly capeG = new THREE.Group();
  private readonly sword = new THREE.Group();
  /** След клинка по Z кисти: от основания до кончика */
  private bladeBase = 0.22;
  private bladeTip = 0.24 + BLADE;
  private readonly flashMats: THREE.MeshLambertMaterial[] = [];
  /** Надетая броня — детали поверх тела (setArmor) */
  private armorMeshes: THREE.Object3D[] = [];
  private capeMat!: THREE.MeshLambertMaterial;
  private capeMap!: THREE.Texture;
  /** Второе оружие в левой руке (парные клинки, кастеты) и его след */
  private readonly offhand = new THREE.Group();
  readonly offTrail: SwordTrail;
  private offBase = 0.2;
  private offTip = 1;
  /** Стиль ударов надетого оружия (STYLE_OF) */
  style: SwingStyle = 'sword';
  /** Свой цвет следа оружия без закалки (WeaponDef.trail) */
  private weaponTrail: THREE.Color | null = null;
  /** Лук в левой руке: виден, пока стреляет (shootPose) */
  private readonly bow = new THREE.Group();
  private bowT = 0;
  private bowYaw = 0;

  constructor(scene: THREE.Scene, T: Textures) {
    // вспыхивают при уроне только материалы без своего свечения
    const lam = (o: THREE.MeshLambertMaterialParameters) => { const m = new THREE.MeshLambertMaterial(o); if (!o.emissive) this.flashMats.push(m); return m; };
    const M = {
      skin: lam({ map: T.skin }),
      face: lam({ map: T.face }),
      hairSide: lam({ map: T.hair }),
      hair: lam({ map: pixelTex('#6b3d1f', 8, 71) }),
      tunic: lam({ map: pixelTex('#2f9bc4', 9, 72) }),
      tunicDark: lam({ map: pixelTex('#23779a', 7, 73) }),
      pants: lam({ map: pixelTex('#3a4f7a', 7, 74) }),
      boot: lam({ map: pixelTex('#6e4528', 7, 75) }),
      belt: lam({ map: pixelTex('#7a4e26', 6, 76) }),
      gold: lam({ color: '#f2c040', emissive: '#f2a020', emissiveIntensity: 0.25 }),
      cape: lam({ map: pixelTex('#d23a5c', 9, 77), side: THREE.DoubleSide }),
      steel: lam({ map: pixelTex('#dfe8f2', 6, 78), emissive: '#7ad8ff', emissiveIntensity: 0.18 }),
      edge: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 2.2, 2.6), toneMapped: false }),
      grip: lam({ map: pixelTex('#5a3a22', 6, 79) }),
      gem: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.5, 1.1), toneMapped: false }),
    };
    scene.add(this.root);
    this.root.add(this.spin);
    this.spin.position.y = 0.9;
    this.spin.add(this.hips);
    this.hips.position.y = LEG - 0.9;

    // ноги: шарнир у таза
    for (const x of [0.135, -0.135]) {
      const leg = new THREE.Group();
      leg.position.set(x, 0, 0);
      leg.add(box(0.25, LEG - 0.14, 0.27, M.pants, 0, -(LEG - 0.14) / 2, 0));
      leg.add(box(0.27, 0.16, 0.31, M.boot, 0, -LEG + 0.08, 0.02));
      this.hips.add(leg);
      this.legs.push(leg);
    }

    // корпус: туника, пояс с пряжкой
    this.torso.rotation.order = 'YXZ';
    this.hips.add(this.torso);
    this.torso.add(box(0.54, BODY, 0.32, M.tunic, 0, BODY / 2, 0));
    this.torso.add(box(0.56, 0.14, 0.34, M.tunicDark, 0, 0.07, 0));
    this.torso.add(box(0.57, 0.08, 0.35, M.belt, 0, 0.17, 0));
    this.torso.add(box(0.1, 0.1, 0.03, M.gold, 0, 0.17, 0.18));
    this.torso.add(box(0.36, 0.08, 0.04, M.tunicDark, 0, BODY - 0.06, 0.15)); // ворот

    // голова: крупная, с чёлкой
    this.head.position.y = BODY;
    this.head.rotation.order = 'YXZ';
    this.torso.add(this.head);
    this.head.add(box(HEAD, HEAD, HEAD, [M.hairSide, M.hairSide, M.hair, M.skin, M.face, M.hair], 0, HEAD / 2, 0));
    this.head.add(box(HEAD + 0.04, 0.1, HEAD + 0.04, M.hair, 0, HEAD - 0.03, -0.01));
    this.head.add(box(HEAD + 0.04, 0.26, 0.1, M.hair, 0, HEAD - 0.17, -HEAD / 2 + 0.03)); // затылок

    // плащ: шарнир у плеч сзади
    this.capeG.position.set(0, BODY - 0.04, -0.17);
    this.torso.add(this.capeG);
    this.capeG.add(box(0.5, 0.78, 0.04, M.cape, 0, -0.39, 0));
    this.capeG.add(box(0.54, 0.06, 0.06, M.gold, 0, -0.01, 0.01));

    // руки: шарнир в плече, рука висит вниз; 0 — правая (−X), 1 — левая (+X)
    for (const x of [-SHOULDER_X, SHOULDER_X]) {
      const arm = new THREE.Group();
      arm.rotation.order = 'YXZ';
      arm.position.set(x, BODY - 0.08, 0);
      arm.add(box(0.21, ARM, 0.21, M.tunic, 0, -ARM / 2 + 0.06, 0));
      arm.add(box(0.23, 0.16, 0.23, M.tunicDark, 0, 0.0, 0)); // плечо
      arm.add(box(0.2, 0.12, 0.2, M.skin, 0, -ARM + 0.08, 0)); // кисть
      this.torso.add(arm);
      this.arms.push(arm);
    }

    // меч в правой руке: рукоять в кисти, клинок вдоль +Z кисти
    this.sword.position.set(0, -ARM + 0.08, 0);
    this.sword.rotation.order = 'XYZ';
    this.arms[0].add(this.sword);
    this.sword.add(box(0.07, 0.07, 0.24, M.grip, 0, 0, 0.02));
    this.sword.add(box(0.1, 0.1, 0.1, M.gem, 0, 0, -0.14)); // навершие
    this.sword.add(box(0.36, 0.08, 0.09, M.gold, 0, 0, 0.17)); // гарда
    this.sword.add(box(0.06, 0.15, BLADE, M.steel, 0, 0, 0.2 + BLADE / 2));
    this.sword.add(box(0.025, 0.17, BLADE - 0.08, M.edge, 0, 0, 0.18 + BLADE / 2));
    this.sword.add(box(0.05, 0.08, 0.08, M.steel, 0, 0, 0.24 + BLADE)); // кончик

    this.capeMat = M.cape;
    this.capeMap = M.cape.map as THREE.Texture;

    // лук в левой кисти: дуги вдоль Z кисти (при поднятой руке — вертикально), тетива ближе к плечу
    this.bow.position.set(0, -ARM + 0.08, 0);
    this.bow.visible = false;
    this.arms[1].add(this.bow);

    this.offhand.position.set(0, -ARM + 0.08, 0);
    this.offhand.rotation.order = 'XYZ';
    this.arms[1].add(this.offhand);

    this.trail = new SwordTrail(scene);
    this.offTrail = new SwordTrail(scene);
    this.animate(0);
  }

  /** Надеть броню: нагрудник, наплечники, головной убор, подол, цвет плаща; null — без брони */
  setArmor(look: ArmorLook | null): void {
    for (const o of this.armorMeshes) {
      o.parent?.remove(o);
      o.traverse((c) => { if (c instanceof THREE.Mesh) { c.geometry.dispose(); const m = c.material as THREE.Material; const i = this.flashMats.indexOf(m as THREE.MeshLambertMaterial); if (i >= 0) this.flashMats.splice(i, 1); m.dispose(); } });
    }
    this.armorMeshes = [];
    this.capeMat.map = look?.cape ? pixelTex(look.cape, 9, 77) : this.capeMap;
    this.capeMat.needsUpdate = true;
    if (!look) return;
    const mat = (c: string, n = 7): THREE.MeshLambertMaterial => { const m = new THREE.MeshLambertMaterial({ map: pixelTex(c, n, 90) }); this.flashMats.push(m); return m; };
    const add = (parent: THREE.Object3D, ...ms: THREE.Mesh[]): void => { for (const m of ms) { parent.add(m); this.armorMeshes.push(m); } };
    const body = mat(look.body), trim = mat(look.trim, 5);
    // нагрудник поверх туники, пояс и ворот
    add(this.torso, box(0.6, 0.5, 0.38, body, 0, BODY - 0.26, 0), box(0.62, 0.09, 0.4, trim, 0, BODY - 0.5, 0), box(0.42, 0.07, 0.06, trim, 0, BODY - 0.04, 0.19));
    if (look.glow) add(this.torso, box(0.13, 0.13, 0.04, new THREE.MeshBasicMaterial({ color: new THREE.Color(look.glow).multiplyScalar(2.6), toneMapped: false }), 0, BODY - 0.27, 0.2));
    // рукава и наплечники
    for (const arm of this.arms) {
      add(arm, box(0.235, 0.3, 0.235, body, 0, -0.1, 0));
      if (look.pauldron) { const p = mat(look.pauldron); add(arm, box(0.31, 0.13, 0.31, p, 0, 0.08, 0), box(0.32, 0.04, 0.32, trim, 0, 0.02, 0)); }
    }
    if (look.skirt) add(this.hips, box(0.6, 0.4, 0.38, mat(look.skirt), 0, -0.16, 0));
    const h = look.head;
    if (h) {
      const c = mat(h.color), W = HEAD + 0.1;
      // капюшон, шлем, волчья голова: верх, бока и затылок, лицо открыто
      if (h.kind === 'cap') add(this.head, box(HEAD + 0.06, 0.16, HEAD + 0.06, c, 0, HEAD - 0.02, 0), box(HEAD + 0.06, 0.04, 0.14, c, 0, HEAD - 0.09, HEAD / 2 + 0.06));
      else {
        add(this.head,
          box(W, 0.12, W, c, 0, HEAD + 0.03, 0),
          box(0.06, HEAD - 0.06, W, c, W / 2 - 0.03, HEAD / 2 + 0.03, 0), box(0.06, HEAD - 0.06, W, c, -W / 2 + 0.03, HEAD / 2 + 0.03, 0),
          box(W, HEAD - 0.06, 0.06, c, 0, HEAD / 2 + 0.03, -W / 2 + 0.03));
        if (h.kind === 'hood') add(this.head, box(0.22, 0.2, 0.18, c, 0, HEAD - 0.06, -W / 2 - 0.06));
        if (h.kind === 'helmet') {
          const a = mat(h.accent ?? h.color, 5);
          add(this.head, box(0.07, 0.22, 0.05, c, 0, HEAD * 0.52, W / 2 - 0.01), box(0.09, 0.12, W * 0.85, a, 0, HEAD + 0.14, 0), box(W, 0.05, 0.05, a, 0, HEAD - 0.06, W / 2 - 0.02));
        }
        if (h.kind === 'wolf') {
          const a = mat(h.accent ?? h.color, 5), eye = new THREE.MeshBasicMaterial({ color: '#1c1a2e' });
          add(this.head, box(0.12, 0.16, 0.08, c, -0.2, HEAD + 0.15, 0.05), box(0.12, 0.16, 0.08, c, 0.2, HEAD + 0.15, 0.05),
            box(0.3, 0.15, 0.22, a, 0, HEAD + 0.05, W / 2 + 0.05), box(0.05, 0.05, 0.02, eye, -0.09, HEAD + 0.1, W / 2 + 0.165), box(0.05, 0.05, 0.02, eye, 0.09, HEAD + 0.1, W / 2 + 0.165));
        }
      }
    }
  }

  /** Лук (дальнее оружие) — модель в левой руке; null — нет лука */
  setBow(look: BowLook | null): void {
    for (const c of [...this.bow.children]) { this.bow.remove(c); disposeWeaponModel(c); }
    if (!look) return;
    const k = look.size ?? 1;
    const wood = new THREE.MeshLambertMaterial({ map: pixelTex(look.wood, 7, 91) });
    const str = new THREE.MeshBasicMaterial({ color: look.string });
    const glow = look.glow ? new THREE.MeshBasicMaterial({ color: new THREE.Color(look.glow).multiplyScalar(2.4), toneMapped: false }) : null;
    if (look.kind === 'crossbow') {
      // ложе вперёд по руке (−Y кисти), плечи дуги — поперёк, тетива чуть ближе
      this.bow.add(box(0.08, 0.62, 0.09, wood, 0, -0.2, 0));
      this.bow.add(box(0.66, 0.07, 0.07, new THREE.MeshLambertMaterial({ color: '#5a5f6a' }), 0, -0.46, 0));
      this.bow.add(box(0.62, 0.015, 0.015, str, 0, -0.36, 0));
      this.bow.add(box(0.03, 0.4, 0.03, new THREE.MeshLambertMaterial({ color: '#c6d0dc' }), 0, -0.3, 0.06));
      return;
    }
    // дуга из коробок: плечи изогнуты вперёд (−Y кисти), тетива — прямая
    const L = 0.46 * k;
    for (let i = -3; i <= 3; i++) {
      const z = (i / 3.5) * L, y = -0.13 * (1 - (i / 3.5) ** 2) * k;
      this.bow.add(box(0.06, 0.07, L / 3.2, i === 0 ? new THREE.MeshLambertMaterial({ color: '#3d2616' }) : (glow && Math.abs(i) === 3 ? glow : wood), 0, y, z));
    }
    this.bow.add(box(0.015, 0.015, L * 1.85, str, 0, 0.02, 0));
  }

  /** Выстрел: на sec секунд герой разворачивается к yaw, левая рука с луком вперёд, правая натягивает тетиву */
  shootPose(yaw: number, sec = 0.45): void { this.bowT = sec; this.bowYaw = yaw; this.yaw = yaw; }

  // ---------- состояние ----------

  get rolling(): boolean { return this.rollT > 0; }
  get attacking(): boolean { return this.combo >= 0; }
  get invulnerable(): boolean {
    const sp = this.sp, fr = sp ? SPECIALS[sp.move].iframes ?? 0 : 0;
    return this.god || (this.rolling && HERO.rollTime - this.rollT < HERO.rollIframes) || (!!sp && sp.t / sp.dur < fr);
  }
  /** Спец-удар, который идёт сейчас, и его доля 0..1 (−1 — нет) */
  get special(): SpecialMove | null { return this.sp?.move ?? null; }
  get specialK(): number { return this.sp ? Math.min(1, this.sp.t / this.sp.dur) : -1; }
  /** Оружие в руке спрятано (летит бумерангом) */
  set weaponHidden(v: boolean) { this.sword.visible = !v; }
  get weaponHidden(): boolean { return !this.sword.visible; }
  get object(): THREE.Object3D { return this.root; }
  /** Деталей брони на теле (для тестов) */
  get armorParts(): number { return this.armorMeshes.length; }
  /** Лук в руке виден (стреляет) */
  get bowShown(): boolean { return this.bow.visible; }

  get state(): KnightState {
    if (this.down) return 'без сил';
    if (this.rolling) return 'перекат';
    if (this.sp) return 'спец-удар';
    if (this.combo >= 0) return (['удар 1', 'удар 2', 'удар 3'] as const)[this.combo];
    if (!this.grounded) return 'падает';
    return this.speed > 0.3 ? 'идёт' : 'стоит';
  }

  hurt(d: number): boolean {
    if (this.down || this.invulnerable) return false;
    this.hp = Math.max(0, this.hp - d * this.dmgTakenMul);
    this.hurtT = 0.15;
    if (this.hp <= 0) { this.down = true; this.downT = 0; this.cancelSwing(); }
    return true;
  }

  revive(): void { this.down = false; this.hp = this.maxHp; }

  place(x: number, z: number, yaw = 0, y = 0): void {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.grounded = true;
    this.yaw = yaw;
    this.cancelSwing();
    this.sp = null;
    this.sword.visible = true;
  }

  /** Сменить модель оружия в руке (числа удара — applyWeapon из weapons.ts) */
  setWeapon(def: WeaponDef): void {
    for (const c of [...this.sword.children]) { this.sword.remove(c); disposeWeaponModel(c); }
    const g = buildWeaponModel(def);
    for (const c of [...g.children]) this.sword.add(c);
    this.bladeBase = g.userData.bladeBase as number;
    this.bladeTip = g.userData.bladeTip as number;
    for (const c of [...this.offhand.children]) { this.offhand.remove(c); disposeWeaponModel(c); }
    if (def.offhand?.length) {
      const o = buildWeaponModel(def, true);
      for (const c of [...o.children]) this.offhand.add(c);
      this.offBase = o.userData.bladeBase as number;
      this.offTip = o.userData.bladeTip as number;
    }
    this.weaponTrail = def.trail ? new THREE.Color(def.trail).multiplyScalar(2.4) : null;
    this.style = STYLE_OF[def.category] ?? 'sword';
    const oc = new THREE.Color(def.offTrail ?? def.trail ?? '#b98cff').multiplyScalar(2.4);
    this.offTrail.color.copy(oc); this.offTrail.color2.copy(oc).multiplyScalar(0.6);
  }

  /** Есть оружие во второй руке */
  get dual(): boolean { return this.offhand.children.length > 0; }

  /**
   * Закалка красит клинок: светящиеся грани и свечение стали — в цвет color (HDR), яркость ×glow; позолота и рукоять
   * не меняются. null — исходные цвета модели
   */
  setBladeTint(color: THREE.Color | null, glow = 1): void {
    const peak = color ? Math.max(color.r, color.g, color.b, 1e-3) : 1;
    for (const c of this.sword.children) {
      if (!(c instanceof THREE.Mesh)) continue;
      const m = c.material;
      if (m instanceof THREE.MeshBasicMaterial) {
        const c0 = (m.userData.c0 ??= m.color.clone()) as THREE.Color;
        if (!color) { m.color.copy(c0); continue; }
        const b0 = Math.max(c0.r, c0.g, c0.b);
        m.color.copy(_tint.copy(color).multiplyScalar((b0 / peak) * glow));
      } else if (m instanceof THREE.MeshLambertMaterial && m.map && m.emissiveIntensity > 0) {
        const e0 = (m.userData.e0 ??= { c: m.emissive.clone(), i: m.emissiveIntensity }) as { c: THREE.Color; i: number };
        if (!color) { m.emissive.copy(e0.c); m.emissiveIntensity = e0.i; continue; }
        m.emissive.copy(_tint.copy(color).multiplyScalar(1 / peak));
        m.emissiveIntensity = e0.i + 0.35 * glow;
      }
    }
  }

  /** Начать спец-удар: dur секунд, в сторону yaw. Не начнётся в перекате, без сил и во время другого */
  startSpecial(move: SpecialMove, dur: number, yaw: number): boolean {
    if (this.down || this.rolling || this.sp) return false;
    this.cancelSwing();
    this.sp = { move, t: 0, prev: 0, dur, yaw };
    this.yaw = yaw;
    this.trail.cut();
    this.lookTrail(3, SWINGS[2].trail, 1);
    if (move === 'spin' || move === 'reap') { this.trail.life = 0.24; this.trail.core *= 0.5; }
    return true;
  }

  private lookTrail(i: number, color: THREE.Color, width: number): void {
    const L = this.swingLooks?.[i];
    const base = this.weaponTrail ?? color;
    this.trail.color.copy(L?.color ?? base);
    this.trail.color2.copy(L?.color2 ?? base);
    this.offTrail.cut();
    // у длинных клинков след не шире 1,1 м — иначе лента сливается в стену
    this.trail.width = Math.min(L?.width ?? width, 1.1 / Math.max(0.3, this.bladeTip - this.bladeBase));
    this.trail.life = L?.life ?? 0.2;
    this.trail.core = L?.core ?? 0.25;
  }

  /** Основание и кончик клинка в мире */
  blade(base = new THREE.Vector3(), tip = new THREE.Vector3()): { base: THREE.Vector3; tip: THREE.Vector3 } {
    this.root.updateMatrixWorld(true);
    base.set(0, 0, this.bladeBase).applyMatrix4(this.sword.matrixWorld);
    tip.set(0, 0, this.bladeTip).applyMatrix4(this.sword.matrixWorld);
    return { base, tip };
  }

  // ---------- симуляция ----------

  /** solids — плоские препятствия (предметы), terrain — блоки уровня: ступени, высота, обрывы */
  update(dt: number, input: KnightInput, solids: readonly Obstacle[], terrain?: Terrain): void {
    const H = HERO;
    this.simTime += dt;
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.rollCdT = Math.max(0, this.rollCdT - dt);
    this.bowT = Math.max(0, this.bowT - dt);
    if (this.down) {
      this.downT += dt;
      this.vel.set(0, 0, 0);
      this.speed = 0;
      this.animate(dt);
      return;
    }

    const mv = new THREE.Vector3(input.move.x, 0, input.move.y);
    const moving = mv.lengthSq() > 0.01;
    if (mv.lengthSq() > 1) mv.normalize();
    const moveDir = moving ? mv.clone().normalize() : null;
    const toAim = new THREE.Vector3(input.aim.x - this.pos.x, 0, input.aim.z - this.pos.z);
    const aimYaw = toAim.lengthSq() > 0.04 ? Math.atan2(toAim.x, toAim.z) : this.yaw;

    // перекат: отменяет удар, неуязвимость в начале
    if (input.roll && !this.rolling && this.rollCdT <= 0 && !this.sp) {
      this.rollDir.copy(moveDir ?? new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)));
      this.rollT = H.rollTime;
      this.rollCdT = H.rollCd * this.rollCdMul;
      this.cancelSwing();
      this.onRoll?.();
    }

    if (this.sp) this.updateSpecial(dt); else this.updateSword(dt, input, aimYaw);

    const prev = this.pos.clone();
    const sp = this.sp;
    if (sp) {
      // спец-удар: рывок по своей кривой, обороты вокруг себя, во вихре можно идти
      const S = SPECIALS[sp.move], k0 = sp.prev / sp.dur, k1 = sp.t / sp.dur;
      const fwd = new THREE.Vector3(Math.sin(sp.yaw), 0, Math.cos(sp.yaw));
      if (S.dash) {
        const [d, a, b] = S.dash;
        const step = (smooth((k1 - a) / (b - a)) - smooth((k0 - a) / (b - a))) * d;
        this.pos.addScaledVector(fwd, step);
        this.vel.copy(fwd).multiplyScalar(dt > 0 ? step / dt : 0);
      } else {
        const want = moveDir && S.walk ? moveDir.clone().multiplyScalar(H.walk * this.speedMul * S.walk * (1 - this.slow)) : new THREE.Vector3();
        this.vel.lerp(want, damp(10, dt));
        this.pos.addScaledVector(this.vel, dt);
      }
      this.yaw = S.turns ? wrap(sp.yaw + S.turns * Math.PI * 2 * smooth((k1 - S.a) / (S.b - S.a))) : sp.yaw;
    } else if (this.rolling) {
      const step = Math.min(dt, this.rollT);
      this.vel.copy(this.rollDir).multiplyScalar(H.rollDist / H.rollTime);
      this.pos.addScaledVector(this.vel, step);
      this.rollT -= dt;
      if (this.rollT <= 0) { this.rollT = 0; this.vel.multiplyScalar(H.walk / (H.rollDist / H.rollTime)); }
      this.yaw = Math.atan2(this.rollDir.x, this.rollDir.z);
    } else {
      let target = H.walk * this.speedMul * (1 - this.slow);
      if (this.attacking) target *= H.attackMove;
      const want = moveDir ? moveDir.clone().multiplyScalar(target * Math.min(1, mv.length())) : new THREE.Vector3();
      const diff = want.clone().sub(this.vel);
      const rate = (moveDir ? H.accel : H.decel) * (this.grounded ? 1 : H.airControl) * dt;
      if (diff.length() > rate) diff.setLength(rate);
      this.vel.add(diff);
      this.pos.addScaledVector(this.vel, dt);
      // поворот: в ударе — к курсору, иначе — по ходу
      const faceTo = this.attacking ? aimYaw : this.bowT > 0 ? this.bowYaw : moveDir ? Math.atan2(moveDir.x, moveDir.z) : this.yaw;
      this.yaw = wrap(this.yaw + wrap(faceTo - this.yaw) * damp(this.attacking ? H.turnRate * 1.6 : H.turnRate, dt));
    }

    // выпад во время удара
    if (this.combo >= 0 && this.hitStopT <= 0) {
      const S = SWORD.swings[this.combo];
      const a = S.windup, b = S.windup + S.strike;
      const k0 = (this.swingT - dt) / S.time, k1 = this.swingT / S.time;
      const lunge = (smooth((k1 - a) / (b - a)) - smooth((k0 - a) / (b - a))) * S.lunge;
      if (lunge > 0) this.pos.add(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(lunge));
    }

    this.touching = resolveCircle(this.pos, H.radius, solids);
    if (terrain) {
      if (terrain.resolve(this.pos, H.radius)) this.touching = true;
      this.vertical(dt, terrain);
    } else this.pos.y = 0;
    this.speed = dt > 0 ? Math.hypot(this.pos.x - prev.x, this.pos.z - prev.z) / dt : 0;
    if (this.touching && dt > 0) this.vel.set(this.pos.x - prev.x, 0, this.pos.z - prev.z).divideScalar(dt);

    this.animate(dt);
    this.sampleTrail();
  }

  /** Гравитация, приземление, шаг вниз по ступеням, падение с обрыва */
  private vertical(dt: number, terrain: Terrain): void {
    const H = HERO;
    const floorOf = (y: number): number => { const f = terrain.floorAt(this.pos.x, this.pos.z, y); return f === -Infinity ? 0 : f; };
    if (this.grounded) {
      const floor = floorOf(this.pos.y);
      if (floor >= this.pos.y - 1e-3) this.pos.y = floor; // ступень вверх
      else if (this.pos.y - floor <= STEP + 0.02) this.pos.y = floor; // ступень вниз — без полёта
      else { this.grounded = false; this.vy = 0; }
      return;
    }
    this.vy -= H.gravity * dt;
    this.pos.y += this.vy * dt;
    if (this.vy <= 0) {
      const floor = floorOf(this.pos.y);
      if (this.pos.y <= floor) {
        const fall = -this.vy;
        this.pos.y = floor;
        this.vy = 0;
        this.grounded = true;
        this.onLand?.(fall);
      }
    }
  }

  // ---------- меч ----------

  private startSwing(step: number, aimYaw: number): void {
    this.combo = step;
    this.swingT = 0;
    this.struck = false;
    this.queued = false;
    this.swings++;
    this.yaw = aimYaw; // удар — туда, куда смотрит курсор
    this.trail.cut();
    this.lookTrail(step, SWINGS[step].trail, SWINGS[step].width);
    this.onSwing?.(step);
  }

  private updateSpecial(dt: number): void {
    const sp = this.sp!;
    sp.prev = sp.t;
    sp.t += dt;
    if (sp.t >= sp.dur) {
      this.sp = null;
      this.lastCombo = -1;
      this.sinceSwing = 99;
      this.attackCd = 0.12;
    }
  }

  private cancelSwing(): void {
    if (this.combo >= 0) this.lastCombo = -1;
    this.combo = -1;
    this.queued = false;
    this.hitStopT = 0;
  }

  private updateSword(dt: number, input: KnightInput, aimYaw: number): void {
    this.attackCd = Math.max(0, this.attackCd - dt);
    if (this.combo < 0) {
      this.sinceSwing += dt;
      if (this.sinceSwing > SWORD.comboWindow) this.lastCombo = -1;
      if (input.attack && !this.rolling && this.attackCd <= 0) this.startSwing((this.lastCombo + 1) % 3, aimYaw);
      return;
    }
    // заминка при попадании: удар замирает на миг
    if (this.hitStopT > 0) { this.hitStopT -= dt; return; }
    const S = SWORD.swings[this.combo];
    this.swingT += dt;
    const k = this.swingT / S.time;
    if (input.attack && k > 0.25) this.queued = true;
    if (!this.struck && k >= S.windup + S.strike * 0.5) {
      this.struck = true;
      const from = this.pos.clone().setY(this.pos.y + 1);
      const n = this.onStrike?.({ step: this.combo, from, yaw: this.yaw, range: S.range, half: THREE.MathUtils.degToRad(S.arc / 2), dmg: S.dmg, knock: S.knock }) ?? 0;
      if (n > 0) this.hitStopT = SWORD.hitStop * (this.combo === 2 ? 1.8 : 1);
    }
    if (this.queued && this.combo < 2 && k >= SWORD.chainFrom) { this.startSwing(this.combo + 1, aimYaw); return; }
    if (k >= 1) {
      this.lastCombo = this.combo;
      if (this.combo === 2) { this.attackCd = SWORD.finisherCd; this.lastCombo = -1; }
      this.combo = -1;
      this.sinceSwing = 0;
    }
  }

  /** Точки следа берутся, пока клинок летит: от конца замаха до чуть после удара */
  private sampleTrail(): void {
    const sp = this.sp;
    if (sp && sp.move !== 'throw') {
      const S = SPECIALS[sp.move], k = sp.t / sp.dur;
      if (k >= S.a * 0.8 && k <= S.b + 0.08) {
        const { base, tip } = this.blade();
        this.trail.push(base, tip, this.simTime);
        this.sampleOff();
      }
    } else if (this.combo >= 0) {
      const S = SWORD.swings[this.combo];
      const k = this.swingT / S.time;
      if (k >= S.windup * 0.8 && k <= S.windup + S.strike + 0.08) {
        const { base, tip } = this.blade();
        this.trail.push(base, tip, this.simTime);
        this.sampleOff();
      }
    }
    this.trail.update(this.simTime);
    this.offTrail.update(this.simTime);
  }

  /** След второго оружия */
  private sampleOff(): void {
    if (!this.dual || !this.offhand.visible) return;
    const b = new THREE.Vector3(0, 0, this.offBase).applyMatrix4(this.offhand.matrixWorld);
    const t = new THREE.Vector3(0, 0, this.offTip).applyMatrix4(this.offhand.matrixWorld);
    this.offTrail.push(b.lerp(t, 1 - this.offTrail.width), t, this.simTime);
  }

  // ---------- анимация ----------

  /** Поза удара по доле k: замах → удар → возврат */
  private swingPose(step: number, k: number): Pose {
    const S = SWORD.swings[step], [from, to] = STYLES[this.style][step];
    const a = S.windup, b = S.windup + S.strike;
    if (k < a) return lerpPose(IDLE, from, smooth(k / a));
    if (k < b) return lerpPose(from, to, outCubic((k - a) / (b - a)));
    return lerpPose(to, IDLE, smooth((k - b) / (1 - b)));
  }

  /** Поза спец-удара по доле k: замах → удар → возврат */
  private specialPose(move: SpecialMove, k: number): Pose {
    const S = SPECIALS[move];
    if (move === 'flurry' && k >= S.a && k < S.b) {
      // руки по очереди: правая — укол, левая — замах, и наоборот, восемь ударов
      const ph = Math.sin(((k - S.a) / (S.b - S.a)) * Math.PI * 8);
      const r = Math.max(0, ph), l = Math.max(0, -ph);
      return P(-0.9 - r * 0.8, -0.15 + r * 0.3, 0, 0.7 + r * 0.8, 0.35 * (r - l), 0.25, -0.9 - l * 0.8, -0.2 * l);
    }
    if (k < S.a) return lerpPose(IDLE, S.from, smooth(k / S.a));
    if (k < S.b) return lerpPose(S.from, S.to, outCubic((k - S.a) / (S.b - S.a)));
    return lerpPose(S.to, IDLE, smooth((k - S.b) / (1 - S.b)));
  }

  private animate(dt: number): void {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;

    // шаг
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const walking = this.grounded && !this.rolling && sp > 0.3;
    this.gait += ((walking ? Math.min(1, sp / HERO.walk + 0.25) : 0) - this.gait) * damp(10, dt);
    if (walking) {
      this.phase += (sp * dt / HERO.step) * Math.PI;
      const side = Math.sin(this.phase) > 0 ? 1 : -1;
      if (side !== this.lastStepSide) { this.lastStepSide = side; this.onStep?.(); }
    }
    const s = Math.sin(this.phase) * this.gait;
    const bob = Math.abs(Math.cos(this.phase)) * 0.05 * this.gait;

    // ноги: ходьба, поджатые в падении
    const air = !this.grounded && !this.rolling;
    const tuck = air ? THREE.MathUtils.clamp(0.4 + this.vy * 0.05, 0.1, 0.8) : 0;
    this.legs[0].rotation.x = s * 0.75 - tuck * 0.9;
    this.legs[1].rotation.x = -s * 0.75 + tuck * 0.4;
    this.hips.position.y = LEG - 0.9 + bob;

    // перекат: кувырок вперёд вокруг середины тела
    if (this.rolling) {
      const k = 1 - this.rollT / HERO.rollTime;
      this.spin.rotation.x = smooth(k) * Math.PI * 2;
      this.spin.position.y = 0.9 - Math.sin(k * Math.PI) * 0.35;
      this.legs[0].rotation.x = this.legs[1].rotation.x = -1.2 * Math.sin(k * Math.PI);
    } else {
      this.spin.rotation.x = 0;
      this.spin.position.y = 0.9;
    }
    // прыжок спец-удара: тело взлетает и падает к моменту удара
    const spc = this.sp, SP = spc ? SPECIALS[spc.move] : null;
    if (spc && SP?.hop) {
      const k = spc.t / spc.dur, a = 0.1;
      this.spin.position.y += Math.sin(Math.PI * THREE.MathUtils.clamp((k - a) / (SP.b - a), 0, 1)) * SP.hop;
    }

    // руки и корпус: удар или ходьба
    let pose: Pose;
    if (spc) pose = this.specialPose(spc.move, spc.t / spc.dur);
    else if (this.combo >= 0) pose = this.swingPose(this.combo, this.swingT / SWORD.swings[this.combo].time);
    else {
      pose = { ...IDLE };
      pose.ax += -s * 0.35;
      pose.lx = s * 0.6;
      if (air) { pose.ax -= 0.5; pose.az += 0.35; pose.lx = -0.6; }
      if (this.rolling) { pose.ax = -1.4; pose.lx = -1.4; }
    }
    const aiming = this.bowT > 0 && this.combo < 0 && !this.rolling && !this.down;
    if (aiming) { pose.lx = -1.55; pose.ly = 0.25; pose.ax = -1.5; pose.ay = -0.55; pose.az = 0; pose.twist = 0.25; }
    this.bow.visible = aiming && this.bow.children.length > 0;
    this.offhand.visible = !this.bow.visible;
    // второе оружие держится как первое: в стойке — вперёд-вверх, в ударе — вдоль руки
    this.offhand.rotation.x = spc || this.combo >= 0 ? pose.wl ?? pose.w : -0.45;
    const R = this.arms[0], L = this.arms[1];
    R.rotation.set(pose.ax, pose.ay, pose.az);
    L.rotation.set(pose.lx, pose.ly, aiming ? 0 : air && this.combo < 0 ? -0.35 : -0.08);
    this.sword.rotation.x = pose.w;
    this.torso.rotation.y = pose.twist;
    this.torso.rotation.x = pose.lean + (walking ? 0.06 : 0);
    this.head.rotation.y = -pose.twist * 0.5;
    this.head.rotation.x = -pose.lean * 0.4;

    // плащ развевается от скорости и в падении
    const capeWant = 0.12 + Math.min(sp, 7) * 0.09 + (air ? 0.25 + Math.max(0, -this.vy) * 0.04 : 0) + (this.combo === 2 || spc ? 0.3 : 0);
    this.cape += (capeWant - this.cape) * damp(8, dt);
    this.capeG.rotation.x = this.cape + Math.sin(this.simTime * 7) * 0.03 * (0.3 + this.gait);

    // вспышка при уроне, бледность без сил
    const flash = this.hurtT > 0 ? 0.6 : 0;
    for (const m of this.flashMats) m.emissive.setRGB(flash, flash * 0.3, flash * 0.3);
    if (this.down) { this.spin.rotation.z = Math.min(1, this.downT * 4) * 1.4; this.spin.position.y = 0.3; } else this.spin.rotation.z = 0;
  }
}
