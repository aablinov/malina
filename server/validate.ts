import { ITEMS, type ProfileData } from '../src/items.ts';
import { MAX_PLAYERS, NET_LIMITS, type ClientMsg, type RtcSignal } from '../src/net/protocol.ts';

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
 * as in `Profile.upgrade`; equipped slots reference only the profile's own items
 */
export function checkProfile(v: unknown): { ok: true; data: ProfileData } | { ok: false; error: string } {
  if (!isObj(v)) return { ok: false, error: 'profile is not an object' };
  if (JSON.stringify(v).length > NET_LIMITS.maxProfile) return { ok: false, error: 'profile too large' };
  if (v.version !== 1) return { ok: false, error: 'profile version' };
  for (const k of ['level', 'xp', 'points', 'berries', 'souls', 'arrows', 'seq'] as const) {
    if (!isInt(v[k], 0, BIG)) return { ok: false, error: `field ${k}` };
  }
  if ((v.level as number) < 1) return { ok: false, error: 'field level' };
  if (v.seeds !== undefined && !(isObj(v.seeds) && isInt(v.seeds.common, 0, BIG) && isInt(v.seeds.rare, 0, BIG) && isInt(v.seeds.golden, 0, BIG))) return { ok: false, error: 'field seeds' };
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
    case 'room.create': return isStr(v.map, 32) && isInt(v.max, 1, MAX_PLAYERS) && isStr(v.password, NET_LIMITS.passMax) ? { t: 'room.create', map: v.map, max: v.max, password: v.password } : null;
    case 'room.join': return isStr(v.code, 12) && (v.password === undefined || isStr(v.password, NET_LIMITS.passMax)) ? { t: 'room.join', code: v.code, password: v.password } : null;
    case 'room.ready': return typeof v.ready === 'boolean' ? (v as ClientMsg) : null;
    case 'room.map': return isStr(v.map, 32) ? (v as ClientMsg) : null;
    case 'room.kick': return isStr(v.playerId, 64) ? (v as ClientMsg) : null;
    case 'voice': return typeof v.on === 'boolean' ? (v as ClientMsg) : null;
    case 'rtc': return isInt(v.to, 0, MAX_PLAYERS - 1) && checkRtc(v.data) ? { t: 'rtc', to: v.to, data: v.data } : null;
    default: return null;
  }
}

/** WebRTC signal: offer/answer with SDP or an ICE candidate (null — the end of candidates) */
function checkRtc(d: unknown): d is RtcSignal {
  if (!isObj(d)) return false;
  if (d.k === 'offer' || d.k === 'answer') return isStr(d.sdp, NET_LIMITS.sdpMax) && Object.keys(d).length === 2;
  if (d.k !== 'ice') return false;
  if (d.c === null) return true;
  const c = d.c;
  return isObj(c) && isStr(c.candidate, NET_LIMITS.iceMax) && (c.sdpMid === null || isStr(c.sdpMid, 64))
    && (c.sdpMLineIndex === null || isInt(c.sdpMLineIndex, 0, 64)) && Object.keys(c).length === 3;
}
