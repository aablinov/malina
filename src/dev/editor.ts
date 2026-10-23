import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { makeTextures, textureByName } from '../textures';
import { Level, type DecorItem, type LevelJSON } from '../level/level.ts';
import { LevelRenderer } from '../level/mesher';
import { BLOCKS, CATEGORIES, blockDef, type BlockDef } from '../level/palette.ts';
import { raycastVoxels } from '../level/collide.ts';
import { DIRS } from '../level/obj.ts';
import { MAPS, ROOMS } from '../level/maps';
import { buildFloor } from '../level/dungeon.ts';
import { DECOR, DECOR_CATEGORIES, decorDef } from '../level/decor.ts';
import { decorMatrix } from '../level/decor-render.ts';
import { attachedTo, placeDecor, type DecorPlacement } from '../level/decor-place.ts';
import { landscape } from '../level/kit.ts';
import type { Layer } from '../level/palette.ts';
import './editor.css';

/**
 * Редактор уровней (?dev=editor, F10 в меню).
 * Карта — воксельная сетка (src/level/level.ts), блоки — палитра (src/level/palette.ts), формы — assets/blocks/*.obj.
 * Сохраняется в JSON (assets/maps/*.json) и в localStorage (автосохранение).
 *
 * Мышь: ЛКМ — поставить, Shift+ЛКМ — убрать, СКМ — вращать камеру, ПКМ — двигать, колесо — зум.
 * Ctrl+ЛКМ — угол параллелепипеда (второй клик заливает), Ctrl+Shift+ЛКМ — вырезать параллелепипед.
 * Q — взять блок под курсором, R — повернуть, [ ] — листать палитру, 1–9 — быстрые блоки,
 * PgUp/PgDn — срез по высоте, P — точка появления, G — сетка, WASD — сдвинуть камеру,
 * Ctrl+Z / Ctrl+Y — отмена/повтор, Ctrl+S — скачать JSON, Ctrl+O — открыть JSON.
 *
 * Tab — режим «Декор» (src/level/decor.ts): ЛКМ — поставить предмет (на пол, стену или потолок — по его опоре),
 * ЛКМ по предмету — выбрать и тащить, Shift+ЛКМ или Del — убрать, R / Shift+R — поворот ±15°, T — наклон, Y — крен,
 * Z — случайный поворот, Q — взять предмет под курсором, Ctrl+D — копия выбранного, [ ] — листать, Esc — снять выбор.
 * Стёрли блок — предметы, прикреплённые к нему (поле on), удаляются в той же отмене.
 *
 * Ещё раз Tab — режим «Ландшафт» (src/level/kit.ts, landscape): ползунки — размер по X и Z, слои по 0,5 м, крупность плит,
 * доля камня; ЛКМ по земле — поставить кусок ландшафта (проходим отовсюду); ползунки и «Случайно» (новый изгиб краёв
 * и углов) перестраивают последний поставленный кусок на месте. Отмена — Ctrl+Z, как у блоков.
 */

export const EDITOR_STORAGE = 'malina.editor.level';
const QUICK = ['grass', 'dirt', 'stone', 'cobble', 'bricks', 'planks', 'log', 'leaves', 'water'];

const maps = MAPS;

interface BlockEdit { x: number; y: number; z: number; was: [string, number]; now: [string, number] }
/** Правка декора: before null — предмет добавлен, after null — убран, иначе — изменён (снимки полей) */
interface DecorEdit { decor: DecorItem; before: DecorItem | null; after: DecorItem | null }
type Edit = BlockEdit | DecorEdit;
const snapDecor = (d: DecorItem): DecorItem => JSON.parse(JSON.stringify(d)) as DecorItem;

export function runEditor(): void {
  document.body.classList.add('dev-editor');
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#9fc3e6');
  const camera = new THREE.PerspectiveCamera(40, 1, 0.3, 400);
  camera.position.set(22, 24, 26);
  scene.add(new THREE.HemisphereLight('#dfeaff', '#7a6a50', 0.9), new THREE.AmbientLight('#ffffff', 0.25));
  const sun = new THREE.DirectionalLight('#fff3d6', 2.4);
  sun.position.set(30, 50, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 160 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const controls = new OrbitControls(camera, canvas);
  controls.mouseButtons = { LEFT: null as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
  controls.enableDamping = true; controls.dampingFactor = 0.12;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.target.set(0, 0, 2);

  const T = makeTextures();
  let level = loadInitial();
  let view = new LevelRenderer(scene, level, T);

  // сетка на плоскости y = 0 и подсветка клеток
  const grid = new THREE.GridHelper(80, 80, '#ffffff', '#ffffff');
  (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.18;
  grid.position.set(-0.5, 0.01, -0.5);
  scene.add(grid);
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.01, 1.01, 1.01));
  const cursorBox = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: '#4cff7a', depthTest: false, transparent: true }));
  const hitBox = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: '#ff5a4a', depthTest: false, transparent: true, opacity: 0.8 }));
  const cornerBox = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: '#4ad2ff', depthTest: false }));
  const spawnMark = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 4), new THREE.MeshBasicMaterial({ color: '#ffd25a' }));
  spawnMark.rotation.x = Math.PI;
  cursorBox.renderOrder = hitBox.renderOrder = cornerBox.renderOrder = 20;
  cornerBox.visible = false;
  scene.add(cursorBox, hitBox, cornerBox, spawnMark);

  // ---------- состояние ----------
  let current = 'grass', rot = 0;
  let maxY = 64;
  let corner: [number, number, number] | null = null;
  const undo: Edit[][] = [], redo: Edit[][] = [];
  let batch: Edit[] | null = null;
  let place: [number, number, number] | null = null, hit: [number, number, number] | null = null;
  let lastPainted = '';
  let drag: 'place' | 'remove' | null = null;
  let dirtyAutosave = false;
  // декор
  let mode: 'blocks' | 'decor' | 'land' = 'blocks';
  /** Ландшафт: размеры, слои по 0,5 м, крупность плит, доля камня (%), зерно шума — от него изгибы краёв и углы */
  const land = { w: 24, d: 18, layers: 4, scale: 22, stone: 30, seed: 1 };
  /** Последний поставленный кусок: его перестраивают ползунки и «Случайно» */
  let lastLand: { x: number; y: number; z: number; batch: Edit[] } | null = null;
  let curDecor = DECOR[0].name;
  /** Поворот пользователя: [рыск, наклон, крен], градусы */
  const dRot = [0, 0, 0];
  let randomYaw = false, randYaw = 0;
  let placement: DecorPlacement | null = null;
  let hoverDecor: DecorItem | null = null, selected: DecorItem | null = null;
  let moving: { item: DecorItem; before: DecorItem } | null = null;

  // ---------- интерфейс ----------
  const ui = document.createElement('div');
  ui.className = 'ed';
  ui.innerHTML = `
    <div class="ed-top">
      <input id="edName" class="ed-name" spellcheck="false" />
      <button id="edNew">Новая</button><button id="edOpen">Открыть…</button><button id="edSave">Скачать JSON</button>
      <select id="edMaps"><option value="">Встроенные карты…</option></select>
      <button id="edFloor" title="Собрать этаж подземелья из комнат-заготовок">Этаж…</button>
      <button id="edPlay" title="Открыть игру с этой картой">Играть ▶</button>
      <button id="edMode" title="Tab — блоки / декор / ландшафт">Режим: блоки</button>
      <span class="ed-stat" id="edStat"></span>
    </div>
    <div class="ed-side"><div class="ed-cur" id="edCur"></div><div id="edPal"></div><div id="edDec" hidden></div>
      <div id="edLand" class="ed-land" hidden>
        <div class="ed-cat">ландшафт — проходим отовсюду</div>
        <label class="ed-sl"><span>Размер X</span><input type="range" id="lnW" min="6" max="64" step="1"><b id="lnWv"></b></label>
        <label class="ed-sl"><span>Размер Z</span><input type="range" id="lnD" min="6" max="64" step="1"><b id="lnDv"></b></label>
        <label class="ed-sl"><span>Слои ×0,5 м</span><input type="range" id="lnL" min="1" max="10" step="1"><b id="lnLv"></b></label>
        <label class="ed-sl"><span>Крупность</span><input type="range" id="lnS" min="8" max="40" step="1"><b id="lnSv"></b></label>
        <label class="ed-sl"><span>Камень, %</span><input type="range" id="lnK" min="0" max="80" step="5"><b id="lnKv"></b></label>
        <button id="lnRnd" class="ed-wide">Случайно: края и углы</button>
        <div class="ed-note">ЛКМ по земле — поставить. Ползунки и «Случайно» перестраивают последний кусок. Ctrl+Z — отмена.</div>
      </div></div>
    <div class="ed-help" id="edHelp"></div>
    <div class="ed-toast" id="edToast"></div>`;
  document.body.appendChild(ui);
  const $ = <E extends HTMLElement = HTMLElement>(id: string): E => ui.querySelector<E>('#' + id)!;
  const nameInput = $<HTMLInputElement>('edName');
  nameInput.value = level.name;
  nameInput.addEventListener('input', () => { level.name = nameInput.value; dirtyAutosave = true; });
  const toastEl = $('edToast');
  let toastT: ReturnType<typeof setTimeout> | undefined;
  const toast = (s: string) => { toastEl.textContent = s; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 1600); };

  const thumbs = new Map<string, string>();
  const thumb = (b: BlockDef): string => {
    let t = thumbs.get(b.name);
    if (t !== undefined) return t;
    const part = b.parts[0];
    const texName = part ? (part.tex.top ?? part.tex.side ?? Object.values(part.tex)[0]) : undefined;
    const tn = Array.isArray(texName) ? texName[0] : texName;
    t = tn ? (textureByName(T, tn).image as HTMLCanvasElement).toDataURL() : '';
    thumbs.set(b.name, t);
    return t;
  };
  const pal = $('edPal');
  for (const cat of CATEGORIES) {
    const h = document.createElement('div'); h.className = 'ed-cat'; h.textContent = cat; pal.appendChild(h);
    for (const b of BLOCKS.filter((b) => b.category === cat)) {
      const btn = document.createElement('button');
      btn.className = 'ed-blk'; btn.dataset.name = b.name; btn.title = b.name;
      btn.innerHTML = `<img src="${thumb(b)}" alt=""><span>${b.title}</span>`;
      btn.addEventListener('click', () => { setCurrent(b.name); btn.blur(); });
      pal.appendChild(btn);
    }
  }
  const HELP = {
    blocks: 'ЛКМ — поставить · Shift+ЛКМ — убрать · Ctrl+ЛКМ ×2 — залить · Ctrl+Shift+ЛКМ — вырезать · СКМ — вращать · ПКМ — двигать · Q — взять · R — повернуть · PgUp/PgDn — срез · P — спавн · Tab — декор · Ctrl+Z/Y · Ctrl+S',
    decor: 'ЛКМ — поставить · ЛКМ по предмету — выбрать и тащить · Shift+ЛКМ / Del — убрать · R / Shift+R — поворот ±15° · T — наклон · Y — крен · Z — случайный поворот · Q — взять · Ctrl+D — копия · Esc — снять выбор · Tab — ландшафт',
    land: 'ЛКМ по земле — поставить ландшафт · ползунки и «Случайно» — перестроить последний · Ctrl+Z — отмена · СКМ — вращать · ПКМ — двигать · Tab — блоки',
  };
  const decPal = $('edDec');
  const decThumbs = makeDecorThumbs();
  for (const cat of DECOR_CATEGORIES) {
    const h = document.createElement('div'); h.className = 'ed-cat'; h.textContent = cat; decPal.appendChild(h);
    for (const d of DECOR.filter((d) => d.category === cat)) {
      const btn = document.createElement('button');
      btn.className = 'ed-blk'; btn.dataset.name = d.name; btn.title = `${d.name} · ${d.anchor === 'floor' ? 'на пол' : d.anchor === 'wall' ? 'на стену' : 'к потолку'}`;
      btn.innerHTML = `<img src="${decThumbs.get(d.name) ?? ''}" alt=""><span>${d.title}</span>`;
      btn.addEventListener('click', () => { setDecor(d.name); btn.blur(); });
      decPal.appendChild(btn);
    }
  }
  const nextMode = () => (mode === 'blocks' ? 'decor' : mode === 'decor' ? 'land' : 'blocks');
  $('edMode').addEventListener('click', (e) => { setMode(nextMode()); (e.currentTarget as HTMLElement).blur(); });
  const landPanel = $('edLand');
  const sliders: [string, keyof typeof land][] = [['lnW', 'w'], ['lnD', 'd'], ['lnL', 'layers'], ['lnS', 'scale'], ['lnK', 'stone']];
  for (const [id, key] of sliders) {
    const inp = $<HTMLInputElement>(id);
    inp.value = String(land[key]);
    $(`${id}v`).textContent = String(land[key]);
    inp.addEventListener('input', () => { land[key] = Number(inp.value); $(`${id}v`).textContent = inp.value; relandscape(); });
    inp.addEventListener('change', () => inp.blur());
  }
  $('lnRnd').addEventListener('click', (e) => { land.seed = 1 + Math.floor(Math.random() * 1e6); relandscape(); toast('Новые края и углы'); (e.currentTarget as HTMLElement).blur(); });
  const mapsSel = $<HTMLSelectElement>('edMaps');
  for (const path of Object.keys(maps).sort()) { const o = document.createElement('option'); o.value = path; o.textContent = `${maps[path].name} (${path})`; mapsSel.appendChild(o); }
  $('edFloor').addEventListener('click', () => {
    const raw = prompt('Этаж подземелья: seed (и номер этажа через пробел)', `${Math.floor(Math.random() * 100000)} 1`);
    if (!raw) return;
    const [seed, floor] = raw.split(/\s+/).map(Number);
    try { setLevel(buildFloor({ seed: seed || 1, floor: floor || 1, rooms: ROOMS })); toast(`Этаж собран: seed ${seed || 1}`); }
    catch (e) { toast(`Не собрался: ${(e as Error).message}`); }
  });
  mapsSel.addEventListener('change', () => { if (mapsSel.value) { setLevel(Level.fromJSON(maps[mapsSel.value])); toast(`Открыта «${level.name}»`); } mapsSel.value = ''; mapsSel.blur(); });
  $('edNew').addEventListener('click', () => { if (confirm('Начать новую карту? Несохранённое пропадёт.')) { const L = new Level('Новая карта'); L.fill(-8, -1, -8, 8, -1, 8, 'grass'); L.spawn = [0, 0, 0]; setLevel(L); } });
  $('edSave').addEventListener('click', save);
  $('edOpen').addEventListener('click', open);
  $('edPlay').addEventListener('click', () => { autosave(); window.open('./?map=editor', '_blank'); });

  function setCurrent(name: string): void {
    current = name;
    for (const b of pal.querySelectorAll<HTMLElement>('.ed-blk')) b.classList.toggle('on', b.dataset.name === name);
    refreshHud();
  }
  function refreshHud(): void {
    let n = 0; level.forEach(() => n++);
    if (mode === 'land') {
      $('edCur').innerHTML = `<div><b>Ландшафт ${land.w} × ${land.d} м, ${land.layers} слоёв (${land.layers / 2} м)</b><br><small>крупность ${land.scale} · камень ${land.stone}% · зерно ${land.seed}${lastLand ? ' · правится последний кусок' : ''}</small></div>`;
      $('edStat').textContent = `${n} блоков · ${level.decor.length} декора · ${place ? `курсор ${place[0]}, ${place[1]}, ${place[2]}` : ''}`;
      return;
    }
    if (mode === 'decor') {
      const d = decorDef(curDecor);
      const r = dRot.some(Boolean) ? ` · ${dRot.join('° / ')}°` : '';
      const sel = selected ? `<br><small>выбран: ${decorDef(selected.name).title}</small>` : '';
      $('edCur').innerHTML = `<img src="${decThumbs.get(d.name) ?? ''}" alt=""><div><b>${d.title}</b><br><small>${d.name}${r}${randomYaw ? ' · случайный поворот' : ''}</small>${sel}</div>`;
      const at = placement ? `точка ${placement.pos.map((v) => +v.toFixed(3)).join(', ')}` : '';
      $('edStat').textContent = `${n} блоков · ${level.decor.length} декора · срез y ≤ ${maxY} · ${at}`;
      return;
    }
    const d = blockDef(current);
    $('edCur').innerHTML = `<img src="${thumb(d)}" alt=""><div><b>${d.title}</b><br><small>${d.name}${d.rotatable ? ` · поворот ${rot * 90}°` : ''}</small></div>`;
    $('edStat').textContent = `${n} блоков · ${level.decor.length} декора · срез y ≤ ${maxY} · ${place ? `курсор ${place[0]}, ${place[1]}, ${place[2]}` : ''}`;
  }
  function setMode(m: 'blocks' | 'decor' | 'land'): void {
    mode = m;
    pal.hidden = m !== 'blocks';
    decPal.hidden = m !== 'decor';
    landPanel.hidden = m !== 'land';
    landBox.visible = false;
    $('edMode').textContent = `Режим: ${m === 'blocks' ? 'блоки' : m === 'decor' ? 'декор' : 'ландшафт'}`;
    $('edHelp').textContent = HELP[m];
    if (m !== 'decor') { selected = hoverDecor = null; placement = null; moving = null; }
    cursorBox.visible = hitBox.visible = false;
    ghost.visible = false; outline.visible = false;
    refreshHud();
  }
  function setDecor(name: string): void {
    curDecor = name;
    for (const b of decPal.querySelectorAll<HTMLElement>('.ed-blk')) b.classList.toggle('on', b.dataset.name === name);
    buildGhost();
    refreshHud();
  }
  /** Превью декора для палитры: каждый предмет рисуется один раз отдельным маленьким рендером */
  function makeDecorThumbs(): Map<string, string> {
    const out = new Map<string, string>();
    try {
      const c = document.createElement('canvas'); c.width = c.height = 72;
      const r = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true });
      const sc = new THREE.Scene();
      const dl = new THREE.DirectionalLight('#fff3d6', 2.2); dl.position.set(3, 5, 4);
      sc.add(new THREE.HemisphereLight('#dfeaff', '#7a6a50', 1.2), dl);
      const L = new Level('превью');
      const v = new LevelRenderer(sc, L, T);
      const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
      const box = new THREE.Box3(), ctr = new THREE.Vector3(), size = new THREE.Vector3();
      for (const d of DECOR) {
        L.decor.length = 0;
        L.addDecor({ name: d.name, pos: [0, 0, 0] });
        v.sync();
        box.setFromObject(v.decor.group).getCenter(ctr); box.getSize(size);
        const k = Math.max(size.x, size.y, size.z, 0.3);
        cam.position.copy(ctr).add(new THREE.Vector3(1, 0.85, 1.25).normalize().multiplyScalar(k * 2.3));
        cam.lookAt(ctr);
        r.render(sc, cam);
        out.set(d.name, c.toDataURL());
      }
      v.dispose(); r.dispose(); r.forceContextLoss();
    } catch { /* без WebGL превью нет — палитра всё равно работает */ }
    return out;
  }
  function setLevel(L: Level): void {
    selected = hoverDecor = null; moving = null;
    view.dispose();
    level = L;
    view = new LevelRenderer(scene, level, T);
    view.maxY = maxY;
    view.rebuildAll();
    undo.length = redo.length = 0;
    nameInput.value = level.name;
    if (level.spawn) controls.target.set(level.spawn[0], level.spawn[1], level.spawn[2]);
    buildGhost();
    dirtyAutosave = true;
    refreshHud();
  }

  // ---------- правки ----------
  /** Привести предмет к снимку: null — убрать с карты, иначе — вернуть на карту с полями снимка */
  function applyDecor(e: DecorEdit, to: DecorItem | null): void {
    if (!to) { level.removeDecor(e.decor); if (selected === e.decor) selected = null; return; }
    delete e.decor.rot; delete e.decor.on;
    Object.assign(e.decor, snapDecor(to));
    if (level.decor.includes(e.decor)) level.touchDecor(); else level.addDecor(e.decor);
  }
  function apply(e: Edit, back = false): void {
    if ('decor' in e) applyDecor(e, back ? e.before : e.after);
    else if (back) level.set(e.x, e.y, e.z, e.was[0], e.was[1]);
    else level.set(e.x, e.y, e.z, e.now[0], e.now[1]);
  }
  function record(e: Edit): void {
    if (batch) batch.push(e);
    else { undo.push([e]); redo.length = 0; if (undo.length > 200) undo.shift(); }
    dirtyAutosave = true;
  }
  function edit(x: number, y: number, z: number, name: string, r: number): void {
    const was: [string, number] = [level.nameAt(x, y, z), level.rotAt(x, y, z)];
    if (was[0] === name && (name === 'air' || was[1] === r)) return;
    const own = !batch;
    if (own) beginBatch();
    const e: BlockEdit = { x, y, z, was, now: [name, r] };
    apply(e);
    record(e);
    // стёрли блок — убрать прикреплённый к нему декор (факел на стене, цепь на потолке)
    if (name === 'air') for (const d of level.decor.filter((d) => attachedTo(d, x, y, z))) removeDecor(d);
    if (own) endBatch();
  }
  function addDecor(d: DecorItem): DecorItem {
    level.addDecor(d);
    record({ decor: d, before: null, after: snapDecor(d) });
    return d;
  }
  function removeDecor(d: DecorItem): void {
    const before = snapDecor(d);
    level.removeDecor(d);
    if (selected === d) selected = null;
    if (hoverDecor === d) hoverDecor = null;
    record({ decor: d, before, after: null });
  }
  /** Изменить предмет на месте (поворот, перенос) одной правкой */
  function changeDecor(d: DecorItem, fn: (d: DecorItem) => void): void {
    const before = snapDecor(d);
    fn(d);
    level.touchDecor();
    record({ decor: d, before, after: snapDecor(d) });
  }
  function beginBatch(): void { batch = []; undo.push(batch); redo.length = 0; if (undo.length > 200) undo.shift(); }
  function endBatch(): void { if (batch && !batch.length) undo.pop(); batch = null; }
  function doUndo(): void {
    const b = undo.pop(); if (!b) return;
    for (let i = b.length - 1; i >= 0; i--) apply(b[i], true);
    redo.push(b); dirtyAutosave = true; toast('Отмена');
  }
  function doRedo(): void {
    const b = redo.pop(); if (!b) return;
    for (const e of b) apply(e);
    undo.push(b); dirtyAutosave = true; toast('Повтор');
  }
  /**
   * Поставить кусок ландшафта с центром в (cx, cz) на уровне y: края спадают к земле, внутри — плиты по 0,5 м,
   * не выше land.layers слоёв. Все изменённые клетки — одна правка в отмене.
   */
  function placeLand(cx: number, y: number, cz: number): void {
    const x0 = cx - Math.floor(land.w / 2), z0 = cz - Math.floor(land.d / 2), x1 = x0 + land.w - 1, z1 = z0 + land.d - 1;
    const y1 = y + Math.ceil(land.layers / 2) + 2;
    const was = new Map<string, [string, number]>();
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let yy = y - 1; yy <= y1; yy++) was.set(`${x},${yy},${z}`, [level.nameAt(x, yy, z), level.rotAt(x, yy, z)]);
    landscape(level, x0, z0, x1, z1, y, {
      layers: land.layers, max: land.layers, scale: land.scale, stone: land.stone / 100, seed: land.seed, dry: 0.08, daisies: 0.04,
      fade: Math.max(2, Math.min(land.w, land.d) / 5),
      flat: (x, z) => x === x0 || x === x1 || z === z0 || z === z1,
      bumps: [{ x: cx, z: cz, rx: land.w * 0.38, rz: land.d * 0.38, h: land.layers * 0.55 }],
    });
    beginBatch();
    const b = batch!;
    for (const [k, w0] of was) {
      const [x, yy, z] = k.split(',').map(Number);
      const now: [string, number] = [level.nameAt(x, yy, z), level.rotAt(x, yy, z)];
      if (now[0] !== w0[0] || (now[0] !== 'air' && now[1] !== w0[1])) b.push({ x, y: yy, z, was: w0, now });
    }
    endBatch();
    dirtyAutosave = true;
    lastLand = b.length ? { x: cx, y, z: cz, batch: b } : null;
    refreshHud();
  }
  /** Перестроить последний кусок с текущими ползунками (если он ещё последняя правка) */
  function relandscape(): void {
    if (!lastLand || undo[undo.length - 1] !== lastLand.batch) { refreshHud(); return; }
    const { x, y, z, batch: b } = lastLand;
    undo.pop();
    for (let i = b.length - 1; i >= 0; i--) apply(b[i], true);
    placeLand(x, y, z);
  }
  function fillBox(a: [number, number, number], b: [number, number, number], name: string): void {
    beginBatch();
    for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++)
      for (let z = Math.min(a[2], b[2]); z <= Math.max(a[2], b[2]); z++)
        for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++) edit(x, y, z, name, rot);
    endBatch();
  }

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

  // ---------- курсор ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function updateCursor(ev: { clientX: number; clientY: number }): void {
    ndc.set((ev.clientX / window.innerWidth) * 2 - 1, -(ev.clientY / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (mode === 'decor') { updateDecorCursor(); return; }
    const o = ray.ray.origin, d = ray.ray.direction;
    const h = raycastVoxels(level, o.x, o.y, o.z, d.x, d.y, d.z, 300, maxY);
    hit = null; place = null;
    if (h) {
      hit = [h.x, h.y, h.z];
      const n = DIRS[h.face];
      // траву и цветы новый блок замещает, а не встаёт сверху
      place = level.defAt(h.x, h.y, h.z).replaceable ? hit : [h.x + n[0], h.y + n[1], h.z + n[2]];
    } else if (d.y < -1e-4) {
      // пустота: ставим на плоскость y = 0 (блок под ней, как земля огорода)
      const t = -o.y / d.y;
      if (t > 0 && t < 300) place = [Math.round(o.x + d.x * t), -1, Math.round(o.z + d.z * t)];
    }
    hitBox.visible = !!hit;
    cursorBox.visible = !!place;
    if (mode === 'land') {
      hitBox.visible = cursorBox.visible = false;
      landBox.visible = !!place;
      if (place) {
        const hgt = Math.max(0.5, land.layers / 2);
        landBox.scale.set(land.w, hgt, land.d);
        landBox.position.set(place[0] - Math.floor(land.w / 2) + (land.w - 1) / 2, place[1] + hgt / 2, place[2] - Math.floor(land.d / 2) + (land.d - 1) / 2);
      }
    }
    if (hit) hitBox.position.set(hit[0], hit[1] + 0.5, hit[2]);
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
  /** Рамка предмета: габариты его форм с поворотом */
  function frameDecor(d: DecorItem): void {
    const def = decorDef(d.name);
    const box = outline.box.makeEmpty();
    const m = decorMatrix(d);
    for (const layer of ['opaque', 'cutout', 'glow', 'fire'] as Layer[]) {
      const g = view.decor.geometryOf(def, layer);
      if (!g) continue;
      if (!g.boundingBox) g.computeBoundingBox();
      box.union(g.boundingBox!.clone().applyMatrix4(m));
    }
    box.expandByScalar(0.03);
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
    cursorBox.visible = hitBox.visible = false;
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
    const show = hoverDecor ?? selected;
    if (show) frameDecor(show); else outline.visible = false;
    refreshHud();
  }

  // рамка будущего куска ландшафта под курсором
  const landBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: '#ffd25a', depthTest: false, transparent: true }));
  landBox.renderOrder = 20;
  landBox.visible = false;
  scene.add(landBox);

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    updateCursor(e);
    if (mode === 'land') {
      if (place) { placeLand(place[0], place[1], place[2]); toast('Ландшафт поставлен'); }
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
  window.addEventListener('pointerup', () => {
    if (drag) { endBatch(); drag = null; }
    if (moving) {
      const { item, before } = moving;
      moving = null;
      if (JSON.stringify(before) !== JSON.stringify(item)) record({ decor: item, before, after: snapDecor(item) });
    }
  });
  canvas.addEventListener('pointermove', (e) => { updateCursor(e); paint(); });

  // ---------- клавиши ----------
  const keys = new Set<string>();
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    keys.add(e.code);
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
    if (ctrl && e.code === 'KeyY') { e.preventDefault(); doRedo(); return; }
    if (ctrl && e.code === 'KeyS') { e.preventDefault(); save(); return; }
    if (ctrl && e.code === 'KeyO') { e.preventDefault(); open(); return; }
    if (e.code === 'Tab') { e.preventDefault(); setMode(nextMode()); return; }
    if (mode === 'decor') { decorKey(e, ctrl); return; }
    if (mode === 'land') { if (e.code === 'KeyG') grid.visible = !grid.visible; return; }
    if (ctrl) return;
    const list = BLOCKS.filter((b) => b.name !== 'air');
    switch (e.code) {
      case 'KeyR': rot = (rot + 1) % 4; refreshHud(); break;
      case 'KeyQ': if (hit) { setCurrent(level.nameAt(hit[0], hit[1], hit[2])); rot = level.rotAt(hit[0], hit[1], hit[2]); refreshHud(); } break;
      case 'KeyX': if (hit) { beginBatch(); edit(hit[0], hit[1], hit[2], 'air', 0); endBatch(); } break;
      case 'BracketLeft': setCurrent(list[(list.findIndex((b) => b.name === current) - 1 + list.length) % list.length].name); break;
      case 'BracketRight': setCurrent(list[(list.findIndex((b) => b.name === current) + 1) % list.length].name); break;
      case 'PageUp': maxY = Math.min(64, maxY + 1); view.maxY = maxY; view.rebuildAll(); refreshHud(); break;
      case 'PageDown': maxY = Math.max(-8, maxY - 1); view.maxY = maxY; view.rebuildAll(); refreshHud(); break;
      case 'KeyP': if (place) { level.spawn = [place[0], place[1], place[2]]; dirtyAutosave = true; toast('Точка появления задана'); } break;
      case 'KeyG': grid.visible = !grid.visible; break;
      case 'Escape': corner = null; cornerBox.visible = false; break;
      default: {
        const m = /^Digit([1-9])$/.exec(e.code);
        if (m) { const q = QUICK[+m[1] - 1]; if (q) setCurrent(q); }
      }
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
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
      case 'Escape': selected = null; outline.visible = false; break;
      case 'PageUp': maxY = Math.min(64, maxY + 1); view.maxY = maxY; view.rebuildAll(); break;
      case 'PageDown': maxY = Math.max(-8, maxY - 1); view.maxY = maxY; view.rebuildAll(); break;
      case 'KeyG': grid.visible = !grid.visible; break;
      default: break;
    }
    updateDecorCursor();
  }

  function resize(): void {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  setCurrent(current);
  setDecor(curDecor);
  setMode('blocks');

  const clock = new THREE.Clock();
  function frame(): void {
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;
    // WASD — сдвиг цели камеры по горизонтали
    const fwd = new THREE.Vector3().subVectors(controls.target, camera.position).setY(0).normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const mv = new THREE.Vector3();
    if (keys.has('KeyW')) mv.add(fwd); if (keys.has('KeyS')) mv.sub(fwd);
    if (keys.has('KeyD')) mv.add(right); if (keys.has('KeyA')) mv.sub(right);
    if (mv.lengthSq()) { mv.normalize().multiplyScalar(dt * 14); controls.target.add(mv); camera.position.add(mv); }
    controls.update();
    view.sync();
    view.update(t, 0.6, controls.target);
    sun.position.copy(controls.target).add(new THREE.Vector3(30, 50, 20));
    sun.target.position.copy(controls.target);
    if (level.spawn) { spawnMark.visible = true; spawnMark.position.set(level.spawn[0], level.spawn[1] + 0.6 + Math.sin(t * 3) * 0.08, level.spawn[2]); }
    else spawnMark.visible = false;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  frame();

  window.__malina = {
    mode: 'editor', get level() { return level; }, get view() { return view; }, camera, controls, setCurrent, edit: (x: number, y: number, z: number, n: string, r = 0) => edit(x, y, z, n, r),
    /** Режим редактора: блоки или декор */
    get editMode() { return mode; }, setMode, setDecor, get selected() { return selected; },
    /** Куда встанет текущий декор под лучом o → d (как под курсором) */
    aimDecor(o: [number, number, number], d: [number, number, number]) { ray.ray.origin.set(...o); ray.ray.direction.set(...d).normalize(); return aim(null); },
    /** Поставить / убрать предмет через отмену, как мышью */
    addDecor: (d: DecorItem) => addDecor(d), removeDecor: (d: DecorItem) => removeDecor(d), changeDecor,
    undo: doUndo, redo: doRedo,
    /** Ландшафт: параметры, поставить в точку, перестроить, случайные края */
    land, placeLand, relandscape, get lastLand() { return lastLand; },
    randomizeLand() { land.seed = 1 + Math.floor(Math.random() * 1e6); relandscape(); },
  };
}

declare global {
  interface Window { __malina?: unknown }
}
