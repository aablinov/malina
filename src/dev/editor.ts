import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { makeTextures, textureByName } from '../textures';
import { Level, type DecorItem, type LevelEntity, type LevelJSON } from '../level/level.ts';
import { LevelRenderer } from '../level/mesher';
import { BLOCKS, CATEGORIES, blockDef, type BlockDef } from '../level/palette.ts';
import { raycastVoxels } from '../level/collide.ts';
import { DIRS } from '../level/obj.ts';
import { MAPS, ROOMS } from '../level/maps';
import { buildFloor } from '../level/dungeon.ts';
import { DECOR, decorDef, decorEuler } from '../level/decor.ts';
import { decorMatrix } from '../level/decor-render.ts';
import { attachedTo, placeDecor, type DecorPlacement } from '../level/decor-place.ts';
import { GROUNDS, GROUND_TITLES, landscape } from '../level/kit.ts';
import type { Layer } from '../level/palette.ts';
import { Lighting } from '../lighting';
import { Weather } from '../weather';
import { LIGHT_DEFAULTS, WEATHER_TITLES, WORLD_DEFAULTS, WORLD_PRESETS, aimLight, lightData, makeLight, mergeWorld, setWorld, sunOffset, worldOf, type LightData, type WeatherKind, type WorldSettings } from '../world';
import { GROUPS, Thumbs, catalog, loadUserPrefabs, saveUserPrefabs, stampUser, type Prefab, type UserPrefab } from './editor/prefabs';
import { Outliner, type TreeNode } from './editor/outliner';
import { Viewports, type Viewport } from './editor/viewports';
import { PropGrid, closeMenus, h, icon, menuButton, popupMenu, splitter, type MenuItem } from './editor/ui';
import './editor.css';

/**
 * Редактор уровней в духе Unreal Engine (?dev=editor, F10 в плейграунде).
 * Карта — воксельная сетка (src/level/level.ts), блоки — палитра (src/level/palette.ts), формы — assets/blocks/*.obj.
 * Сохраняется в JSON (assets/maps/*.json) и в localStorage (автосохранение).
 *
 * Окно: строка меню и панель инструментов сверху; слева — «Префабы» (блоки, декор, сборки, свет, служебные, свои —
 * с разделами и поиском, тянутся мышью во вьюпорт); в центре — вьюпорты (один или четыре: перспектива, сверху, спереди,
 * сбоку) и вкладка «Оружие»; справа — «Аутлайнер» (дерево карты) и «Детали» / «Настройки мира» (солнце, небо и
 * глобальное освещение, дымка, погода, постобработка). Внизу — строка состояния.
 *
 * Режимы (Tab — по кругу): «Выделение» — ЛКМ выбирает блок, предмет, свет, точку появления (Shift — добавить, тянуть по
 * пустому — рамка), гизмо двигает и вращает выбранное по осям (W / E / R — перенос / поворот / размер, Q — без гизмо),
 * F — к выбранному, Del — убрать, Ctrl+D — копия, стрелки — сдвиг, ПКМ — меню. «Блоки» — кисть: ЛКМ — поставить,
 * Shift+ЛКМ — убрать, Ctrl+ЛКМ дважды — залить параллелепипед (с Shift — вырезать), Q — взять, R — повернуть,
 * [ ] и 1–9 — палитра. «Декор» — ЛКМ ставит предмет на пол, стену или потолок, ЛКМ по предмету — выбрать и тащить,
 * R / T / Y — поворот, наклон, крен на 15°, Z — случайный поворот, Ctrl+D — копия. «Ландшафт» — куски проходимого
 * рельефа (meta.lands): ползунки, «Случайно», стрелки — сдвиг, Del — убрать. «Поставить» — префаб из панели по клику.
 *
 * Камера: колесо — зум, СКМ или Alt+ЛКМ — вращать вокруг цели, ПКМ — двигать, ПКМ + WASD / QE — лететь,
 * в режимах кисти WASD двигает и без ПКМ. PgUp / PgDn — срез по высоте, G — сетка, Alt+X — развернуть вьюпорт.
 * Ctrl+Z / Ctrl+Y — отмена и повтор (свойства, свет и мир тоже), Ctrl+S — скачать JSON, Ctrl+O — открыть.
 */

export const EDITOR_STORAGE = 'malina.editor.level';
const QUICK = ['grass', 'dirt', 'stone', 'cobble', 'bricks', 'planks', 'log', 'leaves', 'water'];
const maps = MAPS;

interface BlockEdit { x: number; y: number; z: number; was: [string, number]; now: [string, number] }
/** Правка декора: before null — предмет добавлен, after null — убран, иначе — изменён (снимки полей) */
interface DecorEdit { decor: DecorItem; before: DecorItem | null; after: DecorItem | null }
/** Кусок ландшафта на карте (meta.lands): центр, параметры и клетки, которые он поменял, — [x, y, z, было, поворот, стало, поворот] */
interface LandPiece { x: number; y: number; z: number; w: number; d: number; layers: number; scale: number; stone: number; seed: number; /** Земля (GROUNDS): нет поля — трава */ ground?: string; cells: [number, number, number, string, number, string, number][] }
type LandParams = Omit<LandPiece, 'cells'>;
/** Правка куска ландшафта: снимки записи до и после (null — куска нет) */
interface LandEdit { land: LandPiece; before: LandPiece | null; after: LandPiece | null }
/** Правка свойств (мир, свет, точка появления): как отменить и повторить; подряд идущие с одним key сливаются */
interface PropEdit { key: string; t: number; undo: () => void; redo: () => void }
type Edit = BlockEdit | DecorEdit | LandEdit | PropEdit;
const snapDecor = (d: DecorItem): DecorItem => JSON.parse(JSON.stringify(d)) as DecorItem;
const snapLand = (p: LandPiece): LandPiece => JSON.parse(JSON.stringify(p)) as LandPiece;
const landParams = ({ cells: _, ...p }: LandPiece): LandParams => p;
/** Прямоугольник куска: x0, z0, x1, z1 и верх рамки по высоте */
const landRect = (p: LandParams): [number, number, number, number, number] => {
  const x0 = p.x - Math.floor(p.w / 2), z0 = p.z - Math.floor(p.d / 2);
  return [x0, z0, x0 + p.w - 1, z0 + p.d - 1, p.y + Math.ceil(p.layers / 2) + 2];
};

type Mode = 'select' | 'blocks' | 'decor' | 'land' | 'place';
type Tool = 'select' | 'translate' | 'rotate' | 'scale';
type WorldPart = 'sun' | 'sky' | 'fog' | 'weather' | 'post';
/** Что выделено: блок, предмет декора, свет, точка появления, кусок ландшафта, раздел мира */
type Sel =
  | { t: 'block'; x: number; y: number; z: number }
  | { t: 'decor'; d: DecorItem }
  | { t: 'light'; e: LevelEntity }
  | { t: 'spawn' }
  | { t: 'land'; p: LandPiece }
  | { t: 'world'; part: WorldPart };

const MODE_TITLES: Record<Mode, string> = { select: 'Выделение', blocks: 'Блоки', decor: 'Декор', land: 'Ландшафт', place: 'Поставить' };
const MODE_ICONS: Record<Mode, string> = { select: 'select', blocks: 'brush', decor: 'decor', land: 'land', place: 'prefab' };
const WORLD_PARTS: [WorldPart, string, string, string][] = [
  ['sun', 'Солнце', 'sun', 'DirectionalLight'],
  ['sky', 'Небо и глобальный свет', 'sky', 'SkyLight'],
  ['fog', 'Дымка', 'fog', 'HeightFog'],
  ['weather', 'Погода', 'rain', 'Weather'],
  ['post', 'Постобработка', 'post', 'PostProcessVolume'],
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
  // свет «как в Unreal» (src/lighting.ts) с настройками мира карты (src/world.ts) и погода — как в игре
  const look = new Lighting(renderer, scene, mainCam);
  const weather = new Weather(scene);

  const T = makeTextures();
  let level = loadInitial();
  let view = new LevelRenderer(scene, level, T);
  let world = worldOf(level);

  // ---------- окно ----------
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

  // ---------- состояние ----------
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
  /** Ландшафт для нового куска: размеры, слои по 0,5 м, крупность плит, доля камня (%), зерно шума — от него изгибы краёв и углов */
  const land: { w: number; d: number; layers: number; scale: number; stone: number; seed: number; ground: string } = { w: 24, d: 18, layers: 4, scale: 22, stone: 30, seed: 1, ground: 'grass' };
  /** Выбранный кусок — его правят ползунки, «Случайно», стрелки и Del; live — последняя правка куска, к ней сливаются следующие */
  let selLand: LandPiece | null = null, hoverLand: LandPiece | null = null;
  let live: { piece: LandPiece; batch: Edit[] } | null = null;
  let curDecor = DECOR[0].name;
  /** Поворот пользователя: [рыск, наклон, крен], градусы */
  const dRot = [0, 0, 0];
  let randomYaw = false, randYaw = 0;
  let placement: DecorPlacement | null = null;
  let hoverDecor: DecorItem | null = null, selected: DecorItem | null = null;
  let moving: { item: DecorItem; before: DecorItem } | null = null;
  /** Выделение в режиме «Выделение» */
  let sel: Sel[] = [];
  /** Префаб для режима «Поставить» */
  let curPrefab: Prefab | null = null;
  /** Поворот пресета в режиме «Поставить», четверти (R) */
  let placeRot = 0;
  /** Шаг сетки и угла для гизмо */
  const snap = { grid: true, gridStep: 1, rotOn: true, rotStep: 15 };
  /** Флаги «Показать» */
  const show = { grid: true, icons: true, decor: true, weather: true, fog: true, stats: true };
  let entVersion = 0;
  let userPrefabs = loadUserPrefabs();
  let prefabs = catalog(userPrefabs);
  const thumbs = new Thumbs(T);

  // ---------- строка меню ----------
  const mbtn = (label: string, items: () => MenuItem[]) => menuButton(h('button.ue-mb', { text: label }), items);
  const nameInput = h('input.ue-mapname', { spellcheck: 'false', title: 'Имя карты' });
  nameInput.addEventListener('input', () => { level.name = nameInput.value; dirtyAutosave = true; outliner.invalidate(); docTabs.querySelector('.lvl span')!.textContent = level.name; });
  nameInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') nameInput.blur(); });
  menubar.append(
    h('span.ue-logo', { html: '<b>M</b>' }),
    mbtn('Файл', () => [
      { label: 'Новая карта', icon: 'plus', action: newMap },
      { label: 'Открыть JSON…', icon: 'folder', shortcut: 'Ctrl+O', action: open },
      { label: 'Скачать JSON', icon: 'save', shortcut: 'Ctrl+S', action: save },
      { sep: true },
      { label: 'Встроенные карты', icon: 'world', sub: () => Object.keys(maps).sort().map((p) => ({ label: `${maps[p].name}  ·  ${p}`, action: () => { setLevel(Level.fromJSON(maps[p])); toast(`Открыта «${level.name}»`); } })) },
      { label: 'Этаж подземелья…', icon: 'grid', action: floorDialog },
      { sep: true },
      { label: 'Играть на этой карте', icon: 'play', shortcut: 'F5', action: play },
    ]),
    mbtn('Правка', () => [
      { label: 'Отменить', icon: 'undo', shortcut: 'Ctrl+Z', disabled: !undo.length, action: doUndo },
      { label: 'Повторить', icon: 'redo', shortcut: 'Ctrl+Y', disabled: !redo.length, action: doRedo },
      { sep: true },
      { label: 'Дублировать', icon: 'copy', shortcut: 'Ctrl+D', disabled: !sel.length, action: duplicateSel },
      { label: 'Удалить', icon: 'trash', shortcut: 'Del', disabled: !sel.length, action: deleteSel },
      { label: 'Снять выделение', shortcut: 'Esc', action: () => select([]) },
      { label: 'Выделить все такие блоки', disabled: !sel.some((s) => s.t === 'block'), action: selectSameBlocks },
      { sep: true },
      { label: 'Создать префаб из выделения…', icon: 'prefab', disabled: !sel.length, action: makePrefab },
    ]),
    mbtn('Вид', () => [
      { head: 'Раскладка вьюпортов' },
      { label: 'Один вьюпорт', icon: 'layout1', checked: vps.layout === 'one', action: () => vps.setLayout('one') },
      { label: 'Два рядом', icon: 'layout2', checked: vps.layout === 'two', action: () => vps.setLayout('two') },
      { label: 'Четыре вида', icon: 'layout4', checked: vps.layout === 'four', action: () => vps.setLayout('four') },
      { sep: true },
      ...showItems(),
      { sep: true },
      { label: 'Турель: сцена вращается', icon: 'turntable', checked: vps.list[0].controls.autoRotate, action: () => { const c = vps.list[0].controls; c.autoRotate = !c.autoRotate; } },
      { label: 'К выделенному', icon: 'focus', shortcut: 'F', action: focusSel },
      { label: 'Показать всю карту', icon: 'world', shortcut: 'Home', action: frameAll },
    ]),
    mbtn('Окно', () => [
      { label: 'Префабы', icon: 'prefab', checked: !left.hidden, action: () => { left.hidden = !left.hidden; root.classList.toggle('no-left', left.hidden); } },
      { label: 'Аутлайнер и детали', icon: 'world', checked: !right.hidden, action: () => { right.hidden = !right.hidden; root.classList.toggle('no-right', right.hidden); } },
      { label: 'Настройки мира', icon: 'sun', action: () => setDetTab('world') },
      { label: 'Оружие', icon: 'weapon', action: () => setDoc('weapons') },
      { label: 'Журнал', icon: 'info', action: showLog },
    ]),
    mbtn('Справка', () => [{ label: 'Горячие клавиши', icon: 'info', shortcut: 'F1', action: showHelp }]),
    h('span.ue-grow'),
    nameInput,
    h('span.ue-proj', { text: 'Малина' }),
  );

  // ---------- панель инструментов ----------
  const tb = (iconName: string, title: string, fn: () => void, label = '') => {
    const b = h('button.ue-tb', { html: `${icon(iconName)}${label ? `<span>${label}</span>` : ''}`, title });
    b.addEventListener('click', () => { fn(); b.blur(); });
    return b;
  };
  const modeBtn = h('button.ue-tb.ue-tb-mode');
  menuButton(modeBtn, () => (Object.keys(MODE_TITLES) as Mode[]).map((m, i) => ({ label: MODE_TITLES[m], icon: MODE_ICONS[m], shortcut: `Shift+${i + 1}`, checked: mode === m, action: () => setMode(m) })));
  const toolBtns: Record<Tool, HTMLButtonElement> = {
    select: tb('select', 'Только выделение (Q)', () => setTool('select')),
    translate: tb('move', 'Перенос (W)', () => setTool('translate')),
    rotate: tb('rotate', 'Поворот по осям (E)', () => setTool('rotate')),
    scale: tb('scale', 'Размер (R): ландшафт, дальность света', () => setTool('scale')),
  };
  const gridBtn = h('button.ue-tb.ue-snap', { title: 'Привязка к сетке' });
  gridBtn.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('.v')) return; snap.grid = !snap.grid; refreshToolbar(); });
  const gridVal = h('span.v');
  menuButton(gridVal, () => [1 / 16, 1 / 8, 0.25, 0.5, 1, 2].map((v) => ({ label: `${v < 1 ? `1/${1 / v}` : v} м`, checked: snap.gridStep === v, action: () => { snap.gridStep = v; snap.grid = true; refreshToolbar(); } })));
  gridBtn.append(h('span', { html: icon('grid') }), gridVal);
  const rotBtn = h('button.ue-tb.ue-snap', { title: 'Привязка угла' });
  rotBtn.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('.v')) return; snap.rotOn = !snap.rotOn; refreshToolbar(); });
  const rotVal = h('span.v');
  menuButton(rotVal, () => [5, 15, 30, 45, 90].map((v) => ({ label: `${v}°`, checked: snap.rotStep === v, action: () => { snap.rotStep = v; snap.rotOn = true; refreshToolbar(); } })));
  rotBtn.append(h('span', { html: icon('angle') }), rotVal);
  const envBtn = h('button.ue-tb', { html: `${icon('sun')}<span>Окружение</span>`, title: 'Готовые наборы света и погоды' });
  menuButton(envBtn, () => [
    { head: 'Набор' },
    ...Object.entries(WORLD_PRESETS).map(([, p]) => ({ label: p.title, action: () => { changeWorld((w) => Object.assign(w, mergeWorld(WORLD_DEFAULTS, p.patch)), 'preset'); toast(`Окружение: ${p.title}`); } })),
    { sep: true },
    { head: 'Погода' },
    ...(Object.keys(WEATHER_TITLES) as WeatherKind[]).map((k) => ({ label: WEATHER_TITLES[k], checked: world.weather.kind === k, action: () => changeWorld((w) => { w.weather.kind = k; }) })),
    { sep: true },
    { label: 'Настройки мира…', icon: 'world', action: () => setDetTab('world') },
  ]);
  const playBtn = h('button.ue-tb.ue-play', { html: `${icon('play')}<span>Играть</span>`, title: 'Открыть игру с этой картой (F5)' });
  playBtn.addEventListener('click', play);
  const statEl = h('span.ue-tb-stat');
  toolbar.append(
    tb('save', 'Скачать JSON (Ctrl+S)', save),
    h('span.ue-sep'),
    modeBtn,
    h('span.ue-sep'),
    toolBtns.select, toolBtns.translate, toolBtns.rotate, toolBtns.scale,
    h('span.ue-sep'),
    gridBtn, rotBtn,
    h('span.ue-sep'),
    tb('undo', 'Отменить (Ctrl+Z)', () => doUndo()), tb('redo', 'Повторить (Ctrl+Y)', () => doRedo()),
    h('span.ue-sep'),
    tb('prefab', 'Создать префаб из выделения', () => makePrefab(), 'Префаб'),
    envBtn,
    tb('weapon', 'Оружие: превью и баланс', () => setDoc('weapons'), 'Оружие'),
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

  // ---------- вкладки документов: уровень и оружие ----------
  let doc: 'level' | 'weapons' = 'level';
  let weaponsPanel: { show(): void; hide(): void } | null = null;
  docTabs.append(
    h('div.ue-doctab.lvl.on', { html: `${icon('world')}<span></span>`, onclick: () => setDoc('level') }),
    h('div.ue-doctab.wpn', { html: `${icon('weapon')}<span>Оружие</span>`, onclick: () => setDoc('weapons') }),
  );
  function setDoc(d: 'level' | 'weapons'): void {
    doc = d;
    docTabs.querySelector('.lvl')!.classList.toggle('on', d === 'level');
    docTabs.querySelector('.wpn')!.classList.toggle('on', d === 'weapons');
    vps.el.hidden = d !== 'level';
    // оружие — отдельный редактор ассета: панели уровня прячем, ему вся ширина
    root.classList.toggle('doc-weapons', d === 'weapons');
    weaponsHost.hidden = d !== 'weapons';
    if (d === 'weapons') {
      if (!weaponsPanel) {
        weaponsHost.textContent = 'Загрузка…';
        void import('./editor/weapons-panel').then((m) => { weaponsHost.textContent = ''; weaponsPanel = m.mountWeaponsPanel(weaponsHost); if (doc === 'weapons') weaponsPanel.show(); })
          .catch((e: Error) => { weaponsHost.textContent = `Панель оружия не загрузилась: ${e.message}`; });
      } else weaponsPanel.show();
    } else { weaponsPanel?.hide(); vps.resize(); }
  }

  // ---------- левая панель: инструменты режима и префабы ----------
  const modeTools = h('div.ue-modetools');
  const pfTabs = h('div.ue-pf-tabs');
  const pfSearch = h('input.ue-search', { type: 'search', placeholder: 'Поиск префабов…', spellcheck: 'false' });
  const pfList = h('div.ue-pf-list');
  let pfGroup: string = 'Все';
  left.append(h('div.ue-panel-h', { html: `${icon('prefab')}<span>Префабы</span>` }), modeTools, pfTabs, h('div.ue-pf-search', {}, h('span.ue-search-ic', { html: icon('search') }), pfSearch), pfList);
  pfSearch.addEventListener('input', () => drawPrefabs());
  pfSearch.addEventListener('keydown', (e) => e.stopPropagation());
  for (const g of GROUPS) pfTabs.append(h('button.ue-chip', { text: g, 'data-g': g, onclick: () => { pfGroup = g; drawPrefabs(); } }));
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
    const list = prefabs.filter((p) => (pfGroup === 'Все' || p.group === pfGroup) && (!q || `${p.title} ${p.name ?? ''} ${p.category} ${p.group}`.toLowerCase().includes(q)));
    pfList.textContent = '';
    let lastCat = '';
    for (const p of list) {
      const cat = `${p.group} · ${p.category}`;
      if (cat !== lastCat) { pfList.append(h('div.ue-pf-cat', { text: pfGroup === 'Все' ? cat : p.category })); lastCat = cat; }
      const on = (mode === 'blocks' && p.kind === 'block' && p.name === current) || (mode === 'decor' && p.kind === 'decor' && p.name === curDecor) || (mode === 'place' && curPrefab?.id === p.id);
      const tile = h('div.ue-pf', { draggable: 'true', title: `${p.title}${p.name ? ` · ${p.name}` : ''}\n${p.hint ?? ''}\nКлик — выбрать, тянуть — поставить во вьюпорте` });
      if (on) tile.classList.add('on');
      tile.append(
        p.icon ? h('span.ue-pf-ic', { html: icon(p.icon) }) : h('img', { src: thumbOf(p), alt: '', 'data-id': p.id }),
        h('span.ue-pf-t', { text: p.title }),
      );
      tile.addEventListener('click', () => pickPrefab(p));
      tile.addEventListener('dragstart', (e) => { e.dataTransfer!.setData('text/x-malina-prefab', p.id); e.dataTransfer!.effectAllowed = 'copy'; });
      tile.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const items: MenuItem[] = [{ label: 'Выбрать', action: () => pickPrefab(p) }];
        if (p.kind === 'user') items.push({ label: 'Сохранить в библиотеку (JSON)', icon: 'save', action: () => exportPrefab(p.user!) });
        if (p.kind === 'user') items.push({ label: 'Удалить префаб', icon: 'trash', action: () => { userPrefabs = userPrefabs.filter((u) => u !== p.user); saveUserPrefabs(userPrefabs); prefabs = catalog(userPrefabs); drawPrefabs(); } });
        popupMenu(e.clientX, e.clientY, items);
      });
      pfList.append(tile);
    }
    if (!list.length) pfList.append(h('div.ue-empty', { text: pfGroup === 'Мои префабы' ? 'Пусто. Выдели блоки и декор — «Создать префаб из выделения».' : 'Ничего не нашлось' }));
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
      modeTools.append(head('select', n ? `Выбрано: ${n}` : 'Выделение', n ? selSummary() : 'ЛКМ — выбрать · Shift — добавить · рамка по пустому'));
    } else if (mode === 'blocks') {
      const d = blockDef(current);
      modeTools.append(head('block', d.title, `${d.name}${d.rotatable ? ` · поворот ${rot * 90}° (R)` : ''} · срез y ≤ ${maxY}`, thumbs.get(prefabs.find((p) => p.id === `block:${current}`)!) ?? texThumb(d)));
    } else if (mode === 'decor') {
      const d = decorDef(curDecor);
      const r = dRot.some(Boolean) ? ` · ${dRot.join('° / ')}°` : '';
      modeTools.append(head('decor', d.title, `${d.name}${r}${randomYaw ? ' · случайный поворот' : ''}${selected ? ` · выбран: ${decorDef(selected.name).title}` : ''}`, thumbs.get(prefabs.find((p) => p.id === `decor:${curDecor}`)!)));
    } else if (mode === 'place') {
      modeTools.append(head(curPrefab?.icon ?? 'prefab', curPrefab?.title ?? 'Выбери префаб', curPrefab ? `${curPrefab.hint ?? ''}${curPrefab.kind === 'lib' || curPrefab.kind === 'user' ? ` · поворот ${placeRot * 90}°` : ''} · ЛКМ — поставить` : 'клик по префабу ниже', curPrefab && !curPrefab.icon ? thumbs.get(curPrefab) : undefined));
    } else {
      const p = selLand ?? land;
      modeTools.append(head('land', selLand ? `Кусок в ${selLand.x}, ${selLand.y}, ${selLand.z}` : 'Новый кусок ландшафта', `${p.w} × ${p.d} м · ${p.layers} слоёв (${p.layers / 2} м) · зерно ${p.seed}`));
      const g = new PropGrid();
      g.section('Ландшафт — проходим отовсюду', 'land');
      const ln = (label: string, key: Exclude<keyof typeof land, 'ground'>, min: number, max: number, step = 1) =>
        g.num(label, () => (selLand ?? land)[key], (v) => setLandParam(key, Math.round(v)), { min, max, step, slider: true });
      ln('Размер X', 'w', 6, 64); ln('Размер Z', 'd', 6, 64); ln('Слои × 0,5 м', 'layers', 1, 10); ln('Крупность', 'scale', 8, 40); ln('Камень, %', 'stone', 0, 80, 5);
      g.text('Земля', () => GROUND_TITLES[(selLand ?? land).ground ?? 'grass'] ?? 'Трава', () => {}, true);
      g.buttons(...Object.keys(GROUNDS).map((k): [string, () => void, string?] => [GROUND_TITLES[k] ?? k, () => setLandGround(k), 'land']));
      g.buttons(['Случайно: края и углы', () => { randomizeLand(); toast('Новые края и углы'); }, 'turntable']);
      g.note('ЛКМ по земле — поставить, ЛКМ по куску — выбрать, Shift+ЛКМ — новый поверх. Стрелки — сдвиг, Del — убрать, Esc — снять выбор.');
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

  // ---------- правая панель: аутлайнер ----------
  const ICON_OF_BLOCK = (b: BlockDef) => (b.light || b.bakedLight ? 'light' : 'block');
  const outliner = new Outliner({
    roots: () => outlineRoots(),
    isSelected: (id) => selIds.has(id),
    onSelect: (n, e) => outlinerSelect(n, e.shiftKey || e.ctrlKey || e.metaKey),
    onDbl: (n) => { outlinerSelect(n, false); focusSel(); },
    onContext: (n, e) => { if (!selIds.has(n.id)) outlinerSelect(n, false); popupMenu(e.clientX, e.clientY, contextItems()); },
  });
  outlPanel.append(h('div.ue-panel-h', { html: `${icon('world')}<span>Аутлайнер</span>` }), outliner.el);
  /** Узлы дерева → выделение */
  const nodeSel = new Map<string, Sel[]>();
  let selIds = new Set<string>();
  const selId = (s: Sel): string => s.t === 'block' ? `b:${s.x},${s.y},${s.z}` : s.t === 'decor' ? `d:${level.decor.indexOf(s.d)}` : s.t === 'light' ? `l:${level.entities.indexOf(s.e)}` : s.t === 'land' ? `n:${lands().indexOf(s.p)}` : s.t === 'world' ? `w:${s.part}` : 'spawn';
  function outlineRoots(): TreeNode[] {
    nodeSel.clear();
    const node = (id: string, label: string, ic: string, type: string, s: Sel[] | null, extra: Partial<TreeNode> = {}): TreeNode => { if (s) nodeSel.set(id, s); return { id, label, icon: ic, type, ...extra }; };
    const lights = level.entities.filter((e) => e.kind === 'light');
    // блоки по типам: тип → клетки (до 400 на тип)
    const byType = new Map<string, [number, number, number][]>();
    let nBlocks = 0;
    level.forEach((x, y, z, id) => { const n = level.palette[id]; let a = byType.get(n); if (!a) byType.set(n, a = []); a.push([x, y, z]); nBlocks++; });
    const decorBy = new Map<string, DecorItem[]>();
    for (const d of level.decor) { const c = decorDef(d.name).category; let a = decorBy.get(c); if (!a) decorBy.set(c, a = []); a.push(d); }
    return [node('root', level.name || 'Без имени', 'world', 'World', null, {
      kids: () => [
        node('world', 'Окружение', 'sun', 'Folder', WORLD_PARTS.map(([part]) => ({ t: 'world', part }) as Sel), {
          kids: () => WORLD_PARTS.map(([part, title, ic, type]) => node(`w:${part}`, part === 'weather' ? `${title}: ${WEATHER_TITLES[world.weather.kind]}` : title, ic, type, [{ t: 'world', part }],
            part === 'fog' ? { eye: { get: () => show.fog, set: (v) => { show.fog = v; } } } : part === 'weather' ? { eye: { get: () => show.weather, set: (v) => { show.weather = v; } } } : {})),
        }),
        node('spawn', 'Точка появления', 'flag', 'PlayerStart', level.spawn ? [{ t: 'spawn' }] : null),
        node('lights', 'Свет', 'light', 'Folder', lights.map((e) => ({ t: 'light', e }) as Sel), {
          count: lights.length, eye: { get: () => show.icons, set: (v) => { show.icons = v; } },
          kids: () => lights.map((e) => { const d = lightData(e.data); return node(`l:${level.entities.indexOf(e)}`, d.name || (d.type === 'spot' ? 'Прожектор' : 'Точечный свет'), d.type === 'spot' ? 'spot' : 'light', d.type === 'spot' ? 'SpotLight' : 'PointLight', [{ t: 'light', e }]); }),
        }),
        node('lands', 'Ландшафт', 'land', 'Folder', lands().map((p) => ({ t: 'land', p }) as Sel), {
          count: lands().length,
          kids: () => lands().map((p, i) => node(`n:${i}`, `Кусок ${p.w} × ${p.d}, ${p.layers} слоёв`, 'land', 'Landscape', [{ t: 'land', p }])),
        }),
        node('decor', 'Декор', 'decor', 'Folder', null, {
          count: level.decor.length, eye: { get: () => show.decor, set: (v) => { show.decor = v; } },
          kids: () => [...decorBy].map(([cat, items]) => node(`dc:${cat}`, cat, 'folder', 'Folder', items.map((d) => ({ t: 'decor', d }) as Sel), {
            count: items.length,
            kids: () => items.map((d) => node(`d:${level.decor.indexOf(d)}`, decorDef(d.name).title, 'decor', 'Decor', [{ t: 'decor', d }])),
          })),
        }),
        node('blocks', 'Блоки', 'cube', 'Folder', null, {
          count: nBlocks,
          kids: () => [...byType].sort((a, b) => b[1].length - a[1].length).map(([name, cells]) => {
            const def = blockDef(name);
            return node(`bt:${name}`, def.title, ICON_OF_BLOCK(def), 'BlockType', null, {
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

  // ---------- правая панель: детали и настройки мира ----------
  const detTabs = h('div.ue-tabs');
  const detBody = h('div.ue-det-body');
  let detTab: 'details' | 'world' = 'details';
  detTabs.append(
    h('div.ue-tab.on', { 'data-t': 'details', html: `${icon('info')}<span>Детали</span>`, onclick: () => setDetTab('details') }),
    h('div.ue-tab', { 'data-t': 'world', html: `${icon('world')}<span>Настройки мира</span>`, onclick: () => setDetTab('world') }),
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
      g.section('Карта', 'world')
        .text('Имя', () => level.name, (v) => { level.name = v; nameInput.value = v; dirtyAutosave = true; outliner.invalidate(); })
        .info('Размер', () => b ? `${b.maxX - b.minX + 1} × ${b.maxY - b.minY + 1} × ${b.maxZ - b.minZ + 1} м` : 'пусто')
        .info('Содержимое', () => `${blockCount()} блоков · ${level.decor.length} декора · ${level.entities.filter((e) => e.kind === 'light').length} света · ${lands().length} ландшафта`)
        .note('Выбери объект во вьюпорте или в аутлайнере — здесь появятся его настройки. Окружение — во вкладке «Настройки мира».');
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
      g.section('Выделение', 'select').info('Объекты', () => selSummary());
      g.buttons(['К выделенному', focusSel, 'focus'], ['Дублировать', duplicateSel, 'copy'], ['Удалить', deleteSel, 'trash']);
      g.buttons(['Создать префаб', makePrefab, 'prefab']);
    }
    g.refresh();
  }

  function blockDetails(g: PropGrid): void {
    const cells = sel.filter((s): s is Extract<Sel, { t: 'block' }> => s.t === 'block');
    const one = cells.length === 1 ? cells[0] : null;
    if (one) {
      g.section('Трансформация', 'move')
        .vec3('Положение', () => [one.x, one.y, one.z], (v) => moveCells([one], [Math.round(v[0]) - one.x, Math.round(v[1]) - one.y, Math.round(v[2]) - one.z]), { step: 1 })
        .select('Поворот', [['0', '0°'], ['1', '90°'], ['2', '180°'], ['3', '270°']], () => String(level.rotAt(one.x, one.y, one.z)) as '0', (v) => { beginBatch(); edit(one.x, one.y, one.z, level.nameAt(one.x, one.y, one.z), Number(v)); endBatch(); });
    } else {
      g.section('Выделение', 'select').info('Блоков', () => String(cells.length));
      g.buttons(['Повернуть 90° вокруг Y', () => rotateSel('y'), 'rotate'], ['вокруг X', () => rotateSel('x')], ['вокруг Z', () => rotateSel('z')]);
    }
    const names = [...new Set(cells.map((c) => level.nameAt(c.x, c.y, c.z)))];
    const def = blockDef(names[0]);
    g.section('Блок', 'cube')
      .select('Тип', blockOptions(), () => (names.length === 1 ? names[0] : '') , (v) => { beginBatch(); for (const c of cells) edit(c.x, c.y, c.z, v, level.rotAt(c.x, c.y, c.z)); endBatch(); toast(`Заменено: ${cells.length}`); buildDetails(); })
      .info('Категория', () => names.length === 1 ? def.category : `${names.length} типов`)
      .info('Столкновение', () => names.length === 1 ? (def.collide ? `${def.collide} м` : 'проходим') : '—')
      .info('Свойства', () => names.length === 1 ? [def.full && 'полный куб', def.rotatable && 'поворачивается', def.stairs && 'ступени', def.light && 'светит', def.bakedLight && 'запечённый свет', def.natural && 'природная земля'].filter(Boolean).join(' · ') || '—' : '—');
    g.buttons(['Взять в кисть', () => { setCurrent(names[0]); toast(`Кисть: ${def.title}`); }, 'brush'], ['Все такие', selectSameBlocks, 'select']);
    g.buttons(['К выделенному', focusSel, 'focus'], ['Дублировать', duplicateSel, 'copy'], ['Удалить', deleteSel, 'trash']);
  }
  function blockOptions(): [string, string][] {
    const out: [string, string][] = [['', '— разные —']];
    for (const cat of CATEGORIES) for (const b of BLOCKS) if (b.category === cat && b.name !== 'air') out.push([b.name, `${cat}: ${b.title}`]);
    return out;
  }
  function decorDetails(g: PropGrid): void {
    const items = sel.filter((s): s is Extract<Sel, { t: 'decor' }> => s.t === 'decor').map((s) => s.d);
    const d = items[0];
    if (items.length === 1) {
      g.section('Трансформация', 'move')
        .vec3('Положение', () => [...d.pos] as [number, number, number], (v) => changeDecor(d, (x) => { x.pos = v.map((n) => Math.round(n * 16) / 16) as [number, number, number]; delete x.on; }, 'decor-pos'), { step: 1 / 16, digits: 3 })
        .vec3('Поворот, °', () => [d.rot?.[0] ?? 0, d.rot?.[1] ?? 0, d.rot?.[2] ?? 0], (v) => changeDecor(d, (x) => setDecorRot(x, v), 'decor-rot'), { step: 1, digits: 1 })
        .note('Поворот: X — рыск (вокруг вертикали), Y — наклон, Z — крен');
    } else g.section('Выделение', 'select').info('Предметов', () => String(items.length));
    const def = decorDef(d.name);
    g.section('Декор', 'decor')
      .select('Тип', DECOR.map((x) => [x.name, `${x.category}: ${x.title}`] as [string, string]), () => d.name, (v) => { for (const it of items) changeDecor(it, (x) => { x.name = v; }); buildDetails(); })
      .info('Крепление', () => def.anchor === 'floor' ? 'на пол' : def.anchor === 'wall' ? 'на стену' : 'к потолку')
      .info('Опора', () => d.on ? `клетка ${d.on.join(', ')} — стёрли её, уйдёт и предмет` : 'свободно')
      .info('Свет', () => def.light ? `${def.light.baked ? 'запечённый' : 'настоящий'}, ${def.light.intensity} × ${def.light.dist} м` : 'нет')
      .info('Столкновение', () => def.solid ? def.solid.map((b) => `${b.w}×${b.d}×${b.h}`).join(', ') : 'нет');
    g.buttons(['Взять в кисть', () => { setDecor(d.name); setMode('decor'); }, 'brush'], ['К выделенному', focusSel, 'focus']);
    g.buttons(['Дублировать', duplicateSel, 'copy'], ['Удалить', deleteSel, 'trash']);
  }
  function lightDetails(g: PropGrid): void {
    const ents = sel.filter((s): s is Extract<Sel, { t: 'light' }> => s.t === 'light').map((s) => s.e);
    const e = ents[0];
    const d = () => lightData(e.data);
    const setD = (fn: (d: LightData) => void, key: string) => { for (const x of ents) changeEnt(x, (en) => { const ld = lightData(en.data); fn(ld); en.data = { ...ld }; }, key); };
    if (ents.length === 1) {
      g.section('Трансформация', 'move')
        .vec3('Положение', () => [e.x, e.y, e.z], (v) => changeEnt(e, (en) => { en.x = v[0]; en.y = v[1]; en.z = v[2]; }, 'light-pos'), { step: 0.25, digits: 2 });
    }
    g.section('Свет', 'light')
      .text('Имя', () => d().name ?? '', (v) => setD((x) => { x.name = v || undefined; }, 'light-name'))
      .select('Тип', [['point', 'Точечный'], ['spot', 'Прожектор']], () => d().type, (v) => { setD((x) => { x.type = v; }, 'light-type'); buildDetails(); })
      .color('Цвет', () => d().color, (v) => setD((x) => { x.color = v; }, 'light-color'))
      .num('Яркость', () => d().intensity, (v) => setD((x) => { x.intensity = v; }, 'light-i'), { min: 0, max: 40, step: 0.1, slider: true })
      .num('Дальность, м', () => d().distance, (v) => setD((x) => { x.distance = v; }, 'light-dist'), { min: 1, max: 40, step: 0.5, slider: true })
      .bool('Тени', () => d().shadows, (v) => setD((x) => { x.shadows = v; }, 'light-sh'));
    if (d().type === 'spot') {
      g.num('Конус, °', () => d().angle, (v) => setD((x) => { x.angle = v; }, 'light-angle'), { min: 5, max: 85, step: 1, slider: true })
        .num('Рыск, °', () => e.rot ?? 0, (v) => { for (const x of ents) changeEnt(x, (en) => { en.rot = v; }, 'light-yaw'); }, { min: -180, max: 180, step: 1, slider: true })
        .num('Наклон, °', () => d().pitch, (v) => setD((x) => { x.pitch = v; }, 'light-pitch'), { min: -90, max: 45, step: 1, slider: true });
    }
    g.buttons(['К выделенному', focusSel, 'focus'], ['Дублировать', duplicateSel, 'copy'], ['Удалить', deleteSel, 'trash']);
  }
  function spawnDetails(g: PropGrid): void {
    const sp = level.spawn!;
    g.section('Точка появления', 'flag')
      .vec3('Положение', () => [sp[0], sp[1], sp[2]], (v) => setSpawn([Math.round(v[0]), Math.round(v[1]), Math.round(v[2])], spawnYaw()), { step: 1 })
      .num('Взгляд, °', () => spawnYaw(), (v) => setSpawn(level.spawn!, v), { min: -180, max: 180, step: 15, slider: true })
      .note('Герой появляется в этой клетке и смотрит по стрелке. P в режиме «Блоки» — поставить под курсором.');
    g.buttons(['К точке', focusSel, 'focus'], ['Играть отсюда', play, 'play']);
  }
  function landDetails(g: PropGrid, p: LandPiece): void {
    const set = (k: keyof LandParams, v: number) => changeLand(p, { ...landParams(p), [k]: Math.round(v) });
    g.section('Трансформация', 'move')
      .vec3('Центр', () => [p.x, p.y, p.z], (v) => changeLand(p, { ...landParams(p), x: Math.round(v[0]), y: Math.round(v[1]), z: Math.round(v[2]) }), { step: 1 });
    g.section('Ландшафт', 'land')
      .num('Размер X', () => p.w, (v) => set('w', v), { min: 6, max: 64, step: 1, slider: true })
      .num('Размер Z', () => p.d, (v) => set('d', v), { min: 6, max: 64, step: 1, slider: true })
      .num('Слои × 0,5 м', () => p.layers, (v) => set('layers', v), { min: 1, max: 10, step: 1, slider: true })
      .num('Крупность', () => p.scale, (v) => set('scale', v), { min: 8, max: 40, step: 1, slider: true })
      .num('Камень, %', () => p.stone, (v) => set('stone', v), { min: 0, max: 80, step: 5, slider: true })
      .info('Клеток', () => String(p.cells.length));
    g.buttons(['Случайно: края и углы', () => set('seed', 1 + Math.floor(Math.random() * 1e6)), 'turntable'], ['Удалить', () => { removeLand(p); select([]); }, 'trash']);
  }
  /** Разделы настроек мира; all — вкладка «Настройки мира» (с наборами), иначе — выбранные узлы аутлайнера */
  function worldSections(g: PropGrid, parts: WorldPart[], all: boolean): void {
    const w = () => world;
    const num = (label: string, get: () => number, set: (v: number) => void, min: number, max: number, step: number, key: string) => g.num(label, get, (v) => changeWorld(() => set(v), key), { min, max, step, slider: true });
    const col = (label: string, get: () => string, set: (v: string) => void, key: string) => g.color(label, get, (v) => changeWorld(() => set(v), key));
    if (all) {
      g.section('Набор окружения', 'world');
      const wrap = h('div.ue-presets');
      for (const [, p] of Object.entries(WORLD_PRESETS)) wrap.append(h('button.ue-btn', { text: p.title, onclick: () => { changeWorld((x) => Object.assign(x, mergeWorld(WORLD_DEFAULTS, p.patch)), 'preset'); buildDetails(); toast(`Окружение: ${p.title}`); } }));
      g.custom(wrap);
      g.buttons(['Сбросить всё', () => { changeWorld((x) => Object.assign(x, mergeWorld(WORLD_DEFAULTS, {})), 'preset'); buildDetails(); }, 'undo']);
    }
    for (const part of parts) {
      if (part === 'sun') {
        g.section('Солнце', 'sun');
        col('Цвет', () => w().sun.color, (v) => { world.sun.color = v; }, 'sun-c');
        num('Яркость', () => w().sun.intensity, (v) => { world.sun.intensity = v; }, 0, 6, 0.05, 'sun-i');
        num('Высота, °', () => w().sun.elevation, (v) => { world.sun.elevation = v; }, 2, 90, 1, 'sun-e');
        num('Азимут, °', () => w().sun.azimuth, (v) => { world.sun.azimuth = v; }, 0, 360, 1, 'sun-a');
        g.bool('Тени', () => w().sun.shadows, (v) => changeWorld(() => { world.sun.shadows = v; }, 'sun-s'));
        g.note('Стрелка во вьюпорте показывает, откуда светит солнце.');
      } else if (part === 'sky') {
        g.section('Небо и глобальное освещение', 'sky');
        col('Цвет неба (фон)', () => w().sky.color, (v) => { world.sky.color = v; }, 'sky-c');
        col('Свет неба сверху', () => w().sky.hemiSky, (v) => { world.sky.hemiSky = v; }, 'sky-hs');
        col('Отражённый от земли', () => w().sky.hemiGround, (v) => { world.sky.hemiGround = v; }, 'sky-hg');
        num('Сила неба (GI)', () => w().sky.hemi, (v) => { world.sky.hemi = v; }, 0, 5, 0.05, 'sky-h');
        num('Заполняющий свет', () => w().sky.ambient, (v) => { world.sky.ambient = v; }, 0, 2, 0.01, 'sky-a');
      } else if (part === 'fog') {
        g.section('Дымка', 'fog');
        g.bool('Включена', () => w().fog.enabled, (v) => changeWorld(() => { world.fog.enabled = v; }, 'fog-on'));
        col('Цвет', () => w().fog.color, (v) => { world.fog.color = v; }, 'fog-c');
        num('Начало, м', () => w().fog.near, (v) => { world.fog.near = Math.min(v, world.fog.far - 1); }, 0, 150, 1, 'fog-n');
        num('Конец, м', () => w().fog.far, (v) => { world.fog.far = Math.max(v, world.fog.near + 1); }, 5, 300, 1, 'fog-f');
      } else if (part === 'weather') {
        g.section('Погода', 'rain');
        g.select('Погода', (Object.keys(WEATHER_TITLES) as WeatherKind[]).map((k) => [k, WEATHER_TITLES[k]] as [WeatherKind, string]), () => w().weather.kind, (v) => changeWorld(() => { world.weather.kind = v; }, 'wx-k'));
        num('Сила', () => w().weather.intensity, (v) => { world.weather.intensity = v; }, 0, 1, 0.05, 'wx-i');
        num('Ветер, м/с', () => w().weather.wind, (v) => { world.weather.wind = v; }, -10, 10, 0.1, 'wx-w');
        g.note('Гроза — сильный дождь и вспышки молний. Частицы видны в перспективе.');
      } else if (part === 'post') {
        g.section('Постобработка', 'post');
        g.bool('Включена', () => w().post.enabled, (v) => changeWorld(() => { world.post.enabled = v; }, 'pp-on'));
        num('Экспозиция', () => w().post.exposure, (v) => { world.post.exposure = v; }, 0.3, 2.5, 0.01, 'pp-exp');
        num('Bloom: сила', () => w().post.bloom, (v) => { world.post.bloom = v; }, 0, 2, 0.01, 'pp-b');
        num('Bloom: радиус', () => w().post.bloomRadius, (v) => { world.post.bloomRadius = v; }, 0, 1, 0.01, 'pp-br');
        num('Bloom: порог', () => w().post.bloomThreshold, (v) => { world.post.bloomThreshold = v; }, 0, 1.5, 0.01, 'pp-bt');
        num('AO: сила', () => w().post.ao, (v) => { world.post.ao = v; }, 0, 1, 0.01, 'pp-ao');
        num('AO: радиус', () => w().post.aoRadius, (v) => { world.post.aoRadius = v; }, 0.1, 2, 0.01, 'pp-aor');
        num('Насыщенность', () => w().post.saturation, (v) => { world.post.saturation = v; }, 0, 2, 0.01, 'pp-sat');
        num('Контраст', () => w().post.contrast, (v) => { world.post.contrast = v; }, 0.5, 1.5, 0.01, 'pp-con');
        num('Виньетка', () => w().post.vignette, (v) => { world.post.vignette = v; }, 0, 0.8, 0.01, 'pp-vig');
        col('Тон теней', () => w().post.shadowTint, (v) => { world.post.shadowTint = v; }, 'pp-st');
        col('Тон светлого', () => w().post.highTint, (v) => { world.post.highTint = v; }, 'pp-ht');
        num('Сила тонировки', () => w().post.tintAmount, (v) => { world.post.tintAmount = v; }, 0, 0.3, 0.005, 'pp-ta');
        g.note('Постобработка видна в главном вьюпорте (перспектива, «С освещением»).');
      }
    }
  }

  // ---------- строка состояния ----------
  const stCursor = h('span.ue-st-v');
  const stFps = h('span.ue-st-v');
  const stCount = h('span.ue-st-v');
  status.append(
    h('button.ue-st-btn', { html: `${icon('prefab')}<span>Префабы</span>`, onclick: () => { left.hidden = !left.hidden; root.classList.toggle('no-left', left.hidden); } }),
    h('button.ue-st-btn', { html: `${icon('info')}<span>Журнал</span>`, onclick: showLog }),
    h('span.ue-st-sep'), stCount, h('span.ue-grow'), stCursor, h('span.ue-st-sep'), stFps,
  );

  // ---------- сцена: сетки, курсоры, иконки ----------
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

  /** Иконки служебных объектов (свет, точка появления) — спрайты, по ним можно кликнуть */
  const helpers = new THREE.Group();
  helpers.name = 'Иконки';
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
  /** Стрелка солнца — видна, когда выбран раздел «Солнце» */
  const sunArrow = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), 8, 0xffd25a, 1.6, 0.8);
  sunArrow.visible = false;
  scene.add(sunArrow);

  // поставленный свет: сущности kind 'light' → свет three + иконка
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

  // ---------- подсветка выделения ----------
  const selFx = new THREE.Group();
  selFx.name = 'Выделение';
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
  /** Габариты предмета декора с поворотом */
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

  // ---------- гизмо: перенос, поворот, размер ----------
  const pivot = new THREE.Object3D();
  pivot.name = 'Гизмо';
  scene.add(pivot);
  const tcs = vps.list.map((vp) => {
    const tc = new TransformControls(vp.camera, vp.el);
    tc.size = 0.9;
    scene.add(tc.getHelper());
    tc.addEventListener('dragging-changed', (e) => { vp.controls.enabled = !e.value; });
    tc.addEventListener('mouseDown', () => { pivotStart.copy(pivot.matrix); pivotStartPos.copy(pivot.position); });
    tc.addEventListener('objectChange', () => {
      // подсветка едет за гизмо — видно, куда встанет
      pivot.updateMatrix();
      selFx.matrix.copy(pivot.matrix).multiply(pivotStart.clone().invert());
      selFx.matrixWorldNeedsUpdate = true;
    });
    tc.addEventListener('mouseUp', () => commitGizmo());
    return tc;
  });
  const pivotStart = new THREE.Matrix4(), pivotStartPos = new THREE.Vector3();
  /** Центр поворота блоков — центр клетки; переноса — низ клетки (шаг сетки привязан к целым) */
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
      // поворот блоков и точки появления — только целыми четвертями; у точки — только вокруг вертикали
      const spawnOnly = sel.every((s) => s.t === 'spawn' || s.t === 'land');
      tc.showX = tc.showZ = !(tool === 'rotate' && spawnOnly);
      tc.showY = true;
    }
  }
  function setTool(t: Tool): void { tool = t; placePivot(); refreshToolbar(); }

  /** Отпустили гизмо — применить перенос, поворот или размер к выделенному одной правкой */
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
    // блоки: перенос целыми клетками, поворот — четвертями вокруг центра клетки
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
  /** Поворот гизмо → целая матрица (четверти оборота) */
  function snapRot(R: THREE.Matrix4): THREE.Matrix4 {
    const e = R.elements.map((v) => Math.round(v));
    return new THREE.Matrix4().fromArray(e);
  }
  /** Сколько четвертей поворота вокруг вертикали даёт матрица (для поворота блоков, 90° переводит +X в +Z) */
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

  /** Перенести клетки на d (одной правкой; with — вместе с прикреплённым декором) */
  function moveCells(cells: Extract<Sel, { t: 'block' }>[], d: [number, number, number], withDecor = true): void {
    transformCells(cells, new THREE.Matrix4(), new THREE.Vector3(), d, withDecor);
  }
  /** Перенести и повернуть клетки: новая клетка = R · (клетка − c) + c + d; блоки поворачиваются вместе с поворотом вокруг Y */
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
    // в выделении — новые клетки; остальное (декор, свет) остаётся выбранным
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
    toast(`Повёрнуто на 90° вокруг ${axis.toUpperCase()}`);
  }

  // ---------- выделение ----------
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
    const T: Record<string, string> = { block: 'блоков', decor: 'декора', light: 'света', spawn: 'точка появления', land: 'ландшафта', world: 'мир' };
    return Object.entries(n).map(([k, v]) => `${v} ${T[k]}`).join(' · ');
  }
  /** После правки выделенного: подсветка, детали, дерево */
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
    toast(`Выбрано: ${out.length}`);
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
    toast(`Удалено: ${n}`);
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
    toast(`Копия: ${out.length}`);
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
      { head: sel.length ? selSummary() : 'Ничего не выбрано' },
      { label: 'К выделенному', icon: 'focus', shortcut: 'F', disabled: !sel.length, action: focusSel },
      { label: 'Дублировать', icon: 'copy', shortcut: 'Ctrl+D', disabled: !sel.length, action: duplicateSel },
      { label: 'Удалить', icon: 'trash', shortcut: 'Del', disabled: !sel.length, action: deleteSel },
      { sep: true },
      { label: 'Повернуть', icon: 'rotate', disabled: !hasBlocks, sub: [
        { label: '90° вокруг Y (вертикаль)', action: () => rotateSel('y') },
        { label: '90° вокруг X', action: () => rotateSel('x') },
        { label: '90° вокруг Z', action: () => rotateSel('z') },
      ] },
      { label: 'Выделить все такие блоки', disabled: !hasBlocks, action: selectSameBlocks },
      { label: 'Взять в кисть', icon: 'brush', disabled: !hasBlocks && !sel.some((s) => s.t === 'decor'), action: () => {
        const s = sel[0];
        if (s.t === 'block') { setCurrent(level.nameAt(s.x, s.y, s.z)); setMode('blocks'); } else if (s.t === 'decor') { setDecor(s.d.name); setMode('decor'); }
      } },
      { label: 'Создать префаб из выделения…', icon: 'prefab', disabled: !sel.length, action: makePrefab },
      { sep: true },
      { label: 'Поставить точку появления сюда', icon: 'flag', disabled: !hit, action: () => { if (place) setSpawn([...place], spawnYaw()); } },
      { label: 'Поставить свет сюда', icon: 'light', disabled: !place, action: () => { if (place) { const e = newLight('point', place[0], place[1] + 1.5, place[2]); select([{ t: 'light', e }]); } } },
      { sep: true },
      { label: 'Свойства', icon: 'info', disabled: !sel.length, action: () => setDetTab('details') },
    ];
  }

  // ---------- правки ----------
  /** Привести предмет к снимку: null — убрать с карты, иначе — вернуть на карту с полями снимка */
  function applyDecor(e: DecorEdit, to: DecorItem | null): void {
    if (!to) { level.removeDecor(e.decor); if (selected === e.decor) selected = null; return; }
    delete e.decor.rot; delete e.decor.on;
    Object.assign(e.decor, snapDecor(to));
    if (level.decor.includes(e.decor)) level.touchDecor(); else level.addDecor(e.decor);
  }
  /** Куски ландшафта карты: хранятся в meta.lands и уходят в JSON вместе с картой */
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
  /** Правка свойства с отменой; подряд идущие правки с тем же ключом (тянем ползунок) — одна запись */
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
    // стёрли блок — убрать прикреплённый к нему декор (факел на стене, цепь на потолке)
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
  /** Изменить предмет на месте (поворот, перенос) одной правкой; key — слить подряд идущие правки полем «Детали» */
  function changeDecor(d: DecorItem, fn: (d: DecorItem) => void, key?: string): void {
    const before = snapDecor(d);
    fn(d);
    level.touchDecor();
    if (key && !batch) {
      const after = snapDecor(d);
      const e: DecorEdit = { decor: d, before, after };
      recordProp(`${key}:${level.decor.indexOf(d)}`, () => { const was = level.decor.indexOf(d); applyDecor(e, e.before); void was; }, () => applyDecor(e, after));
      // при слиянии «до» — из первой правки: recordProp оставит старый undo
    } else record({ decor: d, before, after: snapDecor(d) });
    if (sel.some((s) => s.t === 'decor' && s.d === d)) { rebuildSelFx(); details.refresh(); }
  }
  /** Свет и прочие сущности: изменить с отменой */
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
    toast(type === 'spot' ? 'Прожектор поставлен' : 'Свет поставлен');
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
  /** Настройки мира с отменой: правка в fn, подряд идущие с тем же ключом — одна запись */
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
    redo.push(b); dirtyAutosave = true; toast('Отмена');
    afterSelEdit();
  }
  function doRedo(): void {
    const b = redo.pop(); if (!b) return;
    for (const e of b) apply(e);
    undo.push(b); dirtyAutosave = true; toast('Повтор');
    afterSelEdit();
  }
  /** Сборка (kit) или свой префаб: все level.set внутри fn пишутся в одну правку */
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
  /** Поставить префаб в клетку (x, y, z) — y — первый слой воздуха */
  function placePrefab(p: Prefab, x: number, y: number, z: number): void {
    if (p.kind === 'block') { beginBatch(); edit(x, y, z, p.name!, rot); endBatch(); select([{ t: 'block', x, y, z }]); }
    else if (p.kind === 'decor') { const it = addDecor({ name: p.name!, pos: [x, y, z] }); select([{ t: 'decor', d: it }]); }
    else if (p.kind === 'kit') { recordSets(() => p.build!(level, x, y, z, Math.floor(Math.random() * 1e5))); toast(`Поставлено: ${p.title}`); }
    else if (p.kind === 'light') { const e = newLight(p.name as 'point' | 'spot', x, y + 1.5, z); select([{ t: 'light', e }]); }
    else if (p.kind === 'spawn') { setSpawn([x, y, z], spawnYaw()); select([{ t: 'spawn' }]); toast('Точка появления'); }
    else if (p.kind === 'user' || p.kind === 'lib') {
      let res: ReturnType<typeof stampUser> | null = null;
      const n0 = undo.length;
      recordSets(() => { res = stampUser(level, p.user!, x, y, z, placeRot); });
      const r = res as ReturnType<typeof stampUser> | null;
      if (r) { beginBatch(); for (const d of r.decor) addDecor(d); for (const e of r.entities) addEnt(e); endBatch(); }
      // блоки и декор пресета — одна запись в отмене
      if (undo.length - n0 === 2) { const last = undo.pop()!; undo[undo.length - 1].push(...last); }
      toast(`Поставлено: ${p.title}`);
    }
    outliner.invalidate();
  }
  /** Сохранить выделение как свой префаб */
  function makePrefab(): void {
    const cells = sel.filter((s): s is Extract<Sel, { t: 'block' }> => s.t === 'block');
    const decor = sel.filter((s): s is Extract<Sel, { t: 'decor' }> => s.t === 'decor').map((s) => s.d);
    const lightsSel = sel.filter((s): s is Extract<Sel, { t: 'light' }> => s.t === 'light').map((s) => s.e);
    if (!cells.length && !decor.length && !lightsSel.length) { toast('Выдели блоки, декор или свет'); return; }
    const pts = [...cells.map((c) => [c.x, c.y, c.z]), ...decor.map((d) => d.pos), ...lightsSel.map((e) => [e.x, e.y, e.z])];
    const bx = Math.round((Math.min(...pts.map((p) => p[0])) + Math.max(...pts.map((p) => p[0]))) / 2);
    const bz = Math.round((Math.min(...pts.map((p) => p[2])) + Math.max(...pts.map((p) => p[2]))) / 2);
    const by = Math.min(...pts.map((p) => Math.floor(p[1])));
    const title = prompt('Имя префаба', `Префаб ${userPrefabs.length + 1}`);
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
    pfGroup = 'Мои префабы';
    drawPrefabs();
    toast(`Префаб «${title}» — в «Моих префабах»`);
  }
  /** Свой префаб → JSON в формате библиотеки (assets/prefabs/<id>.json): категория «мои», размер по содержимому */
  function exportPrefab(u: UserPrefab): void {
    const pts = [...u.cells.map((c) => [c[0], c[1], c[2]]), ...u.decor.map((d) => d.pos), ...u.entities.map((e) => [e.x, e.y, e.z])];
    const span = (i: number) => pts.length ? Math.ceil(Math.max(...pts.map((p) => p[i]))) - Math.floor(Math.min(...pts.map((p) => p[i]))) + 1 : 1;
    const id = u.title.replace(/[^\p{L}\p{N}_-]+/gu, '_').toLowerCase() || u.id;
    const out = { id, title: u.title, category: 'мои', size: [span(0), span(1), span(2)], seed: 1, cells: u.cells, decor: u.decor, entities: u.entities };
    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${id}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('JSON скачан — положи в assets/prefabs/');
  }
  function blockCount(): number { let n = 0; level.forEach(() => n++); return n; }

  /** Построить кусок по его параметрам (внутри пакета правок): края спадают к земле, внутри — плиты по 0,5 м; клетки — в p.cells */
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
  /** Вернуть клетки куска как было до него — кроме тех, что после него поменяли руками */
  function clearLand(p: LandPiece): void {
    for (let i = p.cells.length - 1; i >= 0; i--) {
      const [x, y, z, wn, wr, nn, nr] = p.cells[i];
      if (level.nameAt(x, y, z) === nn && (nn === 'air' || level.rotAt(x, y, z) === nr)) edit(x, y, z, wn, wr);
    }
  }
  /**
   * Поставить новый кусок (p = null) или перестроить кусок p с новыми параметрами и центром — одной правкой.
   * Если прошлая правка была правкой этого же куска и она последняя в отмене — сливаем: откатываем её и строим заново.
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
  /** Убрать кусок: клетки — как было до него, запись — из карты */
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
  /** Кусок под клеткой: в его прямоугольнике и по высоте в его рамке; из перекрытых — поставленный позже */
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

  // ---------- режимы и кисть ----------
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
    const at = mode === 'decor' ? (placement ? `точка ${placement.pos.map((v) => +v.toFixed(3)).join(', ')}` : '') : place ? `клетка ${place[0]}, ${place[1]}, ${place[2]}` : '';
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
    if (!confirm('Начать новую карту? Несохранённое пропадёт.')) return;
    const L = new Level('Новая карта'); L.fill(-8, -1, -8, 8, -1, 8, 'grass'); L.spawn = [0, 0, 0]; setLevel(L);
  }
  function floorDialog(): void {
    const raw = prompt('Этаж подземелья: seed (и номер этажа через пробел)', `${Math.floor(Math.random() * 100000)} 1`);
    if (!raw) return;
    const [seed, floor] = raw.split(/\s+/).map(Number);
    try { setLevel(buildFloor({ seed: seed || 1, floor: floor || 1, rooms: ROOMS })); toast(`Этаж собран: seed ${seed || 1}`); }
    catch (e) { toast(`Не собрался: ${(e as Error).message}`); }
  }
  function play(): void { autosave(); window.open('./?map=editor', '_blank'); }

  // ---------- сохранение ----------
  function loadInitial(): Level {
    try {
      const raw = localStorage.getItem(EDITOR_STORAGE);
      if (raw) return Level.fromJSON(JSON.parse(raw) as LevelJSON);
    } catch { /* повреждённое автосохранение — берём встроенную карту */ }
    const first = maps['playground.json'] ?? maps[Object.keys(maps)[0]];
    return first ? Level.fromJSON(first) : new Level('Новая карта');
  }
  function autosave(): void {
    try { localStorage.setItem(EDITOR_STORAGE, JSON.stringify(level.toJSON())); } catch { toast('Не удалось сохранить в localStorage'); }
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
    toast('JSON скачан — положи в assets/maps/');
  }
  function open(): void {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.addEventListener('change', async () => {
      const f = inp.files?.[0]; if (!f) return;
      try { setLevel(Level.fromJSON(JSON.parse(await f.text()) as LevelJSON)); toast(`Открыта «${level.name}»`); }
      catch (e) { toast(`Не удалось открыть: ${(e as Error).message}`); }
    });
    inp.click();
  }
  setInterval(() => { if (dirtyAutosave) autosave(); }, 2000);
  window.addEventListener('beforeunload', () => { if (dirtyAutosave) autosave(); });

  // ---------- окна: журнал и справка ----------
  function modal(title: string, body: HTMLElement): void {
    const back = h('div.ue-modal-back');
    const close = () => back.remove();
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
    back.append(h('div.ue-modal', {}, h('div.ue-modal-h', {}, h('span', { text: title }), h('button.ue-x', { text: '×', onclick: close })), body));
    document.body.append(back);
  }
  function showLog(): void { modal('Журнал', h('pre.ue-log', { text: log.slice().reverse().join('\n') || 'Пусто' })); }
  function showHelp(): void {
    const rows: [string, string][] = [
      ['Tab / Shift+1…5', 'режимы: выделение, блоки, декор, ландшафт, поставить'],
      ['ЛКМ', 'выбрать (Shift — добавить), тянуть по пустому — рамка'],
      ['W / E / R / Q', 'гизмо: перенос, поворот по осям, размер, без гизмо'],
      ['F / Home', 'к выделенному / вся карта'],
      ['Del, Ctrl+D', 'удалить, дублировать'],
      ['стрелки, PgUp/PgDn с Ctrl', 'сдвинуть выделенное (Shift — на 4)'],
      ['СКМ или Alt+ЛКМ', 'вращать камеру вокруг цели'],
      ['ПКМ', 'двигать камеру; клик — меню'],
      ['ПКМ + WASD / QE', 'лететь'],
      ['колесо', 'зум к курсору'],
      ['Alt+X', 'развернуть вьюпорт'],
      ['PgUp / PgDn', 'срез по высоте'],
      ['G', 'сетка'],
      ['Ctrl+Z / Ctrl+Y', 'отмена / повтор'],
      ['Ctrl+S / Ctrl+O', 'скачать / открыть JSON'],
      ['F5', 'играть на этой карте'],
      ['Блоки: R, Q, [ ], 1–9', 'повернуть, взять, палитра'],
      ['Декор: R / T / Y, Z', 'поворот, наклон, крен; случайный поворот'],
    ];
    const t = h('table.ue-keys');
    for (const [k, v] of rows) t.append(h('tr', {}, h('td', {}, h('kbd', { text: k })), h('td', { text: v })));
    modal('Горячие клавиши', t);
  }

  // ---------- мышь: курсор кисти ----------
  const ray = new THREE.Raycaster();
  function setRay(vp: Viewport, ndc: THREE.Vector2): void {
    ray.setFromCamera(ndc, vp.camera);
    // у ортографической камеры луч начинается у плоскости near — отодвинем начало назад, чтобы видеть всё
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
      // траву и цветы новый блок замещает, а не встаёт сверху
      place = level.defAt(hh.x, hh.y, hh.z).replaceable ? hit : [hh.x + n[0], hh.y + n[1], hh.z + n[2]];
    } else if (Math.abs(d.y) > 1e-4) {
      // пустота: ставим на плоскость y = 0 (блок под ней, как земля огорода)
      const t = -o.y / d.y;
      if (t > 0 && t < 900) place = [Math.round(o.x + d.x * t), -1, Math.round(o.z + d.z * t)];
    }
    hitBox.visible = mode === 'blocks' && !!hit;
    cursorBox.visible = (mode === 'blocks' || mode === 'place') && !!place;
    hoverBox.visible = mode === 'select' && !!hit;
    if (mode === 'land') {
      // над куском — его рамка (выбрать), иначе — рамка нового куска
      hoverLand = hit && !ev.shiftKey ? landAt(hit) : null;
      (landBox.material as THREE.LineBasicMaterial).color.set(hoverLand ? '#ffffff' : '#ffd25a');
      if (hoverLand) frameLand(landBox, hoverLand === selLand ? null : hoverLand);
      else frameLand(landBox, place ? { ...land, x: place[0], y: place[1], z: place[2] } : null);
    }
    if (hit) { hitBox.position.set(hit[0], hit[1] + 0.5, hit[2]); hoverBox.position.copy(hitBox.position); }
    if (place) cursorBox.position.set(place[0], place[1] + 0.5, place[2]);
    refreshHud();
  }

  // ---------- декор: призрак под курсором и рамка выбранного ----------
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
    // переносим — сохраняем поворот предмета (у настенного — наклон и крен, рыск задаёт стена)
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

  // рамка будущего куска ландшафта под курсором
  const landBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: '#ffd25a', depthTest: false, transparent: true, toneMapped: false }));
  const selBox = new THREE.LineSegments(landBox.geometry, new THREE.LineBasicMaterial({ color: '#4cff7a', depthTest: false, transparent: true, toneMapped: false }));
  // выбранный кусок — ещё и лёгкая заливка объёма: тонкую рамку на пёстрой траве легко потерять
  selBox.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#4cff7a', transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false })));
  landBox.renderOrder = selBox.renderOrder = 20;
  landBox.visible = selBox.visible = false;
  scene.add(landBox, selBox);
  /** Рамка куска ландшафта: прямоугольник и высота в его слоях; null — спрятать */
  function frameLand(box: THREE.LineSegments, p: LandParams | null): void {
    box.visible = !!p && mode === 'land';
    if (!p) return;
    const [x0, z0, x1, z1] = landRect(p);
    const hgt = Math.max(0.5, p.layers / 2);
    box.scale.set(p.w + 0.04, hgt + 0.04, p.d + 0.04);
    box.position.set((x0 + x1) / 2, p.y + hgt / 2, (z0 + z1) / 2);
  }

  // ---------- мышь во вьюпортах ----------
  /** Под курсором в режиме выделения: иконка, предмет или блок — ближайшее */
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
  /** Нажатие в режиме выделения: клик — выбрать, тянуть — рамка */
  let press: { vp: Viewport; x: number; y: number; shift: boolean; moved: boolean; button: number } | null = null;
  /** ПКМ + WASD — полёт */
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
        if (hoverLand) { selectLand(hoverLand); toast('Кусок выбран — ползунки правят его'); }
        else if (place) { placeLand(place[0], place[1], place[2]); toast('Ландшафт поставлен'); }
        updateCursor(e, vp);
        return;
      }
      if (mode === 'decor') {
        if (hoverDecor) {
          if (e.shiftKey) { removeDecor(hoverDecor); toast('Предмет убран'); }
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
        if (!corner) { corner = cell; cornerBox.visible = true; cornerBox.position.set(cell[0], cell[1] + 0.5, cell[2]); toast('Угол задан — кликни второй'); }
        else { fillBox(corner, cell, e.shiftKey ? 'air' : current); corner = null; cornerBox.visible = false; toast(e.shiftKey ? 'Вырезано' : 'Залито'); }
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
      // двойной клик по ландшафту — весь кусок
      if (s?.t === 'block') { const lp = landAt([s.x, s.y, s.z]); if (lp) { select([{ t: 'land', p: lp }]); return; } }
      focusSel();
    });
    // перетащили префаб из панели — поставить там, куда отпустили
    el.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('text/x-malina-prefab')) { e.preventDefault(); updateCursor(e, vp); cursorBox.visible = !!place; } });
    el.addEventListener('drop', (e) => {
      const id = e.dataTransfer?.getData('text/x-malina-prefab');
      const p = prefabs.find((x) => x.id === id);
      if (!p) return;
      e.preventDefault();
      if (p.kind === 'decor') {
        // декор — по своей опоре: на пол, стену или потолок
        updateCursor(e, vp);
        const pl = placeDecor(level, decorDef(p.name!).anchor, ray.ray.origin, ray.ray.direction, [0, 0, 0], maxY);
        if (pl) { const it = addDecor({ name: p.name!, pos: pl.pos, ...(pl.rot.length ? { rot: pl.rot } : {}), ...(pl.on ? { on: pl.on } : {}) }); if (mode === 'select') select([{ t: 'decor', d: it }]); }
        else toast('Сюда не встанет — нужна опора');
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
      // ПКМ без протягивания — контекстное меню
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
  /** Рамка: всё, чей центр попал в прямоугольник (блоки — не выше среза) */
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
    // в перспективе — только видимые сверху (верхний блок колонки), чтобы рамка не хватала толщу земли
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
    toast(`Выбрано: ${out.length}`);
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

  // ---------- клавиши ----------
  const keys = new Set<string>();
  function sliceBy(dy: number): void { maxY = Math.max(-8, Math.min(64, maxY + dy)); view.maxY = maxY; view.rebuildAll(); refreshHud(); toast(`Срез: y ≤ ${maxY}`); }
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
      case 'KeyP': if (place) { setSpawn([place[0], place[1], place[2]], spawnYaw()); toast('Точка появления задана'); } break;
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
    // стрелки — вдоль экрана активного вьюпорта, по ближайшей оси мира
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
  /** Сдвинуть выделенное на клетки (блоки, ландшафт, точка) или на столько же метров (декор, свет) */
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
    else if (selLand && (e.code === 'Delete' || e.code === 'Backspace' || e.code === 'KeyX')) { removeLand(selLand); toast('Кусок убран'); }
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
      if (selected) { const c = snapDecor(selected); c.pos = [c.pos[0] + 0.5, c.pos[1], c.pos[2] + 0.5]; selected = addDecor(c); toast('Копия'); }
    } else if (ctrl) return;
    const list = DECOR.map((d) => d.name);
    switch (e.code) {
      case 'KeyR': turn(0); break;
      case 'KeyT': turn(1); break;
      case 'KeyY': turn(2); break;
      case 'KeyZ': randomYaw = !randomYaw; randYaw = randomYaw ? Math.round(Math.random() * 24) * 15 : 0; toast(`Случайный поворот: ${randomYaw ? 'вкл' : 'выкл'}`); break;
      case 'KeyQ': {
        const d = hoverDecor ?? selected;
        if (d) { setDecor(d.name); const r = d.rot ?? []; dRot[0] = decorDef(d.name).anchor === 'wall' ? 0 : r[0] ?? 0; dRot[1] = r[1] ?? 0; dRot[2] = r[2] ?? 0; }
        break;
      }
      case 'Delete': case 'Backspace': case 'KeyX': { const d = selected ?? hoverDecor; if (d) { removeDecor(d); toast('Предмет убран'); } break; }
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
    const t = (label: string, k: keyof typeof show) => ({ label, checked: show[k], action: () => { show[k] = !show[k]; outliner.invalidate(); } });
    return [{ head: 'Показать' }, t('Сетка (G)', 'grid'), t('Иконки света и точки появления', 'icons'), t('Декор', 'decor'), t('Погода', 'weather'), t('Дымка', 'fog'), t('Статистика', 'stats')];
  }
  vps.showMenu = showItems;
  vps.onHome = (vp) => { const t = level.spawn ? new THREE.Vector3(...level.spawn) : new THREE.Vector3(); vp.focus(t, 14); };
  vps.onLayout = () => applyGizmo();

  // ---------- кадр ----------
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
  // превью префабов — по очереди, не задерживая старт
  for (const p of prefabs) thumbs.get(p);

  const clock = new THREE.Clock();
  let fpsAcc = 0, fpsN = 0;
  const composerSize = { w: 0, h: 0 };
  function frame(): void {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { stFps.textContent = `${(fpsN / fpsAcc).toFixed(0)} FPS`; fpsAcc = fpsN = 0; }
    if (doc !== 'level') { thumbs.pump(); return; }
    // полёт камерой: ПКМ + WASD / QE в любом режиме; в режимах кисти — WASD и без ПКМ (как раньше)
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
    view.update(t, 0.4, focus);
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
    let nB = 0; if (show.stats && (fpsN === 1)) { nB = blockCount(); statEl.textContent = `${nB} блоков · ${level.decor.length} декора · ${level.entities.length} сущн.`; stCount.textContent = `Режим: ${MODE_TITLES[mode]} · отмена ${undo.length}`; }
    statEl.hidden = !show.stats;
    render();
  }

  /** Нарисовать все видимые вьюпорты: каждый своей камерой, со своим видом и режимом */
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

  // ---------- отладочный хук и тесты ----------
  window.__malina = {
    mode: 'editor', get level() { return level; }, get view() { return view; }, camera: mainCam, get controls() { return vps.list[0].controls; }, setCurrent, edit: (x: number, y: number, z: number, n: string, r = 0) => edit(x, y, z, n, r),
    /** Режим редактора: выделение, блоки, декор, ландшафт, поставить */
    get editMode() { return mode; }, setMode, setDecor, get selected() { return selected; },
    /** Куда встанет текущий декор под лучом o → d (как под курсором) */
    aimDecor(o: [number, number, number], d: [number, number, number]) { ray.ray.origin.set(...o); ray.ray.direction.set(...d).normalize(); return aim(null); },
    /** Поставить / убрать предмет через отмену, как мышью */
    addDecor: (d: DecorItem) => addDecor(d), removeDecor: (d: DecorItem) => removeDecor(d), changeDecor,
    undo: doUndo, redo: doRedo,
    /** Ландшафт: параметры, поставить в точку, перестроить, случайные края */
    land, placeLand, randomizeLand, removeLand, selectLand, get lands() { return lands(); }, get selectedLand() { return selLand; },
    /** Ландшафт под клеткой (как клик мышью по куску) */
    landAt: (x: number, y: number, z: number) => landAt([x, y, z]),
    /** Править выбранный кусок: любые параметры и центр */
    editLand(params: Partial<LandParams>) { if (selLand) changeLand(selLand, { ...landParams(selLand), ...params }); },
    /** Выделение и гизмо: выбрать, повернуть / сдвинуть выбранное, удалить, дублировать */
    select: (list: Sel[]) => select(list), get selection() { return sel; }, rotateSel, nudgeSel, deleteSel, duplicateSel, setTool,
    /** Применить перенос и поворот, как если бы отпустили гизмо: d — сдвиг, q — [ось x|y|z, градусы] */
    gizmo(d: [number, number, number], q?: ['x' | 'y' | 'z', number]) {
      placePivot(); pivotStart.copy(pivot.matrix); pivotStartPos.copy(pivot.position);
      pivot.position.add(new THREE.Vector3(...d));
      if (q) pivot.quaternion.setFromAxisAngle(new THREE.Vector3(q[0] === 'x' ? 1 : 0, q[0] === 'y' ? 1 : 0, q[0] === 'z' ? 1 : 0), THREE.MathUtils.degToRad(q[1]));
      commitGizmo();
    },
    /** Настройки мира и свет */
    get world() { return world; }, changeWorld, newLight, setSpawn, placePrefab: (id: string, x: number, y: number, z: number, quarter = 0) => { const p = prefabs.find((q) => q.id === id); placeRot = quarter; if (p) placePrefab(p, x, y, z); },
    get prefabs() { return prefabs; }, viewports: vps, setDoc, look, weather,
  };
}

declare global {
  interface Window { __malina?: unknown }
}
