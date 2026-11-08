import * as THREE from 'three';
import { rnd } from '../rng.ts';
import { makeCanvas } from '../headless.ts';
import { pixelTex } from '../textures.ts';
import { boom, hiss, voice } from '../spell-audio.ts';
import { C, glowMat, rand } from '../bosses/kit.ts';
import { groundGlow, lightBeam } from '../loot-look.ts';
import { Mob, type MobHooks } from './mob.ts';
import { t } from '../i18n/i18n.ts';

/**
 * 31. Soller Knight of the Sun (wiki/design-mobs.md, section 2G) — a rare loner, not of the Order: praises the sun that
 * grows raspberries. The armour is traced from the refs: a bucket helm with a T-shaped visor, a red feather, shaggy green pauldrons,
 * a tunic with a sun, chainmail, greaves. At rest stands with arms raised under a pillar of sunlight; in combat — a sword combo,
 * a sun spear from afar, once per fight — a prayer that heals (a hit interrupts it). The hero left — returns to his spot and praises again.
 */

/** Warm sunlight: beam, spear, sparks */
const SUN = C(3.2, 2.5, 1.1);
const SPEAR = C(4, 3.2, 1.2);
/** The pillar of light is softer than the sparks: the knight must read inside it, not drown in the glare */
const BEAM = C(0.5, 0.4, 0.18);

const sfx = {
  swing() { hiss({ dur: 0.2, vol: 0.13, f: 2200, f1: 800, q: 1.2, type: 'bandpass' }); },
  /** Spear in hand: the ringing grows */
  charge() { voice({ type: 'sine', f: 440, f1: 880, dur: 0.7, vol: 0.05, verb: 0.5 }); },
  throw() { boom(700, 200, 0.25, 0.3); hiss({ dur: 0.35, vol: 0.12, f: 3800, f1: 1200, q: 1, type: 'bandpass', verb: 0.4 }); },
  /** Prayer: a bright chord */
  praise() { for (const f of [392, 494, 587]) voice({ type: 'sine', f, dur: 1.6, vol: 0.035, verb: 0.7 }); },
};

/** Canvas in pixels: drawn point by point, no smoothing */
function canvas(w: number, h: number, paint: (px: (x: number, y: number, c: string) => void) => void): THREE.CanvasTexture {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d')!;
  paint((x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); });
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Noise from coordinates 0..1 (deterministic) */
const hash = (x: number, y: number): number => { let v = Math.imul(x + 31, 374761393) + Math.imul(y + 17, 668265263); v = Math.imul(v ^ (v >>> 13), 1274126177); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };
const shade = (hex: string, d: number): string => {
  const n = parseInt(hex.slice(1), 16), f = (v: number) => Math.max(0, Math.min(255, Math.round(v + d)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
};

/**
 * The sun on the tunic, 32 × 32: dirty white cloth, 9 red wavy rays, a yellow disc with a face
 * (brows, eyes, nose, mouth) and red specks — as on the ref
 */
let sunTex: THREE.CanvasTexture | null = null;
const sunEmblem = (): THREE.CanvasTexture => sunTex ??= canvas(32, 32, (px) => {
  const cx = 15.5, cy = 15, RAYS = 9;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const n = hash(x, y);
    // cloth with dirt: stains darker toward the bottom
    let col = shade('#d6cfbf', (n - 0.5) * 14 - (y / 32) * 10 - (hash(x >> 2, y >> 2) > 0.8 ? 14 : 0));
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    if (r > 5.6 && r < 14.8) {
      // ray: the nearest by angle, a wave across, thinner toward the end
      const step = (Math.PI * 2) / RAYS, k = Math.round((a + Math.PI / 2) / step);
      const off = (a + Math.PI / 2 - k * step) * r;
      const wave = Math.sin(r * 1.15) * 0.9, half = 2.1 * (1 - (r - 5.6) / 10) + 0.45;
      if (Math.abs(off - wave) < half) col = shade('#d8402c', (n - 0.5) * 18);
    }
    if (r <= 6.1) {
      col = r > 5.4 ? '#e8a030' : shade('#f5d93a', (n - 0.5) * 10);
      // red specks along the edge of the disc
      if (r > 3.8 && r < 5.4 && n > 0.86) col = '#d8602c';
    }
    px(x, y, col);
  }
  // face: peaked brows, eyes, nose, lips — in dark brown
  const ink = '#6a3a1c', X = Math.round(cx - 0.5), Y = Math.round(cy);
  for (const [x, y] of [[-3, -3], [-2, -3], [-1, -2], [2, -3], [3, -3], [1, -2], [-2, -1], [2, -1], [0, 0], [0, 1], [1, 1], [-1, 3], [0, 3], [1, 3]]) px(X + x, Y + y, ink);
  px(X - 2, Y - 1, '#3a2010'); px(X + 2, Y - 1, '#3a2010');
});

/** Chainmail: rows of rings, light and dark mixed */
let mailTex: THREE.CanvasTexture | null = null;
const chainmail = (): THREE.CanvasTexture => mailTex ??= canvas(16, 16, (px) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const ring = (x + (y % 2) * 2) % 4;
    px(x, y, shade(ring === 0 ? '#4a4c50' : ring === 2 ? '#a8acb0' : '#7c8086', (hash(x, y) - 0.5) * 16));
  }
});

/** Soller's parts: everything that sways */
interface Rig { legs: THREE.Group[]; torso: THREE.Group; head: THREE.Group; arms: THREE.Group[]; plume: THREE.Group; sword: THREE.Group; sheathed: THREE.Group; spear: THREE.Mesh }

function buildSoller(m: Mob, body: THREE.Group): Rig {
  const steel = m.lam('#b6babe', pixelTex('#b6babe', 10, 3101)), steelDark = m.lam('#7a7e84'), rivet = m.lam('#5a5c60');
  const rust = m.lam('#8a4a2a'), slit = m.lam('#141416');
  const mail = m.lam('#888', chainmail());
  const cloth = m.lam('#d2cbbb', pixelTex('#d2cbbb', 8, 3102)), sun = m.lam('#fff', sunEmblem());
  const leather = m.lam('#6a4a30', pixelTex('#6a4a30', 8, 3103)), stud = m.lam('#c8b890');
  const cowl = m.lam('#8a8668', pixelTex('#8a8668', 8, 3104));
  const fur = [m.lam('#c4e0a8'), m.lam('#a8cc8a'), m.lam('#d4ecbc')];
  const plumeMat = m.lam('#a82a24'), plumeDark = m.lam('#7a1a18');
  const B = m.box.bind(m);

  // legs: chainmail trousers, steel greaves to the knee with a rim, chainmail boots
  const legs = [-1, 1].map((s) => {
    const g = new THREE.Group();
    g.position.set(s * 0.17, 0.8, 0);
    body.add(g);
    B(g, mail, 0.26, 0.42, 0.28, 0, -0.2, 0);
    B(g, steel, 0.29, 0.34, 0.31, 0, -0.52, 0.01);
    B(g, steelDark, 0.31, 0.05, 0.33, 0, -0.36, 0.01);
    B(g, mail, 0.28, 0.12, 0.36, 0, -0.74, 0.03);
    return g;
  });

  const torso = new THREE.Group();
  torso.position.y = 0.8;
  body.add(torso);
  // tunic: cloth on the torso, a sun front and back
  B(torso, cloth, 0.68, 0.84, 0.42, 0, 0.42, 0);
  B(torso, sun, 0.64, 0.64, 0.02, 0, 0.5, 0.215);
  B(torso, sun, 0.64, 0.64, 0.02, 0, 0.5, -0.215);
  // fringed hem below the belt: a plate front and back, tabs of varying length along the bottom
  for (const z of [0.19, -0.19]) {
    B(torso, cloth, 0.68, 0.22, 0.05, 0, -0.06, z);
    for (let i = 0; i < 7; i++) {
      const l = 0.1 + hash(i, z > 0 ? 1 : 2) * 0.14;
      B(torso, cloth, 0.09, l, 0.05, -0.29 + i * 0.097, -0.17 - l / 2, z);
    }
  }
  // a wide belt with diamond-shaped studs and a buckle; a second belt diagonally — for the sword
  B(torso, leather, 0.71, 0.11, 0.45, 0, 0.06, 0);
  for (let i = 0; i < 5; i++) if (i !== 2) B(torso, stud, 0.045, 0.045, 0.02, -0.26 + i * 0.13, 0.06, 0.232, 0, 0, Math.PI / 4);
  B(torso, steelDark, 0.1, 0.09, 0.02, 0, 0.06, 0.235);
  B(torso, leather, 0.62, 0.06, 0.03, -0.02, -0.06, 0.23, 0, 0, -0.32);
  // hood: two "rings" of folds around the neck
  B(torso, cowl, 0.52, 0.13, 0.46, 0, 0.88, 0);
  B(torso, cowl, 0.44, 0.11, 0.4, 0.01, 0.98, 0.01, 0, 0.2, 0);
  // pauldrons: pale green fur in layers, a ragged edge hangs down
  for (const s of [-1, 1]) {
    B(torso, fur[0], 0.36, 0.14, 0.5, s * 0.42, 0.78, 0);
    B(torso, fur[1], 0.3, 0.1, 0.44, s * 0.46, 0.68, 0);
    for (let i = 0; i < 6; i++) {
      const l = 0.1 + hash(i, s + 5) * 0.16, z = -0.21 + i * 0.084;
      B(torso, fur[i % 3], 0.07, l, 0.08, s * (0.56 + hash(i, s) * 0.04), 0.66 - l / 2, z, 0, 0, s * 0.25);
    }
    for (const z of [-0.26, 0.26]) B(torso, fur[2], 0.3, 0.1, 0.06, s * 0.44, 0.66, z);
  }
  // scabbard at the left hip (facing +Z the left side is +X), the grip above it; in combat the sword is in hand — the scabbard is empty
  const sheathed = new THREE.Group();
  sheathed.position.set(0.4, 0, 0.02);
  sheathed.rotation.x = 0.5;
  torso.add(sheathed);
  B(sheathed, leather, 0.09, 0.7, 0.11, 0, -0.28, 0);
  B(sheathed, steelDark, 0.24, 0.05, 0.07, 0, 0.1, 0);
  B(sheathed, leather, 0.06, 0.2, 0.06, 0, 0.22, 0);

  // head: a ribbed gorget, a bucket helm, a T-shaped visor with rivets, a feather at the back left
  const head = new THREE.Group();
  head.position.y = 1.72;
  body.add(head);
  B(head, steel, 0.42, 0.12, 0.42, 0, 0.02, 0);
  for (let i = 0; i < 6; i++) B(head, steelDark, 0.02, 0.12, 0.02, -0.17 + i * 0.068, 0.02, 0.212);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) B(head, steelDark, 0.02, 0.12, 0.02, s * 0.212, 0.02, -0.12 + i * 0.12);
  B(head, steel, 0.48, 0.56, 0.48, 0, 0.36, 0);
  B(head, steel, 0.44, 0.04, 0.44, 0, 0.66, 0);
  B(head, slit, 0.4, 0.07, 0.02, 0, 0.47, 0.24);
  B(head, steel, 0.08, 0.42, 0.03, 0, 0.3, 0.25);
  for (let i = 0; i < 5; i++) B(head, rivet, 0.035, 0.035, 0.02, 0, 0.47 - i * 0.085, 0.27);
  for (const x of [-0.17, 0.17]) B(head, rivet, 0.03, 0.03, 0.02, x, 0.36, 0.245);
  B(head, rust, 0.05, 0.03, 0.02, -0.12, 0.42, 0.242);
  B(head, rust, 0.03, 0.06, 0.02, 0.09, 0.2, 0.242);
  const plume = new THREE.Group();
  plume.position.set(-0.14, 0.66, -0.16);
  head.add(plume);
  let seg: THREE.Object3D = plume;
  for (const [l, tilt] of [[0.24, -0.15], [0.24, -0.25], [0.2, -0.4], [0.16, -0.5]] as const) {
    const g = new THREE.Group();
    g.rotation.x = tilt;
    seg.add(g);
    B(g, plumeMat, 0.08, l, 0.05, 0, l / 2, 0);
    B(g, plumeDark, 0.016, l, 0.06, 0, l / 2, 0);
    const next = new THREE.Group();
    next.position.y = l;
    g.add(next);
    seg = next;
  }

  // arms: chainmail sleeve, leather bracer, steel cuff, glove
  const arms = [-1, 1].map((s) => {
    const g = new THREE.Group();
    g.position.set(s * 0.47, 1.5, 0);
    body.add(g);
    B(g, mail, 0.2, 0.46, 0.22, 0, -0.24, 0);
    B(g, leather, 0.23, 0.15, 0.25, 0, -0.5, 0);
    B(g, steel, 0.25, 0.06, 0.27, 0, -0.59, 0);
    B(g, leather, 0.17, 0.13, 0.18, 0, -0.68, 0);
    return g;
  });

  // a straight sword in the right hand (−X): grip, crossguard, blade
  const sword = new THREE.Group();
  sword.position.set(0, -0.68, 0);
  arms[0].add(sword);
  const blade = m.lam('#dfe3e8');
  B(sword, leather, 0.06, 0.06, 0.22, 0, 0, 0.02);
  B(sword, steelDark, 0.3, 0.05, 0.07, 0, 0, 0.14);
  B(sword, blade, 0.08, 0.035, 0.92, 0, 0, 0.62);
  B(sword, steelDark, 0.07, 0.07, 0.06, 0, 0, -0.12);
  // sun spear: glows in the raised hand before the throw
  const spear = B(arms[0], glowMat(SPEAR), 0.08, 1.5, 0.08, 0, -0.7, 0);
  spear.visible = false;
  return { legs, torso, head, arms, plume, sword, sheathed, spear };
}

const lerpTo = (v: number, to: number, k: number): number => v + (to - v) * k;

export class SunKnight extends Mob {
  readonly kind = 'soller';
  readonly title = t('Soller Knight of the Sun');
  override readonly subtitle: string = t('warrior of the Sun');
  readonly cost = 14;
  readonly radius = 0.5;
  override readonly topY = 2.5;
  private readonly rig: Rig;
  /** Pillar of sunlight and a spot on the floor */
  private readonly beam: { group: THREE.Group; mats: THREE.MeshBasicMaterial[] };
  private readonly spot: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly beamBase: THREE.Color[];
  /** Beam brightness 0..1 and a flash on death */
  shine = 1;
  private flash = 0;
  /** Prayed in this fight (heals once) */
  prayed = false;
  /** Returning to his post */
  homing = false;
  private postYaw: number | null = null;
  private spearCd = 2;
  private castHp = 0;
  private readonly dir = new THREE.Vector3();

  constructor(h: MobHooks, at: THREE.Vector3) {
    super(h, 300, at);
    this.speed = 3.4;
    this.keep = 1.8;
    this.aggro = 6;
    this.mass = 2.2;
    this.loot = 6;
    this.rig = buildSoller(this, this.body);
    this.beam = lightBeam(BEAM, 16, 2.2);
    this.beamBase = this.beam.mats.map((x) => x.color.clone());
    this.spot = groundGlow(BEAM.clone(), 3.4, 0.9);
    this.spot.position.y = 0.04;
    this.beam.group.add(this.spot);
    h.scene.add(this.beam.group);
    this.place();
  }

  /** Praising the sun: standing at his post, arms up (or praying in combat) */
  get praising(): boolean {
    if (this.dead) return false;
    return (this.state === 'attack' && this.attack === 'praise') || (!this.alerted && !this.homing);
  }
  /** Sword in hand */
  get drawn(): boolean { return this.alerted || this.homing; }

  override dispose(): void {
    super.dispose();
    this.h.scene.remove(this.beam.group);
    for (const x of this.beam.mats) x.dispose();
    this.spot.material.dispose();
  }

  override notice(): void { this.homing = false; super.notice(); }

  protected override die(): void {
    super.die();
    this.rig.spear.visible = false;
    this.flash = 1;
    this.h.fx.text(this.pos.clone().setY(this.ground + this.topY + 0.5), t('Praise the sun!'), 'heal');
  }

  protected choose(dist: number, rel: number): string | null {
    if (!this.prayed && this.hp < this.maxHp * 0.5) return 'praise';
    if (dist < 2.8 && Math.abs(rel) < 0.6) return 'combo';
    if (this.spearCd <= 0 && dist > 4.5 && dist < 14 && Math.abs(rel) < 0.5) return 'spear';
    return null;
  }
  protected override rest(): number { return rand(1, 1.6); }

  override update(dt: number): void {
    this.postYaw ??= this.yaw;
    this.spearCd -= dt;
    // the hero went far away or fell — the fight is over: back to the post
    const hero = this.h.hero.pos;
    if (this.alerted && !this.dead && this.state !== 'attack' && this.state !== 'daze' && (this.h.hero.down || Math.hypot(hero.x - this.pos.x, hero.z - this.pos.z) > 18)) {
      this.alerted = false;
      this.homing = true;
    }
    super.update(dt);
    if (this.homing && !this.dead) this.goHome(dt);
    // beam: shines while he praises the sun; a flash on death
    this.flash = Math.max(0, this.flash - dt * 1.2);
    this.shine = lerpTo(this.shine, this.praising ? 1 : 0, Math.min(1, dt * (this.praising ? 1.5 : 2.5)));
    const k = Math.max(this.shine, this.flash);
    this.beam.group.visible = k > 0.01;
    this.beam.group.position.set(this.pos.x, 0, this.pos.z);
    this.beam.mats.forEach((x, i) => x.color.copy(this.beamBase[i]).multiplyScalar(k));
    this.spot.material.opacity = 0.9 * k;
    if (k > 0.4 && rnd() < 0.12 * k) {
      const a = rnd() * Math.PI * 2, r = rnd() * 0.9;
      this.h.fx.particle({ pos: new THREE.Vector3(this.pos.x + Math.cos(a) * r, rand(0.3, 4.5), this.pos.z + Math.sin(a) * r), vel: new THREE.Vector3(rand(-0.1, 0.1), rand(-0.25, 0.2), rand(-0.1, 0.1)), life: 1.4, size: rand(0.04, 0.08), color: SUN.clone().multiplyScalar(0.7), gravity: 0 });
    }
  }

  /** Walks to his post; arrived — full health, facing as he stood, arms up */
  private goHome(dt: number): void {
    const dx = this.home.x - this.pos.x, dz = this.home.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d > 0.3) {
      const sp = Math.min(d, this.speed * dt);
      this.pos.x += (dx / d) * sp; this.pos.z += (dz / d) * sp;
      this.yaw += Math.max(-this.turn * dt, Math.min(this.turn * dt, Math.atan2(Math.sin(Math.atan2(dx, dz) - this.yaw), Math.cos(Math.atan2(dx, dz) - this.yaw))));
      this.place();
      return;
    }
    this.homing = false;
    this.prayed = false;
    this.hp = this.maxHp;
    this.yaw = this.postYaw ?? this.yaw;
    this.place();
    if (!this.quiet) sfx.praise();
  }

  protected act(name: string, tm: number, dt: number): boolean {
    switch (name) {
      case 'combo':
        // three swings: a strip in front of him, a hit at its end, a step forward; after the third — open
        for (const at of [0, 0.6, 1.2]) {
          if (tm >= at && tm - dt < at) {
            const from = this.pos.clone(), dir = this.fwd();
            this.field.markLine(from, dir, 2.6, 1.6, 0.4, () => {
              if (this.dead) return;
              if (!this.quiet) sfx.swing();
              this.move(dir, 0.4);
              if (this.inLine(from, dir, 2.6, 1.6)) this.hurt(10, this.pos, 4);
            });
          }
        }
        if (tm % 0.6 < 0.35 && tm < 1.5) this.face(dt, 0.6);
        return tm > 2.5;
      case 'spear':
        // the spear over the head, a 14 m strip mark; the throw — and for a second he is defenceless
        if (tm - dt <= 0) {
          const from = this.pos.clone();
          this.dir.copy(this.fwd());
          this.rig.spear.visible = true;
          if (!this.quiet) sfx.charge();
          this.field.markLine(from, this.dir, 14, 1.1, 0.7, () => {
            this.rig.spear.visible = false;
            if (this.dead) return;
            if (!this.quiet) sfx.throw();
            this.field.shot(from, this.dir, 14, SPEAR, 45, 1.9);
            this.h.fx.burst(from.clone().addScaledVector(this.dir, 1).setY(this.ground + 1.9), [SPEAR, '#ffffff'], 10, { speed: 3, up: 1, size: 0.08, life: 0.4, glow: true, gravity: 2 });
            if (this.inLine(from, this.dir, 14, 1.1)) this.hurt(18, from, 6);
          }, SPEAR.clone().multiplyScalar(0.25));
          this.spearCd = 5;
        }
        return tm > 1.7;
      default: {
        // prayer: arms up, the beam is back, heals a quarter of health over 2 s; a hit interrupts it
        if (tm - dt <= 0) { this.prayed = true; this.castHp = this.hp; if (!this.quiet) sfx.praise(); }
        if (this.hp < this.castHp - 0.01) { this.h.fx.text(this.pos.clone().setY(this.ground + this.topY + 0.4), t('interrupted!'), 'crit'); this.daze(1.5); return false; }
        if (tm > 0.3) this.heal(this.maxHp * 0.125 * dt);
        this.castHp = this.hp;
        return tm > 2.3;
      }
    }
  }

  protected animate(dt: number, walk: boolean): void {
    const r = this.rig, k = Math.min(1, dt * 8), pray = this.praising;
    walk ||= this.homing;
    const s = walk ? this.stride(8) : 0;
    r.legs[0].rotation.x = lerpTo(r.legs[0].rotation.x, s * 0.55, k);
    r.legs[1].rotation.x = lerpTo(r.legs[1].rotation.x, -s * 0.55, k);
    // arms: praising — up in a V; combat — the sword, the spear over the head
    let right = walk ? -0.4 + s * 0.3 : -0.5, left = walk ? -s * 0.4 : 0, snap = false;
    if (this.state === 'attack' && this.attack === 'combo') { const u = this.st % 0.6; right = u < 0.4 ? -0.4 - (u / 0.4) * 2.2 : -2.6 + ((u - 0.4) / 0.2) * 2.4; snap = true; }
    if (this.state === 'attack' && this.attack === 'spear') { right = this.st < 0.7 ? -2.9 : -0.9; snap = this.st >= 0.7 && this.st < 0.8; }
    for (const [i, side] of [[0, -1], [1, 1]] as const) {
      const arm = r.arms[i];
      arm.rotation.z = lerpTo(arm.rotation.z, pray ? side * (Math.PI - 0.45) : 0, Math.min(1, dt * 5));
      arm.rotation.x = pray ? lerpTo(arm.rotation.x, 0, k) : snap && i === 0 ? right : lerpTo(arm.rotation.x, i === 0 ? right : left, k);
    }
    r.sword.visible = this.drawn && !this.dead;
    r.sheathed.children.forEach((c, i) => { if (i > 0) c.visible = !r.sword.visible; });
    r.head.rotation.x = lerpTo(r.head.rotation.x, pray ? -0.28 : this.state === 'daze' ? 0.3 : 0, k);
    // breathes, the feather sways
    r.torso.position.y = 0.8 + (pray ? Math.sin(this.time * 1.6) * 0.012 : 0);
    r.plume.rotation.x = Math.sin(this.time * 2) * 0.06 + (walk ? Math.sin(this.time * 9) * 0.1 : 0);
    r.plume.rotation.z = Math.sin(this.time * 1.3) * 0.05;
    this.body.rotation.x = this.state === 'daze' ? 0.2 : 0;
  }
}
