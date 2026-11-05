import { enchantDef, type EnchantId, type Item } from './items.ts';
import type { WeaponCategory } from './weapons.ts';
import { t } from './i18n/i18n.ts';

/**
 * Weapon temper (wiki/design-weapon-arts.md): melee enchantments change how the weapon looks and strikes.
 * Each of the eight has its own blade colour, trail, sparks at the edge and hit effect; each pair is a named synergy
 * that fires on the finisher and on the weapon art; three at once — a "resonance" of three synergies.
 * The weapon art (Q) is unique per weapon category, the meter fills with hits.
 * Only data here — no three: effects are drawn by src/weapon-arts.ts, the card by src/hud/inventory.ts.
 */

export type MeleeEnchant = 'sharpness' | 'critical' | 'leeching' | 'knockback' | 'swirling' | 'fireAspect' | 'soulSiphon' | 'smiting';
export const MELEE_ENCHANTS: readonly MeleeEnchant[] = ['sharpness', 'critical', 'leeching', 'knockback', 'swirling', 'fireAspect', 'soulSiphon', 'smiting'];

export interface TemperLook {
  /** What the temper on the blade is called */
  name: string;
  /** HDR colour of the trail and glow (above 1 — for bloom; weak components below 1, otherwise bloom burns to white) */
  rgb: readonly [number, number, number];
  /** What falls off the blade */
  spark: string;
  /** What is seen on a hit */
  hit: string;
}

export const TEMPER_LOOK: Record<MeleeEnchant, TemperLook> = {
  sharpness: { name: t('Ice Steel'), rgb: [0.9, 1.9, 2.8], spark: 'white glitter', hit: 'criss-cross cut' },
  critical: { name: t('Starry'), rgb: [2.8, 1.9, 0.3], spark: 'golden stars', hit: 'a star, on crit — rays and a flash' },
  leeching: { name: t('Crimson'), rgb: [2.8, 0.25, 0.45], spark: 'scarlet drops', hit: 'drops fly to the hero' },
  knockback: { name: t('Gale'), rgb: [2.4, 1.5, 0.6], spark: 'dust', hit: 'a wave of air and dust' },
  swirling: { name: t('Whirling'), rgb: [0.3, 2.6, 1.9], spark: 'turquoise curls', hit: 'a turquoise curl around the target' },
  fireAspect: { name: t('Fiery'), rgb: [2.8, 0.8, 0.12], spark: 'embers', hit: 'flame and burning cubes' },
  soulSiphon: { name: t('Ghostly'), rgb: [0.35, 1.9, 2.8], spark: 'soul wisps', hit: 'a soul flies to the hero' },
  smiting: { name: t('Thunderous'), rgb: [1.7, 0.5, 2.8], spark: 'violet discharges', hit: 'a lightning discharge' },
};

/** Synergy of a pair of enchantments: fires on the finisher and on the weapon art */
export interface Synergy {
  id: string;
  pair: readonly [MeleeEnchant, MeleeEnchant];
  title: string;
  text: string;
}

const S = (id: string, a: MeleeEnchant, b: MeleeEnchant, title: string, text: string): Synergy => ({ id, pair: [a, b], title, text });

/** 28 pairs out of eight enchantments — each with its own effect (src/weapon-arts.ts, SYNERGY_FX) */
export const SYNERGIES: readonly Synergy[] = [
  S('starCross', 'sharpness', 'critical', t('Star Cross'), t('Four blades of light cut criss-cross through everything within 3.5 m')),
  S('bleed', 'sharpness', 'leeching', t('Bloody Cut'), t('Those hit bleed for 1.2 s, every drop heals the hero')),
  S('windBlade', 'sharpness', 'knockback', t('Wind Blade'), t('A crescent of wind flies forward: cuts and knocks back over 9 m')),
  S('bladeOrbit', 'sharpness', 'swirling', t('Steel Twister'), t('Five blades circle the hero for 2 s and cut on touch')),
  S('fireLine', 'sharpness', 'fireAspect', t('Fire Cut'), t('The cut sets the ground ablaze for 6 m in front of the hero')),
  S('phantomEcho', 'sharpness', 'soulSiphon', t('Phantom Echo'), t('A ghostly copy of the weapon repeats the strike')),
  S('skySword', 'sharpness', 'smiting', t('Sky Sword'), t('A huge blade falls from the sky and explodes')),
  S('heartStar', 'critical', 'leeching', t('Heart of the Star'), t('Heals the hero, the next three strikes are critical')),
  S('cometKick', 'critical', 'knockback', t('Comet Kick'), t('The target flies off like a comet and explodes as a star')),
  S('starSpiral', 'critical', 'swirling', t('Star Spiral'), t('Eight stars fly out in a spiral')),
  S('supernova', 'critical', 'fireAspect', t('Supernova'), t('A golden fiery explosion at the point of impact')),
  S('starfall', 'critical', 'soulSiphon', t('Starfall'), t('Five stars fall around, each grants a soul')),
  S('wrath', 'critical', 'smiting', t('Wrath of the Heavens'), t('Golden lightning jumps across five targets')),
  S('bloodRam', 'leeching', 'knockback', t('Blood Ram'), t('A wave forward knocks back and heals for every enemy hit')),
  S('crimsonVortex', 'leeching', 'swirling', t('Crimson Vortex'), t('A vortex pulls enemies in for 1.5 s and drinks their strength')),
  S('lifeFlame', 'leeching', 'fireAspect', t('Flame of Life'), t('A ring of fire around the hero burns enemies and heals')),
  S('harvest', 'leeching', 'soulSiphon', t('Harvest of Life'), t('Everyone nearby gives the hero health and souls')),
  S('bloodBolt', 'leeching', 'smiting', t('Crimson Lightning'), t('Scarlet lightning strikes three targets and heals')),
  S('tornado', 'knockback', 'swirling', t('Hurricane'), t('A twister moves forward, pulls in and tosses up')),
  S('flameRam', 'knockback', 'fireAspect', t('Flame Ram'), t('A cone of flame knocks back and sets on fire')),
  S('spiritFist', 'knockback', 'soulSiphon', t('Spirit Fist'), t('A ghostly fist flies forward and explodes')),
  S('thunderclap', 'knockback', 'smiting', t('Thunderclap'), t('Lightning into the ground and a double wave')),
  S('fireTornado', 'swirling', 'fireAspect', t('Fire Twister'), t('Flame circles the hero for 2 s')),
  S('soulWheel', 'swirling', 'soulSiphon', t('Wheel of Souls'), t('Six souls circle and fly into the nearest enemies')),
  S('stormRing', 'swirling', 'smiting', t('Storm Ring'), t('Lightning strikes in a circle around the hero')),
  S('blueFlame', 'fireAspect', 'soulSiphon', t('Blue Flame'), t('Ghostly fire burns for 2 s and siphons souls')),
  S('meteor', 'fireAspect', 'smiting', t('Meteor'), t('A fiery meteor falls from the sky')),
  S('spiritChain', 'soulSiphon', 'smiting', t('Spirit Chain'), t('Blue lightning jumps across six targets, each one a soul')),
];

export const synergyOf = (a: MeleeEnchant, b: MeleeEnchant): Synergy => {
  const s = SYNERGIES.find((x) => (x.pair[0] === a && x.pair[1] === b) || (x.pair[0] === b && x.pair[1] === a));
  if (!s) throw new Error(`No synergy ${a} + ${b}`);
  return s;
};

/** Temper on the blade: an enchantment and its tier 1..3 */
export interface TemperSlot { id: MeleeEnchant; tier: number }

const isMelee = (id: EnchantId): id is MeleeEnchant => (MELEE_ENCHANTS as readonly string[]).includes(id);

/** Chosen and upgraded melee enchantments in slot order, without repeats */
export function temperOf(it: Item | null | undefined): TemperSlot[] {
  const out: TemperSlot[] = [];
  if (!it) return out;
  for (const s of it.enchants) {
    if (s.chosen < 0 || s.tier <= 0) continue;
    const id = s.options[s.chosen];
    if (!isMelee(id) || enchantDef(id).slot !== 'melee') continue;
    const had = out.find((o) => o.id === id);
    if (had) had.tier = Math.max(had.tier, s.tier); else out.push({ id, tier: s.tier });
  }
  return out;
}

/** Temper synergies: one per pair, three enchantments give three (resonance) */
export function synergiesOf(t: readonly TemperSlot[]): Synergy[] {
  const out: Synergy[] = [];
  for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) out.push(synergyOf(t[i].id, t[j].id));
  return out;
}

export const RESONANCE = { title: t('Resonance'), text: t('Three tempers at once: all three synergies and a triple ring fire on the finisher') };

/** Weapon art (Q) of a weapon category */
export interface WeaponSpecial { title: string; text: string }

export const WEAPON_SPECIAL: Record<WeaponCategory, WeaponSpecial> = {
  'sword': { title: t('Blade Whirl'), text: t('Two spins with the blade held out: four strikes at everyone around, you can keep walking') },
  'axe': { title: t('Boomerang'), text: t('The axe flies 8 m forward, spinning, and comes back — cuts everyone on the way there and back') },
  'mace': { title: t('Triple Wave'), text: t('A slam into the ground: three waves one after another, each farther and knocking back harder') },
  'dagger': { title: t('Shadow Step'), text: t('A dash through enemies over 6 m, invulnerable; everyone on the way takes three quick cuts') },
  'spear': { title: t('Piercing Lunge'), text: t('A 5 m lunge: the spear pierces everyone on the line and shoves them aside') },
  'hammer': { title: t('Earth Strike'), text: t('A leap and a slam into the ground: a huge wave, rocks fly out of the earth') },
  'staff': { title: t('Star Wave'), text: t('A crescent of power flies 10 m forward and pierces everyone') },
  'scythe': { title: t('Soul Harvest'), text: t('A wide spin: pulls enemies to the hero, everyone hit gives up a soul') },
  'katana': { title: t('Iaido'), text: t('Blade sheathed, a moment of silence — and an instant cut with a step forward: everyone in a wide arc is slashed at once') },
  'greatsword': { title: t('Berserker Rage'), text: t('Three heavy spins with the blade held out: five crushing strikes and a crimson wave') },
  'dual blades': { title: t('Pontiff Dance'), text: t('Eight strikes of flame and light in turn, ending with crossed blades and an explosion') },
  'halberd': { title: t('Windmill'), text: t('Two and a half spins with a 4 m step forward: the shaft sweeps everyone around') },
  'rapier': { title: t('Flurry of Thrusts'), text: t('Seven thrusts forward in an instant and a final piercing one with knockback') },
  'knuckles': { title: t('Hail of Blows'), text: t('Eight punches and an uppercut: the wave tosses everyone around into the air') },
};

/** How many strikes that hit a target fill the weapon art meter */
export const SPECIAL_HITS = 8;
