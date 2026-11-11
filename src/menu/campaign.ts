import { missionId, parseMission, type Mission } from '../expedition/mission.ts';
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
  /** Endless waves (Misty Clearing): no victory, the record counts */
  endless: boolean;
  /** An expedition mission (src/expedition/mission.ts): the id is the mission itself */
  mission?: Mission;
}

const DIFFICULTY = ['', t('Easy'), t('Medium'), t('Hard')];
export const difficultyTitle = (d: number): string => DIFFICULTY[d] ?? '';

const BASE: Omit<CampaignMap, 'waves' | 'lanes' | 'bush' | 'berries' | 'endless'>[] = [
  { id: 'td', title: t('Lava Basin'), difficulty: 1, icon: 'fireball', bg: 'linear-gradient(160deg, #6b2414, #2b1210 70%)',
    blurb: t('A raspberry bush among lava rifts. Three roads lead from the caves over bridges — build towers by the bridges.') },
  { id: 'td2', title: t('Crystal Glade'), difficulty: 2, icon: 'spark', bg: 'linear-gradient(160deg, #134a5c, #101d2e 70%)',
    blurb: t('Night, blue portals and moats. Shellbacks shrug off hits, sporelings heal their neighbours, hoppers leap along the road.') },
  { id: 'td4', title: t('Raspberry Spiral'), difficulty: 2, icon: 'spiral', bg: 'linear-gradient(160deg, #5a2a7a, #1c1036 70%)',
    blurb: t('A floating island at dusk. One road winds up to the raspberry plateau — towers on the ridge reach two turns at once. The Golden Warden and the Frost Queen lead the last wave.') },
  { id: 'td5', title: t('Misty Clearing'), difficulty: 2, icon: 'spark', bg: 'linear-gradient(160deg, #3a2a5e, #0d0a18 70%)',
    blurb: t('Night, no roads, mist all around. The Order steps out of it from any side, wave after wave without end. Light the lanterns to push the mist back; the beacon over the bush sweeps its beam.') },
  { id: 'td3', title: t('Castle on the Meadow'), difficulty: 3, icon: 'helmet', bg: 'linear-gradient(160deg, #3c5a24, #1d2616 70%)',
    blurb: t('A siege from four sides. Sappers break walls, ballistae break the gate; repair the breaches and hold the courtyard.') },
];

export const CAMPAIGN: readonly CampaignMap[] = BASE.map((b) => {
  const td = mapByName(b.id)?.meta?.td as TdSpec | undefined;
  return { ...b, endless: !!td?.endless, waves: td?.waves?.length ?? 0, lanes: td?.lanes.length ?? 0, bush: td?.bush.hp ?? 0, berries: td?.berries ?? 0 };
});

const MISSION_TITLE = { lairs: t('Burn the lairs'), beacons: t('Light the beacons'), bush: t('Plant the raspberry bush') };
const MISSION_ICON = { lairs: 'axe', beacons: 'spark', bush: 'berry' };
const MISSION_BG = { lairs: 'linear-gradient(160deg, #5c2338, #20121c 70%)', beacons: 'linear-gradient(160deg, #6a4a16, #24190c 70%)', bush: 'linear-gradient(160deg, #2c5a2a, #132016 70%)' };

/** A mission as a map of the camp: its title, colours and icon — for room lists, the start button, the battle menu */
function missionMap(m: Mission): CampaignMap {
  return {
    id: missionId(m), title: `${t('Expedition')}: ${MISSION_TITLE[m.objective]}`, difficulty: m.difficulty <= 2 ? 1 : m.difficulty <= 5 ? 2 : 3, blurb: '',
    bg: MISSION_BG[m.objective], icon: MISSION_ICON[m.objective], waves: 0, lanes: 0, bush: 0, berries: 0, endless: false, mission: m,
  };
}

/** A Bush Defence map of the camp or a mission by its id; unknown — the first map */
export const campaignMap = (id: string): CampaignMap => { const m = parseMission(id); return m ? missionMap(m) : (CAMPAIGN.find((x) => x.id === id) ?? CAMPAIGN[0]); };
