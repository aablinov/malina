import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crowdMult } from '../src/td/scaling.ts';

/**
 * Карты сетевой игры — карты обороны куста из assets/maps (у них есть `meta.td`, src/td/types.ts).
 * Сервер читает их один раз: какие карты можно выбрать в комнате и сколько малины за бой правдоподобно
 */
export interface NetMap { id: string; waves: number; bounty: number }

/** Опыт за бой больше этого — не верим хосту */
export const MAX_XP_PER_MATCH = 50_000;

export class MapCatalog {
  private readonly maps = new Map<string, NetMap>();

  constructor(dir: string) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const td = (JSON.parse(readFileSync(join(dir, f), 'utf8')) as { meta?: { td?: { waves?: { bounty?: number }[] } } }).meta?.td;
        if (!td?.waves) continue;
        const id = f.slice(0, -5);
        this.maps.set(id, { id, waves: td.waves.length, bounty: td.waves.reduce((a, w) => a + (w.bounty ?? 0), 0) });
      } catch { /* битый файл карты — не сетевая */ }
    }
  }

  has(id: string): boolean { return this.maps.has(id); }
  ids(): string[] { return [...this.maps.keys()].sort(); }

  /** Наибольшая малина героя за бой: все награды волн с множителем партии */
  maxBerries(id: string, players: number): number {
    const m = this.maps.get(id);
    return m ? Math.ceil(m.bounty * crowdMult(players)) : 0;
  }

  waves(id: string): number { return this.maps.get(id)?.waves ?? 0; }
}
