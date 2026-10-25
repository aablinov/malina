import { itemDef, PRICE, type ItemDef, type Rarity } from './items';
import { getWeapon, weaponMetrics } from './weapons';

/**
 * Цены лавок (wiki/design-inventory.md, раздел «Торговцы»): каждый предмет продаётся по своей цене — от характеристик,
 * редкости и силы, с которой его выкуют (сила героя). Оружие ближнего боя — от оценки баланса `weaponMetrics().score`
 * (меч стража = 100: урон в секунду, площадь, дальность, скорость), дальнее — от урона в секунду и дальности, броня —
 * от здоровья и свойств, артефакты — от силы, радиуса и перезарядки. Округление — до 5.
 */

const RARITY_K: Record<Rarity, number> = { common: 1, rare: 1.45, unique: 2.1 };
/** Сильнее выкован — дороже: +15 % за единицу силы */
const powerK = (power: number): number => 1 + (Math.max(1, power) - 1) * 0.15;
const r5 = (v: number): number => Math.max(5, Math.round(v / 5) * 5);

/** Стоимость при силе 1, без редкости — «сколько предмет умеет» */
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

/** Цена предмета def силой power у лавки */
export function priceOf(def: string, power: number): number {
  const d = itemDef(def);
  if (d.spell === 'shop') return PRICE.spell(power);
  return r5(worth(d) * RARITY_K[d.rarity] * powerK(power));
}
