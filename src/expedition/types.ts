import type { MobRoomSpec } from '../level/playground-map.ts';

/**
 * Expedition (wiki/design-expeditions.md): what a mission is and what the generator (src/level/expedition-map.ts) laid on its map.
 * The description lives in the level's `meta.expedition`; the server and the client build the same level from the same parameters
 */

export type ObjectiveKind = 'lairs' | 'beacons' | 'bush';
export const OBJECTIVES: readonly ObjectiveKind[] = ['lairs', 'beacons', 'bush'];
export type SecondaryKind = 'chest' | 'altar' | 'watchtower' | 'horns';
export type SeedRarity = 'common' | 'rare' | 'golden';

/** What a mission is generated from: the same values give the same map everywhere */
export interface ExpeditionParams {
  seed: number;
  /** 1–8: more lairs and guards, tougher kinds, rarer seeds */
  difficulty: number;
  objective: ObjectiveKind;
}

export interface ExpSite { id: string; x: number; z: number }
/** Enemy lair: 1 — small, 2 — medium, 3 — large */
export interface ExpLair extends ExpSite { size: 1 | 2 | 3 }
/** Point of interest: raspberries and maybe a seed */
export interface ExpPoi extends ExpSite { berries: number; seed: SeedRarity | null }
export interface ExpSecondary extends ExpSite { kind: SecondaryKind }

export interface ExpeditionSpec {
  seed: number;
  difficulty: number;
  /** The map is a square from −half to half */
  half: number;
  /** Pack level of the garrisons */
  level: number;
  /** Where the squad may land */
  landings: ExpSite[];
  extraction: ExpSite;
  /** Primary objective: burn the lairs at `sites`, light the beacons there, or plant the bush on the plot */
  objective: { kind: ObjectiveKind; sites: ExpSite[] };
  secondary: ExpSecondary[];
  lairs: ExpLair[];
  pois: ExpPoi[];
  /** Guards at posts and patrols between lairs (src/sim/garrison.ts) */
  garrisons: MobRoomSpec[];
}
