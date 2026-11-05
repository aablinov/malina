import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { h, icon, menuButton, type MenuItem } from './ui.ts';
import { t } from '../../i18n/i18n.ts';

/**
 * Editor viewports, like in Unreal: one big or four (perspective, top, front, side).
 * One canvas for the whole area — each viewport draws into its own rectangle (setViewport + setScissor).
 * Over each — a transparent layer with a bar (view, draw mode, maximise) and axes in the corner; it also catches the mouse.
 *
 * Camera: wheel — zoom, MMB — orbit around the target (or Alt+LMB), RMB — pan; in orthographic views — only pan and zoom.
 * F — to the selection, turntable — the scene slowly rotates.
 */

export type ViewKind = 'persp' | 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';
export type ViewMode = 'lit' | 'unlit' | 'wire' | 'nopost';
export type Layout = 'one' | 'two' | 'four';

export const VIEW_TITLES: Record<ViewKind, string> = {
  persp: t('Perspective'), top: t('Top'), bottom: t('Bottom'), front: t('Front'), back: t('Back view'), left: t('Left'), right: t('Right'),
};
export const MODE_TITLES: Record<ViewMode, string> = { lit: t('Lit'), unlit: t('Unlit'), wire: t('Wireframe'), nopost: t('No post-processing') };

/** Where the orthographic camera looks (from the target to the camera) and its "up" vector */
const ORTHO: Record<Exclude<ViewKind, 'persp'>, { dir: [number, number, number]; up: [number, number, number] }> = {
  top: { dir: [0, 1, 0], up: [0, 0, -1] },
  bottom: { dir: [0, -1, 0], up: [0, 0, 1] },
  front: { dir: [0, 0, 1], up: [0, 1, 0] },
  back: { dir: [0, 0, -1], up: [0, 1, 0] },
  left: { dir: [-1, 0, 0], up: [0, 1, 0] },
  right: { dir: [1, 0, 0], up: [0, 1, 0] },
};

export class Viewport {
  readonly el: HTMLDivElement;
  readonly bar: HTMLDivElement;
  private readonly axes: HTMLCanvasElement;
  kind: ViewKind;
  mode: ViewMode = 'lit';
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  readonly persp: THREE.PerspectiveCamera;
  readonly ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, -500, 500);
  controls: OrbitControls;
  /** Rectangle in CSS pixels relative to the viewports area */
  readonly rect = { x: 0, y: 0, w: 1, h: 1 };
  /** The camera flies to the target (F) */
  private fly: { from: THREE.Vector3; to: THREE.Vector3; camFrom: THREE.Vector3; camTo: THREE.Vector3; zoomTo: number; t: number } | null = null;

  readonly owner: Viewports;
  readonly index: number;
  constructor(owner: Viewports, index: number, kind: ViewKind, persp: THREE.PerspectiveCamera) { this.owner = owner; this.index = index;
    this.kind = kind;
    this.persp = persp;
    this.el = h('div.ue-vp');
    this.bar = h('div.ue-vp-bar');
    this.axes = h('canvas.ue-vp-axes', { width: 64, height: 64 });
    this.el.append(this.bar, this.axes, h('div.ue-vp-label'));
    this.camera = kind === 'persp' ? persp : this.ortho;
    this.controls = this.makeControls();
    this.setKind(kind);
    this.buildBar();
    this.axes.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.clickAxes(e); });
    this.el.addEventListener('pointerdown', () => owner.setActive(this), true);
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private makeControls(): OrbitControls {
    const c = new OrbitControls(this.camera, this.el);
    c.enableDamping = true; c.dampingFactor = 0.14;
    c.zoomToCursor = true;
    c.screenSpacePanning = true;
    c.maxDistance = 400;
    return c;
  }

  get isOrtho(): boolean { return this.kind !== 'persp'; }

  setKind(kind: ViewKind): void {
    const target = this.controls.target.clone();
    const dist = this.camera.position.distanceTo(target) || 40;
    this.kind = kind;
    this.camera = kind === 'persp' ? this.persp : this.ortho;
    this.controls.object = this.camera;
    const c = this.controls;
    if (kind === 'persp') {
      c.enableRotate = true;
      c.mouseButtons = { LEFT: null as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
      c.maxPolarAngle = Math.PI * 0.495;
      c.minPolarAngle = 0;
    } else {
      const o = ORTHO[kind];
      c.enableRotate = false;
      c.mouseButtons = { LEFT: null as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
      c.minPolarAngle = 0; c.maxPolarAngle = Math.PI;
      this.ortho.up.set(...o.up);
      this.ortho.position.copy(target).add(new THREE.Vector3(...o.dir).multiplyScalar(200));
      this.ortho.lookAt(target);
      if (this.ortho.zoom === 1 && dist) this.ortho.zoom = 1;
    }
    c.target.copy(target);
    c.update();
    this.buildBar();
    this.resizeCamera();
  }

  /** Alt+LMB — orbit (in perspective); without Alt, LMB belongs to the editor */
  setAltOrbit(on: boolean): void {
    if (this.isOrtho) return;
    this.controls.mouseButtons.LEFT = on ? THREE.MOUSE.ROTATE : (null as unknown as THREE.MOUSE);
  }

  resizeCamera(): void {
    const a = this.rect.w / Math.max(1, this.rect.h);
    this.persp.aspect = a; this.persp.updateProjectionMatrix();
    const half = 18;
    Object.assign(this.ortho, { left: -half * a, right: half * a, top: half, bottom: -half });
    this.ortho.updateProjectionMatrix();
  }

  buildBar(): void {
    const b = this.bar;
    b.textContent = '';
    const menuBtn = h('button.ue-vp-btn', { html: icon('select') });
    menuButton(menuBtn, () => [
      { label: t('Maximise / restore'), shortcut: 'Alt+X', icon: 'layout1', action: () => this.owner.toggleMax(this) },
      { label: t('Turntable: the scene rotates'), checked: this.controls.autoRotate, icon: 'turntable', action: () => { this.controls.autoRotate = !this.controls.autoRotate; } },
      { label: t('Reset camera'), icon: 'camera', action: () => this.owner.onHome?.(this) },
      { sep: true },
      { head: t('Layout') },
      { label: t('One viewport'), icon: 'layout1', checked: this.owner.layout === 'one', action: () => this.owner.setLayout('one') },
      { label: t('Two side by side'), icon: 'layout2', checked: this.owner.layout === 'two', action: () => this.owner.setLayout('two') },
      { label: t('Four views'), icon: 'layout4', checked: this.owner.layout === 'four', action: () => this.owner.setLayout('four') },
    ]);
    const kindBtn = h('button.ue-vp-btn', { html: `${icon(this.kind === 'persp' ? 'cube' : 'grid')}<span>${VIEW_TITLES[this.kind]}</span>` });
    menuButton(kindBtn, () => {
      const it: MenuItem[] = [{ head: t('Perspective') }, { label: VIEW_TITLES.persp, checked: this.kind === 'persp', action: () => this.setKind('persp') }, { head: t('Orthographic') }];
      for (const k of ['top', 'bottom', 'front', 'back', 'left', 'right'] as ViewKind[]) it.push({ label: VIEW_TITLES[k], checked: this.kind === k, action: () => this.setKind(k) });
      return it;
    });
    const modeBtn = h('button.ue-vp-btn', { html: `${icon('sun')}<span>${MODE_TITLES[this.mode]}</span>` });
    menuButton(modeBtn, () => (Object.keys(MODE_TITLES) as ViewMode[]).map((m) => ({ label: MODE_TITLES[m], checked: this.mode === m, action: () => { this.mode = m; this.buildBar(); } })));
    const showBtn = h('button.ue-vp-btn', { html: `<span>${t('Show')}</span>` });
    menuButton(showBtn, () => this.owner.showMenu?.() ?? []);
    const maxBtn = h('button.ue-vp-btn.ue-vp-max', { html: icon(this.owner.maxed === this ? 'layout4' : 'layout1'), title: t('Maximise / restore (Alt+X)'), onclick: () => this.owner.toggleMax(this) });
    b.append(menuBtn, kindBtn, modeBtn, showBtn, h('span.ue-grow'), maxBtn);
  }

  /** Smoothly aim the camera at a point; radius — the size of what we show */
  focus(p: THREE.Vector3, radius: number): void {
    const c = this.controls;
    const dir = this.camera.position.clone().sub(c.target);
    if (dir.lengthSq() < 1e-6) dir.set(1, 1, 1);
    const dist = this.isOrtho ? dir.length() : Math.max(4, radius * 2.6);
    const camTo = p.clone().add(dir.normalize().multiplyScalar(dist));
    this.fly = { from: c.target.clone(), to: p.clone(), camFrom: this.camera.position.clone(), camTo, zoomTo: this.isOrtho ? Math.min(20, 18 / Math.max(2, radius * 1.6)) : 1, t: 0 };
  }

  update(dt: number): void {
    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + dt * 4);
      const k = 1 - (1 - f.t) ** 3;
      this.controls.target.lerpVectors(f.from, f.to, k);
      this.camera.position.lerpVectors(f.camFrom, f.camTo, k);
      if (this.isOrtho) { this.ortho.zoom += (f.zoomTo - this.ortho.zoom) * k; this.ortho.updateProjectionMatrix(); }
      if (f.t >= 1) this.fly = null;
    }
    this.controls.update(dt);
    this.drawAxes();
  }

  /** Axes in the corner: X red, Y green, Z blue — clicking an axis end sets the view along it */
  private axisEnds: { k: ViewKind; x: number; y: number }[] = [];
  private drawAxes(): void {
    const g = this.axes.getContext('2d')!;
    g.clearRect(0, 0, 64, 64);
    const q = this.camera.quaternion.clone().invert();
    const ends = [
      { v: new THREE.Vector3(1, 0, 0), c: '#e5484d', l: 'X', k: 'right' as ViewKind, nk: 'left' as ViewKind },
      { v: new THREE.Vector3(0, 1, 0), c: '#5fbf4a', l: 'Y', k: 'top' as ViewKind, nk: 'bottom' as ViewKind },
      { v: new THREE.Vector3(0, 0, 1), c: '#3b8cff', l: 'Z', k: 'front' as ViewKind, nk: 'back' as ViewKind },
    ].map((a) => ({ ...a, p: a.v.clone().applyQuaternion(q) })).sort((a, b) => a.p.z - b.p.z);
    this.axisEnds = [];
    g.lineWidth = 2;
    for (const a of ends) {
      const x = 32 + a.p.x * 20, y = 32 - a.p.y * 20;
      g.strokeStyle = a.c; g.beginPath(); g.moveTo(32, 32); g.lineTo(x, y); g.stroke();
      g.fillStyle = a.c; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#0b0c0e'; g.font = 'bold 9px Inter, system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(a.l, x, y + 0.5);
      // the opposite end — a pale dot
      const nx = 32 - a.p.x * 20, ny = 32 + a.p.y * 20;
      g.globalAlpha = 0.45; g.beginPath(); g.arc(nx, ny, 4, 0, Math.PI * 2); g.fillStyle = a.c; g.fill(); g.globalAlpha = 1;
      this.axisEnds.push({ k: a.k, x, y }, { k: a.nk, x: nx, y: ny });
    }
  }
  private clickAxes(e: PointerEvent): void {
    const r = this.axes.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best: ViewKind | null = null, bd = 10;
    for (const a of this.axisEnds) { const d = Math.hypot(a.x - x, a.y - y); if (d < bd) { bd = d; best = a.k; } }
    if (!best) return;
    if (this.kind === 'persp') {
      // in perspective — turn the camera along the axis while staying in perspective
      const o = ORTHO[best as Exclude<ViewKind, 'persp'>];
      const dist = this.camera.position.distanceTo(this.controls.target);
      const dir = new THREE.Vector3(...o.dir);
      if (Math.abs(dir.y) > 0.9) dir.set(0.001, Math.sign(dir.y), 0.001).normalize();
      this.fly = { from: this.controls.target.clone(), to: this.controls.target.clone(), camFrom: this.camera.position.clone(), camTo: this.controls.target.clone().add(dir.multiplyScalar(dist)), zoomTo: 1, t: 0 };
    } else this.setKind(best);
  }
}

export class Viewports {
  readonly el = h('div.ue-vps');
  readonly list: Viewport[] = [];
  layout: Layout = 'one';
  maxed: Viewport | null = null;
  active: Viewport;
  /** The "Show" menu (scene flags) — provided by the editor */
  showMenu?: () => MenuItem[];
  onHome?: (vp: Viewport) => void;
  onLayout?: () => void;

  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  constructor(canvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer, mainCamera: THREE.PerspectiveCamera) { this.canvas = canvas; this.renderer = renderer;
    this.el.append(canvas);
    const kinds: ViewKind[] = ['persp', 'top', 'front', 'right'];
    kinds.forEach((k, i) => {
      const cam = i === 0 ? mainCamera : new THREE.PerspectiveCamera(40, 1, 0.3, 600);
      const vp = new Viewport(this, i, k, cam);
      this.list.push(vp);
      this.el.append(vp.el);
    });
    this.active = this.list[0];
    new ResizeObserver(() => this.resize()).observe(this.el);
    window.addEventListener('keydown', (e) => { if (e.altKey) this.list.forEach((v) => v.setAltOrbit(true)); });
    window.addEventListener('keyup', (e) => { if (!e.altKey) this.list.forEach((v) => v.setAltOrbit(false)); });
    window.addEventListener('blur', () => this.list.forEach((v) => v.setAltOrbit(false)));
  }

  /** Give all viewports a common target and distance (when opening a map) */
  home(target: THREE.Vector3, dist = 40): void {
    for (const vp of this.list) {
      vp.controls.target.copy(target);
      if (vp.isOrtho) vp.setKind(vp.kind);
      else vp.camera.position.copy(target).add(new THREE.Vector3(0.62, 0.68, 0.75).normalize().multiplyScalar(dist));
      vp.controls.update();
    }
  }

  setActive(vp: Viewport): void {
    this.active = vp;
    for (const v of this.list) v.el.classList.toggle('active', v === vp);
  }

  setLayout(l: Layout): void { this.layout = l; this.maxed = null; this.resize(); this.list.forEach((v) => v.buildBar()); this.onLayout?.(); }
  toggleMax(vp: Viewport): void {
    if (this.layout === 'one') { this.setLayout('four'); return; }
    this.maxed = this.maxed === vp ? null : vp;
    this.resize();
    this.list.forEach((v) => v.buildBar());
  }

  /** Visible viewports */
  visible(): Viewport[] {
    if (this.maxed) return [this.maxed];
    return this.layout === 'one' ? [this.list[0]] : this.layout === 'two' ? this.list.slice(0, 2) : this.list;
  }

  resize(): void {
    const W = this.el.clientWidth, H = this.el.clientHeight;
    this.renderer.setSize(W, H, false);
    const vis = this.visible();
    const g = 2;
    for (const vp of this.list) vp.el.style.display = vis.includes(vp) ? '' : 'none';
    vis.forEach((vp, i) => {
      let x = 0, y = 0, w = W, hh = H;
      if (vis.length === 2) { w = (W - g) / 2; x = i * (w + g); }
      else if (vis.length === 4) { w = (W - g) / 2; hh = (H - g) / 2; x = (i % 2) * (w + g); y = Math.floor(i / 2) * (hh + g); }
      Object.assign(vp.rect, { x, y, w, h: hh });
      Object.assign(vp.el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${hh}px` });
      vp.resizeCamera();
    });
    if (!vis.includes(this.active)) this.setActive(vis[0]);
  }

  /** Switch to drawing a viewport: rectangle in buffer pixels */
  begin(vp: Viewport): void {
    const H = this.el.clientHeight;
    const r = vp.rect;
    this.renderer.setViewport(r.x, H - r.y - r.h, r.w, r.h);
    this.renderer.setScissor(r.x, H - r.y - r.h, r.w, r.h);
    this.renderer.setScissorTest(this.visible().length > 1);
  }

  /** The viewport under a screen point and the normalised coordinates inside it */
  pick(clientX: number, clientY: number, vp?: Viewport): { vp: Viewport; ndc: THREE.Vector2 } | null {
    const box = this.el.getBoundingClientRect();
    const x = clientX - box.left, y = clientY - box.top;
    const v = vp ?? this.visible().find((v) => x >= v.rect.x && x <= v.rect.x + v.rect.w && y >= v.rect.y && y <= v.rect.y + v.rect.h);
    if (!v) return null;
    return { vp: v, ndc: new THREE.Vector2(((x - v.rect.x) / v.rect.w) * 2 - 1, -((y - v.rect.y) / v.rect.h) * 2 + 1) };
  }

  update(dt: number): void { for (const vp of this.visible()) vp.update(dt); }
}
