import * as THREE from 'three';
import { GUNS, type Caliber, type FireMode, type GunClass, type GunTuning, type Weight } from './tuning';

/**
 * Реальные стволы с игровыми характеристиками (ADR-002) и их блочные модели (ADR-003).
 * Числа — в tuning.ts, здесь только то, что не настраивается: калибр, режим огня, вид.
 */

export type FirearmId = 'pm' | 'ak74' | 'dbl' | 'ar15';
export type ShotSound = 'pm' | 'ak' | 'ar' | 'dbl';
/** Как перезаряжается: магазин или переламывание стволов */
export type ReloadStyle = 'mag' | 'break';

export interface FirearmDef {
  id: FirearmId;
  name: string;
  cls: GunClass;
  caliber: Caliber;
  mode: FireMode;
  weight: Weight;
  slot: 'primary' | 'pistol';
  reload: ReloadStyle;
  sound: ShotSound;
  /** Цвет трассера и вспышки (HDR) */
  tracer: [number, number, number];
  muzzleSize: number;
  /** Живые числа из tuning.ts */
  readonly t: GunTuning;
}

export const FIREARMS: Record<FirearmId, FirearmDef> = {
  pm: {
    id: 'pm', name: 'ПМ', cls: 'pistol', caliber: '9mm', mode: 'semi', weight: 'light', slot: 'pistol',
    reload: 'mag', sound: 'pm', tracer: [3.2, 2.4, 1.1], muzzleSize: 0.6, t: GUNS.pm,
  },
  ak74: {
    id: 'ak74', name: 'АК-74', cls: 'rifle', caliber: '545', mode: 'auto', weight: 'medium', slot: 'primary',
    reload: 'mag', sound: 'ak', tracer: [3.4, 1.9, 0.6], muzzleSize: 1, t: GUNS.ak74,
  },
  dbl: {
    id: 'dbl', name: 'Двустволка', cls: 'shotgun', caliber: '12g', mode: 'double', weight: 'medium', slot: 'primary',
    reload: 'break', sound: 'dbl', tracer: [3.4, 2.2, 0.9], muzzleSize: 1.5, t: GUNS.dbl,
  },
  ar15: {
    id: 'ar15', name: 'AR-15', cls: 'rifle', caliber: '556', mode: 'auto', weight: 'medium', slot: 'primary',
    reload: 'mag', sound: 'ar', tracer: [3.0, 2.6, 1.2], muzzleSize: 0.9, t: GUNS.ar15,
  },
};

export const PRIMARIES: readonly FirearmId[] = ['ak74', 'ar15', 'dbl'];

// ---------- Модели ----------

/**
 * Точки модели, нужные анимации. Ось +Z — вперёд (к дулу), +Y — вверх, начало координат — у спуска.
 */
export interface GunRig {
  root: THREE.Group;
  muzzle: THREE.Object3D;
  /** Куда ложится правая кисть (рукоять) */
  gripR: THREE.Object3D;
  /** Куда ложится левая кисть (цевьё) */
  gripL: THREE.Object3D;
  /** Окно выброса гильз */
  port: THREE.Object3D;
  /** Магазин (у двустволки нет) — прячется при перезарядке */
  mag: THREE.Group | null;
  /** Шахта магазина: сюда рука вставляет новый */
  magWell: THREE.Object3D;
  /** Затвор или кожух — откатывается при выстреле */
  bolt: THREE.Object3D | null;
  /** Двустволка: блок стволов, переламывается вниз */
  hinge: THREE.Group | null;
  /** Двустволка: казённик, куда вставляют патроны */
  breech: THREE.Object3D | null;
}

const matCache = new Map<string, THREE.MeshLambertMaterial>();
function mat(color: string): THREE.MeshLambertMaterial {
  let m = matCache.get(color);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); matCache.set(color, m); }
  return m;
}

const C = {
  steel: '#3b3f46', steelD: '#26292e', black: '#1c1e22', blackL: '#2c2f35',
  wood: '#8a4a22', woodD: '#6a3618', bakelite: '#9a3f16', bakeliteD: '#7a2f10',
  silver: '#9aa0a8', brownGrip: '#4a2a18', brass: '#d4a53a', red: '#b8301c',
};

function part(parent: THREE.Object3D, w: number, h: number, d: number, color: string, x: number, y: number, z: number, rx = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  m.rotation.x = rx;
  m.castShadow = true;
  parent.add(m);
  return m;
}

function point(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

/** Магазин отдельной группой: его можно спрятать, бросить на пол и нести в руке */
export function buildMagazine(id: FirearmId): THREE.Group {
  const g = new THREE.Group();
  if (id === 'ak74') {
    part(g, 0.05, 0.12, 0.075, C.bakelite, 0, -0.06, 0);
    part(g, 0.05, 0.11, 0.075, C.bakeliteD, 0, -0.155, 0.035, -0.4);
    part(g, 0.054, 0.02, 0.08, C.bakeliteD, 0, -0.205, 0.06, -0.55);
  } else if (id === 'ar15') {
    part(g, 0.045, 0.16, 0.075, C.blackL, 0, -0.08, 0.01, -0.12);
    part(g, 0.05, 0.02, 0.08, C.black, 0, -0.165, 0.02, -0.12);
  } else if (id === 'pm') {
    part(g, 0.03, 0.09, 0.04, C.steelD, 0, -0.045, 0);
    part(g, 0.038, 0.016, 0.052, C.black, 0, -0.095, 0.004);
  }
  return g;
}

export function buildFirearm(id: FirearmId): GunRig {
  const root = new THREE.Group();
  const rig: GunRig = {
    root, muzzle: root, gripR: root, gripL: root, port: root, mag: null, magWell: root, bolt: null, hinge: null, breech: null,
  };

  if (id === 'ak74') {
    part(root, 0.06, 0.085, 0.34, C.steel, 0, 0.02, 0.06);
    const bolt = part(root, 0.056, 0.022, 0.29, C.steelD, 0, 0.073, 0.05);
    part(root, 0.016, 0.016, 0.03, C.steelD, 0.036, 0.04, 0.17); // рукоять затвора справа
    part(root, 0.07, 0.065, 0.19, C.wood, 0, 0.01, 0.33); // нижнее цевьё
    part(root, 0.05, 0.035, 0.15, C.wood, 0, 0.076, 0.31); // накладка газовой трубки
    part(root, 0.028, 0.028, 0.34, C.steelD, 0, 0.032, 0.4); // ствол
    part(root, 0.042, 0.042, 0.07, C.black, 0, 0.032, 0.6); // дульный тормоз
    part(root, 0.02, 0.06, 0.02, C.steelD, 0, 0.07, 0.51); // мушка
    part(root, 0.034, 0.02, 0.05, C.steelD, 0, 0.1, 0.19); // целик
    part(root, 0.045, 0.11, 0.05, C.brownGrip, 0, -0.065, -0.035, 0.32); // рукоять
    part(root, 0.012, 0.012, 0.07, C.steelD, 0, -0.04, 0.02); // спусковая скоба
    part(root, 0.05, 0.075, 0.2, C.wood, 0, 0.0, -0.21); // приклад
    part(root, 0.055, 0.125, 0.06, C.woodD, 0, -0.02, -0.32);
    rig.bolt = bolt;
    rig.magWell = point(root, 0, -0.03, 0.11);
    rig.muzzle = point(root, 0, 0.032, 0.64);
    rig.gripL = point(root, 0, -0.03, 0.32);
    rig.port = point(root, 0.035, 0.05, 0.1);
  } else if (id === 'ar15') {
    part(root, 0.06, 0.07, 0.3, C.black, 0, 0.04, 0.06);
    part(root, 0.055, 0.055, 0.2, C.blackL, 0, -0.02, 0.04);
    // ручка для переноски
    part(root, 0.03, 0.025, 0.17, C.blackL, 0, 0.125, 0.06);
    part(root, 0.03, 0.04, 0.03, C.blackL, 0, 0.09, -0.01);
    part(root, 0.03, 0.04, 0.03, C.blackL, 0, 0.09, 0.13);
    const bolt = part(root, 0.05, 0.016, 0.03, C.black, 0, 0.082, -0.08); // рукоять затвора сзади
    part(root, 0.072, 0.072, 0.22, C.blackL, 0, 0.035, 0.32); // цевьё
    part(root, 0.024, 0.024, 0.18, C.steelD, 0, 0.035, 0.5); // ствол
    part(root, 0.034, 0.034, 0.05, C.black, 0, 0.035, 0.61); // пламегаситель
    part(root, 0.026, 0.085, 0.026, C.black, 0, 0.09, 0.44); // треугольная мушка
    part(root, 0.04, 0.1, 0.05, C.black, 0, -0.07, -0.04, 0.36); // рукоять
    part(root, 0.012, 0.012, 0.07, C.black, 0, -0.045, 0.03);
    part(root, 0.04, 0.04, 0.14, C.blackL, 0, 0.035, -0.15); // труба приклада
    part(root, 0.052, 0.11, 0.11, C.black, 0, 0.005, -0.26); // прямой приклад
    rig.bolt = bolt;
    rig.magWell = point(root, 0, -0.04, 0.1);
    rig.muzzle = point(root, 0, 0.035, 0.64);
    rig.gripL = point(root, 0, -0.005, 0.31);
    rig.port = point(root, 0.035, 0.045, 0.08);
  } else if (id === 'dbl') {
    part(root, 0.05, 0.065, 0.3, C.wood, 0, -0.025, -0.22);
    part(root, 0.056, 0.12, 0.06, C.woodD, 0, -0.045, -0.36);
    part(root, 0.044, 0.055, 0.12, C.wood, 0, -0.02, -0.04); // шейка
    part(root, 0.07, 0.07, 0.1, C.silver, 0, 0.015, 0.06); // колодка
    part(root, 0.012, 0.012, 0.06, C.steelD, 0, -0.035, 0.02);
    const hinge = new THREE.Group();
    hinge.position.set(0, -0.01, 0.11);
    root.add(hinge);
    part(hinge, 0.034, 0.034, 0.56, C.steel, -0.019, 0.042, 0.28);
    part(hinge, 0.034, 0.034, 0.56, C.steel, 0.019, 0.042, 0.28);
    part(hinge, 0.014, 0.01, 0.56, C.steelD, 0, 0.064, 0.28); // планка
    part(hinge, 0.07, 0.04, 0.2, C.wood, 0, 0.008, 0.14); // цевьё
    rig.hinge = hinge;
    rig.breech = point(hinge, 0, 0.042, 0.0);
    rig.muzzle = point(hinge, 0, 0.042, 0.57);
    rig.gripL = point(hinge, 0, -0.03, 0.15);
    rig.magWell = rig.breech;
    rig.port = rig.breech;
  } else {
    // ПМ
    const slide = part(root, 0.036, 0.04, 0.16, C.steel, 0, 0.032, 0.045);
    part(root, 0.032, 0.03, 0.12, C.steelD, 0, -0.002, 0.035);
    part(root, 0.036, 0.1, 0.052, C.brownGrip, 0, -0.06, -0.02, 0.22);
    part(root, 0.01, 0.01, 0.05, C.steelD, 0, -0.03, 0.04);
    part(root, 0.012, 0.016, 0.012, C.steelD, 0, 0.058, 0.115); // мушка
    rig.bolt = slide;
    rig.magWell = point(root, 0, -0.03, -0.022);
    rig.muzzle = point(root, 0, 0.032, 0.13);
    rig.gripL = point(root, -0.03, -0.075, 0.0);
    rig.port = point(root, 0.02, 0.05, 0.05);
  }
  rig.gripR = point(root, 0, -0.06, -0.035);

  if (id !== 'dbl') {
    const m = buildMagazine(id);
    rig.magWell.add(m);
    rig.mag = m;
  }
  if (rig.bolt) rig.bolt.userData.z0 = rig.bolt.position.z;
  return rig;
}

/** Патрон 12 калибра — для анимации заряжания двустволки */
export function buildShell(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.026, 0.07), mat(C.red));
  m.castShadow = true;
  return m;
}
