import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Level, type LevelJSON } from '../src/level/level.ts';
import { crowdMult } from '../src/td/scaling.ts';
import type { TdSpec } from '../src/td/types.ts';

/**
 * Карты сетевой игры — карты обороны куста из assets/maps (у них есть `meta.td`, src/td/types.ts).
 * Сервер читает их один раз: какие карты можно выбрать в комнате и сколько малины за бой правдоподобно
 */
export interface NetMap { id: string; waves: number; bounty: number; berries: number }

/** Опыт за бой больше этого — не верим хосту */
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
      } catch { /* битый файл карты — не сетевая */ }
    }
  }

  has(id: string): boolean { return this.maps.has(id); }
  ids(): string[] { return [...this.maps.keys()].sort(); }

  /**
   * Наибольшая малина героя за бой — потолок от вранья, не баланс: стартовая казна и все награды волн с множителем партии,
   * втрое — с запасом на малину с врагов (её сервер не считает)
   */
  maxBerries(id: string, players: number): number {
    const m = this.maps.get(id);
    return m ? Math.ceil((m.berries + m.bounty * crowdMult(players)) * 3) : 0;
  }

  waves(id: string): number { return this.maps.get(id)?.waves ?? 0; }

  /** Уровень карты для серверного боя (каждый матч — свой, стены ломают блоки); null — нет такой */
  load(id: string): { level: Level; td: TdSpec } | null {
    if (!this.maps.has(id)) return null;
    const j = JSON.parse(readFileSync(join(this.dir, `${id}.json`), 'utf8')) as LevelJSON;
    const level = Level.fromJSON(j);
    return { level, td: level.meta.td as TdSpec };
  }
}
