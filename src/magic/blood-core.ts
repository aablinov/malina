import * as THREE from 'three';
import type { Spells } from '../spells.ts';
import { bell, boom, hiss, voice } from '../spell-audio.ts';
import type { Target } from '../target.ts';
import { rand } from './kit.ts';
import { t } from '../i18n/i18n.ts';

/**
 * Raspberry blood (wiki/design-spells.md, "Base spells"), like blood magic in Elden Ring:
 * a cast costs health (never below 1 — you cannot kill yourself), but the cooldown is short;
 * hits build a bleed gauge on the target — a full one bursts: damage, raspberry juice splashes, a little life for the hero.
 */

export const BLEED_MAX = 100;
/** Bleed burst: damage and hero healing */
export const BLEED_BURST = 20;
export const BLEED_HEAL = 5;

const meters = new WeakMap<Target, { v: number; t: number }>();

/** Pay a share of max health: −N, juice splashes, a juicy sound. Returns the amount paid */
export function payHp(kit: Spells, frac: number): number {
  const hero = kit.h.hero, fx = kit.h.fx, s = kit.color('blood');
  const paid = Math.max(0, Math.min(hero.hp - 1, hero.maxHp * frac));
  if (paid <= 0) return 0;
  hero.hp -= paid;
  const c = hero.pos.clone().setY(hero.pos.y + 1);
  fx.text(c, `−${Math.round(paid)}`, 'bad');
  fx.burst(c, [s.a, s.b, '#a01040'], 14, { speed: 2.2, up: 2.5, size: 0.07, life: 0.6, glow: true, gravity: 8 });
  // drops run down the arms to the palm
  const hand = kit.hand();
  for (let i = 0; i < 8; i++) {
    const from = c.clone().add(new THREE.Vector3(rand(-0.3, 0.3), rand(-0.3, 0.3), rand(-0.3, 0.3))), life = 0.25;
    fx.particle({ pos: from, vel: hand.clone().sub(from).divideScalar(life), life, size: 0.06, color: s.a, gravity: 0, shrink: false });
  }
  hiss({ dur: 0.12, vol: 0.14, f: 700, q: 1.6, verb: 0.2 });
  voice({ type: 'sine', f: 180, f1: 90, dur: 0.18, vol: 0.12, verb: 0.2 });
  return paid;
}

/** Add bleed to the target; the gauge decays 25/s after a second without new hits. true — it burst */
export function bleed(kit: Spells, tg: Target, amount: number): boolean {
  if (!tg.alive || tg.prop) return false;
  const fx = kit.h.fx, s = kit.color('blood');
  const m = meters.get(tg) ?? { v: 0, t: kit.time };
  const idle = kit.time - m.t;
  if (idle > 1) m.v = Math.max(0, m.v - (idle - 1) * 25);
  m.v += amount; m.t = kit.time;
  meters.set(tg, m);
  // drops from the wound — the thicker, the closer to the burst
  const top = tg.pos.clone().setY(tg.pos.y + Math.min(1.6, (tg.topY ?? 1.8) * 0.7));
  fx.burst(top, [s.a, '#a01040'], 2 + Math.round(m.v / 25), { speed: 1.2, up: 1, size: 0.05, life: 0.5, glow: true, gravity: 9 });
  if (m.v < BLEED_MAX) return false;
  m.v = 0;
  // burst: fountain of raspberry juice, ring, hit
  fx.flash(top, s.b.clone().multiplyScalar(0.6), 2, 0.25);
  fx.shock(tg.pos.clone().setY(tg.pos.y + 0.06), 1.8, s.a, 0.35, 0.18);
  fx.burst(top, [s.a, s.b, '#ffb0c8'], 30, { speed: 4, up: 5, size: 0.08, life: 0.8, glow: true, gravity: 10 });
  fx.decal(tg.pos, kit.tex.glow(), s.a.clone().multiplyScalar(0.35), 2.2, 2.5, true);
  fx.text(top.clone().setY(top.y + 0.4), t('Bleed!'), 'crit');
  kit.h.damage(tg, BLEED_BURST, kit.h.hero.pos, 0.5);
  const hero = kit.h.hero;
  if (!hero.down) {
    hero.hp = Math.min(hero.maxHp, hero.hp + BLEED_HEAL);
    // a drop of life flies in an arc to the hero
    const to = hero.pos.clone().setY(hero.pos.y + 1), life = 0.45, g = -6;
    for (let i = 0; i < 5; i++) {
      const v = to.clone().sub(top).divideScalar(life); v.y -= (g * life) / 2;
      fx.particle({ pos: top.clone(), vel: v.add(new THREE.Vector3(rand(-0.5, 0.5), rand(-0.3, 0.3), rand(-0.5, 0.5))), life, size: 0.07, color: s.b, gravity: g, shrink: false });
    }
  }
  boom(120, 45, 0.4, 0.4);
  hiss({ dur: 0.3, vol: 0.22, f: 900, f1: 300, q: 0.8, verb: 0.3 });
  bell(293.66, 0.8, 0.05, 0.05, 0.5);
  return true;
}
