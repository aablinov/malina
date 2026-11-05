import * as THREE from 'three';
import { pixelTex } from './textures.ts';
import { SWORD, type SwingTuning } from './tuning.ts';
import { t } from './i18n/i18n.ts';

/**
 * Melee weapons: registry, block models, balance.
 * A model is boxes in the hero's hand frame (like the sword in knight.ts): grip at the origin, blade along +Z,
 * the wide side of the blade along Y. Axe and hammer heads and the scythe blade face −Y: in the stance they point forward-down, in the finisher they strike first. Strike numbers are written into the mutable SWORD (tuning.ts) — that is what the game reads.
 * Editor edits are stored in localStorage on top of the defaults (by id).
 */

export type WeaponCategory = 'sword' | 'axe' | 'mace' | 'dagger' | 'spear' | 'hammer' | 'staff' | 'scythe'
  | 'katana' | 'greatsword' | 'dual blades' | 'halberd' | 'rapier' | 'knuckles';
export type WeaponRarity = 'common' | 'rare' | 'unique';

export const CATEGORIES: readonly WeaponCategory[] = ['sword', 'axe', 'mace', 'dagger', 'spear', 'hammer', 'staff', 'scythe', 'katana', 'greatsword', 'dual blades', 'halberd', 'rapier', 'knuckles'];
export const RARITIES: readonly WeaponRarity[] = ['common', 'rare', 'unique'];
/** Rarity colour, as in Minecraft Dungeons */
export const RARITY_COLOR: Record<WeaponRarity, string> = { 'common': '#c9cbd0', 'rare': '#45d39a', 'unique': '#f5a524' };
/** Displayed names of categories and rarities (the ids themselves are English and never shown raw) */
export const CATEGORY_LABEL: Record<WeaponCategory, string> = {
  'sword': t('sword'), 'axe': t('axe'), 'mace': t('mace'), 'dagger': t('dagger'), 'spear': t('spear'), 'hammer': t('hammer'), 'staff': t('staff'), 'scythe': t('scythe'),
  'katana': t('katana'), 'greatsword': t('greatsword'), 'dual blades': t('dual blades'), 'halberd': t('halberd'), 'rapier': t('rapier'), 'knuckles': t('knuckles'),
};
export const RARITY_LABEL: Record<WeaponRarity, string> = { 'common': t('common'), 'rare': t('rare'), 'unique': t('unique') };

/** Model part: a box w×h×d centred at (x, y, z), m */
export interface WeaponPart {
  name?: string;
  w: number; h: number; d: number;
  x: number; y: number; z: number;
  color: string;
  /** Own emissive (Lambert) and its intensity */
  emissive?: string;
  ei?: number;
  /** Self-lit, no lighting: colour × glow (above 1 — bright, for bloom) */
  glow?: number;
  /** No pixel texture — flat colour */
  flat?: boolean;
}

export interface WeaponStats {
  /** A press still continues the combo this long after a strike ends, s */
  comboWindow: number;
  /** From which fraction of a strike the next one may start */
  chainFrom: number;
  /** Pause after the finisher, s */
  finisherCd: number;
  /** Hit stop on impact, s */
  hitStop: number;
  /** Finisher shockwave radius, m */
  shockR: number;
  /** Exactly three strikes: left, right, finisher */
  swings: SwingTuning[];
  /** Crit chance 0..1 and damage multiplier (balance only for now) */
  critChance: number;
  critMult: number;
  /** Attack speed: strike durations are divided by it */
  speed: number;
  /** Weight, kg (for the description and a future slowdown) */
  weight: number;
}

export interface WeaponDef {
  id: string;
  title: string;
  category: WeaponCategory;
  rarity: WeaponRarity;
  description: string;
  model: WeaponPart[];
  /** Blade trail: from base to tip along the hand's Z; without them — 0.22 and the far edge of the model */
  bladeBase?: number;
  bladeTip?: number;
  /** Second weapon in the left hand (dual blades, knuckles): same hand frame, own trail */
  offhand?: WeaponPart[];
  /** Own trail colour without temper (flame, starlight); for the offhand weapon — offTrail */
  trail?: string;
  offTrail?: string;
  stats: WeaponStats;
}

const sw = (dmg: number, time: number, windup: number, strike: number, range: number, arc: number, lunge: number, knock: number): SwingTuning =>
  ({ dmg, time, windup, strike, range, arc, lunge, knock });
const part = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, color: string, more: Partial<WeaponPart> = {}): WeaponPart =>
  ({ name: t(name), w, h, d, x, y, z, color, ...more });
const GOLD = { emissive: '#f2a020', ei: 0.25, flat: true };

/** Default weapons. The first is the hero's sword with the former SWORD numbers */
export const DEFAULT_WEAPONS: readonly WeaponDef[] = [
  {
    id: 'sword', title: t('Warden sword'), category: 'sword', rarity: 'common',
    description: t('The hero\'s trusty sword: quick strikes left and right, an overhead finisher with a shockwave.'),
    bladeBase: 0.22, bladeTip: 1.19,
    model: [
      part('Grip', 0.07, 0.07, 0.24, 0, 0, 0.02, '#5a3a22'),
      part('Pommel', 0.1, 0.1, 0.1, 0, 0, -0.14, '#ff2a5d', { glow: 3 }),
      part('Guard', 0.36, 0.08, 0.09, 0, 0, 0.17, '#f2c040', GOLD),
      part('Blade', 0.06, 0.15, 0.95, 0, 0, 0.675, '#dfe8f2', { emissive: '#7ad8ff', ei: 0.18 }),
      part('Edge', 0.025, 0.17, 0.87, 0, 0, 0.655, '#9dd8ff', { glow: 2.6 }),
      part('Tip', 0.05, 0.08, 0.08, 0, 0, 1.19, '#dfe8f2', { emissive: '#7ad8ff', ei: 0.18 }),
    ],
    stats: {
      comboWindow: 0.35, chainFrom: 0.62, finisherCd: 0.22, hitStop: 0.055, shockR: 2.4,
      swings: [sw(10, 0.36, 0.22, 0.3, 2.1, 160, 0.35, 0.6), sw(12, 0.36, 0.2, 0.3, 2.1, 160, 0.35, 0.6), sw(24, 0.56, 0.36, 0.2, 2.5, 90, 0.7, 1.6)],
      critChance: 0.05, critMult: 1.5, speed: 1, weight: 2.5,
    },
  },
  {
    id: 'axe', title: t('Woodcutter axe'), category: 'axe', rarity: 'common',
    description: t('Heavy wide chopping strikes up close. Slower than the sword, but knocks back harder.'),
    bladeBase: 0.45, bladeTip: 0.8,
    model: [
      part('Haft', 0.07, 0.07, 0.9, 0, 0, 0.3, '#7a5230'),
      part('Wrap', 0.08, 0.08, 0.16, 0, 0, 0, '#3d2616'),
      part('Poll', 0.09, 0.1, 0.12, 0, 0.07, 0.62, '#8e97a3'),
      part('Cheek', 0.1, 0.26, 0.22, 0, -0.14, 0.62, '#c9d2dc', { emissive: '#9ac8ff', ei: 0.1 }),
      part('Edge', 0.04, 0.06, 0.36, 0, -0.3, 0.62, '#bfe2ff', { glow: 2.2 }),
      part('Cap', 0.09, 0.09, 0.06, 0, 0, 0.77, '#f2c040', GOLD),
    ],
    stats: {
      comboWindow: 0.4, chainFrom: 0.65, finisherCd: 0.3, hitStop: 0.07, shockR: 2.2,
      swings: [sw(13, 0.46, 0.26, 0.28, 1.9, 180, 0.3, 0.9), sw(15, 0.46, 0.24, 0.28, 1.9, 180, 0.3, 0.9), sw(30, 0.7, 0.4, 0.2, 2.2, 120, 0.6, 2.0)],
      critChance: 0.05, critMult: 1.5, speed: 1, weight: 4,
    },
  },
  {
    id: 'claymore', title: t('Claymore'), category: 'sword', rarity: 'rare',
    description: t('A two-handed sword: the longest swings, a wide wave. Slow — keep enemies at a distance.'),
    bladeBase: 0.34, bladeTip: 1.72,
    model: [
      part('Grip', 0.08, 0.08, 0.4, 0, 0, 0.05, '#4a2e1a'),
      part('Pommel', 0.12, 0.12, 0.12, 0, 0, -0.2, '#f2c040', GOLD),
      part('Guard', 0.5, 0.1, 0.1, 0, 0, 0.28, '#c9a030', GOLD),
      part('Ricasso', 0.08, 0.12, 0.14, 0, 0, 0.4, '#a8b0bc'),
      part('Blade', 0.07, 0.2, 1.35, 0, 0, 1.005, '#d0d8e4', { emissive: '#8ab8ff', ei: 0.12 }),
      part('Edge', 0.03, 0.22, 1.25, 0, 0, 0.98, '#a8c8ff', { glow: 2 }),
      part('Tip', 0.06, 0.1, 0.1, 0, 0, 1.72, '#d0d8e4', { emissive: '#8ab8ff', ei: 0.12 }),
    ],
    stats: {
      comboWindow: 0.42, chainFrom: 0.68, finisherCd: 0.35, hitStop: 0.075, shockR: 3,
      swings: [sw(16, 0.6, 0.3, 0.26, 2.8, 170, 0.4, 1.0), sw(18, 0.6, 0.28, 0.26, 2.8, 170, 0.4, 1.0), sw(38, 0.85, 0.42, 0.18, 3.1, 100, 0.8, 2.2)],
      critChance: 0.08, critMult: 1.6, speed: 1, weight: 6,
    },
  },
  {
    id: 'dagger', title: t('Shadow dagger'), category: 'dagger', rarity: 'rare',
    description: t('Short and fast: a flurry of close stabs and frequent crits. Short reach — get in close.'),
    bladeBase: 0.14, bladeTip: 0.55,
    model: [
      part('Grip', 0.06, 0.06, 0.16, 0, 0, 0, '#2b2b33'),
      part('Pommel', 0.07, 0.07, 0.07, 0, 0, -0.11, '#9b5cff', { glow: 2.5 }),
      part('Guard', 0.2, 0.05, 0.06, 0, 0, 0.1, '#7b3fbf', { emissive: '#7b3fbf', ei: 0.3, flat: true }),
      part('Blade', 0.04, 0.1, 0.4, 0, 0, 0.33, '#e6e9f0', { emissive: '#c08aff', ei: 0.2 }),
      part('Edge', 0.02, 0.11, 0.36, 0, 0, 0.32, '#c79bff', { glow: 2.4 }),
      part('Tip', 0.03, 0.05, 0.05, 0, 0, 0.55, '#e6e9f0', { emissive: '#c08aff', ei: 0.2 }),
    ],
    stats: {
      comboWindow: 0.3, chainFrom: 0.55, finisherCd: 0.15, hitStop: 0.035, shockR: 1.6,
      swings: [sw(6, 0.24, 0.18, 0.32, 1.6, 120, 0.3, 0.3), sw(6, 0.24, 0.16, 0.32, 1.6, 120, 0.3, 0.3), sw(14, 0.4, 0.3, 0.22, 1.8, 70, 0.6, 0.9)],
      critChance: 0.25, critMult: 2, speed: 1, weight: 0.8,
    },
  },
  {
    id: 'mace', title: t('Mace'), category: 'mace', rarity: 'common',
    description: t('A spiked mace: strong knockback and a big shockwave on the finisher.'),
    bladeBase: 0.48, bladeTip: 0.8,
    model: [
      part('Grip', 0.07, 0.07, 0.6, 0, 0, 0.14, '#6b4a2c'),
      part('Wrap', 0.08, 0.08, 0.16, 0, 0, -0.02, '#3d2616'),
      part('Pommel', 0.1, 0.1, 0.08, 0, 0, -0.16, '#f2c040', GOLD),
      part('Collar', 0.12, 0.12, 0.06, 0, 0, 0.46, '#f2c040', GOLD),
      part('Ball', 0.26, 0.26, 0.26, 0, 0, 0.62, '#8f98a6', { emissive: '#ffb066', ei: 0.06 }),
      part('Spike ←', 0.08, 0.08, 0.08, 0.16, 0, 0.62, '#b5bcc6'),
      part('Spike →', 0.08, 0.08, 0.08, -0.16, 0, 0.62, '#b5bcc6'),
      part('Spike ↑', 0.08, 0.08, 0.08, 0, 0.16, 0.62, '#b5bcc6'),
      part('Spike ↓', 0.08, 0.08, 0.08, 0, -0.16, 0.62, '#b5bcc6'),
      part('Spike forward', 0.08, 0.08, 0.08, 0, 0, 0.79, '#b5bcc6'),
    ],
    stats: {
      comboWindow: 0.38, chainFrom: 0.64, finisherCd: 0.28, hitStop: 0.075, shockR: 2.8,
      swings: [sw(12, 0.44, 0.24, 0.28, 1.9, 140, 0.3, 1.2), sw(13, 0.44, 0.22, 0.28, 1.9, 140, 0.3, 1.2), sw(28, 0.62, 0.38, 0.2, 2.1, 100, 0.55, 2.4)],
      critChance: 0.1, critMult: 1.5, speed: 1, weight: 3.5,
    },
  },
  {
    id: 'spear', title: t('Spear'), category: 'spear', rarity: 'common',
    description: t('Long narrow thrusts: reaches farther than anything, but in a narrow arc. The finisher is a lunge forward.'),
    bladeBase: 1.26, bladeTip: 1.62,
    model: [
      part('Shaft', 0.06, 0.06, 1.7, 0, 0, 0.35, '#8a6038'),
      part('Wrap', 0.07, 0.07, 0.12, 0, 0, 0, '#c03a3a'),
      part('Wrap 2', 0.07, 0.07, 0.1, 0, 0, 0.92, '#c03a3a'),
      part('Butt cap', 0.08, 0.08, 0.06, 0, 0, -0.52, '#f2c040', GOLD),
      part('Collar', 0.09, 0.09, 0.08, 0, 0, 1.22, '#f2c040', GOLD),
      part('Spearhead', 0.05, 0.16, 0.32, 0, 0, 1.42, '#dfe8f2', { emissive: '#7ad8ff', ei: 0.15 }),
      part('Edge', 0.02, 0.18, 0.28, 0, 0, 1.42, '#9dd8ff', { glow: 2.2 }),
      part('Point', 0.04, 0.07, 0.08, 0, 0, 1.6, '#dfe8f2', { emissive: '#7ad8ff', ei: 0.15 }),
    ],
    stats: {
      comboWindow: 0.36, chainFrom: 0.6, finisherCd: 0.25, hitStop: 0.05, shockR: 1.6,
      swings: [sw(11, 0.38, 0.24, 0.28, 3, 50, 0.6, 0.5), sw(11, 0.38, 0.22, 0.28, 3, 50, 0.6, 0.5), sw(26, 0.6, 0.36, 0.2, 3.4, 30, 1.2, 1.4)],
      critChance: 0.15, critMult: 1.6, speed: 1, weight: 3,
    },
  },
  {
    id: 'hammer', title: t('Great hammer'), category: 'hammer', rarity: 'rare',
    description: t('A huge hammer: slow crushing blows and the biggest shockwave of all.'),
    bladeBase: 0.7, bladeTip: 1.07,
    model: [
      part('Grip', 0.08, 0.08, 1, 0, 0, 0.3, '#6e4a2a'),
      part('Wrap', 0.09, 0.09, 0.22, 0, 0, 0, '#3a2414'),
      part('Pommel', 0.12, 0.12, 0.12, 0, 0, -0.24, '#8a8f99'),
      part('Head', 0.3, 0.5, 0.3, 0, 0, 0.92, '#8a8f99'),
      part('Rim ↓', 0.32, 0.06, 0.32, 0, -0.27, 0.92, '#b7bcc4'),
      part('Rim ↑', 0.32, 0.06, 0.32, 0, 0.27, 0.92, '#b7bcc4'),
      part('Rune', 0.02, 0.14, 0.14, 0.155, 0, 0.92, '#ffb347', { glow: 2.5 }),
      part('Rune 2', 0.02, 0.14, 0.14, -0.155, 0, 0.92, '#ffb347', { glow: 2.5 }),
    ],
    stats: {
      comboWindow: 0.45, chainFrom: 0.7, finisherCd: 0.45, hitStop: 0.09, shockR: 3.8,
      swings: [sw(18, 0.7, 0.34, 0.24, 2.2, 150, 0.3, 1.6), sw(20, 0.7, 0.32, 0.24, 2.2, 150, 0.3, 1.6), sw(48, 1.05, 0.46, 0.16, 2.4, 90, 0.5, 3)],
      critChance: 0.05, critMult: 1.8, speed: 1, weight: 9,
    },
  },
  {
    id: 'scythe', title: t('Reaper scythe'), category: 'scythe', rarity: 'unique',
    description: t('A glowing scythe: very wide sweeps, the finisher is a spinning whirl. A unique weapon.'),
    bladeBase: 0.9, bladeTip: 1.16,
    model: [
      part('Shaft', 0.06, 0.06, 1.4, 0, 0, 0.4, '#3b2a4a'),
      part('Wrap', 0.07, 0.07, 0.16, 0, 0, 0, '#6a3fa0'),
      part('Butt cap', 0.08, 0.08, 0.06, 0, 0, -0.32, '#8a5cff', { glow: 2 }),
      part('Collar', 0.1, 0.1, 0.08, 0, 0, 1.1, '#8a5cff', { emissive: '#8a5cff', ei: 0.4, flat: true }),
      part('Ricasso', 0.05, 0.14, 0.12, 0, -0.1, 1.12, '#cfc8e8', { emissive: '#a070ff', ei: 0.25 }),
      part('Blade 1', 0.04, 0.2, 0.12, 0, -0.26, 1.08, '#cfc8e8', { emissive: '#a070ff', ei: 0.25 }),
      part('Blade 2', 0.04, 0.2, 0.12, 0, -0.44, 1.0, '#cfc8e8', { emissive: '#a070ff', ei: 0.25 }),
      part('Blade 3', 0.04, 0.16, 0.1, 0, -0.6, 0.9, '#cfc8e8', { emissive: '#a070ff', ei: 0.25 }),
      part('Point', 0.03, 0.1, 0.08, 0, -0.72, 0.8, '#cfc8e8', { emissive: '#a070ff', ei: 0.25 }),
      part('Edge 1', 0.02, 0.2, 0.03, 0, -0.26, 1.01, '#b98cff', { glow: 2.6 }),
      part('Edge 2', 0.02, 0.2, 0.03, 0, -0.44, 0.93, '#b98cff', { glow: 2.6 }),
      part('Edge 3', 0.02, 0.16, 0.03, 0, -0.6, 0.84, '#b98cff', { glow: 2.6 }),
    ],
    stats: {
      comboWindow: 0.38, chainFrom: 0.62, finisherCd: 0.25, hitStop: 0.05, shockR: 2.6,
      swings: [sw(12, 0.4, 0.24, 0.3, 2.6, 240, 0.3, 0.7), sw(12, 0.4, 0.22, 0.3, 2.6, 240, 0.3, 0.7), sw(28, 0.62, 0.34, 0.24, 2.4, 360, 0.2, 1.4)],
      critChance: 0.12, critMult: 1.8, speed: 1, weight: 3.2,
    },
  },
  // ---------- second batch (wiki/design-weapon-arts.md, section 1) ----------
  {
    id: 'katana', title: t('Katana'), category: 'katana', rarity: 'rare',
    description: t('A curved blade: quick long cuts and a lunging finisher. Weapon art — iaido.'),
    bladeBase: 0.3, bladeTip: 1.28,
    model: [
      part('Grip', 0.06, 0.07, 0.3, 0, 0, 0.02, '#2a2230'),
      part('Wrapping', 0.065, 0.075, 0.04, 0, 0, -0.06, '#c03a4a', { flat: true }),
      part('Wrapping 2', 0.065, 0.075, 0.04, 0, 0, 0.06, '#c03a4a', { flat: true }),
      part('Kashira', 0.07, 0.08, 0.04, 0, 0, -0.14, '#f2c040', GOLD),
      part('Tsuba', 0.16, 0.16, 0.03, 0, 0, 0.19, '#2b2b33', { emissive: '#f2a020', ei: 0.1, flat: true }),
      part('Habaki', 0.05, 0.1, 0.05, 0, 0, 0.23, '#f2c040', GOLD),
      part('Blade 1', 0.035, 0.09, 0.26, 0, 0, 0.38, '#e6edf5', { emissive: '#bfe2ff', ei: 0.15 }),
      part('Blade 2', 0.035, 0.085, 0.26, 0, 0.015, 0.63, '#e6edf5', { emissive: '#bfe2ff', ei: 0.15 }),
      part('Blade 3', 0.035, 0.08, 0.26, 0, 0.035, 0.88, '#e6edf5', { emissive: '#bfe2ff', ei: 0.15 }),
      part('Blade 4', 0.035, 0.07, 0.22, 0, 0.06, 1.11, '#e6edf5', { emissive: '#bfe2ff', ei: 0.15 }),
      part('Hamon', 0.02, 0.03, 0.92, 0, -0.04, 0.72, '#cfeaff', { glow: 2.2 }),
      part('Tip', 0.03, 0.05, 0.08, 0, 0.075, 1.25, '#e6edf5', { emissive: '#bfe2ff', ei: 0.15 }),
    ],
    stats: {
      comboWindow: 0.32, chainFrom: 0.58, finisherCd: 0.18, hitStop: 0.045, shockR: 2,
      swings: [sw(11, 0.3, 0.2, 0.3, 2.3, 150, 0.45, 0.5), sw(11, 0.3, 0.18, 0.3, 2.3, 150, 0.45, 0.5), sw(26, 0.5, 0.32, 0.18, 2.6, 80, 0.9, 1.2)],
      critChance: 0.15, critMult: 1.8, speed: 1, weight: 1.6,
    },
  },
  {
    id: 'nagakiba', title: t('Nagakiba'), category: 'katana', rarity: 'unique',
    description: t('A katana as long as a laundry pole: two-handed, outreaches the spear and cuts in a wide arc.'),
    bladeBase: 0.5, bladeTip: 2.28,
    model: [
      part('Grip', 0.065, 0.075, 0.46, 0, 0, 0.05, '#1e1a26'),
      part('Wrapping', 0.07, 0.08, 0.05, 0, 0, -0.08, '#3a5ab8', { flat: true }),
      part('Wrapping 2', 0.07, 0.08, 0.05, 0, 0, 0.1, '#3a5ab8', { flat: true }),
      part('Kashira', 0.075, 0.085, 0.05, 0, 0, -0.2, '#c9d2dc'),
      part('Tsuba', 0.2, 0.2, 0.035, 0, 0, 0.3, '#2b2b33', { emissive: '#7ad8ff', ei: 0.15, flat: true }),
      part('Habaki', 0.055, 0.11, 0.06, 0, 0, 0.35, '#c9d2dc'),
      part('Blade 1', 0.035, 0.09, 0.46, 0, 0, 0.6, '#e6edf5', { emissive: '#a8d8ff', ei: 0.15 }),
      part('Blade 2', 0.035, 0.085, 0.46, 0, 0.02, 1.05, '#e6edf5', { emissive: '#a8d8ff', ei: 0.15 }),
      part('Blade 3', 0.035, 0.08, 0.46, 0, 0.05, 1.5, '#e6edf5', { emissive: '#a8d8ff', ei: 0.15 }),
      part('Blade 4', 0.035, 0.07, 0.4, 0, 0.09, 1.93, '#e6edf5', { emissive: '#a8d8ff', ei: 0.15 }),
      part('Hamon', 0.02, 0.03, 1.72, 0, -0.035, 1.25, '#bfe2ff', { glow: 2.3 }),
      part('Tip', 0.03, 0.05, 0.1, 0, 0.12, 2.18, '#e6edf5', { emissive: '#a8d8ff', ei: 0.15 }),
    ],
    stats: {
      comboWindow: 0.38, chainFrom: 0.64, finisherCd: 0.28, hitStop: 0.06, shockR: 2.6,
      swings: [sw(15, 0.48, 0.24, 0.26, 3.3, 140, 0.4, 0.7), sw(15, 0.48, 0.22, 0.26, 3.3, 140, 0.4, 0.7), sw(34, 0.7, 0.36, 0.18, 3.6, 70, 0.9, 1.4)],
      critChance: 0.15, critMult: 1.8, speed: 1, weight: 4,
    },
  },
  {
    id: 'dragonslayer', title: t('Dragonslayer'), category: 'greatsword', rarity: 'unique',
    description: t('Too big to be called a sword: a slab of iron as tall as the hero. Slow, but sweeps away everything in front of it.'),
    bladeBase: 0.4, bladeTip: 2.05, trail: '#e8705a',
    model: [
      part('Grip', 0.08, 0.08, 0.44, 0, 0, 0.02, '#3a2a1e'),
      part('Wrap', 0.09, 0.09, 0.08, 0, 0, -0.1, '#5a4030'),
      part('Pommel', 0.12, 0.12, 0.08, 0, 0, -0.22, '#4a4e56'),
      part('Guard', 0.16, 0.42, 0.1, 0, 0, 0.26, '#4a4e56'),
      part('Blade', 0.11, 0.36, 1.72, 0, 0, 1.17, '#6e737c', { emissive: '#3a1a10', ei: 0.15 }),
      part('Fuller', 0.115, 0.06, 1.5, 0, 0.04, 1.12, '#4a4e56'),
      part('Notches', 0.116, 0.05, 0.2, 0, -0.16, 0.9, '#3a3e46'),
      part('Cutting edge', 0.03, 0.04, 1.6, 0, -0.19, 1.15, '#c9a090', { glow: 1.4 }),
      part('Cutting edge 2', 0.03, 0.04, 1.6, 0, 0.19, 1.15, '#c9a090', { glow: 1.4 }),
      part('End cap', 0.11, 0.36, 0.06, 0, 0, 2.06, '#5d626c'),
    ],
    stats: {
      comboWindow: 0.48, chainFrom: 0.72, finisherCd: 0.5, hitStop: 0.1, shockR: 3.6,
      swings: [sw(26, 0.85, 0.4, 0.22, 3, 200, 0.35, 2.2), sw(28, 0.85, 0.38, 0.22, 3, 200, 0.35, 2.2), sw(60, 1.2, 0.48, 0.16, 3.2, 120, 0.6, 3.4)],
      critChance: 0.08, critMult: 2, speed: 1, weight: 14,
    },
  },
  {
    id: 'pontiff', title: t('Pontiff blades'), category: 'dual blades', rarity: 'unique',
    description: t('The two swords of Pontiff Malivin: flame in the right hand, cold starlight in the left. A flurry of quick strikes with both hands.'),
    bladeBase: 0.2, bladeTip: 1.15, trail: '#ff6a1a', offTrail: '#8a6aff',
    model: [
      part('Grip', 0.06, 0.06, 0.22, 0, 0, 0.02, '#2a1a14'),
      part('Pommel', 0.08, 0.08, 0.08, 0, 0, -0.13, '#f2c040', GOLD),
      part('Guard', 0.3, 0.07, 0.07, 0, 0, 0.16, '#8a2a1a', { emissive: '#ff5a1a', ei: 0.4, flat: true }),
      part('Blade', 0.05, 0.12, 0.9, 0, 0, 0.65, '#ffd2a0', { emissive: '#ff7a2a', ei: 0.6 }),
      part('Flame', 0.025, 0.14, 0.86, 0, 0, 0.64, '#ff6a1a', { glow: 3 }),
      part('Tip', 0.04, 0.07, 0.07, 0, 0, 1.13, '#ffb060', { glow: 2.6 }),
    ],
    offhand: [
      part('Grip', 0.06, 0.06, 0.22, 0, 0, 0.02, '#1a1a2a'),
      part('Pommel', 0.08, 0.08, 0.08, 0, 0, -0.13, '#c9d2dc'),
      part('Guard', 0.3, 0.07, 0.07, 0, 0, 0.16, '#3a2a8a', { emissive: '#8a5cff', ei: 0.4, flat: true }),
      part('Blade', 0.05, 0.12, 0.9, 0, 0, 0.65, '#d8d0ff', { emissive: '#8a6aff', ei: 0.6 }),
      part('Light', 0.025, 0.14, 0.86, 0, 0, 0.64, '#8a6aff', { glow: 3 }),
      part('Tip', 0.04, 0.07, 0.07, 0, 0, 1.13, '#b8a8ff', { glow: 2.6 }),
    ],
    stats: {
      comboWindow: 0.32, chainFrom: 0.56, finisherCd: 0.18, hitStop: 0.04, shockR: 2.2,
      swings: [sw(9, 0.28, 0.18, 0.32, 2.0, 170, 0.35, 0.4), sw(9, 0.28, 0.16, 0.32, 2.0, 170, 0.35, 0.4), sw(22, 0.5, 0.3, 0.2, 2.3, 140, 0.6, 1.2)],
      critChance: 0.12, critMult: 1.6, speed: 1, weight: 3,
    },
  },
  {
    id: 'staff', title: t('Stargazer staff'), category: 'staff', rarity: 'rare',
    description: t('A long staff with a crystal: strikes from afar, the finisher releases a wave of light. Weapon art — star wave.'),
    bladeBase: 1.1, bladeTip: 1.5,
    model: [
      part('Shaft', 0.06, 0.06, 1.6, 0, 0, 0.4, '#7a5230'),
      part('Wrap', 0.07, 0.07, 0.14, 0, 0, 0, '#3a5ab8'),
      part('Butt cap', 0.08, 0.08, 0.06, 0, 0, -0.42, '#f2c040', GOLD),
      part('Mount', 0.14, 0.14, 0.06, 0, 0, 1.2, '#f2c040', GOLD),
      part('Prong ←', 0.03, 0.03, 0.22, 0.08, 0, 1.33, '#f2c040', GOLD),
      part('Prong →', 0.03, 0.03, 0.22, -0.08, 0, 1.33, '#f2c040', GOLD),
      part('Crystal', 0.12, 0.12, 0.24, 0, 0, 1.36, '#7ad8ff', { glow: 3 }),
      part('Star', 0.05, 0.05, 0.05, 0, 0, 1.52, '#fff2a0', { glow: 3.4 }),
    ],
    stats: {
      comboWindow: 0.38, chainFrom: 0.62, finisherCd: 0.25, hitStop: 0.05, shockR: 3,
      swings: [sw(10, 0.4, 0.24, 0.3, 2.6, 160, 0.3, 0.8), sw(10, 0.4, 0.22, 0.3, 2.6, 160, 0.3, 0.8), sw(24, 0.6, 0.36, 0.2, 2.8, 100, 0.5, 1.6)],
      critChance: 0.08, critMult: 1.6, speed: 1, weight: 2.2,
    },
  },
  {
    id: 'halberd', title: t('Guard halberd'), category: 'halberd', rarity: 'rare',
    description: t('An axe on a long shaft with a pike: chops from afar in a wide arc. Weapon art — a windmill with a step forward.'),
    bladeBase: 1.45, bladeTip: 2.0,
    model: [
      part('Shaft', 0.065, 0.065, 2, 0, 0, 0.6, '#6e4a2a'),
      part('Wrap', 0.075, 0.075, 0.16, 0, 0, 0, '#3a2414'),
      part('Butt cap', 0.08, 0.08, 0.08, 0, 0, -0.42, '#8a8f99'),
      part('Socket', 0.1, 0.1, 0.14, 0, 0, 1.55, '#f2c040', GOLD),
      part('Edge', 0.05, 0.36, 0.38, 0, -0.22, 1.72, '#c9d2dc', { emissive: '#9ac8ff', ei: 0.1 }),
      part('Cutting edge', 0.02, 0.06, 0.4, 0, -0.42, 1.72, '#bfe2ff', { glow: 2.2 }),
      part('Beak', 0.05, 0.16, 0.1, 0, 0.15, 1.72, '#8e97a3'),
      part('Pike', 0.05, 0.08, 0.36, 0, 0, 2.02, '#dfe8f2', { emissive: '#7ad8ff', ei: 0.15 }),
    ],
    stats: {
      comboWindow: 0.4, chainFrom: 0.66, finisherCd: 0.3, hitStop: 0.07, shockR: 2.6,
      swings: [sw(14, 0.5, 0.26, 0.28, 3.1, 120, 0.4, 1.1), sw(14, 0.5, 0.24, 0.28, 3.1, 120, 0.4, 1.1), sw(32, 0.72, 0.38, 0.2, 3.3, 90, 0.7, 2.0)],
      critChance: 0.08, critMult: 1.6, speed: 1, weight: 5,
    },
  },
  {
    id: 'rapier', title: t('Duellist rapier'), category: 'rapier', rarity: 'common',
    description: t('A thin long blade: lightning-fast thrusts in a narrow cone and frequent crits. Weapon art — a flurry of thrusts.'),
    bladeBase: 0.24, bladeTip: 1.26,
    model: [
      part('Grip', 0.05, 0.05, 0.2, 0, 0, 0, '#3a2a40'),
      part('Pommel', 0.07, 0.07, 0.07, 0, 0, -0.12, '#f2c040', GOLD),
      part('Cup', 0.18, 0.18, 0.05, 0, 0, 0.13, '#f2c040', GOLD),
      part('Knuckle bow', 0.03, 0.03, 0.16, 0, -0.1, 0.06, '#f2c040', GOLD),
      part('Blade', 0.025, 0.04, 1.06, 0, 0, 0.7, '#e6edf5', { emissive: '#bfe2ff', ei: 0.2 }),
      part('Edge', 0.012, 0.045, 0.98, 0, 0, 0.7, '#cfeaff', { glow: 2.2 }),
    ],
    stats: {
      comboWindow: 0.3, chainFrom: 0.55, finisherCd: 0.15, hitStop: 0.035, shockR: 1.6,
      swings: [sw(8, 0.26, 0.2, 0.3, 2.6, 40, 0.5, 0.3), sw(8, 0.26, 0.18, 0.3, 2.6, 40, 0.5, 0.3), sw(20, 0.42, 0.3, 0.2, 2.9, 30, 1.0, 0.8)],
      critChance: 0.25, critMult: 2, speed: 1, weight: 1,
    },
  },
  {
    id: 'knuckles', title: t('Blacksmith knuckles'), category: 'knuckles', rarity: 'common',
    description: t('A knuckle-duster on each hand: very fast close strikes, the finisher is an uppercut with a wave.'),
    bladeBase: 0.02, bladeTip: 0.2, trail: '#ffb347', offTrail: '#ffb347',
    model: [
      part('Band', 0.24, 0.16, 0.16, 0, 0, 0.06, '#8a8f99'),
      part('Knuckles', 0.26, 0.08, 0.08, 0, 0, 0.17, '#c9d2dc', { emissive: '#ffb347', ei: 0.3 }),
      part('Rune', 0.06, 0.04, 0.03, 0, 0, 0.22, '#ffb347', { glow: 2.6 }),
    ],
    offhand: [
      part('Band', 0.24, 0.16, 0.16, 0, 0, 0.06, '#8a8f99'),
      part('Knuckles', 0.26, 0.08, 0.08, 0, 0, 0.17, '#c9d2dc', { emissive: '#ffb347', ei: 0.3 }),
      part('Rune', 0.06, 0.04, 0.03, 0, 0, 0.22, '#ffb347', { glow: 2.6 }),
    ],
    stats: {
      comboWindow: 0.3, chainFrom: 0.52, finisherCd: 0.15, hitStop: 0.04, shockR: 2,
      swings: [sw(7, 0.22, 0.2, 0.3, 1.5, 110, 0.35, 0.6), sw(7, 0.22, 0.18, 0.3, 1.5, 110, 0.35, 0.6), sw(18, 0.42, 0.3, 0.2, 1.7, 90, 0.6, 1.8)],
      critChance: 0.1, critMult: 1.6, speed: 1, weight: 1.2,
    },
  },
];

// ---------- storage ----------

const KEY = 'malina.weapons';
const KEY_ACTIVE = 'malina.weapon';
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
const defaultOf = (id: string): WeaponDef | undefined => DEFAULT_WEAPONS.find((w) => w.id === id);

/** Saved on top of a default: missing fields come from the default (or from the sword) */
function merge(saved: Partial<WeaponDef>, base: WeaponDef): WeaponDef {
  const st = { ...base.stats, ...(saved.stats ?? {}) } as WeaponStats;
  const sws = Array.isArray(saved.stats?.swings) ? saved.stats.swings : base.stats.swings;
  st.swings = [0, 1, 2].map((i) => ({ ...base.stats.swings[i], ...(sws[i] ?? {}) }));
  return { ...clone(base), ...saved, stats: clone(st), model: clone(Array.isArray(saved.model) ? saved.model : base.model) } as WeaponDef;
}

let cache: WeaponDef[] | null = null;

/** All weapons: defaults with edits plus custom ones (duplicates) */
export function loadWeapons(): WeaponDef[] {
  let saved: Record<string, Partial<WeaponDef>> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Partial<WeaponDef>>; } catch { /* no storage */ }
  const list = DEFAULT_WEAPONS.map((d) => (saved[d.id] ? merge(saved[d.id], d) : clone(d)));
  for (const [id, w] of Object.entries(saved)) if (!defaultOf(id) && w) list.push(merge({ ...w, id }, DEFAULT_WEAPONS[0]));
  cache = list;
  return list;
}

/** Current list (loaded once) */
export function weapons(): WeaponDef[] { return cache ?? loadWeapons(); }

export function getWeapon(id: string): WeaponDef | undefined { return weapons().find((w) => w.id === id); }

export function isDefaultWeapon(id: string): boolean { return !!defaultOf(id); }

/** Save the differences from the defaults and the custom weapons */
export function saveWeapons(list: WeaponDef[] = weapons()): void {
  const out: Record<string, WeaponDef> = {};
  for (const w of list) {
    const d = defaultOf(w.id);
    if (!d || JSON.stringify(d) !== JSON.stringify(w)) out[w.id] = w;
  }
  try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* full or closed storage */ }
  const act = getWeapon(activeWeaponId());
  if (act) emit(act);
}

/** Restore the default numbers and model; for a custom weapon — nothing */
export function resetWeapon(id: string): WeaponDef | undefined {
  const d = defaultOf(id), list = weapons(), i = list.findIndex((w) => w.id === id);
  if (!d || i < 0) return list[i];
  list[i] = clone(d);
  saveWeapons(list);
  return list[i];
}

/** A copy with a new id right after the original */
export function duplicateWeapon(id: string): WeaponDef | undefined {
  const list = weapons(), i = list.findIndex((w) => w.id === id);
  if (i < 0) return undefined;
  let n = 2, nid = `${id}-${n}`;
  while (list.some((w) => w.id === nid)) nid = `${id}-${++n}`;
  const w: WeaponDef = { ...clone(list[i]), id: nid, title: `${list[i].title} ${n}` };
  list.splice(i + 1, 0, w);
  saveWeapons(list);
  return w;
}

/** Delete a custom weapon (defaults cannot be deleted) */
export function deleteWeapon(id: string): boolean {
  const list = weapons(), i = list.findIndex((w) => w.id === id);
  if (i < 0 || defaultOf(id)) return false;
  list.splice(i, 1);
  if (activeWeaponId() === id) setActiveWeapon(DEFAULT_WEAPONS[0].id);
  saveWeapons(list);
  return true;
}

export function activeWeaponId(): string {
  try { return localStorage.getItem(KEY_ACTIVE) ?? DEFAULT_WEAPONS[0].id; } catch { return DEFAULT_WEAPONS[0].id; }
}

export function setActiveWeapon(id: string): void {
  try { localStorage.setItem(KEY_ACTIVE, id); } catch { /* no storage — this tab only */ }
  const w = getWeapon(id);
  if (w) emit(w);
}

/** Weapon at startup: ?weapon=<id>, else the active one from storage, else the sword */
export function pickWeapon(): WeaponDef {
  const q = new URLSearchParams(window.location.search).get('weapon');
  return (q && getWeapon(q)) || getWeapon(activeWeaponId()) || weapons()[0];
}

// ---------- subscription: the active weapon was changed or edited (in this tab or another) ----------

const listeners = new Set<(w: WeaponDef) => void>();
let storageHooked = false;
function emit(w: WeaponDef): void { for (const f of listeners) f(w); }

/** The active weapon was changed or edited; the return value unsubscribes */
export function onWeaponChange(f: (w: WeaponDef) => void): () => void {
  listeners.add(f);
  if (!storageHooked) {
    storageHooked = true;
    window.addEventListener('storage', (e) => {
      if (e.key !== KEY && e.key !== KEY_ACTIVE) return;
      loadWeapons();
      const w = getWeapon(activeWeaponId());
      if (w) emit(w);
    });
  }
  return () => { listeners.delete(f); };
}

// ---------- game ----------

/** Write the weapon numbers into SWORD (or into another hero's strike numbers, Knight.tune) — the hero and the scene read them */
export function applyWeapon(def: WeaponDef, into: typeof SWORD = SWORD): void {
  const s = def.stats, sp = s.speed > 0 ? s.speed : 1;
  into.comboWindow = s.comboWindow;
  into.chainFrom = s.chainFrom;
  into.finisherCd = s.finisherCd / sp;
  into.hitStop = s.hitStop;
  into.shockR = s.shockR;
  for (let i = 0; i < 3; i++) {
    const src = { ...s.swings[i], time: s.swings[i].time / sp };
    if (into.swings[i]) Object.assign(into.swings[i], src); else into.swings[i] = src;
  }
}

/** Blade trail segment along the hand's Z */
export function bladeOf(def: WeaponDef): { base: number; tip: number } {
  const far = def.model.reduce((m, p) => Math.max(m, p.z + p.d / 2), 0.4);
  return { base: def.bladeBase ?? 0.22, tip: def.bladeTip ?? far - 0.04 };
}

const texCache = new Map<string, THREE.CanvasTexture>();
function texOf(color: string): THREE.CanvasTexture {
  let t = texCache.get(color);
  if (!t) { t = pixelTex(color, 6, 78 + texCache.size); texCache.set(color, t); }
  return t;
}

function materialOf(p: WeaponPart): THREE.Material {
  if (p.glow) return new THREE.MeshBasicMaterial({ color: new THREE.Color(p.color).multiplyScalar(p.glow), toneMapped: false });
  const o: THREE.MeshLambertMaterialParameters = p.flat ? { color: p.color } : { map: texOf(p.color) };
  if (p.emissive) { o.emissive = p.emissive; o.emissiveIntensity = p.ei ?? 0.2; }
  return new THREE.MeshLambertMaterial(o);
}

/** Box model in the hand frame: grip at 0, blade along +Z; offhand — the second weapon (left hand) */
export function buildWeaponModel(def: WeaponDef, offhand = false): THREE.Group {
  const g = new THREE.Group();
  g.name = def.id;
  for (const p of (offhand ? def.offhand : def.model) ?? []) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.d), materialOf(p));
    m.position.set(p.x, p.y, p.z);
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = p.name ?? '';
    g.add(m);
  }
  const b = offhand ? { base: def.bladeBase ?? 0.22, tip: (def.offhand ?? []).reduce((m, p) => Math.max(m, p.z + p.d / 2), 0.2) - 0.04 } : bladeOf(def);
  g.userData.bladeBase = b.base;
  g.userData.bladeTip = b.tip;
  return g;
}

/** Free the model's geometry and materials (textures are shared — they stay) */
export function disposeWeaponModel(o: THREE.Object3D): void {
  o.traverse((c) => {
    if (!(c instanceof THREE.Mesh)) return;
    c.geometry.dispose();
    for (const m of Array.isArray(c.material) ? c.material : [c.material]) (m as THREE.Material).dispose();
  });
}

// ---------- balance ----------

export interface WeaponMetrics {
  /** Damage of the three strikes without crits */
  comboDmg: number;
  /** Combo cycle when held: two strikes up to the chain point, the full finisher and the pause, s */
  comboTime: number;
  /** Average multiplier from crits */
  critFactor: number;
  /** Damage per second with crits, on a single target */
  dps: number;
  /** From the press to the first hit, s */
  firstHit: number;
  /** Average and greatest (with lunge) reach, m */
  avgReach: number;
  maxReach: number;
  /** Average strike area (arc × reach; for the finisher — no less than the wave), m² */
  coverage: number;
  /** Shockwave area, m² */
  shockArea: number;
  /** Strength compared with the warden sword = 100 */
  score: number;
  /** Area and damage share of each strike */
  swings: { area: number; time: number; share: number }[];
}

function raw(def: WeaponDef): Omit<WeaponMetrics, 'score'> {
  const s = def.stats, sp = s.speed > 0 ? s.speed : 1, W = s.swings;
  const t = W.map((x) => x.time / sp);
  const comboTime = (t[0] + t[1]) * s.chainFrom + t[2] + s.finisherCd / sp;
  const comboDmg = W.reduce((a, x) => a + x.dmg, 0);
  const critFactor = 1 + s.critChance * (s.critMult - 1);
  const shockArea = Math.PI * s.shockR ** 2;
  const areas = W.map((x, i) => {
    const sector = 0.5 * x.range ** 2 * THREE.MathUtils.degToRad(x.arc);
    return i === 2 ? Math.max(sector, shockArea) : sector;
  });
  return {
    comboDmg, comboTime, critFactor, shockArea,
    dps: comboTime > 0 ? (comboDmg * critFactor) / comboTime : 0,
    firstHit: t[0] * (W[0].windup + W[0].strike / 2),
    avgReach: W.reduce((a, x) => a + x.range, 0) / 3,
    maxReach: Math.max(...W.map((x) => x.range + x.lunge)),
    coverage: areas.reduce((a, x) => a + x, 0) / 3,
    swings: W.map((x, i) => ({ area: areas[i], time: t[i], share: comboDmg > 0 ? x.dmg / comboDmg : 0 })),
  };
}

let REF: Omit<WeaponMetrics, 'score'> | null = null;

/** Derived balance numbers */
export function weaponMetrics(def: WeaponDef): WeaponMetrics {
  REF ??= raw(DEFAULT_WEAPONS[0]);
  const m = raw(def);
  const k = (a: number, b: number, p: number): number => (a > 0 && b > 0 ? (a / b) ** p : 0);
  const score = 100 * k(m.dps, REF.dps, 0.6) * k(m.coverage, REF.coverage, 0.25) * k(m.avgReach, REF.avgReach, 0.15);
  return { ...m, score };
}
