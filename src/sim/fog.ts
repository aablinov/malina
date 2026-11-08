import type { EntityState } from '../net/snapshot.ts';
import type { TdFog } from '../td/types.ts';
import { r1 } from './entities.ts';
import type { SimWorld } from './world.ts';

/**
 * Misty Clearing (wiki/design-tower-defence.md, section 18) — the simulation half of the mist: lanterns and wisps.
 * Lantern `lantern<i>`: the hero lights it with F (a free command `lantern`); lit, it pushes the mist back (the view, src/td/fog-fx.ts);
 * enemies next to it put it out — each one drains its flame. Wisp `wisp<n>`: once in a while a wisp drifts out in the mist
 * between the lanterns; a hero who catches it gets raspberries, after `WISP_LIFE` s it melts away. Records go into the snapshot,
 * the view draws only from them.
 */

export const LANTERN_FLAME = 60;
/** Flame drained per second by each enemy within `LANTERN_REACH` */
const LANTERN_DRAIN = 9;
const LANTERN_REACH = 2.4;
/** The hero lights a lantern from this far */
export const LANTERN_USE = 2.4;
const WISP_LIFE = 24;
const WISP_CATCH = 1.4;

export class SimLantern {
  readonly id: string;
  readonly index: number;
  readonly x: number;
  readonly z: number;
  lit = false;
  flame = 0;
  constructor(index: number, x: number, z: number) { this.index = index; this.id = `lantern${index}`; this.x = x; this.z = z; }
}

export class SimWisp {
  readonly id: string;
  x: number;
  z: number;
  life = WISP_LIFE;
  private a: number;
  private readonly r: number;
  private readonly spin: number;
  readonly n: number;
  constructor(id: number, a: number, r: number, spin: number, n: number) {
    this.id = `wisp${id}`; this.a = a; this.r = r; this.spin = spin; this.n = n;
    this.x = Math.cos(a) * r; this.z = Math.sin(a) * r;
  }
  update(dt: number): void {
    this.life -= dt;
    // slowly around the clearing, swaying in and out of the mist
    this.a += this.spin * dt;
    const rr = this.r + Math.sin(this.life * 0.9) * 2.5;
    this.x = Math.cos(this.a) * rr; this.z = Math.sin(this.a) * rr;
  }
}

export class SimFog {
  readonly spec: TdFog;
  readonly lanterns: SimLantern[];
  readonly wisps: SimWisp[] = [];
  private wispN = 0;
  private readonly w: SimWorld;
  constructor(w: SimWorld, spec: TdFog) {
    this.w = w;
    this.spec = spec;
    this.lanterns = spec.lanterns.map(([x, z], i) => new SimLantern(i, x, z));
  }

  /** Unlit lantern next to the hero */
  near(x: number, z: number): SimLantern | null {
    let best: SimLantern | null = null, bd = LANTERN_USE;
    for (const l of this.lanterns) { const d = Math.hypot(l.x - x, l.z - z); if (d < bd) { bd = d; best = l; } }
    return best;
  }

  light(i: number): boolean {
    const l = this.lanterns[i];
    if (!l || (l.lit && l.flame >= LANTERN_FLAME)) return false;
    l.lit = true;
    l.flame = LANTERN_FLAME;
    this.w.emit({ t: 'lantern.lit', id: l.id, x: l.x, y: 1.6, z: l.z });
    return true;
  }

  /** A wave began: maybe a wisp (one wave in two from the second, deterministic by the world's randomness) */
  waveStarted(wave: number): void {
    if (wave < 2 || this.w.rng() < 0.5) return;
    const a = this.w.rng() * Math.PI * 2, r = this.spec.inner + 4 + this.w.rng() * 6;
    const wisp = new SimWisp(this.wispN++, a, r, (this.w.rng() < 0.5 ? -1 : 1) * (0.05 + this.w.rng() * 0.05), 15 + wave * 3);
    this.wisps.push(wisp);
    this.w.emit({ t: 'wisp.show', id: wisp.id, x: wisp.x, y: 1, z: wisp.z });
  }

  /** gain — raspberries to a seat */
  update(dt: number, gain: (seat: number, n: number) => void): void {
    const foes = this.w.h.foes();
    for (const l of this.lanterns) {
      if (!l.lit) continue;
      let n = 0;
      for (const f of foes) if (!f.dead && Math.hypot(f.pos.x - l.x, f.pos.z - l.z) < LANTERN_REACH) n++;
      if (!n) continue;
      l.flame -= n * LANTERN_DRAIN * dt;
      if (l.flame <= 0) { l.lit = false; l.flame = 0; this.w.emit({ t: 'lantern.out', id: l.id, x: l.x, y: 1.6, z: l.z }); }
    }
    const heroes = this.w.h.heroes();
    for (let i = this.wisps.length - 1; i >= 0; i--) {
      const wp = this.wisps[i];
      wp.update(dt);
      const hero = heroes.find((h) => !h.down && Math.hypot(h.pos.x - wp.x, h.pos.z - wp.z) < WISP_CATCH);
      if (hero) {
        gain(hero.seat, wp.n);
        this.w.emit({ t: 'wisp.catch', id: wp.id, x: wp.x, y: 1, z: wp.z, n: wp.n, seat: hero.seat });
        this.wisps.splice(i, 1);
      } else if (wp.life <= 0) {
        this.w.emit({ t: 'wisp.gone', id: wp.id, x: wp.x, y: 1, z: wp.z });
        this.wisps.splice(i, 1);
      }
    }
  }

  reset(): void { for (const l of this.lanterns) { l.lit = false; l.flame = 0; } this.wisps.length = 0; }

  entities(out: EntityState[]): void {
    for (const l of this.lanterns) out.push({ id: l.id, lit: l.lit ? 1 : 0, flame: r1(l.flame) });
    for (const wp of this.wisps) out.push({ id: wp.id, x: r1(wp.x), z: r1(wp.z), n: wp.n });
  }
}
