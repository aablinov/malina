import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { makeTextures, textureByName } from '../textures.ts';
import { Level, type DecorItem, type LevelEntity, type LevelJSON } from '../level/level.ts';
import { LevelRenderer } from '../level/mesher.ts';
import { BLOCKS, CATEGORIES, blockDef, type BlockDef } from '../level/palette.ts';
import { raycastVoxels } from '../level/collide.ts';
import { DIRS } from '../level/obj.ts';
import { MAPS, ROOMS } from '../level/maps.ts';
import { buildFloor } from '../level/dungeon.ts';
import { DECOR, decorDef, decorEuler } from '../level/decor.ts';
import { decorMatrix } from '../level/decor-render.ts';
import { attachedTo, placeDecor, type DecorPlacement } from '../level/decor-place.ts';
import { GROUNDS, GROUND_TITLES, landscape } from '../level/kit.ts';
import type { Layer } from '../level/palette.ts';
import { Lighting } from '../lighting.ts';
import { Weather } from '../weather.ts';
import { LIGHT_DEFAULTS, WEATHER_TITLES, WORLD_DEFAULTS, WORLD_PRESETS, aimLight, lightData, makeLight, mergeWorld, setWorld, sunOffset, worldOf, type LightData, type WeatherKind, type WorldSettings } from '../world.ts';
import { GROUPS, GROUP_TITLES, Thumbs, catalog, loadUserPrefabs, saveUserPrefabs, stampUser, type Prefab, type PrefabGroup, type UserPrefab } from './editor/prefabs.ts';
import { Outliner, type TreeNode } from './editor/outliner.ts';
import { Viewports, type Viewport } from './editor/viewports.ts';
import { PropGrid, closeMenus, h, icon, menuButton, popupMenu, splitter, type MenuItem } from './editor/ui.ts';
import './editor.css';
import { t } from '../i18n/i18n.ts';

/**
 * Level editor in the spirit of Unreal Engine (?dev=editor, F10 in the playground).
 * The map is a voxel grid (src/level/level.ts), blocks — the palette (src/level/palette.ts), shapes — assets/blocks/*.obj.
 * Saved to JSON (assets/maps/*.json) and to localStorage (autosave).
 *
 * Window: menu bar and toolbar on top; on the left — "Prefabs" (blocks, decor, kits, lights, service objects, user ones —
 * with sections and search, dragged with the mouse into a viewport); in the centre — viewports (one or four: perspective, top, front,
 * side) and the "Weapons" tab; on the right — "Outliner" (map tree) and "Details" / "World settings" (sun, sky and
 * global lighting, haze, weather, post-processing). At the bottom — the status bar.
 *
 * Modes (Tab — cycles): "Select" — LMB selects a block, item, light, spawn point (Shift — add, dragging over
 * empty space — marquee), the gizmo moves and rotates the selection along the axes (W / E / R — translate / rotate / scale, Q — no gizmo),
 * F — to the selection, Del — remove, Ctrl+D — copy, arrows — nudge, RMB — menu. "Blocks" — brush: LMB — place,
 * Shift+LMB — remove, Ctrl+LMB twice — fill a box (with Shift — cut out), Q — pick, R — rotate,
 * [ ] and 1–9 — palette. "Decor" — LMB places an item on the floor, wall or ceiling, LMB on an item — select and drag,
 * R / T / Y — yaw, pitch, roll by 15°, Z — random yaw, Ctrl+D — copy. "Landscape" — pieces of walkable
 * terrain (meta.lands): sliders, "Random", arrows — nudge, Del — remove. "Place" — a prefab from the panel on click.
 *
 * Camera: wheel — zoom, MMB or Alt+LMB — orbit around the target, RMB — pan, RMB + WASD / QE — fly,
 * in brush modes WASD moves without RMB too. PgUp / PgDn — height slice, G — grid, Alt+X — maximise the viewport.
 * Ctrl+Z / Ctrl+Y — undo and redo (properties, lights and world too), Ctrl+S — download JSON, Ctrl+O — open.
 */

export const EDITOR_STORAGE = 'malina.editor.level';
const QUICK = ['grass', 'dirt', 'stone', 'cobble', 'bricks', 'planks', 'log', 'leaves', 'water'];
const maps = MAPS;

interface BlockEdit { x: number; y: number; z: number; was: [string, number]; now: [string, number] }
/** Decor edit: before null — the item was added, after null — removed, otherwise — changed (field snapshots) */
interface DecorEdit { decor: DecorItem; before: DecorItem | null; after: DecorItem | null }
/** Terrain piece on the map (meta.lands): centre, parameters and the cells it changed — [x, y, z, was, rot, now, rot] */
interface LandPiece { x: number; y: number; z: number; w: number; d: number; layers: number; scale: number; stone: number; seed: number; /** Ground (GROUNDS): no field — grass */ ground?: string; cells: [number, number, number, string, number, string, number][] }
type LandParams = Omit<LandPiece, 'cells'>;
/** Terrain piece edit: snapshots of the record before and after (null — no piece) */
interface LandEdit { land: LandPiece; before: LandPiece | null; after: LandPiece | null }
/** Property edit (world, light, spawn point): how to undo and redo; consecutive ones with the same key merge */
interface PropEdit { key: string; t: number; undo: () => void; redo: () => void }
type Edit = BlockEdit | DecorEdit | LandEdit | PropEdit;
const snapDecor = (d: DecorItem): DecorItem => JSON.parse(JSON.stringify(d)) as DecorItem;
const snapLand = (p: LandPiece): LandPiece => JSON.parse(JSON.stringify(p)) as LandPiece;
const landParams = ({ cells: _, ...p }: LandPiece): LandParams => p;
/** Rectangle of a piece: x0, z0, x1, z1 and the top of the frame in height */
const landRect = (p: LandParams): [number, number, number, number, number] => {
  const x0 = p.x - Math.floor(p.w / 2), z0 = p.z - Math.floor(p.d / 2);
  return [x0, z0, x0 + p.w - 1, z0 + p.d - 1, p.y + Math.ceil(p.layers / 2) + 2];
};

type Mode = 'select' | 'blocks' | 'decor' | 'land' | 'place';
type Tool = 'select' | 'translate' | 'rotate' | 'scale';
type WorldPart = 'sun' | 'sky' | 'fog' | 'weather' | 'post';
/** What is selected: block, decor item, light, spawn point, terrain piece, world section */
type Sel =
  | { t: 'block'; x: number; y: number; z: number }
  | { t: 'decor'; d: DecorItem }
  | { t: 'light'; e: LevelEntity }
  | { t: 'spawn' }
  | { t: 'land'; p: LandPiece }
  | { t: 'world'; part: WorldPart };

const MODE_TITLES: Record<Mode, string> = { select: t('Select'), blocks: t('Blocks'), decor: t('Decor'), land: t('Landscape'), place: t('Place') };
const MODE_ICONS: Record<Mode, string> = { select: 'select', blocks: 'brush', decor: 'decor', land: 'land', place: 'prefab' };
const WORLD_PARTS: [WorldPart, string, string, string][] = [
  ['sun', t('Sun'), 'sun', 'DirectionalLight'],
  ['sky', t('Sky and global light'), 'sky', 'SkyLight'],
  ['fog', t('Haze'), 'fog', 'HeightFog'],
  ['weather', t('Weather'), 'rain', 'Weather'],
  ['post', t('Post-processing'), 'post', 'PostProcessVolume'],
];

export function runEditor(): void {
  document.body.classList.add('dev-editor');
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const mainCam = new THREE.PerspectiveCamera(40, 1, 0.3, 600);
  mainCam.position.set(22, 24, 26);
  // light "like in Unreal" (src/lighting.ts) with the map's world settings (src/world.ts) and weather — as in the game
  const look = new Lighting(renderer, scene, mainCam);
  const weather = new Weather(scene);

  const T = makeTextures();
  let level = loadInitial();
  let view = new LevelRenderer(scene, level, T);
  let world = worldOf(level);

  // ---------- window ----------
  const root = h('div.ue');
  const menubar = h('div.ue-menubar');
  const toolbar = h('div.ue-toolbar');
  const left = h('div.ue-left.ue-panel');
  const center = h('div.ue-center');
  const right = h('div.ue-right');
  const status = h('div.ue-status');
  const toastEl = h('div.ue-toast');
  const main = h('div.ue-main');
  root.append(menubar, toolbar, main, status, toastEl);
  document.body.appendChild(root);

  const vps = new Viewports(canvas, renderer, mainCam);
  const docTabs = h('div.ue-doctabs');
  const weaponsHost = h('div.ue-weapons');
  weaponsHost.hidden = true;
  center.append(docTabs, h('div.ue-docs', {}, vps.el, weaponsHost));
  const outlPanel = h('div.ue-panel.ue-outl-panel');
  const detPanel = h('div.ue-panel.ue-det-panel');
  right.append(outlPanel, splitter(root, '--ue-outl-h', 'y', 1, 120, 900), detPanel);
  main.append(left, splitter(root, '--ue-left-w', 'x', 1, 180, 520), center, splitter(root, '--ue-right-w', 'x', -1, 260, 640), right);

  let toastT: ReturnType<typeof setTimeout> | undefined;
  const log: string[] = [];
  const toast = (s: string) => {
    toastEl.textContent = s; toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 1800);
    log.push(`${new Date().toLocaleTimeString()}  ${s}`); if (log.length > 200) log.shift();
  };

  // ---------- state ----------
  let mode: Mode = 'select';
  let tool: Tool = 'translate';
  let current = 'grass', rot = 0;
  let maxY = 64;
  let corner: [number, number, number] | null = null;
  const undo: Edit[][] = [], redo: Edit[][] = [];
  let batch: Edit[] | null = null;
  let place: [number, number, number] | null = null, hit: [number, number, number] | null = null;
  let lastPainted = '';
  let drag: 'place' | 'remove' | null = null;
  let dirtyAutosave = false;
  /** Landscape for a new piece: size, layers of 0.5 m, plate coarseness, stone share (%), noise seed — it drives the curves of the edges and corners */
  const land: { w: number; d: number; layers: number; scale: number; stone: number; seed: number; ground: string } = { w: 24, d: 18, layers: 4, scale: 22, stone: 30, seed: 1, ground: 'grass' };
  /** Selected piece — edited by the sliders, "Random", arrows and Del; live — the last edit of the piece, the next ones merge into it */
  let selLand: LandPiece | null = null, hoverLand: LandPiece | null = null;
  let live: { piece: LandPiece; batch: Edit[] } | null = null;
  let curDecor = DECOR[0].name;
  /** User rotation: [yaw, pitch, roll], degrees */
  const dRot = [0, 0, 0];
  let randomYaw = false, randYaw = 0;
  let placement: DecorPlacement | null = null;
  let hoverDecor: DecorItem | null = null, selected: DecorItem | null = null;
  let moving: { item: DecorItem; before: DecorItem } | null = null;
  /** Selection in "Select" mode */
  let sel: Sel[] = [];
  /** Prefab for "Place" mode */
  let curPrefab: Prefab | null = null;
  /** Preset rotation in "Place" mode, quarters (R) */
  let placeRot = 0;
  /** Grid and angle step for the gizmo */
  const snap = { grid: true, gridStep: 1, rotOn: true, rotStep: 15 };
  /** "Show" flags */
  const show = { grid: true, icons: true, decor: true, weather: true, fog: true, stats: true };
  let entVersion = 0;
  let userPrefabs = loadUserPrefabs();
  let prefabs = catalog(userPrefabs);
  const thumbs = new Thumbs(T);

  // ---------- menu bar ----------
  const mbtn = (label: string, items: () => MenuItem[]) => menuButton(h('button.ue-mb', { text: label }), items);
  const nameInput = h('input.ue-mapname', { spellcheck: 'false', title: t('Map name') });
  nameInput.addEventListener('input', () => { level.name = nameInput.value; dirtyAutosave = true; outliner.invalidate(); docTabs.querySelector('.lvl span')!.textContent = level.name; });
  nameInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') nameInput.blur(); });
  menubar.append(
    h('span.ue-logo', { html: '<b>M</b>' }),
    mbtn(t('File'), () => [
      { label: t('New map'), icon: 'plus', action: newMap },
      { label: t('Open JSON…'), icon: 'folder', shortcut: 'Ctrl+O', action: open },
      { label: t('Download JSON'), icon: 'save', shortcut: 'Ctrl+S', action: save },
      { sep: true },
      { label: t('Built-in maps'), icon: 'world', sub: () => Object.keys(maps).sort().map((p) => ({ label: `${t(maps[p].name)}  ·  ${p}`, action: () => { setLevel(Level.fromJSON(maps[p])); toast(t('Opened "{name}"', { name: level.name })); } })) },
      { label: t('Dungeon floor…'), icon: 'grid', action: floorDialog },
      { sep: true },
      { label: t('Play this map'), icon: 'play', shortcut: 'F5', action: play },
    ]),
    mbtn(t('Edit'), () => [
      { label: t('Undo'), icon: 'undo', shortcut: 'Ctrl+Z', disabled: !undo.length, action: doUndo },
      { label: t('Redo'), icon: 'redo', shortcut: 'Ctrl+Y', disabled: !redo.length, action: doRedo },
      { sep: true },
      { label: t('Duplicate'), icon: 'copy', shortcut: 'Ctrl+D', disabled: !sel.length, action: duplicateSel },
      { label: t('Delete'), icon: 'trash', shortcut: 'Del', disabled: !sel.length, action: deleteSel },
      { label: t('Deselect'), shortcut: 'Esc', action: () => select([]) },
      { label: t('Select all blocks like this'), disabled: !sel.some((s) => s.t === 'block'), action: selectSameBlocks },
      { sep: true },
      { label: t('Create prefab from selection…'), icon: 'prefab', disabled: !sel.length, action: makePrefab },
    ]),
    mbtn(t('View'), () => [
      { head: t('Viewport layout') },
      { label: t('One viewport'), icon: 'layout1', checked: vps.layout === 'one', action: () => vps.setLayout('one') },
      { label: t('Two side by side'), icon: 'layout2', checked: vps.layout === 'two', action: () => vps.setLayout('two') },
      { label: t('Four views'), icon: 'layout4', checked: vps.layout === 'four', action: () => vps.setLayout('four') },
      { sep: true },
      ...showItems(),
      { sep: true },
      { label: t('Turntable: the scene rotates'), icon: 'turntable', checked: vps.list[0].controls.autoRotate, action: () => { const c = vps.list[0].controls; c.autoRotate = !c.autoRotate; } },
      { label: t('To the selection'), icon: 'focus', shortcut: 'F', action: focusSel },
      { label: t('Show the whole map'), icon: 'world', shortcut: 'Home', action: frameAll },
    ]),
    mbtn(t('Window'), () => [
      { label: t('Prefabs'), icon: 'prefab', checked: !left.hidden, action: () => { left.hidden = !left.hidden; root.classList.toggle('no-left', left.hidden); } },
      { label: t('Outliner and details'), icon: 'world', checked: !right.hidden, action: () => { right.hidden = !right.hidden; root.classList.toggle('no-right', right.hidden); } },
      { label: t('World settings'), icon: 'sun', action: () => setDetTab('world') },
      { label: t('Weapons'), icon: 'weapon', action: () => setDoc('weapons') },
      { label: t('Log'), icon: 'info', action: showLog },
    ]),
    mbtn(t('Help'), () => [{ label: t('Hotkeys'), icon: 'info', shortcut: 'F1', action: showHelp }]),
    h('span.ue-grow'),
    nameInput,
    h('span.ue-proj', { text: t('Malina') }),
  );

  // ---------- toolbar ----------
  const tb = (iconName: string, title: string, fn: () => void, label = '') => {
    const b = h('button.ue-tb', { html: `${icon(iconName)}${label ? `<span>${label}</span>` : ''}`, title });
    b.addEventListener('click', () => { fn(); b.blur(); });
    return b;
  };
  const modeBtn = h('button.ue-tb.ue-tb-mode');
  menuButton(modeBtn, () => (Object.keys(MODE_TITLES) as Mode[]).map((m, i) => ({ label: MODE_TITLES[m], icon: MODE_ICONS[m], shortcut: `Shift+${i + 1}`, checked: mode === m, action: () => setMode(m) })));
  const toolBtns: Record<Tool, HTMLButtonElement> = {
    select: tb('select', t('Select only (Q)'), () => setTool('select')),
    translate: tb('move', t('Translate (W)'), () => setTool('translate')),
    rotate: tb('rotate', t('Rotate along axes (E)'), () => setTool('rotate')),
    scale: tb('scale', t('Scale (R): landscape, light range'), () => setTool('scale')),
  };
  const gridBtn = h('button.ue-tb.ue-snap', { title: t('Snap to grid') });
  gridBtn.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('.v')) return; snap.grid = !snap.grid; refreshToolbar(); });
  const gridVal = h('span.v');
  menuButton(gridVal, () => [1 / 16, 1 / 8, 0.25, 0.5, 1, 2].map((v) => ({ label: t('{v} m', { v: v < 1 ? `1/${1 / v}` : v }), checked: snap.gridStep === v, action: () => { snap.gridStep = v; snap.grid = true; refreshToolbar(); } })));
  gridBtn.append(h('span', { html: icon('grid') }), gridVal);
  const rotBtn = h('button.ue-tb.ue-snap', { title: t('Angle snap') });
  rotBtn.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('.v')) return; snap.rotOn = !snap.rotOn; refreshToolbar(); });
  const rotVal = h('span.v');
  menuButton(rotVal, () => [5, 15, 30, 45, 90].map((v) => ({ label: `${v}°`, checked: snap.rotStep === v, action: () => { snap.rotStep = v; snap.rotOn = true; refreshToolbar(); } })));
  rotBtn.append(h('span', { html: icon('angle') }), rotVal);
  const envBtn = h('button.ue-tb', { html: `${icon('sun')}<span>${t('Environment')}</span>`, title: t('Ready-made light and weather presets') });
  menuButton(envBtn, () => [
    { head: t('Preset') },
    ...Object.entries(WORLD_PRESETS).map(([, p]) => ({ label: p.title, action: () => { changeWorld((w) => Object.assign(w, mergeWorld(WORLD_DEFAULTS, p.patch)), 'preset'); toast(t('Environment: {title}', { title: p.title })); } })),
    { sep: true },
    { head: t('Weather') },
    ...(Object.keys(WEATHER_TITLES) as WeatherKind[]).map((k) => ({ label: WEATHER_TITLES[k], checked: world.weather.kind === k, action: () => changeWorld((w) => { w.weather.kind = k; }) })),
    { sep: true },
    { label: t('World settings…'), icon: 'world', action: () => setDetTab('world') },
  ]);
  const playBtn = h('button.ue-tb.ue-play', { html: `${icon('play')}<span>${t('Play')}</span>`, title: t('Open the game with this map (F5)') });
  playBtn.addEventListener('click', play);
  const statEl = h('span.ue-tb-stat');
  toolbar.append(
    tb('save', t('Download JSON (Ctrl+S)'), save),
    h('span.ue-sep'),
    modeBtn,
    h('span.ue-sep'),
    toolBtns.select, toolBtns.translate, toolBtns.rotate, toolBtns.scale,
    h('span.ue-sep'),
    gridBtn, rotBtn,
    h('span.ue-sep'),
    tb('undo', t('Undo (Ctrl+Z)'), () => doUndo()), tb('redo', t('Redo (Ctrl+Y)'), () => doRedo()),
    h('span.ue-sep'),
    tb('prefab', t('Create prefab from selection'), () => makePrefab(), t('Prefab')),
    envBtn,
    tb('weapon', t('Weapons: preview and balance'), () => setDoc('weapons'), t('Weapons')),
    h('span.ue-grow'),
    statEl,
    playBtn,
  );
  function refreshToolbar(): void {
    modeBtn.innerHTML = `${icon(MODE_ICONS[mode])}<span>${MODE_TITLES[mode]}</span>${icon('chevron', 'dd')}`;
    for (const [k, b] of Object.entries(toolBtns)) { b.classList.toggle('on', mode === 'select' && tool === k); b.disabled = mode !== 'select'; }
    gridBtn.classList.toggle('on', snap.grid); gridVal.textContent = snap.gridStep < 1 ? `1/${1 / snap.gridStep}` : String(snap.gridStep);
    rotBtn.classList.toggle('on', snap.rotOn); rotVal.textContent = `${snap.rotStep}°`;
    applyGizmo();
  }

  // ---------- document tabs: level and weapons ----------
  let doc: 'level' | 'weapons' = 'level';
  let weaponsPanel: { show(): void; hide(): void } | null = null;
  docTabs.append(
    h('div.ue-doctab.lvl.on', { html: `${icon('world')}<span></span>`, onclick: () => setDoc('level') }),
    h('div.ue-doctab.wpn', { html: `${icon('weapon')}<span>${t('Weapons')}</span>`, onclick: () => setDoc('weapons') }),
  );
  function setDoc(d: 'level' | 'weapons'): void {
    doc = d;
    docTabs.querySelector('.lvl')!.classList.toggle('on', d === 'level');
    docTabs.querySelector('.wpn')!.classList.toggle('on', d === 'weapons');
    vps.el.hidden = d !== 'level';
    // weapons is a separate asset editor: hide the level panels, give it the full width
    root.classList.toggle('doc-weapons', d === 'weapons');
    weaponsHost.hidden = d !== 'weapons';
    if (d === 'weapons') {
      if (!weaponsPanel) {
        weaponsHost.textContent = t('Loading…');
        void import('./editor/weapons-panel.ts').then((m) => { weaponsHost.textContent = ''; weaponsPanel = m.mountWeaponsPanel(weaponsHost); if (doc === 'weapons') weaponsPanel.show(); })
          .catch((e: Error) => { weaponsHost.textContent = t('The weapons panel failed to load: {msg}', { msg: e.message }); });
      } else weaponsPanel.show();
    } else { weaponsPanel?.hide(); vps.resize(); }
  }

  // ---------- left panel: mode tools and prefabs ----------
  const modeTools = h('div.ue-modetools');
  const pfTabs = h('div.ue-pf-tabs');
  const pfSearch = h('input.ue-search', { type: 'search', placeholder: t('Search prefabs…'), spellcheck: 'false' });
  const pfList = h('div.ue-pf-list');
  let pfGroup: PrefabGroup = 'all';
  left.append(h('div.ue-panel-h', { html: `${icon('prefab')}<span>${t('Prefabs')}</span>` }), modeTools, pfTabs, h('div.ue-pf-search', {}, h('span.ue-search-ic', { html: icon('search') }), pfSearch), pfList);
  pfSearch.addEventListener('input', () => drawPrefabs());
  pfSearch.addEventListener('keydown', (e) => e.stopPropagation());
  for (const g of GROUPS) pfTabs.append(h('button.ue-chip', { text: GROUP_TITLES[g], 'data-g': g, onclick: () => { pfGroup = g; drawPrefabs(); } }));
  const blockThumb = new Map<string, string>();
  const texThumb = (b: BlockDef): string => {
    let t = blockThumb.get(b.name);
    if (t !== undefined) return t;
    const part = b.parts[0];
    const texName = part ? (part.tex.top ?? part.tex.side ?? Object.values(part.tex)[0]) : undefined;
    const tn = Array.isArray(texName) ? texName[0] : texName;
    t = tn ? (textureByName(T, tn).image as HTMLCanvasElement).toDataURL() : '';
    blockThumb.set(b.name, t);
    return t;
  };
  const thumbOf = (p: Prefab): string => thumbs.get(p) ?? (p.kind === 'block' ? texThumb(blockDef(p.name!)) : '');
  thumbs.onReady((id, url) => { for (const img of pfList.querySelectorAll<HTMLImageElement>(`img[data-id="${CSS.escape(id)}"]`)) img.src = url; });
  function drawPrefabs(): void {
    for (const c of pfTabs.children) c.classList.toggle('on', (c as HTMLElement).dataset.g === pfGroup);
    const q = pfSearch.value.trim().toLowerCase();
    const list = prefabs.filter((p) => (pfGroup === 'all' || p.group === pfGroup) && (!q || `${p.title} ${p.name ?? ''} ${t(p.category)} ${GROUP_TITLES[p.group]}`.toLowerCase().includes(q)));
    pfList.textContent = '';
    let lastCat = '';
    for (const p of list) {
      const cat = `${GROUP_TITLES[p.group]} · ${t(p.category)}`;
      if (cat !== lastCat) { pfList.append(h('div.ue-pf-cat', { text: pfGroup === 'all' ? cat : t(p.category) })); lastCat = cat; }
      const on = (mode === 'blocks' && p.kind === 'block' && p.name === current) || (mode === 'decor' && p.kind === 'decor' && p.name === curDecor) || (mode === 'place' && curPrefab?.id === p.id);
      const tile = h('div.ue-pf', { draggable: 'true', title: `${p.title}${p.name ? ` · ${p.name}` : ''}\n${p.hint ?? ''}\n${t('Click — select, drag — place in a viewport')}` });
      if (on) tile.classList.add('on');
      tile.append(
        p.icon ? h('span.ue-pf-ic', { html: icon(p.icon) }) : h('img', { src: thumbOf(p), alt: '', 'data-id': p.id }),
        h('span.ue-pf-t', { text: p.title }),
      );
      tile.addEventListener('click', () => pickPrefab(p));
      tile.addEventListener('dragstart', (e) => { e.dataTransfer!.setData('text/x-malina-prefab', p.id); e.dataTransfer!.effectAllowed = 'copy'; });
      tile.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const items: MenuItem[] = [{ label: t('Select'), action: () => pickPrefab(p) }];
        if (p.kind === 'user') items.push({ label: t('Save to the library (JSON)'), icon: 'save', action: () => exportPrefab(p.user!) });
        if (p.kind === 'user') items.push({ label: t('Delete prefab'), icon: 'trash', action: () => { userPrefabs = userPrefabs.filter((u) => u !== p.user); saveUserPrefabs(userPrefabs); prefabs = catalog(userPrefabs); drawPrefabs(); } });
        popupMenu(e.clientX, e.clientY, items);
      });
      pfList.append(tile);
    }
    if (!list.length) pfList.append(h('div.ue-empty', { text: pfGroup === 'mine' ? t('Empty. Select blocks and decor — "Create prefab from selection".') : t('Nothing found') }));
  }
  function pickPrefab(p: Prefab): void {
    if (p.kind === 'block') { setCurrent(p.name!); setMode('blocks'); }
    else if (p.kind === 'decor') { setDecor(p.name!); setMode('decor'); }
    else { curPrefab = p; setMode('place'); }
    drawPrefabs();
  }

  function drawModeTools(): void {
    modeTools.textContent = '';
    const head = (ic: string, title: string, sub: string, img?: string) =>
      h('div.ue-cur', { html: `${img ? `<img src="${img}" alt="">` : `<span class="ue-pf-ic">${icon(ic)}</span>`}<div><b>${title}</b><br><small>${sub}</small></div>` });
    if (mode === 'select') {
      const n = sel.length;
      modeTools.append(head('select', n ? t('Selected: {n}', { n }) : t('Select'), n ? selSummary() : t('LMB — select · Shift — add · marquee over empty space')));
    } else if (mode === 'blocks') {
      const d = blockDef(current);
      modeTools.append(head('block', t(d.title), `${d.name}${d.rotatable ? ` · ${t('rotation {deg}° (R)', { deg: rot * 90 })}` : ''} · ${t('slice y ≤ {y}', { y: maxY })}`, thumbs.get(prefabs.find((p) => p.id === `block:${current}`)!) ?? texThumb(d)));
    } else if (mode === 'decor') {
      const d = decorDef(curDecor);
      const r = dRot.some(Boolean) ? ` · ${dRot.join('° / ')}°` : '';
      modeTools.append(head('decor', t(d.title), `${d.name}${r}${randomYaw ? ` · ${t('random yaw')}` : ''}${selected ? ` · ${t('selected: {title}', { title: t(decorDef(selected.name).title) })}` : ''}`, thumbs.get(prefabs.find((p) => p.id === `decor:${curDecor}`)!)));
    } else if (mode === 'place') {
      modeTools.append(head(curPrefab?.icon ?? 'prefab', curPrefab?.title ?? t('Pick a prefab'), curPrefab ? `${curPrefab.hint ?? ''}${curPrefab.kind === 'lib' || curPrefab.kind === 'user' ? ` · ${t('rotation {deg}°', { deg: placeRot * 90 })}` : ''} · ${t('LMB — place')}` : t('click a prefab below'), curPrefab && !curPrefab.icon ? thumbs.get(curPrefab) : undefined));
    } else {
      const p = selLand ?? land;
      modeTools.append(head('land', selLand ? t('Piece at {x}, {y}, {z}', { x: selLand.x, y: selLand.y, z: selLand.z }) : t('New landscape piece'), t('{w} × {d} m · {n} layers ({h} m) · seed {seed}', { w: p.w, d: p.d, n: p.layers, h: p.layers / 2, seed: p.seed })));
      const g = new PropGrid();
      g.section(t('Landscape — walkable from everywhere'), 'land');
      const ln = (label: string, key: Exclude<keyof typeof land, 'ground'>, min: number, max: number, step = 1) =>
        g.num(label, () => (selLand ?? land)[key], (v) => setLandParam(key, Math.round(v)), { min, max, step, slider: true });
      ln(t('Size X'), 'w', 6, 64); ln(t('Size Z'), 'd', 6, 64); ln(t('Layers × 0.5 m'), 'layers', 1, 10); ln(t('Coarseness'), 'scale', 8, 40); ln(t('Stone, %'), 'stone', 0, 80, 5);
      g.text(t('Ground'), () => GROUND_TITLES[(selLand ?? land).ground ?? 'grass'] ?? t('Grass'), () => {}, true);
      g.buttons(...Object.keys(GROUNDS).map((k): [string, () => void, string?] => [GROUND_TITLES[k] ?? k, () => setLandGround(k), 'land']));
      g.buttons([t('Random: edges and corners'), () => { randomizeLand(); toast(t('New edges and corners')); }, 'turntable']);
      g.note(t('LMB on the ground — place, LMB on a piece — select, Shift+LMB — a new one on top. Arrows — nudge, Del — remove, Esc — deselect.'));
      g.refresh();
      landGrid = g;
      modeTools.append(g.el);
    }
  }
  let landGrid: PropGrid | null = null;
  function syncSliders(): void { landGrid?.refresh(); }
  function setLandParam(key: Exclude<keyof typeof land, 'ground'>, v: number): void {
    if (selLand) changeLand(selLand, { ...landParams(selLand), [key]: v });
    else { land[key] = v; refreshHud(); }
  }
  function setLandGround(ground: string): void {
    if (selLand) changeLand(selLand, { ...landParams(selLand), ground });
    else { land.ground = ground; refreshHud(); }
  }
  function randomizeLand(): void { setLandParam('seed', 1 + Math.floor(Math.random() * 1e6)); }

  // ---------- right panel: outliner ----------
  const ICON_OF_BLOCK = (b: BlockDef) => (b.light || b.bakedLight ? 'light' : 'block');
  const outliner = new Outliner({
    roots: () => outlineRoots(),
    isSelected: (id) => selIds.has(id),
    onSelect: (n, e) => outlinerSelect(n, e.shiftKey || e.ctrlKey || e.metaKey),
    onDbl: (n) => { outlinerSelect(n, false); focusSel(); },
    onContext: (n, e) => { if (!selIds.has(n.id)) outlinerSelect(n, false); popupMenu(e.clientX, e.clientY, contextItems()); },
  });
  outlPanel.append(h('div.ue-panel-h', { html: `${icon('world')}<span>${t('Outliner')}</span>` }), outliner.el);
  /** Tree nodes → selection */
  const nodeSel = new Map<string, Sel[]>();
  let selIds = new Set<string>();
  const selId = (s: Sel): string => s.t === 'block' ? `b:${s.x},${s.y},${s.z}` : s.t === 'decor' ? `d:${level.decor.indexOf(s.d)}` : s.t === 'light' ? `l:${level.entities.indexOf(s.e)}` : s.t === 'land' ? `n:${lands().indexOf(s.p)}` : s.t === 'world' ? `w:${s.part}` : 'spawn';
  function outlineRoots(): TreeNode[] {
    nodeSel.clear();
    const node = (id: string, label: string, ic: string, type: string, s: Sel[] | null, extra: Partial<TreeNode> = {}): TreeNode => { if (s) nodeSel.set(id, s); return { id, label, icon: ic, type, ...extra }; };
    const lights = level.entities.filter((e) => e.kind === 'light');
    // blocks by type: type → cells (up to 400 per type)
    const byType = new Map<string, [number, number, number][]>();
    let nBlocks = 0;
    level.forEach((x, y, z, id) => { const n = level.palette[id]; let a = byType.get(n); if (!a) byType.set(n, a = []); a.push([x, y, z]); nBlocks++; });
    const decorBy = new Map<string, DecorItem[]>();
    for (const d of level.decor) { const c = decorDef(d.name).category; let a = decorBy.get(c); if (!a) decorBy.set(c, a = []); a.push(d); }
    return [node('root', level.name || t('Unnamed'), 'world', 'World', null, {
      kids: () => [
        node('world', t('Environment'), 'sun', 'Folder', WORLD_PARTS.map(([part]) => ({ t: 'world', part }) as Sel), {
          kids: () => WORLD_PARTS.map(([part, title, ic, type]) => node(`w:${part}`, part === 'weather' ? `${title}: ${WEATHER_TITLES[world.weather.kind]}` : title, ic, type, [{ t: 'world', part }],
            part === 'fog' ? { eye: { get: () => show.fog, set: (v) => { show.fog = v; } } } : part === 'weather' ? { eye: { get: () => show.weather, set: (v) => { show.weather = v; } } } : {})),
        }),
        node('spawn', t('Spawn point'), 'flag', 'PlayerStart', level.spawn ? [{ t: 'spawn' }] : null),
        node('lights', t('Lights'), 'light', 'Folder', lights.map((e) => ({ t: 'light', e }) as Sel), {
          count: lights.length, eye: { get: () => show.icons, set: (v) => { show.icons = v; } },
          kids: () => lights.map((e) => { const d = lightData(e.data); return node(`l:${level.entities.indexOf(e)}`, d.name || (d.type === 'spot' ? t('Spotlight') : t('Point light')), d.type === 'spot' ? 'spot' : 'light', d.type === 'spot' ? 'SpotLight' : 'PointLight', [{ t: 'light', e }]); }),
        }),
        node('lands', t('Landscape'), 'land', 'Folder', lands().map((p) => ({ t: 'land', p }) as Sel), {
          count: lands().length,
          kids: () => lands().map((p, i) => node(`n:${i}`, t('Piece {w} × {d}, {n} layers', { w: p.w, d: p.d, n: p.layers }), 'land', 'Landscape', [{ t: 'land', p }])),
        }),
        node('decor', t('Decor'), 'decor', 'Folder', null, {
          count: level.decor.length, eye: { get: () => show.decor, set: (v) => { show.decor = v; } },
          kids: () => [...decorBy].map(([cat, items]) => node(`dc:${cat}`, t(cat), 'folder', 'Folder', items.map((d) => ({ t: 'decor', d }) as Sel), {
            count: items.length,
            kids: () => items.map((d) => node(`d:${level.decor.indexOf(d)}`, t(decorDef(d.name).title), 'decor', 'Decor', [{ t: 'decor', d }])),
          })),
        }),
        node('blocks', t('Blocks'), 'cube', 'Folder', null, {
          count: nBlocks,
          kids: () => [...byType].sort((a, b) => b[1].length - a[1].length).map(([name, cells]) => {
            const def = blockDef(name);
            return node(`bt:${name}`, t(def.title), ICON_OF_BLOCK(def), 'BlockType', null, {
              count: cells.length, heavy: true,
              kids: () => cells.slice(0, 400).map(([x, y, z]) => node(`b:${x},${y},${z}`, `${x}, ${y}, ${z}`, 'block', def.name, [{ t: 'block', x, y, z }])),
            });
          }),
        }),
      ],
    })];
  }
  function outlinerSelect(n: TreeNode, add: boolean): void {
    if (mode !== 'select' && mode !== 'land') setMode('select');
    if (n.id.startsWith('bt:')) { const name = n.id.slice(3); const s: Sel[] = []; level.forEach((x, y, z, id) => { if (level.palette[id] === name) s.push({ t: 'block', x, y, z }); }); select(add ? [...sel, ...s] : s); return; }
    const s = nodeSel.get(n.id);
    if (!s) return;
    if (n.id.startsWith('n:') && mode === 'land') { selectLand(s[0].t === 'land' ? s[0].p : null); return; }
    if (n.id.startsWith('n:') && s[0].t === 'land') selLand = s[0].p;
    if (n.id.startsWith('w:')) setDetTab('details');
    select(add ? toggleSel(sel, s) : s);
  }
  const toggleSel = (cur: Sel[], add: Sel[]): Sel[] => {
    const ids = new Set(add.map(selId));
    const had = cur.filter((s) => ids.has(selId(s)));
    if (add.length === 1 && had.length) return cur.filter((s) => !ids.has(selId(s)));
    const have = new Set(cur.map(selId));
    return [...cur, ...add.filter((s) => !have.has(selId(s)))];
  };

  // ---------- right panel: details and world settings ----------
  const detTabs = h('div.ue-tabs');
  const detBody = h('div.ue-det-body');
  let detTab: 'details' | 'world' = 'details';
  detTabs.append(
    h('div.ue-tab.on', { 'data-t': 'details', html: `${icon('info')}<span>${t('Details')}</span>`, onclick: () => setDetTab('details') }),
    h('div.ue-tab', { 'data-t': 'world', html: `${icon('world')}<span>${t('World settings')}</span>`, onclick: () => setDetTab('world') }),
  );
  detPanel.append(detTabs, detBody);
  const details = new PropGrid();
  detBody.append(details.el);
  function setDetTab(t: 'details' | 'world'): void {
    detTab = t;
    for (const c of detTabs.children) c.classList.toggle('on', (c as HTMLElement).dataset.t === t);
    buildDetails();
  }

  function buildDetails(): void {
    const g = details;
    g.clear();
    if (detTab === 'world') { worldSections(g, ['sun', 'sky', 'fog', 'weather', 'post'], true); g.refresh(); return; }
    if (!sel.length) {
      const b = level.getBounds();
      g.section(t('Map'), 'world')
        .text(t('Name'), () => level.name, (v) => { level.name = v; nameInput.value = v; dirtyAutosave = true; outliner.invalidate(); })
        .info(t('Size'), () => b ? t('{x} × {y} × {z} m', { x: b.maxX - b.minX + 1, y: b.maxY - b.minY + 1, z: b.maxZ - b.minZ + 1 }) : t('empty'))
        .info(t('Contents'), () => t('{b} blocks · {d} decor · {l} lights · {n} landscape', { b: blockCount(), d: level.decor.length, l: level.entities.filter((e) => e.kind === 'light').length, n: lands().length }))
        .note(t('Select an object in a viewport or in the outliner — its settings will appear here. The environment is in the "World settings" tab.'));
      g.refresh();
      return;
    }
    const kinds = new Set(sel.map((s) => s.t));
    if (sel.length === 1 || kinds.size === 1) {
      const s = sel[0];
      if (s.t === 'world') worldSections(g, sel.map((s) => (s as { part: WorldPart }).part), false);
      else if (s.t === 'block') blockDetails(g);
      else if (s.t === 'decor') decorDetails(g);
      else if (s.t === 'light') lightDetails(g);
      else if (s.t === 'spawn') spawnDetails(g);
      else if (s.t === 'land') landDetails(g, s.p);
    } else {
      g.section(t('Selection'), 'select').info(t('Objects'), () => selSummary());
      g.buttons([t('To the selection'), focusSel, 'focus'], [t('Duplicate'), duplicateSel, 'copy'], [t('Delete'), deleteSel, 'trash']);
      g.buttons([t('Create prefab'), makePrefab, 'prefab']);
    }
    g.refresh();
  }

  function blockDetails(g: PropGrid): void {
    const cells = sel.filter((s): s is Extract<Sel, { t: 'block' }> => s.t === 'block');
    const one = cells.length === 1 ? cells[0] : null;
    if (one) {
      g.section(t('Transform'), 'move')
        .vec3(t('Position'), () => [one.x, one.y, one.z], (v) => moveCells([one], [Math.round(v[0]) - one.x, Math.round(v[1]) - one.y, Math.round(v[2]) - one.z]), { step: 1 })
        .select(t('Rotation'), [['0', '0°'], ['1', '90°'], ['2', '180°'], ['3', '270°']], () => String(level.rotAt(one.x, one.y, one.z)) as '0', (v) => { beginBatch(); edit(one.x, one.y, one.z, level.nameAt(one.x, one.y, one.z), Number(v)); endBatch(); });
    } else {
      g.section(t('Selection'), 'select').info(t('Blocks'), () => String(cells.length));
      g.buttons([t('Rotate 90° around Y'), () => rotateSel('y'), 'rotate'], [t('around X'), () => rotateSel('x')], [t('around Z'), () => rotateSel('z')]);
    }
    const names = [...new Set(cells.map((c) => level.nameAt(c.x, c.y, c.z)))];
    const def = blockDef(names[0]);
    g.section(t('Block'), 'cube')
      .select(t('Type'), blockOptions(), () => (names.length === 1 ? names[0] : '') , (v) => { beginBatch(); for (const c of cells) edit(c.x, c.y, c.z, v, level.rotAt(c.x, c.y, c.z)); endBatch(); toast(t('Replaced: {n}', { n: cells.length })); buildDetails(); })
      .info(t('Category'), () => names.length === 1 ? t(def.category) : t('{n} types', { n: names.length }))
      .info(t('Collision'), () => names.length === 1 ? (def.collide ? t('{v} m', { v: def.collide }) : t('walkable')) : '—')
      .info(t('Properties'), () => names.length === 1 ? [def.full && t('full cube'), def.rotatable && t('rotatable'), def.stairs && t('stairs'), def.light && t('emits light'), def.bakedLight && t('baked light'), def.natural && t('natural ground')].filter(Boolean).join(' · ') || '—' : '—');
    g.buttons([t('Pick as brush'), () => { setCurrent(names[0]); toast(t('Brush: {title}', { title: t(def.title) })); }, 'brush'], [t('All like this'), selectSameBlocks, 'select']);
    g.buttons([t('To the selection'), focusSel, 'focus'], [t('Duplicate'), duplicateSel, 'copy'], [t('Delete'), deleteSel, 'trash']);
  }
  function blockOptions(): [string, string][] {
    const out: [string, string][] = [['', t('— mixed —')]];
    for (const cat of CATEGORIES) for (const b of BLOCKS) if (b.category === cat && b.name !== 'air') out.push([b.name, `${t(cat)}: ${t(b.title)}`]);
    return out;
  }
  function decorDetails(g: PropGrid): void {
    const items = sel.filter((s): s is Extract<Sel, { t: 'decor' }> => s.t === 'decor').map((s) => s.d);
    const d = items[0];
    if (items.length === 1) {
      g.section(t('Transform'), 'move')
        .vec3(t('Position'), () => [...d.pos] as [number, number, number], (v) => changeDecor(d, (x) => { x.pos = v.map((n) => Math.round(n * 16) / 16) as [number, number, number]; delete x.on; }, 'decor-pos'), { step: 1 / 16, digits: 3 })
        .vec3(t('Rotation, °'), () => [d.rot?.[0] ?? 0, d.rot?.[1] ?? 0, d.rot?.[2] ?? 0], (v) => changeDecor(d, (x) => setDecorRot(x, v), 'decor-rot'), { step: 1, digits: 1 })
        .note(t('Rotation: X — yaw (around the vertical), Y — pitch, Z — roll'));
    } else g.section(t('Selection'), 'select').info(t('Items'), () => String(items.length));
    const def = decorDef(d.name);
    g.section(t('Decor'), 'decor')
      .select(t('Type'), DECOR.map((x) => [x.name, `${t(x.category)}: ${t(x.title)}`] as [string, string]), () => d.name, (v) => { for (const it of items) changeDecor(it, (x) => { x.name = v; }); buildDetails(); })
      .info(t('Anchor'), () => def.anchor === 'floor' ? t('on the floor') : def.anchor === 'wall' ? t('on a wall') : t('on the ceiling'))
      .info(t('Support'), () => d.on ? t('cell {c} — erase it and the item goes too', { c: d.on.join(', ') }) : t('free'))
      .info(t('Light'), () => def.light ? `${def.light.baked ? t('baked') : t('real')}, ${def.light.intensity} × ${def.light.dist} ${t('m')}` : t('none'))
      .info(t('Collision'), () => def.solid ? def.solid.map((b) => `${b.w}×${b.d}×${b.h}`).join(', ') : t('none'));
    g.buttons([t('Pick as brush'), () => { setDecor(d.name); setMode('decor'); }, 'brush'], [t('To the selection'), focusSel, 'focus']);
    g.buttons([t('Duplicate'), duplicateSel, 'copy'], [t('Delete'), deleteSel, 'trash']);
  }
  function lightDetails(g: PropGrid): void {
    const ents = sel.filter((s): s is Extract<Sel, { t: 'light' }> => s.t === 'light').map((s) => s.e);
    const e = ents[0];
    const d = () => lightData(e.data);
    const setD = (fn: (d: LightData) => void, key: string) => { for (const x of ents) changeEnt(x, (en) => { const ld = lightData(en.data); fn(ld); en.data = { ...ld }; }, key); };
    if (ents.length === 1) {
      g.section(t('Transform'), 'move')
        .vec3(t('Position'), () => [e.x, e.y, e.z], (v) => changeEnt(e, (en) => { en.x = v[0]; en.y = v[1]; en.z = v[2]; }, 'light-pos'), { step: 0.25, digits: 2 });
    }
    g.section(t('Light'), 'light')
      .text(t('Name'), () => d().name ?? '', (v) => setD((x) => { x.name = v || undefined; }, 'light-name'))
      .select(t('Type'), [['point', t('Point')], ['spot', t('Spotlight')]], () => d().type, (v) => { setD((x) => { x.type = v; }, 'light-type'); buildDetails(); })
      .color(t('Colour'), () => d().color, (v) => setD((x) => { x.color = v; }, 'light-color'))
      .num(t('Intensity'), () => d().intensity, (v) => setD((x) => { x.intensity = v; }, 'light-i'), { min: 0, max: 40, step: 0.1, slider: true })
      .num(t('Range, m'), () => d().distance, (v) => setD((x) => { x.distance = v; }, 'light-dist'), { min: 1, max: 40, step: 0.5, slider: true })
      .bool(t('Shadows'), () => d().shadows, (v) => setD((x) => { x.shadows = v; }, 'light-sh'));
    if (d().type === 'spot') {
      g.num(t('Cone, °'), () => d().angle, (v) => setD((x) => { x.angle = v; }, 'light-angle'), { min: 5, max: 85, step: 1, slider: true })
        .num(t('Yaw, °'), () => e.rot ?? 0, (v) => { for (const x of ents) changeEnt(x, (en) => { en.rot = v; }, 'light-yaw'); }, { min: -180, max: 180, step: 1, slider: true })
        .num(t('Pitch, °'), () => d().pitch, (v) => setD((x) => { x.pitch = v; }, 'light-pitch'), { min: -90, max: 45, step: 1, slider: true });
    }
    g.buttons([t('To the selection'), focusSel, 'focus'], [t('Duplicate'), duplicateSel, 'copy'], [t('Delete'), deleteSel, 'trash']);
  }
  function spawnDetails(g: PropGrid): void {
    const sp = level.spawn!;
    g.section(t('Spawn point'), 'flag')
      .vec3(t('Position'), () => [sp[0], sp[1], sp[2]], (v) => setSpawn([Math.round(v[0]), Math.round(v[1]), Math.round(v[2])], spawnYaw()), { step: 1 })
      .num(t('Facing, °'), () => spawnYaw(), (v) => setSpawn(level.spawn!, v), { min: -180, max: 180, step: 15, slider: true })
      .note(t('The hero appears in this cell and looks along the arrow. P in "Blocks" mode — place under the cursor.'));
    g.buttons([t('To the point'), focusSel, 'focus'], [t('Play from here'), play, 'play']);
  }
  function landDetails(g: PropGrid, p: LandPiece): void {
    const set = (k: keyof LandParams, v: number) => changeLand(p, { ...landParams(p), [k]: Math.round(v) });
    g.section(t('Transform'), 'move')
      .vec3(t('Centre'), () => [p.x, p.y, p.z], (v) => changeLand(p, { ...landParams(p), x: Math.round(v[0]), y: Math.round(v[1]), z: Math.round(v[2]) }), { step: 1 });
    g.section(t('Landscape'), 'land')
      .num(t('Size X'), () => p.w, (v) => set('w', v), { min: 6, max: 64, step: 1, slider: true })
      .num(t('Size Z'), () => p.d, (v) => set('d', v), { min: 6, max: 64, step: 1, slider: true })
      .num(t('Layers × 0.5 m'), () => p.layers, (v) => set('layers', v), { min: 1, max: 10, step: 1, slider: true })
      .num(t('Coarseness'), () => p.scale, (v) => set('scale', v), { min: 8, max: 40, step: 1, slider: true })
      .num(t('Stone, %'), () => p.stone, (v) => set('stone', v), { min: 0, max: 80, step: 5, slider: true })
      .info(t('Cells'), () => String(p.cells.length));
    g.buttons([t('Random: edges and corners'), () => set('seed', 1 + Math.floor(Math.random() * 1e6)), 'turntable'], [t('Delete'), () => { removeLand(p); select([]); }, 'trash']);
  }
  /** World settings sections; all — the "World settings" tab (with presets), otherwise — the selected outliner nodes */
  function worldSections(g: PropGrid, parts: WorldPart[], all: boolean): void {
    const w = () => world;
    const num = (label: string, get: () => number, set: (v: number) => void, min: number, max: number, step: number, key: string) => g.num(label, get, (v) => changeWorld(() => set(v), key), { min, max, step, slider: true });
    const col = (label: string, get: () => string, set: (v: string) => void, key: string) => g.color(label, get, (v) => changeWorld(() => set(v), key));
    if (all) {
      g.section(t('Environment preset'), 'world');
      const wrap = h('div.ue-presets');
      for (const [, p] of Object.entries(WORLD_PRESETS)) wrap.append(h('button.ue-btn', { text: p.title, onclick: () => { changeWorld((x) => Object.assign(x, mergeWorld(WORLD_DEFAULTS, p.patch)), 'preset'); buildDetails(); toast(t('Environment: {title}', { title: p.title })); } }));
      g.custom(wrap);
      g.buttons([t('Reset everything'), () => { changeWorld((x) => Object.assign(x, mergeWorld(WORLD_DEFAULTS, {})), 'preset'); buildDetails(); }, 'undo']);
    }
    for (const part of parts) {
      if (part === 'sun') {
        g.section(t('Sun'), 'sun');
        col(t('Colour'), () => w().sun.color, (v) => { world.sun.color = v; }, 'sun-c');
        num(t('Intensity'), () => w().sun.intensity, (v) => { world.sun.intensity = v; }, 0, 6, 0.05, 'sun-i');
        num(t('Elevation, °'), () => w().sun.elevation, (v) => { world.sun.elevation = v; }, 2, 90, 1, 'sun-e');
        num(t('Azimuth, °'), () => w().sun.azimuth, (v) => { world.sun.azimuth = v; }, 0, 360, 1, 'sun-a');
        g.bool(t('Shadows'), () => w().sun.shadows, (v) => changeWorld(() => { world.sun.shadows = v; }, 'sun-s'));
        g.note(t('The arrow in the viewport shows where the sun shines from.'));
      } else if (part === 'sky') {
        g.section(t('Sky and global lighting'), 'sky');
        col(t('Sky colour (background)'), () => w().sky.color, (v) => { world.sky.color = v; }, 'sky-c');
        col(t('Sky light from above'), () => w().sky.hemiSky, (v) => { world.sky.hemiSky = v; }, 'sky-hs');
        col(t('Bounced from the ground'), () => w().sky.hemiGround, (v) => { world.sky.hemiGround = v; }, 'sky-hg');
        num(t('Sky strength (GI)'), () => w().sky.hemi, (v) => { world.sky.hemi = v; }, 0, 5, 0.05, 'sky-h');
        num(t('Fill light'), () => w().sky.ambient, (v) => { world.sky.ambient = v; }, 0, 2, 0.01, 'sky-a');
      } else if (part === 'fog') {
        g.section(t('Haze'), 'fog');
        g.bool(t('Enabled'), () => w().fog.enabled, (v) => changeWorld(() => { world.fog.enabled = v; }, 'fog-on'));
        col(t('Colour'), () => w().fog.color, (v) => { world.fog.color = v; }, 'fog-c');
        num(t('Start, m'), () => w().fog.near, (v) => { world.fog.near = Math.min(v, world.fog.far - 1); }, 0, 150, 1, 'fog-n');
        num(t('End, m'), () => w().fog.far, (v) => { world.fog.far = Math.max(v, world.fog.near + 1); }, 5, 300, 1, 'fog-f');
      } else if (part === 'weather') {
        g.section(t('Weather'), 'rain');
        g.select(t('Weather'), (Object.keys(WEATHER_TITLES) as WeatherKind[]).map((k) => [k, WEATHER_TITLES[k]] as [WeatherKind, string]), () => w().weather.kind, (v) => changeWorld(() => { world.weather.kind = v; }, 'wx-k'));
        num(t('Strength'), () => w().weather.intensity, (v) => { world.weather.intensity = v; }, 0, 1, 0.05, 'wx-i');
        num(t('Wind, m/s'), () => w().weather.wind, (v) => { world.weather.wind = v; }, -10, 10, 0.1, 'wx-w');
        g.note(t('Storm — heavy rain and lightning flashes. Particles are visible in perspective.'));
      } else if (part === 'post') {
        g.section(t('Post-processing'), 'post');
        g.bool(t('Enabled'), () => w().post.enabled, (v) => changeWorld(() => { world.post.enabled = v; }, 'pp-on'));
        num(t('Exposure'), () => w().post.exposure, (v) => { world.post.exposure = v; }, 0.3, 2.5, 0.01, 'pp-exp');
        num(t('Bloom: strength'), () => w().post.bloom, (v) => { world.post.bloom = v; }, 0, 2, 0.01, 'pp-b');
        num(t('Bloom: radius'), () => w().post.bloomRadius, (v) => { world.post.bloomRadius = v; }, 0, 1, 0.01, 'pp-br');
        num(t('Bloom: threshold'), () => w().post.bloomThreshold, (v) => { world.post.bloomThreshold = v; }, 0, 1.5, 0.01, 'pp-bt');
        num(t('AO: strength'), () => w().post.ao, (v) => { world.post.ao = v; }, 0, 1, 0.01, 'pp-ao');
        num(t('AO: radius'), () => w().post.aoRadius, (v) => { world.post.aoRadius = v; }, 0.1, 2, 0.01, 'pp-aor');
        num(t('Saturation'), () => w().post.saturation, (v) => { world.post.saturation = v; }, 0, 2, 0.01, 'pp-sat');
        num(t('Contrast'), () => w().post.contrast, (v) => { world.post.contrast = v; }, 0.5, 1.5, 0.01, 'pp-con');
        num(t('Vignette'), () => w().post.vignette, (v) => { world.post.vignette = v; }, 0, 0.8, 0.01, 'pp-vig');
        col(t('Shadow tint'), () => w().post.shadowTint, (v) => { world.post.shadowTint = v; }, 'pp-st');
        col(t('Highlight tint'), () => w().post.highTint, (v) => { world.post.highTint = v; }, 'pp-ht');
        num(t('Tint amount'), () => w().post.tintAmount, (v) => { world.post.tintAmount = v; }, 0, 0.3, 0.005, 'pp-ta');
        g.note(t('Post-processing is visible in the main viewport (perspective, "Lit").'));
      }
    }
  }

  // ---------- status bar ----------
  const stCursor = h('span.ue-st-v');
  const stFps = h('span.ue-st-v');
  const stCount = h('span.ue-st-v');
  status.append(
    h('button.ue-st-btn', { html: `${icon('prefab')}<span>${t('Prefabs')}</span>`, onclick: () => { left.hidden = !left.hidden; root.classList.toggle('no-left', left.hidden); } }),
    h('button.ue-st-btn', { html: `${icon('info')}<span>${t('Log')}</span>`, onclick: showLog }),
    h('span.ue-st-sep'), stCount, h('span.ue-grow'), stCursor, h('span.ue-st-sep'), stFps,
  );

  // ---------- scene: grids, cursors, icons ----------
  const gridMat = (o: number) => { const m = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: o, depthWrite: false }); return m; };
  const mkGrid = (o: number) => { const g = new THREE.GridHelper(200, 200, '#ffffff', '#ffffff'); g.material = gridMat(o); return g; };
  const gridXZ = mkGrid(0.14); gridXZ.position.set(-0.5, 0.01, -0.5);
  const gridXY = mkGrid(0.1); gridXY.rotation.x = Math.PI / 2;
  const gridZY = mkGrid(0.1); gridZY.rotation.z = Math.PI / 2;
  scene.add(gridXZ, gridXY, gridZY);
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.01, 1.01, 1.01));
  const cursorBox = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: '#4cff7a', depthTest: false, transparent: true }));
  const hitBox = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: '#ff5a4a', depthTest: false, transparent: true, opacity: 0.8 }));
  const hoverBox = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: '#ffd28a', depthTest: false, transparent: true, opacity: 0.45, toneMapped: false }));
  const cornerBox = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: '#4ad2ff', depthTest: false }));
  cursorBox.renderOrder = hitBox.renderOrder = cornerBox.renderOrder = hoverBox.renderOrder = 20;
  cornerBox.visible = hoverBox.visible = false;
  scene.add(cursorBox, hitBox, cornerBox, hoverBox);

  /** Icons of service objects (lights, spawn point) — sprites, clickable */
  const helpers = new THREE.Group();
  helpers.name = 'Icons';
  scene.add(helpers);
  const iconTex = new Map<string, THREE.Texture>();
  function iconSprite(kind: 'point' | 'spot' | 'spawn', color = '#ffd25a'): THREE.Sprite {
    const key = `${kind}:${color}`;
    let t = iconTex.get(key);
    if (!t) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d')!;
      g.fillStyle = 'rgba(16,17,20,0.85)'; g.beginPath(); g.arc(32, 32, 29, 0, Math.PI * 2); g.fill();
      g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 4; g.lineCap = 'round';
      if (kind === 'point') {
        g.beginPath(); g.arc(32, 28, 11, 0, Math.PI * 2); g.fill();
        g.fillRect(26, 40, 12, 6);
        for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.beginPath(); g.moveTo(32 + Math.cos(a) * 15, 28 + Math.sin(a) * 15); g.lineTo(32 + Math.cos(a) * 21, 28 + Math.sin(a) * 21); g.stroke(); }
      } else if (kind === 'spot') {
        g.beginPath(); g.moveTo(24, 14); g.lineTo(40, 14); g.lineTo(37, 26); g.lineTo(27, 26); g.closePath(); g.fill();
        g.globalAlpha = 0.6; g.beginPath(); g.moveTo(27, 26); g.lineTo(37, 26); g.lineTo(48, 52); g.lineTo(16, 52); g.closePath(); g.fill(); g.globalAlpha = 1;
      } else {
        g.beginPath(); g.moveTo(22, 52); g.lineTo(22, 12); g.stroke();
        g.beginPath(); g.moveTo(22, 12); g.lineTo(46, 12); g.lineTo(40, 21); g.lineTo(46, 30); g.lineTo(22, 30); g.closePath(); g.fill();
      }
      t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      iconTex.set(key, t);
    }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, toneMapped: false, sizeAttenuation: false }));
    s.scale.setScalar(0.045);
    s.renderOrder = 30;
    return s;
  }
  const spawnMark = new THREE.Group();
  const spawnIcon = iconSprite('spawn', '#5fbf4a');
  spawnIcon.position.y = 1.6;
  const spawnArrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 12), new THREE.MeshBasicMaterial({ color: '#5fbf4a', toneMapped: false }));
  spawnArrow.rotation.z = -Math.PI / 2; spawnArrow.position.set(0.55, 0.15, 0);
  const spawnBody = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.6, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#5fbf4a', wireframe: true, transparent: true, opacity: 0.35, toneMapped: false }));
  spawnBody.position.y = 0.8;
  const spawnYawG = new THREE.Group(); spawnYawG.add(spawnArrow);
  spawnMark.add(spawnIcon, spawnBody, spawnYawG);
  spawnIcon.userData.pick = { t: 'spawn' } satisfies Sel;
  helpers.add(spawnMark);
  /** Sun arrow — visible when the "Sun" section is selected */
  const sunArrow = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), 8, 0xffd25a, 1.6, 0.8);
  sunArrow.visible = false;
  scene.add(sunArrow);

  // placed lights: entities of kind 'light' → three.js light + icon
  const entObjs = new Map<LevelEntity, { light: THREE.PointLight | THREE.SpotLight; icon: THREE.Sprite }>();
  let entBuilt = -1;
  function syncEntities(): void {
    if (entBuilt === entVersion) return;
    entBuilt = entVersion;
    for (const o of entObjs.values()) { o.light.removeFromParent(); o.light.dispose(); o.icon.removeFromParent(); o.icon.material.dispose(); }
    entObjs.clear();
    for (const e of level.entities) {
      if (e.kind !== 'light') continue;
      const d = lightData(e.data);
      const l = makeLight(d);
      l.position.set(e.x, e.y, e.z);
      aimLight(l, e.rot ?? 0, d.pitch);
      if (d.shadows) { l.castShadow = true; l.shadow.mapSize.set(512, 512); l.shadow.bias = -0.002; }
      scene.add(l);
      const ic = iconSprite(d.type, d.color);
      ic.position.set(e.x, e.y, e.z);
      ic.userData.pick = { t: 'light', e } satisfies Sel;
      helpers.add(ic);
      entObjs.set(e, { light: l, icon: ic });
    }
    rebuildSelFx();
  }
  const spawnYaw = (): number => (level.meta.spawnYaw as number | undefined) ?? 0;

  // ---------- selection highlight ----------
  const selFx = new THREE.Group();
  selFx.name = 'Selection';
  scene.add(selFx);
  const selLine = new THREE.LineBasicMaterial({ color: '#f5a524', depthTest: false, transparent: true, toneMapped: false });
  const selFill = new THREE.MeshBasicMaterial({ color: '#f5a524', transparent: true, opacity: 0.14, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
  function rebuildSelFx(): void {
    for (const o of [...selFx.children]) { selFx.remove(o); (o as THREE.Mesh).geometry?.dispose(); }
    selFx.matrix.identity(); selFx.matrixAutoUpdate = false; selFx.matrixWorldNeedsUpdate = true;
    sunArrow.visible = sel.some((s) => s.t === 'world' && s.part === 'sun');
    const cells = sel.filter((s): s is Extract<Sel, { t: 'block' }> => s.t === 'block');
    if (cells.length) {
      const n = Math.min(cells.length, 20000);
      const box = new THREE.BoxGeometry(1.02, 1.02, 1.02).toNonIndexed();
      const e = edges.attributes.position.array as Float32Array;
      const pos = new Float32Array(n * e.length);
      const fill = new THREE.InstancedMesh(box, selFill, n);
      const m = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        const c = cells[i];
        for (let k = 0; k < e.length; k += 3) { pos[i * e.length + k] = e[k] + c.x; pos[i * e.length + k + 1] = e[k + 1] + c.y + 0.5; pos[i * e.length + k + 2] = e[k + 2] + c.z; }
        fill.setMatrixAt(i, m.makeTranslation(c.x, c.y + 0.5, c.z));
      }
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const ls = new THREE.LineSegments(lg, selLine); ls.renderOrder = 22; ls.frustumCulled = false;
      fill.frustumCulled = false;
      selFx.add(fill, ls);
    }
    for (const s of sel) {
      let b: THREE.Box3 | null = null;
      if (s.t === 'decor') b = decorBox(s.d);
      else if (s.t === 'light') {
        b = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(s.e.x, s.e.y, s.e.z), new THREE.Vector3(0.6, 0.6, 0.6));
        const d = lightData(s.e.data);
        const sph = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(d.distance, 2)), new THREE.LineBasicMaterial({ color: d.color, transparent: true, opacity: 0.25, depthTest: false, toneMapped: false }));
        sph.position.set(s.e.x, s.e.y, s.e.z); sph.renderOrder = 21;
        selFx.add(sph);
      } else if (s.t === 'spawn' && level.spawn) b = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(level.spawn[0], level.spawn[1] + 0.8, level.spawn[2]), new THREE.Vector3(0.9, 1.7, 0.9));
      else if (s.t === 'land') {
        const [x0, z0, x1, z1] = landRect(s.p);
        const hh = Math.max(0.5, s.p.layers / 2);
        b = new THREE.Box3(new THREE.Vector3(x0 - 0.5, s.p.y, z0 - 0.5), new THREE.Vector3(x1 + 0.5, s.p.y + hh, z1 + 0.5));
      }
      if (b) { const hlp = new THREE.Box3Helper(b, new THREE.Color('#f5a524')); (hlp.material as THREE.LineBasicMaterial).depthTest = false; (hlp.material as THREE.LineBasicMaterial).toneMapped = false; hlp.renderOrder = 22; selFx.add(hlp); }
    }
    placePivot();
  }
  /** Bounds of a decor item with rotation */
  function decorBox(d: DecorItem): THREE.Box3 {
    const def = decorDef(d.name);
    const box = new THREE.Box3();
    const m = decorMatrix(d);
    for (const layer of ['opaque', 'cutout', 'glow', 'fire'] as Layer[]) {
      const g = view.decor.geometryOf(def, layer);
      if (!g) continue;
      if (!g.boundingBox) g.computeBoundingBox();
      box.union(g.boundingBox!.clone().applyMatrix4(m));
    }
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(...d.pos), new THREE.Vector3(0.5, 0.5, 0.5));
    return box.expandByScalar(0.03);
  }

  // ---------- gizmo: translate, rotate, scale ----------
  const pivot = new THREE.Object3D();
  pivot.name = 'Gizmo';
  scene.add(pivot);
  const tcs = vps.list.map((vp) => {
    const tc = new TransformControls(vp.camera, vp.el);
    tc.size = 0.9;
    scene.add(tc.getHelper());
    tc.addEventListener('dragging-changed', (e) => { vp.controls.enabled = !e.value; });
    tc.addEventListener('mouseDown', () => { pivotStart.copy(pivot.matrix); pivotStartPos.copy(pivot.position); });
    tc.addEventListener('objectChange', () => {
      // the highlight follows the gizmo — shows where it will land
      pivot.updateMatrix();
      selFx.matrix.copy(pivot.matrix).multiply(pivotStart.clone().invert());
      selFx.matrixWorldNeedsUpdate = true;
    });
    tc.addEventListener('mouseUp', () => commitGizmo());
    return tc;
  });
  const pivotStart = new THREE.Matrix4(), pivotStartPos = new THREE.Vector3();
  /** Rotation centre of blocks — the cell centre; translation — the cell bottom (grid step snapped to integers) */
  function placePivot(): void {
    pivot.quaternion.identity(); pivot.scale.set(1, 1, 1);
    const c = selCenter();
    if (c) pivot.position.copy(c);
    pivot.updateMatrix();
    applyGizmo();
  }
  function selCenter(): THREE.Vector3 | null {
    if (!sel.length) return null;
    const box = new THREE.Box3();
    let blocks = true;
    for (const s of sel) {
      if (s.t === 'block') box.expandByPoint(new THREE.Vector3(s.x, s.y, s.z));
      else { blocks = false; if (s.t === 'decor') box.expandByPoint(new THREE.Vector3(...s.d.pos)); else if (s.t === 'light') box.expandByPoint(new THREE.Vector3(s.e.x, s.e.y, s.e.z)); else if (s.t === 'spawn' && level.spawn) box.expandByPoint(new THREE.Vector3(...level.spawn)); else if (s.t === 'land') box.expandByPoint(new THREE.Vector3(s.p.x, s.p.y, s.p.z)); }
    }
    if (box.isEmpty()) return null;
    const c = box.getCenter(new THREE.Vector3());
    const cellish = blocks || sel.every((s) => s.t === 'block' || s.t === 'spawn' || s.t === 'land');
    if (cellish) { c.set(Math.round(c.x), Math.round(c.y), Math.round(c.z)); if (tool === 'rotate' && blocks) c.y += 0.5; }
    return c;
  }
  const transformable = () => sel.length > 0 && sel.every((s) => s.t !== 'world');
  function applyGizmo(): void {
    const on = mode === 'select' && tool !== 'select' && transformable() && doc === 'level';
    const blocks = sel.some((s) => s.t === 'block' || s.t === 'spawn' || s.t === 'land');
    for (const tc of tcs) {
      if (on) { if (tc.object !== pivot) tc.attach(pivot); } else if (tc.object) tc.detach();
      tc.setMode(tool === 'select' ? 'translate' : tool);
      tc.setTranslationSnap(blocks ? 1 : snap.grid ? snap.gridStep : null);
      tc.setRotationSnap(blocks && sel.some((s) => s.t === 'block') ? Math.PI / 2 : snap.rotOn ? THREE.MathUtils.degToRad(snap.rotStep) : null);
      tc.setScaleSnap(blocks ? 0.25 : null);
      // blocks and the spawn point rotate only by whole quarters; the point — only around the vertical
      const spawnOnly = sel.every((s) => s.t === 'spawn' || s.t === 'land');
      tc.showX = tc.showZ = !(tool === 'rotate' && spawnOnly);
      tc.showY = true;
    }
  }
  function setTool(t: Tool): void { tool = t; placePivot(); refreshToolbar(); }

  /** Gizmo released — apply the translation, rotation or scale to the selection as one edit */
  function commitGizmo(): void {
    pivot.updateMatrix();
    const d = pivot.position.clone().sub(pivotStartPos);
    const q = pivot.quaternion.clone();
    const sc = pivot.scale.clone();
    const moved = d.lengthSq() > 1e-8, turned = Math.abs(q.w) < 0.99999, scaled = Math.abs(sc.x - 1) + Math.abs(sc.y - 1) + Math.abs(sc.z - 1) > 1e-4;
    if (!moved && !turned && !scaled) { rebuildSelFx(); return; }
    const c = pivotStartPos.clone();
    const R = new THREE.Matrix4().makeRotationFromQuaternion(q);
    beginBatch();
    // blocks: translation by whole cells, rotation — by quarters around the cell centre
    const cells = sel.filter((s): s is Extract<Sel, { t: 'block' }> => s.t === 'block');
    if (cells.length && (moved || turned)) {
      const di: [number, number, number] = [Math.round(d.x), Math.round(d.y), Math.round(d.z)];
      if (turned) transformCells(cells, snapRot(R), c, di); else moveCells(cells, di, true);
    }
    for (const s of sel) {
      if (s.t === 'decor' && !cells.length) {
        changeDecor(s.d, (x) => {
          const p = new THREE.Vector3(...x.pos).sub(c).applyMatrix4(R).add(c).add(d);
          const step = snap.grid ? Math.min(snap.gridStep, 1 / 16) : 1 / 16;
          x.pos = [p.x, p.y, p.z].map((v) => Math.round(v / step) * step) as [number, number, number];
          if (turned) {
            const qd = new THREE.Quaternion().setFromEuler(new THREE.Euler(...decorEuler(x.rot), 'YXZ'));
            const e = new THREE.Euler().setFromQuaternion(q.clone().multiply(qd), 'YXZ');
            const k = 180 / Math.PI;
            setDecorRot(x, [-e.y * k, e.x * k, e.z * k]);
          }
          if (moved) delete x.on;
        });
      } else if (s.t === 'light') {
        changeEnt(s.e, (en) => {
          const p = new THREE.Vector3(en.x, en.y, en.z).sub(c).applyMatrix4(R).add(c).add(d);
          en.x = +p.x.toFixed(3); en.y = +p.y.toFixed(3); en.z = +p.z.toFixed(3);
          const ld = lightData(en.data);
          if (turned && ld.type === 'spot') {
            const y = THREE.MathUtils.degToRad(en.rot ?? 0), pt = THREE.MathUtils.degToRad(ld.pitch);
            const dir = new THREE.Vector3(Math.cos(pt) * Math.cos(y), Math.sin(pt), Math.cos(pt) * Math.sin(y)).applyQuaternion(q);
            en.rot = Math.round(THREE.MathUtils.radToDeg(Math.atan2(dir.z, dir.x)));
            ld.pitch = Math.round(THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1))));
          }
          if (scaled) ld.distance = Math.max(1, +(ld.distance * (sc.x + sc.y + sc.z) / 3).toFixed(1));
          en.data = { ...ld };
        });
      } else if (s.t === 'spawn' && level.spawn) {
        const sp = level.spawn;
        const yaw = turned ? spawnYaw() - Math.round(THREE.MathUtils.radToDeg(new THREE.Euler().setFromQuaternion(q, 'YXZ').y)) : spawnYaw();
        setSpawn([sp[0] + Math.round(d.x), sp[1] + Math.round(d.y), sp[2] + Math.round(d.z)], ((yaw % 360) + 540) % 360 - 180);
      } else if (s.t === 'land') {
        const p = s.p;
        const k = { w: Math.round(p.w * sc.x), d: Math.round(p.d * sc.z), layers: Math.round(p.layers * sc.y) };
        live = null;
        changeLand(p, { ...landParams(p), x: p.x + Math.round(d.x), y: p.y + Math.round(d.y), z: p.z + Math.round(d.z), w: clamp(k.w, 6, 64), d: clamp(k.d, 6, 64), layers: clamp(k.layers, 1, 10) });
        live = null;
      }
    }
    endBatch();
    afterSelEdit();
  }
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  /** Gizmo rotation → integer matrix (quarter turns) */
  function snapRot(R: THREE.Matrix4): THREE.Matrix4 {
    const e = R.elements.map((v) => Math.round(v));
    return new THREE.Matrix4().fromArray(e);
  }
  /** How many quarter turns around the vertical the matrix gives (for block rotation, 90° turns +X into +Z) */
  function yawSteps(R: THREE.Matrix4): number {
    const v = new THREE.Vector3(1, 0, 0).applyMatrix4(R);
    if (Math.abs(v.y) > 0.5) return 0;
    return ((Math.round(Math.atan2(v.z, v.x) / (Math.PI / 2)) % 4) + 4) % 4;
  }
  function setDecorRot(x: DecorItem, v: number[]): void {
    const r = v.map((a) => +((((a % 360) + 540) % 360) - 180).toFixed(2));
    while (r.length > 1 && r[r.length - 1] === 0) r.pop();
    if (r.length === 1 && r[0] === 0) delete x.rot; else x.rot = r;
  }

  /** Move cells by d (as one edit; with — together with attached decor) */
  function moveCells(cells: Extract<Sel, { t: 'block' }>[], d: [number, number, number], withDecor = true): void {
    transformCells(cells, new THREE.Matrix4(), new THREE.Vector3(), d, withDecor);
  }
  /** Move and rotate cells: new cell = R · (cell − c) + c + d; blocks rotate together with the rotation around Y */
  function transformCells(cells: Extract<Sel, { t: 'block' }>[], R: THREE.Matrix4, c: THREE.Vector3, d: [number, number, number], withDecor = true): void {
    const own = !batch;
    if (own) beginBatch();
    const steps = yawSteps(R);
    const src = cells.map((s) => ({ s, n: level.nameAt(s.x, s.y, s.z), r: level.rotAt(s.x, s.y, s.z) }));
    const keys = new Set(cells.map((s) => `${s.x},${s.y},${s.z}`));
    const attached = withDecor ? level.decor.filter((dd) => dd.on && keys.has(dd.on.join(','))) : [];
    const p = new THREE.Vector3();
    const map = (x: number, y: number, z: number): [number, number, number] => {
      p.set(x, y + 0.5, z).sub(c).applyMatrix4(R).add(c);
      return [Math.round(p.x) + d[0], Math.round(p.y - 0.5) + d[1], Math.round(p.z) + d[2]];
    };
    for (const { s } of src) edit(s.x, s.y, s.z, 'air', 0, true);
    const out: Sel[] = [];
    for (const { s, n, r } of src) {
      const [x, y, z] = map(s.x, s.y, s.z);
      const rr = blockDef(n).rotatable ? (r + steps) % 4 : r;
      edit(x, y, z, n, rr);
      out.push({ t: 'block', x, y, z });
    }
    for (const dd of attached) changeDecor(dd, (it) => {
      const q = new THREE.Vector3(...it.pos).add(new THREE.Vector3(0, 0, 0));
      q.sub(c).applyMatrix4(R).add(c);
      it.pos = [q.x + d[0], q.y + d[1], q.z + d[2]];
      it.on = map(it.on![0], it.on![1], it.on![2]);
      if (steps) setDecorRot(it, [(it.rot?.[0] ?? 0) + steps * 90, it.rot?.[1] ?? 0, it.rot?.[2] ?? 0]);
    });
    // the selection gets the new cells; the rest (decor, lights) stays selected
    sel = [...sel.filter((s) => s.t !== 'block'), ...out];
    if (own) endBatch();
  }
  function rotateSel(axis: 'x' | 'y' | 'z'): void {
    const c = selCenter(); if (!c) return;
    const cells = sel.filter((s): s is Extract<Sel, { t: 'block' }> => s.t === 'block');
    const box = new THREE.Box3(); for (const s of cells) box.expandByPoint(new THREE.Vector3(s.x, s.y, s.z));
    const ctr = box.getCenter(new THREE.Vector3()); ctr.set(Math.round(ctr.x), Math.round(ctr.y) + 0.5, Math.round(ctr.z));
    const R = new THREE.Matrix4()[axis === 'x' ? 'makeRotationX' : axis === 'y' ? 'makeRotationY' : 'makeRotationZ'](axis === 'y' ? -Math.PI / 2 : Math.PI / 2);
    beginBatch(); transformCells(cells, snapRot(R), ctr, [0, 0, 0]); endBatch();
    afterSelEdit();
    toast(t('Rotated 90° around {axis}', { axis: axis.toUpperCase() }));
  }

  // ---------- selection ----------
  function select(list: Sel[], reveal = true): void {
    const seen = new Set<string>();
    sel = list.filter((s) => { const k = selId(s); if (seen.has(k)) return false; seen.add(k); return true; });
    selIds = new Set(sel.map(selId));
    const lp = sel.length === 1 && sel[0].t === 'land' ? sel[0].p : null;
    if (mode === 'select') selLand = lp;
    rebuildSelFx();
    buildDetails();
    drawModeTools();
    if (reveal && sel.length === 1) {
      const s = sel[0];
      const path = s.t === 'block' ? ['root', 'blocks', `bt:${level.nameAt(s.x, s.y, s.z)}`] : s.t === 'decor' ? ['root', 'decor', `dc:${decorDef(s.d.name).category}`] : s.t === 'light' ? ['root', 'lights'] : s.t === 'land' ? ['root', 'lands'] : s.t === 'world' ? ['root', 'world'] : ['root'];
      outliner.invalidate(); outliner.update();
      outliner.reveal(path, selId(s));
    } else outliner.redraw();
  }
  function selSummary(): string {
    const n: Record<string, number> = {};
    for (const s of sel) n[s.t] = (n[s.t] ?? 0) + 1;
    const T: Record<string, string> = { block: t('blocks'), decor: t('decor'), light: t('lights'), spawn: t('spawn point'), land: t('landscape'), world: t('world') };
    return Object.entries(n).map(([k, v]) => `${v} ${T[k]}`).join(' · ');
  }
  /** After editing the selection: highlight, details, tree */
  function afterSelEdit(): void {
    sel = sel.filter((s) => s.t !== 'decor' || level.decor.includes(s.d)).filter((s) => s.t !== 'light' || level.entities.includes(s.e)).filter((s) => s.t !== 'land' || lands().includes(s.p));
    selIds = new Set(sel.map(selId));
    rebuildSelFx();
    details.refresh();
    outliner.invalidate();
  }
  function selectSameBlocks(): void {
    const names = new Set(sel.filter((s) => s.t === 'block').map((s) => { const b = s as Extract<Sel, { t: 'block' }>; return level.nameAt(b.x, b.y, b.z); }));
    const out: Sel[] = [];
    level.forEach((x, y, z, id) => { if (names.has(level.palette[id])) out.push({ t: 'block', x, y, z }); });
    select(out, false);
    toast(t('Selected: {n}', { n: out.length }));
  }
  function deleteSel(): void {
    if (!sel.length) return;
    beginBatch();
    for (const s of sel) {
      if (s.t === 'block') edit(s.x, s.y, s.z, 'air', 0);
      else if (s.t === 'decor') { if (level.decor.includes(s.d)) removeDecor(s.d); }
      else if (s.t === 'light') removeEnt(s.e);
      else if (s.t === 'land') { const b = batch!; batch = null; endBatch(); removeLand(s.p); beginBatch(); void b; }
      else if (s.t === 'spawn') setSpawn(null, 0);
    }
    endBatch();
    const n = sel.length;
    select([]);
    toast(t('Deleted: {n}', { n }));
  }
  function duplicateSel(): void {
    if (!sel.length) return;
    const cells = sel.filter((s): s is Extract<Sel, { t: 'block' }> => s.t === 'block');
    let dx = 0;
    if (cells.length) { const xs = cells.map((c) => c.x); dx = Math.max(...xs) - Math.min(...xs) + 1; }
    const out: Sel[] = [];
    beginBatch();
    for (const s of cells) {
      edit(s.x + dx, s.y, s.z, level.nameAt(s.x, s.y, s.z), level.rotAt(s.x, s.y, s.z));
      out.push({ t: 'block', x: s.x + dx, y: s.y, z: s.z });
    }
    for (const s of sel) {
      if (s.t === 'decor') { const c = snapDecor(s.d); c.pos = [c.pos[0] + (dx || 0.5), c.pos[1], c.pos[2] + (dx ? 0 : 0.5)]; if (c.on) c.on = [c.on[0] + dx, c.on[1], c.on[2]]; if (!dx) delete c.on; out.push({ t: 'decor', d: addDecor(c) }); }
      else if (s.t === 'light') { const e: LevelEntity = JSON.parse(JSON.stringify(s.e)) as LevelEntity; e.x += dx || 1; addEnt(e); out.push({ t: 'light', e }); }
    }
    endBatch();
    select(out);
    toast(t('Copy: {n}', { n: out.length }));
  }
  function focusSel(): void {
    const box = new THREE.Box3();
    for (const s of sel) {
      if (s.t === 'block') box.expandByPoint(new THREE.Vector3(s.x, s.y + 0.5, s.z));
      else if (s.t === 'decor') box.union(decorBox(s.d));
      else if (s.t === 'light') box.expandByPoint(new THREE.Vector3(s.e.x, s.e.y, s.e.z));
      else if (s.t === 'spawn' && level.spawn) box.expandByPoint(new THREE.Vector3(...level.spawn));
      else if (s.t === 'land') { const [x0, z0, x1, z1] = landRect(s.p); box.expandByPoint(new THREE.Vector3(x0, s.p.y, z0)).expandByPoint(new THREE.Vector3(x1, s.p.y + s.p.layers / 2, z1)); }
    }
    if (box.isEmpty()) { frameAll(); return; }
    const ctr = box.getCenter(new THREE.Vector3()), r = Math.max(1.5, box.getSize(new THREE.Vector3()).length() / 2);
    for (const vp of vps.visible()) vp.focus(ctr, r);
  }
  function frameAll(): void {
    const b = level.getBounds();
    if (!b) return;
    const ctr = new THREE.Vector3((b.minX + b.maxX) / 2, b.maxY * 0.3, (b.minZ + b.maxZ) / 2);
    const r = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
    for (const vp of vps.visible()) vp.focus(ctr, r * 0.9);
  }

  function contextItems(): MenuItem[] {
    const hasBlocks = sel.some((s) => s.t === 'block');
    return [
      { head: sel.length ? selSummary() : t('Nothing selected') },
      { label: t('To the selection'), icon: 'focus', shortcut: 'F', disabled: !sel.length, action: focusSel },
      { label: t('Duplicate'), icon: 'copy', shortcut: 'Ctrl+D', disabled: !sel.length, action: duplicateSel },
      { label: t('Delete'), icon: 'trash', shortcut: 'Del', disabled: !sel.length, action: deleteSel },
      { sep: true },
      { label: t('Rotate'), icon: 'rotate', disabled: !hasBlocks, sub: [
        { label: t('90° around Y (vertical)'), action: () => rotateSel('y') },
        { label: t('90° around X'), action: () => rotateSel('x') },
        { label: t('90° around Z'), action: () => rotateSel('z') },
      ] },
      { label: t('Select all blocks like this'), disabled: !hasBlocks, action: selectSameBlocks },
      { label: t('Pick as brush'), icon: 'brush', disabled: !hasBlocks && !sel.some((s) => s.t === 'decor'), action: () => {
        const s = sel[0];
        if (s.t === 'block') { setCurrent(level.nameAt(s.x, s.y, s.z)); setMode('blocks'); } else if (s.t === 'decor') { setDecor(s.d.name); setMode('decor'); }
      } },
      { label: t('Create prefab from selection…'), icon: 'prefab', disabled: !sel.length, action: makePrefab },
      { sep: true },
      { label: t('Put the spawn point here'), icon: 'flag', disabled: !hit, action: () => { if (place) setSpawn([...place], spawnYaw()); } },
      { label: t('Put a light here'), icon: 'light', disabled: !place, action: () => { if (place) { const e = newLight('point', place[0], place[1] + 1.5, place[2]); select([{ t: 'light', e }]); } } },
      { sep: true },
      { label: t('Properties'), icon: 'info', disabled: !sel.length, action: () => setDetTab('details') },
    ];
  }

  // ---------- edits ----------
  /** Bring the item to a snapshot: null — remove from the map, otherwise — return to the map with the snapshot's fields */
  function applyDecor(e: DecorEdit, to: DecorItem | null): void {
    if (!to) { level.removeDecor(e.decor); if (selected === e.decor) selected = null; return; }
    delete e.decor.rot; delete e.decor.on;
    Object.assign(e.decor, snapDecor(to));
    if (level.decor.includes(e.decor)) level.touchDecor(); else level.addDecor(e.decor);
  }
  /** Terrain pieces of the map: stored in meta.lands and go to JSON together with the map */
  function lands(): LandPiece[] { return ((level.meta.lands as LandPiece[] | undefined) ??= []); }
  function applyLand(e: LandEdit, to: LandPiece | null): void {
    const arr = lands();
    if (!to) { const i = arr.indexOf(e.land); if (i >= 0) arr.splice(i, 1); if (selLand === e.land) selLand = null; return; }
    Object.assign(e.land, snapLand(to));
    if (!arr.includes(e.land)) arr.push(e.land);
  }
  function apply(e: Edit, back = false): void {
    if ('key' in e) { if (back) e.undo(); else e.redo(); }
    else if ('land' in e) applyLand(e, back ? e.before : e.after);
    else if ('decor' in e) applyDecor(e, back ? e.before : e.after);
    else if (back) level.set(e.x, e.y, e.z, e.was[0], e.was[1]);
    else level.set(e.x, e.y, e.z, e.now[0], e.now[1]);
  }
  function record(e: Edit): void {
    if (batch) batch.push(e);
    else { undo.push([e]); redo.length = 0; if (undo.length > 300) undo.shift(); }
    dirtyAutosave = true;
  }
  /** Property edit with undo; consecutive edits with the same key (dragging a slider) — one record */
  function recordProp(key: string, undoFn: () => void, redoFn: () => void): void {
    const last = undo[undo.length - 1];
    const now = performance.now();
    if (!batch && last && last.length === 1 && 'key' in last[0] && last[0].key === key && now - last[0].t < 1500) {
      last[0].redo = redoFn; last[0].t = now; redo.length = 0; dirtyAutosave = true; return;
    }
    record({ key, t: now, undo: undoFn, redo: redoFn });
  }
  function edit(x: number, y: number, z: number, name: string, r: number, keepDecor = false): void {
    const was: [string, number] = [level.nameAt(x, y, z), level.rotAt(x, y, z)];
    if (was[0] === name && (name === 'air' || was[1] === r)) return;
    const own = !batch;
    if (own) beginBatch();
    const e: BlockEdit = { x, y, z, was, now: [name, r] };
    apply(e);
    record(e);
    // a block was erased — remove the decor attached to it (torch on a wall, chain on the ceiling)
    if (name === 'air' && !keepDecor) for (const d of level.decor.filter((d) => attachedTo(d, x, y, z))) removeDecor(d);
    if (own) endBatch();
  }
  function addDecor(d: DecorItem): DecorItem {
    level.addDecor(d);
    record({ decor: d, before: null, after: snapDecor(d) });
    outliner.invalidate();
    return d;
  }
  function removeDecor(d: DecorItem): void {
    const before = snapDecor(d);
    level.removeDecor(d);
    if (selected === d) selected = null;
    if (hoverDecor === d) hoverDecor = null;
    record({ decor: d, before, after: null });
    outliner.invalidate();
  }
  /** Change an item in place (rotation, translation) as one edit; key — merge consecutive edits from a "Details" field */
  function changeDecor(d: DecorItem, fn: (d: DecorItem) => void, key?: string): void {
    const before = snapDecor(d);
    fn(d);
    level.touchDecor();
    if (key && !batch) {
      const after = snapDecor(d);
      const e: DecorEdit = { decor: d, before, after };
      recordProp(`${key}:${level.decor.indexOf(d)}`, () => { const was = level.decor.indexOf(d); applyDecor(e, e.before); void was; }, () => applyDecor(e, after));
      // when merging, "before" comes from the first edit: recordProp keeps the old undo
    } else record({ decor: d, before, after: snapDecor(d) });
    if (sel.some((s) => s.t === 'decor' && s.d === d)) { rebuildSelFx(); details.refresh(); }
  }
  /** Lights and other entities: change with undo */
  function changeEnt(e: LevelEntity, fn: (e: LevelEntity) => void, key?: string): void {
    const before = JSON.stringify(e);
    fn(e);
    const after = JSON.stringify(e);
    if (before === after) return;
    const set = (s: string) => { for (const k of Object.keys(e)) delete (e as unknown as Record<string, unknown>)[k]; Object.assign(e, JSON.parse(s)); entVersion++; };
    if (key && !batch) recordProp(`${key}:${level.entities.indexOf(e)}`, () => set(before), () => set(after));
    else record({ key: `ent:${Math.random()}`, t: 0, undo: () => set(before), redo: () => set(after) });
    entVersion++;
    if (sel.some((s) => s.t === 'light' && s.e === e)) { syncEntities(); rebuildSelFx(); details.refresh(); }
  }
  function addEnt(e: LevelEntity): void {
    level.entities.push(e); entVersion++;
    record({ key: `ent+:${Math.random()}`, t: 0, undo: () => { const i = level.entities.indexOf(e); if (i >= 0) level.entities.splice(i, 1); entVersion++; }, redo: () => { level.entities.push(e); entVersion++; } });
    outliner.invalidate();
  }
  function removeEnt(e: LevelEntity): void {
    const i = level.entities.indexOf(e);
    if (i < 0) return;
    level.entities.splice(i, 1); entVersion++;
    record({ key: `ent-:${Math.random()}`, t: 0, undo: () => { level.entities.splice(i, 0, e); entVersion++; }, redo: () => { const j = level.entities.indexOf(e); if (j >= 0) level.entities.splice(j, 1); entVersion++; } });
    outliner.invalidate();
  }
  function newLight(type: 'point' | 'spot', x: number, y: number, z: number): LevelEntity {
    const e: LevelEntity = { kind: 'light', x, y, z, rot: 0, data: { ...LIGHT_DEFAULTS, type, ...(type === 'spot' ? { distance: 14, intensity: 12, color: '#fff2d8' } : {}) } };
    addEnt(e);
    toast(type === 'spot' ? t('Spotlight placed') : t('Light placed'));
    return e;
  }
  function setSpawn(p: [number, number, number] | null, yaw: number): void {
    const before = { sp: level.spawn ? [...level.spawn] as [number, number, number] : null, yaw: spawnYaw() };
    const after = { sp: p ? [...p] as [number, number, number] : null, yaw };
    const set = (v: typeof before) => { level.spawn = v.sp; if (v.yaw) level.meta.spawnYaw = v.yaw; else delete level.meta.spawnYaw; outliner.invalidate(); };
    set(after);
    recordProp('spawn', () => set(before), () => set(after));
    if (sel.some((s) => s.t === 'spawn')) { rebuildSelFx(); details.refresh(); }
  }
  /** World settings with undo: the edit in fn, consecutive ones with the same key — one record */
  function changeWorld(fn: (w: WorldSettings) => void, key = 'world'): void {
    const before = JSON.stringify(world);
    fn(world);
    const after = JSON.stringify(world);
    if (before === after) return;
    const set = (s: string) => { world = JSON.parse(s) as WorldSettings; applyWorldNow(); details.refresh(); };
    recordProp(`world:${key}`, () => set(before), () => set(after));
    applyWorldNow();
  }
  function applyWorldNow(): void {
    setWorld(level, world);
    look.applyWorld(world);
    weather.set(world.weather.kind, world.weather.intensity, world.weather.wind);
    sunArrow.setDirection(sunOffset(world, 1).negate().normalize());
    sunArrow.setColor(world.sun.color);
    dirtyAutosave = true;
    outliner.invalidate();
  }
  function beginBatch(): void { batch = []; undo.push(batch); redo.length = 0; if (undo.length > 300) undo.shift(); }
  function endBatch(): void { if (batch && !batch.length) undo.pop(); batch = null; outliner.invalidate(); }
  function doUndo(): void {
    const b = undo.pop(); if (!b) return;
    for (let i = b.length - 1; i >= 0; i--) apply(b[i], true);
    redo.push(b); dirtyAutosave = true; toast(t('Undo'));
    afterSelEdit();
  }
  function doRedo(): void {
    const b = redo.pop(); if (!b) return;
    for (const e of b) apply(e);
    undo.push(b); dirtyAutosave = true; toast(t('Redo'));
    afterSelEdit();
  }
  /** Kit or user prefab: all level.set calls inside fn are written as one edit */
  function recordSets(fn: () => void): void {
    beginBatch();
    const L = level, b = batch!;
    const orig = Level.prototype.set;
    (L as { set: Level['set'] }).set = function (x: number, y: number, z: number, name: string, r = 0) {
      const was: [string, number] = [L.nameAt(x, y, z), L.rotAt(x, y, z)];
      orig.call(L, x, y, z, name, r);
      const now: [string, number] = [L.nameAt(x, y, z), L.rotAt(x, y, z)];
      if (was[0] !== now[0] || (now[0] !== 'air' && was[1] !== now[1])) b.push({ x, y, z, was, now });
    };
    try { fn(); } finally { Reflect.deleteProperty(L, 'set'); }
    dirtyAutosave = true;
    endBatch();
  }
  /** Place a prefab at cell (x, y, z) — y is the first air layer */
  function placePrefab(p: Prefab, x: number, y: number, z: number): void {
    if (p.kind === 'block') { beginBatch(); edit(x, y, z, p.name!, rot); endBatch(); select([{ t: 'block', x, y, z }]); }
    else if (p.kind === 'decor') { const it = addDecor({ name: p.name!, pos: [x, y, z] }); select([{ t: 'decor', d: it }]); }
    else if (p.kind === 'kit') { recordSets(() => p.build!(level, x, y, z, Math.floor(Math.random() * 1e5))); toast(t('Placed: {title}', { title: p.title })); }
    else if (p.kind === 'light') { const e = newLight(p.name as 'point' | 'spot', x, y + 1.5, z); select([{ t: 'light', e }]); }
    else if (p.kind === 'spawn') { setSpawn([x, y, z], spawnYaw()); select([{ t: 'spawn' }]); toast(t('Spawn point')); }
    else if (p.kind === 'user' || p.kind === 'lib') {
      let res: ReturnType<typeof stampUser> | null = null;
      const n0 = undo.length;
      recordSets(() => { res = stampUser(level, p.user!, x, y, z, placeRot); });
      const r = res as ReturnType<typeof stampUser> | null;
      if (r) { beginBatch(); for (const d of r.decor) addDecor(d); for (const e of r.entities) addEnt(e); endBatch(); }
      // the preset's blocks and decor — one undo record
      if (undo.length - n0 === 2) { const last = undo.pop()!; undo[undo.length - 1].push(...last); }
      toast(t('Placed: {title}', { title: p.title }));
    }
    outliner.invalidate();
  }
  /** Save the selection as a user prefab */
  function makePrefab(): void {
    const cells = sel.filter((s): s is Extract<Sel, { t: 'block' }> => s.t === 'block');
    const decor = sel.filter((s): s is Extract<Sel, { t: 'decor' }> => s.t === 'decor').map((s) => s.d);
    const lightsSel = sel.filter((s): s is Extract<Sel, { t: 'light' }> => s.t === 'light').map((s) => s.e);
    if (!cells.length && !decor.length && !lightsSel.length) { toast(t('Select blocks, decor or lights')); return; }
    const pts = [...cells.map((c) => [c.x, c.y, c.z]), ...decor.map((d) => d.pos), ...lightsSel.map((e) => [e.x, e.y, e.z])];
    const bx = Math.round((Math.min(...pts.map((p) => p[0])) + Math.max(...pts.map((p) => p[0]))) / 2);
    const bz = Math.round((Math.min(...pts.map((p) => p[2])) + Math.max(...pts.map((p) => p[2]))) / 2);
    const by = Math.min(...pts.map((p) => Math.floor(p[1])));
    const title = prompt(t('Prefab name'), t('Prefab {n}', { n: userPrefabs.length + 1 }));
    if (!title) return;
    const u: UserPrefab = {
      id: `${Date.now().toString(36)}`, title,
      cells: cells.map((c) => [c.x - bx, c.y - by, c.z - bz, level.nameAt(c.x, c.y, c.z), level.rotAt(c.x, c.y, c.z)]),
      decor: decor.map((d) => ({ ...snapDecor(d), pos: [d.pos[0] - bx, d.pos[1] - by, d.pos[2] - bz], ...(d.on ? { on: [d.on[0] - bx, d.on[1] - by, d.on[2] - bz] as [number, number, number] } : {}) })),
      entities: lightsSel.map((e) => ({ ...JSON.parse(JSON.stringify(e)) as LevelEntity, x: e.x - bx, y: e.y - by, z: e.z - bz })),
    };
    userPrefabs = [...userPrefabs, u];
    saveUserPrefabs(userPrefabs);
    prefabs = catalog(userPrefabs);
    pfGroup = 'mine';
    drawPrefabs();
    toast(t('Prefab "{title}" — in "My prefabs"', { title }));
  }
  /** User prefab → JSON in the library format (assets/prefabs/<id>.json): category "mine", size by contents */
  function exportPrefab(u: UserPrefab): void {
    const pts = [...u.cells.map((c) => [c[0], c[1], c[2]]), ...u.decor.map((d) => d.pos), ...u.entities.map((e) => [e.x, e.y, e.z])];
    const span = (i: number) => pts.length ? Math.ceil(Math.max(...pts.map((p) => p[i]))) - Math.floor(Math.min(...pts.map((p) => p[i]))) + 1 : 1;
    const id = u.title.replace(/[^\p{L}\p{N}_-]+/gu, '_').toLowerCase() || u.id;
    const out = { id, title: u.title, category: 'mine', size: [span(0), span(1), span(2)], seed: 1, cells: u.cells, decor: u.decor, entities: u.entities };
    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${id}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(t('JSON downloaded — put it in assets/prefabs/'));
  }
  function blockCount(): number { let n = 0; level.forEach(() => n++); return n; }

  /** Build a piece from its parameters (inside an edit batch): the edges fall off to the ground, inside — plates of 0.5 m; cells — in p.cells */
  function buildLand(p: LandPiece): void {
    const [x0, z0, x1, z1, y1] = landRect(p);
    const was = new Map<string, [string, number]>();
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let yy = p.y - 1; yy <= y1; yy++) was.set(`${x},${yy},${z}`, [level.nameAt(x, yy, z), level.rotAt(x, yy, z)]);
    landscape(level, x0, z0, x1, z1, p.y, {
      layers: p.layers, max: p.layers, scale: p.scale, stone: p.stone / 100, seed: p.seed, dry: 0.08, daisies: 0.04, ground: GROUNDS[p.ground ?? 'grass'] ?? GROUNDS.grass,
      fade: Math.max(2, Math.min(p.w, p.d) / 5),
      flat: (x, z) => x === x0 || x === x1 || z === z0 || z === z1,
      bumps: [{ x: p.x, z: p.z, rx: p.w * 0.38, rz: p.d * 0.38, h: p.layers * 0.55 }],
    });
    p.cells = [];
    for (const [k, w0] of was) {
      const [x, yy, z] = k.split(',').map(Number);
      const now: [string, number] = [level.nameAt(x, yy, z), level.rotAt(x, yy, z)];
      if (now[0] === w0[0] && (now[0] === 'air' || now[1] === w0[1])) continue;
      batch!.push({ x, y: yy, z, was: w0, now });
      p.cells.push([x, yy, z, w0[0], w0[1], now[0], now[1]]);
    }
  }
  /** Return the piece's cells to how they were before it — except those changed by hand afterwards */
  function clearLand(p: LandPiece): void {
    for (let i = p.cells.length - 1; i >= 0; i--) {
      const [x, y, z, wn, wr, nn, nr] = p.cells[i];
      if (level.nameAt(x, y, z) === nn && (nn === 'air' || level.rotAt(x, y, z) === nr)) edit(x, y, z, wn, wr);
    }
  }
  /**
   * Place a new piece (p = null) or rebuild piece p with new parameters and centre — as one edit.
   * If the previous edit was an edit of this same piece and it is the last in undo — merge: roll it back and build anew.
   */
  function changeLand(p: LandPiece | null, params: LandParams): LandPiece {
    const outer = batch;
    if (!outer && p && live?.piece === p && undo[undo.length - 1] === live.batch) {
      const b = undo.pop()!;
      for (let i = b.length - 1; i >= 0; i--) apply(b[i], true);
    }
    const piece = p ?? { ...params, cells: [] };
    const before = lands().includes(piece) ? snapLand(piece) : null;
    if (!outer) beginBatch();
    const b = batch!;
    if (before) clearLand(piece);
    Object.assign(piece, params);
    buildLand(piece);
    b.push({ land: piece, before, after: snapLand(piece) });
    if (!lands().includes(piece)) lands().push(piece);
    if (!outer) { endBatch(); live = { piece, batch: b }; }
    selLand = piece;
    dirtyAutosave = true;
    syncSliders();
    refreshHud();
    if (sel.some((s) => s.t === 'land' && s.p === piece)) { rebuildSelFx(); details.refresh(); }
    outliner.invalidate();
    return piece;
  }
  function placeLand(x: number, y: number, z: number): LandPiece { return changeLand(null, { ...land, x, y, z }); }
  /** Remove a piece: cells — as they were before it, the record — out of the map */
  function removeLand(p: LandPiece): void {
    beginBatch();
    clearLand(p);
    batch!.push({ land: p, before: snapLand(p), after: null });
    applyLand({ land: p, before: null, after: null }, null);
    endBatch();
    live = null; selLand = hoverLand = null;
    dirtyAutosave = true;
    syncSliders();
    refreshHud();
  }
  /** The piece under a cell: inside its rectangle and within its frame in height; of the overlapping ones — the one placed later */
  function landAt(c: [number, number, number]): LandPiece | null {
    const arr = lands();
    for (let i = arr.length - 1; i >= 0; i--) {
      const [x0, z0, x1, z1, y1] = landRect(arr[i]);
      if (c[0] >= x0 && c[0] <= x1 && c[2] >= z0 && c[2] <= z1 && c[1] >= arr[i].y - 1 && c[1] <= y1) return arr[i];
    }
    return null;
  }
  function selectLand(p: LandPiece | null): void { selLand = p; live = null; drawModeTools(); refreshHud(); }
  function fillBox(a: [number, number, number], b: [number, number, number], name: string): void {
    beginBatch();
    for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++)
      for (let z = Math.min(a[2], b[2]); z <= Math.max(a[2], b[2]); z++)
        for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++) edit(x, y, z, name, rot);
    endBatch();
  }

  // ---------- modes and brush ----------
  function setCurrent(name: string): void { current = name; refreshHud(); if (mode === 'blocks') drawPrefabs(); }
  function setDecor(name: string): void { curDecor = name; buildGhost(); refreshHud(); if (mode === 'decor') drawPrefabs(); }
  function setMode(m: Mode | 'blocks' | 'decor' | 'land'): void {
    mode = m;
    landBox.visible = false;
    if (m !== 'land') { hoverLand = null; live = null; if (m !== 'select') selLand = null; }
    selBox.visible = false;
    if (m !== 'decor') { selected = hoverDecor = null; placement = null; moving = null; }
    cursorBox.visible = hitBox.visible = hoverBox.visible = false;
    ghost.visible = false; outline.visible = false;
    if (m !== 'select' && m !== 'land') select([], false);
    root.dataset.mode = m;
    drawModeTools();
    drawPrefabs();
    refreshToolbar();
    refreshHud();
  }
  const nextMode = (): Mode => (mode === 'select' ? 'blocks' : mode === 'blocks' ? 'decor' : mode === 'decor' ? 'land' : 'select');
  function refreshHud(): void {
    const at = mode === 'decor' ? (placement ? t('point {p}', { p: placement.pos.map((v) => +v.toFixed(3)).join(', ') }) : '') : place ? t('cell {x}, {y}, {z}', { x: place[0], y: place[1], z: place[2] }) : '';
    stCursor.textContent = at;
    if (mode === 'land') frameLand(selBox, selLand);
    if (mode !== 'select') drawModeTools();
  }

  function setLevel(L: Level): void {
    selected = hoverDecor = null; moving = null;
    selLand = hoverLand = null; live = null;
    sel = []; selIds = new Set();
    view.dispose();
    level = L;
    view = new LevelRenderer(scene, level, T);
    view.maxY = maxY;
    view.rebuildAll();
    undo.length = redo.length = 0;
    nameInput.value = level.name;
    docTabs.querySelector('.lvl span')!.textContent = level.name;
    world = worldOf(level);
    applyWorldNow();
    entVersion++;
    const b = level.getBounds();
    const target = level.spawn ? new THREE.Vector3(...level.spawn) : b ? new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2) : new THREE.Vector3();
    vps.home(target, 40);
    buildGhost();
    dirtyAutosave = true;
    rebuildSelFx();
    buildDetails();
    drawModeTools();
    outliner.invalidate();
  }
  function newMap(): void {
    if (!confirm(t('Start a new map? Unsaved changes will be lost.'))) return;
    const L = new Level(t('New map')); L.fill(-8, -1, -8, 8, -1, 8, 'grass'); L.spawn = [0, 0, 0]; setLevel(L);
  }
  function floorDialog(): void {
    const raw = prompt(t('Dungeon floor: seed (and the floor number after a space)'), `${Math.floor(Math.random() * 100000)} 1`);
    if (!raw) return;
    const [seed, floor] = raw.split(/\s+/).map(Number);
    try { setLevel(buildFloor({ seed: seed || 1, floor: floor || 1, rooms: ROOMS })); toast(t('Floor built: seed {seed}', { seed: seed || 1 })); }
    catch (e) { toast(t('Failed to build: {msg}', { msg: (e as Error).message })); }
  }
  function play(): void { autosave(); window.open('./?map=editor', '_blank'); }

  // ---------- saving ----------
  function loadInitial(): Level {
    try {
      const raw = localStorage.getItem(EDITOR_STORAGE);
      if (raw) return Level.fromJSON(JSON.parse(raw) as LevelJSON);
    } catch { /* corrupted autosave — take a built-in map */ }
    const first = maps['playground.json'] ?? maps[Object.keys(maps)[0]];
    return first ? Level.fromJSON(first) : new Level(t('New map'));
  }
  function autosave(): void {
    try { localStorage.setItem(EDITOR_STORAGE, JSON.stringify(level.toJSON())); } catch { toast(t('Could not save to localStorage')); }
    dirtyAutosave = false;
  }
  function save(): void {
    autosave();
    const blob = new Blob([JSON.stringify(level.toJSON())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${level.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').toLowerCase() || 'map'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(t('JSON downloaded — put it in assets/maps/'));
  }
  function open(): void {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.addEventListener('change', async () => {
      const f = inp.files?.[0]; if (!f) return;
      try { setLevel(Level.fromJSON(JSON.parse(await f.text()) as LevelJSON)); toast(t('Opened "{name}"', { name: level.name })); }
      catch (e) { toast(t('Could not open: {msg}', { msg: (e as Error).message })); }
    });
    inp.click();
  }
  setInterval(() => { if (dirtyAutosave) autosave(); }, 2000);
  window.addEventListener('beforeunload', () => { if (dirtyAutosave) autosave(); });

  // ---------- windows: log and help ----------
  function modal(title: string, body: HTMLElement): void {
    const back = h('div.ue-modal-back');
    const close = () => back.remove();
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
    back.append(h('div.ue-modal', {}, h('div.ue-modal-h', {}, h('span', { text: title }), h('button.ue-x', { text: '×', onclick: close })), body));
    document.body.append(back);
  }
  function showLog(): void { modal(t('Log'), h('pre.ue-log', { text: log.slice().reverse().join('\n') || t('Empty') })); }
  function showHelp(): void {
    const rows: [string, string][] = [
      ['Tab / Shift+1…5', t('modes: select, blocks, decor, landscape, place')],
      [t('LMB'), t('select (Shift — add), drag over empty space — marquee')],
      ['W / E / R / Q', t('gizmo: translate, rotate along axes, scale, no gizmo')],
      ['F / Home', t('to the selection / the whole map')],
      ['Del, Ctrl+D', t('delete, duplicate')],
      [t('arrows, PgUp/PgDn with Ctrl'), t('nudge the selection (Shift — by 4)')],
      [t('MMB or Alt+LMB'), t('orbit the camera around the target')],
      [t('RMB'), t('pan the camera; click — menu')],
      [t('RMB + WASD / QE'), t('fly')],
      [t('wheel'), t('zoom to the cursor')],
      ['Alt+X', t('maximise the viewport')],
      ['PgUp / PgDn', t('height slice')],
      ['G', t('grid')],
      ['Ctrl+Z / Ctrl+Y', t('undo / redo')],
      ['Ctrl+S / Ctrl+O', t('download / open JSON')],
      ['F5', t('play this map')],
      [t('Blocks: R, Q, [ ], 1–9'), t('rotate, pick, palette')],
      [t('Decor: R / T / Y, Z'), t('yaw, pitch, roll; random yaw')],
    ];
    const tbl = h('table.ue-keys');
    for (const [k, v] of rows) tbl.append(h('tr', {}, h('td', {}, h('kbd', { text: k })), h('td', { text: v })));
    modal(t('Hotkeys'), tbl);
  }

  // ---------- mouse: brush cursor ----------
  const ray = new THREE.Raycaster();
  function setRay(vp: Viewport, ndc: THREE.Vector2): void {
    ray.setFromCamera(ndc, vp.camera);
    // an orthographic camera's ray starts at the near plane — move the origin back to see everything
    if (vp.isOrtho) ray.ray.origin.addScaledVector(ray.ray.direction, -300);
  }
  function updateCursor(ev: { clientX: number; clientY: number; shiftKey?: boolean }, vp?: Viewport): void {
    const p = vps.pick(ev.clientX, ev.clientY, vp);
    if (!p) return;
    vps.setActive(p.vp);
    setRay(p.vp, p.ndc);
    if (mode === 'decor') { updateDecorCursor(); return; }
    const o = ray.ray.origin, d = ray.ray.direction;
    const hh = raycastVoxels(level, o.x, o.y, o.z, d.x, d.y, d.z, 900, maxY);
    hit = null; place = null;
    if (hh) {
      hit = [hh.x, hh.y, hh.z];
      const n = DIRS[hh.face] ?? [0, 1, 0];
      // grass and flowers are replaced by the new block, not built upon
      place = level.defAt(hh.x, hh.y, hh.z).replaceable ? hit : [hh.x + n[0], hh.y + n[1], hh.z + n[2]];
    } else if (Math.abs(d.y) > 1e-4) {
      // void: place on the plane y = 0 (the block below it, like the garden ground)
      const t = -o.y / d.y;
      if (t > 0 && t < 900) place = [Math.round(o.x + d.x * t), -1, Math.round(o.z + d.z * t)];
    }
    hitBox.visible = mode === 'blocks' && !!hit;
    cursorBox.visible = (mode === 'blocks' || mode === 'place') && !!place;
    hoverBox.visible = mode === 'select' && !!hit;
    if (mode === 'land') {
      // over a piece — its frame (select), otherwise — the frame of a new piece
      hoverLand = hit && !ev.shiftKey ? landAt(hit) : null;
      (landBox.material as THREE.LineBasicMaterial).color.set(hoverLand ? '#ffffff' : '#ffd25a');
      if (hoverLand) frameLand(landBox, hoverLand === selLand ? null : hoverLand);
      else frameLand(landBox, place ? { ...land, x: place[0], y: place[1], z: place[2] } : null);
    }
    if (hit) { hitBox.position.set(hit[0], hit[1] + 0.5, hit[2]); hoverBox.position.copy(hitBox.position); }
    if (place) cursorBox.position.set(place[0], place[1] + 0.5, place[2]);
    refreshHud();
  }

  // ---------- decor: ghost under the cursor and the frame of the selected item ----------
  const ghost = new THREE.Group();
  ghost.visible = false;
  scene.add(ghost);
  const outline = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color('#4cff7a'));
  (outline.material as THREE.LineBasicMaterial).depthTest = false;
  outline.renderOrder = 21;
  outline.visible = false;
  scene.add(outline);
  function buildGhost(): void {
    for (const m of [...ghost.children] as THREE.Mesh[]) { ghost.remove(m); (m.material as THREE.Material).dispose(); }
    const def = decorDef(curDecor);
    for (const layer of ['opaque', 'cutout', 'glow', 'fire'] as Layer[]) {
      const g = view.decor.geometryOf(def, layer);
      if (!g) continue;
      const mat = layer === 'fire'
        ? new THREE.MeshBasicMaterial({ map: T.fire, transparent: true, opacity: 0.7, alphaTest: 0.3, depthWrite: false, side: THREE.DoubleSide })
        : new THREE.MeshLambertMaterial({ map: view.atlas.texture, vertexColors: true, transparent: true, opacity: 0.6, alphaTest: 0.3, depthWrite: false, side: THREE.DoubleSide });
      ghost.add(new THREE.Mesh(g, mat));
    }
  }
  function frameDecor(d: DecorItem): void {
    outline.box.copy(decorBox(d));
    outline.visible = true;
  }
  function aim(anchorOf: DecorItem | null): DecorPlacement | null {
    const def = decorDef(anchorOf?.name ?? curDecor);
    // moving — keep the item's rotation (for a wall item — pitch and roll, yaw is set by the wall)
    const extra = anchorOf ? (def.anchor === 'wall' ? [0, anchorOf.rot?.[1] ?? 0, anchorOf.rot?.[2] ?? 0] : [anchorOf.rot?.[0] ?? 0, anchorOf.rot?.[1] ?? 0, anchorOf.rot?.[2] ?? 0])
      : [dRot[0] + (randomYaw ? randYaw : 0), dRot[1], dRot[2]];
    return placeDecor(level, def.anchor, ray.ray.origin, ray.ray.direction, extra, maxY);
  }
  function updateDecorCursor(): void {
    cursorBox.visible = hitBox.visible = hoverBox.visible = false;
    placement = aim(moving?.item ?? null);
    if (moving) {
      if (placement) {
        const p = placement;
        moving.item.pos = p.pos;
        if (p.rot.length) moving.item.rot = p.rot; else delete moving.item.rot;
        if (p.on) moving.item.on = p.on; else delete moving.item.on;
        level.touchDecor();
      }
      ghost.visible = false;
      frameDecor(moving.item);
      refreshHud();
      return;
    }
    const dh = view.decor.raycast(ray);
    const o = ray.ray.origin;
    const pd = placement ? Math.hypot(placement.pos[0] - o.x, placement.pos[1] - o.y, placement.pos[2] - o.z) : Infinity;
    hoverDecor = dh && dh.distance < pd + 0.3 ? dh.item : null;
    ghost.visible = !!placement && !hoverDecor;
    if (placement && ghost.visible) {
      decorMatrix({ name: curDecor, pos: placement.pos, rot: placement.rot }, ghost.matrix);
      ghost.matrixAutoUpdate = false;
      ghost.matrixWorldNeedsUpdate = true;
    }
    const sh = hoverDecor ?? selected;
    if (sh) frameDecor(sh); else outline.visible = false;
    refreshHud();
  }

  // frame of the future terrain piece under the cursor
  const landBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: '#ffd25a', depthTest: false, transparent: true, toneMapped: false }));
  const selBox = new THREE.LineSegments(landBox.geometry, new THREE.LineBasicMaterial({ color: '#4cff7a', depthTest: false, transparent: true, toneMapped: false }));
  // the selected piece also gets a light volume fill: a thin frame is easy to lose on mottled grass
  selBox.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#4cff7a', transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false })));
  landBox.renderOrder = selBox.renderOrder = 20;
  landBox.visible = selBox.visible = false;
  scene.add(landBox, selBox);
  /** Frame of a terrain piece: rectangle and height in its layers; null — hide */
  function frameLand(box: THREE.LineSegments, p: LandParams | null): void {
    box.visible = !!p && mode === 'land';
    if (!p) return;
    const [x0, z0, x1, z1] = landRect(p);
    const hgt = Math.max(0.5, p.layers / 2);
    box.scale.set(p.w + 0.04, hgt + 0.04, p.d + 0.04);
    box.position.set((x0 + x1) / 2, p.y + hgt / 2, (z0 + z1) / 2);
  }

  // ---------- mouse in the viewports ----------
  /** Under the cursor in select mode: icon, item or block — the nearest */
  function pickAt(vp: Viewport, ndc: THREE.Vector2): Sel | null {
    setRay(vp, ndc);
    ray.camera = vp.camera;
    let best: { s: Sel; d: number } | null = null;
    if (show.icons) for (const hh of ray.intersectObjects(helpers.children, true)) {
      const pk = hh.object.userData.pick as Sel | undefined;
      if (pk && hh.object.visible) { best = { s: pk, d: hh.distance - 0.5 }; break; }
    }
    if (show.decor) { const dh = view.decor.raycast(ray); if (dh && (!best || dh.distance < best.d)) best = { s: { t: 'decor', d: dh.item }, d: dh.distance }; }
    const o = ray.ray.origin, d = ray.ray.direction;
    const vh = raycastVoxels(level, o.x, o.y, o.z, d.x, d.y, d.z, 900, maxY);
    if (vh && (!best || vh.t < best.d - 0.05)) best = { s: { t: 'block', x: vh.x, y: vh.y, z: vh.z }, d: vh.t };
    return best?.s ?? null;
  }
  const marquee = h('div.ue-marquee');
  vps.el.append(marquee);
  /** Press in select mode: click — select, drag — marquee */
  let press: { vp: Viewport; x: number; y: number; shift: boolean; moved: boolean; button: number } | null = null;
  /** RMB + WASD — flight */
  let rmbFly = false;
  for (const vp of vps.list) {
    const el = vp.el;
    el.addEventListener('pointerdown', (e) => {
      closeMenus();
      if ((e.target as HTMLElement).closest('.ue-vp-bar, .ue-vp-axes')) return;
      if (e.button === 2) { press = { vp, x: e.clientX, y: e.clientY, shift: e.shiftKey, moved: false, button: 2 }; rmbFly = true; return; }
      if (e.button !== 0 || e.altKey) return;
      const tc = tcs[vp.index];
      if (tc.dragging || (tc.object && tc.axis)) return;
      updateCursor(e, vp);
      if (mode === 'select') { press = { vp, x: e.clientX, y: e.clientY, shift: e.shiftKey || e.ctrlKey || e.metaKey, moved: false, button: 0 }; return; }
      if (mode === 'place') { if (curPrefab && place) placePrefab(curPrefab, place[0], place[1], place[2]); return; }
      if (mode === 'land') {
        if (hoverLand) { selectLand(hoverLand); toast(t('Piece selected — the sliders edit it')); }
        else if (place) { placeLand(place[0], place[1], place[2]); toast(t('Landscape placed')); }
        updateCursor(e, vp);
        return;
      }
      if (mode === 'decor') {
        if (hoverDecor) {
          if (e.shiftKey) { removeDecor(hoverDecor); toast(t('Item removed')); }
          else { selected = hoverDecor; moving = { item: selected, before: snapDecor(selected) }; }
        } else if (placement && !e.shiftKey) {
          const p = placement;
          selected = addDecor({ name: curDecor, pos: p.pos, ...(p.rot.length ? { rot: p.rot } : {}), ...(p.on ? { on: p.on } : {}) });
          if (randomYaw) randYaw = Math.round(Math.random() * 24) * 15;
        } else selected = null;
        updateDecorCursor();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        const cell = e.shiftKey ? hit : place;
        if (!cell) return;
        if (!corner) { corner = cell; cornerBox.visible = true; cornerBox.position.set(cell[0], cell[1] + 0.5, cell[2]); toast(t('Corner set — click the second one')); }
        else { fillBox(corner, cell, e.shiftKey ? 'air' : current); corner = null; cornerBox.visible = false; toast(e.shiftKey ? t('Cut out') : t('Filled')); }
        return;
      }
      drag = e.shiftKey ? 'remove' : 'place';
      beginBatch();
      lastPainted = '';
      paint();
    });
    el.addEventListener('pointermove', (e) => {
      if (press && press.vp === vp && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) press.moved = true;
      if (press && press.button === 0 && press.moved) drawMarquee(press, e);
      if (tcs[vp.index].dragging) return;
      updateCursor(e, vp); paint();
    });
    el.addEventListener('dblclick', (e) => {
      if (mode !== 'select') return;
      const p = vps.pick(e.clientX, e.clientY, vp);
      if (!p) return;
      const s = pickAt(vp, p.ndc);
      // double-click on landscape — the whole piece
      if (s?.t === 'block') { const lp = landAt([s.x, s.y, s.z]); if (lp) { select([{ t: 'land', p: lp }]); return; } }
      focusSel();
    });
    // a prefab dragged from the panel — place it where it was dropped
    el.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('text/x-malina-prefab')) { e.preventDefault(); updateCursor(e, vp); cursorBox.visible = !!place; } });
    el.addEventListener('drop', (e) => {
      const id = e.dataTransfer?.getData('text/x-malina-prefab');
      const p = prefabs.find((x) => x.id === id);
      if (!p) return;
      e.preventDefault();
      if (p.kind === 'decor') {
        // decor — by its own anchor: on the floor, wall or ceiling
        updateCursor(e, vp);
        const pl = placeDecor(level, decorDef(p.name!).anchor, ray.ray.origin, ray.ray.direction, [0, 0, 0], maxY);
        if (pl) { const it = addDecor({ name: p.name!, pos: pl.pos, ...(pl.rot.length ? { rot: pl.rot } : {}), ...(pl.on ? { on: pl.on } : {}) }); if (mode === 'select') select([{ t: 'decor', d: it }]); }
        else toast(t('It will not fit here — needs a support'));
      } else { updateCursor(e, vp); if (place) placePrefab(p, place[0], place[1], place[2]); }
      cursorBox.visible = false;
    });
  }
  function drawMarquee(p: NonNullable<typeof press>, e: PointerEvent): void {
    const box = vps.el.getBoundingClientRect();
    const x0 = Math.min(p.x, e.clientX) - box.left, y0 = Math.min(p.y, e.clientY) - box.top;
    Object.assign(marquee.style, { display: 'block', left: `${x0}px`, top: `${y0}px`, width: `${Math.abs(e.clientX - p.x)}px`, height: `${Math.abs(e.clientY - p.y)}px` });
  }
  window.addEventListener('pointerup', (e) => {
    if (drag) { endBatch(); drag = null; }
    if (moving) {
      const { item, before } = moving;
      moving = null;
      if (JSON.stringify(before) !== JSON.stringify(item)) record({ decor: item, before, after: snapDecor(item) });
    }
    if (e.button === 2) rmbFly = false;
    const p = press;
    press = null;
    marquee.style.display = 'none';
    if (!p) return;
    if (p.button === 2) {
      // RMB without dragging — context menu
      if (!p.moved && mode === 'select') {
        const pk = vps.pick(e.clientX, e.clientY, p.vp);
        if (pk) { const s = pickAt(p.vp, pk.ndc); if (s && !selIds.has(selId(s))) select([s]); updateCursor(e, p.vp); }
        popupMenu(e.clientX, e.clientY, contextItems());
      }
      return;
    }
    if (mode !== 'select') return;
    if (!p.moved) {
      const pk = vps.pick(e.clientX, e.clientY, p.vp);
      if (!pk) return;
      const s = pickAt(p.vp, pk.ndc);
      if (!s) { if (!p.shift) select([]); return; }
      select(p.shift ? toggleSel(sel, [s]) : [s]);
      return;
    }
    marqueeSelect(p, e);
  });
  /** Marquee: everything whose centre fell into the rectangle (blocks — not above the slice) */
  function marqueeSelect(p: NonNullable<typeof press>, e: PointerEvent): void {
    const vp = p.vp;
    const box = vps.el.getBoundingClientRect();
    const rx0 = Math.min(p.x, e.clientX) - box.left - vp.rect.x, rx1 = Math.max(p.x, e.clientX) - box.left - vp.rect.x;
    const ry0 = Math.min(p.y, e.clientY) - box.top - vp.rect.y, ry1 = Math.max(p.y, e.clientY) - box.top - vp.rect.y;
    const cam = vp.camera;
    cam.updateMatrixWorld();
    const v = new THREE.Vector3();
    const inside = (x: number, y: number, z: number) => {
      v.set(x, y, z).project(cam);
      if (v.z < -1 || v.z > 1) return false;
      const sx = (v.x + 1) / 2 * vp.rect.w, sy = (1 - v.y) / 2 * vp.rect.h;
      return sx >= rx0 && sx <= rx1 && sy >= ry0 && sy <= ry1;
    };
    const out: Sel[] = [];
    // in perspective — only those visible from above (the top block of a column), so the marquee does not grab the bulk of the ground
    const topOnly = !vp.isOrtho;
    level.forEach((x, y, z) => {
      if (y > maxY) return;
      if (topOnly && !level.isAir(x, y + 1, z) && y + 1 <= maxY) return;
      if (inside(x, y + 0.5, z)) out.push({ t: 'block', x, y, z });
    });
    if (show.decor) for (const d of level.decor) if (inside(d.pos[0], d.pos[1] + 0.2, d.pos[2])) out.push({ t: 'decor', d });
    for (const en of level.entities) if (en.kind === 'light' && inside(en.x, en.y, en.z)) out.push({ t: 'light', e: en });
    if (level.spawn && inside(level.spawn[0], level.spawn[1] + 0.8, level.spawn[2])) out.push({ t: 'spawn' });
    select(p.shift ? [...sel, ...out] : out, false);
    toast(t('Selected: {n}', { n: out.length }));
  }
  function paint(): void {
    if (!drag) return;
    const cell = drag === 'place' ? place : hit;
    if (!cell) return;
    const k = cell.join(',');
    if (k === lastPainted) return;
    lastPainted = k;
    if (drag === 'place') edit(cell[0], cell[1], cell[2], current, rot);
    else edit(cell[0], cell[1], cell[2], 'air', 0);
  }

  // ---------- keys ----------
  const keys = new Set<string>();
  function sliceBy(dy: number): void { maxY = Math.max(-8, Math.min(64, maxY + dy)); view.maxY = maxY; view.rebuildAll(); refreshHud(); toast(t('Slice: y ≤ {y}', { y: maxY })); }
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
    if (document.querySelector('.ue-modal-back')) { if (e.code === 'Escape') document.querySelector('.ue-modal-back')!.remove(); return; }
    keys.add(e.code);
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
    if (ctrl && e.code === 'KeyY') { e.preventDefault(); doRedo(); return; }
    if (ctrl && e.code === 'KeyS') { e.preventDefault(); save(); return; }
    if (ctrl && e.code === 'KeyO') { e.preventDefault(); open(); return; }
    if (e.code === 'F5') { e.preventDefault(); play(); return; }
    if (e.code === 'F1') { e.preventDefault(); showHelp(); return; }
    if (doc !== 'level') return;
    if (e.code === 'Tab') { e.preventDefault(); setMode(nextMode()); return; }
    if (e.altKey && e.code === 'KeyX') { e.preventDefault(); vps.toggleMax(vps.active); return; }
    const mm = /^Digit([1-5])$/.exec(e.code);
    if (e.shiftKey && mm && !ctrl) { setMode((['select', 'blocks', 'decor', 'land', 'place'] as Mode[])[+mm[1] - 1]); return; }
    if (e.code === 'Home') { frameAll(); return; }
    if (rmbFly && /^Key[WASDQE]$/.test(e.code)) return;
    if (mode === 'select') { selectKey(e, ctrl); return; }
    if (mode === 'decor') { decorKey(e, ctrl); return; }
    if (mode === 'land') { landKey(e); return; }
    if (mode === 'place') { if (e.code === 'Escape') setMode('select'); else if (e.code === 'KeyG') show.grid = !show.grid; else if (e.code === 'KeyR') { placeRot = (placeRot + 1) % 4; refreshHud(); } return; }
    if (ctrl) return;
    const list = BLOCKS.filter((b) => b.name !== 'air');
    switch (e.code) {
      case 'KeyR': rot = (rot + 1) % 4; refreshHud(); break;
      case 'KeyQ': if (hit) { setCurrent(level.nameAt(hit[0], hit[1], hit[2])); rot = level.rotAt(hit[0], hit[1], hit[2]); refreshHud(); } break;
      case 'KeyX': if (hit) { beginBatch(); edit(hit[0], hit[1], hit[2], 'air', 0); endBatch(); } break;
      case 'BracketLeft': setCurrent(list[(list.findIndex((b) => b.name === current) - 1 + list.length) % list.length].name); break;
      case 'BracketRight': setCurrent(list[(list.findIndex((b) => b.name === current) + 1) % list.length].name); break;
      case 'PageUp': sliceBy(1); break;
      case 'PageDown': sliceBy(-1); break;
      case 'KeyP': if (place) { setSpawn([place[0], place[1], place[2]], spawnYaw()); toast(t('Spawn point set')); } break;
      case 'KeyG': show.grid = !show.grid; break;
      case 'Escape': corner = null; cornerBox.visible = false; setMode('select'); break;
      default: {
        const m = /^Digit([1-9])$/.exec(e.code);
        if (m) { const q = QUICK[+m[1] - 1]; if (q) setCurrent(q); }
      }
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); rmbFly = false; });
  function selectKey(e: KeyboardEvent, ctrl: boolean): void {
    if (ctrl && e.code === 'KeyD') { e.preventDefault(); duplicateSel(); return; }
    if (ctrl && e.code === 'KeyA') { e.preventDefault(); return; }
    if (ctrl) return;
    const k = e.shiftKey ? 4 : 1;
    // arrows — along the screen of the active viewport, by the nearest world axis
    const nudge = (sx: number, sy: number): [number, number, number] => {
      const cam = vps.active.camera;
      if (vps.active.isOrtho) {
        const r = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
        const v = r.multiplyScalar(sx).add(u.multiplyScalar(sy));
        const ax = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)];
        const i = ax.indexOf(Math.max(...ax));
        const out: [number, number, number] = [0, 0, 0]; out[i] = Math.sign([v.x, v.y, v.z][i]) * k; return out;
      }
      const f = new THREE.Vector3(); cam.getWorldDirection(f); f.y = 0; f.normalize();
      const r = new THREE.Vector3(-f.z, 0, f.x);
      const v = r.multiplyScalar(sx).add(f.multiplyScalar(sy));
      return Math.abs(v.x) > Math.abs(v.z) ? [Math.sign(v.x) * k, 0, 0] : [0, 0, Math.sign(v.z) * k];
    };
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    switch (e.code) {
      case 'KeyQ': setTool('select'); break;
      case 'KeyW': setTool('translate'); break;
      case 'KeyE': setTool('rotate'); break;
      case 'KeyR': setTool('scale'); break;
      case 'Space': e.preventDefault(); setTool(tool === 'translate' ? 'rotate' : tool === 'rotate' ? 'scale' : 'translate'); break;
      case 'KeyF': focusSel(); break;
      case 'KeyG': show.grid = !show.grid; break;
      case 'Delete': case 'Backspace': deleteSel(); break;
      case 'Escape': select([]); break;
      case 'PageUp': if (e.shiftKey) nudgeSel([0, 1, 0]); else sliceBy(1); break;
      case 'PageDown': if (e.shiftKey) nudgeSel([0, -1, 0]); else sliceBy(-1); break;
      default:
        if (arrows[e.code] && sel.length) { e.preventDefault(); nudgeSel(nudge(...arrows[e.code])); }
    }
  }
  /** Nudge the selection by cells (blocks, landscape, point) or by as many metres (decor, lights) */
  function nudgeSel(d: [number, number, number]): void {
    beginBatch();
    const cells = sel.filter((s): s is Extract<Sel, { t: 'block' }> => s.t === 'block');
    if (cells.length) moveCells(cells, d, true);
    for (const s of sel) {
      if (s.t === 'decor' && !cells.length) changeDecor(s.d, (x) => { x.pos = [x.pos[0] + d[0], x.pos[1] + d[1], x.pos[2] + d[2]]; delete x.on; });
      else if (s.t === 'light') changeEnt(s.e, (en) => { en.x += d[0]; en.y += d[1]; en.z += d[2]; });
      else if (s.t === 'spawn' && level.spawn) setSpawn([level.spawn[0] + d[0], level.spawn[1] + d[1], level.spawn[2] + d[2]], spawnYaw());
      else if (s.t === 'land') { live = null; changeLand(s.p, { ...landParams(s.p), x: s.p.x + d[0], y: s.p.y + d[1], z: s.p.z + d[2] }); live = null; }
    }
    endBatch();
    afterSelEdit();
  }
  function landKey(e: KeyboardEvent): void {
    const k = e.shiftKey ? 4 : 1;
    const mv: Record<string, [number, number]> = { ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, -k], ArrowDown: [0, k] };
    if (e.code === 'KeyG') show.grid = !show.grid;
    else if (e.code === 'Escape') { if (selLand) selectLand(null); else setMode('select'); }
    else if (selLand && (e.code === 'Delete' || e.code === 'Backspace' || e.code === 'KeyX')) { removeLand(selLand); toast(t('Piece removed')); }
    else if (selLand && mv[e.code]) { e.preventDefault(); changeLand(selLand, { ...landParams(selLand), x: selLand.x + mv[e.code][0], z: selLand.z + mv[e.code][1] }); }
    else if (e.code === 'PageUp') sliceBy(1);
    else if (e.code === 'PageDown') sliceBy(-1);
  }
  function decorKey(e: KeyboardEvent, ctrl: boolean): void {
    const step = e.shiftKey ? -15 : 15;
    const turn = (axis: number) => {
      if (selected) changeDecor(selected, (d) => {
        const r = [d.rot?.[0] ?? 0, d.rot?.[1] ?? 0, d.rot?.[2] ?? 0];
        r[axis] = ((r[axis] + step) % 360 + 540) % 360 - 180;
        while (r.length > 1 && r[r.length - 1] === 0) r.pop();
        if (r.length === 1 && r[0] === 0) delete d.rot; else d.rot = r;
      });
      else dRot[axis] = ((dRot[axis] + step) % 360 + 540) % 360 - 180;
    };
    if (ctrl && e.code === 'KeyD') {
      e.preventDefault();
      if (selected) { const c = snapDecor(selected); c.pos = [c.pos[0] + 0.5, c.pos[1], c.pos[2] + 0.5]; selected = addDecor(c); toast(t('Copy')); }
    } else if (ctrl) return;
    const list = DECOR.map((d) => d.name);
    switch (e.code) {
      case 'KeyR': turn(0); break;
      case 'KeyT': turn(1); break;
      case 'KeyY': turn(2); break;
      case 'KeyZ': randomYaw = !randomYaw; randYaw = randomYaw ? Math.round(Math.random() * 24) * 15 : 0; toast(t('Random yaw: {state}', { state: randomYaw ? t('on') : t('off') })); break;
      case 'KeyQ': {
        const d = hoverDecor ?? selected;
        if (d) { setDecor(d.name); const r = d.rot ?? []; dRot[0] = decorDef(d.name).anchor === 'wall' ? 0 : r[0] ?? 0; dRot[1] = r[1] ?? 0; dRot[2] = r[2] ?? 0; }
        break;
      }
      case 'Delete': case 'Backspace': case 'KeyX': { const d = selected ?? hoverDecor; if (d) { removeDecor(d); toast(t('Item removed')); } break; }
      case 'BracketLeft': setDecor(list[(list.indexOf(curDecor) - 1 + list.length) % list.length]); break;
      case 'BracketRight': setDecor(list[(list.indexOf(curDecor) + 1) % list.length]); break;
      case 'Escape': if (selected) { selected = null; outline.visible = false; } else setMode('select'); break;
      case 'PageUp': sliceBy(1); break;
      case 'PageDown': sliceBy(-1); break;
      case 'KeyG': show.grid = !show.grid; break;
      default: break;
    }
    updateDecorCursor();
  }

  function showItems(): MenuItem[] {
    const it = (label: string, k: keyof typeof show) => ({ label, checked: show[k], action: () => { show[k] = !show[k]; outliner.invalidate(); } });
    return [{ head: t('Show') }, it(t('Grid (G)'), 'grid'), it(t('Light and spawn point icons'), 'icons'), it(t('Decor'), 'decor'), it(t('Weather'), 'weather'), it(t('Haze'), 'fog'), it(t('Statistics'), 'stats')];
  }
  vps.showMenu = showItems;
  vps.onHome = (vp) => { const t = level.spawn ? new THREE.Vector3(...level.spawn) : new THREE.Vector3(); vp.focus(t, 14); };
  vps.onLayout = () => applyGizmo();

  // ---------- frame ----------
  vps.setActive(vps.list[0]);
  setMode('select');
  setDecor(curDecor);
  applyWorldNow();
  dirtyAutosave = false;
  {
    const b = level.getBounds();
    vps.home(level.spawn ? new THREE.Vector3(...level.spawn) : b ? new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2) : new THREE.Vector3(0, 0, 2), 38);
  }
  nameInput.value = level.name;
  docTabs.querySelector('.lvl span')!.textContent = level.name;
  buildDetails();
  refreshToolbar();
  vps.resize();
  // prefab previews — one by one, without delaying the start
  for (const p of prefabs) thumbs.get(p);

  const clock = new THREE.Clock();
  let fpsAcc = 0, fpsN = 0;
  const composerSize = { w: 0, h: 0 };
  function frame(): void {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta());
    const now = clock.elapsedTime;
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { stFps.textContent = `${(fpsN / fpsAcc).toFixed(0)} FPS`; fpsAcc = fpsN = 0; }
    if (doc !== 'level') { thumbs.pump(); return; }
    // camera flight: RMB + WASD / QE in any mode; in brush modes — WASD without RMB too (as before)
    const vp = vps.active;
    if (rmbFly || mode === 'blocks' || mode === 'decor' || mode === 'land') {
      const cam = vp.camera, c = vp.controls;
      const fwd = new THREE.Vector3().subVectors(c.target, cam.position);
      if (vp.isOrtho) fwd.set(0, 0, 0); else fwd.setY(0).normalize();
      const rightV = vp.isOrtho ? new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion) : new THREE.Vector3(-fwd.z, 0, fwd.x);
      const upV = vp.isOrtho ? new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion) : new THREE.Vector3(0, 1, 0);
      const mv = new THREE.Vector3();
      if (keys.has('KeyW')) mv.add(vp.isOrtho ? upV : fwd); if (keys.has('KeyS')) mv.sub(vp.isOrtho ? upV : fwd);
      if (keys.has('KeyD')) mv.add(rightV); if (keys.has('KeyA')) mv.sub(rightV);
      if (rmbFly && !vp.isOrtho) { if (keys.has('KeyE')) mv.add(upV); if (keys.has('KeyQ')) mv.sub(upV); }
      if (mv.lengthSq()) { mv.normalize().multiplyScalar(dt * (keys.has('ShiftLeft') ? 40 : 16)); c.target.add(mv); cam.position.add(mv); }
    }
    vps.update(dt);
    for (let i = 0; i < tcs.length; i++) if (tcs[i].camera !== vps.list[i].camera) tcs[i].camera = vps.list[i].camera;
    view.sync();
    syncEntities();
    outliner.update();
    thumbs.pump(4);
    const focus = vps.list[0].controls.target;
    view.update(now, 0.4, focus);
    view.setXray(focus, mainCam.position, 0);
    weather.update(dt, focus);
    look.follow(focus, mainCam.position.distanceTo(focus));
    if (weather.flash > 0) look.hemi.intensity = world.sky.hemi + weather.flash * 4;
    if (level.spawn) {
      spawnMark.visible = show.icons;
      spawnMark.position.set(level.spawn[0], level.spawn[1], level.spawn[2]);
      spawnYawG.rotation.y = -THREE.MathUtils.degToRad(spawnYaw());
    } else spawnMark.visible = false;
    for (const o of entObjs.values()) o.icon.visible = show.icons;
    sunArrow.position.copy(focus).add(sunOffset(world, 10));
    view.decor.group.visible = show.decor;
    let nB = 0; if (show.stats && (fpsN === 1)) { nB = blockCount(); statEl.textContent = t('{b} blocks · {d} decor · {e} entities', { b: nB, d: level.decor.length, e: level.entities.length }); stCount.textContent = t('Mode: {mode} · undo {n}', { mode: MODE_TITLES[mode], n: undo.length }); }
    statEl.hidden = !show.stats;
    render();
  }

  /** Draw all visible viewports: each with its own camera, view and mode */
  function render(): void {
    const vis = vps.visible();
    const fog = scene.fog;
    const sun = { h: look.hemi.intensity, s: look.sun.intensity, a: look.ambient.intensity };
    for (const vp of vis) {
      vps.begin(vp);
      tcs.forEach((tc, i) => { tc.getHelper().visible = !!tc.object && i === vp.index; });
      const k = vp.kind;
      gridXZ.visible = show.grid && (k === 'persp' || k === 'top' || k === 'bottom');
      gridXY.visible = show.grid && (k === 'front' || k === 'back');
      gridZY.visible = show.grid && (k === 'left' || k === 'right');
      const tgt = vp.controls.target;
      gridXY.position.set(Math.round(tgt.x) - 0.5, Math.round(tgt.y), k === 'front' ? tgt.z - 150 : tgt.z + 150);
      gridZY.position.set(k === 'right' ? tgt.x - 150 : tgt.x + 150, Math.round(tgt.y), Math.round(tgt.z) - 0.5);
      weather.group.visible = show.weather && !vp.isOrtho;
      scene.fog = vp.isOrtho || !show.fog ? null : fog;
      if (vp.mode === 'wire') scene.overrideMaterial = wireMat;
      if (vp.mode === 'unlit') { look.hemi.intensity = 0; look.sun.intensity = 0; look.ambient.intensity = 3.1; }
      if (vp.index === 0 && !vp.isOrtho && vp.mode === 'lit' && world.post.enabled) {
        if (composerSize.w !== vp.rect.w || composerSize.h !== vp.rect.h) { composerSize.w = vp.rect.w; composerSize.h = vp.rect.h; look.setSize(vp.rect.w, vp.rect.h); }
        look.render();
      } else look.renderPlain(vp.camera);
      scene.overrideMaterial = null;
      look.hemi.intensity = sun.h; look.sun.intensity = sun.s; look.ambient.intensity = sun.a;
    }
    scene.fog = fog;
    renderer.setScissorTest(false);
  }
  const wireMat = new THREE.MeshBasicMaterial({ color: '#9fc6ff', wireframe: true });
  frame();

  // ---------- debug hook and tests ----------
  window.__malina = {
    mode: 'editor', get level() { return level; }, get view() { return view; }, camera: mainCam, get controls() { return vps.list[0].controls; }, setCurrent, edit: (x: number, y: number, z: number, n: string, r = 0) => edit(x, y, z, n, r),
    /** Editor mode: select, blocks, decor, landscape, place */
    get editMode() { return mode; }, setMode, setDecor, get selected() { return selected; },
    /** Where the current decor lands under the ray o → d (as under the cursor) */
    aimDecor(o: [number, number, number], d: [number, number, number]) { ray.ray.origin.set(...o); ray.ray.direction.set(...d).normalize(); return aim(null); },
    /** Place / remove an item through undo, like with the mouse */
    addDecor: (d: DecorItem) => addDecor(d), removeDecor: (d: DecorItem) => removeDecor(d), changeDecor,
    undo: doUndo, redo: doRedo,
    /** Landscape: parameters, place at a point, rebuild, random edges */
    land, placeLand, randomizeLand, removeLand, selectLand, get lands() { return lands(); }, get selectedLand() { return selLand; },
    /** Landscape under a cell (like clicking a piece with the mouse) */
    landAt: (x: number, y: number, z: number) => landAt([x, y, z]),
    /** Edit the selected piece: any parameters and the centre */
    editLand(params: Partial<LandParams>) { if (selLand) changeLand(selLand, { ...landParams(selLand), ...params }); },
    /** Selection and gizmo: select, rotate / nudge the selection, delete, duplicate */
    select: (list: Sel[]) => select(list), get selection() { return sel; }, rotateSel, nudgeSel, deleteSel, duplicateSel, setTool,
    /** Apply translation and rotation as if the gizmo was released: d — offset, q — [axis x|y|z, degrees] */
    gizmo(d: [number, number, number], q?: ['x' | 'y' | 'z', number]) {
      placePivot(); pivotStart.copy(pivot.matrix); pivotStartPos.copy(pivot.position);
      pivot.position.add(new THREE.Vector3(...d));
      if (q) pivot.quaternion.setFromAxisAngle(new THREE.Vector3(q[0] === 'x' ? 1 : 0, q[0] === 'y' ? 1 : 0, q[0] === 'z' ? 1 : 0), THREE.MathUtils.degToRad(q[1]));
      commitGizmo();
    },
    /** World settings and lights */
    get world() { return world; }, changeWorld, newLight, setSpawn, placePrefab: (id: string, x: number, y: number, z: number, quarter = 0) => { const p = prefabs.find((q) => q.id === id); placeRot = quarter; if (p) placePrefab(p, x, y, z); },
    get prefabs() { return prefabs; }, viewports: vps, setDoc, look, weather,
  };
}

declare global {
  interface Window { __malina?: unknown }
}
