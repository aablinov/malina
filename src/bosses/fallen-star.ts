import * as THREE from 'three';
import { rnd } from '../rng.ts';
import { pixelTex } from '../textures.ts';
import { bell, boom, hiss, voice } from '../spell-audio.ts';
import type { Rect } from './arena.ts';
import { C, glowMat, rand, RASP, UNIT, type BossHooks } from './kit.ts';
import { MiniBoss } from './mini.ts';
import { t } from '../i18n/i18n.ts';

/**
 * Fallen Star — final warden (wiki/design-bosses.md, sections 1–5; a schematic "Heart of the Edge" / Astel): the very
 * star in whose crater the first raspberries grew. A relic: a crystal core of four facets and two spires hovers
 * a metre and a half above the floor, three rings of cubes around it, each spinning about its own axis; the berry heart glows
 * between the facets, when dazed the facets open and the heart beats hard. Drifts slowly, sheds stardust.
 * Phase 1: a beam (charge → strip → a huge beam slowly sweeps ±35°, afterwards overheat and daze), a meteor shower
 * at the hero (burning funnels), a ring of 12 shards outward, up close — a pulse.
 * Transformation at 50 %: "The Star Awakens" — darkness, camera back, the rings open into a halo, the core rises,
 * the floor cracks in rays from the centre. Phase 2: the beam sweeps 180°, meteors across the whole arena, every ~14 s a "supernova" —
 * three crystal pillar shelters, the core shrinks and pulls the hero, a circle r 10 → explosion (behind a pillar — unharmed), daze.
 * Drops "Ray of the Fallen Star". Moving parts: heart, four facets, three rings.
 */

const STAR = C(3.6, 3.6, 4), GOLD = C(4, 3.6, 2.4), PINK = C(4, 1.7, 2.4), EMBER = C(4, 1.6, 0.5);
/** Centre of the core above the body root, m */
const CORE_Y = 1.2;
/** Beam: length, width, damage per 0.2 s tick */
const BEAM_LEN = 30, BEAM_W = 2.2, BEAM_DMG = 8;
/** Supernova: radius, damage, cooldown */
const NOVA_R = 10, NOVA_DMG = 30, NOVA_CD = 14;
/** Pillar shelters: height, half-width (for pushing the hero) */
const PILLAR_H = 3.2, PILLAR_R = 0.75;

const sfx = {
  /** Beam charge: a rising choir and a ring */
  charge() { voice({ type: 'sine', f: 392, f1: 1568, dur: 1.6, vol: 0.05, attack: 0.4, verb: 0.8 }); bell(1568, 1.2, 0.03, 0.6, 0.8); },
  /** Beam: a low hum and the hiss of light */
  beam(dur: number) { voice({ type: 'sawtooth', f: 98, f1: 92, dur, vol: 0.06, detune: 12, lp: 1400, verb: 0.6 }); hiss({ dur, vol: 0.14, f: 3000, q: 0.5, type: 'bandpass', attack: 0.05, verb: 0.5 }); boom(90, 30, 0.8, 0.6, 0, 0.6); },
  /** Meteor: whistle and impact */
  impact() { boom(110, 40, 0.35, 0.35); hiss({ dur: 0.3, vol: 0.1, f: 3000, f1: 700, q: 0.8, type: 'bandpass' }); },
  /** Shards: a glassy chime */
  shards() { for (const [f, d] of [[1760, 0], [2349, 0.04], [2637, 0.08]] as const) bell(f, 0.5, 0.035, d, 0.6); },
  /** Pulse and explosions: a hit from below */
  thump(k = 1) { boom(70, 25, 0.6 * k, 0.5 * k, 0, 0.5); },
  /** Awakening: a bell and a low choir */
  awaken() { bell(196, 3, 0.09, 0, 0.9); voice({ type: 'triangle', f: 98, f1: 196, dur: 2.6, vol: 0.06, lp: 800, lp1: 3000, verb: 0.9 }); },
};

export class FallenStar extends MiniBoss {
  readonly radius = 1.4;
  readonly title = t('Fallen Star');
  override readonly subtitle = t('heart of a fallen star');
  override readonly topY = 4.6;
  readonly drop = 'starbeam';
  override readonly tier = 'final' as const;
  private readonly heart = new THREE.Group();
  private readonly facets: THREE.Group[] = [];
  private readonly rings: THREE.Group[] = [];
  private readonly ringSpin = [0, 0, 0];
  private readonly pillars: THREE.Group[] = [];
  /** Pillar: raised or not (animation of rising out of the floor) */
  private readonly pillarUp = [false, false, false];
  /** Deferred actions (the meteor falls a little before the mark flashes) */
  private readonly later: { t: number; fn: () => void }[] = [];
  private beam: { g: THREE.Group; mats: THREE.Material[] } | null = null;
  private readonly aim = new THREE.Vector3();
  private beamTick = 0;
  private beamSide = 1;
  /** Beam of the second phase (180°) — remembered at the start, rage mid-beam does not break it */
  private beamWide = false;
  private beamCd = 3;
  private novaCd = 99;
  /** Rage has come — the transformation waits its turn (does not cut the current attack short) */
  private wakeUp = false;
  /** Halo: 0 — rings, 1 — the open halo of the second phase */
  private haloK = 0;
  /** Ring spin (beam charge — fast) */
  private spinK = 1;

  constructor(h: BossHooks, home: THREE.Vector3, yaw: number, arena: Rect) {
    super(h, 3400, home, yaw, arena);
    this.speed = 1.6;
    this.keep = 4;
    this.turn = 1.6;
    this.build();
    this.reset();
  }

  protected build(): void {
    const crystal = this.lam('#f4e6c0', pixelTex('#f4e6c0', 10, 977));
    const edgeM = this.shimmer(GOLD, RASP, 0, 1.4);
    const heartM = this.shimmer(RASP, PINK, 0, 3);
    const starM = this.shimmer(STAR, GOLD, 1, 2);
    const B = this.box.bind(this);
    // spires above and below — diamonds, static relative to the body
    B(this.body, crystal, 0.62, 0.62, 0.62, 0, CORE_Y + 1.0, 0, Math.PI / 4, 0, Math.PI / 4);
    B(this.body, starM, 0.3, 0.3, 0.3, 0, CORE_Y + 1.5, 0, Math.PI / 4, 0, Math.PI / 4);
    B(this.body, crystal, 0.5, 0.5, 0.5, 0, CORE_Y - 0.95, 0, Math.PI / 4, 0, Math.PI / 4);
    // berry heart in the centre: visible through the gaps between the facets
    this.heart.position.y = CORE_Y;
    this.body.add(this.heart);
    for (const [x, y, z, k] of [[0, 0, 0, 0.5], [0.22, 0.12, 0, 0.26], [-0.22, 0.12, 0, 0.26], [0, 0.12, 0.22, 0.26], [0, 0.12, -0.22, 0.26], [0, 0.34, 0, 0.2]] as const) B(this.heart, heartM, k, k, k, x, y, z);
    // four facets: a crystal plate and a glowing edge; the corners between them are open
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      g.rotation.order = 'YXZ';
      this.body.add(g);
      B(g, crystal, 0.62, 1.5, 0.3, 0, 0, 0);
      B(g, edgeM, 0.08, 1.3, 0.34, 0.3, 0, 0.02);
      this.facets.push(g);
    }
    // three rings of cubes, each with its own tilt and radius
    const ringMats = [starM, edgeM, this.shimmer(GOLD, STAR, 2, 1.1)];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      g.position.y = CORE_Y;
      this.body.add(g);
      const r = 1.35 + i * 0.4, n = 9 + i * 2;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2, s = k % 3 === 0 ? 0.26 : 0.17;
        B(g, k % 3 === 0 ? heartM : ringMats[i], s, s, s, Math.cos(a) * r, 0, Math.sin(a) * r, a, a, 0);
      }
      this.rings.push(g);
    }
    // pillar shelters for the supernova: stand under the floor until needed
    const pm = new THREE.MeshLambertMaterial({ map: pixelTex('#e8dcc0', 10, 981) });
    const pg = glowMat(GOLD);
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      B(g, pm, 1.1, PILLAR_H, 1.1, 0, PILLAR_H / 2, 0, 0, Math.PI / 4, 0);
      B(g, pg, 0.5, 0.5, 0.5, 0, PILLAR_H + 0.25, 0, Math.PI / 4, 0, Math.PI / 4);
      g.visible = false;
      this.h.scene.add(g);
      this.pillars.push(g);
    }
  }

  override reset(): void {
    super.reset();
    this.cleanup();
    this.wakeUp = false; this.haloK = 0; this.spinK = 1;
    this.beamCd = 3; this.novaCd = 99;
    this.body.position.y = 1.5;
  }

  protected override die(): void {
    super.die();
    this.cleanup();
  }

  /** Remove its own: beam, timers, pillars */
  private cleanup(): void {
    this.later.length = 0;
    this.endBeam();
    for (let i = 0; i < 3; i++) { this.pillarUp[i] = false; this.pillars[i].visible = false; this.pillars[i].position.y = -PILLAR_H; }
  }

  protected override onEnrage(): void { this.wakeUp = true; }

  protected choose(dist: number): string | null {
    if (this.wakeUp) return 'awaken';
    if (this.enraged && this.novaCd <= 0) return 'nova';
    if (dist < 5 && rnd() < 0.45) return 'pulse';
    if (this.beamCd <= 0 && rnd() < 0.55) return 'beam';
    return rnd() < 0.5 ? 'meteors' : 'shards';
  }

  protected act(name: string, ta: number, dt: number): boolean {
    const fx = this.h.fx, crossed = (at: number) => ta >= at && ta - dt < at;
    switch (name) {
      case 'beam': {
        // charge 1 s (the rings spin up, the light gathers) → strip 0.8 s → the beam sweeps ±35° (in rage — 180°)
        if (!this.hitDone) { this.beamWide = this.enraged; }
        const sweep = this.beamWide ? 3 : 2, fire = 1.8;
        if (!this.hitDone) { this.hitDone = true; this.beamCd = 9; this.beamSide = rnd() < 0.5 ? -1 : 1; if (!this.quiet) sfx.charge(); }
        if (ta < 1) {
          this.face(dt, 2);
          this.spinK = 1 + ta * 5;
          const c = this.core(), a = rand(0, Math.PI * 2), r = rand(1.5, 3);
          fx.particle({ pos: c.clone().add(new THREE.Vector3(Math.cos(a) * r, rand(-1, 1), Math.sin(a) * r)), vel: new THREE.Vector3(-Math.cos(a) * r * 2, 0, -Math.sin(a) * r * 2), life: 0.45, size: 0.1, color: rnd() < 0.7 ? GOLD : RASP, gravity: 0 });
        }
        if (crossed(1)) {
          this.aim.copy(this.heroAt()).sub(this.pos).setY(0);
          if (this.aim.lengthSq() < 1e-4) this.aim.copy(this.fwd());
          this.aim.normalize();
          this.yaw = Math.atan2(this.aim.x, this.aim.z);
          this.markLine(this.pos.clone().setY(0), this.aim, BEAM_LEN, BEAM_W, fire - 1, () => undefined, GOLD);
        }
        if (crossed(fire)) {
          this.fireBeam();
          fx.screenFlash('#fff0c0', 0.35, 0.3);
          fx.flash(this.core(), STAR, 4, 0.3);
          fx.light(this.core(), GOLD, 10, 18, sweep);
          fx.shake = Math.max(fx.shake, 0.5);
          if (!this.quiet) sfx.beam(sweep);
        }
        if (ta >= fire && ta < fire + sweep && this.beam) {
          const u = (ta - fire) / sweep;
          const ang = this.beamWide ?this.beamSide * Math.PI * (u * u * (3 - 2 * u)) : this.beamSide * THREE.MathUtils.degToRad(35) * Math.sin(u * Math.PI * 1.5);
          const dir = this.aim.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
          this.yaw = Math.atan2(dir.x, dir.z);
          this.aimBeam(dir, Math.min(1, (ta - fire) * 6, (fire + sweep - ta) * 5));
          this.beamTick -= dt;
          const from = this.pos.clone().setY(0);
          if (this.beamTick <= 0 && this.inLine(from, dir, BEAM_LEN, BEAM_W)) { this.beamTick = 0.2; this.hurt(BEAM_DMG, from, 3); }
          // along the floor — sparks along the beam
          const p = from.addScaledVector(dir, rand(2, BEAM_LEN * 0.6)).setY(0.2);
          fx.particle({ pos: p, vel: new THREE.Vector3(rand(-1, 1), rand(1, 3), rand(-1, 1)), life: 0.4, size: 0.12, color: rnd() < 0.6 ? GOLD : RASP, gravity: 6 });
        }
        if (ta < fire + sweep) return false;
        // overheat: the facets open, the heart exposed
        this.endBeam();
        this.spinK = 1;
        fx.burst(this.core(), [EMBER, GOLD, RASP], 20, { speed: 4, up: 2, size: 0.12, life: 0.7, glow: true, gravity: 3 });
        fx.text(this.core().setY(this.topY + 0.8), t('overheat'), 'crit');
        this.daze(this.enraged ? 2 : 2.5);
        return true;
      }
      case 'meteors': {
        // star shards from the sky: at the hero (in rage — across the whole arena), every funnel burns
        if (!this.hitDone) {
          this.hitDone = true;
          const n = this.enraged ? 22 : 8, a = this.arena;
          for (let i = 0; i < n; i++) {
            let at: THREE.Vector3;
            if (i < 3 || !this.enraged) { const an = rand(0, Math.PI * 2), r = i === 0 ? 0 : rand(1.5, 5.5); at = this.heroAt().add(new THREE.Vector3(Math.cos(an) * r, 0, Math.sin(an) * r)); }
            else at = new THREE.Vector3(rand(a.x0, a.x1), 0, rand(a.z0, a.z1));
            this.meteor(this.clampIn(at, 1), 1.0 + i * (this.enraged ? 0.09 : 0.15), i);
          }
        }
        return ta > (this.enraged ? 2.4 : 1.6);
      }
      case 'shards': {
        // 12 shards from the core outward along rays; in rage — a second wave with an offset
        if (!this.hitDone) { this.hitDone = true; this.shardRing(0); }
        if (this.enraged && crossed(0.6)) this.shardRing(Math.PI / 12);
        return ta > (this.enraged ? 1.9 : 1.3);
      }
      case 'pulse': {
        // the core shrinks and pushes out a ring of light
        if (!this.hitDone) {
          this.hitDone = true;
          const at = this.pos.clone().setY(0);
          this.markCircle(at, 4.5, 0.65, () => {
            fx.shock(at.clone().setY(0.15), 4.5, GOLD, 0.4, 0.3);
            fx.burst(this.core(), [STAR, GOLD, RASP], 16, { speed: 6, up: 1, size: 0.12, life: 0.5, glow: true, gravity: 2 });
            fx.shake = Math.max(fx.shake, 0.35);
            if (!this.quiet) sfx.thump();
            if (this.inCircle(at, 4.5)) this.hurt(14, at, 10);
          }, GOLD);
        }
        return ta > 1;
      }
      case 'awaken': {
        // transformation: darkness, camera back, the rings — into a halo, the core rises, the floor cracks in rays
        if (!this.hitDone) {
          this.hitDone = true;
          this.wakeUp = false;
          fx.title(t('The Star Awakens'), '#ffd27a');
          fx.darken(2.2);
          fx.zoom = Math.max(fx.zoom, 0.4);
          fx.screenFlash('#ffe0a0', 0.4, 0.5);
          fx.shake = Math.max(fx.shake, 0.6);
          if (!this.quiet) sfx.awaken();
        }
        this.spinK = 3;
        if (crossed(0.9)) {
          const from = this.pos.clone().setY(0), base = rand(0, Math.PI * 2);
          for (let i = 0; i < 6; i++) {
            const a = base + (i / 6) * Math.PI * 2, dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
            this.markLine(from, dir, 13, 1.2, 0.9, () => this.crack(from, dir), EMBER);
          }
        }
        if (ta < 2.6) return false;
        this.spinK = 1;
        this.novaCd = 6;
        return true;
      }
      case 'nova': {
        // supernova: pillars out of the floor → the core shrinks and pulls the hero → a circle r 10 → explosion → daze
        const at = this.pos.clone().setY(0);
        if (!this.hitDone) { this.hitDone = true; this.novaCd = NOVA_CD; this.raisePillars(); if (!this.quiet) bell(147, 2.5, 0.08, 0, 0.9); }
        if (crossed(0.6)) this.markCircle(at, NOVA_R, 2.4, () => this.novaBoom(at), RASP);
        if (ta > 0.6 && ta < 2.1) {
          const hero = this.h.hero.pos, dx = this.pos.x - hero.x, dz = this.pos.z - hero.z, d = Math.hypot(dx, dz);
          if (d > 2) { hero.x += (dx / d) * 1.8 * dt; hero.z += (dz / d) * 1.8 * dt; }
          const c = this.core(), a = rand(0, Math.PI * 2), r = rand(3, 6);
          fx.particle({ pos: c.clone().add(new THREE.Vector3(Math.cos(a) * r, rand(-1.5, 1.5), Math.sin(a) * r)), vel: new THREE.Vector3(-Math.cos(a) * r * 1.5, 0, -Math.sin(a) * r * 1.5), life: 0.6, size: 0.12, color: rnd() < 0.5 ? RASP : GOLD, gravity: 0 });
        }
        if (ta < 3.3) return false;
        this.later.push({ t: 3.5, fn: () => this.lowerPillars() });
        this.daze(3);
        return true;
      }
    }
    return true;
  }

  /** Centre of the core in the world */
  private core(): THREE.Vector3 { return this.pos.clone().setY(this.body.position.y + CORE_Y); }

  /** Beam: a white core, gold and raspberry glow; length along local +Z */
  private fireBeam(): void {
    this.endBeam();
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    const mats = [glowMat(STAR), glowMat(GOLD.clone().multiplyScalar(0.5), 0.6, true), glowMat(RASP.clone().multiplyScalar(0.25), 0.4, true)];
    this.box(g, mats[0], 0.7, 0.7, BEAM_LEN, 0, 0, BEAM_LEN / 2);
    this.box(g, mats[1], 1.5, 1.5, BEAM_LEN, 0, 0, BEAM_LEN / 2);
    this.box(g, mats[2], BEAM_W + 0.3, BEAM_W + 0.3, BEAM_LEN, 0, 0, BEAM_LEN / 2);
    this.h.scene.add(g);
    this.beam = { g, mats };
    this.beamTick = 0;
  }

  /** Aim the beam: from the core slightly down, to the floor at the far end; k — thickness (flares up and fades) */
  private aimBeam(dir: THREE.Vector3, k: number): void {
    if (!this.beam) return;
    const g = this.beam.g, c = this.core();
    g.position.copy(c);
    g.rotation.set(Math.atan2(c.y - 0.4, BEAM_LEN), Math.atan2(dir.x, dir.z), 0);
    const w = Math.max(0.05, k) * (1 + Math.sin(this.time * 30) * 0.06);
    g.scale.set(w, w, 1);
  }

  private endBeam(): void {
    if (!this.beam) return;
    this.h.scene.remove(this.beam.g);
    for (const m of this.beam.mats) m.dispose();
    this.beam = null;
  }

  /** A mark and a star shard falling into it: damage 16, the funnel burns 4 s */
  private meteor(at: THREE.Vector3, dur: number, i: number): void {
    this.markCircle(at, 1.6, dur, () => {
      const fx = this.h.fx;
      fx.burst(at.clone().setY(0.3), [STAR, GOLD, EMBER], 10, { speed: 3.5, up: 4, size: 0.12, life: 0.6, glow: true, gravity: 8 });
      fx.shock(at.clone().setY(0.08), 1.6, EMBER.clone().multiplyScalar(0.6), 0.3, 0.12);
      if (!this.quiet && i % 3 === 0) sfx.impact();
      if (this.inCircle(at, 1.6)) this.hurt(16, at, 4);
      this.hazard(at, 1.1, 4, 8, EMBER);
    }, GOLD);
    this.later.push({ t: dur - 0.35, fn: () => {
      const m = new THREE.Mesh(UNIT, glowMat(i % 3 === 1 ? RASP : STAR));
      m.scale.setScalar(0.55);
      this.lob(m, at.clone().add(new THREE.Vector3(rand(-2, 2), 15, rand(-2, 2))), at, 0.35, 0, GOLD, () => undefined);
    } });
  }

  /** 12 strips from the core; crystal shards fly along them: damage 12 */
  private shardRing(off: number): void {
    const from = this.pos.clone().setY(0), len = 10, dirs: THREE.Vector3[] = [];
    for (let i = 0; i < 12; i++) { const a = off + (i / 12) * Math.PI * 2; dirs.push(new THREE.Vector3(Math.sin(a), 0, Math.cos(a))); }
    for (const d of dirs) this.markLine(from, d, len, 1, 0.8, () => undefined, GOLD);
    this.later.push({ t: 0.8, fn: () => {
      const fx = this.h.fx, mat = glowMat(STAR), g = new THREE.Group();
      for (const d of dirs) this.box(g, mat, 0.25, 0.25, 0.9, 0, 0, 0, 0, Math.atan2(d.x, d.z), 0);
      g.position.copy(from).setY(1.2);
      fx.custom(g, 0.45, (k) => g.children.forEach((m, i) => m.position.copy(dirs[i]).multiplyScalar(1 + (len - 1) * k)), () => mat.dispose());
      fx.flash(this.core(), GOLD, 2.5, 0.2);
      if (!this.quiet) sfx.shards();
      if (dirs.some((d) => this.inLine(from, d, len, 1))) this.hurt(12, from, 5);
    } });
  }

  /** Floor crack from the centre: damage 10 at once, then burns 10 s */
  private crack(from: THREE.Vector3, dir: THREE.Vector3): void {
    if (this.inLine(from, dir, 13, 1.2)) this.hurt(10, from, 4);
    for (let d = 2; d <= 13; d += 1.6) {
      const p = this.clampIn(from.clone().addScaledVector(dir, d), 0.8);
      this.hazard(p, 0.75, 10, 6, EMBER);
      this.h.fx.burst(p.clone().setY(0.2), [EMBER, GOLD], 4, { speed: 2, up: 3, size: 0.1, life: 0.5, glow: true, gravity: 6 });
    }
    this.h.fx.shake = Math.max(this.h.fx.shake, 0.3);
  }

  /** Three pillars around the core 120° apart */
  private raisePillars(): void {
    const base = rand(0, Math.PI * 2);
    for (let i = 0; i < 3; i++) {
      const a = base + (i / 3) * Math.PI * 2, p = this.clampIn(this.pos.clone().add(new THREE.Vector3(Math.sin(a) * 6.5, 0, Math.cos(a) * 6.5)), 2);
      const g = this.pillars[i];
      g.position.set(p.x, -PILLAR_H, p.z);
      g.visible = true;
      this.pillarUp[i] = true;
      this.h.fx.burst(p.clone().setY(0.3), ['#e8dcc0', GOLD], 12, { speed: 3, up: 4, size: 0.14, life: 0.6, gravity: 10 });
    }
    this.h.fx.shake = Math.max(this.h.fx.shake, 0.3);
  }

  private lowerPillars(): void { for (let i = 0; i < 3; i++) this.pillarUp[i] = false; }

  /** Hero behind a pillar (farther from the core than the pillar, right next to it, not to the side) */
  private sheltered(c: THREE.Vector3): boolean {
    const hero = this.h.hero.pos;
    return this.pillars.some((g, i) => {
      if (!this.pillarUp[i] || g.position.y < -0.5) return false;
      const vx = g.position.x - c.x, vz = g.position.z - c.z, vl = Math.hypot(vx, vz) || 1;
      const ux = hero.x - g.position.x, uz = hero.z - g.position.z;
      const along = (ux * vx + uz * vz) / vl, side = Math.abs(ux * vz - uz * vx) / vl;
      return along > 0 && along < PILLAR_R + 1.2 && side < 0.9;
    });
  }

  /** Supernova explosion: damage 30 to everyone in the circle except those sheltered */
  private novaBoom(at: THREE.Vector3): void {
    const fx = this.h.fx, c = this.core();
    fx.screenFlash('#ffd8f0', 0.55, 0.5);
    fx.flash(c, STAR, 8, 0.4);
    fx.light(c, PINK, 14, 24, 0.8);
    fx.shock(at.clone().setY(0.15), NOVA_R, RASP, 0.6, 0.4);
    fx.shock(at.clone().setY(0.3), NOVA_R * 0.7, GOLD, 0.5, 0.3);
    fx.burst(c, [STAR, GOLD, RASP, PINK], 50, { speed: 10, up: 3, size: 0.16, life: 1, glow: true, gravity: 2 });
    fx.shake = Math.max(fx.shake, 0.9);
    fx.hitstop = Math.max(fx.hitstop, 0.08);
    if (!this.quiet) { sfx.thump(1.6); hiss({ dur: 1.2, vol: 0.25, f: 2500, f1: 300, q: 0.5, type: 'lowpass', verb: 0.7 }); }
    if (this.inCircle(at, NOVA_R) && !this.sheltered(at)) this.hurt(NOVA_DMG, at, 12);
  }

  override update(dt: number): void {
    super.update(dt);
    for (let i = this.later.length - 1; i >= 0; i--) {
      const l = this.later[i];
      l.t -= dt;
      if (l.t <= 0) { this.later.splice(i, 1); l.fn(); }
    }
    if (this.beam && !(this.state === 'attack' && this.attack === 'beam')) this.endBeam();
    if (this.awake && !this.dead) { this.beamCd -= dt; if (this.enraged && this.attack !== 'nova') this.novaCd -= dt; }
    // the pillars rise out of the floor and go back; the hero does not pass through them
    const hero = this.h.hero.pos;
    this.pillars.forEach((g, i) => {
      if (!g.visible) return;
      g.position.y = THREE.MathUtils.lerp(g.position.y, this.pillarUp[i] ? 0 : -PILLAR_H - 0.2, Math.min(1, dt * 6));
      if (!this.pillarUp[i] && g.position.y < -PILLAR_H) { g.visible = false; return; }
      const dx = hero.x - g.position.x, dz = hero.z - g.position.z, d = Math.hypot(dx, dz);
      if (g.position.y > -1 && d < PILLAR_R + 0.35 && d > 1e-3) { const k = (PILLAR_R + 0.35 - d) / d; hero.x += dx * k; hero.z += dz * k; }
    });
  }

  protected animate(dt: number, walk: boolean): void {
    const t = this.time, dead = this.state === 'dead', daze = this.state === 'daze', sleep = this.state === 'sleep';
    const atk = this.state === 'attack' ? this.attack : '';
    // halo of the second phase: the rings open behind the core, the core rises
    const halo = this.enraged && (atk !== 'awaken' || this.st > 0.4);
    this.haloK = THREE.MathUtils.lerp(this.haloK, halo ? 1 : 0, Math.min(1, dt * 1.5));
    if (atk !== 'beam' && atk !== 'awaken') this.spinK = THREE.MathUtils.lerp(this.spinK, 1, Math.min(1, dt * 2));
    // hovers: low in sleep, sinks when dazed, higher in the second phase
    if (!dead) {
      const y = sleep ? 0.9 : daze ? 0.7 : 1.5 + this.haloK * 0.9;
      this.body.position.y = THREE.MathUtils.lerp(this.body.position.y, y + Math.sin(t * 1.1) * 0.15, Math.min(1, dt * 3));
      this.body.rotation.x = THREE.MathUtils.lerp(this.body.rotation.x, walk ? 0.08 : 0, 0.1);
    }
    // supernova: the core shrinks until the explosion
    const nova = atk === 'nova' ? (this.st < 0.6 ? 0 : this.st < 3 ? Math.min(1, (this.st - 0.6) / 1.2) : 0) : 0;
    // facets: open when dazed, shrink in the supernova, tremble on the beam charge
    const open = this.heartOpen ? 1 : 0;
    const shake = atk === 'beam' && this.st < 1.8 ? Math.sin(t * 50) * 0.03 * this.st : 0;
    this.facets.forEach((g, i) => {
      const a = (i / 4) * Math.PI * 2, r = 0.46 + open * 0.55 - nova * 0.14 + shake;
      g.position.set(Math.sin(a) * r, CORE_Y, Math.cos(a) * r);
      g.rotation.set(THREE.MathUtils.lerp(g.rotation.x, open * 0.6, 0.15), a, 0);
    });
    // rings: each about its own axis; in the halo — stand upright behind the core and grow
    const rate = sleep ? 0.2 : this.spinK * (1 - nova * 0.5) + nova * 4;
    this.rings.forEach((g, i) => {
      this.ringSpin[i] += dt * rate * (0.7 + i * 0.35) * (i % 2 ? -1 : 1);
      const tilt = [0.35, -0.9, 1.3][i], roll = [0, 0.5, -0.4][i];
      g.rotation.set(THREE.MathUtils.lerp(tilt, Math.PI / 2, this.haloK), this.ringSpin[i], THREE.MathUtils.lerp(roll, 0, this.haloK));
      g.position.set(0, CORE_Y + this.haloK * 0.2, -this.haloK * (0.5 + i * 0.25));
      g.scale.setScalar((1 + this.haloK * (0.4 + i * 0.35)) * (1 - nova * 0.45));
    });
    // heart: beats quietly; dazed — hard, supernova — glows white-hot
    const beat = this.heartOpen ? 1 + Math.max(0, Math.sin(t * 14)) * 0.5 : 1 + Math.max(0, Math.sin(t * 4)) * 0.1;
    this.heart.scale.setScalar(beat * (this.heartOpen ? 1.9 : 1) * (1 + nova * 0.4));
    this.heart.rotation.y += dt * 0.8;
    // stardust
    if (!dead && !sleep && rnd() < 0.5) {
      const a = rand(0, Math.PI * 2), r = rand(1, 2.4) * (1 + this.haloK * 0.6);
      this.h.fx.particle({ pos: this.core().add(new THREE.Vector3(Math.cos(a) * r, rand(-1.4, 1.4), Math.sin(a) * r)), vel: new THREE.Vector3(0, rand(-0.3, 0.2), 0), life: rand(0.6, 1.2), size: rand(0.05, 0.1), color: rnd() < 0.55 ? STAR : rnd() < 0.5 ? GOLD : RASP, gravity: 0 });
    }
  }
}
