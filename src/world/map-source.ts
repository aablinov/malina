import { CH, Level, type DecorItem } from '../level/level.ts';
import { REGION, type RegionEntity, type RegionSource } from './gen.ts';

/**
 * A fixed map as a region source (wiki/dev-performance.md, "Regions"): the whole map sits in memory
 * (`source`), and only the regions around the players get into the live level — and thus into the scene. Chunks are copied
 * as is (the palettes match), a region's decor is added and removed with it, chests, barrels and crates from the
 * map's entities become region items with stable ids "rx,rz:n" — their state survives unloading.
 */

const KINDS: Record<string, RegionEntity['kind']> = { chest: 'chest', barrel: 'barrel', crate: 'crate', terminal: 'terminal' };

export function mapSource(source: Level): RegionSource {
  /** Decor placed into the live level, per region */
  const placed = new Map<string, DecorItem[]>();
  const keyOf = (x: number, z: number): string => `${Math.floor(x / REGION)},${Math.floor(z / REGION)}`;
  /** The map's entities and decor per region — once */
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
      // a chest in a template room stands on a crate block (the ASCII placeholder): a real chest replaces the block
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

/** Whether to stream the map: with more than STREAM_CHUNKS chunks it is too expensive whole in the scene */
export const STREAM_CHUNKS = 400;
export const chunkCount = (L: Level): number => L.chunks.size;
export { CH };
