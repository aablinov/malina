/**
 * Bush Defence tower kinds (wiki/design-tower-defence.md, section 3). Numbers are per level; an upgrade (up to III)
 * multiplies damage by UPGRADE_DMG and adds UPGRADE_RANGE to the range. Upgrade price is a fraction of the build price.
 */

import { t } from '../i18n/i18n.ts';

export type TowerKind = 'arrow' | 'frost' | 'splash' | 'fire' | 'magic' | 'meteor' | 'storm' | 'winter' | 'ballista' | 'oil';

export interface TowerDef {
  id: TowerKind;
  title: string;
  /** What it hits with — a short line in the menu */
  hint: string;
  cost: number;
  range: number;
  /** Cooldown, s */
  cd: number;
  dmg: number;
  /** Tower colour in the menu and in its light, CSS */
  color: string;
  /** Durability at level I: tower hunters gnaw it (src/mobs/td-foes.ts); zero — the tower is in ruins */
  hp: number;
  /** What the upgrade to II and to III adds besides damage and range — a line on the upgrade card */
  perks: [string, string];
  /** A glyph for the tower tile in the HUD (src/cgame/td-ui.ts) */
  glyph: string;
}

export const TOWERS: Record<TowerKind, TowerDef> = {
  arrow: { id: 'arrow', title: t('Archer tower'), hint: t('quick bolts, one at a time'), cost: 60, range: 9, cd: 0.4, dmg: 6, color: '#d8b872', hp: 120, glyph: '➶', perks: [t('every third bolt is a heavy one: ×2 damage'), t('a volley: two more bolts at the next enemies')] },
  frost: { id: 'frost', title: t('Frost spire'), hint: t('a freezing ray: the longer it holds, the slower the enemy'), cost: 80, range: 8, cd: 0.25, dmg: 2, color: '#7ad8ff', hp: 140, glyph: '❄', perks: [t('the ray chills to the limit twice as fast'), t('a second ray; a fully chilled enemy freezes solid')] },
  splash: { id: 'splash', title: t('Catapult'), hint: t('a rock over an area'), cost: 110, range: 11, cd: 2.4, dmg: 26, color: '#c88a5a', hp: 160, glyph: '●', perks: [t('a bigger blast: 3 m'), t('the blast stuns those near its centre')] },
  fire: { id: 'fire', title: t('Fire brazier'), hint: t('a jet of flame, sets on fire'), cost: 100, range: 6, cd: 0.9, dmg: 10, color: '#ff8a3a', hp: 150, glyph: '♨', perks: [t('enemies burn longer: 5 s'), t('a much wider jet of flame')] },
  magic: { id: 'magic', title: t('Arcane obelisk'), hint: t('a tether of magic: drains harder the longer it holds, weakens'), cost: 130, range: 10, cd: 0.25, dmg: 3, color: '#c48aff', hp: 140, glyph: '◆', perks: [t('a second tether at another enemy'), t('a third tether')] },
  // wiki section 14: expensive area towers, on every map
  meteor: { id: 'meteor', title: t('Stargazer'), hint: t('a meteor into the thick of the crowd: 4.5 m blast, sets on fire'), cost: 500, range: 14, cd: 4.5, dmg: 150, color: '#ffb84a', hp: 220, glyph: '★', perks: [t('enemies burn longer: 5 s'), t('a 5.5 m blast that stuns')] },
  storm: { id: 'storm', title: t('Storm spire'), hint: t('chain lightning: 6 enemies, 8 at II, 10 at III'), cost: 350, range: 11, cd: 1.8, dmg: 40, color: '#7ab8ff', hp: 180, glyph: 'ϟ', perks: [t('the lightning jumps to 8 enemies'), t('the lightning jumps to 10 enemies')] },
  winter: { id: 'winter', title: t('Heart of winter'), hint: t('a blizzard around: damage and −50 % to all, an ice wave'), cost: 400, range: 7, cd: 1, dmg: 12, color: '#bfeaff', hp: 200, glyph: '✻', perks: [t('the ice wave comes every fourth hit'), t('the ice wave freezes for 1.8 s')] },
  // siege (wiki section 9): only on maps with `meta.td.towers`
  ballista: { id: 'ballista', title: t('Wall ballista'), hint: t('a heavy bolt through the ranks, pierces armour'), cost: 120, range: 14, cd: 2.2, dmg: 45, color: '#b8a070', hp: 200, glyph: '➳', perks: [t('the bolt loses no damage on the way through'), t('the bolt staggers everyone it passes')] },
  oil: { id: 'oil', title: t('Tar cauldron'), hint: t('a pool of tar: they get stuck and burn'), cost: 90, range: 6, cd: 3.5, dmg: 7, color: '#5a3a1a', hp: 160, glyph: '◉', perks: [t('a wider pool of tar'), t('an even wider pool of tar')] },
};

/** Menu order; the first eight are available everywhere; ballista and cauldron — where the map allows (`meta.td.towers`) */
export const TOWER_ORDER: TowerKind[] = ['arrow', 'frost', 'splash', 'fire', 'magic', 'meteor', 'storm', 'winter', 'ballista', 'oil'];
/** How many kinds from TOWER_ORDER are available on a map without `meta.td.towers` */
export const BASE_TOWERS = 8;
/** Card key in the pad menu — by position in the map's list: 1…9, 0 */
export const menuKey = (i: number): string => String((i + 1) % 10);

/** Height of the turning head above the pad at level I, m: the model (src/cgame/views/tower-view.ts) and the muzzle (src/sim/tower.ts) agree on it */
export const HEAD_Y: Record<TowerKind, number> = { arrow: 2.3, frost: 2.2, splash: 1.3, fire: 1.6, magic: 2.4, meteor: 2.5, storm: 2.8, winter: 2.2, ballista: 1.0, oil: 1.2 };
/** Each level the tower body grows by this much, m */
export const LEVEL_RISE = 0.35;

export const MAX_LEVEL = 3;
/** Damage per level: I ×1, II ×1.6, III ×2.4 */
export const UPGRADE_DMG = [1, 1.6, 2.4];
export const UPGRADE_RANGE = [0, 1, 2];
/** Upgrade price — a fraction of the build price */
export const UPGRADE_COST = [0, 0.7, 1.0];
/** Durability per level: II ×1.3, III ×1.69 */
export const UPGRADE_HP = 1.3;
/** Repairing ruins — a fraction of everything invested */
export const REPAIR_COST = 0.4;
/** Sell-back — a fraction of everything invested */
export const SELL_BACK = 0.7;

export const upgradeCost = (def: TowerDef, toLevel: number): number => Math.round(def.cost * UPGRADE_COST[toLevel - 1]);
