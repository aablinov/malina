import * as THREE from 'three';
import { itemDef, type Profile } from '../items';
import { emptyInput, Knight } from '../knight';
import { rng, type Textures } from '../textures';
import { getWeapon } from '../weapons';
import { pixelRatio, type Settings } from './settings';

/**
 * Фон меню (wiki/design-main-menu.md): ночной лагерь у костра, как на экране выбора героя в Minecraft Dungeons —
 * поляна из блоков, костёр с искрами, ящики и бочка, бирюзовая дымка; у огня стоит герой в надетом снаряжении.
 * Камера плывёт между видами: «старт» — герой справа от центра у костра, «лагерь» — крупно слева, рядом с гнёздами.
 */
export type MenuView = 'start' | 'lobby';

/** Где стоит герой: справа от костра */
const HERO_X = 2.2;
const VIEWS: Record<MenuView, { pos: THREE.Vector3; look: THREE.Vector3 }> = {
  start: { pos: new THREE.Vector3(-0.6, 4.6, 10.5), look: new THREE.Vector3(-1.2, 0.9, 0) },
  lobby: { pos: new THREE.Vector3(4.4, 2.7, 9.6), look: new THREE.Vector3(4.7, 1.05, 0) },
};

export class MenuScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 120);
  private readonly knight: Knight;
  private readonly fireLight: THREE.PointLight;
  private readonly flames: THREE.Mesh[] = [];
  private readonly embers: THREE.Points;
  private readonly emberV: Float32Array;
  private readonly camPos = VIEWS.start.pos.clone();
  private readonly camLook = VIEWS.start.look.clone();
  private view: MenuView = 'start';
  private raf = 0;
  private last = 0;
  private time = 0;
  private yaw = 0.35;
  private drag: number | null = null;
  private weapon = '';
  private armor = '-';
  private bow = '-';

  constructor(private readonly canvas: HTMLCanvasElement, T: Textures, settings: Settings) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(pixelRatio(settings));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const sky = new THREE.Color('#0d3a4a');
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 14, 34);

    // ночь: голубое небо сверху, лунный свет сбоку, тёплый костёр в центре
    this.scene.add(new THREE.HemisphereLight('#5fb8d0', '#16202a', 0.9));
    const moon = new THREE.DirectionalLight('#9fd8ff', 0.9);
    moon.position.set(-8, 12, 6);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.left = moon.shadow.camera.bottom = -12;
    moon.shadow.camera.right = moon.shadow.camera.top = 12;
    this.scene.add(moon);
    this.fireLight = new THREE.PointLight('#ff9a3c', 26, 13, 1.6);
    this.fireLight.position.set(0, 1.1, 0);
    this.fireLight.castShadow = true;
    this.fireLight.shadow.mapSize.set(512, 512);
    this.scene.add(this.fireLight);

    this.buildGround(T);
    this.buildCamp(T);
    this.embers = this.buildEmbers();
    this.emberV = new Float32Array(this.embers.geometry.getAttribute('position').count);

    this.knight = new Knight(this.scene, T);
    this.knight.place(HERO_X, 0, 0);
    this.knight.yaw = this.yaw;

    canvas.addEventListener('pointerdown', (e) => {
      if (this.view !== 'lobby') return;
      this.drag = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => { if (this.drag !== null) { this.yaw += (e.clientX - this.drag) * 0.012; this.drag = e.clientX; } });
    canvas.addEventListener('pointerup', () => { this.drag = null; });
  }

  /** Поляна 22 × 16 блоков: трава, кое-где земля и тропинка к костру; край уходит в дымку */
  private buildGround(T: Textures): void {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const grass = [T.grassSide, T.grassSide, T.grassTop, T.dirt, T.grassSide, T.grassSide].map((map) => new THREE.MeshLambertMaterial({ map }));
    const path = new THREE.MeshLambertMaterial({ map: T.path });
    const r = rng(11);
    for (let x = -11; x <= 11; x++) for (let z = -9; z <= 6; z++) {
      const nearFire = Math.hypot(x, z) < 1.6;
      const lift = !nearFire && Math.abs(x) > 6 && r() < 0.35 ? 1 : 0;
      const m = new THREE.Mesh(box, nearFire || (z > 1 && Math.abs(x + 1) < 1 && r() < 0.8) ? path : grass);
      m.position.set(x, -0.5 + lift, z);
      m.receiveShadow = true;
      this.scene.add(m);
    }
    // пучки травы: два скрещённых квада
    const tuft = new THREE.MeshLambertMaterial({ map: T.tallGrass, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
    const quad = new THREE.PlaneGeometry(0.9, 0.9);
    for (let i = 0; i < 70; i++) {
      const x = (r() - 0.5) * 20, z = -8 + r() * 13;
      if (Math.hypot(x, z) < 2.2 || Math.hypot(x - HERO_X, z) < 1.2) continue;
      for (const a of [0, Math.PI / 2]) {
        const q = new THREE.Mesh(quad, tuft);
        q.position.set(x, 0.42, z);
        q.rotation.y = a + r();
        this.scene.add(q);
      }
    }
  }

  /** Костёр из брёвен с языками огня, ящики, бочка, пни — лагерь героя */
  private buildCamp(T: Textures): void {
    const log = new THREE.MeshLambertMaterial({ map: T.logSide });
    const logGeo = new THREE.BoxGeometry(1.3, 0.22, 0.22);
    for (let i = 0; i < 4; i++) {
      const l = new THREE.Mesh(logGeo, log);
      l.position.set(0, 0.12 + (i % 2) * 0.16, 0);
      l.rotation.y = (i * Math.PI) / 4;
      l.castShadow = true;
      this.scene.add(l);
    }
    const stone = new THREE.MeshLambertMaterial({ map: T.stone, color: '#8a8a8a' });
    const pebble = new THREE.BoxGeometry(0.3, 0.2, 0.3);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2, s = new THREE.Mesh(pebble, stone);
      s.position.set(Math.cos(a) * 0.85, 0.1, Math.sin(a) * 0.85);
      s.rotation.y = a;
      this.scene.add(s);
    }
    const flameMat = [
      new THREE.MeshBasicMaterial({ color: '#ff5a1f', transparent: true, opacity: 0.9 }),
      new THREE.MeshBasicMaterial({ color: '#ffb340', transparent: true, opacity: 0.9 }),
      new THREE.MeshBasicMaterial({ color: '#fff1a8', transparent: true, opacity: 0.95 }),
    ];
    const fg = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 7; i++) {
      const f = new THREE.Mesh(fg, flameMat[i % 3]);
      f.userData.base = { x: (Math.random() - 0.5) * 0.45, z: (Math.random() - 0.5) * 0.45, s: 0.14 + (i % 3 === 2 ? 0 : 0.09), ph: Math.random() * 6 };
      this.flames.push(f);
      this.scene.add(f);
    }
    // ящики и бочка за спиной, как на складе лагеря
    const crate = new THREE.MeshLambertMaterial({ map: T.crate });
    const planks = new THREE.MeshLambertMaterial({ map: T.planksDark });
    const props: [THREE.BufferGeometry, THREE.Material, number, number, number, number][] = [
      [new THREE.BoxGeometry(1, 1, 1), crate, -4.5, 0.5, -3.5, 0.3],
      [new THREE.BoxGeometry(1, 1, 1), crate, -3.4, 0.5, -4.2, -0.2],
      [new THREE.BoxGeometry(0.8, 0.8, 0.8), crate, -4.1, 1.4, -3.8, 0.6],
      [new THREE.CylinderGeometry(0.45, 0.45, 1.1, 10), planks, 6.6, 0.55, -3.2, 0],
      [new THREE.BoxGeometry(1.6, 0.5, 0.6), planks, 2, 0.25, -2.6, 0.3],
      [new THREE.CylinderGeometry(0.35, 0.4, 0.5, 8), log, -1.6, 0.25, 1.4, 0],
    ];
    for (const [g, m, x, y, z, ry] of props) {
      const o = new THREE.Mesh(g, m);
      o.position.set(x, y, z);
      o.rotation.y = ry;
      o.castShadow = o.receiveShadow = true;
      this.scene.add(o);
    }
  }

  private buildEmbers(): THREE.Points {
    const n = 40, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 0.6; pos[i * 3 + 1] = Math.random() * 3; pos[i * 3 + 2] = (Math.random() - 0.5) * 0.6; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffb35a', size: 0.08, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scene.add(p);
    return p;
  }

  setView(v: MenuView): void { this.view = v; }

  /** Надеть на героя то, что надето в профиле: оружие, броня, лук */
  dress(p: Profile): void {
    const m = p.equipped('melee');
    const w = m ? getWeapon(itemDef(m.def).weapon ?? '') : undefined;
    if (w && w.id !== this.weapon) { this.weapon = w.id; this.knight.setWeapon(w); }
    const a = p.equipped('armor');
    if ((a?.def ?? '') !== this.armor) { this.armor = a?.def ?? ''; this.knight.setArmor(a ? itemDef(a.def).armor?.look ?? null : null); }
    const r = p.equipped('ranged');
    if ((r?.def ?? '') !== this.bow) { this.bow = r?.def ?? ''; this.knight.setBow(r ? itemDef(r.def).ranged?.look ?? null : null); }
  }

  start(): void {
    cancelAnimationFrame(this.raf);
    this.last = performance.now();
    const input = emptyInput();
    const loop = (): void => {
      this.raf = requestAnimationFrame(loop);
      const now = performance.now(), dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.time += dt;
      this.fit();
      this.animateFire(dt);
      // камера плывёт к виду и чуть покачивается
      const v = VIEWS[this.view], k = 1 - Math.exp(-dt * 2.5);
      this.camPos.lerp(v.pos, k);
      this.camLook.lerp(v.look, k);
      this.camera.position.copy(this.camPos).add(new THREE.Vector3(Math.sin(this.time * 0.3) * 0.15, Math.sin(this.time * 0.2) * 0.08, 0));
      this.camera.lookAt(this.camLook);
      // герой: у костра смотрит в огонь, в лагере медленно поворачивается к камере (тянуть мышью — крутить)
      if (this.view === 'start') this.yaw += (-Math.PI / 2 + 0.6 - this.yaw) * k;
      else if (this.drag === null) this.yaw += dt * 0.3;
      input.aim.set(HERO_X + Math.sin(this.yaw) * 5, 0, Math.cos(this.yaw) * 5);
      this.knight.yaw = this.yaw;
      this.knight.update(dt, input, []);
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  stop(): void { cancelAnimationFrame(this.raf); }

  private fit(): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight, pr = this.renderer.getPixelRatio();
    if (!w || !h || (this.canvas.width === Math.round(w * pr) && this.canvas.height === Math.round(h * pr))) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private animateFire(dt: number): void {
    const t = this.time;
    this.fireLight.intensity = 22 + Math.sin(t * 13) * 3 + Math.sin(t * 7.3) * 4;
    for (const f of this.flames) {
      const b = f.userData.base as { x: number; z: number; s: number; ph: number };
      const h = 0.5 + 0.35 * (0.5 + 0.5 * Math.sin(t * 9 + b.ph));
      f.scale.set(b.s, h * (b.s * 3), b.s);
      f.position.set(b.x, 0.25 + (h * b.s * 3) / 2, b.z);
      f.rotation.y = t * 1.5 + b.ph;
    }
    const pos = this.embers.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      this.emberV[i] = (this.emberV[i] || 0.6 + Math.random() * 0.8);
      let y = pos.getY(i) + this.emberV[i] * dt;
      if (y > 3.2) { y = 0.3; pos.setX(i, (Math.random() - 0.5) * 0.6); pos.setZ(i, (Math.random() - 0.5) * 0.6); }
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(t * 2 + i) * dt * 0.15);
    }
    pos.needsUpdate = true;
  }
}
