import type { EntityState } from '../net/snapshot.ts';

/** Хэш FNV-1a по записям сущностей — сверка детерминизма: один сид и те же команды — один хэш на каждом тике */
export function hashEntities(ents: readonly EntityState[]): number {
  let h = 0x811c9dc5;
  const mix = (s: string): void => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } };
  for (const e of [...ents].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    mix(e.id);
    for (const k of Object.keys(e).sort()) { mix(k); mix(String(e[k])); }
  }
  return h >>> 0;
}
