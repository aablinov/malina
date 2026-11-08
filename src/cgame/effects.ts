import * as THREE from 'three';
import { C, RASP } from '../bosses/kit.ts';
import type { FX } from '../fx.ts';
import { t } from '../i18n/i18n.ts';
import { BERRY_GLOW } from '../props.ts';
import type { SimEvent } from '../sim/events.ts';
import { TOWERS } from '../td/towers.ts';
import { boom, hiss, voice } from '../spell-audio.ts';
import { ARCANE, ARCANE_DEEP, DUST, EMBER, FIRE, ICE, ICE_DEEP, SNOW, STAR, STAR_DEEP, TAR, TAR_SHEEN, VOLT } from './views/colors.ts';

/**
 * Defence simulation events (src/sim/events.ts) → sparks, flashes, numbers, shake and sound — everything the old
 * src/td/* classes used to do right inside the logic. Event table (fields beyond `t id x y z`):
 *
 * | event          | fields                   | what we play                                            |
 * |----------------|--------------------------|---------------------------------------------------------|
 * | tower.build    | kind cost seat           | dust, a ring in the tower colour, shake, "−cost raspberries" |
 * | tower.sell     | n                        | dust, "+n raspberries"                                  |
 * | tower.upgrade  | kind level               | flash, sparks, a ring in the tower colour, a note       |
 * | tower.hurt     | n                        | "−n", splinters                                         |
 * | tower.ruin     |                          | debris, shake, rumble                                   |
 * | tower.repair   |                          | sparks, a note                                          |
 * | tower.freeze / chip / thaw {loud} |         | ice sparks, hiss                                        |
 * | tower.fire     | kind level + per kind    | ballista trail, brazier jet, lightning, blizzard, meteor… |
 * | hit.*          | area / r / pts           | hits: rime, blast, pool, orb chain                      |
 * | burn           | top                      | a tongue of flame on a burning enemy                    |
 * | dmg            | n cls                    | damage number                                           |
 * | berry.spent    | n                        | "−n raspberries"                                        |
 * | wall.* bush.* lair.burst pile.* wave.* td.* chief | — see below                            |
 *
 * Sound (voice/boom/hiss) only when `!ctx.quiet()`. Banners and hints belong to the HUD (src/cgame/td-ui.ts), not here
 */
export interface FxCtx {
  fx: FX;
  quiet: () => boolean;
  /** The local player's hero (the picked-up raspberries number) */
  heroPos: () => THREE.Vector3;
  /** The local player's seat: whose pickups to show as a number */
  seat: () => number;
  /** The bush: the wave bounty number */
  bushPos: THREE.Vector3;
}

const at = (e: SimEvent, dy = 0): THREE.Vector3 => new THREE.Vector3((e.x as number) ?? 0, ((e.y as number) ?? 0) + dy, (e.z as number) ?? 0);
const num = (v: unknown, d = 0): number => (typeof v === 'number' ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const towerColor = (kind: string, k: number): THREE.Color => new THREE.Color(TOWERS[kind as keyof typeof TOWERS]?.color ?? '#d8b872').multiplyScalar(k);

export function playTdEvents(events: readonly SimEvent[], ctx: FxCtx): void {
  const { fx } = ctx;
  const loud = !ctx.quiet();
  for (const e of events) {
    switch (e.t) {
      // ---------- building ----------
      case 'tower.build': {
        const c = towerColor(str(e.kind), 2);
        fx.burst(at(e, 0.4), ['#d8cfa8', '#9a8f70', c], 20, { speed: 3, up: 3, size: 0.12, life: 0.6, gravity: 8 });
        fx.shock(at(e, 0.06), 2, c, 0.4, 0.14);
        fx.shake = Math.max(fx.shake, 0.25);
        fx.text(at(e, 1.4), `−${t('{n} raspberries', { n: num(e.cost) })}`, 'berry');
        break;
      }
      case 'tower.sell':
        fx.burst(at(e, 0.6), ['#d8cfa8', '#9a8f70', '#5e3c22'], 16, { speed: 3, up: 3, size: 0.12, life: 0.6, gravity: 8 });
        fx.text(at(e, 1.4), `+${t('{n} raspberries', { n: num(e.n) })}`, 'berry');
        break;
      case 'tower.upgrade': {
        const c = towerColor(str(e.kind), 1);
        fx.flash(at(e, 1.6), c.clone().multiplyScalar(2.5), 2.4, 0.3);
        fx.burst(at(e, 0.6), [c.clone().multiplyScalar(2.2), '#ffffff'], 18, { speed: 3, up: 4, size: 0.1, life: 0.7, glow: true, gravity: 6 });
        fx.shock(at(e, 0.06), 2.2, c.clone().multiplyScalar(2), 0.4, 0.14);
        if (loud) voice({ type: 'triangle', f: 520, f1: 1040, dur: 0.3, vol: 0.06 });
        break;
      }
      case 'berry.spent': fx.text(at(e), `−${t('{n} raspberries', { n: num(e.n) })}`, 'berry'); break;

      // ---------- tower durability ----------
      case 'tower.hurt':
        fx.text(at(e, 3), `−${num(e.n)}`, 'bad');
        fx.burst(at(e, 1), ['#9a8f70', '#5e3c22'], 5, { speed: 2, up: 2, size: 0.08, life: 0.4, gravity: 8 });
        break;
      case 'tower.ruin':
        fx.burst(at(e, 1.2), ['#4a4440', '#2a2624', '#9a8f70'], 30, { speed: 3, up: 3, size: 0.16, life: 0.9, gravity: 6 });
        fx.shake = Math.max(fx.shake, 0.3);
        if (loud) boom(90, 40, 0.5, 0.35);
        break;
      case 'tower.repair':
        fx.burst(at(e, 0.6), ['#d8cfa8', '#9ad87a', '#ffffff'], 20, { speed: 3, up: 3, size: 0.1, life: 0.6, gravity: 6 });
        if (loud) voice({ type: 'triangle', f: 440, f1: 880, dur: 0.25, vol: 0.05 });
        break;
      case 'tower.freeze':
        fx.burst(at(e, 1.6), [ICE, '#ffffff'], 18, { speed: 2.5, up: 2, size: 0.1, life: 0.6, glow: true, gravity: 4 });
        if (loud) hiss({ dur: 0.35, vol: 0.08, f: 5000, f1: 2000, q: 2 });
        break;
      case 'tower.chip':
        fx.burst(at(e, 1.6), [ICE, '#ffffff'], 8, { speed: 3, up: 2, size: 0.08, life: 0.4, gravity: 8 });
        break;
      case 'tower.thaw':
        if (!e.loud) break;
        fx.burst(at(e, 1.6), [ICE, '#ffffff', ICE_DEEP], 26, { speed: 4, up: 3, size: 0.12, life: 0.7, glow: true, gravity: 8 });
        if (loud) hiss({ dur: 0.2, vol: 0.1, f: 6000, f1: 3000, q: 1 });
        break;

      // ---------- shots ----------
      case 'tower.fire': fire(e, ctx, loud); break;

      // ---------- hits ----------
      case 'hit.arrow': break;
      case 'hit.frost':
        fx.burst(at(e), [ICE, '#ffffff', ICE_DEEP], 12, { speed: 2.5, up: 2, size: 0.08, life: 0.5, glow: true, gravity: 6 });
        if (e.area) fx.shock(at(e, 0.06), 2.2, ICE, 0.35, 0.12);
        if (loud) hiss({ dur: 0.18, vol: 0.1, f: 3200, f1: 1400, q: 1.5 });
        break;
      case 'hit.magic': {
        const p = at(e);
        fx.flash(p, ARCANE, 1.6, 0.2);
        fx.burst(p, [ARCANE, '#ffffff', ARCANE_DEEP], 14, { speed: 3, up: 2, size: 0.08, life: 0.5, glow: true, gravity: 4 });
        const pts = Array.isArray(e.pts) ? (e.pts as number[]) : [];
        let n = 0;
        for (let i = 3; i + 2 < pts.length; i += 3, n++) fx.bolt(new THREE.Vector3(pts[i - 3], pts[i - 2], pts[i - 1]), new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]), ARCANE, 0.08, 2, 0.25);
        if (loud) { voice({ type: 'sine', f: 880, f1: 440, dur: 0.25, vol: 0.06 }); if (n) hiss({ dur: 0.1, vol: 0.06, f: 4000, f1: 2000, q: 2 }); }
        break;
      }
      case 'hit.splash': {
        const p = at(e);
        fx.explosion(p.clone().setY(p.y + 0.4), num(e.r, 2.4), C(2.2, 1.6, 1.0));
        fx.burst(p.clone().setY(p.y + 0.3), ['#8a8a90', '#5a5a60', '#c8b890'], 16, { speed: 4, up: 4, size: 0.14, life: 0.7, gravity: 10 });
        fx.shake = Math.max(fx.shake, 0.3);
        if (loud) boom(140, 40, 0.5, 0.45);
        break;
      }
      case 'hit.oil':
        fx.burst(at(e, 0.2), [TAR, '#2a2018', TAR_SHEEN], 16, { speed: 3, up: 2.5, size: 0.12, life: 0.6, gravity: 9, glow: false });
        if (loud) hiss({ dur: 0.3, vol: 0.1, f: 500, f1: 200, q: 0.8, type: 'lowpass' });
        break;
      case 'hit.meteor': {
        const p = at(e), R = num(e.r, 4.5);
        fx.explosion(p.clone().setY(p.y + 0.5), R, STAR);
        fx.shock(p.clone().setY(p.y + 0.1), R, STAR, 0.6, 0.3);
        fx.burst(p.clone().setY(p.y + 0.4), [STAR, STAR_DEEP, '#ffffff', '#5a4a3a'], 40, { speed: 7, up: 6, size: 0.16, life: 0.9, glow: true, gravity: 10 });
        fx.shake = Math.max(fx.shake, 0.7);
        if (loud) { boom(55, 22, 0.9, 0.7); hiss({ dur: 0.6, vol: 0.12, f: 1200, f1: 200, q: 0.6, type: 'lowpass' }); }
        break;
      }
      case 'hit.ballista':
        fx.burst(at(e), ['#ffffff', '#d8c8a0'], 6, { speed: 3, up: 2, size: 0.07, life: 0.3, glow: true, gravity: 8 });
        break;
      case 'burn': {
        // a tongue of flame on a burning enemy (an event every 0.2 s — a couple of sparks each)
        const top = num(e.top, 1.2);
        for (let i = 0; i < 2; i++) fx.particle({ pos: at(e).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.3 + Math.random() * top, (Math.random() - 0.5) * 0.6)), vel: new THREE.Vector3(0, 1.5, 0), life: 0.4, size: 0.1, color: Math.random() < 0.5 ? FIRE : EMBER, gravity: 0 });
        break;
      }
      case 'dmg': fx.text(at(e), String(num(e.n)), str(e.cls)); break;

      // ---------- walls, bush, lairs ----------
      case 'wall.hurt': {
        const v = num(e.n), out = new THREE.Vector3(num(e.ox), 0, num(e.oz));
        const p = at(e, 1.2).addScaledVector(out, 0.6);
        fx.text(p.clone().setY(p.y + 1), `−${v}`, 'bad');
        fx.burst(p, DUST, Math.min(16, 4 + v / 10), { speed: 2.5, up: 2, size: 0.1, life: 0.5, gravity: 8 });
        if (loud) hiss({ dur: 0.1, vol: 0.07, f: 500, f1: 200, q: 1 });
        break;
      }
      case 'wall.break': {
        const p = at(e, 1.5);
        fx.explosion(p, 3, C(2.0, 1.8, 1.4));
        fx.burst(p, DUST, 40, { speed: 5, up: 5, size: 0.16, life: 1.2, gravity: 9 });
        fx.shake = Math.max(fx.shake, 0.8);
        if (loud) boom(90, 30, 1.0, 0.6);
        break;
      }
      case 'wall.repair': {
        const out = new THREE.Vector3(num(e.ox), 0, num(e.oz));
        fx.burst(at(e, 1.2).addScaledVector(out, -0.5), ['#ffffff', '#d8cfa8', '#9a8f70'], 24, { speed: 3, up: 3, size: 0.12, life: 0.7, gravity: 8 });
        fx.shock(at(e, 0.06), 3, C(1.6, 1.4, 0.8), 0.4, 0.14);
        if (loud) boom(220, 80, 0.3, 0.3);
        break;
      }
      case 'bush.hurt': {
        const p = at(e);
        fx.text(p.clone().setY(p.y + 2.2), `−${num(e.n)}`, 'bad');
        const dir = new THREE.Vector3(p.x - num(e.fx, p.x), 0, p.z - num(e.fz, p.z));
        if (dir.lengthSq() > 1e-6) dir.normalize();
        fx.burst(p.clone().setY(p.y + 1.4).addScaledVector(dir, -0.8), ['#4a9a3a', '#2f6a2a', RASP], 8, { speed: 2.5, up: 2, size: 0.1, life: 0.5, gravity: 8 });
        if (loud) hiss({ dur: 0.1, vol: 0.08, f: 700, f1: 300, q: 1 });
        break;
      }
      case 'bush.die':
        fx.flash(at(e, 2.5), RASP, 4, 0.5);
        fx.burst(at(e, 1.5), [RASP, '#4a9a3a', '#8a6a40'], 50, { speed: 5, up: 5, size: 0.12, life: 1.2, gravity: 7 });
        fx.shake = Math.max(fx.shake, 1);
        if (loud) boom(120, 30, 1.2, 0.5);
        break;
      case 'lair.burst':
        fx.flash(at(e, 1.2), RASP, 2.2, 0.25);
        fx.shock(at(e, 0.06), 2.2, RASP, 0.4, 0.14);
        fx.burst(at(e, 0.8), [RASP, '#ffffff', C(3.4, 1.2, 2.2)], 14, { speed: 3, up: 3, size: 0.09, life: 0.6, glow: true, gravity: 6 });
        if (loud) { boom(110, 50, 0.3, 0.2); hiss({ dur: 0.2, vol: 0.06, f: 1800, f1: 600, q: 1 }); }
        break;

      // ---------- raspberries ----------
      case 'pile.drop': break;
      case 'pile.land': fx.burst(at(e, 0.1), [BERRY_GLOW], 5, { speed: 1.2, up: 1, size: 0.05, life: 0.3, glow: true, gravity: 3 }); break;
      case 'pile.pick': {
        const p = at(e);
        fx.flash(p, BERRY_GLOW, 2.4, 0.25);
        fx.shock(p.clone().setY(p.y + 0.1), 1.3, BERRY_GLOW, 0.35, 0.3);
        fx.burst(p, [BERRY_GLOW, C(3.4, 2.4, 2.8), C(3.2, 1.2, 1.8)], 22, { speed: 2.8, up: 3.5, size: 0.08, life: 0.6, glow: true, gravity: 5 });
        fx.burst(p, ['#e8245a', '#ff4a7e', '#a80e3c'], 10, { speed: 2.2, up: 3, size: 0.09, life: 0.6, gravity: 10 });
        // the number only above our own hero
        if (num(e.seat) === ctx.seat()) { const h = ctx.heroPos(); fx.text(h.clone().setY(h.y + 1.6), `+${t('{n} raspberries', { n: num(e.n) })}`, 'berry'); }
        break;
      }

      // ---------- waves and the outcome ----------
      case 'wave.start': fx.shake = Math.max(fx.shake, 0.2); break;
      case 'wave.early': fx.text(ctx.bushPos.clone().setY(ctx.bushPos.y + 3.6), `+${t('{n} raspberries', { n: num(e.n) })}`, 'berry'); break;
      case 'wave.won': fx.text(ctx.bushPos.clone().setY(ctx.bushPos.y + 3.6), `+${t('{n} raspberries', { n: num(e.n) })}`, 'berry'); break;
      case 'td.won': break;
      case 'td.lost': fx.darken(1.2); break;
      case 'chief': fx.shake = Math.max(fx.shake, 0.4); break;
      default: break;
    }
  }
}

/** Tower shot: trails, jets, lightning and sound per tower kind; projectiles fly on their own (src/cgame/views/bolt-view.ts) */
function fire(e: SimEvent, ctx: FxCtx, loud: boolean): void {
  const { fx } = ctx;
  switch (str(e.kind)) {
    case 'ballista': {
      const from = new THREE.Vector3(num(e.fx), num(e.fy), num(e.fz)), end = new THREE.Vector3(num(e.tx), num(e.ty), num(e.tz));
      fx.streak({ path: (k, out) => out.lerpVectors(from, end, k), dur: 0.22, color: C(2.6, 2.2, 1.2), color2: C(1.4, 1.0, 0.5), width: 0.14, tail: 0.5, halo: 1.2, core: 0.8 });
      if (loud) { hiss({ dur: 0.15, vol: 0.12, f: 1400, f1: 400, q: 1 }); boom(200, 90, 0.15, 0.25); }
      break;
    }
    case 'oil': if (loud) hiss({ dur: 0.2, vol: 0.06, f: 400, f1: 250, q: 1 }); break;
    case 'meteor': {
      // a warning on the ground and a trail from the sky — the meteor itself flies as a `b<n>` record
      const to = new THREE.Vector3(num(e.tx), num(e.ty), num(e.tz)), from = to.clone().add(new THREE.Vector3(-4, 22, -4));
      fx.shock(to.clone().setY(to.y + 0.08), num(e.r, 4.5), STAR_DEEP, 0.8, 0.1);
      fx.streak({ path: (k, out) => out.lerpVectors(from, to, k), dur: 0.8, color: STAR, color2: STAR_DEEP, width: 0.5, tail: 0.6, halo: 3, core: 0.8 });
      if (loud) hiss({ dur: 0.8, vol: 0.08, f: 300, f1: 1800, q: 0.8 });
      break;
    }
    case 'storm': {
      const pts = Array.isArray(e.pts) ? (e.pts as number[]) : [];
      for (let i = 3; i + 2 < pts.length; i += 3) {
        const a = new THREE.Vector3(pts[i - 3], pts[i - 2], pts[i - 1]), b = new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]);
        // jagged lightning: offset in the middle, fades fast
        const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 1.2));
        fx.streak({ path: (k, out) => (k < 0.5 ? out.lerpVectors(a, mid, k * 2) : out.lerpVectors(mid, b, (k - 0.5) * 2)), dur: 0.12, color: VOLT, color2: C(3.6, 3.6, 4), width: 0.12, tail: 1, halo: 2, core: 0.9 });
        fx.flash(b, VOLT, 1.2, 0.12);
      }
      if (loud) { hiss({ dur: 0.25, vol: 0.14, f: 5000, f1: 800, q: 0.7 }); boom(120, 60, 0.2, 0.3); }
      break;
    }
    case 'winter': {
      const p = at(e), R = num(e.r, 7);
      if (e.nova) {
        fx.shock(p.clone().setY(p.y + 0.15), R, SNOW, 0.6, 0.3);
        fx.burst(p.clone().setY(p.y + 2.6), [SNOW, '#ffffff', ICE_DEEP], 40, { speed: 8, up: 2, size: 0.12, life: 0.8, glow: true, gravity: 2 });
        if (loud) { hiss({ dur: 0.9, vol: 0.14, f: 6000, f1: 1200, q: 1 }); boom(90, 50, 0.4, 0.3); }
      } else if (loud) hiss({ dur: 0.4, vol: 0.04, f: 3000, f1: 1500, q: 0.8 });
      break;
    }
    case 'arrow': if (loud) hiss({ dur: 0.08, vol: 0.08, f: 2600, f1: 900, q: 1.2 }); break;
    case 'frost':
      fx.particle({ pos: new THREE.Vector3(num(e.fx), num(e.fy), num(e.fz)), vel: new THREE.Vector3(0, 0.5, 0), life: 0.3, size: 0.12, color: ICE, gravity: 0 });
      if (loud) voice({ type: 'triangle', f: 1400, f1: 900, dur: 0.15, vol: 0.04 });
      break;
    case 'splash': if (loud) { hiss({ dur: 0.2, vol: 0.08, f: 600, f1: 300, q: 1 }); boom(300, 120, 0.12, 0.2); } break;
    case 'fire': {
      const yaw = num(e.yaw), dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const from = new THREE.Vector3(num(e.fx), num(e.fy), num(e.fz));
      fx.spray(from, dir.clone().setY(0.05), [FIRE, EMBER, '#ffd060'], 14, { speed: 9, size: 0.14, life: 0.55, gravity: -1, spread: 0.22 });
      fx.light(from.clone().addScaledVector(dir, 2), FIRE, 6, 7, 0.25);
      if (loud) hiss({ dur: 0.35, vol: 0.12, f: 900, f1: 400, q: 0.6, type: 'lowpass' });
      break;
    }
    case 'magic': if (loud) voice({ type: 'sine', f: 440, f1: 880, dur: 0.2, vol: 0.05 }); break;
    default: break;
  }
}
