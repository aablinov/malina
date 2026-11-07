import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Level, type LevelJSON } from '../src/level/level.ts';
import { crowdMult } from '../src/td/scaling.ts';
import type { TdSpec } from '../src/td/types.ts';

/**
 * Multiplayer maps — Bush Defence maps from assets/maps (they have `meta.td`, src/td/types.ts).
 * The server reads them once: which maps can be chosen in a room and how many raspberries per battle is plausible
 */
export interface NetMap { id: string; waves: number; bounty: number; berries: number }

/** More XP per battle than this — we do not trust the host */
export const MAX_XP_PER_MATCH = 50_000;

export class MapCatalog {
  private readonly maps = new Map<string, NetMap>();
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const td = (JSON.parse(readFileSync(join(dir, f), 'utf8')) as { meta?: { td?: { berries?: number; waves?: { bounty?: number }[] } } }).meta?.td;
        if (!td?.waves) continue;
        const id = f.slice(0, -5);
        this.maps.set(id, { id, waves: td.waves.length, bounty: td.waves.reduce((a, w) => a + (w.bounty ?? 0), 0), berries: td.berries ?? 0 });
      } catch { /* broken map file — not a multiplayer map */ }
    }
  }

  has(id: string): boolean { return this.maps.has(id); }
  ids(): string[] { return [...this.maps.keys()].sort(); }

  /**
   * Maximum loot per hero per battle — a cap against bugs, not balance: the share of the wave bounties with the victory bonus is ~0.4 of them,
   * enemies give about as much again (more with the party — more enemies); all wave bounties with the party multiplier times two is ample
   */
  maxBerries(id: string, players: number): number {
    const m = this.maps.get(id);
    return m ? Math.ceil(m.bounty * crowdMult(players) * 2) : 0;
  }

  waves(id: string): number { return this.maps.get(id)?.waves ?? 0; }

  /** Map level for a server-side battle (each match gets its own, walls break blocks); null — no such map */
  load(id: string): { level: Level; td: TdSpec } | null {
    if (!this.maps.has(id)) return null;
    const j = JSON.parse(readFileSync(join(this.dir, `${id}.json`), 'utf8')) as LevelJSON;
    const level = Level.fromJSON(j);
    return { level, td: level.meta.td as TdSpec };
  }
}
