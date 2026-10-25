import * as THREE from 'three';
import { pixelTex } from '../textures';
import { boom, hiss, voice } from '../spell-audio';
import { C, glowMat, rand } from '../bosses/kit';
import { groundGlow, lightBeam } from '../loot-look';
import { Mob, type MobHooks } from './mob';

/**
 * 31. Соллер, Рыцарь Солнца (wiki/design-mobs.md, раздел 2G) — редкий одиночка, не из Ордена: славит солнце, которое
 * растит малину. Доспех — калька по рефам: шлем-ведро с Т-образным забралом, красное перо, зелёные лохматые наплечники,
 * туника с солнцем, кольчуга, поножи. В покое стоит, воздев руки, под столбом солнечного света; в бою — серия мечом,
 * солнечное копьё издали, раз за бой — молитва, лечит (удар её срывает). Герой ушёл — возвращается на место и снова славит.
 */

/** Тёплый солнечный свет: луч, копьё, искры */
const SUN = C(3.2, 2.5, 1.1);
const SPEAR = C(4, 3.2, 1.2);
/** Столб света мягче искр: рыцарь в нём должен читаться, а не тонуть в засветке */
const BEAM = C(0.5, 0.4, 0.18);

const sfx = {
  swing() { hiss({ dur: 0.2, vol: 0.13, f: 2200, f1: 800, q: 1.2, type: 'bandpass' }); },
  /** Копьё в руке: звон нарастает */
  charge() { voice({ type: 'sine', f: 440, f1: 880, dur: 0.7, vol: 0.05, verb: 0.5 }); },
  throw() { boom(700, 200, 0.25, 0.3); hiss({ dur: 0.35, vol: 0.12, f: 3800, f1: 1200, q: 1, type: 'bandpass', verb: 0.4 }); },
  /** Молитва: светлый аккорд */
  praise() { for (const f of [392, 494, 587]) voice({ type: 'sine', f, dur: 1.6, vol: 0.035, verb: 0.7 }); },
};

/** Холст в пикселях: рисуем по точкам, без сглаживания */
function canvas(w: number, h: number, paint: (px: (x: number, y: number, c: string) => void) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  paint((x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); });
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Шум от координат 0..1 (детерминированный) */
const hash = (x: number, y: number): number => { let v = Math.imul(x + 31, 374761393) + Math.imul(y + 17, 668265263); v = Math.imul(v ^ (v >>> 13), 1274126177); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };
const shade = (hex: string, d: number): string => {
  const n = parseInt(hex.slice(1), 16), f = (v: number) => Math.max(0, Math.min(255, Math.round(v + d)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
};

/**
 * Солнце на тунике, 32 × 32: грязно-белое полотно, 9 красных волнистых лучей, жёлтый диск с лицом
 * (брови, глаза, нос, рот) и красными крапинками — как на рефе
 */
let sunTex: THREE.CanvasTexture | null = null;
const sunEmblem = (): THREE.CanvasTexture => sunTex ??= canvas(32, 32, (px) => {
  const cx = 15.5, cy = 15, RAYS = 9;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const n = hash(x, y);
    // полотно с грязью: пятна темнее к низу
    let col = shade('#d6cfbf', (n - 0.5) * 14 - (y / 32) * 10 - (hash(x >> 2, y >> 2) > 0.8 ? 14 : 0));
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    if (r > 5.6 && r < 14.8) {
      // луч: ближайший по углу, волна поперёк, к концу тоньше
      const step = (Math.PI * 2) / RAYS, k = Math.round((a + Math.PI / 2) / step);
      const off = (a + Math.PI / 2 - k * step) * r;
      const wave = Math.sin(r * 1.15) * 0.9, half = 2.1 * (1 - (r - 5.6) / 10) + 0.45;
      if (Math.abs(off - wave) < half) col = shade('#d8402c', (n - 0.5) * 18);
    }
    if (r <= 6.1) {
      col = r > 5.4 ? '#e8a030' : shade('#f5d93a', (n - 0.5) * 10);
      // красные крапинки по краю диска
      if (r > 3.8 && r < 5.4 && n > 0.86) col = '#d8602c';
    }
    px(x, y, col);
  }
  // лицо: брови домиком, глаза, нос, губы — тёмно-коричневым
  const ink = '#6a3a1c', X = Math.round(cx - 0.5), Y = Math.round(cy);
  for (const [x, y] of [[-3, -3], [-2, -3], [-1, -2], [2, -3], [3, -3], [1, -2], [-2, -1], [2, -1], [0, 0], [0, 1], [1, 1], [-1, 3], [0, 3], [1, 3]]) px(X + x, Y + y, ink);
  px(X - 2, Y - 1, '#3a2010'); px(X + 2, Y - 1, '#3a2010');
});

/** Кольчуга: ряды колечек, светлые и тёмные вперемешку */
let mailTex: THREE.CanvasTexture | null = null;
const chainmail = (): THREE.CanvasTexture => mailTex ??= canvas(16, 16, (px) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const ring = (x + (y % 2) * 2) % 4;
    px(x, y, shade(ring === 0 ? '#4a4c50' : ring === 2 ? '#a8acb0' : '#7c8086', (hash(x, y) - 0.5) * 16));
  }
});

/** Части Соллера: всё, что качается */
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

  // ноги: кольчужные штаны, стальные поножи до колена с ободком, кольчужные сапоги
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
  // туника: полотно на корпусе, спереди и сзади — солнце
  B(torso, cloth, 0.68, 0.84, 0.42, 0, 0.42, 0);
  B(torso, sun, 0.64, 0.64, 0.02, 0, 0.5, 0.215);
  B(torso, sun, 0.64, 0.64, 0.02, 0, 0.5, -0.215);
  // бахромчатый подол ниже пояса: спереди и сзади пластина, по низу — зубцы разной длины
  for (const z of [0.19, -0.19]) {
    B(torso, cloth, 0.68, 0.22, 0.05, 0, -0.06, z);
    for (let i = 0; i < 7; i++) {
      const l = 0.1 + hash(i, z > 0 ? 1 : 2) * 0.14;
      B(torso, cloth, 0.09, l, 0.05, -0.29 + i * 0.097, -0.17 - l / 2, z);
    }
  }
  // широкий ремень с ромбовидными бляхами и пряжкой; второй ремень наискось — для меча
  B(torso, leather, 0.71, 0.11, 0.45, 0, 0.06, 0);
  for (let i = 0; i < 5; i++) if (i !== 2) B(torso, stud, 0.045, 0.045, 0.02, -0.26 + i * 0.13, 0.06, 0.232, 0, 0, Math.PI / 4);
  B(torso, steelDark, 0.1, 0.09, 0.02, 0, 0.06, 0.235);
  B(torso, leather, 0.62, 0.06, 0.03, -0.02, -0.06, 0.23, 0, 0, -0.32);
  // капюшон: две «баранки» складками вокруг шеи
  B(torso, cowl, 0.52, 0.13, 0.46, 0, 0.88, 0);
  B(torso, cowl, 0.44, 0.11, 0.4, 0.01, 0.98, 0.01, 0, 0.2, 0);
  // наплечники: бледно-зелёный мех слоями, рваный край свисает
  for (const s of [-1, 1]) {
    B(torso, fur[0], 0.36, 0.14, 0.5, s * 0.42, 0.78, 0);
    B(torso, fur[1], 0.3, 0.1, 0.44, s * 0.46, 0.68, 0);
    for (let i = 0; i < 6; i++) {
      const l = 0.1 + hash(i, s + 5) * 0.16, z = -0.21 + i * 0.084;
      B(torso, fur[i % 3], 0.07, l, 0.08, s * (0.56 + hash(i, s) * 0.04), 0.66 - l / 2, z, 0, 0, s * 0.25);
    }
    for (const z of [-0.26, 0.26]) B(torso, fur[2], 0.3, 0.1, 0.06, s * 0.44, 0.66, z);
  }
  // ножны у левого бедра (лицом к +Z левый бок — +X), рукоять над ними; в бою меч в руке — ножны пусты
  const sheathed = new THREE.Group();
  sheathed.position.set(0.4, 0, 0.02);
  sheathed.rotation.x = 0.5;
  torso.add(sheathed);
  B(sheathed, leather, 0.09, 0.7, 0.11, 0, -0.28, 0);
  B(sheathed, steelDark, 0.24, 0.05, 0.07, 0, 0.1, 0);
  B(sheathed, leather, 0.06, 0.2, 0.06, 0, 0.22, 0);

  // голова: горжет с рёбрами, шлем-ведро, Т-образное забрало с заклёпками, перо сзади слева
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

  // руки: кольчужный рукав, кожаный наруч, стальная манжета, перчатка
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

  // прямой меч в правой руке (−X): рукоять, перекрестье, клинок
  const sword = new THREE.Group();
  sword.position.set(0, -0.68, 0);
  arms[0].add(sword);
  const blade = m.lam('#dfe3e8');
  B(sword, leather, 0.06, 0.06, 0.22, 0, 0, 0.02);
  B(sword, steelDark, 0.3, 0.05, 0.07, 0, 0, 0.14);
  B(sword, blade, 0.08, 0.035, 0.92, 0, 0, 0.62);
  B(sword, steelDark, 0.07, 0.07, 0.06, 0, 0, -0.12);
  // солнечное копьё: светится в поднятой руке перед броском
  const spear = B(arms[0], glowMat(SPEAR), 0.08, 1.5, 0.08, 0, -0.7, 0);
  spear.visible = false;
  return { legs, torso, head, arms, plume, sword, sheathed, spear };
}

const lerpTo = (v: number, to: number, k: number): number => v + (to - v) * k;

export class SunKnight extends Mob {
  readonly kind = 'soller';
  readonly title = 'Соллер, Рыцарь Солнца';
  override readonly subtitle: string = 'воин Солнца';
  readonly cost = 14;
  readonly radius = 0.5;
  override readonly topY = 2.5;
  private readonly rig: Rig;
  /** Столб солнечного света и пятно на полу */
  private readonly beam: { group: THREE.Group; mats: THREE.MeshBasicMaterial[] };
  private readonly spot: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly beamBase: THREE.Color[];
  /** Яркость луча 0..1 и вспышка на смерти */
  shine = 1;
  private flash = 0;
  /** Молился в этом бою (лечится раз) */
  prayed = false;
  /** Возвращается на пост */
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

  /** Славит солнце: стоит на посту, руки вверх (или молится в бою) */
  get praising(): boolean {
    if (this.dead) return false;
    return (this.state === 'attack' && this.attack === 'praise') || (!this.alerted && !this.homing);
  }
  /** Меч в руке */
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
    this.h.fx.text(this.pos.clone().setY(this.topY + 0.5), 'Восславь солнце!', 'heal');
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
    // герой ушёл далеко или пал — бой окончен: назад на пост
    const hero = this.h.hero.pos;
    if (this.alerted && !this.dead && this.state !== 'attack' && this.state !== 'daze' && (this.h.hero.down || Math.hypot(hero.x - this.pos.x, hero.z - this.pos.z) > 18)) {
      this.alerted = false;
      this.homing = true;
    }
    super.update(dt);
    if (this.homing && !this.dead) this.goHome(dt);
    // луч: светит, пока славит солнце; на смерти — вспышка
    this.flash = Math.max(0, this.flash - dt * 1.2);
    this.shine = lerpTo(this.shine, this.praising ? 1 : 0, Math.min(1, dt * (this.praising ? 1.5 : 2.5)));
    const k = Math.max(this.shine, this.flash);
    this.beam.group.visible = k > 0.01;
    this.beam.group.position.set(this.pos.x, 0, this.pos.z);
    this.beam.mats.forEach((x, i) => x.color.copy(this.beamBase[i]).multiplyScalar(k));
    this.spot.material.opacity = 0.9 * k;
    if (k > 0.4 && Math.random() < 0.12 * k) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 0.9;
      this.h.fx.particle({ pos: new THREE.Vector3(this.pos.x + Math.cos(a) * r, rand(0.3, 4.5), this.pos.z + Math.sin(a) * r), vel: new THREE.Vector3(rand(-0.1, 0.1), rand(-0.25, 0.2), rand(-0.1, 0.1)), life: 1.4, size: rand(0.04, 0.08), color: SUN.clone().multiplyScalar(0.7), gravity: 0 });
    }
  }

  /** Шагает на пост; дошёл — здоровье полное, лицом как стоял, руки вверх */
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

  protected act(name: string, t: number, dt: number): boolean {
    switch (name) {
      case 'combo':
        // три взмаха: полоса перед ним, удар по её концу, шаг вперёд; после третьего — открыт
        for (const at of [0, 0.6, 1.2]) {
          if (t >= at && t - dt < at) {
            const from = this.pos.clone(), dir = this.fwd();
            this.field.markLine(from, dir, 2.6, 1.6, 0.4, () => {
              if (this.dead) return;
              if (!this.quiet) sfx.swing();
              this.move(dir, 0.4);
              if (this.inLine(from, dir, 2.6, 1.6)) this.hurt(10, this.pos, 4);
            });
          }
        }
        if (t % 0.6 < 0.35 && t < 1.5) this.face(dt, 0.6);
        return t > 2.5;
      case 'spear':
        // копьё над головой, полоса-метка 14 м; бросок — и секунду он без защиты
        if (t - dt <= 0) {
          const from = this.pos.clone();
          this.dir.copy(this.fwd());
          this.rig.spear.visible = true;
          if (!this.quiet) sfx.charge();
          this.field.markLine(from, this.dir, 14, 1.1, 0.7, () => {
            this.rig.spear.visible = false;
            if (this.dead) return;
            if (!this.quiet) sfx.throw();
            this.field.shot(from, this.dir, 14, SPEAR, 45, 1.9);
            this.h.fx.burst(from.clone().addScaledVector(this.dir, 1).setY(1.9), [SPEAR, '#ffffff'], 10, { speed: 3, up: 1, size: 0.08, life: 0.4, glow: true, gravity: 2 });
            if (this.inLine(from, this.dir, 14, 1.1)) this.hurt(18, from, 6);
          }, SPEAR.clone().multiplyScalar(0.25));
          this.spearCd = 5;
        }
        return t > 1.7;
      default: {
        // молитва: руки вверх, луч вернулся, за 2 с лечит четверть здоровья; удар её срывает
        if (t - dt <= 0) { this.prayed = true; this.castHp = this.hp; if (!this.quiet) sfx.praise(); }
        if (this.hp < this.castHp - 0.01) { this.h.fx.text(this.pos.clone().setY(this.topY + 0.4), 'сорвано!', 'crit'); this.daze(1.5); return false; }
        if (t > 0.3) this.heal(this.maxHp * 0.125 * dt);
        this.castHp = this.hp;
        return t > 2.3;
      }
    }
  }

  protected animate(dt: number, walk: boolean): void {
    const r = this.rig, k = Math.min(1, dt * 8), pray = this.praising;
    walk ||= this.homing;
    const s = walk ? this.stride(8) : 0;
    r.legs[0].rotation.x = lerpTo(r.legs[0].rotation.x, s * 0.55, k);
    r.legs[1].rotation.x = lerpTo(r.legs[1].rotation.x, -s * 0.55, k);
    // руки: славит — вверх буквой V; бой — меч, копьё над головой
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
    // дышит, перо колышется
    r.torso.position.y = 0.8 + (pray ? Math.sin(this.time * 1.6) * 0.012 : 0);
    r.plume.rotation.x = Math.sin(this.time * 2) * 0.06 + (walk ? Math.sin(this.time * 9) * 0.1 : 0);
    r.plume.rotation.z = Math.sin(this.time * 1.3) * 0.05;
    this.body.rotation.x = this.state === 'daze' ? 0.2 : 0;
  }
}
