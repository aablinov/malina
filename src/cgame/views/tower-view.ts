import * as THREE from 'three';
import { C, glowMat, UNIT } from '../../bosses/kit.ts';
import type { FX } from '../../fx.ts';
import type { EntityState } from '../../net/snapshot.ts';
import type { TowerEnt } from '../../sim/entities.ts';
import type { SimEvent } from '../../sim/events.ts';
import { HpBar } from '../../td/hpbar.ts';
import { TOWERS, UPGRADE_RANGE, type TowerKind } from '../../td/towers.ts';
import { pixelTex } from '../../textures.ts';
import { ARCANE, ARCANE_DEEP, EMBER, FIRE, ICE, ICE_DEEP, IRON, SNOW, STAR, STAR_DEEP, STONE, STONE_DARK, TAR, VOLT, WOOD, WOOD_DARK } from './colors.ts';

/**
 * Defence tower — view (`t<pad>`): a model of cubes per kind and level (src/td/towers.ts), the turning part looks
 * along `yaw` from the record, ice when `frozen`, ruins at `hp ≤ 0`, a health bar. Recoil is its own, from the `tower.fire` event.
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
  private readonly bar = new HpBar(1.6, 3.4);
  private time = 0;
  private readonly body = new THREE.Group();
  /** Turning part (crossbow, lever, crystal) — looks at the target */
  private readonly turret = new THREE.Group();
  /** Moving piece inside the turning part: the catapult lever, the floating rune */
  private readonly arm = new THREE.Group();
  private readonly lamps: THREE.MeshLambertMaterial[] = [];
  private readonly glows: THREE.MeshBasicMaterial[] = [];
  private recoil = 0;

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
    this.iceMesh.scale.set(2, 3, 2);
    this.iceMesh.position.y = 1.6;
    this.iceMesh.visible = false;
    this.group.add(this.iceMesh, this.bar.group);
    scene.add(this.group);
    this.set(ent);
  }

  get range(): number { return TOWERS[this.kind].range + UPGRADE_RANGE[this.level - 1]; }

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
    if (e.t === 'tower.fire') this.recoil = 1;
  }

  dispose(): void {
    this.bar.dispose();
    (this.iceMesh.material as THREE.Material).dispose();
    this.scene.remove(this.group);
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

  /** Rebuild the model (build, upgrade) */
  private build(): void {
    const yaw = this.turret.rotation.y;
    this.body.clear();
    this.turret.clear();
    this.arm.clear();
    this.arm.position.set(0, 0, 0); this.arm.rotation.set(0, 0, 0);
    this.turret.position.set(0, 0, 0); this.turret.rotation.set(0, yaw, 0);
    for (const m of this.lamps.splice(0)) m.dispose();
    for (const m of this.glows.splice(0)) m.dispose();
    const B = this.box.bind(this);
    const stone = this.lam(STONE), dark = this.lam(STONE_DARK);
    // stone base: an octagon of two rotated slabs and a rim
    B(this.body, dark, 2.2, 0.3, 2.2, 0, 0.15, 0);
    B(this.body, dark, 2.2, 0.3, 2.2, 0, 0.15, 0, 0, Math.PI / 4, 0);
    B(this.body, stone, 1.7, 0.2, 1.7, 0, 0.4, 0);
    B(this.body, stone, 1.7, 0.2, 1.7, 0, 0.4, 0, 0, Math.PI / 4, 0);
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
    // level mark: raspberry lamp berries on the base corners — one, two
    const berry = this.glow(C(3.2, 0.5, 1.2));
    for (let i = 0; i < this.level - 1; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      B(this.body, berry, 0.16, 0.16, 0.16, Math.cos(a) * 1.05, 0.58, Math.sin(a) * 1.05);
    }
  }

  /** Archer tower: four posts, a platform with railings, a canopy; on it a crossbow on a swivel */
  private buildArrow(): void {
    const B = this.box.bind(this);
    const wood = this.lam(WOOD), woodD = this.lam(WOOD_DARK), iron = this.lam(IRON, false);
    const H = 2.0;
    for (const [x, z] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) B(this.body, woodD, 0.16, H, 0.16, x, 0.5 + H / 2, z);
    for (const s of [-1, 1]) { B(this.body, woodD, 0.08, 1.5, 0.08, s * 0.55, 1.2, 0, 0.6, 0, 0); B(this.body, woodD, 0.08, 1.5, 0.08, 0, 1.2, s * 0.55, 0, 0, 0.6); }
    B(this.body, wood, 1.4, 0.14, 1.4, 0, 0.5 + H, 0);
    for (const s of [-1, 1]) { B(this.body, woodD, 1.4, 0.08, 0.08, 0, 0.5 + H + 0.4, s * 0.66); B(this.body, woodD, 0.08, 0.08, 1.4, s * 0.66, 0.5 + H + 0.4, 0); }
    for (const [x, z] of [[-0.66, -0.66], [0.66, -0.66], [-0.66, 0.66], [0.66, 0.66]]) B(this.body, woodD, 0.1, 0.5, 0.1, x, 0.5 + H + 0.25, z);
    if (this.level >= 2) {
      for (const [x, z] of [[-0.6, -0.6], [0.6, 0.6]]) B(this.body, woodD, 0.08, 1.1, 0.08, x, 0.5 + H + 0.55, z);
      B(this.body, this.lam('#a8443a'), 1.7, 0.1, 1.7, 0, 0.5 + H + 1.12, 0, 0.12, 0, 0);
    }
    if (this.level >= 3) { B(this.body, woodD, 0.06, 0.9, 0.06, 0.6, 0.5 + H + 1.6, -0.6); B(this.body, this.lam('#d8285a', false), 0.44, 0.24, 0.03, 0.82, 0.5 + H + 1.9, -0.6); }
    this.turret.position.set(0, 0.5 + H + 0.25, 0);
    this.body.add(this.turret);
    B(this.turret, iron, 0.12, 0.3, 0.12, 0, 0.1, 0);
    B(this.turret, woodD, 0.14, 0.12, 0.9, 0, 0.32, 0.1);
    B(this.turret, iron, 0.9, 0.06, 0.08, 0, 0.34, 0.4);
    B(this.turret, this.lam('#e8e0c8', false), 0.84, 0.02, 0.02, 0, 0.36, 0.26);
    B(this.turret, this.glow(C(2.2, 2.0, 1.2)), 0.05, 0.05, 0.5, 0, 0.4, 0.3);
  }

  /** Frost spire: a stone pedestal, an ice crystal of slanted faces, shards around; the crystal turns to the target */
  private buildFrost(): void {
    const B = this.box.bind(this);
    const stone = this.lam('#7f8ea0'), ice = this.glow(ICE), deep = this.glow(ICE_DEEP), rime = this.lam('#dceeff', false);
    B(this.body, stone, 1.0, 0.5, 1.0, 0, 0.75, 0);
    B(this.body, stone, 0.7, 0.3, 0.7, 0, 1.15, 0, 0, Math.PI / 4, 0);
    this.turret.position.set(0, 1.3, 0);
    this.body.add(this.turret);
    // main crystal: two prisms crosswise, tapering upward; tilted forward
    const h = 1.6 + this.level * 0.25;
    B(this.turret, deep, 0.5, h, 0.5, 0, h / 2, 0, 0.18, Math.PI / 4, 0);
    B(this.turret, ice, 0.3, h * 1.15, 0.3, 0, h * 0.55, 0.05, 0.22, 0, 0);
    B(this.turret, ice, 0.14, 0.4, 0.14, 0, h * 1.12, 0.2, 0.3, Math.PI / 4, 0);
    // shards in a circle: more with the level
    for (let i = 0; i < 3 + this.level * 2; i++) {
      const a = (i / (3 + this.level * 2)) * Math.PI * 2, r = 0.7 + (i % 2) * 0.2;
      B(this.body, i % 3 === 0 ? ice : deep, 0.16, 0.4 + (i % 2) * 0.3, 0.16, Math.cos(a) * r, 0.7, Math.sin(a) * r, Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3);
    }
    // rime on the pedestal
    for (const s of [-1, 1]) B(this.body, rime, 0.5, 0.06, 0.2, s * 0.3, 1.02, 0.4);
  }

  /** Catapult: a log frame, a lever with a bucket and a counterweight; the lever flings the rock */
  private buildSplash(): void {
    const B = this.box.bind(this);
    const wood = this.lam(WOOD), woodD = this.lam(WOOD_DARK), iron = this.lam(IRON, false), rock = this.lam('#6a6a70');
    this.turret.position.set(0, 0.5, 0);
    this.body.add(this.turret);
    // a carriage with wheels, two uprights with an axle
    B(this.turret, woodD, 1.3, 0.16, 0.5, 0, 0.1, -0.2);
    for (const s of [-1, 1]) { B(this.turret, woodD, 0.2, 0.5, 0.2, s * 0.55, 0.3, -0.5, 0, 0, 0); B(this.turret, woodD, 0.16, 1.0, 0.16, s * 0.4, 0.6, -0.2, 0.3, 0, 0); }
    B(this.turret, iron, 1.0, 0.1, 0.1, 0, 1.05, -0.35);
    for (const s of [-1, 1]) B(this.turret, wood, 0.12, 0.5, 0.5, s * 0.72, 0.25, -0.2, 0, 0, 0);
    // the lever on the axle: bucket in front, counterweight behind; at rest the bucket is lowered back (cocked)
    this.arm.position.set(0, 1.05, -0.35);
    this.turret.add(this.arm);
    B(this.arm, wood, 0.14, 0.14, 2.0, 0, 0, 0.4);
    B(this.arm, woodD, 0.44, 0.2, 0.44, 0, 0.1, 1.35);
    B(this.arm, rock, 0.28, 0.28, 0.28, 0, 0.26, 1.35);
    B(this.arm, iron, 0.5, 0.5, 0.4, 0, -0.1, -0.5);
    if (this.level >= 2) B(this.arm, iron, 0.6, 0.6, 0.3, 0, -0.1, -0.75);
    if (this.level >= 3) B(this.turret, this.lam('#d8285a', false), 0.5, 0.3, 0.03, 0.9, 1.35, -0.4);
    this.arm.rotation.x = 0.7;
    // a stock of rocks at the base
    for (const [x, z] of [[0.75, 0.55], [0.55, 0.75], [0.68, 0.72]]) B(this.body, rock, 0.26, 0.26, 0.26, x, 0.63, z);
  }

  /** Fire brazier: an iron bowl on stone legs, embers and flame in it; the bowl with a spout turns to the target */
  private buildFire(): void {
    const B = this.box.bind(this);
    const iron = this.lam(IRON, false), stone = this.lam(STONE_DARK), coal = this.glow(EMBER), flame = this.glow(FIRE);
    for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + (i * Math.PI) / 2; B(this.body, stone, 0.26, 0.7, 0.26, Math.cos(a) * 0.5, 0.85, Math.sin(a) * 0.5, 0, a, 0); }
    this.turret.position.set(0, 1.2, 0);
    this.body.add(this.turret);
    // bowl: a ring of four walls and a bottom, embers on top, the spout forward
    B(this.turret, iron, 1.1, 0.12, 1.1, 0, 0, 0);
    for (const s of [-1, 1]) { B(this.turret, iron, 1.2, 0.5, 0.1, 0, 0.25, s * 0.55); B(this.turret, iron, 0.1, 0.5, 1.2, s * 0.55, 0.25, 0); }
    B(this.turret, coal, 0.9, 0.3, 0.9, 0, 0.25, 0);
    B(this.turret, flame, 0.5, 0.5 + this.level * 0.15, 0.5, 0, 0.6, 0, 0, Math.PI / 4, 0);
    B(this.turret, flame, 0.3, 0.9 + this.level * 0.2, 0.3, 0.1, 0.75, -0.1);
    B(this.turret, iron, 0.4, 0.2, 0.5, 0, 0.3, 0.75);
    B(this.turret, iron, 0.5, 0.24, 0.1, 0, 0.3, 1.0);
    if (this.level >= 2) B(this.turret, iron, 1.4, 0.06, 0.06, 0, 0.55, 0, 0, Math.PI / 4, 0);
    if (this.level >= 3) for (const s of [-1, 1]) B(this.turret, flame, 0.2, 0.5, 0.2, s * 0.45, 0.6, -0.45);
    // a poker at the feet
    B(this.body, iron, 0.06, 1.2, 0.06, -0.8, 1.0, 0.6, 0.3, 0, 0.25);
  }

  /** Stargazer: a round stone tower, an observatory dome with a slit, a spyglass out of it at the target; a star above the dome */
  private buildMeteor(): void {
    const B = this.box.bind(this);
    const stone = this.lam('#6a6278'), stoneD = this.lam('#4a4458'), brass = this.lam('#d8a040'), dome = this.lam('#3a3a6a'), star = this.glow(STAR), deep = this.glow(STAR_DEEP);
    B(this.body, stone, 1.5, 1.2, 1.5, 0, 1.1, 0);
    B(this.body, stone, 1.5, 1.2, 1.5, 0, 1.1, 0, 0, Math.PI / 4, 0);
    B(this.body, stoneD, 1.3, 1.0, 1.3, 0, 2.2, 0, 0, Math.PI / 8, 0);
    for (const y of [1.0, 1.9]) for (const s of [-1, 1]) B(this.body, deep, 0.2, 0.3, 0.04, s * 0.5, y, 0.72);
    this.turret.position.set(0, 2.75, 0);
    this.body.add(this.turret);
    B(this.turret, dome, 1.4, 0.5, 1.4, 0, 0.2, 0);
    B(this.turret, dome, 1.0, 0.35, 1.0, 0, 0.6, 0);
    B(this.turret, dome, 0.5, 0.2, 0.5, 0, 0.86, 0);
    B(this.turret, brass, 0.26, 0.26, 1.4, 0, 0.45, 0.5, -0.5, 0, 0);
    B(this.turret, star, 0.2, 0.2, 0.06, 0, 0.82, 1.15, -0.5, 0, 0);
    this.arm.position.set(0, 1.5, 0);
    this.turret.add(this.arm);
    B(this.arm, star, 0.34, 0.34, 0.34, 0, 0, 0, Math.PI / 4, 0, Math.PI / 4);
    for (let i = 1; i < this.level; i++) B(this.arm, deep, 0.14, 0.14, 0.14, Math.cos(i * 2.1) * 0.5, 0, Math.sin(i * 2.1) * 0.5);
  }

  /** Storm spire: a tall stone needle in copper rings, on top a storm ball between three discharge horns */
  private buildStorm(): void {
    const B = this.box.bind(this);
    const stone = this.lam('#5c6470'), copper = this.lam('#c87a3a'), iron = this.lam(IRON, false), volt = this.glow(VOLT);
    B(this.body, stone, 1.0, 0.6, 1.0, 0, 0.8, 0);
    B(this.body, stone, 0.7, 1.4, 0.7, 0, 1.8, 0);
    B(this.body, stone, 0.45, 1.0, 0.45, 0, 3.0, 0);
    for (const y of [1.3, 1.9, 2.5, 3.1]) B(this.body, copper, y < 2.6 ? 0.82 : 0.56, 0.1, y < 2.6 ? 0.82 : 0.56, 0, y, 0);
    this.turret.position.set(0, 3.6, 0);
    this.body.add(this.turret);
    for (let i = 0; i < 3; i++) { const a = (i * Math.PI * 2) / 3; B(this.turret, iron, 0.08, 0.7, 0.08, Math.cos(a) * 0.35, 0.3, Math.sin(a) * 0.35, Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4); }
    this.arm.position.set(0, 0.55, 0);
    this.turret.add(this.arm);
    B(this.arm, volt, 0.4 + this.level * 0.06, 0.4 + this.level * 0.06, 0.4 + this.level * 0.06, 0, 0, 0, Math.PI / 4, 0, Math.PI / 4);
  }

  /** Heart of winter: an ice-block pedestal, a huge crystal floats above it, shards circle around (more with the level) */
  private buildWinter(): void {
    const B = this.box.bind(this);
    const rime = this.lam('#dceeff', false), stone = this.lam('#7f8ea0'), ice = this.glow(SNOW), deep = this.glow(ICE_DEEP);
    B(this.body, stone, 1.2, 0.6, 1.2, 0, 0.8, 0);
    B(this.body, rime, 1.3, 0.2, 1.3, 0, 1.15, 0, 0, Math.PI / 4, 0);
    for (let i = 0; i < 4; i++) { const a = i * 1.57 + 0.3; B(this.body, deep, 0.2, 0.7, 0.2, Math.cos(a) * 0.55, 1.4, Math.sin(a) * 0.55, Math.sin(a) * 0.3, a, Math.cos(a) * 0.3); }
    this.turret.position.set(0, 2.6, 0);
    this.body.add(this.turret);
    B(this.turret, ice, 0.7, 1.4, 0.7, 0, 0, 0, 0, Math.PI / 4, 0);
    B(this.turret, deep, 0.4, 0.4, 0.4, 0, 0.9, 0, 0, Math.PI / 4, 0);
    B(this.turret, deep, 0.4, 0.4, 0.4, 0, -0.9, 0, 0, Math.PI / 4, 0);
    this.arm.position.set(0, 0, 0);
    this.turret.add(this.arm);
    for (let i = 0; i < 3 + this.level; i++) { const a = (i / (3 + this.level)) * Math.PI * 2; B(this.arm, ice, 0.16, 0.3, 0.16, Math.cos(a) * 1.1, Math.sin(i * 1.7) * 0.3, Math.sin(a) * 1.1, 0.4, a, 0.3); }
  }

  /** Arcane obelisk: a dark tapering carved pillar, a glowing rune floats above it */
  private buildMagic(): void {
    const B = this.box.bind(this);
    const obs = this.lam('#2e2440'), trim = this.glow(ARCANE_DEEP), rune = this.glow(ARCANE);
    B(this.body, obs, 0.8, 0.4, 0.8, 0, 0.7, 0);
    B(this.body, obs, 0.6, 1.8, 0.6, 0, 1.8, 0);
    B(this.body, obs, 0.4, 0.5, 0.4, 0, 2.95, 0);
    // carving: glowing bands
    for (const y of [1.2, 1.8, 2.4]) for (const s of [-1, 1]) { B(this.body, trim, 0.3, 0.06, 0.02, 0, y, s * 0.31); B(this.body, trim, 0.02, 0.06, 0.3, s * 0.31, y, 0); }
    this.turret.position.set(0, 3.5, 0);
    this.body.add(this.turret);
    this.turret.add(this.arm);
    B(this.arm, rune, 0.36, 0.36, 0.36, 0, 0, 0, Math.PI / 4, 0, Math.PI / 4);
    B(this.arm, trim, 0.5, 0.08, 0.08, 0, 0, 0, 0, Math.PI / 4, 0);
    for (let i = 1; i < this.level; i++) B(this.arm, rune, 0.14, 0.14, 0.14, Math.cos(i * 2.1) * 0.55, 0.1 * i, Math.sin(i * 2.1) * 0.55);
    // satellite stones at the base
    for (let i = 0; i < 4; i++) { const a = i * 1.57 + 0.4; B(this.body, obs, 0.2, 0.5 + (i % 2) * 0.3, 0.2, Math.cos(a) * 0.85, 0.7, Math.sin(a) * 0.85, 0.2, a, 0); }
  }

  /** Wall ballista: a low carriage with wheels, on the swivel a heavy bow with a windlass; the bolt lies in the groove */
  private buildBallista(): void {
    const B = this.box.bind(this);
    const wood = this.lam(WOOD), woodD = this.lam(WOOD_DARK), iron = this.lam(IRON, false), rope = this.lam('#c8b890', false);
    B(this.body, woodD, 1.4, 0.2, 1.0, 0, 0.6, 0);
    for (const s of [-1, 1]) B(this.body, woodD, 0.12, 0.5, 0.5, s * 0.6, 0.55, 0);
    this.turret.position.set(0, 0.8, 0);
    this.body.add(this.turret);
    // the stock with a groove, bow limbs, bowstring, the windlass behind
    B(this.turret, wood, 0.3, 0.2, 2.0, 0, 0.15, 0.2);
    B(this.turret, iron, 0.18, 0.06, 1.4, 0, 0.28, 0.4);
    for (const s of [-1, 1]) { B(this.turret, woodD, 1.0, 0.1, 0.12, s * 0.65, 0.25, 0.75, 0, 0, s * 0.25); B(this.turret, iron, 0.08, 0.14, 0.14, s * 1.1, 0.25, 0.63); }
    B(this.turret, rope, 2.1, 0.02, 0.02, 0, 0.25, 0.3);
    B(this.turret, iron, 0.3, 0.3, 0.2, 0, 0.3, -0.8);
    B(this.turret, woodD, 0.08, 0.6, 0.08, 0.2, 0.3, -0.8, 0, 0, 0.3);
    this.arm.position.set(0, 0.34, 0.3);
    this.turret.add(this.arm);
    B(this.arm, iron, 0.08, 0.08, 1.2, 0, 0, 0.3);
    B(this.arm, this.lam('#d8285a', false), 0.14, 0.14, 0.2, 0, 0, 0.95);
    if (this.level >= 2) for (const s of [-1, 1]) B(this.turret, iron, 0.06, 0.4, 0.06, s * 0.4, 0.4, 0.75);
    if (this.level >= 3) B(this.turret, this.lam('#d8285a', false), 0.03, 0.3, 0.5, 0, 0.6, -0.5);
  }

  /** Tar cauldron: a tripod over embers, a black cauldron pouring smoke; the spout at the target */
  private buildOil(): void {
    const B = this.box.bind(this);
    const iron = this.lam(IRON, false), coal = this.glow(EMBER), tar = this.lam(TAR, false), wood = this.lam(WOOD_DARK);
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; B(this.body, wood, 0.14, 1.6, 0.14, Math.cos(a) * 0.55, 1.3, Math.sin(a) * 0.55, Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3); }
    B(this.body, coal, 0.7, 0.2, 0.7, 0, 0.6, 0);
    B(this.body, iron, 0.5, 0.1, 0.5, 0, 2.1, 0);
    this.turret.position.set(0, 1.0, 0);
    this.body.add(this.turret);
    B(this.turret, iron, 1.0, 0.7, 1.0, 0, 0.35, 0);
    B(this.turret, iron, 1.1, 0.12, 1.1, 0, 0.75, 0);
    B(this.turret, tar, 0.8, 0.08, 0.8, 0, 0.78, 0);
    B(this.turret, iron, 0.3, 0.2, 0.5, 0, 0.7, 0.6);
    for (const s of [-1, 1]) B(this.turret, iron, 0.1, 0.4, 0.1, s * 0.56, 0.8, 0);
    B(this.turret, iron, 1.22, 0.06, 0.06, 0, 1.0, 0);
    if (this.level >= 2) B(this.turret, iron, 0.6, 0.6, 0.6, 0, 0.3, 0, 0, Math.PI / 4, 0);
    if (this.level >= 3) B(this.turret, this.lam('#d8285a', false), 0.5, 0.3, 0.03, -0.7, 1.5, 0);
  }

  // ---------- frame ----------
  update(dt: number): void {
    this.time += dt;
    this.recoil = Math.max(0, this.recoil - dt * (this.kind === 'splash' ? 1.2 : 6));
    if (this.ruined && Math.random() < 0.3) this.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 1.2)), vel: new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.9, (Math.random() - 0.5) * 0.3), life: 1.2, size: 0.18, color: '#3a3634', gravity: -0.2 }, false);
    // ruins and ice — frozen still
    if (!this.ruined && this.frozen <= 0) this.animate(dt);
  }

  /** Live piece: crossbow recoil, catapult lever, floating rune, brazier sparks, crystal sway */
  private animate(dt: number): void {
    switch (this.kind) {
      case 'arrow': this.turret.position.z = -this.recoil * 0.12; break;
      case 'ballista': this.arm.position.z = 0.3 - this.recoil * 0.5; this.arm.visible = this.recoil < 0.9; break;
      case 'oil':
        this.turret.rotation.x = this.recoil > 0.5 ? (this.recoil - 0.5) * 1.2 : 0;
        if (Math.random() < 0.25) this.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 1.9, (Math.random() - 0.5) * 0.5)), vel: new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.8 + Math.random() * 0.6, (Math.random() - 0.5) * 0.3), life: 0.9, size: 0.1, color: '#3a3028', gravity: 0 }, false);
        break;
      case 'splash': this.arm.rotation.x = this.recoil > 0.7 ? -0.9 : 0.7 - (this.recoil / 0.7) * 1.6; break;
      case 'magic':
        this.arm.position.y = Math.sin(this.time * 2) * 0.12;
        this.arm.rotation.y += dt * (1 + this.recoil * 8);
        break;
      case 'fire':
        if (Math.random() < 0.3) this.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.9, (Math.random() - 0.5) * 0.6)), vel: new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.2 + Math.random(), (Math.random() - 0.5) * 0.4), life: 0.5, size: 0.07, color: Math.random() < 0.6 ? FIRE : EMBER, gravity: 0 });
        break;
      case 'meteor': this.arm.rotation.y += dt * 1.5; this.arm.position.y = 1.5 + Math.sin(this.time * 2) * 0.1; break;
      case 'storm':
        this.arm.rotation.y += dt * (2 + this.recoil * 10);
        if (Math.random() < 0.15) this.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 4.1 + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.6)), vel: new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2), life: 0.15, size: 0.05, color: VOLT, gravity: 0 });
        break;
      case 'winter': {
        this.arm.rotation.y += dt * 1.2;
        this.turret.position.y = 2.6 + Math.sin(this.time * 1.5) * 0.12;
        // snow swirls within the blizzard radius
        const a = Math.random() * Math.PI * 2, r = Math.random() * this.range;
        if (Math.random() < 0.6) this.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.3 + Math.random() * 2.5, Math.sin(a) * r)), vel: new THREE.Vector3(-Math.sin(a) * 2, -0.4, Math.cos(a) * 2), life: 0.9, size: 0.06, color: SNOW, gravity: 0 }, false);
        break;
      }
      case 'frost':
        this.turret.rotation.z = Math.sin(this.time * 1.3) * 0.04;
        if (Math.random() < 0.1) this.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 1 + Math.random() * 2, (Math.random() - 0.5) * 1.2)), vel: new THREE.Vector3(0, -0.3, 0), life: 0.8, size: 0.05, color: ICE, gravity: 0 });
        break;
    }
  }
}
