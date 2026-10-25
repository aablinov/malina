import * as THREE from 'three';
import type { Spells } from '../spells';
import { bell, boom, hiss, voice } from '../spell-audio';
import type { Target } from '../target';
import { rand } from './kit';

/**
 * Малиновая кровь (wiki/design-spells.md, «Базовые заклинания»), как магия крови в Elden Ring:
 * каст стоит здоровья (не ниже 1 — убить себя нельзя), зато перезарядка короткая;
 * удары копят на цели шкалу кровотечения — полная лопается всплеском: урон, брызги малинового сока, немного жизни герою.
 */

export const BLEED_MAX = 100;
/** Всплеск кровотечения: урон и лечение героя */
export const BLEED_BURST = 20;
export const BLEED_HEAL = 5;

const meters = new WeakMap<Target, { v: number; t: number }>();

/** Заплатить долей максимального здоровья: −N, брызги сока, сочный звук. Возвращает уплаченное */
export function payHp(kit: Spells, frac: number): number {
  const hero = kit.h.hero, fx = kit.h.fx, s = kit.color('blood');
  const paid = Math.max(0, Math.min(hero.hp - 1, hero.maxHp * frac));
  if (paid <= 0) return 0;
  hero.hp -= paid;
  const c = hero.pos.clone().setY(hero.pos.y + 1);
  fx.text(c, `−${Math.round(paid)}`, 'bad');
  fx.burst(c, [s.a, s.b, '#a01040'], 14, { speed: 2.2, up: 2.5, size: 0.07, life: 0.6, glow: true, gravity: 8 });
  // капли стекают по рукам к ладони
  const hand = kit.hand();
  for (let i = 0; i < 8; i++) {
    const from = c.clone().add(new THREE.Vector3(rand(-0.3, 0.3), rand(-0.3, 0.3), rand(-0.3, 0.3))), life = 0.25;
    fx.particle({ pos: from, vel: hand.clone().sub(from).divideScalar(life), life, size: 0.06, color: s.a, gravity: 0, shrink: false });
  }
  hiss({ dur: 0.12, vol: 0.14, f: 700, q: 1.6, verb: 0.2 });
  voice({ type: 'sine', f: 180, f1: 90, dur: 0.18, vol: 0.12, verb: 0.2 });
  return paid;
}

/** Добавить кровотечение цели; шкала тает 25/с после секунды без новых ударов. true — лопнула */
export function bleed(kit: Spells, t: Target, amount: number): boolean {
  if (!t.alive || t.prop) return false;
  const fx = kit.h.fx, s = kit.color('blood');
  const m = meters.get(t) ?? { v: 0, t: kit.time };
  const idle = kit.time - m.t;
  if (idle > 1) m.v = Math.max(0, m.v - (idle - 1) * 25);
  m.v += amount; m.t = kit.time;
  meters.set(t, m);
  // капли с раны — тем гуще, чем ближе к всплеску
  const top = t.pos.clone().setY(t.pos.y + Math.min(1.6, (t.topY ?? 1.8) * 0.7));
  fx.burst(top, [s.a, '#a01040'], 2 + Math.round(m.v / 25), { speed: 1.2, up: 1, size: 0.05, life: 0.5, glow: true, gravity: 9 });
  if (m.v < BLEED_MAX) return false;
  m.v = 0;
  // всплеск: фонтан малинового сока, кольцо, удар
  fx.flash(top, s.b.clone().multiplyScalar(0.6), 2, 0.25);
  fx.shock(t.pos.clone().setY(t.pos.y + 0.06), 1.8, s.a, 0.35, 0.18);
  fx.burst(top, [s.a, s.b, '#ffb0c8'], 30, { speed: 4, up: 5, size: 0.08, life: 0.8, glow: true, gravity: 10 });
  fx.decal(t.pos, kit.tex.glow(), s.a.clone().multiplyScalar(0.35), 2.2, 2.5, true);
  fx.text(top.clone().setY(top.y + 0.4), 'Кровотечение!', 'crit');
  kit.h.damage(t, BLEED_BURST, kit.h.hero.pos, 0.5);
  const hero = kit.h.hero;
  if (!hero.down) {
    hero.hp = Math.min(hero.maxHp, hero.hp + BLEED_HEAL);
    // капля жизни летит дугой к герою
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
