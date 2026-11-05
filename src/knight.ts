import * as THREE from 'three';
import { resolveCircle, type Obstacle } from './collision.ts';
import { STEP, type Terrain } from './level/collide.ts';
import { pixelTex, type Textures } from './textures.ts';
import { SwordTrail } from './trail.ts';
import { HERO, SWORD } from './tuning.ts';
import { buildWeaponModel, disposeWeaponModel, type WeaponCategory, type WeaponDef } from './weapons.ts';
import type { ArmorLook, BowLook } from './items.ts';

/**
 * Hero: a blocky character in the spirit of Minecraft Dungeons (big head, short arms and legs, cloak) with a standard sword.
 * Walking, dodge roll, falling off cliffs; the sword is a three-hit combo with a glowing blade trail.
 * No jump, as in Minecraft Dungeons: height changes are stairs and half-blocks.
 * The simulation (update) reads only KnightInput — for future networking. Animation is procedural: parts rotate as wholes.
 */

export interface KnightInput {
  /** Movement direction in the world (x, z), length 0..1 (keys or a path to the click point — the scene decides) */
  move: THREE.Vector2;
  /** Cursor point on the ground: the hero strikes there */
  aim: THREE.Vector3;
  /** LMB held: strike, holding continues the combo */
  attack: boolean;
  /** Press (true for one frame) */
  roll: boolean;
}

export function emptyInput(): KnightInput {
  return { move: new THREE.Vector2(), aim: new THREE.Vector3(0, 0, 5), attack: false, roll: false };
}

/** The strike reached mid-swing: who got hit is decided by the scene */
export interface Strike {
  /** Hit number in the combo: 0, 1, 2 (finisher) */
  step: number;
  /** Strike centre — the hero's chest */
  from: THREE.Vector3;
  yaw: number;
  range: number;
  /** Arc half-width, rad */
  half: number;
  dmg: number;
  knock: number;
}

export type KnightState = 'idle' | 'walk' | 'fall' | 'roll' | 'hit 1' | 'hit 2' | 'hit 3' | 'art' | 'exhausted';

/** Weapon art (Q, src/weapon-arts.ts): hero movement and pose; who got hit is decided by the scene from the specialK fraction */
export type SpecialMove = 'spin' | 'throw' | 'dash' | 'lunge' | 'slam' | 'leap' | 'wave' | 'reap' | 'iai' | 'berserk' | 'flurry' | 'mill';

/** Swing look from the temper (src/weapon-arts.ts): trail colours, width and point life */
export interface SwingLook { color: THREE.Color; color2: THREE.Color; width: number; life: number; core: number }

// ---------- model dimensions, m ----------
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
 * Arm and torso pose in a strike: ax/ay/az — right shoulder, w — wrist (blade tilt), twist/lean — torso, lx/ly — left
 * shoulder, wl — tilt of the second blade in the left wrist (dual weapons; without one — same as w)
 */
interface Pose { ax: number; ay: number; az: number; w: number; twist: number; lean: number; lx: number; ly: number; wl?: number }
const P = (ax: number, ay: number, az: number, w: number, twist = 0, lean = 0, lx = 0.25, ly = 0, wl?: number): Pose => ({ ax, ay, az, w, twist, lean, lx, ly, wl });
const IDLE = P(-0.35, -0.1, 0.12, -0.45);
/** Standard colours and trail width of the three combo steps */
const SWINGS: { from: Pose; to: Pose; trail: THREE.Color; width: number }[] = [
  // left to right on screen: from the right shoulder across the chest to the left, slightly top-down
  { from: P(-1.95, -1.6, 0, 1.3, -0.6, 0.05, 0.5, 0.3), to: P(-1.15, 0.95, 0, 1.25, 0.55, 0.12, -0.2, 0), trail: new THREE.Color(0.6, 1.5, 3.0), width: 0.8 },
  // backhand: left to right, bottom-up
  { from: P(-1.3, 1.0, 0, 1.3, 0.65, 0.1, -0.2, 0), to: P(-1.85, -1.75, 0, 1.3, -0.55, 0.05, 0.5, 0.3), trail: new THREE.Color(1.5, 0.9, 3.0), width: 0.8 },
  // finisher: top-down with both hands, with a lunge
  { from: P(-3.35, -0.12, 0, 1.45, 0, -0.28, -3.2, 0.15), to: P(-0.75, -0.05, 0, 1.0, 0, 0.42, -0.9, 0.2), trail: new THREE.Color(3.2, 1.9, 0.5), width: 0.95 },
];

/**
 * Strike style of a weapon category (wiki/design-weapon-arts.md, section 5): each has its own three combo hits, wind-up → strike.
 * Sword — left, right, overhead; heavy — a wide body turn and a two-handed strike with a deep wind-up; katana —
 * a draw from the left hip, a diagonal cut, a vertical one with a step; thrust — three stabs forward; dagger — short backhand
 * swings and a stab; polearm — a low wide two-handed sweep, a high backhand, a chop from above; dual — right,
 * left, both crosswise; fists — right and left straights and an uppercut
 */
export type SwingStyle = 'sword' | 'heavy' | 'katana' | 'thrust' | 'dagger' | 'pole' | 'dual' | 'fist';
export const STYLE_OF: Record<WeaponCategory, SwingStyle> = {
  'sword': 'sword', 'axe': 'heavy', 'mace': 'heavy', 'hammer': 'heavy', 'greatsword': 'heavy', 'dagger': 'dagger',
  'spear': 'thrust', 'rapier': 'thrust', 'staff': 'pole', 'scythe': 'pole', 'halberd': 'pole', 'katana': 'katana',
  'dual blades': 'dual', 'knuckles': 'fist',
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
 * Weapon arts: wind-up from → strike to over the fraction [a, b] of the duration. dash — a dash [metres, from fraction, to fraction], turns — spins
 * over [a, b], hop — jump height, iframes — invulnerable up to this fraction, walk — fraction of walking speed during the art
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
  // iaido: blade at the left hip, a long pause — and an instant wide cut with a step forward
  iai: { from: P(-0.6, 0.9, 0, -0.2, 0.6, 0.25, 0.6, 0), to: P(-1.3, -1.6, 0, 1.35, -0.7, 0.1, 0.5, 0.3), a: 0.55, b: 0.62, dash: [3.5, 0.55, 0.62], iframes: 0.62 },
  berserk: { from: SPIN, to: SPIN, a: 0.08, b: 0.94, turns: 3, walk: 0.4 },
  // flurry: the arms strike in turn (specialPose)
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
  /** Horizontal speed, m/s */
  readonly vel = new THREE.Vector3();
  /** Vertical speed, m/s */
  vy = 0;
  grounded = true;
  hp: number = HERO.hp;
  maxHp: number = HERO.hp;
  down = false;
  god = false;
  /** Facing, rad (0 — +Z) */
  yaw = 0;
  /** Actual speed by displacement, m/s (for telemetry) */
  speed = 0;
  touching = false;

  /** Current combo hit (0..2) or −1 */
  combo = -1;
  /** How many strikes made in total (for telemetry and tests) */
  swings = 0;
  private swingT = 0;
  private struck = false;
  private queued = false;
  /** After a strike: time elapsed (combo continuation window) and the cooldown after the finisher */
  private sinceSwing = 99;
  private lastCombo = -1;
  private attackCd = 0;
  private hitStopT = 0;
  /** A weapon art is in progress: movement, time and direction */
  private sp: { move: SpecialMove; t: number; prev: number; dur: number; yaw: number } | null = null;
  /** Swing look from the temper: three combo steps and the weapon art; null — standard colours */
  swingLooks: SwingLook[] | null = null;

  private rollT = 0;
  rollCdT = 0;
  /** Gear multipliers (src/gear.ts): walking speed and roll cooldown */
  speedMul = 1;
  /** Slowdown from floor zones (mob webs), 0..1 — set every tick */
  slow = 0;
  /** Incoming damage multiplier (the "Bastion" aura) */
  dmgTakenMul = 1;
  rollCdMul = 1;
  private readonly rollDir = new THREE.Vector3();
  private hurtT = 0;
  private downT = 0;

  /** The strike reached its middle: return how many targets were hit (for hit-stop) */
  /**
   * Strike numbers of the weapon in hand (combo, swings, wave): own hero — the shared SWORD (edited by the F1 panel and applyWeapon),
   * other players' heroes in a shared battle — their own copy, so a foreign weapon does not change own strikes
   */
  tune: typeof SWORD = SWORD;
  onStrike?: (s: Strike) => number;
  onSwing?: (step: number) => void;
  onLand?: (fallSpeed: number) => void;
  onRoll?: () => void;
  onStep?: () => void;

  readonly trail: SwordTrail;
  private simTime = 0;

  // animation
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
  /** Blade trail along the wrist Z: from the base to the tip */
  private bladeBase = 0.22;
  private bladeTip = 0.24 + BLADE;
  private readonly flashMats: THREE.MeshLambertMaterial[] = [];
  /** Worn armour — parts over the body (setArmor) */
  private armorMeshes: THREE.Object3D[] = [];
  private capeMat!: THREE.MeshLambertMaterial;
  private capeMap!: THREE.Texture;
  /** Second weapon in the left hand (dual blades, knuckles) and its trail */
  private readonly offhand = new THREE.Group();
  readonly offTrail: SwordTrail;
  private offBase = 0.2;
  private offTip = 1;
  /** Strike style of the equipped weapon (STYLE_OF) */
  style: SwingStyle = 'sword';
  /** The weapon's own trail colour without temper (WeaponDef.trail) */
  private weaponTrail: THREE.Color | null = null;
  /** Bow in the left hand: visible while shooting (shootPose) */
  private readonly bow = new THREE.Group();
  private bowT = 0;
  private bowYaw = 0;

  constructor(scene: THREE.Scene, T: Textures) {
    // only materials without their own glow flash on damage
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

    // legs: hinge at the hips
    for (const x of [0.135, -0.135]) {
      const leg = new THREE.Group();
      leg.position.set(x, 0, 0);
      leg.add(box(0.25, LEG - 0.14, 0.27, M.pants, 0, -(LEG - 0.14) / 2, 0));
      leg.add(box(0.27, 0.16, 0.31, M.boot, 0, -LEG + 0.08, 0.02));
      this.hips.add(leg);
      this.legs.push(leg);
    }

    // torso: tunic, belt with a buckle
    this.torso.rotation.order = 'YXZ';
    this.hips.add(this.torso);
    this.torso.add(box(0.54, BODY, 0.32, M.tunic, 0, BODY / 2, 0));
    this.torso.add(box(0.56, 0.14, 0.34, M.tunicDark, 0, 0.07, 0));
    this.torso.add(box(0.57, 0.08, 0.35, M.belt, 0, 0.17, 0));
    this.torso.add(box(0.1, 0.1, 0.03, M.gold, 0, 0.17, 0.18));
    this.torso.add(box(0.36, 0.08, 0.04, M.tunicDark, 0, BODY - 0.06, 0.15)); // collar

    // head: large, with a fringe
    this.head.position.y = BODY;
    this.head.rotation.order = 'YXZ';
    this.torso.add(this.head);
    this.head.add(box(HEAD, HEAD, HEAD, [M.hairSide, M.hairSide, M.hair, M.skin, M.face, M.hair], 0, HEAD / 2, 0));
    this.head.add(box(HEAD + 0.04, 0.1, HEAD + 0.04, M.hair, 0, HEAD - 0.03, -0.01));
    this.head.add(box(HEAD + 0.04, 0.26, 0.1, M.hair, 0, HEAD - 0.17, -HEAD / 2 + 0.03)); // back of the head

    // cloak: hinge at the shoulders behind
    this.capeG.position.set(0, BODY - 0.04, -0.17);
    this.torso.add(this.capeG);
    this.capeG.add(box(0.5, 0.78, 0.04, M.cape, 0, -0.39, 0));
    this.capeG.add(box(0.54, 0.06, 0.06, M.gold, 0, -0.01, 0.01));

    // arms: hinge at the shoulder, the arm hangs down; 0 — right (−X), 1 — left (+X)
    for (const x of [-SHOULDER_X, SHOULDER_X]) {
      const arm = new THREE.Group();
      arm.rotation.order = 'YXZ';
      arm.position.set(x, BODY - 0.08, 0);
      arm.add(box(0.21, ARM, 0.21, M.tunic, 0, -ARM / 2 + 0.06, 0));
      arm.add(box(0.23, 0.16, 0.23, M.tunicDark, 0, 0.0, 0)); // shoulder
      arm.add(box(0.2, 0.12, 0.2, M.skin, 0, -ARM + 0.08, 0)); // hand
      this.torso.add(arm);
      this.arms.push(arm);
    }

    // sword in the right hand: hilt in the hand, blade along the wrist +Z
    this.sword.position.set(0, -ARM + 0.08, 0);
    this.sword.rotation.order = 'XYZ';
    this.arms[0].add(this.sword);
    this.sword.add(box(0.07, 0.07, 0.24, M.grip, 0, 0, 0.02));
    this.sword.add(box(0.1, 0.1, 0.1, M.gem, 0, 0, -0.14)); // pommel
    this.sword.add(box(0.36, 0.08, 0.09, M.gold, 0, 0, 0.17)); // guard
    this.sword.add(box(0.06, 0.15, BLADE, M.steel, 0, 0, 0.2 + BLADE / 2));
    this.sword.add(box(0.025, 0.17, BLADE - 0.08, M.edge, 0, 0, 0.18 + BLADE / 2));
    this.sword.add(box(0.05, 0.08, 0.08, M.steel, 0, 0, 0.24 + BLADE)); // tip

    this.capeMat = M.cape;
    this.capeMap = M.cape.map as THREE.Texture;

    // bow in the left hand: limbs along the wrist Z (vertical with the arm raised), string closer to the shoulder
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

  /** Put on armour: chestplate, pauldrons, headgear, skirt, cloak colour; null — no armour */
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
    // chestplate over the tunic, belt and collar
    add(this.torso, box(0.6, 0.5, 0.38, body, 0, BODY - 0.26, 0), box(0.62, 0.09, 0.4, trim, 0, BODY - 0.5, 0), box(0.42, 0.07, 0.06, trim, 0, BODY - 0.04, 0.19));
    if (look.glow) add(this.torso, box(0.13, 0.13, 0.04, new THREE.MeshBasicMaterial({ color: new THREE.Color(look.glow).multiplyScalar(2.6), toneMapped: false }), 0, BODY - 0.27, 0.2));
    // sleeves and pauldrons
    for (const arm of this.arms) {
      add(arm, box(0.235, 0.3, 0.235, body, 0, -0.1, 0));
      if (look.pauldron) { const p = mat(look.pauldron); add(arm, box(0.31, 0.13, 0.31, p, 0, 0.08, 0), box(0.32, 0.04, 0.32, trim, 0, 0.02, 0)); }
    }
    if (look.skirt) add(this.hips, box(0.6, 0.4, 0.38, mat(look.skirt), 0, -0.16, 0));
    const h = look.head;
    if (h) {
      const c = mat(h.color), W = HEAD + 0.1;
      // hood, helmet, wolf head: top, sides and back, face open
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

  /** Bow (ranged weapon) — model in the left hand; null — no bow */
  setBow(look: BowLook | null): void {
    for (const c of [...this.bow.children]) { this.bow.remove(c); disposeWeaponModel(c); }
    if (!look) return;
    const k = look.size ?? 1;
    const wood = new THREE.MeshLambertMaterial({ map: pixelTex(look.wood, 7, 91) });
    const str = new THREE.MeshBasicMaterial({ color: look.string });
    const glow = look.glow ? new THREE.MeshBasicMaterial({ color: new THREE.Color(look.glow).multiplyScalar(2.4), toneMapped: false }) : null;
    if (look.kind === 'crossbow') {
      // stock forward along the arm (wrist −Y), limbs across, string slightly closer
      this.bow.add(box(0.08, 0.62, 0.09, wood, 0, -0.2, 0));
      this.bow.add(box(0.66, 0.07, 0.07, new THREE.MeshLambertMaterial({ color: '#5a5f6a' }), 0, -0.46, 0));
      this.bow.add(box(0.62, 0.015, 0.015, str, 0, -0.36, 0));
      this.bow.add(box(0.03, 0.4, 0.03, new THREE.MeshLambertMaterial({ color: '#c6d0dc' }), 0, -0.3, 0.06));
      return;
    }
    // bow of boxes: limbs curved forward (wrist −Y), string straight
    const L = 0.46 * k;
    for (let i = -3; i <= 3; i++) {
      const z = (i / 3.5) * L, y = -0.13 * (1 - (i / 3.5) ** 2) * k;
      this.bow.add(box(0.06, 0.07, L / 3.2, i === 0 ? new THREE.MeshLambertMaterial({ color: '#3d2616' }) : (glow && Math.abs(i) === 3 ? glow : wood), 0, y, z));
    }
    this.bow.add(box(0.015, 0.015, L * 1.85, str, 0, 0.02, 0));
  }

  /** Shot: for sec seconds the hero turns to yaw, the left arm with the bow forward, the right draws the string */
  shootPose(yaw: number, sec = 0.45): void { this.bowT = sec; this.bowYaw = yaw; this.yaw = yaw; }

  // ---------- state ----------

  get rolling(): boolean { return this.rollT > 0; }
  get attacking(): boolean { return this.combo >= 0; }
  get invulnerable(): boolean {
    const sp = this.sp, fr = sp ? SPECIALS[sp.move].iframes ?? 0 : 0;
    return this.god || (this.rolling && HERO.rollTime - this.rollT < HERO.rollIframes) || (!!sp && sp.t / sp.dur < fr);
  }
  /** The weapon art in progress and its fraction 0..1 (−1 — none) */
  get special(): SpecialMove | null { return this.sp?.move ?? null; }
  get specialK(): number { return this.sp ? Math.min(1, this.sp.t / this.sp.dur) : -1; }
  /** The weapon in hand is hidden (flying as a boomerang) */
  set weaponHidden(v: boolean) { this.sword.visible = !v; }
  get weaponHidden(): boolean { return !this.sword.visible; }
  get object(): THREE.Object3D { return this.root; }
  /** Armour parts on the body (for tests) */
  get armorParts(): number { return this.armorMeshes.length; }
  /** The bow in hand is visible (shooting) */
  get bowShown(): boolean { return this.bow.visible; }

  get state(): KnightState {
    if (this.down) return 'exhausted';
    if (this.rolling) return 'roll';
    if (this.sp) return 'art';
    if (this.combo >= 0) return (['hit 1', 'hit 2', 'hit 3'] as const)[this.combo];
    if (!this.grounded) return 'fall';
    return this.speed > 0.3 ? 'walk' : 'idle';
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

  /** Change the weapon model in hand (strike numbers — applyWeapon from weapons.ts) */
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

  /** There is a weapon in the second hand */
  get dual(): boolean { return this.offhand.children.length > 0; }

  /**
   * The temper tints the blade: glowing edges and the steel glow — in color (HDR), brightness ×glow; gilding and hilt
   * do not change. null — the model's original colours
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

  /** Start a weapon art: dur seconds, towards yaw. Will not start during a roll, when exhausted or during another one */
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
    // long blades get a trail no wider than 1.1 m — otherwise the ribbon merges into a wall
    this.trail.width = Math.min(L?.width ?? width, 1.1 / Math.max(0.3, this.bladeTip - this.bladeBase));
    this.trail.life = L?.life ?? 0.2;
    this.trail.core = L?.core ?? 0.25;
  }

  /** Blade base and tip in the world */
  blade(base = new THREE.Vector3(), tip = new THREE.Vector3()): { base: THREE.Vector3; tip: THREE.Vector3 } {
    this.root.updateMatrixWorld(true);
    base.set(0, 0, this.bladeBase).applyMatrix4(this.sword.matrixWorld);
    tip.set(0, 0, this.bladeTip).applyMatrix4(this.sword.matrixWorld);
    return { base, tip };
  }

  // ---------- simulation ----------

  /** solids — flat obstacles (props), terrain — level blocks: stairs, height, cliffs */
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

    // roll: cancels the strike, invulnerable at the start
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
      // weapon art: a dash along its own curve, spins around itself, you can walk during the whirlwind
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
      // turning: in a strike — towards the cursor, otherwise — along the movement
      const faceTo = this.attacking ? aimYaw : this.bowT > 0 ? this.bowYaw : moveDir ? Math.atan2(moveDir.x, moveDir.z) : this.yaw;
      this.yaw = wrap(this.yaw + wrap(faceTo - this.yaw) * damp(this.attacking ? H.turnRate * 1.6 : H.turnRate, dt));
    }

    // lunge during the strike
    if (this.combo >= 0 && this.hitStopT <= 0) {
      const S = this.tune.swings[this.combo];
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

  /** Gravity, landing, stepping down stairs, falling off a cliff */
  private vertical(dt: number, terrain: Terrain): void {
    const H = HERO;
    const floorOf = (y: number): number => { const f = terrain.floorAt(this.pos.x, this.pos.z, y); return f === -Infinity ? 0 : f; };
    if (this.grounded) {
      const floor = floorOf(this.pos.y);
      if (floor >= this.pos.y - 1e-3) this.pos.y = floor; // step up
      else if (this.pos.y - floor <= STEP + 0.02) this.pos.y = floor; // step down — no flight
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

  // ---------- sword ----------

  private startSwing(step: number, aimYaw: number): void {
    this.combo = step;
    this.swingT = 0;
    this.struck = false;
    this.queued = false;
    this.swings++;
    this.yaw = aimYaw; // the strike goes where the cursor points
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
      if (this.sinceSwing > this.tune.comboWindow) this.lastCombo = -1;
      if (input.attack && !this.rolling && this.attackCd <= 0) this.startSwing((this.lastCombo + 1) % 3, aimYaw);
      return;
    }
    // hit-stop on contact: the strike freezes for a moment
    if (this.hitStopT > 0) { this.hitStopT -= dt; return; }
    const S = this.tune.swings[this.combo];
    this.swingT += dt;
    const k = this.swingT / S.time;
    if (input.attack && k > 0.25) this.queued = true;
    if (!this.struck && k >= S.windup + S.strike * 0.5) {
      this.struck = true;
      const from = this.pos.clone().setY(this.pos.y + 1);
      const n = this.onStrike?.({ step: this.combo, from, yaw: this.yaw, range: S.range, half: THREE.MathUtils.degToRad(S.arc / 2), dmg: S.dmg, knock: S.knock }) ?? 0;
      if (n > 0) this.hitStopT = this.tune.hitStop * (this.combo === 2 ? 1.8 : 1);
    }
    if (this.queued && this.combo < 2 && k >= this.tune.chainFrom) { this.startSwing(this.combo + 1, aimYaw); return; }
    if (k >= 1) {
      this.lastCombo = this.combo;
      if (this.combo === 2) { this.attackCd = this.tune.finisherCd; this.lastCombo = -1; }
      this.combo = -1;
      this.sinceSwing = 0;
    }
  }

  /** Trail points are taken while the blade flies: from the end of the wind-up to just after the strike */
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
      const S = this.tune.swings[this.combo];
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

  /** Second weapon's trail */
  private sampleOff(): void {
    if (!this.dual || !this.offhand.visible) return;
    const b = new THREE.Vector3(0, 0, this.offBase).applyMatrix4(this.offhand.matrixWorld);
    const t = new THREE.Vector3(0, 0, this.offTip).applyMatrix4(this.offhand.matrixWorld);
    this.offTrail.push(b.lerp(t, 1 - this.offTrail.width), t, this.simTime);
  }

  // ---------- animation ----------

  /** Strike pose by fraction k: wind-up → strike → return */
  private swingPose(step: number, k: number): Pose {
    const S = this.tune.swings[step], [from, to] = STYLES[this.style][step];
    const a = S.windup, b = S.windup + S.strike;
    if (k < a) return lerpPose(IDLE, from, smooth(k / a));
    if (k < b) return lerpPose(from, to, outCubic((k - a) / (b - a)));
    return lerpPose(to, IDLE, smooth((k - b) / (1 - b)));
  }

  /** Weapon art pose by fraction k: wind-up → strike → return */
  private specialPose(move: SpecialMove, k: number): Pose {
    const S = SPECIALS[move];
    if (move === 'flurry' && k >= S.a && k < S.b) {
      // arms in turn: right — stab, left — wind-up, and vice versa, eight hits
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

    // step
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

    // legs: walking, tucked in when falling
    const air = !this.grounded && !this.rolling;
    const tuck = air ? THREE.MathUtils.clamp(0.4 + this.vy * 0.05, 0.1, 0.8) : 0;
    this.legs[0].rotation.x = s * 0.75 - tuck * 0.9;
    this.legs[1].rotation.x = -s * 0.75 + tuck * 0.4;
    this.hips.position.y = LEG - 0.9 + bob;

    // roll: a forward tumble around the middle of the body
    if (this.rolling) {
      const k = 1 - this.rollT / HERO.rollTime;
      this.spin.rotation.x = smooth(k) * Math.PI * 2;
      this.spin.position.y = 0.9 - Math.sin(k * Math.PI) * 0.35;
      this.legs[0].rotation.x = this.legs[1].rotation.x = -1.2 * Math.sin(k * Math.PI);
    } else {
      this.spin.rotation.x = 0;
      this.spin.position.y = 0.9;
    }
    // weapon art jump: the body lifts off and lands by the moment of the strike
    const spc = this.sp, SP = spc ? SPECIALS[spc.move] : null;
    if (spc && SP?.hop) {
      const k = spc.t / spc.dur, a = 0.1;
      this.spin.position.y += Math.sin(Math.PI * THREE.MathUtils.clamp((k - a) / (SP.b - a), 0, 1)) * SP.hop;
    }

    // arms and torso: strike or walking
    let pose: Pose;
    if (spc) pose = this.specialPose(spc.move, spc.t / spc.dur);
    else if (this.combo >= 0) pose = this.swingPose(this.combo, this.swingT / this.tune.swings[this.combo].time);
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
    // the second weapon is held like the first: in stance — forward-up, in a strike — along the arm
    this.offhand.rotation.x = spc || this.combo >= 0 ? pose.wl ?? pose.w : -0.45;
    const R = this.arms[0], L = this.arms[1];
    R.rotation.set(pose.ax, pose.ay, pose.az);
    L.rotation.set(pose.lx, pose.ly, aiming ? 0 : air && this.combo < 0 ? -0.35 : -0.08);
    this.sword.rotation.x = pose.w;
    this.torso.rotation.y = pose.twist;
    this.torso.rotation.x = pose.lean + (walking ? 0.06 : 0);
    this.head.rotation.y = -pose.twist * 0.5;
    this.head.rotation.x = -pose.lean * 0.4;

    // the cloak flutters with speed and when falling
    const capeWant = 0.12 + Math.min(sp, 7) * 0.09 + (air ? 0.25 + Math.max(0, -this.vy) * 0.04 : 0) + (this.combo === 2 || spc ? 0.3 : 0);
    this.cape += (capeWant - this.cape) * damp(8, dt);
    this.capeG.rotation.x = this.cape + Math.sin(this.simTime * 7) * 0.03 * (0.3 + this.gait);

    // flash on damage, pallor when exhausted
    const flash = this.hurtT > 0 ? 0.6 : 0;
    for (const m of this.flashMats) m.emissive.setRGB(flash, flash * 0.3, flash * 0.3);
    if (this.down) { this.spin.rotation.z = Math.min(1, this.downT * 4) * 1.4; this.spin.position.y = 0.3; } else this.spin.rotation.z = 0;
  }
}
