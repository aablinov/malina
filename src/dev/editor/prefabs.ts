import * as THREE from 'three';
import { Level, type DecorItem, type LevelEntity } from '../../level/level.ts';
import { LevelRenderer } from '../../level/mesher.ts';
import { BLOCKS, CATEGORIES } from '../../level/palette.ts';
import { DECOR, DECOR_CATEGORIES } from '../../level/decor.ts';
import { bridgeX, cliffMass, floorRect, hayStack, hill, portal, rampart, riverBed, rockOutcrop, stairway, steppedWall, tree, waterfall } from '../../level/kit.ts';
import type { Textures } from '../../textures.ts';
import { LIBRARY, LIBRARY_CATEGORIES, stampPrefab, type LibraryPrefab, type PrefabData } from '../../level/prefab-lib/index.ts';
import { t } from '../../i18n/i18n.ts';

/**
 * Prefabs — everything that can be put on the map from the "Prefabs" panel (like Place Actors / Content Browser in Unreal):
 * palette blocks, decor, kits (src/level/kit.ts — tree, hill, cliff, portal…), lights and service objects (spawn point),
 * "Library" — baked presets from assets/prefabs/ (wiki/design-prefab-library.md, 90° rotation — R in "Place" mode)
 * and "My prefabs" — saved selections (cells, decor and lights relative to the anchor cell, stored in localStorage).
 */

export type PrefabKind = 'block' | 'decor' | 'kit' | 'light' | 'spawn' | 'lib' | 'user';

/** User prefab: cells, decor and lights relative to the anchor cell (bottom, centre of the selection) — same format as the library */
export type UserPrefab = PrefabData;

export interface Prefab {
  id: string;
  title: string;
  /** Group (tab) and section inside it */
  group: PrefabGroup;
  category: string;
  kind: PrefabKind;
  /** Block or decor name */
  name?: string;
  /** Icon instead of a preview (lights, service objects) */
  icon?: string;
  /** Kit: builds itself at cell (x, y, z) — y is the first air layer above the ground */
  build?: (L: Level, x: number, y: number, z: number, seed: number) => void;
  /** Library preset or user prefab */
  user?: PrefabData;
  lib?: LibraryPrefab;
  /** Hint — what it is and how it is placed */
  hint?: string;
}

export const GROUPS = ['all', 'blocks', 'decor', 'kits', 'lights', 'service', 'library', 'mine'] as const;
export type PrefabGroup = (typeof GROUPS)[number];
/** Tab titles of the groups */
export const GROUP_TITLES: Record<PrefabGroup, string> = {
  all: t('All'), blocks: t('Blocks'), decor: t('Decor'), kits: t('Kits'), lights: t('Lights'), service: t('Service'), library: t('Library'), mine: t('My prefabs'),
};

const KITS: [string, string, string, Prefab['build'], string][] = [
  ['tree_small', t('Tree'), 'nature', (L, x, y, z) => tree(L, x, y, z, 3, 2), t('trunk 3 blocks, lush crown')],
  ['tree_big', t('Big tree'), 'nature', (L, x, y, z) => tree(L, x, y, z, 5, 3), t('trunk 5 blocks')],
  ['hill', t('Hill'), 'terrain', (L, x, y, z, s) => hill(L, x, z, 6, 5, 2, y, { seed: s }), t('walkable layers of 0.5 m')],
  ['rock', t('Rock'), 'terrain', (L, x, y, z, s) => rockOutcrop(L, x, z, 4, 3, 4, y, s), t('impassable mass with grass on top')],
  ['cliff', t('Cliff mass'), 'terrain', (L, x, y, z, s) => cliffMass(L, x - 3, z - 2, x + 3, z + 2, y, 3, 5, s), t('7 × 5, height 3–5')],
  ['river', t('River bed'), 'water', (L, x, y, z) => riverBed(L, x - 6, z - 1, x + 6, z + 1, y - 1, y - 2, 0), t('13 × 3, flowing towards +X')],
  ['waterfall', t('Waterfall'), 'water', (L, x, y, z) => waterfall(L, x - 1, x + 1, z, y, y + 4), t('wall of streams 3 × 5')],
  ['bridge', t('Bridge'), 'buildings', (L, x, y, z) => bridgeX(L, x - 3, x + 3, z - 1, z + 1, y), t('deck 7 × 3 along X')],
  ['portal', t('Portal'), 'buildings', (L, x, y, z) => portal(L, x, y, z), t('opening facing +Z, frame and glow')],
  ['rampart', t('Rampart'), 'buildings', (L, x, y, z) => rampart(L, x - 5, z, x + 5, z, y, 3), t('11 blocks along X with battlements')],
  ['wall', t('Stepped fence'), 'buildings', (L, x, y, z) => steppedWall(L, x - 5, z, x + 5, z, y, 1, 3), t('height wanders 1–3')],
  ['stairs', t('Stairs'), 'buildings', (L, x, y, z) => stairway(L, x, y, z, 1, 0, 4, 3, 'stone'), t('4 steps towards +X, width 3')],
  ['plaza', t('Tiled plaza'), 'buildings', (L, x, y, z) => floorRect(L, x - 2, z - 2, x + 2, z + 2, y - 1, 'tiles'), t('5 × 5 level with the ground')],
  ['hay', t('Hay stack'), 'yard', (L, x, y, z) => hayStack(L, x, y, z, [['###', '###'], ['##.', '#..']]), t('pyramid of bales')],
];

/** The whole catalog: blocks, decor, kits, lights, service objects and user prefabs */
export function catalog(user: UserPrefab[]): Prefab[] {
  const out: Prefab[] = [];
  for (const cat of CATEGORIES) for (const b of BLOCKS) if (b.category === cat && b.name !== 'air') out.push({ id: `block:${b.name}`, title: t(b.title), group: 'blocks', category: cat, kind: 'block', name: b.name, hint: t('block 1 × 1 × 1 m') });
  for (const cat of DECOR_CATEGORIES) for (const d of DECOR) if (d.category === cat) out.push({ id: `decor:${d.name}`, title: t(d.title), group: 'decor', category: cat, kind: 'decor', name: d.name, hint: d.anchor === 'floor' ? t('placed on the floor') : d.anchor === 'wall' ? t('hung on a wall') : t('hangs from the ceiling') });
  for (const [id, title, cat, build, hint] of KITS) out.push({ id: `kit:${id}`, title, group: 'kits', category: cat, kind: 'kit', build, hint });
  out.push(
    { id: 'light:point', title: t('Point light'), group: 'lights', category: 'sources', kind: 'light', name: 'point', icon: 'light', hint: t('shines in all directions') },
    { id: 'light:spot', title: t('Spotlight'), group: 'lights', category: 'sources', kind: 'light', name: 'spot', icon: 'spot', hint: t('cone of light downwards') },
    { id: 'spawn', title: t('Spawn point'), group: 'service', category: 'player', kind: 'spawn', icon: 'flag', hint: t('Player Start — where the hero begins') },
  );
  for (const cat of LIBRARY_CATEGORIES) for (const p of LIBRARY) if (p.category === cat) out.push({ id: `lib:${p.id}`, title: t(p.title) + (p.seed > 1 ? ` ${p.seed}` : ''), group: 'library', category: cat, kind: 'lib', user: p, lib: p, hint: `${p.hint ? t(p.hint) : ''}${p.hint ? ' · ' : ''}${t('{w} × {d} m, {n} decor · R — rotate', { w: p.size[0], d: p.size[2], n: p.decor.length })}` });
  for (const u of user) out.push({ id: `user:${u.id}`, title: u.title, group: 'mine', category: 'saved', kind: 'user', user: u, hint: t('{b} blocks, {n} decor', { b: u.cells.length, n: u.decor.length }) });
  return out;
}

const USER_KEY = 'malina.editor.prefabs';
export function loadUserPrefabs(): UserPrefab[] {
  try { return JSON.parse(localStorage.getItem(USER_KEY) ?? '[]') as UserPrefab[]; } catch { return []; }
}
export function saveUserPrefabs(list: UserPrefab[]): void {
  try { localStorage.setItem(USER_KEY, JSON.stringify(list)); } catch { /* no space — prefabs live until reload */ }
}

/** Stamp a prefab blank (user or library) into the map rotated by quarter quarters (via level.set — that is how the editor records edits for undo) */
export function stampUser(L: Level, u: PrefabData, x: number, y: number, z: number, quarter = 0): { decor: DecorItem[]; entities: LevelEntity[] } {
  return stampPrefab(L, u, x, y, z, quarter);
}

/**
 * Prefab previews: a small separate render, one frame per prefab, a few per frame — the editor does not wait.
 * Blocks and kits are built in an empty map, decor is placed at the origin; the camera is aimed at the bounds.
 */
export class Thumbs {
  private readonly cache = new Map<string, string>();
  private readonly queue: Prefab[] = [];
  private r: THREE.WebGLRenderer | null = null;
  private sc = new THREE.Scene();
  private L = new Level('preview');
  private view: LevelRenderer | null = null;
  private readonly cam = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
  private readonly listeners = new Set<(id: string, url: string) => void>();

  private readonly T: Textures;
  constructor(T: Textures) { this.T = T;}

  get(p: Prefab): string | undefined {
    const c = this.cache.get(p.id);
    if (c === undefined && !p.icon && !this.queue.includes(p)) this.queue.push(p);
    return c;
  }
  onReady(fn: (id: string, url: string) => void): void { this.listeners.add(fn); }

  /** Render a few previews from the queue (call from the editor frame) */
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
    this.L = new Level('preview');
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

/** Flat and small blocks (grass, flowers, fire) look better on a cell of ground */
const blockIsFlat = (name: string): boolean => {
  const b = BLOCKS.find((b) => b.name === name);
  return !!b && (b.replaceable || b.collide === 0) && !b.full;
};
