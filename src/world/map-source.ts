import { CH, Level, type DecorItem } from '../level/level.ts';
import { REGION, type RegionEntity, type RegionSource } from './gen.ts';

/**
 * Фиксированная карта как источник регионов (wiki/dev-performance.md, «Регионы»): вся карта лежит в памяти
 * (`source`), а в живой уровень — и значит в сцену — попадают только регионы вокруг игроков. Чанки копируются
 * как есть (палитры совпадают), декор региона добавляется и убирается вместе с ним, сундуки, бочки и ящики из
 * сущностей карты становятся предметами региона со стабильными id «rx,rz:n» — их состояние переживает выгрузку.
 */

const KINDS: Record<string, RegionEntity['kind']> = { chest: 'chest', barrel: 'barrel', crate: 'crate' };

export function mapSource(source: Level): RegionSource {
  /** Декор, поставленный в живой уровень по регионам */
  const placed = new Map<string, DecorItem[]>();
  const keyOf = (x: number, z: number): string => `${Math.floor(x / REGION)},${Math.floor(z / REGION)}`;
  /** Сущности и декор карты по регионам — один раз */
  const ents = new Map<string, RegionEntity[]>();
  const decor = new Map<string, DecorItem[]>();
  for (const e of source.entities) {
    const kind = KINDS[e.kind];
    if (!kind) continue;
    const key = keyOf(e.x, e.z);
    const list = ents.get(key) ?? [];
    list.push({ id: `${key}:${list.length}`, kind, x: e.x, z: e.z, rot: e.rot ?? 0 });
    ents.set(key, list);
  }
  for (const d of source.decor) {
    const key = keyOf(d.pos[0], d.pos[2]);
    (decor.get(key) ?? decor.set(key, []).get(key)!).push(d);
  }
  return {
    generate(rx, rz, into) {
      into.adoptPalette(source);
      for (const ck of source.chunkKeysOf(rx, rz)) into.putChunk(ck, new Uint16Array(source.chunks.get(ck)!));
      const key = `${rx},${rz}`;
      const entities = ents.get(key) ?? [];
      // сундук в комнате-заготовке стоит на блоке-ящике (заглушка в ASCII): вместо блока — настоящий сундук
      for (const e of entities) if (e.kind === 'chest' && into.nameAt(e.x, 0, e.z) === 'crate') into.set(e.x, 0, e.z, 'air');
      const ds = (decor.get(key) ?? []).map((d) => into.addDecor({ ...d }));
      if (ds.length) placed.set(key, ds);
      return { entities };
    },
    release(rx, rz, from) {
      const key = `${rx},${rz}`;
      for (const d of placed.get(key) ?? []) from.removeDecor(d);
      placed.delete(key);
    },
  };
}

/** Стоит ли стримить карту: больше STREAM_CHUNKS чанков — целиком в сцене она дорога */
export const STREAM_CHUNKS = 400;
export const chunkCount = (L: Level): number => L.chunks.size;
export { CH };
