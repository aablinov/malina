import { t } from '../i18n/i18n.ts';
import { mapByName } from '../level/maps.ts';
import type { TdSpec } from '../td/types.ts';

/**
 * Bush Defence maps offered in the camp (wiki/design-main-menu.md), in order of difficulty.
 * Waves, treasury and bush health come from the maps' own `meta.td`; only what the map lacks lives here.
 */
export interface CampaignMap {
  /** Map name in assets/maps/ — also the `?map=` value */
  id: string;
  title: string;
  /** Difficulty 1..3 */
  difficulty: 1 | 2 | 3;
  blurb: string;
  /** Card background — biome colours */
  bg: string;
  icon: string;
  waves: number;
  lanes: number;
  bush: number;
  berries: number;
}

const DIFFICULTY = ['', t('Easy'), t('Medium'), t('Hard')];
export const difficultyTitle = (d: number): string => DIFFICULTY[d] ?? '';

const BASE: Omit<CampaignMap, 'waves' | 'lanes' | 'bush' | 'berries'>[] = [
  { id: 'td', title: t('Lava Basin'), difficulty: 1, icon: 'fireball', bg: 'linear-gradient(160deg, #6b2414, #2b1210 70%)',
    blurb: t('A raspberry bush among lava rifts. Three roads lead from the caves over bridges — build towers by the bridges.') },
  { id: 'td2', title: t('Crystal Glade'), difficulty: 2, icon: 'spark', bg: 'linear-gradient(160deg, #134a5c, #101d2e 70%)',
    blurb: t('Night, blue portals and moats. Shellbacks shrug off hits, sporelings heal their neighbours, hoppers leap along the road.') },
  { id: 'td3', title: t('Castle on the Meadow'), difficulty: 3, icon: 'helmet', bg: 'linear-gradient(160deg, #3c5a24, #1d2616 70%)',
    blurb: t('A siege from four sides. Sappers break walls, ballistae break the gate; repair the breaches and hold the courtyard.') },
];

export const CAMPAIGN: readonly CampaignMap[] = BASE.map((b) => {
  const td = mapByName(b.id)?.meta?.td as TdSpec | undefined;
  return { ...b, waves: td?.waves?.length ?? 0, lanes: td?.lanes.length ?? 0, bush: td?.bush.hp ?? 0, berries: td?.berries ?? 0 };
});

export const campaignMap = (id: string): CampaignMap => CAMPAIGN.find((m) => m.id === id) ?? CAMPAIGN[0];
