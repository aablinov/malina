import * as THREE from 'three';
import type { FX } from '../fx';
import { iconCanvas } from '../icons';
import { itemDef, RARITY } from '../items';
import { additiveSprite, glowTex, groundGlow, lightBeam, raysTex } from '../loot-look';
import { bossSfx } from './boss-audio';
import { C, glowMat, RASP, UNIT } from './kit';

/**
 * Гримуар со стража (wiki/design-spells.md, раздел 1): столб света, замедление, хор; книга поднимается из лопнувшего
 * сердца, парит и листает страницы. Подойти — забрать. В паре (выбор из двух у боссов) взял один — второй гаснет.
 */

const RISE = 1.6;
const PAGES = 5;

export class Grimoire {
  readonly group = new THREE.Group();
  readonly pos: THREE.Vector3;
  taken = false;
  /** Пара: взял этот — остальные гаснут */
  siblings: Grimoire[] = [];
  private t = 0;
  private pageT = 0;
  private gone = 0;
  private readonly book = new THREE.Group();
  private readonly pages: THREE.Group[] = [];
  private readonly beam: ReturnType<typeof lightBeam>;
  private readonly floor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly rays: THREE.Sprite;
  private readonly mats: THREE.Material[] = [];

  constructor(private readonly scene: THREE.Scene, private readonly fx: FX, at: THREE.Vector3, readonly item: string, readonly power: number, private readonly quiet: () => boolean) {
    this.pos = at.clone();
    const def = itemDef(item);
    const c = new THREE.Color(RARITY[def.rarity].color);
    this.group.position.copy(at);
    // переплёт: тёмно-малиновая кожа, золотые уголки, на обложке — иконка заклинания, корешок светится
    const leather = new THREE.MeshLambertMaterial({ color: '#5a1430' });
    const gold = new THREE.MeshLambertMaterial({ color: '#e8b84a', emissive: '#6a4a10' });
    const paper = new THREE.MeshLambertMaterial({ color: '#f4ead2', side: THREE.DoubleSide });
    const spine = glowMat(RASP);
    const tex = new THREE.CanvasTexture(iconCanvas(def.icon));
    tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
    const cover = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
    this.mats.push(leather, gold, paper, spine, cover);
    const add = (m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, parent: THREE.Object3D = this.book) => {
      const b = new THREE.Mesh(UNIT, m); b.scale.set(w, h, d); b.position.set(x, y, z); parent.add(b); return b;
    };
    // книга раскрыта: две крышки под углом, между ними листы
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
      // лист на петле вдоль корешка (ось Z): поворот петли переносит его справа налево
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
    // свет: столб цвета редкости с малиновой сердцевиной, лучи за книгой, ореол на полу
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
    // событие: замедление, засветка, хор, искры из сердца
    fx.slowmo = Math.max(fx.slowmo, 0.5);
    fx.screenFlash('#ffd0e0', 0.35, 0.3);
    fx.light(at.clone().setY(2), '#ffb0d0', 10, 12, 2.5);
    fx.burst(at.clone().setY(1.2), [RASP, C(4, 3, 1.6), c.clone().multiplyScalar(2.5)], 40, { speed: 5, up: 5, size: 0.1, life: 1.2, glow: true, gravity: 3 });
    if (!quiet()) bossSfx.choir();
  }

  /** Кадр; true — герой забрал книгу сейчас */
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
    // страницы: раз в 0,7 с одна переворачивается слева направо
    this.pageT -= dt;
    if (this.pageT <= 0 && up >= 1) { this.pageT = 0.7; const p = this.pages.find((x) => !x.visible); if (p) { p.visible = true; p.userData.t = 0; if (!this.quiet() && Math.random() < 0.5) bossSfx.page(); } }
    for (const p of this.pages) if (p.visible) {
      p.userData.t += dt;
      const k = Math.min(1, p.userData.t / 0.6);
      p.rotation.z = 0.28 + k * (Math.PI - 0.56);
      p.position.y = 0.08 + Math.sin(k * Math.PI) * 0.12;
      if (k >= 1) p.visible = false;
    }
    if (Math.random() < 0.3) this.fx.particle({ pos: this.group.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, this.book.position.y + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 1.2)), vel: new THREE.Vector3(0, 0.8, 0), life: 0.9, size: 0.06, color: RASP, gravity: -0.5 });
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
    for (const m of this.mats) m.dispose();
    for (const m of this.beam.mats) m.dispose();
  }
}
