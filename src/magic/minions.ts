import * as THREE from 'three';
import { rnd } from '../rng.ts';
import { addDecoy } from '../decoys.ts';
import type { Spells, School } from '../spells.ts';
import type { Target } from '../target.ts';
import { rand } from './kit.ts';

/**
 * Summons (wiki/design-spells.md, "Base spells"): the shared flow for wolves, elementals and golems.
 * A portal opens, the figure rises from the ground, walks to the nearest enemy on its own (not to barrels), hits with a cooldown,
 * stays near the hero without enemies. While alive it is bait for mobs (src/decoys.ts): they hit it instead of the hero; health gone —
 * it vanishes early. At the end it dissolves and cleans everything up after itself.
 */

export interface Minion {
  readonly g: THREE.Group;
  readonly pos: THREE.Vector3;
  /** Index in the pack (layout around the hero, animation phase) */
  readonly i: number;
  /** Lifetime, s */
  t: number;
  hp: number;
  target: Target | null;
  /** Attack in progress: time left, s (0 — none) */
  swing: number;
  /** The spell's own state (the elemental's flame, the wolf's leap phase) */
  data: Record<string, unknown>;
}

export interface MinionSpec {
  school: School;
  /** Where to appear */
  at: THREE.Vector3;
  i: number;
  /** Lifespan, s */
  life: number;
  hp: number;
  /** Run speed, m/s */
  speed: number;
  /** Reach of the hit (from the target's edge), m */
  reach: number;
  /** Hit cooldown, s; swing duration, s (damage at the middle) */
  cd: number;
  swing: number;
  /** Radius of pulling mobs onto itself (golem), m */
  taunt?: number;
  /** Height, m — for particles and portal glow */
  height: number;
  /** Model and its materials (materials are disposed at the end; geometry can be shared between summons) */
  build(): { g: THREE.Group; mats: THREE.Material[] };
  /** The moment of the hit on the target (damage, flash, sound) */
  strike(m: Minion, t: Target): void;
  /** Animation every frame: walking — moving; swing 0..1 — swing phase (or −1) */
  animate?(m: Minion, dt: number, walking: boolean, swing: number): void;
  /** Took a hit from a mob */
  onHurt?(m: Minion, dmg: number): void;
}

/** Summon: portal, rise from the ground, fight, dissolve. Returns the summon (for tests) */
export function summon(kit: Spells, spec: MinionSpec): Minion {
  const fx = kit.h.fx, hero = kit.h.hero, s = kit.color(spec.school);
  const { g, mats } = spec.build();
  const at = kit.ground(spec.at, 99);
  g.position.copy(at).setY(at.y - spec.height);
  g.rotation.y = hero.yaw;
  kit.h.scene.add(g);
  kit.groundSigil(spec.school, at, 0.6 + spec.height * 0.35, 0.25, 0.9, 0.35);
  fx.flash(at.clone().setY(at.y + spec.height * 0.5), s.b.clone().multiplyScalar(0.6), 1.2 + spec.height, 0.3);
  for (let j = 0; j < 14; j++) fx.particle({ pos: at.clone().add(new THREE.Vector3(rand(-0.4, 0.4), 0.1, rand(-0.4, 0.4))), vel: new THREE.Vector3(0, rand(2, 4.5), 0), life: 0.6, size: 0.07, color: j % 2 ? s.a : s.b, gravity: -0.5 });
  const m: Minion = { g, pos: g.position, i: spec.i, t: 0, hp: spec.hp, target: null, swing: 0, data: {} };
  let cd = 0.3 + spec.i * 0.2, hitDone = true, gone = false;
  const remove = addDecoy({
    pos: g.position, radius: 0.5, taunt: spec.taunt,
    get alive() { return !gone && m.t > 0.5 && m.t < spec.life && m.hp > 0; },
    hurt(dmg) {
      m.hp -= dmg;
      fx.flash(g.position.clone().setY(g.position.y + spec.height * 0.6), s.a.clone().multiplyScalar(0.5), 1, 0.15);
      spec.onHurt?.(m, dmg);
    },
  });
  kit.proc((dt) => {
    m.t += dt;
    const floor = kit.h.terrain.floorAt(g.position.x, g.position.z, g.position.y + 2);
    const fy = Number.isFinite(floor) ? floor : hero.pos.y;
    // rise from the portal
    if (m.t < 0.5) { g.position.y = fy - spec.height * (1 - m.t / 0.5) ** 2; spec.animate?.(m, dt, false, -1); return true; }
    // end: time is up or health is gone — dissolves upward
    if (m.t >= spec.life || m.hp <= 0) {
      if (!gone) { gone = true; remove(); m.data.endT = 0; }
      const e = ((m.data.endT as number) += dt) / 0.6;
      g.scale.set(1, Math.max(0.01, 1 - e), 1);
      for (const mt of mats) mt.opacity = Math.max(0, 1 - e);
      if (rnd() < 0.7) fx.particle({ pos: g.position.clone().add(new THREE.Vector3(rand(-0.3, 0.3), rand(0.1, spec.height), rand(-0.3, 0.3))), vel: new THREE.Vector3(0, rand(1, 2.5), 0), life: 0.6, size: 0.07, color: s.b, gravity: -0.5 });
      if (e < 1) return true;
      kit.h.scene.remove(g);
      for (const mt of mats) mt.dispose();
      return false;
    }
    g.position.y = fy;
    // target: the nearest living enemy within 12 m (props untouched), otherwise — to the hero
    if (!m.target?.alive || m.target.prop) m.target = nearestEnemy(kit, g.position, 12);
    const tg = m.target;
    const goal = tg ? tg.pos : hero.pos.clone().add(new THREE.Vector3(Math.cos(m.i * 2.3 + 0.6) * 1.8, 0, Math.sin(m.i * 2.3 + 0.6) * 1.8));
    const d = new THREE.Vector3(goal.x - g.position.x, 0, goal.z - g.position.z);
    const reach = tg ? tg.radius + spec.reach : 0.4, len = d.length();
    if (len > 0.05) g.rotation.y = Math.atan2(d.x, d.z);
    const walking = len > reach && m.swing <= 0;
    if (walking) g.position.addScaledVector(d.normalize(), Math.min(len - reach, spec.speed * dt));
    cd -= dt;
    if (tg && len <= reach + 0.3 && cd <= 0 && m.swing <= 0) { m.swing = spec.swing; hitDone = false; cd = spec.cd; }
    let phase = -1;
    if (m.swing > 0) {
      m.swing -= dt;
      phase = 1 - Math.max(0, m.swing) / spec.swing;
      if (!hitDone && phase >= 0.5) { hitDone = true; if (tg?.alive) spec.strike(m, tg); }
    }
    spec.animate?.(m, dt, walking, phase);
    return true;
  });
  return m;
}

/** Nearest living enemy (not a barrel and not a crate) */
export function nearestEnemy(kit: Spells, p: THREE.Vector3, r: number): Target | null {
  let best: Target | null = null, bd = Infinity;
  for (const t of kit.h.targets()) {
    if (!t.alive || t.prop) continue;
    const d = Math.hypot(t.pos.x - p.x, t.pos.z - p.z) - t.radius;
    if (d < r && d < bd) { bd = d; best = t; }
  }
  return best;
}
