import { ITEMS, type ProfileData } from '../src/items.ts';
import { MAX_PLAYERS, NET_LIMITS, type ClientMsg } from '../src/net/protocol.ts';

/**
 * Validation of incoming data without external libraries: rejects junk, overflows and dangling references
 */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const BIG = 1e9;
const KNOWN = new Set(ITEMS.map((d) => d.id));

/**
 * Hero profile (`ProfileData`, src/items.ts) or an error text. Items missing from the catalog are dropped —
 * as in `Profile.load`; equipped slots reference only the profile's own items
 */
export function checkProfile(v: unknown): { ok: true; data: ProfileData } | { ok: false; error: string } {
  if (!isObj(v)) return { ok: false, error: 'profile is not an object' };
  if (JSON.stringify(v).length > NET_LIMITS.maxProfile) return { ok: false, error: 'profile too large' };
  if (v.version !== 1) return { ok: false, error: 'profile version' };
  for (const k of ['level', 'xp', 'points', 'berries', 'souls', 'arrows', 'seq'] as const) {
    if (!isInt(v[k], 0, BIG)) return { ok: false, error: `field ${k}` };
  }
  if ((v.level as number) < 1) return { ok: false, error: 'field level' };
  if (!Array.isArray(v.items) || v.items.length > 2000) return { ok: false, error: 'field items' };
  const uids = new Set<string>();
  for (const it of v.items) {
    if (!isObj(it) || !isStr(it.uid, 64) || !isStr(it.def, 64) || !isInt(it.power, 1, 1000) || !Array.isArray(it.enchants)) return { ok: false, error: 'item' };
    for (const s of it.enchants) {
      if (!isObj(s) || !Array.isArray(s.options) || s.options.length > 3 || !s.options.every((o) => isStr(o, 64)) || !isInt(s.chosen, -1, 2) || !isInt(s.tier, 0, 3)) {
        return { ok: false, error: 'enchantment' };
      }
    }
    if (uids.has(it.uid)) return { ok: false, error: 'duplicate uid' };
    uids.add(it.uid);
  }
  const eq = v.equip;
  if (!isObj(eq) || !Array.isArray(eq.artifacts) || eq.artifacts.length !== 3) return { ok: false, error: 'field equip' };
  const refs = [eq.melee, eq.ranged, eq.armor, eq.aura ?? null, ...eq.artifacts];
  if (!refs.every((r) => r === null || (typeof r === 'string' && uids.has(r)))) return { ok: false, error: 'equipped item is missing' };

  const data = structuredClone(v) as unknown as ProfileData;
  data.equip.aura ??= null;
  const gone = new Set(data.items.filter((i) => !KNOWN.has(i.def)).map((i) => i.uid));
  if (gone.size) {
    data.items = data.items.filter((i) => !gone.has(i.uid));
    const drop = (u: string | null): string | null => (u && gone.has(u) ? null : u);
    const e = data.equip;
    e.melee = drop(e.melee); e.ranged = drop(e.ranged); e.armor = drop(e.armor); e.aura = drop(e.aura);
    e.artifacts = [drop(e.artifacts[0]), drop(e.artifacts[1]), drop(e.artifacts[2])];
  }
  return { ok: true, data };
}

/** Client message or null */
export function checkClientMsg(v: unknown): ClientMsg | null {
  if (!isObj(v) || typeof v.t !== 'string') return null;
  switch (v.t) {
    case 'hello': return isStr(v.token, 100) && Number.isInteger(v.protocol) ? (v as ClientMsg) : null;
    case 'ping': case 'room.leave': case 'room.start': case 'room.again': return v as ClientMsg;
    case 'chat': return isStr(v.text, 1000) ? (v as ClientMsg) : null;
    case 'room.create': return isStr(v.map, 32) && isInt(v.max, 1, MAX_PLAYERS) && typeof v.private === 'boolean' ? (v as ClientMsg) : null;
    case 'room.join': return isStr(v.code, 12) ? (v as ClientMsg) : null;
    case 'room.ready': return typeof v.ready === 'boolean' ? (v as ClientMsg) : null;
    case 'room.map': return isStr(v.map, 32) ? (v as ClientMsg) : null;
    case 'room.kick': return isStr(v.playerId, 64) ? (v as ClientMsg) : null;
    default: return null;
  }
}
