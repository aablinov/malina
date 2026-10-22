import type { LevelJSON } from './level.ts';

/**
 * Встроенные карты: всё из assets/maps/ вшивается в сборку.
 * Комнаты-заготовки подземелья лежат в assets/maps/rooms/.
 */
const all = import.meta.glob('../../assets/maps/**/*.json', { eager: true, import: 'default' }) as Record<string, LevelJSON>;

export const MAPS: Record<string, LevelJSON> = {};
export const ROOMS: LevelJSON[] = [];
for (const [path, json] of Object.entries(all)) {
  const rel = path.replace(/^.*assets\/maps\//, '');
  MAPS[rel] = json;
  if (rel.startsWith('rooms/')) ROOMS.push(json);
}

export function mapByName(name: string): LevelJSON | undefined {
  return MAPS[name] ?? MAPS[`${name}.json`];
}
