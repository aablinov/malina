import { Level } from './level.ts';
import { sutlerSpot } from './td-sutler.ts';
import { hash2, noise2 } from './kit.ts';
import { stampPrefab } from './prefab-lib/stamp.ts';
import type { LibraryPrefab } from './prefab-lib/types.ts';
import type { TdFog, TdLane, TdPad, TdSpec } from '../td/types.ts';
import { fogWave } from '../td/waves-fog.ts';

/**
 * "Misty Clearing" map — Bush Defence 5 (wiki/design-tower-defence.md, section 18): a night clearing with the raspberry bush in the
 * centre and no roads. Around the clearing a ring of mist; the Order walks out of it from any of eight sides (invisible lanes —
 * every enemy wanders its own way, src/sim/td.ts `scatter`). Four pads by the bush, eight lanterns on the clearing's edge
 * (lit — they push the mist back), a beacon over the bush sweeps a cold beam. Waves are endless (src/td/waves-fog.ts).
 * `npm run map:td5` writes assets/maps/td5.json; open with `?map=td5`.
 */

export const FOG_HALF = 46;
/** Clearing radius: the mist begins here */
export const FOG_INNER = 21;
/** The mist is thickest here; enemies come out a little inside */
export const FOG_OUTER = 40;
const SPAWN_R = 37;

const COMPASS = ['East', 'South-east', 'South', 'South-west', 'West', 'North-west', 'North', 'North-east'];

/** Eight directions out of the mist, between the diagonals (the pads stand on the diagonals) */
export const FOG_LANES: TdLane[] = COMPASS.map((title, i) => {
  const a = (i + 0.5) * (Math.PI / 4);
  const at = (r: number, da = 0): [number, number] => [Math.round(Math.cos(a + da) * r * 10) / 10, Math.round(Math.sin(a + da) * r * 10) / 10];
  // a slight bend in the middle — no lane is a ruler line
  const bend = (hash2(i, 3, 1) - 0.5) * 0.18;
  return { id: `m${i}`, title: `${title} mist`, points: [at(SPAWN_R), at(25, bend), at(13, bend * 0.5), at(2.6)] };
});

/** Four pads on the diagonals by the bush */
export const FOG_PADS: TdPad[] = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([sx, sz]) => ({ x: sx * 6, z: sz * 6 }));

export const FOG_SPEC_FOG: TdFog = {
  inner: FOG_INNER, outer: FOG_OUTER,
  // lanterns on the diagonals and between them — never on a lane (a lane is 22.5° away)
  lanterns: Array.from({ length: 8 }, (_, i) => { const a = i * (Math.PI / 4); return [Math.round(Math.cos(a) * 23), Math.round(Math.sin(a) * 23)] as [number, number]; }),
  beam: 18,
  color: '#b9b4d6',
};

/** The first ten waves are baked into the map (the camp card and the server's loot cap read them); the rest are generated */
const LANE_IDS = FOG_LANES.map((l) => l.id);

export const FOG_SPEC: TdSpec = {
  bush: { x: 0, z: 0, hp: 500 },
  lanes: FOG_LANES,
  pads: FOG_PADS,
  berries: 260,
  waves: Array.from({ length: 10 }, (_, i) => fogWave(i + 1, LANE_IDS)),
  rest: 15,
  level: 1,
  endless: true,
  fog: FOG_SPEC_FOG,
};

/** Distance from a point to a segment */
const segDist = (px: number, pz: number, ax: number, az: number, bx: number, bz: number): number => {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
};
const laneDist = (x: number, z: number): number => {
  let best = Infinity;
  for (const l of FOG_LANES) for (let i = 0; i + 1 < l.points.length; i++) best = Math.min(best, segDist(x, z, l.points[i][0], l.points[i][1], l.points[i + 1][0], l.points[i + 1][1]));
  return best;
};

export function buildTdFogMap(lib: Record<string, LibraryPrefab>): Level {
  for (const p of FOG_PADS) if (laneDist(p.x, p.z) < 2.8) throw new Error(`Pad ${p.x},${p.z} is too close to a lane (${laneDist(p.x, p.z).toFixed(1)} m)`);
  for (const [x, z] of FOG_SPEC_FOG.lanterns) if (laneDist(x, z) < 4) throw new Error(`Lantern ${x},${z} is on a lane`);
  const L = new Level('Misty Clearing');
  const H = FOG_HALF;
  const used = new Set<string>();
  const key = (x: number, z: number): string => `${x},${z}`;
  const mark = (x: number, z: number, r: number): void => { for (let xx = x - r; xx <= x + r; xx++) for (let zz = z - r; zz <= z + r; zz++) used.add(key(xx, zz)); };
  // ---------- ground: soft grass on the clearing, dark moss and dirt under the mist ----------
  for (let x = -H; x <= H; x++) for (let z = -H; z <= H; z++) {
    const d = Math.hypot(x, z), n = noise2(x, z, 6, 2);
    let b: string;
    if (d < FOG_INNER - 2) b = n > 0.75 ? 'moss_block' : 'grass';
    else if (d < FOG_INNER + 4) b = n > 0.55 ? 'moss_block' : 'grass';
    else b = n > 0.6 ? 'dirt' : n > 0.3 ? 'mossy' : 'moss_block';
    L.set(x, -1, z, b);
    L.set(x, -2, z, 'dirt');
  }
  // ---------- the bush square: old tiles in a ring, a low broken fence with four gaps per quarter ----------
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) {
    const d = Math.hypot(x, z);
    if (d <= 3.4) L.set(x, -1, z, hash2(x, z, 4) < 0.8 ? 'tiles' : 'tiles_broken');
    used.add(key(x, z));
  }
  // ---------- pads: a circle of tiles with a mossy rim ----------
  for (const p of FOG_PADS) {
    for (let x = p.x - 3; x <= p.x + 3; x++) for (let z = p.z - 3; z <= p.z + 3; z++) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d <= 1.6) L.set(x, -1, z, 'tiles'); else if (d <= 2.4) L.set(x, -1, z, 'mossy');
    }
    mark(p.x, p.z, 3);
  }
  // ---------- lantern spots: a slab under the post (the lantern itself is drawn by src/td/fog-fx.ts) ----------
  for (const [x, z] of FOG_SPEC_FOG.lanterns) {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) L.set(x + dx, -1, z + dz, dx || dz ? 'mossy' : 'cobble');
    mark(x, z, 2);
  }
  // ---------- decor ----------
  const free = (x: number, z: number, r: number): boolean => {
    for (let xx = x - r; xx <= x + r; xx++) for (let zz = z - r; zz <= z + r; zz++) if (Math.abs(xx) > H - 1 || Math.abs(zz) > H - 1 || used.has(key(xx, zz)) || L.topAt(xx, zz) !== -1) return false;
    return true;
  };
  const stamp = (id: string, x: number, z: number, q = 0): boolean => {
    const p = lib[id];
    if (!p) throw new Error(`No prefab "${id}"`);
    const r0 = Math.max(Math.ceil(p.size[0] / 2), Math.ceil(p.size[2] / 2)) + 1;
    if (!free(x, z, r0) || laneDist(x, z) < r0 + 1.5) return false;
    const r = stampPrefab(L, p, x, 0, z, q);
    for (const d of r.decor) L.addDecor(d);
    L.entities.push(...r.entities);
    mark(x, z, r0);
    return true;
  };
  const dec = (name: string, x: number, z: number): void => { L.addDecor({ name, pos: [x, 0, z], rot: [hash2(x, z, 11) * 360] }); mark(x, z, 1); };
  // the forest wall behind the mist: dense dark firs from R 40 out to the edge
  for (let z = -H + 2; z <= H - 2; z += 3) for (let x = -H + 2; x <= H - 2; x += 3) {
    const d = Math.hypot(x, z);
    if (d < FOG_OUTER) continue;
    const jx = x + Math.floor(hash2(x, z, 30) * 3) - 1, jz = z + Math.floor(hash2(x, z, 31) * 3) - 1;
    stamp(hash2(x, z, 32) < 0.75 ? (hash2(x, z, 33) < 0.5 ? 'tree_pine_dark' : 'tree_pine_dark_2') : 'tree_oak', jx, jz, Math.floor(hash2(x, z, 34) * 4));
  }
  // under the mist: sparse dead trees, boulders, bushes — shapes that loom and vanish
  for (let z = -H + 4; z <= H - 4; z += 4) for (let x = -H + 4; x <= H - 4; x += 4) {
    const d = Math.hypot(x, z), v = hash2(x, z, 12);
    if (d < FOG_INNER + 3 || d >= FOG_OUTER) continue;
    if (v < 0.22) stamp(['tree_oak', 'tree_pine_dark', 'mossy_boulders', 'bush_cluster', 'boulder_single'][Math.floor(hash2(x, z, 13) * 5)], x, z, Math.floor(hash2(x, z, 14) * 4));
  }
  // small stuff: ferns and flowers on the clearing, glow mushrooms at the mist's edge, tall grass under it
  for (let z = -H + 2; z <= H - 2; z++) for (let x = -H + 2; x <= H - 2; x++) {
    if (!free(x, z, 0)) continue;
    const d = Math.hypot(x, z), v = hash2(x, z, 24), lane = laneDist(x, z);
    if (lane < 1.6) continue;
    if (d < FOG_INNER) {
      if (v < 0.03) L.set(x, 0, z, ['flower_pink', 'flower_white', 'flower_blue'][Math.floor(hash2(x, z, 26) * 3)]);
      else if (v < 0.05 && d > 9) L.set(x, 0, z, 'fern');
    } else if (d < FOG_INNER + 5) {
      if (v < 0.05 && free(x, z, 1)) dec('mushrooms_glow', x, z);
      else if (v < 0.1) L.set(x, 0, z, 'tall_grass');
    } else if (v < 0.12) L.set(x, 0, z, hash2(x, z, 27) < 0.3 ? 'fern_big' : 'tall_grass');
  }
  // ---------- hero, goal, world: a deep violet night, mist close, strong bloom on the lanterns ----------
  L.spawn = [0, 0, 9];
  L.meta.spawnYaw = 270;
  L.meta.goal = ['Defend the raspberry bush', 'Misty Clearing'];
  const sutler = sutlerSpot(L, FOG_LANES, FOG_PADS, 0, 12);
  if (!sutler) throw new Error('No room for the sutler');
  L.meta.merchants = [sutler];
  L.meta.td = FOG_SPEC;
  L.meta.world = {
    sun: { color: '#8a86d8', intensity: 0.35, elevation: 50, azimuth: 210, shadows: true },
    sky: { color: '#0a0814', hemiSky: '#4a3f7a', hemiGround: '#1c1a2a', hemi: 1.0, ambient: 0.16 },
    fog: { enabled: true, color: '#1a1628', near: 26, far: 62 },
    weather: { kind: 'fireflies', intensity: 0.35, wind: 0.2 },
    post: { bloom: 0.95, bloomThreshold: 0.7, vignette: 0.42, saturation: 1.08, shadowTint: '#2a1a5a', highTint: '#ffb0f0', tintAmount: 0.12 },
  };
  return L;
}
