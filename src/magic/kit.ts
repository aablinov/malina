import * as THREE from 'three';
import { rnd } from '../rng.ts';
import type { ArtifactStats } from '../items.ts';
import type { School, Spells } from '../spells.ts';

/**
 * Shared by all spells (wiki/design-spells.md): starters (starters.ts), base ones from the merchant (base-*.ts) and boss spells.
 * Each is a Spell: school (colours, circle, charge sound), pomp tier, cast and, when needed, its own charge picture.
 * The registry by item id is SPELLS (registry.ts); charging and casting are driven by Spells (src/spells.ts), whose methods are
 * the casting tools: later, proc, impact, windup, pomp, groundSigil, bolt, nearest, within, ground, face, hand, color, buff, aim, tex;
 * hooks h — scene, FX, hero, targets, damage.
 */

/** Pomp tier: common, rare, legendary, mythic */
export type Tier = 'common' | 'rare' | 'legendary' | 'mythic';

export interface Spell {
  school: School;
  tier: Tier;
  /** Title for the big caption of mythic spells */
  title: string;
  /** Self-cast: while charging the hero looks forward, not at the cursor */
  self?: boolean;
  /** Size of the orb in the hand by charge 0..1 (default 0.35 + 0.7·k) */
  orb?(k: number): number;
  /** Every charge frame: own picture at the palm hand at charge k */
  charging?(kit: Spells, hand: THREE.Vector3, k: number): void;
  /** power — already with charge (×1…×2.5) and item power; k — charge 0..1; at — cursor point on the ground */
  cast(kit: Spells, a: ArtifactStats, power: number, at: THREE.Vector3, k: number): void;
}

export const C = (r: number, g: number, b: number): THREE.Color => new THREE.Color(r, g, b);
export const rand = (a: number, b: number): number => a + rnd() * (b - a);

/** Placeholder until the spell is made: windup, area hit at the cursor, flash */
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
