import * as THREE from 'three';
import { C, glowMat, UNIT } from '../../bosses/kit.ts';
import type { FX } from '../../fx.ts';
import type { EntityState } from '../../net/snapshot.ts';
import type { TowerEnt } from '../../sim/entities.ts';
import type { SimEvent } from '../../sim/events.ts';
import { HpBar } from '../../td/hpbar.ts';
import { HEAD_Y, LEVEL_RISE, TOWERS, UPGRADE_RANGE, type TowerKind } from '../../td/towers.ts';
import { pixelTex } from '../../textures.ts';
import { ARCANE, ARCANE_DEEP, EMBER, FIRE, ICE, ICE_DEEP, IRON, SNOW, STAR, STAR_DEEP, STONE, STONE_DARK, TAR, VOLT, WOOD, WOOD_DARK } from './colors.ts';

/** Width of the tower body under the head, m */
const WIDTH: Partial<Record<TowerKind, number>> = { splash: 1.5, ballista: 1.5, oil: 1.35, frost: 1.1, magic: 1.1, storm: 1.1, winter: 1.3 };
/** A ray of a channelling tower: an open cylinder of height 1 standing on the origin — stretched from the heart to the target */
const BEAM = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
const UP = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
interface Beam { halo: THREE.Mesh; core: THREE.Mesh; to: THREE.Vector3; cur: THREE.Vector3; t: number }

/**
 * Defence tower — view (`t<pad>`): a model of cubes per kind and level (src/td/towers.ts) — the body tells the level (timber, stone keep,
 * blue stone with a rune halo), the head tells the kind; the turning part looks along `yaw` from the record, ice when `frozen`, ruins at
 * `hp ≤ 0`, a health bar. Every head has parts that keep turning (`spins`) and spin up while the tower fires (`heat`, from `tower.fire`);
 * the frost spire and the arcane obelisk hold rays on their targets (`beams`). Recoil is its own, from the same event.
 * Logic (targets, shots, damage) is in src/sim/tower.ts; sparks and sound of shots and hits — src/cgame/effects.ts
 */
export class TowerView {
  readonly pos: THREE.Vector3;
  readonly group = new THREE.Group();
  kind: TowerKind;
  level = 1;
  private hp: number;
  private maxHp: number;
  private frozen = 0;
  private ruined = false;
  private readonly iceMesh: THREE.Mesh;
  private readonly bar = new HpBar(1.6, 4.4);
  private time = 0;
  private readonly body = new THREE.Group();
  /** Turning part (crossbow, lever, crystal) — looks at the target */
  private readonly turret = new THREE.Group();
  /** Moving piece inside the turning part: the catapult lever, the floating rune */
  private readonly arm = new THREE.Group();
  private readonly lamps: THREE.MeshLambertMaterial[] = [];
  private readonly glows: THREE.MeshBasicMaterial[] = [];
  private recoil = 0;
  /** 0..1: rises with every shot, cools in under a second — how fast the turning parts spin */
  private heat = 0;
  private ramp = 0;
  private readonly spins: { o: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number; boost: number }[] = [];
  private readonly beams: Beam[] = [];

  private readonly scene: THREE.Scene;
  private readonly fx: FX;
  constructor(scene: THREE.Scene, fx: FX, ent: EntityState) { this.scene = scene; this.fx = fx;
    const e = ent as TowerEnt;
    this.kind = (e.kind in TOWERS ? e.kind : 'arrow') as TowerKind;
    this.level = e.level;
    this.hp = e.hp; this.maxHp = e.maxHp;
    this.pos = new THREE.Vector3(e.x, e.y, e.z);
    this.group.position.copy(this.pos);
    this.group.add(this.body);
    this.build();
    this.iceMesh = new THREE.Mesh(UNIT, new THREE.MeshLambertMaterial({ color: '#bfe8ff', emissive: '#3a7aa8', transparent: true, opacity: 0.55 }));
    this.iceMesh.scale.set(2.1, 3.6, 2.1);
    this.iceMesh.position.y = 1.9;
    this.iceMesh.visible = false;
    this.group.add(this.iceMesh, this.bar.group);
    scene.add(this.group);
    this.set(ent);
  }

  get range(): number { return TOWERS[this.kind].range + UPGRADE_RANGE[this.level - 1]; }
  /** Height of the turning head (as the muzzle in src/sim/tower.ts) */
  get headY(): number { return HEAD_Y[this.kind] + (this.level - 1) * LEVEL_RISE; }

  set(ent: EntityState): void {
    const e = ent as TowerEnt;
    const kind = (e.kind in TOWERS ? e.kind : 'arrow') as TowerKind;
    if (kind !== this.kind || e.level !== this.level) { this.kind = kind; this.level = e.level; this.build(); if (this.ruined) this.pose(true); }
    this.hp = e.hp; this.maxHp = e.maxHp;
    this.frozen = e.frozen;
    this.iceMesh.visible = this.frozen > 0;
    this.turret.rotation.y = e.yaw;
    const ruined = e.hp <= 0;
    if (ruined !== this.ruined) { this.ruined = ruined; this.pose(ruined); }
    this.bar.set(this.maxHp > 0 ? this.hp / this.maxHp : 0, !this.ruined && this.hp < this.maxHp);
  }

  /** Ruins: the body leans, the lamps are out; repaired — everything back in place */
  private pose(ruined: boolean): void {
    this.body.rotation.z = ruined ? 0.22 : 0;
    this.turret.rotation.x = ruined ? 0.4 : 0;
    for (const m of this.lamps) m.color.setScalar(ruined ? 0.3 : 1);
    for (const m of this.glows) m.visible = !ruined;
  }

  onEvent(e: SimEvent): void {
    if (e.t !== 'tower.fire') return;
    this.recoil = 1;
    this.heat = Math.min(1.4, this.heat + (this.kind === 'frost' || this.kind === 'magic' ? 0.5 : 0.8));
    if (this.kind === 'frost' || this.kind === 'magic') this.aimBeams(e);
  }

  dispose(): void {
    this.bar.dispose();
    (this.iceMesh.material as THREE.Material).dispose();
    this.scene.remove(this.group);
    for (const b of this.beams) { this.scene.remove(b.halo, b.core); (b.halo.material as THREE.Material).dispose(); (b.core.material as THREE.Material).dispose(); }
    for (const m of this.lamps) m.dispose();
    for (const m of this.glows) m.dispose();
  }

  // ---------- model ----------
  private lam(color: string, tex = true, seed = 0): THREE.MeshLambertMaterial {
    const m = new THREE.MeshLambertMaterial(tex ? { map: pixelTex(color, 10, 900 + seed + this.lamps.length) } : { color });
    this.lamps.push(m);
    return m;
  }
  private glow(c: THREE.Color): THREE.MeshBasicMaterial { const m = glowMat(c); this.glows.push(m); return m; }
  private box(parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh {
    const m = new THREE.Mesh(UNIT, mat);
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = !(mat instanceof THREE.MeshBasicMaterial);
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  /** A group at a point of `parent` that keeps turning about `axis`: `speed` rad/s at rest, plus `boost` while the tower fires */
  private spinner(parent: THREE.Object3D, axis: 'x' | 'y' | 'z', speed: number, boost: number, x = 0, y = 0, z = 0): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    this.spins.push({ o: g, axis, speed, boost });
    return g;
  }
  /** n boxes in a circle of radius r in the XZ plane of `g` (shards, rune stones, planets, coals) */
  private ringOf(g: THREE.Object3D, mats: THREE.Material[], n: number, r: number, w: number, h: number, tilt = 0.3): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.box(g, mats[i % mats.length], w, h, w, Math.cos(a) * r, 0, Math.sin(a) * r, tilt, a, tilt);
    }
  }
  /** A toothed wheel in the YZ plane of `g`: a hub and crossed spokes — reads as a gear when it turns */
  private wheel(g: THREE.Object3D, mat: THREE.Material, r: number, thick = 0.08): void {
    for (let i = 0; i < 3; i++) this.box(g, mat, thick, r * 2, r * 0.36, 0, 0, 0, (i * Math.PI) / 3, 0, 0);
    this.box(g, mat, thick * 1.5, r * 0.6, r * 0.6);
  }

  /** Rebuild the model (build, upgrade) */
  private build(): void {
    const yaw = this.turret.rotation.y;
    this.body.clear();
    this.turret.clear();
    this.arm.clear();
    this.spins.length = 0;
    this.arm.position.set(0, 0, 0); this.arm.rotation.set(0, 0, 0); this.arm.scale.setScalar(1); this.arm.visible = true;
    this.turret.position.set(0, 0, 0); this.turret.rotation.set(0, yaw, 0);
    for (const m of this.lamps.splice(0)) m.dispose();
    for (const m of this.glows.splice(0)) m.dispose();
    const B = this.box.bind(this);
    const stone = this.lam(STONE), dark = this.lam(STONE_DARK);
    // stone footing: an octagon of two rotated slabs and a rim
    B(this.body, dark, 2.2, 0.3, 2.2, 0, 0.15, 0);
    B(this.body, dark, 2.2, 0.3, 2.2, 0, 0.15, 0, 0, Math.PI / 4, 0);
    B(this.body, stone, 1.7, 0.2, 1.7, 0, 0.4, 0);
    B(this.body, stone, 1.7, 0.2, 1.7, 0, 0.4, 0, 0, Math.PI / 4, 0);
    const H = this.headY;
    this.buildBody(H, WIDTH[this.kind] ?? 1.25);
    this.turret.position.set(0, H, 0);
    this.body.add(this.turret);
    switch (this.kind) {
      case 'frost': this.buildFrost(); break;
      case 'splash': this.buildSplash(); break;
      case 'fire': this.buildFire(); break;
      case 'magic': this.buildMagic(); break;
      case 'ballista': this.buildBallista(); break;
      case 'oil': this.buildOil(); break;
      case 'meteor': this.buildMeteor(); break;
      case 'storm': this.buildStorm(); break;
      case 'winter': this.buildWinter(); break;
      default: this.buildArrow(); break;
    }
    // level mark: raspberry lamp berries on the footing corners — one, two
    const berry = this.glow(C(3.2, 0.5, 1.2));
    for (let i = 0; i < this.level - 1; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      B(this.body, berry, 0.16, 0.16, 0.16, Math.cos(a) * 1.05, 0.58, Math.sin(a) * 1.05);
    }
  }

  /**
   * The tower body under the head, from the footing up to H — it tells the level at a glance:
   * I — a timber frame with plank walls; II — a stone keep with iron bands and merlons; III — tall blue stone with slits glowing in
   * the tower colour, lamps on the merlons, a banner and a halo of rune stones turning around it
   */
  private buildBody(H: number, w: number): void {
    const B = this.box.bind(this), y0 = 0.5, h = H - y0, mid = y0 + h / 2, e = w / 2;
    const corners: [number, number][] = [[-e, -e], [e, -e], [-e, e], [e, e]];
    const tint = this.glow(new THREE.Color(TOWERS[this.kind].color).multiplyScalar(1.3));
    if (this.level === 1) {
      const wood = this.lam(WOOD), woodD = this.lam(WOOD_DARK);
      B(this.body, wood, w - 0.12, h, w - 0.12, 0, mid, 0);
      for (const [x, z] of corners) B(this.body, woodD, 0.16, h, 0.16, x, mid, z);
      for (const k of [0.3, 0.75]) { B(this.body, woodD, w + 0.02, 0.08, 0.06, 0, y0 + h * k, e); B(this.body, woodD, w + 0.02, 0.08, 0.06, 0, y0 + h * k, -e); B(this.body, woodD, 0.06, 0.08, w + 0.02, e, y0 + h * k, 0); B(this.body, woodD, 0.06, 0.08, w + 0.02, -e, y0 + h * k, 0); }
      B(this.body, woodD, w + 0.3, 0.12, w + 0.3, 0, H - 0.06, 0);
      return;
    }
    const three = this.level >= 3;
    const wall = this.lam(three ? '#5f7696' : STONE), quoin = this.lam(three ? '#3d4c66' : STONE_DARK), iron = this.lam(IRON, false);
    B(this.body, wall, w, h, w, 0, mid, 0);
    for (const [x, z] of corners) B(this.body, quoin, 0.22, h, 0.22, x, mid, z);
    B(this.body, iron, w + 0.06, 0.1, w + 0.06, 0, y0 + h * 0.45, 0);
    B(this.body, quoin, w + 0.4, 0.14, w + 0.4, 0, H - 0.07, 0);
    const d = e + 0.12;
    for (const [x, z] of [[-d, -d], [d, -d], [-d, d], [d, d]]) B(this.body, wall, 0.24, 0.26, 0.24, x, H + 0.13, z);
    if (!three) return;
    for (const [x, z] of [[0, -d], [0, d], [-d, 0], [d, 0]]) B(this.body, wall, 0.24, 0.2, 0.24, x, H + 0.1, z);
    for (const [x, z] of [[-d, -d], [d, -d], [-d, d], [d, d]]) B(this.body, tint, 0.12, 0.12, 0.12, x, H + 0.32, z);
    // glowing slits on the four faces
    if (h > 0.9) for (const s of [-1, 1]) { B(this.body, tint, 0.14, h * 0.5, 0.04, 0, mid, s * (e + 0.01)); B(this.body, tint, 0.04, h * 0.5, 0.14, s * (e + 0.01), mid, 0); }
    // a halo of rune stones turning around the keep
    this.ringOf(this.spinner(this.body, 'y', 0.7, 2.5, 0, y0 + h * 0.75, 0), [tint], 8, e + 0.55, 0.1, 0.16, 0);
    // banner
    B(this.body, quoin, 0.05, 1.0, 0.05, -d, H + 0.75, d);
    B(this.body, this.lam('#d8285a', false), 0.03, 0.34, 0.5, -d, H + 1.05, d + 0.27);
  }

  /** Archer tower: a swivel with crossbows — one, two at II, three at III; an ammo drum behind turns with every shot, a side gear keeps ticking */
  private buildArrow(): void {
    const B = this.box.bind(this), T = this.turret;
    const wood = this.lam(WOOD), woodD = this.lam(WOOD_DARK), iron = this.lam(IRON, false), tip = this.glow(C(2.4, 2.1, 1.2));
    B(T, iron, 0.2, 0.3, 0.2, 0, 0.15, 0);
    B(T, woodD, 0.9, 0.1, 0.5, 0, 0.32, -0.05);
    T.add(this.arm);
    const xs = this.level === 1 ? [0] : this.level === 2 ? [-0.24, 0.24] : [-0.36, 0, 0.36];
    for (const x of xs) {
      B(this.arm, woodD, 0.12, 0.1, 1.0, x, 0.43, 0.2);
      B(this.arm, iron, 0.6, 0.05, 0.07, x, 0.47, 0.6);
      for (const s of [-1, 1]) B(this.arm, iron, 0.07, 0.05, 0.22, x + s * 0.3, 0.47, 0.5, 0, s * 0.5, 0);
      B(this.arm, this.lam('#e8e0c8', false), 0.56, 0.015, 0.015, x, 0.48, 0.42);
      B(this.arm, tip, 0.04, 0.04, 0.6, x, 0.5, 0.45);
    }
    // ammo drum behind the stocks — turns a notch with every shot
    const drum = this.spinner(T, 'z', 0.4, 16, 0, 0.5, -0.42);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; B(drum, i % 2 ? wood : iron, 0.1, 0.1, 0.3, Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0); }
    B(drum, iron, 0.12, 0.12, 0.34);
    this.wheel(this.spinner(T, 'x', 1.5, 12, 0.52, 0.3, -0.1), iron, 0.2);
    if (this.level >= 2) this.wheel(this.spinner(T, 'x', -1.5, -12, -0.52, 0.3, -0.1), iron, 0.2);
    if (this.level >= 3) { B(T, woodD, 1.3, 0.06, 0.9, 0, 0.95, -0.15, 0.12, 0, 0); for (const s of [-1, 1]) B(T, woodD, 0.06, 0.6, 0.06, s * 0.6, 0.65, -0.5); }
  }

  /** Frost spire: ice claws hold a floating crystal; two rings of shards turn around it in opposite directions (a third at III). The freezing ray comes from the crystal */
  private buildFrost(): void {
    const B = this.box.bind(this), T = this.turret, L = this.level;
    const stone = this.lam('#7f8ea0'), ice = this.glow(ICE.clone().multiplyScalar(0.6)), deep = this.glow(ICE_DEEP.clone().multiplyScalar(0.8)), rime = this.lam('#dceeff', false);
    B(T, stone, 0.8, 0.24, 0.8, 0, 0.12, 0, 0, Math.PI / 4, 0);
    B(T, rime, 0.9, 0.06, 0.9, 0, 0.27, 0);
    for (let i = 0; i < 4; i++) { const a = i * (Math.PI / 2) + Math.PI / 4; B(T, i % 2 ? deep : ice, 0.14, 0.9 + L * 0.1, 0.14, Math.cos(a) * 0.42, 0.65, Math.sin(a) * 0.42, -Math.sin(a) * 0.35, 0, Math.cos(a) * 0.35); }
    this.arm.position.set(0, 1.1, 0);
    T.add(this.arm);
    const core = this.spinner(this.arm, 'y', 0.8, 5);
    B(core, deep, 0.42 + L * 0.05, 0.42 + L * 0.05, 0.42 + L * 0.05, 0, 0, 0, Math.PI / 4, 0, Math.PI / 4);
    B(core, ice, 0.24, 0.9 + L * 0.2, 0.24, 0, 0, 0, 0, Math.PI / 4, 0);
    this.ringOf(this.spinner(this.arm, 'y', 1.5, 6), [ice, deep], 4 + L * 2, 0.75, 0.12, 0.34);
    const tilt = new THREE.Group(); tilt.rotation.x = 0.5; this.arm.add(tilt);
    this.ringOf(this.spinner(tilt, 'y', -2.2, -7), [deep, ice], 3 + L, 0.55, 0.09, 0.24);
    if (L >= 3) { const t2 = new THREE.Group(); t2.rotation.z = 0.6; t2.position.y = 0.2; this.arm.add(t2); this.ringOf(this.spinner(t2, 'y', 3, 8), [ice], 6, 0.95, 0.08, 0.2); }
  }

  /** Catapult: a log frame, a lever with a bucket and a counterweight; winch wheels on both sides wind the lever back after every shot */
  private buildSplash(): void {
    const B = this.box.bind(this), T = this.turret, L = this.level;
    const wood = this.lam(WOOD), woodD = this.lam(WOOD_DARK), iron = this.lam(IRON, false), rock = L >= 3 ? this.glow(EMBER) : this.lam('#6a6a70');
    B(T, woodD, 1.3, 0.16, 0.5, 0, 0.1, -0.2);
    for (const s of [-1, 1]) { B(T, woodD, 0.2, 0.5, 0.2, s * 0.55, 0.3, -0.5); B(T, woodD, 0.16, 1.0, 0.16, s * 0.4, 0.6, -0.2, 0.3, 0, 0); }
    B(T, iron, 1.0, 0.1, 0.1, 0, 1.05, -0.35);
    for (const s of [-1, 1]) this.wheel(this.spinner(T, 'x', 0, 9, s * 0.74, 0.3, -0.2), s > 0 ? wood : woodD, 0.3, 0.1);
    this.arm.position.set(0, 1.05, -0.35);
    T.add(this.arm);
    B(this.arm, wood, 0.14, 0.14, 2.0, 0, 0, 0.4);
    B(this.arm, woodD, 0.44 + L * 0.04, 0.2, 0.44 + L * 0.04, 0, 0.1, 1.35);
    B(this.arm, rock, 0.26 + L * 0.03, 0.26 + L * 0.03, 0.26 + L * 0.03, 0, 0.26, 1.35);
    B(this.arm, iron, 0.5, 0.5, 0.4, 0, -0.1, -0.5);
    if (L >= 2) { B(this.arm, iron, 0.6, 0.6, 0.3, 0, -0.1, -0.75); for (const z of [0, 0.7]) B(this.arm, iron, 0.18, 0.18, 0.08, 0, 0, z); }
    if (L >= 3) B(T, this.lam('#d8285a', false), 0.5, 0.3, 0.03, 0.9, 1.35, -0.4);
    this.arm.rotation.x = 0.7;
    for (const [x, z] of [[0.6, 0.5], [0.45, 0.62], [0.55, 0.6]]) B(T, this.lam('#6a6a70'), 0.22, 0.22, 0.22, x, 0.11, z);
  }

  /** Fire brazier: an iron bowl of embers with a spout (two at II), a ring of coals circling the rim, bellows blades behind — everything spins up when it breathes fire */
  private buildFire(): void {
    const B = this.box.bind(this), T = this.turret, L = this.level;
    const iron = this.lam(IRON, false), coal = this.glow(EMBER.clone().multiplyScalar(0.6)), flame = this.glow(FIRE.clone().multiplyScalar(0.6));
    B(T, iron, 0.4, 0.2, 0.4, 0, 0.1, 0);
    B(T, iron, 1.1, 0.12, 1.1, 0, 0.26, 0);
    for (const s of [-1, 1]) { B(T, iron, 1.2, 0.46, 0.1, 0, 0.5, s * 0.55); B(T, iron, 0.1, 0.46, 1.2, s * 0.55, 0.5, 0); }
    B(T, coal, 0.9, 0.3, 0.9, 0, 0.5, 0);
    T.add(this.arm);
    B(this.arm, flame, 0.5, 0.5 + L * 0.2, 0.5, 0, 0.9, 0, 0, Math.PI / 4, 0);
    B(this.arm, flame, 0.3, 0.9 + L * 0.25, 0.3, 0.1, 1.05, -0.1);
    for (const x of L >= 2 ? [-0.25, 0.25] : [0]) { B(T, iron, 0.3, 0.2, 0.55, x, 0.5, 0.8); B(T, iron, 0.36, 0.26, 0.1, x, 0.5, 1.08); B(T, coal, 0.2, 0.12, 0.04, x, 0.5, 1.14); }
    this.ringOf(this.spinner(T, 'y', 1, 7, 0, 0.82, 0), [coal, flame], 4 + L * 2, 0.72, 0.12, 0.12, 0.6);
    const fan = this.spinner(T, 'z', 2, 22, 0, 0.5, -0.75);
    for (let i = 0; i < 2; i++) B(fan, iron, 0.7, 0.14, 0.05, 0, 0, 0, 0, 0, (i * Math.PI) / 2);
    if (L >= 3) for (const s of [-1, 1]) B(this.arm, flame, 0.2, 0.6, 0.2, s * 0.42, 0.9, -0.42);
  }

  /** Stargazer: an observatory dome with a spyglass; above it an orrery — rings of little planets on different axes (one more with each level) around a star */
  private buildMeteor(): void {
    const B = this.box.bind(this), T = this.turret, L = this.level;
    const brass = this.lam('#d8a040'), dome = this.lam('#3a3a6a'), star = this.glow(STAR), deep = this.glow(STAR_DEEP);
    B(T, dome, 1.3, 0.45, 1.3, 0, 0.22, 0);
    B(T, dome, 0.95, 0.32, 0.95, 0, 0.6, 0);
    B(T, dome, 0.5, 0.2, 0.5, 0, 0.84, 0);
    B(T, brass, 0.26, 0.26, 1.3, 0, 0.45, 0.5, -0.5, 0, 0);
    B(T, star, 0.2, 0.2, 0.06, 0, 0.8, 1.1, -0.5, 0, 0);
    this.arm.position.set(0, 1.6, 0);
    T.add(this.arm);
    B(this.spinner(this.arm, 'y', 1.5, 6), star, 0.34 + L * 0.05, 0.34 + L * 0.05, 0.34 + L * 0.05, 0, 0, 0, Math.PI / 4, 0, Math.PI / 4);
    const tilts = [0.25, -0.7, 1.1];
    for (let i = 0; i < L; i++) {
      const g = new THREE.Group(); g.rotation.z = tilts[i]; this.arm.add(g);
      const r = 0.55 + i * 0.25, ring = this.spinner(g, 'y', (i % 2 ? -1 : 1) * (1.8 - i * 0.3), (i % 2 ? -1 : 1) * 5);
      this.ringOf(ring, [brass], 8, r, 0.05, 0.05, 0);
      this.ringOf(ring, [i % 2 ? star : deep], 1 + i, r, 0.14, 0.14, 0.6);
    }
  }

  /** Storm spire: a coil of copper plates turning in opposite directions (taller with each level), on top a storm ball in a cage of spinning horns */
  private buildStorm(): void {
    const B = this.box.bind(this), T = this.turret, L = this.level;
    const stone = this.lam('#5c6470'), copper = this.lam('#c87a3a'), iron = this.lam(IRON, false), volt = this.glow(VOLT.clone().multiplyScalar(0.42));
    B(T, stone, 0.5, 0.75, 0.5, 0, 0.38, 0);
    const n = 2 + L;
    for (let i = 0; i < n; i++) {
      const y = 0.12 + (i / n) * 0.62, w = 0.92 - (i / n) * 0.3;
      const g = this.spinner(T, 'y', (i % 2 ? -1 : 1) * 1.4, (i % 2 ? -1 : 1) * 9, 0, y, 0);
      B(g, copper, w, 0.07, w); B(g, copper, w * 0.92, 0.07, w * 0.92, 0, 0, 0, 0, Math.PI / 4, 0);
    }
    this.arm.position.set(0, 1.0, 0);
    T.add(this.arm);
    B(this.spinner(this.arm, 'y', 2, 12), volt, 0.36 + L * 0.07, 0.36 + L * 0.07, 0.36 + L * 0.07, 0, 0, 0, Math.PI / 4, 0, Math.PI / 4);
    const cage = this.spinner(this.arm, 'y', -1.2, -10);
    for (let i = 0; i < 2 + L; i++) { const a = (i / (2 + L)) * Math.PI * 2; B(cage, iron, 0.07, 0.7, 0.07, Math.cos(a) * 0.42, -0.1, Math.sin(a) * 0.42, Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45); B(cage, volt, 0.08, 0.08, 0.08, Math.cos(a) * 0.3, 0.28, Math.sin(a) * 0.3); }
  }

  /** Heart of winter: a huge crystal floats over an ice pedestal, two rings of shards circle it on tilted axes (more shards with the level) */
  private buildWinter(): void {
    const B = this.box.bind(this), T = this.turret, L = this.level;
    const rime = this.lam('#dceeff', false), ice = this.glow(SNOW.clone().multiplyScalar(0.34)), deep = this.glow(ICE_DEEP.clone().multiplyScalar(0.6));
    B(T, rime, 1.2, 0.16, 1.2, 0, 0.08, 0, 0, Math.PI / 4, 0);
    for (let i = 0; i < 4; i++) { const a = i * 1.57 + 0.3; B(T, deep, 0.2, 0.7, 0.2, Math.cos(a) * 0.5, 0.4, Math.sin(a) * 0.5, Math.sin(a) * 0.3, a, Math.cos(a) * 0.3); }
    this.arm.position.set(0, 1.5, 0);
    T.add(this.arm);
    const core = this.spinner(this.arm, 'y', 0.6, 3);
    B(core, ice, 0.7, 1.3 + L * 0.15, 0.7, 0, 0, 0, 0, Math.PI / 4, 0);
    B(core, deep, 0.4, 0.4, 0.4, 0, 0.85 + L * 0.08, 0, 0, Math.PI / 4, 0);
    B(core, deep, 0.4, 0.4, 0.4, 0, -0.85 - L * 0.08, 0, 0, Math.PI / 4, 0);
    const t1 = new THREE.Group(); t1.rotation.x = 0.35; this.arm.add(t1);
    this.ringOf(this.spinner(t1, 'y', 1.3, 5), [ice, deep], 4 + L * 2, 1.1, 0.14, 0.32);
    const t2 = new THREE.Group(); t2.rotation.z = -0.5; this.arm.add(t2);
    this.ringOf(this.spinner(t2, 'y', -1.9, -6), [deep, ice], 2 + L * 2, 0.8, 0.1, 0.24);
  }

  /** Arcane obelisk: a carved black needle, over it a rune heart; rune stones orbit it flat and upright (another orbit with each level). The tethers come from the heart */
  private buildMagic(): void {
    const B = this.box.bind(this), T = this.turret, L = this.level;
    const obs = this.lam('#2e2440'), trim = this.glow(ARCANE_DEEP), rune = this.glow(ARCANE);
    B(T, obs, 0.7, 0.2, 0.7, 0, 0.1, 0);
    B(T, obs, 0.42, 0.6, 0.42, 0, 0.5, 0);
    for (const s of [-1, 1]) { B(T, trim, 0.24, 0.05, 0.02, 0, 0.5, s * 0.22); B(T, trim, 0.02, 0.05, 0.24, s * 0.22, 0.5, 0); }
    for (let i = 0; i < 4; i++) { const a = i * 1.57 + 0.4; B(T, obs, 0.16, 0.5 + (i % 2) * 0.25, 0.16, Math.cos(a) * 0.5, 0.3, Math.sin(a) * 0.5, 0.2, a, 0); }
    this.arm.position.set(0, 1.2, 0);
    T.add(this.arm);
    const core = this.spinner(this.arm, 'y', 1.2, 9);
    B(core, rune, 0.32 + L * 0.06, 0.32 + L * 0.06, 0.32 + L * 0.06, 0, 0, 0, Math.PI / 4, 0, Math.PI / 4);
    B(core, trim, 0.56, 0.07, 0.07, 0, 0, 0, 0, Math.PI / 4, 0);
    B(core, trim, 0.07, 0.07, 0.56, 0, 0, 0, 0, Math.PI / 4, 0);
    this.ringOf(this.spinner(this.arm, 'y', -1.6, -7), [rune, trim], 2 + L, 0.6, 0.12, 0.12, 0.7);
    const up = new THREE.Group(); up.rotation.z = Math.PI / 2; this.arm.add(up);
    this.ringOf(this.spinner(up, 'y', 2.2, 9), [trim], 6, 0.48, 0.06, 0.06, 0);
    if (L >= 2) { const g = new THREE.Group(); g.rotation.x = Math.PI / 2; this.arm.add(g); this.ringOf(this.spinner(g, 'y', -2.6, -9), [rune], 6, 0.75, 0.06, 0.06, 0); }
    if (L >= 3) this.ringOf(this.spinner(this.arm, 'y', 0.9, 5, 0, -0.35, 0), [rune, trim], 5, 1.0, 0.14, 0.26, 0.4);
  }

  /** Wall ballista: a heavy bow on a swivel, the bolt lies in the groove; the windlass at the back spins to draw the string after every shot */
  private buildBallista(): void {
    const B = this.box.bind(this), T = this.turret, L = this.level;
    const wood = this.lam(WOOD), woodD = this.lam(WOOD_DARK), iron = this.lam(IRON, false), rope = this.lam('#c8b890', false);
    B(T, iron, 0.3, 0.16, 0.3, 0, 0.08, 0);
    B(T, wood, 0.3, 0.2, 2.0, 0, 0.25, 0.2);
    B(T, iron, 0.18, 0.06, 1.4, 0, 0.38, 0.4);
    for (const s of [-1, 1]) { B(T, woodD, 1.0, 0.1, 0.12, s * 0.65, 0.35, 0.75, 0, 0, s * 0.25); B(T, iron, 0.08, 0.14, 0.14, s * 1.1, 0.35, 0.63); }
    B(T, rope, 2.1, 0.02, 0.02, 0, 0.35, 0.3);
    const crank = this.spinner(T, 'x', 0, 18, 0, 0.4, -0.8);
    this.wheel(crank, iron, 0.24, 0.3);
    for (const s of [-1, 1]) B(crank, woodD, 0.3, 0.07, 0.07, s * 0.3, 0.2, 0);
    this.arm.position.set(0, 0.44, 0.3);
    T.add(this.arm);
    B(this.arm, iron, 0.08, 0.08, 1.2, 0, 0, 0.3);
    B(this.arm, this.glow(C(2.6, 2.2, 1.2)), 0.14, 0.14, 0.2, 0, 0, 0.95);
    if (L >= 2) for (const s of [-1, 1]) { B(T, iron, 0.06, 0.5, 0.5, s * 0.4, 0.5, 0.6); B(T, woodD, 0.8, 0.08, 0.1, s * 0.6, 0.5, 0.7, 0, 0, s * 0.25); }
    if (L >= 3) { B(T, this.lam('#d8285a', false), 0.03, 0.3, 0.5, 0, 0.75, -0.5); this.wheel(this.spinner(T, 'x', 0, -18, 0.4, 0.4, -0.5), iron, 0.18); }
  }

  /** Tar cauldron: a black cauldron over embers with a spout at the target; a paddle keeps stirring the tar, faster right after a ladle is thrown */
  private buildOil(): void {
    const B = this.box.bind(this), T = this.turret, L = this.level;
    const iron = this.lam(IRON, false), coal = this.glow(EMBER), tar = this.lam(TAR, false), wood = this.lam(WOOD_DARK);
    B(T, coal, 0.8, 0.14, 0.8, 0, 0.07, 0);
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; B(T, wood, 0.12, 0.5, 0.12, Math.cos(a) * 0.55, 0.25, Math.sin(a) * 0.55, Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3); }
    T.add(this.arm);
    const w = 1.0 + L * 0.08;
    B(this.arm, iron, w, 0.7, w, 0, 0.55, 0);
    B(this.arm, iron, w + 0.1, 0.12, w + 0.1, 0, 0.95, 0);
    B(this.arm, tar, w - 0.2, 0.08, w - 0.2, 0, 0.98, 0);
    B(this.arm, iron, 0.3, 0.2, 0.5, 0, 0.9, 0.6);
    const paddle = this.spinner(this.arm, 'y', 1.6, 8, 0, 1.05, 0);
    B(paddle, wood, w - 0.3, 0.06, 0.1); B(paddle, wood, 0.08, 0.7, 0.08, 0, 0.3, 0);
    if (L >= 2) B(this.arm, iron, 0.6, 0.6, 0.6, 0, 0.5, 0, 0, Math.PI / 4, 0);
    if (L >= 3) { B(T, this.lam('#d8285a', false), 0.5, 0.3, 0.03, -0.7, 1.7, 0); B(T, wood, 0.05, 1.5, 0.05, -0.95, 1.0, 0); }
  }

  // ---------- frame ----------
  update(dt: number): void {
    this.time += dt;
    this.recoil = Math.max(0, this.recoil - dt * (this.kind === 'splash' ? 1.2 : 6));
    this.heat = Math.max(0, this.heat - dt * 1.6);
    if (this.ruined && Math.random() < 0.3) this.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 1.2)), vel: new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.9, (Math.random() - 0.5) * 0.3), life: 1.2, size: 0.18, color: '#3a3634', gravity: -0.2 }, false);
    // ruins and ice — frozen still, the rays go out
    const live = !this.ruined && this.frozen <= 0;
    if (live) this.animate(dt);
    this.updateBeams(dt, live);
  }

  /** A point of the head in world space: dy above the pivot */
  private head(dy: number): THREE.Vector3 { return this.pos.clone().setY(this.pos.y + this.headY + dy); }
  private puff(dy: number, r: number, vel: THREE.Vector3, life: number, size: number, color: THREE.ColorRepresentation, glow = true): void {
    this.fx.particle({ pos: this.head(dy).add(new THREE.Vector3((Math.random() - 0.5) * r, (Math.random() - 0.5) * r * 0.5, (Math.random() - 0.5) * r)), vel, life, size, color, gravity: 0 }, glow);
  }

  /** Live pieces: everything that turns, crossbow recoil, catapult lever, floating hearts, sparks */
  private animate(dt: number): void {
    const hot = Math.min(1, this.heat);
    for (const s of this.spins) s.o.rotation[s.axis] += dt * (s.speed + s.boost * hot);
    const punch = 1 + this.recoil * 0.25, bob = Math.sin(this.time * 2) * 0.1, rv = (k: number): number => (Math.random() - 0.5) * k;
    switch (this.kind) {
      case 'arrow': this.arm.position.z = -this.recoil * 0.16; break;
      case 'ballista': this.arm.position.z = 0.3 - this.recoil * 0.5; this.arm.visible = this.recoil < 0.9; break;
      case 'oil':
        this.arm.rotation.x = this.recoil > 0.5 ? (this.recoil - 0.5) * 1.2 : 0;
        if (Math.random() < 0.3) this.puff(1.1, 0.5, new THREE.Vector3(rv(0.3), 0.8 + Math.random() * 0.6, rv(0.3)), 0.9, 0.1, '#3a3028', false);
        break;
      case 'splash': this.arm.rotation.x = this.recoil > 0.7 ? -0.9 : 0.7 - (this.recoil / 0.7) * 1.6; break;
      case 'magic':
        this.arm.position.y = 1.2 + bob; this.arm.scale.setScalar(punch + hot * 0.15);
        if (Math.random() < 0.08 + hot * 0.2) this.puff(1.2, 1.4, new THREE.Vector3(0, 0.6, 0), 0.5, 0.05, Math.random() < 0.5 ? ARCANE : ARCANE_DEEP);
        break;
      case 'fire':
        this.arm.scale.set(1 + hot * 0.15, 1 + hot * 0.4 + Math.sin(this.time * 17) * 0.08, 1 + hot * 0.15);
        if (Math.random() < 0.3 + hot * 0.5) this.puff(1.0, 0.6, new THREE.Vector3(rv(0.4), 1.2 + Math.random(), rv(0.4)), 0.5, 0.07, Math.random() < 0.6 ? FIRE : EMBER);
        break;
      case 'meteor': this.arm.position.y = 1.6 + bob; this.arm.scale.setScalar(punch); break;
      case 'storm':
        this.arm.scale.setScalar(punch + Math.sin(this.time * 23) * 0.04);
        if (Math.random() < 0.12 + hot * 0.3) this.puff(1.0, 0.7, new THREE.Vector3(rv(2), rv(2), rv(2)), 0.15, 0.05, VOLT);
        // idle arcs between the horns
        if (Math.random() < 0.02 + hot * 0.1) this.fx.bolt(this.head(1.0), this.head(0.2).add(new THREE.Vector3(rv(0.8), 0, rv(0.8))), VOLT, 0.03, 0, 0.12);
        break;
      case 'winter': {
        this.arm.position.y = 1.5 + bob * 1.2; this.arm.scale.setScalar(punch);
        // snow swirls within the blizzard radius
        const a = Math.random() * Math.PI * 2, r = Math.random() * this.range;
        if (Math.random() < 0.6) this.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.3 + Math.random() * 2.5, Math.sin(a) * r)), vel: new THREE.Vector3(-Math.sin(a) * 2, -0.4, Math.cos(a) * 2), life: 0.9, size: 0.06, color: SNOW, gravity: 0 }, false);
        break;
      }
      case 'frost':
        this.arm.position.y = 1.1 + bob; this.arm.scale.setScalar(punch + hot * 0.12);
        if (Math.random() < 0.08 + hot * 0.15) this.puff(1.1, 1.3, new THREE.Vector3(0, -0.4, 0), 0.8, 0.05, ICE);
        break;
    }
  }

  // ---------- channelled rays (frost spire, arcane obelisk) ----------
  /** `tower.fire` of a ray tower: where the rays start and whom they hold (`pts`), how far the ramp has grown (`ramp` 0..1) */
  private aimBeams(e: SimEvent): void {
    const pts = Array.isArray(e.pts) ? (e.pts as number[]) : [];
    if (pts.length < 6) return;
    this.ramp = typeof e.ramp === 'number' ? e.ramp : 0;
    const frost = this.kind === 'frost', a = frost ? ICE : ARCANE, b = frost ? SNOW : ARCANE_DEEP;
    for (let i = 3, n = 0; i + 2 < pts.length; i += 3, n++) {
      let bm = this.beams[n];
      if (!bm) {
        const mat = (c: THREE.Color, o: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
        bm = { halo: new THREE.Mesh(BEAM, mat(b.clone().multiplyScalar(0.22), 0.3)), core: new THREE.Mesh(BEAM, mat(a.clone().multiplyScalar(0.6), 0.85)), to: new THREE.Vector3(), cur: new THREE.Vector3(), t: 0 };
        bm.halo.frustumCulled = bm.core.frustumCulled = false;
        this.scene.add(bm.halo, bm.core);
        this.beams[n] = bm;
      }
      bm.to.set(pts[i], pts[i + 1], pts[i + 2]);
      if (bm.t <= 0) bm.cur.copy(bm.to);
      bm.t = 0.45;
    }
  }

  private updateBeams(dt: number, live: boolean): void {
    if (!this.beams.length) return;
    const frost = this.kind === 'frost', from = this.head((frost ? 1.1 : 1.2) + Math.sin(this.time * 2) * 0.1), col = frost ? ICE : ARCANE, col2 = frost ? SNOW : ARCANE_DEEP;
    for (const [n, bm] of this.beams.entries()) {
      bm.t = live ? bm.t - dt : 0;
      const on = bm.t > 0;
      bm.halo.visible = bm.core.visible = on;
      if (!on) continue;
      bm.cur.lerp(bm.to, Math.min(1, dt * 14));
      _d.subVectors(bm.cur, from);
      const len = _d.length();
      if (len < 0.05) continue;
      _d.divideScalar(len);
      _q.setFromUnitVectors(UP, _d);
      // the ray swells with the ramp, flickers, and tapers off when the tower lets go
      const fade = Math.min(1, bm.t / 0.2), w = (0.03 + this.ramp * 0.04) * (n ? 0.75 : 1) * fade * (0.85 + Math.sin(this.time * 34 + n) * 0.15);
      for (const [m, k] of [[bm.halo, 2.6], [bm.core, 1]] as const) { m.position.copy(from); m.quaternion.copy(_q); m.scale.set(w * k, len, w * k); }
      // motes run along the ray towards the target (cold) or back to the heart (drained magic)
      if (Math.random() < 0.4) {
        const k = Math.random(), p = from.clone().addScaledVector(_d, len * k), sp = frost ? 9 : -7;
        this.fx.particle({ pos: p.add(new THREE.Vector3((Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25)), vel: _d.clone().multiplyScalar(sp), life: 0.25, size: 0.06 + this.ramp * 0.04, color: Math.random() < 0.5 ? col : col2, gravity: 0 });
      }
      // the arcane tether crackles: a thin jagged thread along it now and then
      if (!frost && Math.random() < 0.06 + this.ramp * 0.1) this.fx.bolt(from, bm.cur, ARCANE, 0.03, 1, 0.1);
      // where the ray lands: a glow that grows with the ramp, sparks
      if (Math.random() < 0.25) this.fx.flash(bm.cur, col, 0.5 + this.ramp * 0.7, 0.12);
      if (Math.random() < 0.3) this.fx.particle({ pos: bm.cur.clone(), vel: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3), life: 0.35, size: 0.06, color: frost ? '#ffffff' : col, gravity: frost ? 6 : 0 });
    }
  }
}
