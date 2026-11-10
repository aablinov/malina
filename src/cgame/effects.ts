import * as THREE from 'three';
import { C, RASP } from '../bosses/kit.ts';
import type { FX } from '../fx.ts';
import { t } from '../i18n/i18n.ts';
import { BERRY_GLOW } from '../props.ts';
import type { SimEvent } from '../sim/events.ts';
import { itemDef, RARITY } from '../items.ts';
import { TOWERS } from '../td/towers.ts';
import { bell, boom, hiss, voice } from '../spell-audio.ts';
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
 * | drop.spawn / drop.pick | def relic seat   | an item pops out under a pillar of light; picked up — a star of rays |
 * | berry.spent    | n                        | "−n raspberries"                                        |
 * | wall.* bush.* lair.burst pile.* wave.* td.* chief | — see below                            |
 *
 * Every hit is an anime impact (wiki/style-guide.md, section "Impact"): a star of light shafts (`fx.shafts`), a cut of light or a pillar
 * from the sky, a burst of glowing sparks; every shot — a muzzle flash where the event says the muzzle is (`fx fy fz`).
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
const rarityColor = (def: string): THREE.Color => { try { return new THREE.Color(RARITY[itemDef(def).rarity].color).multiplyScalar(2.4); } catch { return C(2, 2, 2); } };
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
        fx.ring(at(e, 0.06), 2.6, c.clone().multiplyScalar(2), 0.5, 0.14, 2);
        fx.pillar(at(e), c.clone().multiplyScalar(2.6), 9, 0.45);
        fx.shafts(at(e, 2), c.clone().multiplyScalar(2.6), 8, 2.6, 0.1, 0.9);
        if (loud) { voice({ type: 'triangle', f: 520, f1: 1040, dur: 0.3, vol: 0.06 }); bell(1046, 0.6, 0.05, 0.1); }
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
      case 'hit.arrow': {
        const p = at(e), heavy = !!e.heavy, c = C(3.4, 3.0, 1.6);
        fx.shafts(p, c, heavy ? 5 : 2, heavy ? 2.2 : 1.1, heavy ? 0.09 : 0.05);
        if (heavy) fx.flash(p, c, 1.4, 0.12);
        fx.burst(p, [c, '#ffffff'], heavy ? 10 : 4, { speed: 4, up: 2, size: 0.06, life: 0.3, glow: true, gravity: 8 });
        if (heavy) { fx.shock(p.clone().setY(p.y - 0.8), 1.4, c, 0.25, 0.2); if (loud) boom(260, 110, 0.12, 0.2); }
        break;
      }
      case 'hit.frost':
        // a fully chilled enemy freezes solid: an ice star, a ring of rime, a column of cold light
        fx.shafts(at(e), ICE, 8, 2.6, 0.1);
        fx.pillar(at(e, -0.9), SNOW, 5, 0.2);
        fx.burst(at(e), [ICE, '#ffffff', ICE_DEEP], 22, { speed: 4, up: 3, size: 0.1, life: 0.6, glow: true, gravity: 7 });
        fx.shock(at(e, -0.9), 2.2, ICE, 0.35, 0.16);
        if (loud) { hiss({ dur: 0.25, vol: 0.12, f: 5200, f1: 1400, q: 1.5 }); bell(1568, 0.5, 0.05); }
        break;
      case 'hit.magic': {
        // the tether at full drain: a violet star and a pulse back along the thread
        const p = at(e);
        fx.shafts(p, ARCANE, 6, 2.2, 0.09);
        fx.flash(p, ARCANE, 1.8, 0.2);
        fx.burst(p, [ARCANE, '#ffffff', ARCANE_DEEP], 14, { speed: 3, up: 2.5, size: 0.08, life: 0.5, glow: true, gravity: 3 });
        if (loud) voice({ type: 'sine', f: 880, f1: 440, dur: 0.2, vol: 0.04 });
        break;
      }
      case 'hit.splash': {
        const p = at(e), R = num(e.r, 2.4), c = C(2.6, 1.9, 1.1);
        fx.explosion(p.clone().setY(p.y + 0.4), R, C(2.2, 1.6, 1.0));
        fx.burst(p.clone().setY(p.y + 0.3), ['#8a8a90', '#5a5a60', '#c8b890'], 26, { speed: 5, up: 6, size: 0.15, life: 0.8, gravity: 11 });
        fx.shafts(p.clone().setY(p.y + 0.5), c, 9, R * 1.3, 0.13, 0.9);
        fx.ring(p.clone().setY(p.y + 0.08), R, c, 0.4, 0.16);
        fx.decal(p, fx.glowTex, '#1a1410', R * 1.5, 4, false, 0.6);
        fx.shake = Math.max(fx.shake, 0.4);
        if (loud) boom(140, 40, 0.5, 0.45);
        break;
      }
      case 'hit.oil':
        fx.burst(at(e, 0.2), [TAR, '#2a2018', TAR_SHEEN], 24, { speed: 3.5, up: 3.5, size: 0.13, life: 0.7, gravity: 9, glow: false });
        fx.shock(at(e, 0.06), num(e.r, 2.2), TAR_SHEEN, 0.4, 0.2);
        fx.shafts(at(e, 0.4), EMBER, 4, 1.6, 0.07, 0.3);
        if (loud) hiss({ dur: 0.3, vol: 0.1, f: 500, f1: 200, q: 0.8, type: 'lowpass' });
        break;
      case 'hit.meteor': {
        const p = at(e), R = num(e.r, 4.5);
        fx.explosion(p.clone().setY(p.y + 0.5), R, STAR);
        fx.ring(p.clone().setY(p.y + 0.1), R, STAR, 0.6, 0.3, 2);
        fx.ring(p.clone().setY(p.y + 0.1), R * 0.6, STAR_DEEP, 0.45, 0.2, 1.4);
        fx.burst(p.clone().setY(p.y + 0.4), [STAR, STAR_DEEP, '#ffffff', '#5a4a3a'], 60, { speed: 8, up: 8, size: 0.17, life: 1, glow: true, gravity: 10 });
        fx.shafts(p.clone().setY(p.y + 0.8), STAR, 12, R * 1.3, 0.14, 0.9);
        fx.pillar(p, C(3.2, 2.4, 1.2), 16, 0.4);
        fx.light(p.clone().setY(p.y + 2), '#ffb84a', 16, 18, 0.5);
        fx.screenFlash('#ffd9a0', 0.08, 0.2);
        fx.decal(p, fx.glowTex, '#140c06', R * 1.7, 7, false, 0.75);
        fx.shake = Math.max(fx.shake, 0.9);
        if (loud) { boom(55, 22, 0.9, 0.7); hiss({ dur: 0.6, vol: 0.12, f: 1200, f1: 200, q: 0.6, type: 'lowpass' }); }
        break;
      }
      case 'hit.ballista': {
        const p = at(e), c = C(3.2, 2.8, 1.6), d = new THREE.Vector3(num(e.dx), 0, num(e.dz, 1));
        fx.cut(p, d, 3.2, c, 0.12);
        fx.shafts(p, c, 4, 1.8, 0.07);
        fx.flash(p, c, 1.3, 0.14);
        fx.burst(p, ['#ffffff', '#d8c8a0', c], 12, { speed: 4.5, up: 2.5, size: 0.07, life: 0.35, glow: true, gravity: 8 });
        break;
      }
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

      // ---------- items from fallen enemies ----------
      case 'drop.spawn': {
        const relic = !!e.relic, c = relic ? C(3.6, 2.4, 0.7) : rarityColor(str(e.def));
        fx.shafts(at(e), c, relic ? 10 : 5, relic ? 3 : 1.8, relic ? 0.12 : 0.07);
        fx.flash(at(e), c, relic ? 2.6 : 1.4, 0.25);
        if (relic) { fx.pillar(at(e, -0.9), c, 12, 0.45); fx.ring(at(e, -0.8), 2.6, c, 0.5, 0.14, 1.6); }
        if (loud) { bell(relic ? 1046 : 784, 0.7, 0.07); if (relic) { bell(1318, 0.9, 0.06, 0.08); bell(1568, 1.1, 0.06, 0.16); } }
        break;
      }
      case 'drop.pick': {
        const relic = !!e.relic, c = relic ? C(3.6, 2.4, 0.7) : rarityColor(str(e.def));
        fx.shafts(at(e), c, relic ? 12 : 6, relic ? 3.4 : 2, 0.1, 0.9);
        fx.burst(at(e), [c, '#ffffff'], relic ? 30 : 14, { speed: 3.5, up: 4, size: 0.08, life: 0.7, glow: true, gravity: 5 });
        if (relic) fx.pillar(at(e, -0.7), c, 10, 0.4);
        if (num(e.seat) === ctx.seat()) {
          let title = str(e.def);
          try { title = itemDef(title).title; } catch { /* an item this build does not know */ }
          const h = ctx.heroPos();
          fx.text(h.clone().setY(h.y + 2), title, relic ? 'syn res' : 'syn');
          if (loud) { bell(880, 0.5, 0.06); bell(1320, 0.7, 0.05, 0.07); }
        }
        break;
      }

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

/** Muzzle flash: a short burst of light and sparks out of the barrel along `dir`, real light on the tower for a blink */
function muzzle(fx: FX, p: THREE.Vector3, dir: THREE.Vector3, c: THREE.Color, power = 1): void {
  fx.flash(p, c, 0.9 * power, 0.1);
  fx.spray(p, dir, [c, '#ffffff'], Math.round(5 * power), { speed: 7 * power, size: 0.06, life: 0.18, gravity: 2, spread: 0.35 });
  fx.cut(p.clone().addScaledVector(dir, 0.5 * power), dir, 1.1 * power, c, 0.07 * power, 0.04);
}

/** Tower shot: muzzle flash, trails, jets, lightning and sound per tower kind; projectiles fly on their own (src/cgame/views/bolt-view.ts), rays are drawn by the tower (tower-view.ts) */
function fire(e: SimEvent, ctx: FxCtx, loud: boolean): void {
  const { fx } = ctx;
  const from = new THREE.Vector3(num(e.fx, num(e.x)), num(e.fy, num(e.y) + 2), num(e.fz, num(e.z)));
  const out = new THREE.Vector3(from.x - num(e.x), 0, from.z - num(e.z));
  if (out.lengthSq() > 1e-4) out.normalize(); else out.set(0, 0, 1);
  switch (str(e.kind)) {
    case 'ballista': {
      const end = new THREE.Vector3(num(e.tx), num(e.ty), num(e.tz));
      muzzle(fx, from, out, C(3.2, 2.8, 1.6), 1.5);
      fx.streak({ path: (k, o) => o.lerpVectors(from, end, k), dur: 0.22, color: C(2.6, 2.2, 1.2), color2: C(1.4, 1.0, 0.5), width: 0.2, tail: 0.5, halo: 2, core: 0.9 });
      fx.shake = Math.max(fx.shake, 0.15);
      if (loud) { hiss({ dur: 0.15, vol: 0.12, f: 1400, f1: 400, q: 1 }); boom(200, 90, 0.15, 0.25); }
      break;
    }
    case 'oil':
      fx.burst(from, [TAR, TAR_SHEEN, EMBER], 8, { speed: 2, up: 3, size: 0.1, life: 0.4, gravity: 9, glow: false });
      if (loud) hiss({ dur: 0.2, vol: 0.06, f: 400, f1: 250, q: 1 });
      break;
    case 'meteor': {
      // the star over the dome flares; a warning ring on the ground and a trail from the sky — the meteor itself flies as a `b<n>` record
      const to = new THREE.Vector3(num(e.tx), num(e.ty), num(e.tz)), sky = to.clone().add(new THREE.Vector3(-4, 22, -4)), top = at(e, 4.2);
      fx.shafts(top, STAR, 8, 2.4, 0.1, 0.9);
      fx.flash(top, STAR, 2.4, 0.3);
      fx.pillar(top.clone().setY(top.y - 0.5), STAR_DEEP, 14, 0.2);
      fx.shock(to.clone().setY(to.y + 0.08), num(e.r, 4.5), STAR_DEEP, 0.8, 0.1);
      fx.streak({ path: (k, o) => o.lerpVectors(sky, to, k), dur: 0.8, color: STAR, color2: STAR_DEEP, width: 0.7, tail: 0.6, halo: 3.4, core: 0.9 });
      if (loud) hiss({ dur: 0.8, vol: 0.08, f: 300, f1: 1800, q: 0.8 });
      break;
    }
    case 'storm': {
      const pts = Array.isArray(e.pts) ? (e.pts as number[]) : [];
      if (pts.length >= 3) { const top = new THREE.Vector3(pts[0], pts[1], pts[2]); fx.shafts(top, VOLT, 6, 1.8, 0.08, 0.9); fx.flash(top, VOLT, 2, 0.15); fx.light(top, '#9ac8ff', 8, 10, 0.2); }
      for (let i = 3; i + 2 < pts.length; i += 3) {
        const a = new THREE.Vector3(pts[i - 3], pts[i - 2], pts[i - 1]), b = new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]);
        // jagged lightning: a bright ribbon with a kink in the middle and a branching bolt on top of it
        const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 1.2));
        fx.streak({ path: (k, o) => (k < 0.5 ? o.lerpVectors(a, mid, k * 2) : o.lerpVectors(mid, b, (k - 0.5) * 2)), dur: 0.12, color: VOLT, color2: C(3.6, 3.6, 4), width: 0.14, tail: 1, halo: 2.4, core: 0.9 });
        fx.bolt(a, b, VOLT, 0.05, 2, 0.2);
        fx.flash(b, VOLT, 1.2, 0.12);
        fx.shafts(b, VOLT, 2, 1.2, 0.05);
        fx.burst(b, [VOLT, '#ffffff'], 4, { speed: 3.5, up: 2, size: 0.06, life: 0.25, glow: true, gravity: 6 });
      }
      if (loud) { hiss({ dur: 0.25, vol: 0.14, f: 5000, f1: 800, q: 0.7 }); boom(120, 60, 0.2, 0.3); }
      break;
    }
    case 'winter': {
      const p = at(e), R = num(e.r, 7);
      if (e.nova) {
        fx.ring(p.clone().setY(p.y + 0.15), R, SNOW, 0.6, 0.3, 2.2);
        fx.shock(p.clone().setY(p.y + 0.15), R * 0.6, ICE_DEEP, 0.45, 0.2);
        fx.burst(p.clone().setY(p.y + 3.4), [SNOW, '#ffffff', ICE_DEEP], 40, { speed: 9, up: 2, size: 0.12, life: 0.9, glow: true, gravity: 2 });
        fx.shafts(p.clone().setY(p.y + 3.4), SNOW, 10, R * 0.8, 0.1, 0.25);
        fx.pillar(p.clone().setY(p.y + 2), SNOW, 10, 0.4);
        fx.shake = Math.max(fx.shake, 0.35);
        if (loud) { hiss({ dur: 0.9, vol: 0.14, f: 6000, f1: 1200, q: 1 }); boom(90, 50, 0.4, 0.3); bell(1568, 0.8, 0.05); }
      } else {
        if (loud) hiss({ dur: 0.4, vol: 0.04, f: 3000, f1: 1500, q: 0.8 });
      }
      break;
    }
    case 'arrow': {
      const heavy = !!e.heavy;
      muzzle(fx, from, out, C(3.2, 2.8, 1.4), heavy ? 1.6 : 0.8);
      if (loud) { hiss({ dur: 0.08, vol: 0.08, f: 2600, f1: 900, q: 1.2 }); if (heavy) boom(320, 140, 0.1, 0.15); }
      break;
    }
    // rays: the tower draws them itself; here only the hum of the channel, quietly, now and then
    case 'frost': if (loud && Math.random() < 0.3) voice({ type: 'triangle', f: 1400 + num(e.ramp) * 500, f1: 900, dur: 0.2, vol: 0.02 }); break;
    case 'magic': if (loud && Math.random() < 0.3) voice({ type: 'sine', f: 330 + num(e.ramp) * 330, f1: 660, dur: 0.22, vol: 0.025 }); break;
    case 'splash':
      fx.burst(from, ['#c8b890', '#8a8a90'], 8, { speed: 2.5, up: 3, size: 0.09, life: 0.4, gravity: 9 });
      fx.shafts(from, C(2.4, 2, 1.4), 3, 1.2, 0.06);
      if (loud) { hiss({ dur: 0.2, vol: 0.08, f: 600, f1: 300, q: 1 }); boom(300, 120, 0.12, 0.2); }
      break;
    case 'fire': {
      const yaw = num(e.yaw), dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), half = num(e.half, 0.42), R = 6;
      fx.spray(from, dir.clone().setY(0.05), [FIRE, EMBER, '#ffd060'], 22, { speed: 9, size: 0.16, life: 0.6, gravity: -1, spread: half * 0.55 });
      fx.spray(from, dir.clone().setY(0.05), ['#fff2c0', FIRE], 8, { speed: 13, size: 0.08, life: 0.35, gravity: 0, spread: half * 0.3 });
      for (let i = 0; i < 3; i++) fx.fireCubes(from.clone().addScaledVector(dir, R * (0.25 + i * 0.25)), 0.5 + i * 0.4, 3, [FIRE, EMBER], 0.24);
      muzzle(fx, from, dir, FIRE, 1.4);
      fx.light(from.clone().addScaledVector(dir, 2), FIRE, 7, 8, 0.25);
      if (loud) hiss({ dur: 0.35, vol: 0.12, f: 900, f1: 400, q: 0.6, type: 'lowpass' });
      break;
    }
    default: break;
  }
}
