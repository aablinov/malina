import * as THREE from 'three';
import { rnd } from '../rng.ts';
import type { FX } from '../fx.ts';
import { iconCanvas } from '../icons.ts';
import { itemDef, RARITY } from '../items.ts';
import { additiveSprite, glowTex, groundGlow, lightBeam, raysTex } from '../loot-look.ts';
import { bossSfx } from './boss-audio.ts';
import { C, glowMat, RASP, UNIT } from './kit.ts';

/**
 * Grimoire from a warden (wiki/design-spells.md, section 1): a pillar of light, slow motion, a choir; the book rises from the burst
 * heart, hovers and turns its pages. Walk up to take it. In a pair (choice of two at bosses) taking one fades the other.
 */

const RISE = 1.6;
const PAGES = 5;

/** Binding shared by all books: materials and covers live for the whole session (warmed up in src/fx-zoo.ts) */
let book: { leather: THREE.MeshLambertMaterial; gold: THREE.MeshLambertMaterial; paper: THREE.MeshLambertMaterial; spine: THREE.MeshBasicMaterial } | null = null;
export function bookMats(): NonNullable<typeof book> {
  return book ??= {
    leather: new THREE.MeshLambertMaterial({ color: '#5a1430' }),
    gold: new THREE.MeshLambertMaterial({ color: '#e8b84a', emissive: '#6a4a10' }),
    paper: new THREE.MeshLambertMaterial({ color: '#f4ead2', side: THREE.DoubleSide }),
    spine: glowMat(RASP),
  };
}
const covers = new Map<string, THREE.MeshBasicMaterial>();
/** Cover with the spell icon: one texture per icon */
export function coverMat(icon: string): THREE.MeshBasicMaterial {
  let m = covers.get(icon);
  if (!m) {
    const tex = new THREE.CanvasTexture(iconCanvas(icon));
    tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
    covers.set(icon, m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
  }
  return m;
}

export class Grimoire {
  readonly group = new THREE.Group();
  readonly pos: THREE.Vector3;
  taken = false;
  /** Pair: took this one — the others fade */
  siblings: Grimoire[] = [];
  private t = 0;
  private pageT = 0;
  private gone = 0;
  private readonly book = new THREE.Group();
  private readonly pages: THREE.Group[] = [];
  private readonly beam: ReturnType<typeof lightBeam>;
  private readonly floor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly rays: THREE.Sprite;

  private readonly scene: THREE.Scene;
  private readonly fx: FX;
  readonly item: string;
  readonly power: number;
  private readonly quiet: () => boolean;
  constructor(scene: THREE.Scene, fx: FX, at: THREE.Vector3, item: string, power: number, quiet: () => boolean) { this.scene = scene; this.fx = fx; this.item = item; this.power = power; this.quiet = quiet;
    this.pos = at.clone();
    const def = itemDef(item);
    const c = new THREE.Color(RARITY[def.rarity].color);
    this.group.position.copy(at);
    // binding: dark raspberry leather, gold corners, the spell icon on the cover, the spine glows
    const { leather, gold, paper, spine } = bookMats();
    const cover = coverMat(def.icon);
    const add = (m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, parent: THREE.Object3D = this.book) => {
      const b = new THREE.Mesh(UNIT, m); b.scale.set(w, h, d); b.position.set(x, y, z); parent.add(b); return b;
    };
    // the book is open: two covers at an angle, sheets between them
    for (const s of [-1, 1]) {
      const half = new THREE.Group();
      half.rotation.z = s * 0.28;
      this.book.add(half);
      add(leather, 0.42, 0.05, 0.56, s * 0.22, 0, 0, half);
      add(paper, 0.38, 0.06, 0.5, s * 0.2, 0.04, 0, half);
      for (const z of [-0.26, 0.26]) add(gold, 0.08, 0.06, 0.06, s * 0.4, 0, z, half);
      if (s > 0) {
        const ico = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), cover);
        ico.rotation.x = Math.PI / 2; ico.position.set(0.22, -0.03, 0); half.add(ico);
      }
    }
    add(spine, 0.06, 0.08, 0.58, 0, -0.02, 0);
    for (let i = 0; i < PAGES; i++) {
      // a sheet on a hinge along the spine (Z axis): rotating the hinge carries it from right to left
      const p = new THREE.Group();
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.48), paper);
      sheet.rotation.x = -Math.PI / 2;
      sheet.position.x = 0.19;
      p.add(sheet);
      p.position.y = 0.08;
      p.visible = false;
      this.book.add(p);
      this.pages.push(p);
    }
    this.book.rotation.x = -0.5;
    this.book.scale.setScalar(1.8);
    this.group.add(this.book);
    // light: a pillar in the rarity colour with a raspberry core, rays behind the book, a halo on the floor
    this.beam = lightBeam(c.clone().lerp(RASP, 0.35).multiplyScalar(1.1), 9, 1.6);
    this.group.add(this.beam.group);
    this.rays = new THREE.Sprite(additiveSprite(raysTex(), c.clone().multiplyScalar(1.6), 0.9));
    this.rays.renderOrder = 5;
    this.group.add(this.rays);
    const halo = new THREE.Sprite(additiveSprite(glowTex(), RASP.clone().multiplyScalar(0.25), 0.6));
    halo.scale.setScalar(1.4);
    this.book.add(halo);
    this.floor = groundGlow(c.clone().multiplyScalar(1.3), 3.2);
    this.floor.position.y = 0.03;
    this.group.add(this.floor);
    scene.add(this.group);
    // event: slow motion, flash, choir, sparks from the heart
    fx.slowmo = Math.max(fx.slowmo, 0.5);
    fx.screenFlash('#ffd0e0', 0.35, 0.3);
    fx.light(at.clone().setY(2), '#ffb0d0', 10, 12, 2.5);
    fx.burst(at.clone().setY(1.2), [RASP, C(4, 3, 1.6), c.clone().multiplyScalar(2.5)], 40, { speed: 5, up: 5, size: 0.1, life: 1.2, glow: true, gravity: 3 });
    if (!quiet()) bossSfx.choir();
  }

  /** Frame; true — the hero took the book just now */
  update(dt: number, hero: THREE.Vector3): boolean {
    this.t += dt;
    const t = this.t;
    if (this.gone > 0) {
      this.gone -= dt;
      const k = Math.max(0, this.gone / 0.6);
      this.group.scale.setScalar(k);
      if (this.gone <= 0) this.dispose();
      return false;
    }
    const up = Math.min(1, t / RISE), e = 1 - (1 - up) ** 3;
    this.book.position.y = 0.3 + e * 1.1 + Math.sin(t * 2) * 0.08;
    this.book.rotation.y = t * 0.6;
    this.beam.group.scale.set(1, e, 1);
    for (const m of this.beam.mats) m.opacity = 0.7 + Math.sin(t * 3) * 0.2;
    this.rays.position.y = this.book.position.y;
    this.rays.scale.setScalar(2.6 + Math.sin(t * 2.5) * 0.3);
    this.rays.material.rotation = t * 0.7;
    this.floor.material.opacity = 0.6 + Math.sin(t * 3) * 0.2;
    // pages: every 0.7 s one turns from left to right
    this.pageT -= dt;
    if (this.pageT <= 0 && up >= 1) { this.pageT = 0.7; const p = this.pages.find((x) => !x.visible); if (p) { p.visible = true; p.userData.t = 0; if (!this.quiet() && rnd() < 0.5) bossSfx.page(); } }
    for (const p of this.pages) if (p.visible) {
      p.userData.t += dt;
      const k = Math.min(1, p.userData.t / 0.6);
      p.rotation.z = 0.28 + k * (Math.PI - 0.56);
      p.position.y = 0.08 + Math.sin(k * Math.PI) * 0.12;
      if (k >= 1) p.visible = false;
    }
    if (rnd() < 0.3) this.fx.particle({ pos: this.group.position.clone().add(new THREE.Vector3((rnd() - 0.5) * 1.2, this.book.position.y + (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 1.2)), vel: new THREE.Vector3(0, 0.8, 0), life: 0.9, size: 0.06, color: RASP, gravity: -0.5 });
    if (up >= 1 && Math.hypot(hero.x - this.pos.x, hero.z - this.pos.z) < 1.3) { this.take(); return true; }
    return false;
  }

  take(): void {
    if (this.taken) return;
    this.taken = true;
    this.gone = 0.6;
    this.fx.burst(this.group.position.clone().setY(this.book.position.y), [RASP, C(4, 3.4, 2)], 30, { speed: 4, up: 3, size: 0.08, life: 0.7, glow: true, gravity: 2 });
    if (!this.quiet()) bossSfx.take();
    for (const s of this.siblings) if (!s.taken) { s.taken = true; s.gone = 0.6; }
  }

  get done(): boolean { return this.taken && this.gone <= 0; }

  dispose(): void {
    this.scene.remove(this.group);
    for (const m of this.beam.mats) m.dispose();
  }
}
