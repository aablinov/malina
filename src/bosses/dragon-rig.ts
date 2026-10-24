import * as THREE from 'three';
import { additiveSprite, glowTex } from '../loot-look';
import { pixelTex } from '../textures';
import { glowMat, UNIT, type Boss } from './kit';

/**
 * Скелет дракона по пропорциям Эндер-дракона (wiki/design-bosses.md, раздел 5.1): тонкий длинный корпус, шея из пяти
 * звеньев и хвост из двенадцати — у каждого пластина на хребте, вытянутая голова с мордой и челюстью, огромные крылья
 * из двух звеньев со ступенчатым краем перепонки, мощные задние лапы и короткие передние. Размеры — в «пикселях»
 * модели Minecraft (16 на блок), умножаются на size. Все драконы-стражи — этот скелет: меняются цвета (DragonLook)
 * и детали (корона, сердце, клинок на хвосте).
 */

export interface DragonLook {
  /** Метров на «пиксель» модели */
  size: number;
  scale: string;
  dark: string;
  belly: string;
  plate: string;
  membrane: string;
  bone: string;
  claw: string;
  /** Перелив светящихся деталей: стихия ↔ малина */
  glowA: THREE.Color;
  glowB: THREE.Color;
  eyeA: THREE.Color;
  eyeB: THREE.Color;
  crownA: THREE.Color;
  crownB: THREE.Color;
}

/** Поза: к ней каждый кадр плавно тянутся текущие значения */
export interface Pose {
  /** Присел, лёг (сон, оглушение) 0..1 */ low: number;
  /** Встал на дыбы 0..1 */ rear: number;
  /** Крылья раскрыты 0..1 */ spread: number;
  /** Пасть открыта 0..1 */ jaw: number;
  /** Подъём шеи: 1 — обычно, 0 — вытянута вперёд, <0 — опущена */ neck: number;
  /** Наклон головы вниз */ dip: number;
  /** Хвост в сторону −1..1 */ curl: number;
  /** Шея в сторону −1..1 (свернулся во сне) */ side: number;
}
export const REST: Pose = { low: 0, rear: 0, spread: 0.8, jaw: 0, neck: 1, dip: 0, curl: 0, side: 0 };

const NECK = 5, TAIL = 12;
/** Длины звеньев ног: бедро, голень, стопа (высота) */
const REAR = { thigh: 20, shin: 18, foot: 5 };
const FRONT = { thigh: 17, shin: 16, foot: 4 };
/** Центр корпуса над землёй, «пикс.»: стоя брюхо в ~0,7 м от земли, лёжа — на земле */
const STAND = 28, LIE = 12.5;

interface Leg { hip: THREE.Group; shin: THREE.Group; foot: THREE.Group; s: number; front: boolean }

export class DragonRig {
  readonly root = new THREE.Group();
  readonly torso = new THREE.Group();
  readonly neck: THREE.Group[] = [];
  readonly head = new THREE.Group();
  readonly jaw = new THREE.Group();
  readonly mouth = new THREE.Object3D();
  readonly tail: THREE.Group[] = [];
  readonly heart = new THREE.Group();
  readonly wings: { arm: THREE.Group; tip: THREE.Group; s: number }[] = [];
  readonly throat: THREE.MeshBasicMaterial;
  private readonly legs: Leg[] = [];
  readonly pose: Pose = { ...REST };
  /** Высота бедра стоя, м */
  readonly hipH: number;
  /** Длина корпуса, м */
  readonly bodyLen: number;
  private readonly u: number;

  constructor(private readonly b: Boss, readonly look: DragonLook) {
    const u = this.u = look.size;
    this.hipH = STAND * u;
    this.bodyLen = 64 * u;
    this.throat = glowMat(look.glowA, 0, true);
    this.build();
  }

  /** Брусок в «пикселях» модели */
  private bx(parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh {
    const u = this.u;
    return this.b.box(parent, mat, w * u, h * u, d * u, x * u, y * u, z * u, rx, ry, rz);
  }

  private build(): void {
    const L = this.look, b = this.b, u = this.u;
    const scale = b.lam(L.scale, pixelTex(L.scale, 10, 301));
    const dark = b.lam(L.dark, pixelTex(L.dark, 8, 302));
    const belly = b.lam(L.belly, pixelTex(L.belly, 8, 303));
    const plate = b.lam(L.plate, pixelTex(L.plate, 6, 305));
    const bone = b.lam(L.bone, pixelTex(L.bone, 6, 304));
    const claw = b.lam(L.claw);
    const membrane = b.lam(L.membrane, pixelTex(L.membrane, 7, 306));
    membrane.side = THREE.DoubleSide;
    const lava = b.shimmer(L.glowA, L.glowB, 0, 1.4);
    const lava2 = b.shimmer(L.glowA, L.glowB, 2, 1.4);
    const eye = b.shimmer(L.eyeA, L.eyeB, 0, 3);
    const crown = b.shimmer(L.crownA, L.crownB, 0, 2.2);
    const crown2 = b.shimmer(L.crownA, L.crownB, 2.5, 2.2);
    const heart = b.shimmer(L.crownA, L.crownB, 0, 3.2);
    const B = this.bx.bind(this);

    // корпус 24 × 24 × 64: три пластины на хребте, полосы лавы на брюхе
    const T = this.torso;
    this.root.add(T);
    B(T, scale, 24, 24, 64);
    B(T, belly, 18, 2, 56, 0, -12.5, 0);
    for (let i = 0; i < 4; i++) B(T, i % 2 ? lava : lava2, 12, 1, 3, 0, -13.6, 20 - i * 13);
    for (const z of [20, 2, -16]) { B(T, plate, 2, 6, 12, 0, 15, z); B(T, lava, 2.4, 1.4, 4, 0, 18.2, z - 3); }
    // сердце-ягода: в груди под шеей, светится сквозь щель между пластинами
    for (const s of [-1, 1]) B(T, dark, 9, 14, 2, s * 6.5, -2, 32.5);
    this.heart.position.set(0, -2 * u, 32.6 * u);
    T.add(this.heart);
    for (const [x, y, z, k] of [[0, 0, 1, 5], [2.6, 2.4, 0, 3.4], [-2.6, 2.4, 0, 3.4], [2.6, -2.4, 0, 3.4], [-2.6, -2.4, 0, 3.4], [0, 4.4, -0.5, 3], [0, -4.4, -0.5, 3]] as const) B(this.heart, heart, k, k, k, x, y, z);
    const halo = new THREE.Sprite(additiveSprite(glowTex(), L.crownA.clone().multiplyScalar(0.5), 0.9));
    halo.scale.setScalar(26 * u);
    this.heart.add(halo);

    // шея: пять звеньев 10 × 10 × 10 с пластиной
    let parent: THREE.Object3D = T;
    for (let i = 0; i < NECK; i++) {
      const g = new THREE.Group();
      g.position.set(0, i === 0 ? 5 * u : 0, (i === 0 ? 32 : 10) * u);
      parent.add(g);
      B(g, scale, 10, 10, 10, 0, 0, 5);
      B(g, belly, 7, 1, 9, 0, -5.4, 5);
      B(g, plate, 2, 4, 6, 0, 7, 5);
      this.neck.push(g);
      parent = g;
    }
    // голова: череп 16³, морда 12 × 5 × 16 с ноздрями, челюсть 12 × 4 × 16 на петле, две пластины-рога, глаза
    const H = this.head;
    H.position.set(0, 0, 10 * u);
    parent.add(H);
    B(H, scale, 16, 16, 16, 0, 0, 8);
    B(H, scale, 12, 5, 16, 0, -3.5, 24);
    for (const s of [-1, 1]) {
      B(H, dark, 2, 2, 4, s * 3, -0.5, 30);
      B(H, plate, 2, 4, 6, s * 5, 10, 4);
      B(H, eye, 4, 2.4, 0.6, s * 4, 3, 16.3);
      B(H, eye, 0.6, 2.4, 4, s * 8.3, 3, 13);
      B(H, bone, 1.6, 2.4, 1.6, s * 4.6, -7, 30);
      B(H, bone, 1.6, 2.4, 1.6, s * 4.6, -7, 22);
    }
    // корона Ордена: золотой обод и кольцо светящихся костянок на затылке
    const gold = b.lam('#e8b84a');
    B(H, gold, 12, 1.6, 10, 0, 8.8, 4);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      B(H, k % 2 ? crown : crown2, 2.6, 2.6 + (k % 2) * 1.4, 2.6, Math.sin(a) * 5, 10.6 + (k % 2) * 0.7, 4 + Math.cos(a) * 4);
    }
    B(H, crown, 3.4, 3.4, 3.4, 0, 12.6, 4, Math.PI / 4, 0, Math.PI / 4);
    this.jaw.position.set(0, -6 * u, 16 * u);
    H.add(this.jaw);
    B(this.jaw, scale, 12, 4, 16, 0, -2, 8);
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) B(this.jaw, bone, 1.4, 2.2, 1.4, s * 4.6, 1, 4 + k * 4.5);
    const th = new THREE.Mesh(UNIT, this.throat);
    th.scale.set(9 * u, 4 * u, 14 * u);
    th.position.set(0, -5.5 * u, 22 * u);
    H.add(th);
    this.mouth.position.set(0, -6 * u, 32 * u);
    H.add(this.mouth);

    // хвост: двенадцать звеньев 10 × 10 × 10 с пластиной, на конце — тлеющий клинок
    parent = T;
    for (let i = 0; i < TAIL; i++) {
      const g = new THREE.Group();
      g.position.set(0, 0, (i === 0 ? -32 : -10) * u);
      parent.add(g);
      B(g, scale, 10, 10, 10, 0, 0, -5);
      B(g, plate, 2, 4, 6, 0, 7, -5);
      if (i % 3 === 1) B(g, lava2, 6, 1, 3, 0, -5.4, -5);
      this.tail.push(g);
      parent = g;
    }
    B(parent, lava, 2, 9, 14, 0, 0, -16);
    B(parent, lava2, 2, 6, 6, 0, 0, -23, Math.PI / 4);

    // крылья: кость 56 × 8 × 8 и перепонка 56 × 56, кончик — кость 56 × 4 × 4 и клин перепонки; край — ступенями
    for (const s of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(s * 12 * u, 5 * u, 14 * u);
      T.add(arm);
      B(arm, scale, 56, 8, 8, s * 28, 0, 0);
      const armSteps = [56, 55, 53, 53, 51, 50, 48];
      armSteps.forEach((d, i) => B(arm, membrane, 8, 1, d, s * (4 + i * 8), 0, -d / 2));
      const tip = new THREE.Group();
      tip.position.set(s * 56 * u, 0, 0);
      arm.add(tip);
      B(tip, scale, 56, 4, 4, s * 28, 0, 0);
      B(tip, claw, 3, 5, 3, s * 2, 3, 2, 0.4);
      const tipSteps = [48, 44, 39, 33, 26, 19, 12, 6];
      tipSteps.forEach((d, i) => B(tip, membrane, 7, 1, d, s * (3.5 + i * 7), 0, -d / 2));
      this.wings.push({ arm, tip, s });
    }

    // лапы рептилии, раскинуты вбок: бедро (плечо) уходит от бока наружу, колено (локоть) смотрит в сторону,
    // голень опускается к земле снаружи от тела. Задние 12 × 20 × 12 → 9 × 18 × 9 → стопа 14 × 5 × 18, передние тоньше
    for (const [front, s] of [[false, -1], [false, 1], [true, -1], [true, 1]] as [boolean, number][]) {
      const D = front ? FRONT : REAR, w = front ? 9 : 12, w2 = front ? 7 : 9;
      const hip = new THREE.Group();
      hip.rotation.order = 'YZX'; // сначала шаг вперёд-назад (Y), потом размах вбок (Z)
      hip.position.set(s * 11 * u, 0, (front ? 21 : -21) * u);
      this.root.add(hip);
      B(hip, scale, w, D.thigh + 4, w, 0, -D.thigh / 2 + 2, 0);
      B(hip, dark, w * 0.6, w * 0.6, w * 0.6, 0, -D.thigh, 0);
      const shin = new THREE.Group();
      shin.position.y = -D.thigh * u;
      hip.add(shin);
      B(shin, dark, w2, D.shin, w2, 0, -D.shin / 2, 0);
      const foot = new THREE.Group();
      foot.position.y = -D.shin * u;
      shin.add(foot);
      // стопа — растопыренные пальцы с когтями, чуть развёрнута наружу
      const fw = front ? 10 : 14, fl = front ? 12 : 16;
      B(foot, scale, fw, D.foot, fl * 0.6, 0, -D.foot / 2, fl * 0.15);
      for (const c of [-1, -0.33, 0.33, 1]) {
        B(foot, scale, 2.6, D.foot * 0.7, fl * 0.55, c * fw * 0.42, -D.foot * 0.6, fl * 0.55, 0, c * 0.35, 0);
        B(foot, claw, 1.8, 2, 3, c * fw * 0.55, -D.foot * 0.7, fl * 0.85, 0, c * 0.35, 0);
      }
      this.legs.push({ hip, shin, foot, s, front });
    }
  }

  /**
   * Поза → кости. t — время для дыхания и волн, walk — фаза шага (или null, стоит), flap — взмахи крыльев 0..1,
   * k — доля пути к желаемой позе за кадр
   */
  apply(want: Pose, k: number, t: number, walk: number | null, flap: number, sleeping: boolean): void {
    const P = this.pose, u = this.u;
    for (const key of Object.keys(P) as (keyof Pose)[]) P[key] += (want[key] - P[key]) * k;
    const breath = Math.sin(t * (sleeping ? 1.3 : 2.2)) * 0.03;
    // лёг: брюхо на земле (бедро на высоте полкорпуса)
    const hipY = this.hipH * (1 - P.low) + LIE * u * P.low;
    this.torso.position.y = hipY + breath + (walk !== null ? Math.abs(Math.sin(walk)) * 0.06 : 0);
    this.torso.rotation.x = -0.45 * P.rear;
    this.torso.rotation.z = walk !== null ? Math.sin(walk) * 0.03 : 0;
    // ящерица на ходу изгибается: корпус качается вбок, хвост — в противофазе
    const sway = walk !== null ? Math.sin(walk) * 0.1 : 0;
    this.torso.rotation.y = sway;
    // шея поднимается звеньями (во сне — сворачивается вбок), голова держит взгляд вперёд
    for (let i = 0; i < NECK; i++) this.neck[i].rotation.set(-0.24 * P.neck + Math.sin(t * 1.7 + i * 0.5) * 0.015, P.side * 0.45 + Math.sin(t * 0.9 + i) * 0.02, 0);
    this.head.rotation.set(0.24 * NECK * P.neck * 0.92 + P.dip + 0.45 * P.rear, P.side * 0.3, 0);
    this.jaw.rotation.x = 0.7 * P.jaw;
    // хвост: волна, замах в сторону, во сне — кольцом
    for (let i = 0; i < TAIL; i++) {
      const g = this.tail[i];
      g.rotation.y = Math.sin(t * 1.5 - i * 0.5) * 0.06 + P.curl * 0.2 + (walk !== null ? Math.sin(walk - i * 0.45) * -0.07 : 0);
      g.rotation.x = i === 0 ? 0.08 + 0.4 * P.rear - 0.08 * P.low : (i < 4 ? 0.05 : -0.03) * (1 - P.low);
    }
    // крылья: сложены назад вдоль тела ↔ раскрыты вширь; кончик складывается к локтю
    const fl = Math.sin(t * 7) * 0.55 * flap;
    for (const w of this.wings) {
      const f = 1 - P.spread;
      // раскрытые — буквой V вверх, кончик свисает (как у Эндер-дракона); сложенные — вдоль спины
      w.arm.rotation.set(0, w.s * f * 1.35, w.s * (0.55 * P.spread - 0.15 * f + fl));
      w.tip.rotation.set(0, w.s * f * 2.6, w.s * (-0.45 * P.spread - fl * 0.8));
    }
    // лапы: IK во фронтальной плоскости. Голень почти отвесна (φ от вертикали наружу), бедро — сколько нужно, чтобы
    // стопа встала на землю: стоя почти горизонтально, лёжа — локтем вверх. Шаг — бедро вперёд-назад по диагонали
    // (левая передняя с правой задней), стопа на переносе приподнята
    const pitch = this.torso.rotation.x;
    for (const L of this.legs) {
      const D = L.front ? FRONT : REAR;
      const z = L.hip.position.z;
      const y = hipY - 4 * u - Math.sin(pitch) * z;
      L.hip.position.y = y;
      const a = D.thigh * u, b2 = D.shin * u;
      const phi = 0.12 + 0.55 * P.low;
      const ph = walk !== null ? walk + (L.front === (L.s > 0) ? 0 : Math.PI) : 0;
      const lift = walk !== null ? Math.max(0, Math.cos(ph)) * 0.35 : 0;
      const h = y - D.foot * u - b2 * Math.cos(phi);
      const th = Math.acos(THREE.MathUtils.clamp(h / a, -0.6, 1)) + lift;
      // вперёд по Z: правой лапе (бедро к +X) — поворот по Y отрицательный, левой — положительный
      L.hip.rotation.set(0, -L.s * (walk !== null ? Math.sin(ph) * 0.42 : 0), L.s * th);
      L.shin.rotation.z = L.s * (phi - th);
      L.foot.rotation.z = -L.s * phi;
    }
  }
}
