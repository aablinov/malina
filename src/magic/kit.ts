import * as THREE from 'three';
import type { ArtifactStats } from '../items';
import type { School, Spells } from '../spells';

/**
 * Общее для всех заклинаний (wiki/design-spells.md): стартовых (starters.ts), базовых у торговца (base-*.ts) и с боссов.
 * Каждое — Spell: школа (цвета, круг, звук заряда), ступень пафоса, cast и, если надо, своя картинка заряда.
 * Реестр по id предмета — SPELLS (registry.ts); заряд и каст ведёт Spells (src/spells.ts), чьи методы и есть
 * инструменты каста: later, proc, impact, windup, pomp, groundSigil, bolt, nearest, within, ground, face, hand, color, buff, aim, tex;
 * хуки h — сцена, FX, герой, цели, урон.
 */

/** Ступень пафоса: обычное, редкое, легендарное, мифическое */
export type Tier = 'common' | 'rare' | 'legendary' | 'mythic';

export interface Spell {
  school: School;
  tier: Tier;
  /** Название для крупной надписи мифических */
  title: string;
  /** На себя: пока заряжается, герой смотрит вперёд, а не на курсор */
  self?: boolean;
  /** Размер сгустка в руке по заряду 0..1 (по умолчанию 0,35 + 0,7·k) */
  orb?(k: number): number;
  /** Каждый кадр заряда: своя картинка у ладони hand при заряде k */
  charging?(kit: Spells, hand: THREE.Vector3, k: number): void;
  /** power — уже с зарядом (×1…×2,5) и силой предмета; k — заряд 0..1; at — точка курсора на земле */
  cast(kit: Spells, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void;
}

export const C = (r: number, g: number, b: number): THREE.Color => new THREE.Color(r, g, b);
export const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/** Заглушка, пока заклинание не сделано: замах, удар по площади у курсора, вспышка */
export function placeholder(school: School, tier: Tier, title: string): Spell {
  return {
    school, tier, title,
    cast(kit, a, power, at, k) {
      const c = kit.ground(at, 12), s = kit.color(school), R = a.radius && a.radius < 8 ? a.radius : 3;
      kit.face(c);
      kit.windup(school, k);
      kit.later(0.2, () => {
        kit.impact(school, c, k, 14, 0.4);
        kit.pomp(tier, c, school, title);
        kit.h.fx.flash(c.clone().setY(c.y + 1), s.b.clone().multiplyScalar(0.6), R * 1.4, 0.3);
        kit.h.fx.shock(c, R, s.a, 0.4, 0.2);
        kit.h.aoe(c, R, Math.round(power), 1, false);
      });
    },
  };
}
