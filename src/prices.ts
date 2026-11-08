import { itemDef, PRICE, type ItemDef, type Rarity } from './items.ts';
import { getWeapon, weaponMetrics } from './weapons.ts';

/**
 * Shop prices (wiki/design-inventory.md, section "Merchants"): every item sells at its own price — from its stats,
 * rarity and the power it will be forged at (hero power). Melee weapons — from the balance score `weaponMetrics().score`
 * (warden sword = 100: damage per second, area, reach, speed), ranged — from damage per second and range, armour —
 * from health and perks, artifacts — from power, radius and cooldown. Rounded to 5.
 */

const RARITY_K: Record<Rarity, number> = { common: 1, rare: 1.45, unique: 2.1 };
/** Forged stronger — pricier: +15 % per unit of power */
const powerK = (power: number): number => 1 + (Math.max(1, power) - 1) * 0.15;
const r5 = (v: number): number => Math.max(5, Math.round(v / 5) * 5);

/** Worth at power 1, without rarity — "how much the item can do" */
export function worth(d: ItemDef): number {
  if (d.slot === 'melee') {
    const w = getWeapon(d.weapon ?? '');
    return w ? weaponMetrics(w).score : 100;
  }
  if (d.ranged) {
    const r = d.ranged, dps = (r.dmg * (r.shots ?? 1)) / r.cd;
    return dps * 3.6 + r.range * 2 + r.knock * 10;
  }
  if (d.armor) return 20 + d.armor.health * 1.4 + d.armor.perks.reduce((s, p) => s + p.value * 0.45, 0);
  if (d.artifact) {
    const a = d.artifact;
    return 45 + Math.min(120, a.power * 1.2) + (a.radius ?? 0) * 4 + (a.duration ?? 0) * 2 + Math.max(0, 20 - a.cd) * 1.5;
  }
  return 100;
}

/** Shop price of item def at power power */
export function priceOf(def: string, power: number): number {
  const d = itemDef(def);
  if (d.spell === 'shop') return PRICE.spell(power);
  return r5(worth(d) * RARITY_K[d.rarity] * powerK(power));
}

/** Defence sutler prices (wiki/design-tower-defence.md, section 12): by rarity, expensive — invest in the hero or in two or three towers. The server charges the same */
export const SUTLER_PRICE: Record<Rarity, number> = { common: 240, rare: 480, unique: 780 };
export const SUTLER_ARROWS = 45;
/** Arrows in one bundle at the merchant and the sutler */
export const ARROW_BUNDLE = 24;
