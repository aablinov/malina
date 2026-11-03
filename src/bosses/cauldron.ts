import * as THREE from 'three';
import { pixelTex } from '../textures.ts';
import { boom, hiss, voice } from '../spell-audio.ts';
import type { Rect } from './arena.ts';
import { C, glowMat, rand, RASP, UNIT, type BossHooks } from './kit.ts';
import { MiniBoss } from './mini.ts';

/**
 * Котёл Ордена — мини-босс (wiki/design-bosses.md, раздел 2): медный котёл на коротких ножках, в нём кипит малиновое
 * пламя, по бокам — два черпака. Скачет к герою. Атаки: огненные комья по меткам (горящий пол), прыжок на героя —
 * после него оглушён, герб-ягода открыт; выкипает кольцом, если герой вплотную; из варева лезут подручные.
 * Роняет «Небесный молот». Подвижных частей: котёл, крышка, варево, два черпака.
 */

const FIRE = C(4, 1.4, 0.3), EMBER = C(4, 2.6, 0.8), PINK = C(4, 1.7, 2.4);

const sfx = {
  /** Бульканье: низкие щипки с фильтром */
  bubble() { for (let i = 0; i < 3; i++) voice({ type: 'sine', f: rand(90, 160), f1: rand(200, 320), dur: 0.12, vol: 0.05, delay: i * 0.07, verb: 0.3 }); },
  /** Ком вылетел: «плюх» и шипение */
  throw() { boom(140, 60, 0.25, 0.3); hiss({ dur: 0.3, vol: 0.15, f: 900, f1: 300, q: 0.6, type: 'lowpass' }); },
  /** Ком упал */
  splat() { boom(110, 40, 0.4, 0.4); hiss({ dur: 0.5, vol: 0.2, f: 1500, f1: 200, q: 0.5, type: 'lowpass' }); },
  /** Удар котла о землю: чугунный гул */
  clang() {
    boom(70, 25, 1.2, 0.9, 0, 0.5);
    for (const [f, d] of [[180, 0], [271, 0.01], [419, 0.02], [633, 0.03]] as const) voice({ type: 'triangle', f, dur: 1.4, vol: 0.04, delay: d, verb: 0.6 });
  },
  /** Крышка подпрыгнула */
  lid() { for (const f of [520, 780]) voice({ type: 'square', f, dur: 0.12, vol: 0.02, lp: 2000, verb: 0.3 }); },
};

export class Cauldron extends MiniBoss {
  readonly radius = 1.5;
  readonly title = 'Котёл Ордена';
  override readonly topY = 2.6;
  readonly drop = 'meteor';
  private readonly pot = new THREE.Group();
  private readonly lid = new THREE.Group();
  private readonly brew: THREE.Mesh;
  private readonly ladles: THREE.Group[] = [];
  private readonly emblem = new THREE.Group();
  private hopT = 0;
  private summonCd = 6;
  private readonly slamAt = new THREE.Vector3();
  private readonly slamFrom = new THREE.Vector3();

  constructor(h: BossHooks, home: THREE.Vector3, yaw: number, arena: Rect) {
    super(h, 800, home, yaw, arena);
    this.speed = 2.6;
    this.keep = 6;
    this.brew = new THREE.Mesh(UNIT, this.shimmer(FIRE, RASP, 0, 2));
    this.build();
    this.reset();
  }

  protected build(): void {
    const iron = this.lam('#a8704a', pixelTex('#a8704a', 10, 401));
    const dark = this.lam('#6a4434');
    const gold = this.lam('#e8b84a');
    const wood = this.lam('#8a5a32', pixelTex('#8a5a32', 8, 402));
    const heart = this.shimmer(RASP, PINK, 0, 3);
    const B = this.box.bind(this);
    this.body.add(this.pot);
    // котёл: пузатый (три ступени), обод, золотой пояс, ножки
    B(this.pot, iron, 2.6, 1.2, 2.6, 0, 0.95, 0);
    B(this.pot, iron, 2.2, 0.3, 2.2, 0, 0.25, 0);
    B(this.pot, iron, 2.3, 0.35, 2.3, 0, 1.68, 0);
    B(this.pot, dark, 2.7, 0.18, 2.7, 0, 1.9, 0);
    B(this.pot, gold, 2.66, 0.16, 2.66, 0, 1.15, 0);
    for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) B(this.pot, dark, 0.4, 0.35, 0.4, x, 0.1, z);
    // варево: светится и бурлит
    this.brew.scale.set(2.1, 0.12, 2.1);
    this.brew.position.y = 1.86;
    this.pot.add(this.brew);
    // герб Ордена — ягода из кубиков на боку: сердце, по нему ×2 после прыжка
    this.emblem.position.set(0, 1.05, 1.32);
    this.pot.add(this.emblem);
    for (const [x, y, k] of [[0, 0, 0.36], [0.24, 0.2, 0.24], [-0.24, 0.2, 0.24], [0.24, -0.2, 0.24], [-0.24, -0.2, 0.24], [0, 0.38, 0.2], [0, -0.38, 0.2]] as const) B(this.emblem, heart, k, k, 0.12, x, y, 0);
    B(this.emblem, gold, 0.16, 0.22, 0.1, 0, 0.6, 0);
    // крышка с ручкой — подскакивает, когда варево кипит
    this.lid.position.y = 2.0;
    this.pot.add(this.lid);
    B(this.lid, dark, 1.9, 0.14, 1.9, 0, 0.07, 0);
    B(this.lid, gold, 0.36, 0.24, 0.36, 0, 0.26, 0);
    // черпаки по бокам: ручка и ковш
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(s * 1.45, 1.6, 0);
      this.pot.add(g);
      B(g, wood, 0.16, 1.8, 0.16, 0, 0.5, 0);
      B(g, iron, 0.55, 0.3, 0.55, 0, -0.45, 0);
      B(g, this.shimmer(FIRE, EMBER, s, 3), 0.4, 0.06, 0.4, 0, -0.29, 0);
      this.ladles.push(g);
    }
  }

  protected choose(dist: number): string | null {
    if (dist < 3.4) return 'boil';
    if (this.summonCd <= 0 && this.minions.length < 3) return 'summon';
    if (dist > 4 && Math.random() < 0.38) return 'slam';
    return 'lob';
  }

  protected act(name: string, t: number, dt: number): boolean {
    const fx = this.h.fx;
    switch (name) {
      case 'lob': {
        // черпаки зачерпывают — и по одному кому на метку у героя
        const n = this.enraged ? 5 : 3;
        for (let i = 0; i < n; i++) {
          const at = 0.35 + i * 0.22;
          if (t >= at && t - dt < at) {
            const side = i % 2 ? 1 : -1;
            const to = this.clampIn(this.heroAt().add(new THREE.Vector3(rand(-2, 2), 0, rand(-2, 2)).multiplyScalar(i === 0 ? 0.2 : 1)));
            const from = this.pos.clone().add(new THREE.Vector3(0, 2.4, 0)).addScaledVector(new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)), side * 1.4);
            const mesh = new THREE.Mesh(UNIT, glowMat(Math.random() < 0.5 ? FIRE : RASP));
            mesh.scale.setScalar(0.45);
            const dur = 0.95;
            this.markCircle(to, 1.6, dur, () => undefined);
            this.lob(mesh, from, to, dur, 3.5, EMBER, (p) => {
              if (!this.quiet) sfx.splat();
              fx.burst(p.clone().setY(0.4), [FIRE, EMBER, RASP], 16, { speed: 4, up: 4, size: 0.1, life: 0.6, glow: true, gravity: 6 });
              fx.shock(p.clone().setY(0.06), 1.8, FIRE, 0.3, 0.14);
              if (this.inCircle(p, 1.6)) this.hurt(14, p, 5);
              this.hazard(p, 1.3, 3, 10, FIRE);
            });
            if (!this.quiet) sfx.throw();
          }
        }
        return t > 0.35 + n * 0.22 + 0.4;
      }
      case 'slam': {
        // присел → взлёт → тень над героем → падение; потом оглушён
        const CROUCH = 0.35, AIR = 1.1;
        if (t < CROUCH) return false;
        if (!this.hitDone) {
          this.hitDone = true;
          this.slamFrom.copy(this.pos).setY(0);
          this.slamAt.copy(this.clampIn(this.heroAt(), 2));
          this.markCircle(this.slamAt, 3, AIR, () => undefined);
          if (!this.quiet) sfx.lid();
        }
        const k = Math.min(1, (t - CROUCH) / AIR);
        this.pos.x = THREE.MathUtils.lerp(this.slamFrom.x, this.slamAt.x, k);
        this.pos.z = THREE.MathUtils.lerp(this.slamFrom.z, this.slamAt.z, k);
        this.flyY = Math.sin(Math.PI * k) * 4.5;
        if (k < 1) return false;
        this.flyY = 0;
        if (!this.quiet) sfx.clang();
        fx.shake = Math.max(fx.shake, 1);
        fx.hitstop = Math.max(fx.hitstop, 0.06);
        fx.shock(this.slamAt.clone().setY(0.08), 3.6, FIRE, 0.45, 0.25);
        fx.burst(this.slamAt.clone().setY(0.4), ['#9a8f70', '#6b5a4a', '#5a5a5a'], 24, { speed: 6, up: 5, size: 0.18, life: 1, gravity: 12 });
        fx.burst(this.slamAt.clone().setY(2), [FIRE, RASP, EMBER], 24, { speed: 5, up: 6, size: 0.1, life: 0.8, glow: true, gravity: 5 });
        if (this.inCircle(this.slamAt, 3)) this.hurt(22, this.slamAt, 8);
        this.daze(1.8);
        return true;
      }
      case 'boil': {
        // выкипает: бурлит, крышка пляшет — и кольцо пламени вокруг
        if (!this.hitDone) { this.hitDone = true; this.markCircle(this.pos, 3.6, 0.75, () => undefined); }
        if (t < 0.75) { if (Math.random() < 0.3 && !this.quiet) sfx.bubble(); return false; }
        if (this.hitDone && t - dt < 0.75) {
          if (!this.quiet) { sfx.splat(); boom(90, 40, 0.6, 0.5); }
          fx.shock(this.pos.clone().setY(0.1), 3.8, RASP, 0.4, 0.3);
          fx.burst(this.pos.clone().setY(2), [FIRE, RASP], 30, { speed: 6, up: 4, size: 0.12, life: 0.7, glow: true, gravity: 6 });
          if (this.inCircle(this.pos, 3.6)) this.hurt(12, this.pos, 9);
          for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; this.hazard(this.pos.clone().add(new THREE.Vector3(Math.cos(a) * 2.6, 0, Math.sin(a) * 2.6)), 1, 2.5, 10, FIRE); }
        }
        return t > 1.2;
      }
      case 'summon': {
        // крышка слетает, из варева выпрыгивают малиновые кубы-стражи
        if (!this.hitDone) { this.hitDone = true; this.summonCd = 12; if (!this.quiet) { sfx.lid(); sfx.bubble(); } }
        const n = this.enraged ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const at = 0.4 + i * 0.25;
          if (t >= at && t - dt < at) {
            const a = rand(0, Math.PI * 2);
            this.summon(this.pos.clone().add(new THREE.Vector3(Math.cos(a) * 2.4, 0, Math.sin(a) * 2.4)), { body: '#c8124a', head: '#8a0a34', eye: C(4, 3, 1), hp: 26, dmg: 6, speed: 2.8 });
            fx.burst(this.pos.clone().setY(2.2), [RASP, FIRE], 14, { speed: 3, up: 5, size: 0.12, life: 0.7, glow: true, gravity: 8 });
          }
        }
        return t > 0.4 + n * 0.25 + 0.4;
      }
    }
    return true;
  }

  protected animate(dt: number, walk: boolean): void {
    const t = this.time, S = this.st;
    if (this.awake) this.summonCd -= dt;
    // ходьба — прыжками: котёл подскакивает и приседает, на приземлении — пыль и гул
    if (walk) {
      const was = this.hopT % 1;
      this.hopT += dt * 1.8 * this.speedK;
      const k = this.hopT % 1;
      this.body.position.y = Math.sin(k * Math.PI) * 0.7;
      this.body.scale.set(1 + (k < 0.15 ? (0.15 - k) * 1.2 : 0), 1 - (k < 0.15 ? (0.15 - k) * 1.5 : 0), 1 + (k < 0.15 ? (0.15 - k) * 1.2 : 0));
      if (k < was) {
        if (!this.quiet) boom(60, 30, 0.35, 0.35);
        this.h.fx.shake = Math.max(this.h.fx.shake, 0.15);
        this.h.fx.burst(this.pos.clone().setY(0.1), ['#9a8f70', '#6b5a4a'], 6, { speed: 1.5, up: 0.8, size: 0.1, life: 0.5, gravity: 6 });
      }
    } else if (this.state !== 'dead') {
      this.body.position.y *= 0.8;
      this.body.scale.lerp(new THREE.Vector3(1, 1, 1), 0.2);
    }
    // присед перед прыжком на героя
    if (this.state === 'attack' && this.attack === 'slam' && S < 0.35) this.body.scale.set(1.15, 0.8, 1.15);
    // варево: бурлит, на ярости выше; пузыри и искры
    const boilK = this.state === 'sleep' ? 0.3 : this.state === 'attack' ? 1.4 : 1;
    this.brew.position.y = 1.86 + Math.sin(t * 7) * 0.03 * boilK;
    if (this.state !== 'dead' && Math.random() < 0.25 * boilK) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(rand(-0.8, 0.8), this.flyY + this.body.position.y + 2, rand(-0.8, 0.8))), vel: new THREE.Vector3(0, rand(1, 2), 0), life: rand(0.3, 0.6), size: rand(0.08, 0.16), color: Math.random() < 0.5 ? FIRE : RASP, gravity: -1 });
    // крышка: во сне лежит, в бою пляшет, при призыве слетает вверх
    const lidUp = this.state === 'attack' && this.attack === 'summon' ? Math.sin(Math.min(1, S / 0.3) * Math.PI) * 1.4 : this.state === 'sleep' ? 0 : Math.max(0, Math.sin(t * 9)) * 0.08 * boilK;
    // крышка приоткрыта набок — видно, как светится варево
    this.lid.position.set(0.55, 2.0 + lidUp + 0.12, 0);
    this.lid.rotation.z = -0.22 + (this.state === 'sleep' ? 0 : Math.sin(t * 11) * 0.05 * boilK);
    // черпаки: мешают варево; при броске — замах
    this.ladles.forEach((g, i) => {
      const s = i ? 1 : -1;
      let swing = Math.sin(t * 2 + i * Math.PI) * 0.25;
      if (this.state === 'attack' && this.attack === 'lob') swing = Math.sin(S * 9 + i * Math.PI) * 1.1;
      if (this.state === 'sleep') swing = 0.1;
      g.rotation.set(swing, 0, s * (this.state === 'daze' ? 0.9 : 0.15));
    });
    // оглушён — накренился, герб бьётся крупно
    if (this.state === 'daze') this.body.rotation.x = -0.25; else if (this.state !== 'dead') this.body.rotation.x *= 0.85;
    const beat = this.heartOpen ? 1 + Math.max(0, Math.sin(t * 14)) * 0.5 : 1 + Math.max(0, Math.sin(t * 5)) * 0.08;
    this.emblem.scale.setScalar(beat * (this.heartOpen ? 1.35 : 1));
  }
}
