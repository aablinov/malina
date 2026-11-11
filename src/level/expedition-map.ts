import * as THREE from 'three';
import { missionMods } from '../expedition/mission.ts';
import { guardPool, type ExpeditionParams, type ExpeditionSpec, type ExpLair, type ExpPoi, type ExpSecondary, type ExpSite, type SecondaryKind, type SeedRarity } from '../expedition/types.ts';
import { rng, type Rand } from '../rng.ts';
import type { MatchMap } from '../sim/rules.ts';
import { terrainOf } from './collide.ts';
import { hash2, landscape, noise2, rockOutcrop, surfaceAt, tree } from './kit.ts';
import { Level } from './level.ts';
import { Pathfinder } from './pathfind.ts';
import type { MobPost, MobRoomSpec } from './playground-map.ts';
import { stampPrefab } from './prefab-lib/stamp.ts';
import type { LibraryPrefab } from './prefab-lib/types.ts';

/**
 * Expedition map (wiki/design-expeditions.md, section 3): a seeded 160 × 160 m clearing in the woods. Landing points and the
 * extraction pad lie on the outer ring, lairs, objective sites and points of interest inside; garrisons guard them and patrols
 * walk between the lairs. Nothing is baked into assets/maps: the server and the client call `buildExpedition` with the same
 * parameters and get the same level (the test compares hashes). Open with `?map=expedition&seed=N`.
 */

export const EXP_HALF = 80;
/** The generator retries with a derived seed when sites do not fit or an objective is unreachable */
const ATTEMPTS = 12;
/** Search budget of the reachability check — the map is larger than the hero's usual 85 m field */
const REACH_EXPAND = 400_000;

interface Spot { x: number; z: number; r: number }

const SECONDARY: readonly SecondaryKind[] = ['chest', 'altar', 'watchtower', 'horns'];
const TREES = ['tree_oak', 'tree_oak_2', 'tree_oak_3', 'tree_pine_dark', 'tree_pine_dark_2'];
const ROCKS = ['boulder_single', 'boulder_group', 'mossy_boulders', 'bush_cluster'];

const segDist = (px: number, pz: number, ax: number, az: number, bx: number, bz: number): number => {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
};

class Unfit extends Error {}

export function buildExpedition(p: ExpeditionParams, lib: Record<string, LibraryPrefab> = {}): Level {
  const difficulty = Math.max(1, Math.min(8, Math.round(p.difficulty)));
  let last: unknown = null;
  for (let i = 0; i < ATTEMPTS; i++) {
    try { return build({ ...p, difficulty }, ((p.seed >>> 0) + i * 0x9e3779b1) >>> 0 || 1, lib); } catch (e) { if (!(e instanceof Unfit)) throw e; last = e; }
  }
  throw new Error(`Expedition ${p.seed}/${p.objective}: no map in ${ATTEMPTS} attempts — ${String(last)}`);
}

function build(p: ExpeditionParams, seed: number, lib: Record<string, LibraryPrefab>): Level {
  const r: Rand = rng(seed), H = EXP_HALF, d = p.difficulty;
  // the operation's modifiers (section 9): fury — larger patrols, full moon — a golden seed two difficulties earlier
  const mods = missionMods(p), fury = mods.includes('fury'), moon = mods.includes('fullmoon');
  const int = (a: number, b: number): number => a + Math.floor(r() * (b - a + 1));
  const taken: Spot[] = [];
  /** A free point in the ring r0…r1 from the centre, at least `gap` from everything placed */
  const place = (r0: number, r1: number, own: number, gap: number): Spot => {
    for (let i = 0; i < 600; i++) {
      const a = r() * Math.PI * 2, rr = r0 + r() * (r1 - r0);
      const x = Math.round(Math.cos(a) * rr), z = Math.round(Math.sin(a) * rr);
      if (Math.max(Math.abs(x), Math.abs(z)) > H - 12) continue;
      if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < gap + t.r)) continue;
      const s = { x, z, r: own };
      taken.push(s);
      return s;
    }
    throw new Unfit(`no room for a site (${taken.length} placed)`);
  };
  const site = (id: string, s: Spot): ExpSite => ({ id, x: s.x, z: s.z });

  // ---------- sites: the outer ring first, then the inside ----------
  const extraction = site('extract', place(52, 64, 7, 0));
  const landings = [0, 1, 2].map((i) => site(`land${i}`, place(50, 64, 4, 38)));
  const lairN = 3 + (d >= 3 ? 1 : 0) + (d >= 6 ? 1 : 0);
  const lairs: ExpLair[] = Array.from({ length: lairN }, (_, i) => ({ ...site(`lair${i}`, place(8, 46, 8, 22)), size: (i === lairN - 1 ? 3 : i === 0 ? 1 : 2) as 1 | 2 | 3 }));
  const objSites: ExpSite[] = p.objective === 'lairs' ? lairs.map((l) => ({ id: l.id, x: l.x, z: l.z }))
    : p.objective === 'beacons' ? [0, 1, 2].map((i) => site(`beacon${i}`, place(10, 54, 5, 20)))
      : [site('plot', place(0, 40, 11, 20))];
  const kinds = SECONDARY.slice();
  const secondary: ExpSecondary[] = Array.from({ length: 2 + (r() < 0.5 ? 1 : 0) }, (_, i) => ({ ...site(`side${i}`, place(10, 60, 4, 14)), kind: kinds.splice(int(0, kinds.length - 1), 1)[0] }));
  const big = lairs[lairs.length - 1];
  const pois: ExpPoi[] = Array.from({ length: int(6, 10) }, (_, i) => ({ ...site(`poi${i}`, place(6, 64, 3, 10)), berries: int(8, 20), seed: 'common' as SeedRarity | null }));
  // seeds: rare from difficulty 3 on two points, golden from 5 on the point nearest to the large lair
  const byBig = pois.slice().sort((a, b) => Math.hypot(a.x - big.x, a.z - big.z) - Math.hypot(b.x - big.x, b.z - big.z));
  if (d >= 3) for (const q of byBig.slice(1, 3)) q.seed = 'rare';
  if (d >= (moon ? 3 : 5)) byBig[0].seed = 'golden';
  for (const q of pois) if (q.seed === 'common' && r() < 0.35) q.seed = null;

  // ---------- garrisons ----------
  const pool = guardPool(d);
  const pick = (): string => pool[int(0, pool.length - 1)];
  const ring = (c: ExpSite, n: number, rad: number, aggro?: number): MobPost[] => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + r() * 0.6;
    return { kind: pick(), x: Math.round((c.x + Math.cos(a) * rad) * 2) / 2, z: Math.round((c.z + Math.sin(a) * rad) * 2) / 2, ...(aggro ? { aggro } : {}) };
  });
  const room = (id: string, title: string, c: ExpSite, pad: number, posts: MobPost[]): MobRoomSpec =>
    ({ id, title, x0: c.x - pad, x1: c.x + pad, z0: c.z - pad, z1: c.z + pad, posts, enter: { x: c.x, z: c.z + pad, yaw: 180 }, respawn: false });
  const garrisons: MobRoomSpec[] = [];
  for (const l of lairs) garrisons.push(room(`g:${l.id}`, 'Lair', l, 9, ring(l, 2 + l.size * 2 + Math.floor(d / 3), 4.5)));
  if (p.objective !== 'lairs') for (const s of objSites) garrisons.push(room(`g:${s.id}`, 'Guard', s, 7, ring(s, 2 + Math.floor(d / 2), 3.5, 7)));
  for (const s of secondary) garrisons.push(room(`g:${s.id}`, 'Watch', s, 6, ring(s, 2 + Math.floor(d / 4), 3, 6)));
  // every other point of interest is an ambush: few, and they see the hero only up close
  pois.forEach((q, i) => { if (q.seed === 'golden' || i % 2 === 0) garrisons.push(room(`g:${q.id}`, 'Ambush', q, 5, ring(q, q.seed === 'golden' ? 4 : 2, 2.5, 5))); });
  // patrols: from each lair to the next one and back
  const patrolLines: [number, number, number, number][] = [];
  lairs.forEach((a, i) => {
    const b = lairs[(i + 1) % lairs.length];
    const off = (c: ExpLair, to: ExpLair): [number, number] => { const l = Math.hypot(to.x - c.x, to.z - c.z) || 1; return [Math.round(c.x + ((to.x - c.x) / l) * 10), Math.round(c.z + ((to.z - c.z) / l) * 10)]; };
    const from = off(a, b), to = off(b, a);
    patrolLines.push([from[0], from[1], to[0], to[1]]);
    const posts: MobPost[] = Array.from({ length: 2 + (d >= 4 ? 1 : 0) + (fury ? 1 : 0) }, (_, k) => ({ kind: pick(), x: from[0] + k * 1.5, z: from[1] + (k % 2), aggro: 11, route: [from, to] }));
    garrisons.push({ id: `patrol${i}`, title: 'Patrol', x0: Math.min(from[0], to[0]) - 4, x1: Math.max(from[0], to[0]) + 4, z0: Math.min(from[1], to[1]) - 4, z1: Math.max(from[1], to[1]) + 4, posts, enter: { x: from[0], z: from[1], yaw: 0 }, respawn: false });
  });

  // ---------- ground ----------
  const L = new Level('Expedition');
  const nearSite = (x: number, z: number, pad: number): boolean => taken.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + pad);
  const onPatrol = (x: number, z: number, pad: number): boolean => patrolLines.some(([ax, az, bx, bz]) => segDist(x, z, ax, az, bx, bz) < pad);
  for (let x = -H; x <= H; x++) for (let z = -H; z <= H; z++) {
    L.set(x, -2, z, 'dirt');
    L.set(x, -1, z, noise2(x, z, 7, seed & 0xff) > 0.72 ? 'moss_block' : 'grass');
  }
  // gentle 0.5 m terraces; sites, patrol lines and the rim stay flat
  landscape(L, -H, -H, H, H, 0, { seed: seed & 0xffff, layers: 3, scale: 30, fade: 5, stone: 0.2, flat: (x, z) => nearSite(x, z, 1) || onPatrol(x, z, 2) || Math.max(Math.abs(x), Math.abs(z)) > H - 9 });
  // the rim: a cliff wall nobody climbs
  for (let x = -H; x <= H; x++) for (let z = -H; z <= H; z++) {
    const e = H - Math.max(Math.abs(x), Math.abs(z));
    if (e > 4) continue;
    const top = 3 + Math.floor(noise2(x, z, 5, 9) * 3) - Math.min(2, e >> 1);
    for (let k = 0; k < top; k++) L.set(x, k, z, k === top - 1 ? 'cliff_grass' : hash2(x, z, k) < 0.25 ? 'cliff_dark' : 'cliff');
  }

  // ---------- site floors ----------
  const disc = (c: ExpSite, rad: number, block: string, rim?: string): void => {
    for (let x = c.x - rad - 1; x <= c.x + rad + 1; x++) for (let z = c.z - rad - 1; z <= c.z + rad + 1; z++) {
      const dd = Math.hypot(x - c.x, z - c.z);
      if (dd <= rad) L.set(x, -1, z, block); else if (rim && dd <= rad + 1) L.set(x, -1, z, rim);
    }
  };
  disc(extraction, 5, 'tiles', 'mossy');
  for (const l of landings) disc(l, 2, 'mossy');
  for (const l of lairs) disc(l, 2 + l.size, 'dirt', 'mossy');
  if (p.objective === 'beacons') for (const s of objSites) disc(s, 2, 'cobble', 'mossy');
  if (p.objective === 'bush') disc(objSites[0], 4, 'tiles', 'mossy');
  for (const s of secondary) disc(s, 2, 'cobble');

  // ---------- rocks and trees: never on a site, a patrol line or each other ----------
  const solid: Spot[] = [];
  const clear = (x: number, z: number, rad: number): boolean => Math.max(Math.abs(x), Math.abs(z)) < H - 8 - rad
    && !nearSite(x, z, rad + 3) && !onPatrol(x, z, rad + 2.5) && !solid.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + rad + 2.5);
  for (let i = 0, n = int(10, 16), guard = 0; i < n && guard < 400; guard++) {
    const x = int(-H + 14, H - 14), z = int(-H + 14, H - 14), rx = int(3, 6), rz = int(3, 6);
    if (!clear(x, z, Math.max(rx, rz) + 2)) continue;
    rockOutcrop(L, x, z, rx, rz, int(3, 4), 0, int(1, 999));
    solid.push({ x, z, r: Math.max(rx, rz) + 2 });
    i++;
  }
  const stamp = (id: string, x: number, z: number, q: number): boolean => {
    const pf = lib[id];
    if (!pf) return false;
    const rad = Math.max(Math.ceil(pf.size[0] / 2), Math.ceil(pf.size[2] / 2));
    if (!clear(x, z, rad)) return true;
    const out = stampPrefab(L, pf, x, surfaceAt(L, x, z), z, q);
    for (const dc of out.decor) L.addDecor(dc);
    L.entities.push(...out.entities);
    solid.push({ x, z, r: rad });
    return true;
  };
  for (let z = -H + 10; z <= H - 10; z += 5) for (let x = -H + 10; x <= H - 10; x += 5) {
    const v = r(), jx = x + int(-1, 1), jz = z + int(-1, 1), q = int(0, 3);
    // denser woods towards the rim, glades in the middle
    const wood = 0.1 + 0.22 * Math.min(1, Math.hypot(x, z) / H);
    if (v < wood) { if (!stamp(TREES[int(0, TREES.length - 1)], jx, jz, q) && clear(jx, jz, 2)) { tree(L, jx, surfaceAt(L, jx, jz), jz, int(3, 4), 2); solid.push({ x: jx, z: jz, r: 2 }); } }
    else if (v < wood + 0.05) stamp(ROCKS[int(0, ROCKS.length - 1)], jx, jz, q);
  }
  // small flora on free ground
  for (let x = -H + 6; x <= H - 6; x++) for (let z = -H + 6; z <= H - 6; z++) {
    const v = hash2(x, z, (seed & 0xff) + 70);
    if (v > 0.06 || nearSite(x, z, 0)) continue;
    const y = surfaceAt(L, x, z);
    if (L.nameAt(x, y - 1, z) !== 'grass' || !L.isAir(x, y, z)) continue;
    L.set(x, y, z, v < 0.02 ? 'flower_white' : v < 0.035 ? 'fern' : 'tall_grass');
  }

  // ---------- every landing reaches every objective site and the extraction pad ----------
  const terrain = terrainOf(L), finder = new Pathfinder(L, terrain);
  const at = (s: ExpSite): THREE.Vector3 => new THREE.Vector3(s.x, Math.max(0, terrain.floorAt(s.x, s.z, 2)), s.z);
  for (const from of landings) for (const to of [...objSites, extraction]) {
    const a = at(from), b = at(to), path = finder.find(a, b, { maxExpand: REACH_EXPAND });
    const end = path.length ? path[path.length - 1] : a;
    if (Math.hypot(end.x - b.x, end.z - b.z) > 2.5) throw new Unfit(`${to.id} is unreachable from ${from.id}`);
  }

  const land = landings[Math.max(0, Math.min(landings.length - 1, Math.round(p.landing ?? 0)))];
  const spec: ExpeditionSpec = { seed: p.seed, difficulty: d, half: H, level: d, landings, landing: landings.indexOf(land), mods, extraction, objective: { kind: p.objective, sites: objSites }, secondary, lairs, pois, garrisons };
  L.spawn = [land.x, 0, land.z];
  // the hero faces the middle of the map (meta.spawnYaw: 0 — towards +X, 90 — towards +Z)
  L.meta.spawnYaw = Math.round((Math.atan2(-land.z, -land.x) * 180) / Math.PI);
  L.meta.goal = [{ lairs: 'Burn the lairs', beacons: 'Light the beacons', bush: 'Plant the raspberry bush' }[p.objective], 'Expedition'];
  L.meta.expedition = spec;
  L.meta.world = {
    sun: { color: '#fff1d6', intensity: 1.15, elevation: 52, azimuth: 135, shadows: true },
    sky: { color: '#9fd0f0', hemiSky: '#bfe2ff', hemiGround: '#6f8f5a', hemi: 0.9, ambient: 0.3 },
    fog: { enabled: true, color: '#cfe6f2', near: 60, far: 150 },
    post: { bloom: 0.35, bloomThreshold: 0.85, vignette: 0.22, saturation: 1.08 },
    ...(mods.includes('downpour') ? { weather: { kind: 'rain', intensity: 0.7, wind: 0.4 } } : {}),
    // mist: the haze stands close — lairs and patrols show up late
    ...(mods.includes('mist') ? { fog: { enabled: true, color: '#dfe8ea', near: 14, far: 48 } } : {}),
  };
  L.dirty.clear();
  return L;
}

/** FNV-1a over the level's JSON — the server and the client must agree on it */
export function levelHash(L: Level): number {
  const s = JSON.stringify(L.toJSON());
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

/** A mission as a match map: the level and its expedition mode */
export function expeditionMap(p: ExpeditionParams, lib: Record<string, LibraryPrefab> = {}): MatchMap {
  const level = buildExpedition(p, lib);
  return { level, mode: { kind: 'expedition', spec: level.meta.expedition as ExpeditionSpec } };
}
