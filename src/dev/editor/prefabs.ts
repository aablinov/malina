import * as THREE from 'three';
import { Level, type DecorItem, type LevelEntity } from '../../level/level.ts';
import { LevelRenderer } from '../../level/mesher';
import { BLOCKS, CATEGORIES } from '../../level/palette.ts';
import { DECOR, DECOR_CATEGORIES } from '../../level/decor.ts';
import { bridgeX, cliffMass, floorRect, hayStack, hill, portal, rampart, riverBed, rockOutcrop, stairway, steppedWall, tree, waterfall } from '../../level/kit.ts';
import type { Textures } from '../../textures';
import { LIBRARY, LIBRARY_CATEGORIES, stampPrefab, type LibraryPrefab, type PrefabData } from '../../level/prefab-lib/index.ts';

/**
 * Префабы — всё, что можно поставить на карту из панели «Префабы» (как Place Actors / Content Browser в Unreal):
 * блоки палитры, декор, сборки (src/level/kit.ts — дерево, холм, скала, портал…), свет и служебные (точка появления),
 * «Библиотека» — запечённые пресеты из assets/prefabs/ (wiki/design-prefab-library.md, поворот на 90° — R в режиме «Поставить»)
 * и «Мои префабы» — сохранённые выделения (клетки, декор и свет относительно опорной клетки, хранятся в localStorage).
 */

export type PrefabKind = 'block' | 'decor' | 'kit' | 'light' | 'spawn' | 'lib' | 'user';

/** Свой префаб: клетки, декор и свет относительно опорной клетки (низ, центр выделения) — тот же формат, что у библиотеки */
export type UserPrefab = PrefabData;

export interface Prefab {
  id: string;
  title: string;
  /** Группа (вкладка) и раздел внутри неё */
  group: string;
  category: string;
  kind: PrefabKind;
  /** Имя блока или декора */
  name?: string;
  /** Иконка вместо превью (свет, служебные) */
  icon?: string;
  /** Сборка: строит себя в клетке (x, y, z) — y — первый слой воздуха над землёй */
  build?: (L: Level, x: number, y: number, z: number, seed: number) => void;
  /** Пресет библиотеки или свой префаб */
  user?: PrefabData;
  lib?: LibraryPrefab;
  /** Подсказка — что это и как ставится */
  hint?: string;
}

export const GROUPS = ['Все', 'Блоки', 'Декор', 'Сборки', 'Свет', 'Служебные', 'Библиотека', 'Мои префабы'] as const;

const KITS: [string, string, string, Prefab['build'], string][] = [
  ['tree_small', 'Дерево', 'природа', (L, x, y, z) => tree(L, x, y, z, 3, 2), 'ствол 3 блока, пышная крона'],
  ['tree_big', 'Дерево большое', 'природа', (L, x, y, z) => tree(L, x, y, z, 5, 3), 'ствол 5 блоков'],
  ['hill', 'Холм', 'рельеф', (L, x, y, z, s) => hill(L, x, z, 6, 5, 2, y, { seed: s }), 'проходимые слои по 0,5 м'],
  ['rock', 'Скала', 'рельеф', (L, x, y, z, s) => rockOutcrop(L, x, z, 4, 3, 4, y, s), 'непроходимый массив с травой сверху'],
  ['cliff', 'Скальный массив', 'рельеф', (L, x, y, z, s) => cliffMass(L, x - 3, z - 2, x + 3, z + 2, y, 3, 5, s), '7 × 5, высота 3–5'],
  ['river', 'Русло реки', 'вода', (L, x, y, z) => riverBed(L, x - 6, z - 1, x + 6, z + 1, y - 1, y - 2, 0), '13 × 3, течение к +X'],
  ['waterfall', 'Водопад', 'вода', (L, x, y, z) => waterfall(L, x - 1, x + 1, z, y, y + 4), 'стена струй 3 × 5'],
  ['bridge', 'Мост', 'постройки', (L, x, y, z) => bridgeX(L, x - 3, x + 3, z - 1, z + 1, y), 'настил 7 × 3 вдоль X'],
  ['portal', 'Портал', 'постройки', (L, x, y, z) => portal(L, x, y, z), 'проём лицом к +Z, рама и сияние'],
  ['rampart', 'Крепостная стена', 'постройки', (L, x, y, z) => rampart(L, x - 5, z, x + 5, z, y, 3), '11 блоков вдоль X с зубцами'],
  ['wall', 'Ограда ступенчатая', 'постройки', (L, x, y, z) => steppedWall(L, x - 5, z, x + 5, z, y, 1, 3), 'высота гуляет 1–3'],
  ['stairs', 'Лестница', 'постройки', (L, x, y, z) => stairway(L, x, y, z, 1, 0, 4, 3, 'stone'), '4 ступени к +X, ширина 3'],
  ['plaza', 'Площадка из плит', 'постройки', (L, x, y, z) => floorRect(L, x - 2, z - 2, x + 2, z + 2, y - 1, 'tiles'), '5 × 5 вровень с землёй'],
  ['hay', 'Стог сена', 'двор', (L, x, y, z) => hayStack(L, x, y, z, [['###', '###'], ['##.', '#..']]), 'пирамидка тюков'],
];

/** Весь каталог: блоки, декор, сборки, свет, служебные и пользовательские */
export function catalog(user: UserPrefab[]): Prefab[] {
  const out: Prefab[] = [];
  for (const cat of CATEGORIES) for (const b of BLOCKS) if (b.category === cat && b.name !== 'air') out.push({ id: `block:${b.name}`, title: b.title, group: 'Блоки', category: cat, kind: 'block', name: b.name, hint: 'блок 1 × 1 × 1 м' });
  for (const cat of DECOR_CATEGORIES) for (const d of DECOR) if (d.category === cat) out.push({ id: `decor:${d.name}`, title: d.title, group: 'Декор', category: cat, kind: 'decor', name: d.name, hint: d.anchor === 'floor' ? 'ставится на пол' : d.anchor === 'wall' ? 'вешается на стену' : 'висит под потолком' });
  for (const [id, title, cat, build, hint] of KITS) out.push({ id: `kit:${id}`, title, group: 'Сборки', category: cat, kind: 'kit', build, hint });
  out.push(
    { id: 'light:point', title: 'Точечный свет', group: 'Свет', category: 'источники', kind: 'light', name: 'point', icon: 'light', hint: 'светит во все стороны' },
    { id: 'light:spot', title: 'Прожектор', group: 'Свет', category: 'источники', kind: 'light', name: 'spot', icon: 'spot', hint: 'конус света вниз' },
    { id: 'spawn', title: 'Точка появления', group: 'Служебные', category: 'игрок', kind: 'spawn', icon: 'flag', hint: 'Player Start — откуда герой начинает' },
  );
  for (const cat of LIBRARY_CATEGORIES) for (const p of LIBRARY) if (p.category === cat) out.push({ id: `lib:${p.id}`, title: p.title + (p.seed > 1 ? ` ${p.seed}` : ''), group: 'Библиотека', category: cat, kind: 'lib', user: p, lib: p, hint: `${p.hint ?? ''}${p.hint ? ' · ' : ''}${p.size[0]} × ${p.size[2]} м, ${p.decor.length} декора · R — повернуть` });
  for (const u of user) out.push({ id: `user:${u.id}`, title: u.title, group: 'Мои префабы', category: 'сохранённые', kind: 'user', user: u, hint: `${u.cells.length} блоков, ${u.decor.length} декора` });
  return out;
}

const USER_KEY = 'malina.editor.prefabs';
export function loadUserPrefabs(): UserPrefab[] {
  try { return JSON.parse(localStorage.getItem(USER_KEY) ?? '[]') as UserPrefab[]; } catch { return []; }
}
export function saveUserPrefabs(list: UserPrefab[]): void {
  try { localStorage.setItem(USER_KEY, JSON.stringify(list)); } catch { /* нет места — префабы живут до перезагрузки */ }
}

/** Поставить префаб-заготовку (свой или из библиотеки) в карту с поворотом на quarter четвертей (через level.set — так редактор записывает правки в отмену) */
export function stampUser(L: Level, u: PrefabData, x: number, y: number, z: number, quarter = 0): { decor: DecorItem[]; entities: LevelEntity[] } {
  return stampPrefab(L, u, x, y, z, quarter);
}

/**
 * Превью префабов: маленький отдельный рендер, по одному кадру на префаб, понемногу за кадр — редактор не ждёт.
 * Блоки и сборки строятся в пустой карте, декор ставится в ноль; камера наводится на габариты.
 */
export class Thumbs {
  private readonly cache = new Map<string, string>();
  private readonly queue: Prefab[] = [];
  private r: THREE.WebGLRenderer | null = null;
  private sc = new THREE.Scene();
  private L = new Level('превью');
  private view: LevelRenderer | null = null;
  private readonly cam = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
  private readonly listeners = new Set<(id: string, url: string) => void>();

  constructor(private readonly T: Textures) {}

  get(p: Prefab): string | undefined {
    const c = this.cache.get(p.id);
    if (c === undefined && !p.icon && !this.queue.includes(p)) this.queue.push(p);
    return c;
  }
  onReady(fn: (id: string, url: string) => void): void { this.listeners.add(fn); }

  /** Отрисовать несколько превью из очереди (вызывать из кадра редактора) */
  pump(budgetMs = 6): void {
    if (!this.queue.length) { if (this.r) this.close(); return; }
    if (!this.open()) { this.queue.length = 0; return; }
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < budgetMs) {
      const p = this.queue.shift()!;
      const url = this.draw(p);
      this.cache.set(p.id, url);
      for (const fn of this.listeners) fn(p.id, url);
    }
  }

  private open(): boolean {
    if (this.r) return true;
    try {
      const c = document.createElement('canvas'); c.width = c.height = 96;
      this.r = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.r.toneMapping = THREE.ACESFilmicToneMapping;
      const dl = new THREE.DirectionalLight('#fff3d6', 2.4); dl.position.set(3, 6, 4);
      this.sc.add(new THREE.HemisphereLight('#dfeaff', '#7a6a50', 1.4), dl);
      this.view = new LevelRenderer(this.sc, this.L, this.T);
      return true;
    } catch { return false; }
  }
  private close(): void {
    this.view?.dispose(); this.view = null;
    this.r?.dispose(); this.r?.forceContextLoss(); this.r = null;
    this.sc = new THREE.Scene();
    this.L = new Level('превью');
  }

  private draw(p: Prefab): string {
    const L = this.L, v = this.view!, r = this.r!;
    L.clear();
    if (p.kind === 'block') { L.set(0, 0, 0, p.name!, 0); if (blockIsFlat(p.name!)) L.set(0, -1, 0, 'grass'); }
    else if (p.kind === 'decor') L.addDecor({ name: p.name!, pos: [0, 0, 0] });
    else if (p.kind === 'kit') { L.fill(-7, -1, -7, 7, -1, 7, 'grass'); p.build!(L, 0, 0, 0, 3); }
    else if (p.kind === 'user' || p.kind === 'lib') { if (p.kind === 'lib') L.fill(-7, -1, -7, 7, -1, 7, 'grass'); stampUser(L, p.user!, 0, 0, 0).decor.forEach((d) => L.addDecor(d)); }
    v.rebuildAll();
    v.sync();
    const box = new THREE.Box3().setFromObject(v.group);
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    const ctr = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const k = Math.max(size.x, size.y, size.z, 0.3);
    this.cam.position.copy(ctr).add(new THREE.Vector3(1, 0.8, 1.25).normalize().multiplyScalar(k * 2.2));
    this.cam.lookAt(ctr);
    r.render(this.sc, this.cam);
    return r.domElement.toDataURL();
  }
}

/** Плоские и мелкие блоки (трава, цветы, огонь) лучше смотрятся на клетке земли */
const blockIsFlat = (name: string): boolean => {
  const b = BLOCKS.find((b) => b.name === name);
  return !!b && (b.replaceable || b.collide === 0) && !b.full;
};
