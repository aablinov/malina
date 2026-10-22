import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { makeTextures, textureByName } from '../textures';
import { Level, type LevelJSON } from '../level/level.ts';
import { LevelRenderer } from '../level/mesher';
import { BLOCKS, CATEGORIES, blockDef, type BlockDef } from '../level/palette.ts';
import { raycastVoxels } from '../level/collide.ts';
import { DIRS } from '../level/obj.ts';
import { MAPS, ROOMS } from '../level/maps';
import { buildFloor } from '../level/dungeon.ts';
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
 */

export const EDITOR_STORAGE = 'malina.editor.level';
const QUICK = ['grass', 'dirt', 'stone', 'cobble', 'bricks', 'planks', 'log', 'leaves', 'water'];

const maps = MAPS;

interface Edit { x: number; y: number; z: number; was: [string, number]; now: [string, number] }

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
      <span class="ed-stat" id="edStat"></span>
    </div>
    <div class="ed-side"><div class="ed-cur" id="edCur"></div><div id="edPal"></div></div>
    <div class="ed-help">ЛКМ — поставить · Shift+ЛКМ — убрать · Ctrl+ЛКМ ×2 — залить · Ctrl+Shift+ЛКМ — вырезать · СКМ — вращать · ПКМ — двигать · Q — взять · R — повернуть · PgUp/PgDn — срез · P — спавн · Ctrl+Z/Y · Ctrl+S</div>
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
    const d = blockDef(current);
    $('edCur').innerHTML = `<img src="${thumb(d)}" alt=""><div><b>${d.title}</b><br><small>${d.name}${d.rotatable ? ` · поворот ${rot * 90}°` : ''}</small></div>`;
    let n = 0; level.forEach(() => n++);
    $('edStat').textContent = `${n} блоков · срез y ≤ ${maxY} · ${place ? `курсор ${place[0]}, ${place[1]}, ${place[2]}` : ''}`;
  }
  function setLevel(L: Level): void {
    view.dispose();
    level = L;
    view = new LevelRenderer(scene, level, T);
    view.maxY = maxY;
    view.rebuildAll();
    undo.length = redo.length = 0;
    nameInput.value = level.name;
    if (level.spawn) controls.target.set(level.spawn[0], level.spawn[1], level.spawn[2]);
    dirtyAutosave = true;
    refreshHud();
  }

  // ---------- правки ----------
  function apply(e: Edit): void { level.set(e.x, e.y, e.z, e.now[0], e.now[1]); }
  function edit(x: number, y: number, z: number, name: string, r: number): void {
    const was: [string, number] = [level.nameAt(x, y, z), level.rotAt(x, y, z)];
    if (was[0] === name && (name === 'air' || was[1] === r)) return;
    const e: Edit = { x, y, z, was, now: [name, r] };
    apply(e);
    (batch ?? (() => { const b: Edit[] = []; undo.push(b); redo.length = 0; return b; })()).push(e);
    if (!batch && undo.length > 200) undo.shift();
    dirtyAutosave = true;
  }
  function beginBatch(): void { batch = []; undo.push(batch); redo.length = 0; if (undo.length > 200) undo.shift(); }
  function endBatch(): void { if (batch && !batch.length) undo.pop(); batch = null; }
  function doUndo(): void {
    const b = undo.pop(); if (!b) return;
    for (let i = b.length - 1; i >= 0; i--) level.set(b[i].x, b[i].y, b[i].z, b[i].was[0], b[i].was[1]);
    redo.push(b); dirtyAutosave = true; toast('Отмена');
  }
  function doRedo(): void {
    const b = redo.pop(); if (!b) return;
    for (const e of b) apply(e);
    undo.push(b); dirtyAutosave = true; toast('Повтор');
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
    if (hit) hitBox.position.set(hit[0], hit[1] + 0.5, hit[2]);
    if (place) cursorBox.position.set(place[0], place[1] + 0.5, place[2]);
    refreshHud();
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    updateCursor(e);
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
  window.addEventListener('pointerup', () => { if (drag) { endBatch(); drag = null; } });
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

  function resize(): void {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  setCurrent(current);

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

  window.__malina = { mode: 'editor', get level() { return level; }, camera, controls, setCurrent, edit: (x: number, y: number, z: number, n: string, r = 0) => edit(x, y, z, n, r) };
}

declare global {
  interface Window { __malina?: unknown }
}
