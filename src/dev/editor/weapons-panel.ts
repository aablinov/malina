import * as THREE from 'three';
import {
  activeWeaponId, applyWeapon, bladeOf, buildWeaponModel, CATEGORIES, deleteWeapon, disposeWeaponModel, duplicateWeapon,
  isDefaultWeapon, RARITIES, RARITY_COLOR, resetWeapon, saveWeapons, setActiveWeapon, weaponMetrics, weapons,
  type WeaponCategory, type WeaponDef, type WeaponRarity, type WeaponStats,
} from '../../weapons.ts';
import type { SwingTuning } from '../../tuning.ts';
import { t } from '../../i18n/i18n.ts';
import './weapons-panel.css';

/**
 * The editor's "Weapons" panel in the spirit of Unreal's asset editor: list on the left, 3D preview on a turntable in the centre
 * (swing arc to scale on the ground), Details with all the numbers on the right, balance and comparison of all weapons below.
 * Edits are saved immediately (weapons.ts → localStorage) and show up in the preview and metrics.
 */

export interface WeaponsPanel {
  show(): void;
  hide(): void;
  readonly visible: boolean;
  dispose(): void;
}

/** Field with a slider: key, label, min, max, step, hint */
type Spec<K extends string> = [K, string, number, number, number, string?];

const COMBO: Spec<keyof WeaponStats>[] = [
  ['comboWindow', t('Combo window, s'), 0, 1, 0.01, t('A press after the end of a swing still continues the combo')],
  ['chainFrom', t('Chain from fraction'), 0.3, 1, 0.01, t('From which fraction of a swing the next one can start')],
  ['finisherCd', t('Pause after the 3rd, s'), 0, 1, 0.01],
  ['hitStop', t('Hit stop, s'), 0, 0.2, 0.005],
  ['shockR', t('Shockwave radius, m'), 0, 5, 0.1, t('Shockwave of the finisher')],
];
const SWING: Spec<keyof SwingTuning>[] = [
  ['dmg', t('Damage'), 1, 80, 1],
  ['time', t('Duration, s'), 0.1, 1.5, 0.01],
  ['windup', t('Windup, fraction'), 0, 0.8, 0.01],
  ['strike', t('Strike, fraction'), 0.05, 0.8, 0.01],
  ['range', t('Range, m'), 0.8, 4.5, 0.05, t('From the centre of the hero')],
  ['arc', t('Arc, °'), 10, 360, 5],
  ['lunge', t('Lunge, m'), 0, 2, 0.05],
  ['knock', t('Knockback'), 0, 4, 0.1],
];
const EXTRA: Spec<keyof WeaponStats>[] = [
  ['critChance', t('Crit chance'), 0, 1, 0.01],
  ['critMult', t('Crit multiplier'), 1, 4, 0.05],
  ['speed', t('Attack speed'), 0.5, 2, 0.05, t('Swing durations are divided by it')],
  ['weight', t('Weight, kg'), 0.2, 20, 0.1],
];
/** Comparison columns */
const COLS: { key: 'dps' | 'comboDmg' | 'avgReach' | 'coverage' | 'score'; title: string; d: number }[] = [
  { key: 'dps', title: 'DPS', d: 1 },
  { key: 'comboDmg', title: t('Combo'), d: 0 },
  { key: 'avgReach', title: t('Range'), d: 2 },
  { key: 'coverage', title: t('Coverage'), d: 1 },
  { key: 'score', title: t('Score'), d: 0 },
];

const SEL_KEY = 'malina.weapons.sel';
const fmt = (v: number, d = 2): string => v.toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const decOf = (step: number): number => (String(step).split('.')[1] ?? '').length;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export function mountWeaponsPanel(host: HTMLElement): WeaponsPanel {
  const list = weapons();
  let sel: WeaponDef = list[0];
  try { sel = list.find((w) => w.id === localStorage.getItem(SEL_KEY)) ?? list[0]; } catch { /* no storage */ }
  let visible = false;
  let showSwing = -1;
  let autoRotate = true;
  let sortBy: (typeof COLS)[number]['key'] | '' = '';
  const thumbs = new Map<string, string>();
  const closed = new Set<string>();

  // ---------- skeleton ----------
  const root = el('div', 'wp');
  const grid = el('div', 'wp-grid');
  root.append(grid);
  host.append(root);
  root.style.display = 'none';

  const listBox = el('div', 'wp-list wp-pane');
  const viewBox = el('div', 'wp-view wp-pane');
  const detBox = el('div', 'wp-details wp-pane');
  const balBox = el('div', 'wp-balance wp-pane');
  grid.append(listBox, viewBox, detBox, balBox);

  // list
  const listHead = el('div', 'wp-tab', t('Weapons'));
  const tools = el('div', 'wp-tools');
  const search = el('input', 'wp-input wp-search');
  search.placeholder = t('Search…');
  search.type = 'search';
  const filter = el('select', 'wp-input');
  for (const c of ['', ...CATEGORIES]) { const o = el('option', '', c ? t(c) : t('All categories')); o.value = c; filter.append(o); }
  tools.append(search, filter);
  const items = el('div', 'wp-items');
  listBox.append(listHead, tools, items);
  search.addEventListener('input', renderList);
  filter.addEventListener('change', renderList);

  // preview
  const viewBar = el('div', 'wp-viewbar');
  const viewTitle = el('div', 'wp-viewtitle');
  const modes = el('div', 'wp-seg');
  const modeBtns = [t('Model'), t('Swing 1'), t('Swing 2'), t('Swing 3')].map((t, i) => {
    const b = el('button', 'wp-segbtn', t);
    b.addEventListener('click', () => { showSwing = i - 1; updateModes(); updateArc(); frameCamera(); });
    modes.append(b);
    return b;
  });
  const spinBtn = el('button', 'wp-iconbtn', '⟳');
  spinBtn.title = t('Turntable');
  spinBtn.addEventListener('click', () => { autoRotate = !autoRotate; spinBtn.classList.toggle('wp-on', autoRotate); });
  spinBtn.classList.add('wp-on');
  viewBar.append(viewTitle, modes, spinBtn);
  const canvasWrap = el('div', 'wp-canvas');
  const canvas = el('canvas');
  const hint = el('div', 'wp-hint', t('LMB — rotate · wheel — zoom'));
  canvasWrap.append(canvas, hint);
  viewBox.append(viewBar, canvasWrap);

  // details
  const detHead = el('div', 'wp-tab', t('Details'));
  const actions = el('div', 'wp-actions');
  const status = el('div', 'wp-status');
  const detBody = el('div', 'wp-detbody');
  detBox.append(detHead, actions, detBody, status);

  // balance
  const balHead = el('div', 'wp-tab', t('Balance'));
  const balBody = el('div', 'wp-balbody');
  const metricsBox = el('div', 'wp-metrics');
  const chartBox = el('div', 'wp-chart');
  balBody.append(metricsBox, chartBox);
  balBox.append(balHead, balBody);

  let statusT = 0;
  function flash(t: string): void {
    status.textContent = t;
    status.classList.add('wp-show');
    clearTimeout(statusT);
    statusT = window.setTimeout(() => status.classList.remove('wp-show'), 1600);
  }

  // ---------- 3D preview ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 60);
  const studio = (s: THREE.Scene, shadows: boolean): void => {
    s.add(new THREE.HemisphereLight('#dfe8ff', '#2a2620', 1.1));
    const key = new THREE.DirectionalLight('#fff1dc', 2.4);
    key.position.set(2.5, 4, 3);
    if (shadows) {
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.radius = 4;
      key.shadow.bias = -0.0005;
      Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 12 });
    }
    const rim = new THREE.DirectionalLight('#8fb8ff', 1.6);
    rim.position.set(-3, 2.5, -2.5);
    const fill = new THREE.DirectionalLight('#ffd6a8', 0.5);
    fill.position.set(-2, 1, 3);
    s.add(key, rim, fill);
  };
  studio(scene, true);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(7, 96).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#202227', roughness: 1 }));
  ground.receiveShadow = true;
  const gridH = new THREE.GridHelper(10, 20, 0x3d4149, 0x2c2f35);
  (gridH.material as THREE.Material).transparent = true;
  (gridH.material as THREE.Material).opacity = 0.7;
  gridH.position.y = 0.002;
  scene.add(ground, gridH);

  /** Turntable: blade up (+Z of the hand → +Y of the world) */
  const pivot = new THREE.Group();
  const holder = new THREE.Group();
  holder.rotation.x = -Math.PI / 2;
  pivot.add(holder);
  scene.add(pivot);
  let model: THREE.Group | null = null;
  const modelBox = new THREE.Box3();

  // swing arc to scale: sector, outline, finisher shockwave, hero silhouette
  const arcG = new THREE.Group();
  scene.add(arcG);
  const accent = new THREE.Color('#0e86ff'), orange = new THREE.Color('#f5a524');
  const ghost = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.56, 1.8, 0.34)), new THREE.LineBasicMaterial({ color: '#868a93', transparent: true, opacity: 0.5 }));
  ghost.position.y = 0.9;

  function clearArc(): void {
    for (const c of [...arcG.children]) {
      arcG.remove(c);
      if (c === ghost) continue;
      const m = c as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }

  function updateArc(): void {
    clearArc();
    if (showSwing < 0) return;
    const S = sel.stats.swings[showSwing];
    const half = THREE.MathUtils.degToRad(Math.min(360, S.arc) / 2);
    const sector = new THREE.Mesh(
      new THREE.CircleGeometry(S.range, 72, -Math.PI / 2 - half, half * 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    );
    sector.position.y = 0.006;
    const pts: THREE.Vector3[] = [];
    if (half < Math.PI - 1e-3) pts.push(new THREE.Vector3(0, 0, 0));
    for (let i = 0; i <= 64; i++) { const a = -half + (2 * half * i) / 64; pts.push(new THREE.Vector3(Math.sin(a) * S.range, 0, Math.cos(a) * S.range)); }
    const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: accent }));
    edge.position.y = 0.008;
    // lunge: where the hero will move
    const lunge = new THREE.Mesh(new THREE.PlaneGeometry(0.06, Math.max(0.01, S.lunge)).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 }));
    lunge.position.set(0, 0.01, S.lunge / 2);
    arcG.add(sector, edge, lunge, ghost);
    if (showSwing === 2 && sel.stats.shockR > 0) {
      const R = sel.stats.shockR;
      const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(0, R - 0.05), R, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: orange, transparent: true, opacity: 0.9, depthWrite: false }));
      const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: orange, transparent: true, opacity: 0.08, depthWrite: false }));
      ring.position.set(0, 0.01, 1.5);
      disc.position.set(0, 0.004, 1.5);
      arcG.add(ring, disc);
    }
  }

  function rebuildModel(): void {
    if (model) { holder.remove(model); disposeWeaponModel(model); }
    model = buildWeaponModel(sel);
    holder.add(model);
    // bottom edge of the model — above the ground
    const minZ = sel.model.reduce((m, p) => Math.min(m, p.z - p.d / 2), 0);
    holder.position.y = 0.12 - minZ;
    pivot.updateMatrixWorld(true);
    modelBox.setFromObject(holder);
  }

  // camera: orbit around the target, smoothly towards the desired
  const orbit = { theta: 0.7, phi: 1.2, dist: 3, ty: 0.8 };
  const want = { ...orbit };
  function frameCamera(): void {
    const size = modelBox.getSize(new THREE.Vector3());
    const len = Math.max(size.x, size.y, size.z, 0.5);
    if (showSwing >= 0) {
      const S = sel.stats.swings[showSwing];
      const r = Math.max(S.range, showSwing === 2 ? sel.stats.shockR + 1.5 : 0);
      Object.assign(want, { phi: 0.72, dist: r * 3.1 + 1, ty: 0.3 });
    } else Object.assign(want, { phi: 1.2, dist: len * 2.1 + 0.6, ty: modelBox.getCenter(new THREE.Vector3()).y });
  }

  let dragging = false, px = 0, py = 0;
  canvas.addEventListener('pointerdown', (e) => { dragging = true; px = e.clientX; py = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    want.theta -= (e.clientX - px) * 0.01;
    want.phi = THREE.MathUtils.clamp(want.phi - (e.clientY - py) * 0.01, 0.15, 1.52);
    orbit.theta = want.theta; orbit.phi = want.phi;
    px = e.clientX; py = e.clientY;
  });
  const endDrag = (e: PointerEvent): void => { dragging = false; if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); want.dist = THREE.MathUtils.clamp(want.dist * Math.exp(e.deltaY * 0.0015), 0.6, 18); }, { passive: false });

  let vw = 1, vh = 1;
  const ro = new ResizeObserver(() => {
    vw = Math.max(1, canvasWrap.clientWidth); vh = Math.max(1, canvasWrap.clientHeight);
    renderer.setSize(vw, vh, false);
    camera.aspect = vw / vh;
    camera.updateProjectionMatrix();
  });
  ro.observe(canvasWrap);

  // thumbnails: the same renderer, in the same frame before the main one (no flicker)
  const thumbScene = new THREE.Scene();
  studio(thumbScene, false);
  const thumbCam = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
  const thumbHolder = new THREE.Group();
  thumbScene.add(thumbHolder);
  const pendingThumbs = new Set<string>(list.map((w) => w.id));
  function renderThumb(def: WeaponDef): void {
    const g = buildWeaponModel(def);
    thumbHolder.rotation.set(-Math.PI / 2, 0, 0);
    thumbHolder.add(g);
    // blade diagonally from bottom-left to top-right
    const tilt = new THREE.Group();
    thumbScene.add(tilt);
    tilt.add(thumbHolder);
    tilt.rotation.set(0.25, 0.5, -Math.PI / 4);
    tilt.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(thumbHolder), c = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() / 2;
    thumbCam.position.set(c.x, c.y, c.z + r / Math.tan(THREE.MathUtils.degToRad(15)) * 0.92);
    thumbCam.lookAt(c);
    renderer.setSize(64, 64, false);
    renderer.render(thumbScene, thumbCam);
    thumbs.set(def.id, canvas.toDataURL('image/png'));
    renderer.setSize(vw, vh, false);
    thumbScene.add(thumbHolder);
    thumbScene.remove(tilt);
    thumbHolder.remove(g);
    disposeWeaponModel(g);
  }

  let raf = 0, last = 0;
  function frame(t: number): void {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, last ? (t - last) / 1000 : 0);
    last = t;
    let thumbsDone = 0;
    for (const id of pendingThumbs) {
      if (thumbsDone++ >= 2) break;
      pendingThumbs.delete(id);
      const w = list.find((x) => x.id === id);
      if (w) { renderThumb(w); const img = items.querySelector<HTMLImageElement>(`img[data-id="${CSS.escape(id)}"]`); if (img) img.src = thumbs.get(id) ?? ''; }
    }
    if (autoRotate && !dragging) pivot.rotation.y += dt * 0.6;
    const k = 1 - Math.exp(-8 * dt);
    orbit.theta += (want.theta - orbit.theta) * k;
    orbit.phi += (want.phi - orbit.phi) * k;
    orbit.dist += (want.dist - orbit.dist) * k;
    orbit.ty += (want.ty - orbit.ty) * k;
    camera.position.set(Math.sin(orbit.phi) * Math.sin(orbit.theta), Math.cos(orbit.phi), Math.sin(orbit.phi) * Math.cos(orbit.theta)).multiplyScalar(orbit.dist);
    camera.position.y += orbit.ty;
    camera.lookAt(0, orbit.ty, 0);
    renderer.render(scene, camera);
  }

  // ---------- list ----------
  function renderList(): void {
    const q = search.value.trim().toLowerCase(), cat = filter.value;
    const act = activeWeaponId();
    items.textContent = '';
    for (const w of list) {
      if (cat && w.category !== cat) continue;
      if (q && !`${w.title} ${w.id} ${w.category} ${w.rarity}`.toLowerCase().includes(q)) continue;
      const it = el('div', 'wp-item' + (w === sel ? ' wp-sel' : ''));
      it.style.setProperty('--wp-rar', RARITY_COLOR[w.rarity]);
      const img = el('img', 'wp-thumb');
      img.dataset.id = w.id;
      img.alt = '';
      if (thumbs.has(w.id)) img.src = thumbs.get(w.id) ?? '';
      const txt = el('div', 'wp-itemtxt');
      txt.append(el('div', 'wp-itemname', w.title), el('div', 'wp-itemsub', `${t(w.category)} · ${t(w.rarity)}`));
      const right = el('div', 'wp-itemright');
      if (w.id === act) right.append(el('span', 'wp-badge', t('active')));
      right.append(el('span', 'wp-itemscore', fmt(weaponMetrics(w).score, 0)));
      it.append(img, txt, right);
      it.addEventListener('click', () => select(w));
      items.append(it);
    }
    listHead.textContent = `${t('Weapons')} · ${list.length}`;
  }

  function select(w: WeaponDef): void {
    sel = w;
    try { localStorage.setItem(SEL_KEY, w.id); } catch { /* no storage */ }
    renderList();
    renderDetails();
    rebuildModel();
    updateArc();
    frameCamera();
    updateBalance();
    updateTitle();
  }

  function updateModes(): void { modeBtns.forEach((b, i) => b.classList.toggle('wp-on', i - 1 === showSwing)); }
  function updateTitle(): void {
    viewTitle.textContent = '';
    const chip = el('span', 'wp-chip', t(sel.rarity));
    chip.style.setProperty('--wp-rar', RARITY_COLOR[sel.rarity]);
    viewTitle.append(el('span', 'wp-viewname', sel.title), chip);
  }

  // ---------- editing ----------
  /** What changed: numbers, model or caption */
  function changed(kind: 'stats' | 'model' | 'meta'): void {
    saveWeapons(list);
    if (sel.id === activeWeaponId()) applyWeapon(sel);
    if (kind === 'model') { rebuildModel(); pendingThumbs.add(sel.id); }
    if (kind === 'meta') { renderList(); updateTitle(); }
    if (kind === 'stats') { updateArc(); const s = items.querySelector('.wp-sel .wp-itemscore'); if (s) s.textContent = fmt(weaponMetrics(sel).score, 0); }
    updateBalance();
  }

  function section(title: string, body: (b: HTMLElement) => void): void {
    const sec = el('div', 'wp-sec' + (closed.has(title) ? ' wp-collapsed' : ''));
    const head = el('div', 'wp-sechead');
    head.append(el('span', 'wp-tri'), el('span', '', title));
    head.addEventListener('click', () => {
      sec.classList.toggle('wp-collapsed');
      if (sec.classList.contains('wp-collapsed')) closed.add(title); else closed.delete(title);
    });
    const b = el('div', 'wp-secbody');
    body(b);
    sec.append(head, b);
    detBody.append(sec);
  }

  function row(parent: HTMLElement, label: string, control: HTMLElement, hintText?: string): void {
    const r = el('div', 'wp-row');
    const l = el('label', 'wp-label', label);
    if (hintText) l.title = hintText;
    r.append(l, control);
    parent.append(r);
  }

  /** Number with a slider: obj[key] */
  function num<T extends object>(parent: HTMLElement, obj: T, spec: Spec<string>, kind: 'stats' | 'model' = 'stats', get?: () => number): void {
    const [key, label, min, max, step, hintText] = spec;
    const o = obj as Record<string, number>;
    const d = decOf(step);
    const v0 = o[key] ?? get?.() ?? 0;
    const box = el('div', 'wp-num');
    const range = el('input', 'wp-range');
    Object.assign(range, { type: 'range', min: String(min), max: String(max), step: String(step), value: String(v0) });
    const input = el('input', 'wp-input wp-numin');
    Object.assign(input, { type: 'number', step: String(step), value: String(+v0.toFixed(d)) });
    const fill = (): void => { range.style.setProperty('--wp-fill', `${THREE.MathUtils.clamp((+range.value - min) / (max - min), 0, 1) * 100}%`); };
    const set = (v: number, from: HTMLInputElement): void => {
      if (!Number.isFinite(v)) return;
      v = +v.toFixed(Math.max(d, 3));
      o[key] = v;
      if (from !== range) range.value = String(v);
      if (from !== input) input.value = String(+v.toFixed(d));
      fill();
      changed(kind);
    };
    range.addEventListener('input', () => set(+range.value, range));
    input.addEventListener('change', () => set(+input.value, input));
    fill();
    box.append(range, input);
    row(parent, label, box, hintText);
  }

  function text(parent: HTMLElement, label: string, value: string, set: (v: string) => void, area = false): void {
    const i = area ? el('textarea', 'wp-input wp-text') : el('input', 'wp-input wp-text');
    i.value = value;
    i.addEventListener('input', () => { set(i.value); changed('meta'); });
    row(parent, label, i);
  }

  function choice<V extends string>(parent: HTMLElement, label: string, opts: readonly V[], value: V, set: (v: V) => void): void {
    const s = el('select', 'wp-input wp-text');
    for (const v of opts) { const o = el('option', '', t(v)); o.value = v; s.append(o); }
    s.value = value;
    s.addEventListener('change', () => { set(s.value as V); changed('meta'); });
    row(parent, label, s);
  }

  function color(parent: HTMLElement, value: string, set: (v: string) => void, title: string): HTMLInputElement {
    const c = el('input', 'wp-color');
    c.type = 'color';
    c.value = /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff';
    c.title = title;
    c.addEventListener('input', () => { set(c.value); changed('model'); });
    parent.append(c);
    return c;
  }

  function renderActions(): void {
    actions.textContent = '';
    const btn = (t: string, f: () => void, cls = ''): HTMLButtonElement => {
      const b = el('button', 'wp-btn ' + cls, t);
      b.addEventListener('click', f);
      actions.append(b);
      return b;
    };
    const act = btn(sel.id === activeWeaponId() ? t('Active ✓') : t('Make active'), () => {
      setActiveWeapon(sel.id);
      applyWeapon(sel);
      renderActions();
      renderList();
      flash(t('Active: {title}', { title: sel.title }));
    }, 'wp-primary');
    act.disabled = sel.id === activeWeaponId();
    btn(t('Duplicate'), () => { const w = duplicateWeapon(sel.id); if (w) { pendingThumbs.add(w.id); select(w); flash(t('Copy created')); } });
    if (isDefaultWeapon(sel.id)) {
      btn(t('Reset'), () => {
        const w = resetWeapon(sel.id);
        if (!w) return;
        if (w.id === activeWeaponId()) applyWeapon(w);
        pendingThumbs.add(w.id);
        select(w);
        flash(t('Reset to default'));
      });
    } else {
      btn(t('Delete'), () => {
        if (!window.confirm(t('Delete "{title}"?', { title: sel.title }))) return;
        const i = list.indexOf(sel);
        if (deleteWeapon(sel.id)) select(list[Math.max(0, i - 1)] ?? list[0]);
      }, 'wp-danger');
    }
    btn('JSON', () => {
      const s = JSON.stringify(sel, null, 2);
      const done = (): void => flash(t('JSON copied'));
      if (navigator.clipboard) navigator.clipboard.writeText(s).then(done, () => { console.log(s); flash(t('No clipboard access — JSON is in the console')); });
      else { console.log(s); flash(t('JSON is in the console')); }
    }).title = t('Copy JSON');
  }

  function renderDetails(): void {
    renderActions();
    const top = detBody.scrollTop;
    detBody.textContent = '';
    const w = sel, st = w.stats;
    section(t('General'), (b) => {
      const id = el('input', 'wp-input wp-text');
      id.value = w.id;
      id.readOnly = true;
      row(b, 'ID', id);
      text(b, t('Title'), w.title, (v) => { w.title = v; });
      choice<WeaponCategory>(b, t('Category'), CATEGORIES, w.category, (v) => { w.category = v; });
      choice<WeaponRarity>(b, t('Rarity'), RARITIES, w.rarity, (v) => { w.rarity = v; });
      text(b, t('Description'), w.description, (v) => { w.description = v; }, true);
    });
    section(t('Combo'), (b) => { for (const s of COMBO) num(b, st, s); });
    st.swings.forEach((s, i) => section(i === 2 ? t('Swing {n} · finisher', { n: i + 1 }) : t('Swing {n}', { n: i + 1 }), (b) => { for (const f of SWING) num(b, s, f); }));
    section(t('Crit and weight'), (b) => { for (const s of EXTRA) num(b, st, s); });
    section(t('Model'), (b) => {
      const bl = bladeOf(w);
      num(b, w, ['bladeBase', t('Trail: from, m'), -0.5, 2.5, 0.01, t('Start of the glowing trail along the weapon length')], 'model', () => bl.base);
      num(b, w, ['bladeTip', t('Trail: to, m'), 0, 2.5, 0.01, t('End of the trail')], 'model', () => bl.tip);
      for (const p of w.model) {
        const r = el('div', 'wp-row');
        const l = el('label', 'wp-label', p.name || t('part'));
        l.title = t('{w}×{h}×{d} m at ({x}, {y}, {z})', { w: p.w, h: p.h, d: p.d, x: p.x, y: p.y, z: p.z });
        const box = el('div', 'wp-parts');
        color(box, p.color, (v) => { p.color = v; }, t('Colour'));
        if (p.emissive !== undefined) color(box, p.emissive, (v) => { p.emissive = v; }, t('Glow'));
        const tag = p.glow ? t('light ×{v}', { v: fmt(p.glow, 1) }) : p.emissive ? t('glow {v}', { v: fmt(p.ei ?? 0.2, 2) }) : p.flat ? t('flat') : t('pixels');
        box.append(el('span', 'wp-parttag', tag));
        r.append(l, box);
        b.append(r);
      }
    });
    detBody.scrollTop = top;
  }

  // ---------- balance ----------
  function updateBalance(): void {
    const m = weaponMetrics(sel);
    metricsBox.textContent = '';
    const kv = el('div', 'wp-kv');
    const add = (k: string, v: string, hintText = ''): void => {
      const a = el('div', 'wp-k', k), b = el('div', 'wp-v', v);
      if (hintText) a.title = hintText;
      kv.append(a, b);
    };
    const delta = Math.round(m.score - 100);
    add(t('Score'), `${fmt(m.score, 0)}`, t('Strength by DPS, coverage and range; the warden sword = 100'));
    add('DPS', `${fmt(m.dps, 1)}`, t('Damage per second against one target while holding, with crits'));
    add(t('Combo damage'), `${fmt(m.comboDmg, 0)}`);
    add(t('Combo cycle'), t('{v} s', { v: fmt(m.comboTime, 2) }));
    add(t('To the 1st hit'), t('{v} s', { v: fmt(m.firstHit, 2) }));
    add(t('Crits'), `×${fmt(m.critFactor, 3)}`);
    add(t('Range'), t('{v} m · up to {max}', { v: fmt(m.avgReach, 2), max: fmt(m.maxReach, 2) }), t('Average; the largest — with the lunge'));
    add(t('Coverage'), t('{v} m²', { v: fmt(m.coverage, 1) }), t('Average swing area'));
    add(t('Shockwave'), t('{v} m²', { v: fmt(m.shockArea, 1) }));
    const head = el('div', 'wp-scorehead');
    head.append(el('span', 'wp-bigscore', fmt(m.score, 0)), el('span', 'wp-delta ' + (delta > 0 ? 'wp-up' : delta < 0 ? 'wp-down' : ''), delta === 0 ? t('= sword') : t('{arrow} {n} vs the sword', { arrow: delta > 0 ? '▲' : '▼', n: Math.abs(delta) })));
    // swings one by one
    const tbl = el('table', 'wp-swt');
    const tr0 = el('tr');
    for (const h of ['', t('damage'), t('time'), t('m²'), t('share')]) tr0.append(el('th', '', h));
    tbl.append(tr0);
    m.swings.forEach((s, i) => {
      const tr = el('tr');
      tr.append(el('td', '', t('Swing {n}', { n: i + 1 })), el('td', '', fmt(sel.stats.swings[i].dmg, 0)), el('td', '', t('{v} s', { v: fmt(s.time, 2) })), el('td', '', fmt(s.area, 1)), el('td', '', `${fmt(s.share * 100, 0)}%`));
      tbl.append(tr);
    });
    metricsBox.append(head, kv, tbl);
    renderChart();
  }

  function renderChart(): void {
    chartBox.textContent = '';
    const all = list.map((w) => ({ w, m: weaponMetrics(w) }));
    const max = Object.fromEntries(COLS.map((c) => [c.key, Math.max(1e-6, ...all.map((x) => x.m[c.key]))])) as Record<string, number>;
    if (sortBy) all.sort((a, b) => b.m[sortBy as 'dps'] - a.m[sortBy as 'dps']);
    const cmp = el('div', 'wp-cmp');
    cmp.style.gridTemplateColumns = `minmax(72px, 1.2fr) repeat(${COLS.length}, minmax(46px, 1fr))`;
    cmp.append(el('div', 'wp-cmph', t('Comparison')));
    for (const c of COLS) {
      const h = el('div', 'wp-cmph wp-sortable' + (sortBy === c.key ? ' wp-on' : ''), c.title + (sortBy === c.key ? ' ▾' : ''));
      h.title = t('Sort');
      h.addEventListener('click', () => { sortBy = sortBy === c.key ? '' : c.key; renderChart(); });
      cmp.append(h);
    }
    const act = activeWeaponId();
    for (const { w, m } of all) {
      const on = w === sel;
      const name = el('div', 'wp-cmpname' + (on ? ' wp-on' : ''), (w.id === act ? '★ ' : '') + w.title);
      name.style.setProperty('--wp-rar', RARITY_COLOR[w.rarity]);
      name.addEventListener('click', () => select(w));
      cmp.append(name);
      for (const c of COLS) {
        const cell = el('div', 'wp-bar' + (on ? ' wp-on' : ''));
        const f = el('div', 'wp-barfill');
        f.style.width = `${(m[c.key] / max[c.key]) * 100}%`;
        cell.append(f, el('span', 'wp-barval', fmt(m[c.key], c.d)));
        cell.addEventListener('click', () => select(w));
        cmp.append(cell);
      }
    }
    chartBox.append(cmp);
  }

  // ---------- start ----------
  updateModes();
  select(sel);

  return {
    show(): void {
      if (visible) return;
      visible = true;
      root.style.display = '';
      last = 0;
      raf = requestAnimationFrame(frame);
    },
    hide(): void {
      if (!visible) return;
      visible = false;
      root.style.display = 'none';
      cancelAnimationFrame(raf);
    },
    get visible(): boolean { return visible; },
    dispose(): void {
      cancelAnimationFrame(raf);
      visible = false;
      ro.disconnect();
      clearTimeout(statusT);
      clearArc();
      ghost.geometry.dispose();
      (ghost.material as THREE.Material).dispose();
      if (model) disposeWeaponModel(model);
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      gridH.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      root.remove();
    },
  };
}
