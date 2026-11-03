import * as THREE from 'three';
import { rnd } from '../rng.ts';
import { addDecoy } from '../decoys.ts';
import type { Spells, School } from '../spells.ts';
import type { Target } from '../target.ts';
import { rand } from './kit.ts';

/**
 * Призванные (wiki/design-spells.md, «Базовые заклинания»): общий ход для волков, элементалей и големов.
 * Портал раскрывается, фигура поднимается из земли, сама идёт к ближайшему врагу (не к бочкам), бьёт с перезарядкой,
 * без врагов держится у героя. Пока жива — приманка для мобов (src/decoys.ts): её бьют вместо героя, здоровье кончилось —
 * исчезает раньше срока. В конце растворяется и всё за собой убирает.
 */

export interface Minion {
  readonly g: THREE.Group;
  readonly pos: THREE.Vector3;
  /** Номер в стае (раскладка у героя, фаза анимации) */
  readonly i: number;
  /** Сколько живёт, с */
  t: number;
  hp: number;
  target: Target | null;
  /** Идёт атака: сколько осталось, с (0 — нет) */
  swing: number;
  /** Своё состояние заклинания (огонёк элементаля, фаза прыжка волка) */
  data: Record<string, unknown>;
}

export interface MinionSpec {
  school: School;
  /** Где появиться */
  at: THREE.Vector3;
  i: number;
  /** Срок жизни, с */
  life: number;
  hp: number;
  /** Бег, м/с */
  speed: number;
  /** С какого расстояния бьёт (от края цели), м */
  reach: number;
  /** Перезарядка удара, с; длительность взмаха, с (урон — в середине) */
  cd: number;
  swing: number;
  /** Радиус перетягивания мобов на себя (голем), м */
  taunt?: number;
  /** Ростом, м — для частиц и свечения портала */
  height: number;
  /** Модель и её материалы (материалы освобождаются в конце; геометрию можно делить между призывами) */
  build(): { g: THREE.Group; mats: THREE.Material[] };
  /** Миг удара по цели (урон, вспышка, звук) */
  strike(m: Minion, t: Target): void;
  /** Анимация каждый кадр: walking — идёт; swing 0..1 — фаза взмаха (или −1) */
  animate?(m: Minion, dt: number, walking: boolean, swing: number): void;
  /** Получил удар от моба */
  onHurt?(m: Minion, dmg: number): void;
}

/** Призвать: портал, подъём из земли, бой, растворение. Возвращает призванного (для тестов) */
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
    // подъём из портала
    if (m.t < 0.5) { g.position.y = fy - spec.height * (1 - m.t / 0.5) ** 2; spec.animate?.(m, dt, false, -1); return true; }
    // конец: срок вышел или здоровье кончилось — растворяется вверх
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
    // цель: ближайший живой враг в 12 м (вещи не трогаем), иначе — к герою
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

/** Ближайший живой враг (не бочка и не ящик) */
export function nearestEnemy(kit: Spells, p: THREE.Vector3, r: number): Target | null {
  let best: Target | null = null, bd = Infinity;
  for (const t of kit.h.targets()) {
    if (!t.alive || t.prop) continue;
    const d = Math.hypot(t.pos.x - p.x, t.pos.z - p.z) - t.radius;
    if (d < r && d < bd) { bd = d; best = t; }
  }
  return best;
}
