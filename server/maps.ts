import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_DIFFICULTY, parseMission } from '../src/expedition/mission.ts';
import { expeditionMap } from '../src/level/expedition-map.ts';
import { Level, type LevelJSON } from '../src/level/level.ts';
import type { LibraryPrefab } from '../src/level/prefab-lib/types.ts';
import { loadPrefabs } from './prefabs.ts';
import { crowdMult, lootK, MAX_RATING } from '../src/td/scaling.ts';
import type { MatchMap } from '../src/sim/rules.ts';
import type { TdSpec } from '../src/td/types.ts';

/**
 * Multiplayer maps — Bush Defence maps from assets/maps (they have `meta.td`, src/td/types.ts) and expedition missions, whose
 * name is the mission itself (`exp:…`, src/expedition/mission.ts) and whose level is built from it on demand.
 * The server reads the files once: which maps can be chosen in a room and how many raspberries per battle is plausible
 */
export interface NetMap { id: string; waves: number; bounty: number; berries: number }

/** Seeds of one rarity per hero per mission — a cap against bugs: a map holds at most ten points of interest */
export const MAX_SEEDS_PER_MATCH = 12;
/** Steps of a mission's objective never exceed this (lairs, beacons, waves) */
const MISSION_STEPS = 8;

/** More XP per battle than this — we do not trust the host */
export const MAX_XP_PER_MATCH = 50_000;

export class MapCatalog {
  private readonly maps = new Map<string, NetMap>();
  private readonly dir: string;
  private readonly prefabs: Record<string, LibraryPrefab>;

  constructor(dir: string) {
    this.dir = dir;
    // the prefab library lies next to the maps; without it missions are built with plain trees
    let lib: Record<string, LibraryPrefab> = {};
    try { lib = loadPrefabs(join(dir, '..', 'prefabs')); } catch { /* no library */ }
    this.prefabs = lib;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const td = (JSON.parse(readFileSync(join(dir, f), 'utf8')) as { meta?: { td?: { berries?: number; endless?: boolean; waves?: { bounty?: number }[] } } }).meta?.td;
        if (!td?.waves) continue;
        const id = f.slice(0, -5);
        // endless (Misty Clearing): the map bakes ten waves; a long run lasts several times more and the bounties grow — the cap is ×6
        const bounty = td.waves.reduce((a, w) => a + (w.bounty ?? 0), 0) * (td.endless ? 6 : 1);
        this.maps.set(id, { id, waves: td.waves.length, bounty, berries: td.berries ?? 0 });
      } catch { /* broken map file — not a multiplayer map */ }
    }
  }

  has(id: string): boolean { return this.maps.has(id) || parseMission(id) !== null; }
  ids(): string[] { return [...this.maps.keys()].sort(); }

  /**
   * Maximum loot per hero per battle — a cap against bugs, not balance: the share of the wave bounties with the victory bonus is ~0.4 of them,
   * enemies give about as much again (more with the party — more enemies); all wave bounties with the party multiplier times two is ample
   */
  maxBerries(id: string, players: number): number {
    // a mission: every enemy and point of interest, the objective and the boarding share stay far below this
    const mission = parseMission(id);
    if (mission) return Math.ceil(1500 * (1 + mission.difficulty / MAX_DIFFICULTY) * crowdMult(players) * lootK(MAX_RATING));
    const m = this.maps.get(id);
    return m ? Math.ceil(m.bounty * crowdMult(players) * 2 * lootK(MAX_RATING)) : 0;
  }

  waves(id: string): number { return parseMission(id) ? MISSION_STEPS : (this.maps.get(id)?.waves ?? 0); }

  /** Map level for a server-side battle (each match gets its own, walls break blocks); null — no such map */
  load(id: string): MatchMap | null {
    const mission = parseMission(id);
    if (mission) return expeditionMap(mission, this.prefabs);
    if (!this.maps.has(id)) return null;
    const j = JSON.parse(readFileSync(join(this.dir, `${id}.json`), 'utf8')) as LevelJSON;
    const level = Level.fromJSON(j);
    return { level, mode: { kind: 'td', td: level.meta.td as TdSpec } };
  }
}
