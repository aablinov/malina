import { Level } from './level.ts';
import { hash2, jungleGroundAt, noise2, rockOutcrop, tree } from './kit.ts';
import { stampPrefab } from './prefab-lib/stamp.ts';
import type { LibraryPrefab } from './prefab-lib/types.ts';
import type { BossArenaSpec, MobRoomSpec } from './playground-map.ts';

/**
 * Map 1 — "Island" (wiki/design-map-island.md): 256 × 256 m after the hand-drawn map (wiki/sources/map-01/plan.png).
 * A main island and four small ones joined by bridges; biomes — snowy mountains, jungle with a temple, palm groves,
 * rocks with ruins, a meadow with a golden grove, hot springs, the Order's fort and a peaceful village. Everything playable is at height 0:
 * mobs and loot stand on flat ground, the relief is impassable rock masses; the sea cannot be waded — a rock rim runs along
 * the shore, bridges with railings cross the straits; rivers are shallow (fordable), with footbridges over them.
 *
 * Coordinates in this file are pixels of the plan image (1932 × 1916), `px`/`pz` convert them to metres (1 m ≈ 7.5 px).
 * `npm run map:island` writes assets/maps/island.json; open with `?map=island`. Mobs, boss, merchants and the goal are in `meta`.
 */

const SX = 256 / 1932, SZ = 256 / 1916;
const px = (x: number): number => Math.round(x * SX - 128);
const pz = (y: number): number => Math.round(y * SZ - 128);
const P = (x: number, y: number): [number, number] => [px(x), pz(y)];

type Poly = [number, number][];
/** Polygon from a flat list of pixels → metres */
const poly = (...pts: number[]): Poly => { const out: Poly = []; for (let i = 0; i < pts.length; i += 2) out.push([pts[i] * SX - 128, pts[i + 1] * SZ - 128]); return out; };
const ellipse = (cx: number, cy: number, rx: number, ry: number, n = 20): Poly => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [(cx + Math.cos(a) * rx) * SX - 128, (cy + Math.sin(a) * ry) * SZ - 128] as [number, number]; });
function inside(p: Poly, x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

// ---------- land ----------
const MAIN = poly(420, 180, 520, 130, 640, 120, 760, 140, 900, 170, 1000, 230, 1070, 300, 1100, 390, 1180, 430, 1300, 445, 1430, 465, 1500, 480, 1560, 560, 1620, 640, 1600, 720, 1690, 780, 1700, 860, 1690, 900, 1730, 1000, 1770, 1100, 1790, 1200, 1800, 1300, 1760, 1400, 1680, 1460, 1600, 1520, 1560, 1620, 1500, 1700, 1470, 1770, 1400, 1770, 1300, 1710, 1180, 1690, 1060, 1630, 930, 1590, 800, 1540, 730, 1470, 680, 1390, 720, 1310, 770, 1270, 750, 1210, 640, 1180, 480, 1150, 360, 1130, 240, 1140, 150, 1060, 100, 960, 140, 830, 220, 750, 380, 700, 520, 690, 610, 640, 580, 580, 600, 500, 640, 430, 580, 380, 500, 310, 430, 240);
const VILLAGE_ISLE = poly(1250, 120, 1420, 60, 1700, 40, 1860, 110, 1850, 330, 1680, 400, 1430, 400, 1260, 330);
const LEDGE = poly(1770, 820, 1900, 790, 1900, 960, 1780, 960);
const ISLET = ellipse(380, 540, 95, 60);
const ROCK_ISLE = poly(480, 1330, 600, 1280, 670, 1380, 650, 1520, 520, 1530, 440, 1430);
const LANDS = [MAIN, VILLAGE_ISLE, LEDGE, ISLET, ROCK_ISLE];

// ---------- biomes ----------
type Biome = 'snow' | 'jungle' | 'rocks' | 'springs' | 'village' | 'fort' | 'base';
const BIOMES: [Biome, Poly][] = [
  ['snow', poly(430, 165, 620, 110, 760, 150, 930, 190, 1080, 320, 1050, 440, 900, 450, 760, 450, 620, 400, 500, 330, 420, 260)],
  ['jungle', poly(760, 460, 1000, 450, 1180, 480, 1210, 560, 1150, 720, 1100, 800, 930, 820, 790, 720, 730, 600)],
  ['jungle', poly(640, 1390, 820, 1300, 1010, 1290, 1100, 1400, 1070, 1520, 900, 1570, 720, 1530)],
  ['jungle', poly(340, 1020, 560, 1000, 780, 1040, 860, 1140, 760, 1200, 560, 1180, 360, 1120)],
  ['jungle', ISLET],
  ['rocks', poly(160, 780, 300, 700, 480, 720, 640, 740, 840, 800, 860, 990, 720, 1010, 560, 990, 380, 1000, 200, 960, 130, 880)],
  ['springs', poly(1060, 1340, 1220, 1320, 1420, 1380, 1470, 1600, 1420, 1720, 1250, 1740, 1080, 1640)],
  ['fort', poly(1200, 500, 1430, 500, 1560, 640, 1540, 780, 1250, 770, 1200, 640)],
  ['village', VILLAGE_ISLE],
];
/** Where forest grows (outside roads and buildings): meadow with the golden grove, jungle, snow, hill */
const FORESTS: [string, Poly, number][] = [
  ['oak', poly(1110, 820, 1500, 780, 1700, 850, 1720, 1180, 1600, 1360, 1420, 1400, 1200, 1300, 1120, 1200, 1060, 1000), 0.028],
  ['oak', poly(1480, 1400, 1760, 1400, 1700, 1500, 1560, 1620), 0.03],
  ['jungle', BIOMES[2][1], 0.03],
  ['jungle', BIOMES[3][1], 0.03],
  ['jungle', ISLET, 0.05],
  ['jungle', poly(820, 640, 1000, 640, 1100, 800, 930, 830, 790, 730), 0.02],
  ['pine', BIOMES[0][1], 0.02],
  ['palmvillage', poly(1680, 60, 1860, 110, 1850, 330, 1760, 360, 1720, 200), 0.035],
];

// ---------- rivers, roads, bridges ----------
type Line = number[];
const RIVERS: Line[] = [
  [1100, 440, 1110, 520, 1090, 620, 1070, 720, 1050, 790, 1000, 880, 1010, 960, 1060, 1060, 1120, 1160, 1140, 1240, 1190, 1300, 1300, 1340, 1420, 1380, 1500, 1410, 1525, 1455],
  [1340, 850, 1450, 870, 1560, 900, 1640, 950, 1700, 985],
];
/** Roads: [kind, points]; flagstones near the temple, the rest are dirt paths */
const ROADS: ['path' | 'tiles', Line][] = [
  ['path', [740, 1415, 850, 1430, 1000, 1480, 1150, 1535, 1250, 1540, 1320, 1480, 1400, 1360, 1430, 1300, 1430, 1220, 1400, 1160, 1330, 1080, 1270, 1000, 1240, 930, 1270, 830, 1300, 760, 1330, 660, 1370, 560, 1400, 500]],
  ['path', [1400, 380, 1500, 330, 1600, 260, 1680, 230, 1740, 240]],
  ['tiles', [1330, 640, 1250, 600, 1180, 560, 1140, 505, 1090, 560, 1050, 625, 1020, 630, 990, 660, 985, 720, 1000, 800]],
  ['path', [1000, 800, 960, 830, 880, 900, 780, 1000, 680, 1030, 520, 1030, 430, 1000, 360, 935]],
  ['path', [740, 1415, 790, 1330, 800, 1260, 790, 1200, 700, 1150, 600, 1110, 500, 1100, 420, 1100, 345, 1088]],
  ['path', [900, 500, 900, 462, 860, 440, 830, 410, 800, 370, 780, 345]],
  ['path', [1150, 1535, 1200, 1600, 1300, 1640, 1355, 1650]],
  ['path', [1420, 1160, 1480, 1050, 1470, 950, 1465, 880, 1500, 860, 1600, 860, 1670, 880]],
  ['path', [1800, 880, 1840, 860]],
  ['path', [455, 585, 380, 560]],
  ['path', [600, 1385, 610, 1450, 570, 1490]],
  ['path', [1600, 260, 1580, 300, 1540, 330]],
];
/** Bridges over the straits: [x0, y0, x1, y1] — axis-aligned */
const SEA_BRIDGES: [number, number, number, number][] = [
  [1400, 495, 1400, 380],
  [1680, 880, 1800, 880],
  [545, 620, 455, 590],
  [690, 1350, 600, 1385],
];

/** Rock masses: [cx, cy, rx, ry, height, seed] in pixels */
const ROCKS: [number, number, number, number, number, number][] = [
  // Grey Mountains
  [700, 225, 60, 45, 6, 1], [850, 250, 75, 50, 7, 2], [960, 330, 60, 55, 6, 3], [905, 400, 42, 26, 5, 4], [620, 300, 40, 35, 5, 5],
  // Western hill
  [430, 790, 42, 35, 8, 6], [520, 900, 45, 55, 9, 7], [610, 785, 50, 32, 7, 8], [230, 1000, 34, 36, 6, 9], [180, 880, 30, 40, 5, 10],
  // masses with caves: the snow cave (entrance from the south) and the grotto on the west shore (entrance from the east)
  [775, 290, 50, 40, 6, 18], [265, 1085, 42, 36, 6, 19],
  // islet rock in the south-west and the volcano in the south
  [540, 1390, 30, 45, 7, 11], [1200, 1420, 65, 50, 6, 12],
  // the village volcano
  [1500, 165, 100, 80, 8, 13],
  // small rocks around the map
  [1040, 250, 25, 20, 4, 14], [1740, 1250, 30, 40, 4, 15], [1150, 1680, 28, 20, 3, 16], [900, 1560, 24, 18, 3, 17],
];
/** Caves: [entrance x, y, inward direction: dx, dz] */
const CAVES: [number, number, number, number][] = [[775, 342, 0, -1], [330, 1085, -1, 0]];

/** Prefabs: [id, x, y, quarter turn] */
const PREFABS: [string, number, number, number][] = [
  // start and the south-west palms
  ['campfire_camp', 735, 1415, 0], ['jungle_thicket', 830, 1330, 0], ['jungle_thicket_2', 980, 1440, 1], ['jungle_tree_big', 880, 1380, 0],
  // hot springs: ponds, boulders, watchtower, gardeners' camp
  ['pond_small', 1200, 1575, 0], ['pond_small_2', 1115, 1620, 0], ['boulder_group', 1260, 1500, 0], ['boulder_group_2', 1080, 1580, 0],
  ['meadow_dry', 1180, 1460, 0], ['meadow_dry_2', 1320, 1580, 0], ['watchtower_wood', 1320, 1500, 0], ['camp_bandits_2', 1360, 1650, 0],
  // hamlet on stilts
  ['house_wood_big', 1462, 1140, 0], ['fence_corner', 1380, 1120, 0], ['hay_stack_2', 1505, 1205, 0],
  // garden beds and meadow
  ['garden_beds', 1225, 930, 0], ['garden_beds_2', 1280, 950, 0], ['fence_straight', 1250, 890, 0], ['meadow_flowers', 1380, 980, 0], ['meadow_flowers_2', 1160, 1080, 0],
  ['grove_golden', 1400, 1060, 0], ['grove_golden_2', 1280, 1180, 0], ['tree_golden_big', 1560, 1080, 0], ['stump_logs', 1500, 950, 0],
  // the Order's fort
  ['camp_bandits', 1385, 640, 0], ['watchtower_wood', 1300, 560, 0], ['watchtower_wood_2', 1470, 725, 0], ['house_wood_small', 1455, 575, 0], ['hay_stack', 1300, 725, 0], ['cart_broken', 1250, 650, 0],
  // temple in the jungle
  ['temple_ruins_jungle', 930, 605, 0], ['temple_column_row', 1060, 560, 1], ['crystal_cluster_big', 850, 700, 0], ['crystal_cluster_small', 1040, 700, 0], ['jungle_pond', 870, 760, 0],
  // Grey Mountains
  ['grove_pine_snow', 560, 230, 0], ['grove_pine_snow_2', 960, 420, 0], ['snow_patch', 700, 330, 0], ['ice_spikes_group', 640, 380, 0], ['frozen_pond', 520, 320, 0], ['snowman_yard', 880, 440, 0], ['boulder_group_snow', 1000, 440, 0],
  // Western hill: cliff with a statue, pond, boulders
  ['overlook_cliff', 300, 880, 2], ['pond_small', 690, 930, 0], ['pond_small_2', 650, 950, 0], ['mossy_boulders', 760, 860, 0], ['tree_dead', 400, 960, 0], ['ruin_bowls', 360, 880, 0],
  // village on the isle
  ['house_straw_hut', 1480, 240, 0], ['house_straw_hut_2', 1540, 210, 1], ['house_straw_hut', 1580, 290, 2], ['house_straw_hut_2', 1500, 320, 0], ['house_straw_hut', 1640, 340, 3], ['house_straw_hut_2', 1720, 300, 0],
  ['well', 1600, 240, 0], ['garden_beds', 1700, 350, 0], ['market_stall', 1630, 190, 2], ['campfire_camp_2', 1560, 360, 0], ['hay_stack_2', 1760, 250, 0], ['fence_gate', 1400, 360, 1], ['fence_straight_2', 1440, 320, 1],
  // ledge with the catapult beyond the bridge
  ['cart_broken_2', 1850, 830, 0], ['stump_logs_2', 1860, 900, 0],
  // islet and rock
  ['jungle_tree_small', 350, 520, 0], ['boulder_group_2', 520, 1480, 0], ['boulder_single', 610, 1330, 0],
  // roadsides
  ['tree_oak', 1260, 1400, 0], ['tree_oak_2', 1600, 1300, 0], ['bush_cluster', 1420, 1250, 0], ['bush_cluster_2', 1200, 1000, 0],
];

/** Regular mob at a post: aggro — sees the hero from this distance (smaller for ambushes), route — walks the points until it notices */
interface Post { kind: string; x: number; z: number; aggro?: number; route?: [number, number][] }

const at = (kind: string, pts: number[][], aggro?: number): Post[] => pts.map(([x, y]) => ({ kind, x: px(x), z: pz(y), ...(aggro ? { aggro } : {}) }));
const patrol = (kinds: string[], line: number[]): Post[] => {
  const route: [number, number][] = []; for (let i = 0; i < line.length; i += 2) route.push(P(line[i], line[i + 1]));
  return kinds.map((kind, i) => ({ kind, x: route[0][0] + (i % 2 ? 1.2 : -1.2) * (i > 1 ? 1 : 0.5), z: route[0][1] + (i > 1 ? 1.4 : 0), route }));
};

/** Enemy groups per the plan: id, title, entry (where the hero comes from), posts; the rectangle is computed from the posts */
const GROUPS: [string, string, [number, number], Post[]][] = [
  ['palms', 'Palms: warm-up', [850, 1430], [...at('berryling', [[905, 1460], [930, 1485], [955, 1455], [920, 1500]]), ...at('slime', [[975, 1500], [990, 1460]])]],
  ['ambush1', 'Ambush: beetles below the road', [960, 1320], at('beetle', [[990, 1300], [1020, 1340]], 3)],
  ['springs', 'Hot springs: beasts', [1100, 1520], [...at('boarlet', [[1140, 1590], [1180, 1605]]), ...at('beetle', [[1105, 1545], [1215, 1545]], 4)]],
  ['patrol1', 'Patrol: gardeners', [1000, 1480], patrol(['gardener', 'gardener'], [1000, 1480, 1150, 1535, 1250, 1540])],
  ['tower', 'Watchtower: archers', [1280, 1500], at('archer', [[1300, 1470], [1340, 1520]])],
  ['camp', 'Gardeners\' camp', [1300, 1640], [...at('reaper', [[1340, 1630], [1375, 1620], [1390, 1665]]), ...at('gardener', [[1330, 1675], [1360, 1690], [1405, 1640]])]],
  ['wolves', 'Wolves in the grove', [1400, 1360], at('wolf', [[1430, 1300], [1455, 1320], [1415, 1330]])],
  ['ambush2', 'Ambush: web on the road', [1400, 1160], [...at('spider', [[1330, 1080]], 6), ...at('berryling', [[1300, 1060], [1360, 1100], [1310, 1110], [1350, 1050]], 4)]],
  ['patrol2', 'Order patrol: hamlet — fort', [1400, 1160], patrol(['spear', 'squire', 'squire'], [1385, 1190, 1330, 1080, 1270, 1000, 1250, 940])],
  ['garden', 'Thorn garden', [1270, 1000], [...at('vine', [[1215, 905], [1265, 905], [1240, 965]]), ...at('bud', [[1195, 950], [1300, 950]]), ...at('horror', [[1240, 870]]), ...at('scarecrow', [[1315, 900]])]],
  ['spiders', 'Vine weavers by the river', [1100, 1000], [...at('spider', [[1050, 930], [1080, 965]]), ...at('hive', [[1040, 985]])]],
  ['ambush7', 'Ambush: buds by the bridge', [1500, 860], at('bud', [[1545, 845], [1575, 938]], 7)],
  ['ambush3', 'Ambush at the fort gate', [1330, 700], at('hedgehog', [[1395, 500], [1425, 500]], 9)],
  ['fort', 'The Order\'s fort', [1300, 760], [...at('shield', [[1322, 650], [1450, 612]]), ...at('squire', [[1300, 610], [1300, 690], [1462, 655]]), ...at('spear', [[1340, 560], [1445, 632]]), ...at('crossbow', [[1318, 582], [1450, 748]]), ...at('banner', [[1385, 710]]), ...at('hammer', [[1405, 725]])]],
  ['patrol3', 'Order patrol: fort — temple', [1300, 640], patrol(['shield', 'crossbow'], [1250, 600, 1180, 560, 1140, 500])],
  ['ambush4', 'Ambush: wisps in the ruins', [1140, 500], [...at('wisp', [[1150, 520], [1120, 540], [1170, 560]], 7), ...at('keg', [[1200, 560], [1215, 585]], 7)]],
  ['temple', 'Temple guard', [1080, 470], [...at('pyro', [[1048, 598], [1052, 648]]), ...at('healer', [[1040, 625]]), ...at('summoner', [[1040, 560]]), ...at('obelisk', [[1112, 672]]), ...at('druseling', [[1042, 692], [1112, 718]]), ...at('mimic', [[1045, 730], [1135, 745]])]],
  ['patrol4', 'Slimes on the path', [1000, 760], patrol(['slime', 'slime', 'slime'], [1000, 760, 960, 820, 880, 900])],
  ['pond', 'Pond on the hill', [780, 1000], [...at('slime', [[690, 905], [720, 940], [660, 920]]), ...at('bud', [[622, 978], [740, 970]])]],
  ['ambush6', 'Ambush: pot from the rock', [900, 500], at('pot', [[848, 428]], 7)],
  ['snowcave', 'Snow cave', [780, 360], [...at('wisp', [[750, 350], [805, 352], [775, 310]]), ...at('pot', [[815, 335], [740, 330]]), ...at('keg', [[765, 275], [787, 275], [776, 283]], 6)]],
  ['ambush5', 'Ambush: boarlet on the path', [790, 1200], at('boarlet', [[640, 1160]], 7)],
  ['patrol5', 'Wolves in the palms', [790, 1200], patrol(['wolf', 'wolf', 'wolf'], [790, 1200, 700, 1150, 600, 1110, 500, 1100, 420, 1100])],
  ['grotto', 'Grotto', [345, 1088], at('mimic', [[262, 1092]])],
  ['ledge', 'Ledge with the catapult', [1800, 880], [...at('keg', [[1830, 860], [1850, 900], [1870, 870]], 8), ...at('mimic', [[1880, 920]])]],
  ['islet', 'Islet', [455, 585], at('mimic', [[390, 540]])],
  ['rock', 'Rock by the start', [600, 1385], at('hedgehog', [[590, 1470], [545, 1495]])],
  ['glade', 'Soller by the statue', [360, 930], at('soller', [[350, 925]])],
];

/** Magic chests, crates, barrels, health fountain: [kind, x, y] */
const ITEMS: [string, number, number][] = [
  ['chest', 1115, 1590], ['chest', 1830, 920], ['chest', 420, 560], ['chest', 600, 1500], ['chest', 775, 288], ['chest', 268, 1080], ['chest', 230, 905], ['chest', 900, 470], ['chest', 1205, 712], ['chest', 1380, 1700], ['chest', 1240, 880], ['chest', 1575, 230],
  ['crate', 770, 1440], ['crate', 790, 1450], ['crate', 1350, 1510], ['crate', 1500, 1175], ['crate', 1520, 1165], ['crate', 1225, 1020], ['crate', 1470, 660], ['crate', 1485, 675], ['crate', 1038, 755], ['crate', 1040, 772], ['crate', 1612, 300], ['crate', 1628, 292], ['crate', 1800, 900], ['crate', 1815, 912], ['crate', 640, 965], ['crate', 768, 300], ['crate', 1130, 825], ['crate', 1340, 700],
  ['barrel', 1290, 675], ['barrel', 1305, 668], ['barrel', 1295, 690], ['barrel', 1320, 1672], ['barrel', 1342, 1680], ['barrel', 1190, 575], ['barrel', 1820, 850],
  ['terminal', 1645, 265],
];

const FORT = { x0: 1265, y0: 525, x1: 1505, y1: 765, gates: [[1305, 765], [1390, 525]] as [number, number][] };
const TEMPLE = { x0: 800, y0: 480, x1: 1020, y1: 790, gates: [[1020, 630], [1000, 790], [900, 480]] as [number, number][] };

export function buildIslandMap(lib: Record<string, LibraryPrefab>): Level {
  const L = new Level('Island');
  const N = 128;
  const grid = <T,>(v: T): T[] => new Array(256 * 256).fill(v);
  const I = (x: number, z: number): number => (z + N) * 256 + (x + N);
  const inMap = (x: number, z: number): boolean => x >= -N && x < N && z >= -N && z < N;
  /** Ragged shore: the coordinate tested against the polygon is distorted by noise */
  const warp = (x: number, z: number): [number, number] => [x + (noise2(x, z, 9, 11) - 0.5) * 5, z + (noise2(x, z, 9, 12) - 0.5) * 5];
  const land = grid(false), ring = grid(false), used = grid(false), biome = grid<Biome>('base');
  for (let z = -N; z < N; z++) for (let x = -N; x < N; x++) {
    const [wx, wz] = warp(x, z);
    land[I(x, z)] = LANDS.some((p) => inside(p, wx, wz));
    for (const [b, p] of BIOMES) if (inside(p, wx, wz)) { biome[I(x, z)] = b; break; }
  }
  // rim: land cells next to the sea
  for (let z = -N; z < N; z++) for (let x = -N; x < N; x++) {
    if (!land[I(x, z)]) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!inMap(x + dx, z + dz) || !land[I(x + dx, z + dz)]) { ring[I(x, z)] = true; break; }
  }
  const coastDist = grid(99);
  { // distance to the rim — for the sandy beach
    const q: number[] = [];
    for (let i = 0; i < 256 * 256; i++) if (ring[i]) { coastDist[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = (i % 256) - N, z = Math.floor(i / 256) - N;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!inMap(x + dx, z + dz)) continue;
        const j = I(x + dx, z + dz);
        if (land[j] && coastDist[j] > coastDist[i] + 1) { coastDist[j] = coastDist[i] + 1; q.push(j); }
      }
    }
  }
  const topOf = (x: number, z: number): string => {
    const b = biome[I(x, z)];
    if (b === 'snow') return 'snow';
    if (b === 'jungle') return jungleGroundAt(x, z, 3);
    if (coastDist[I(x, z)] <= 2 && hash2(x, z, 4) < 0.85) return 'sand';
    if (b === 'springs') return hash2(x, z, 5) < 0.12 ? 'gravel' : 'grass';
    return 'grass';
  };
  const rockTopOf = (x: number, z: number): string => { const b = biome[I(x, z)]; return b === 'snow' ? 'cliff_snow' : b === 'jungle' ? 'cliff_jungle' : 'cliff_grass'; };
  // ---------- ground and sea ----------
  for (let z = -N; z < N; z++) for (let x = -N; x < N; x++) {
    if (!land[I(x, z)]) { L.set(x, -1, z, 'water'); L.set(x, -2, z, 'sand'); continue; }
    L.set(x, -2, z, 'dirt');
    if (ring[I(x, z)]) {
      // rock rim of the shore: a block that cannot be stepped over; one block taller in places
      L.set(x, -1, z, 'cliff');
      const tall = noise2(x, z, 5, 13) > 0.6;
      L.set(x, 0, z, tall ? 'cliff' : rockTopOf(x, z));
      if (tall) L.set(x, 1, z, rockTopOf(x, z));
      used[I(x, z)] = true;
      continue;
    }
    L.set(x, -1, z, topOf(x, z));
  }
  // ---------- rivers (fordable) ----------
  const river = grid(false);
  const walk = (line: Line, r: number, cb: (x: number, z: number, dx: number, dz: number, far: boolean) => void): void => {
    for (let i = 0; i + 3 < line.length; i += 2) {
      const [ax, az] = P(line[i], line[i + 1]), [bx, bz] = P(line[i + 2], line[i + 3]);
      const len = Math.hypot(bx - ax, bz - az), n = Math.ceil(len * 2);
      for (let k = 0; k <= n; k++) {
        const t = k / n, cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
        for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) for (let z = Math.floor(cz - r - 1); z <= Math.ceil(cz + r + 1); z++) {
          const d = Math.hypot(x - cx, z - cz);
          if (d <= r + 1 && inMap(x, z)) cb(x, z, bx - ax, bz - az, d > r);
        }
      }
    }
  };
  for (const line of RIVERS) walk(line, 1.6, (x, z, dx, dz, far) => {
    const i = I(x, z);
    if (!land[i] || ring[i] || coastDist[i] <= 1) return;
    if (far) { if (!river[i] && hash2(x, z, 6) < 0.5) L.set(x, -1, z, 'sand'); return; }
    const rot = Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 0 : 2) : dz > 0 ? 1 : 3;
    L.set(x, -1, z, 'river', rot); L.set(x, -2, z, 'sand'); river[i] = true; used[i] = true;
  });
  // ---------- roads: paths and flagstones, decking across the river ----------
  const road = grid(false);
  for (const [kind, line] of ROADS) walk(line, 1.5, (x, z, _dx, _dz, far) => {
    const i = I(x, z);
    if (!land[i] || ring[i]) return;
    if (far && noise2(x, z, 3, 14) < 0.62) return;
    road[i] = true; used[i] = true;
    if (river[i]) { L.set(x, -1, z, 'bridge_deck', 0); return; }
    const v = hash2(x, z, 7);
    L.set(x, -1, z, kind === 'tiles' ? (v < 0.8 ? 'tiles' : 'tiles_broken') : 'path');
  });
  // ---------- rocks and caves ----------
  for (const [cx, cy, rx, ry, h, seed] of ROCKS) {
    const [x, z] = P(cx, cy);
    rockOutcrop(L, x, z, rx * SX, ry * SZ, h, 0, 100 + seed);
    for (let xx = Math.floor(x - rx * SX - 3); xx <= Math.ceil(x + rx * SX + 3); xx++) for (let zz = Math.floor(z - ry * SZ - 3); zz <= Math.ceil(z + ry * SZ + 3); zz++) {
      if (!inMap(xx, zz)) continue;
      const t = L.topAt(xx, zz);
      if (t !== null && t >= 0) { used[I(xx, zz)] = true; if (L.nameAt(xx, t, zz) === 'cliff_grass') L.set(xx, t, zz, rockTopOf(xx, zz)); }
      if (!land[I(xx, zz)]) { for (let y = -1; y <= 12; y++) L.set(xx, y, zz, 'air'); L.set(xx, -1, zz, 'water'); }
    }
  }
  for (const [ex, ey, dx, dz] of CAVES) {
    const [x, z] = P(ex, ey);
    // a 3 × 3 passage 5 cells deep, then a 7 × 7 hall 3 high; the vault is rock, the floor is stone, crystals in the hall
    const carve = (cx: number, cz: number, r: number, h: number) => {
      for (let xx = cx - r; xx <= cx + r; xx++) for (let zz = cz - r; zz <= cz + r; zz++) {
        for (let y = 0; y < h; y++) L.set(xx, y, zz, 'air');
        L.set(xx, -1, zz, hash2(xx, zz, 8) < 0.3 ? 'cobble' : 'stone');
        if (L.isAir(xx, h, zz)) L.set(xx, h, zz, 'cliff_dark');
        used[I(xx, zz)] = true;
      }
    };
    for (let k = -1; k <= 5; k++) carve(x + dx * k, z + dz * k, 1, 3);
    const hx = x + dx * 8, hz = z + dz * 8;
    carve(hx, hz, 3, 3);
    for (const [ox, oz] of [[-3, -3], [3, -3], [-3, 3], [3, 3], [0, -3], [3, 0]] as const) if (L.isAir(hx + ox, 0, hz + oz)) L.set(hx + ox, 0, hz + oz, 'crystal_small');
    L.set(hx - 2, 2, hz - 2, 'torch'); L.set(hx + 2, 2, hz + 2, 'torch');
    L.set(x - dz, 0, z - dx, 'torch'); L.set(x + dz, 0, z + dx, 'torch');
  }
  // ---------- bridges over the straits ----------
  for (const [ax, ay, bx, by] of SEA_BRIDGES) {
    const [x0, z0] = P(ax, ay), [x1, z1] = P(bx, by);
    const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
    const a = alongX ? Math.min(x0, x1) : Math.min(z0, z1), b = alongX ? Math.max(x0, x1) : Math.max(z0, z1), c = alongX ? z0 : x0;
    for (let t = a; t <= b; t++) {
      const x = alongX ? t : c, z = alongX ? c : t;
      for (let w = -1; w <= 1; w++) {
        const xx = alongX ? x : x + w, zz = alongX ? z + w : z;
        for (let y = 0; y <= 2; y++) L.set(xx, y, zz, 'air');
        L.set(xx, -1, zz, 'bridge_deck', alongX ? 1 : 0); L.set(xx, -2, zz, 'bridge_beam', alongX ? 0 : 1);
        used[I(xx, zz)] = true; ring[I(xx, zz)] = false;
      }
      for (const w of [-2, 2]) {
        const xx = alongX ? x : x + w, zz = alongX ? z + w : z;
        if (!land[I(xx, zz)] || ring[I(xx, zz)]) { for (let y = 0; y <= 2; y++) L.set(xx, y, zz, 'air'); L.set(xx, -1, zz, 'bridge_beam', alongX ? 0 : 1); L.set(xx, 0, zz, (t - a) % 4 === 0 ? 'bridge_post' : 'fence'); used[I(xx, zz)] = true; }
      }
    }
    // flat ground at the ends, the rim is removed 2 cells around
    for (const [x, z] of [[x0, z0], [x1, z1]]) for (let xx = x - 2; xx <= x + 2; xx++) for (let zz = z - 2; zz <= z + 2; zz++) {
      if (!land[I(xx, zz)] || L.nameAt(xx, -1, zz) === 'bridge_deck') continue;
      if (ring[I(xx, zz)]) { ring[I(xx, zz)] = false; L.set(xx, -1, zz, 'path'); L.set(xx, 0, zz, 'air'); L.set(xx, 1, zz, 'air'); }
    }
  }
  // ---------- fort: palisade with gates ----------
  {
    const [x0, z0] = P(FORT.x0, FORT.y0), [x1, z1] = P(FORT.x1, FORT.y1);
    const gates = FORT.gates.map(([gx, gy]) => P(gx, gy));
    for (let x = x0; x <= x1; x++) for (const z of [z0, z1]) if (!gates.some(([gx, gz]) => Math.abs(gx - x) <= 1 && Math.abs(gz - z) <= 1) && hash2(x, z, 9) < 0.93) { L.set(x, 0, z, 'stake_fence'); if (x % 2 === 0) L.set(x, 1, z, 'stake_fence'); used[I(x, z)] = true; }
    for (let z = z0; z <= z1; z++) for (const x of [x0, x1]) if (hash2(x, z, 9) < 0.93) { L.set(x, 0, z, 'stake_fence'); if (z % 2 === 0) L.set(x, 1, z, 'stake_fence'); used[I(x, z)] = true; }
    for (const [gx, gz] of gates) for (let d = -1; d <= 1; d++) { L.set(gx + d, -1, gz, 'path'); L.set(gx + d, 0, gz, 'air'); L.set(gx + d, 1, gz, 'air'); }
    for (const [gx, gz] of gates) { L.addDecor({ name: 'banner', pos: [gx - 2, 1.4, gz + 0.5], rot: [0], on: [gx - 2, 1, gz] }); L.addDecor({ name: 'banner', pos: [gx + 2, 1.4, gz + 0.5], rot: [0], on: [gx + 2, 1, gz] }); }
    for (let x = x0 + 1; x < x1; x++) for (let z = z0 + 1; z < z1; z++) if (!road[I(x, z)] && hash2(x, z, 10) < 0.35 && L.nameAt(x, -1, z) === 'grass') L.set(x, -1, z, 'dirt');
  }
  // ---------- temple: the warden arena's fence with three gates ----------
  const temple = { x0: px(TEMPLE.x0), z0: pz(TEMPLE.y0), x1: px(TEMPLE.x1), z1: pz(TEMPLE.y1), gates: TEMPLE.gates.map(([gx, gy]) => P(gx, gy)) };
  {
    const { x0, z0, x1, z1, gates } = temple;
    const wall = (x: number, z: number): void => {
      if (gates.some(([gx, gz]) => Math.abs(gx - x) <= 2 && Math.abs(gz - z) <= 2)) { L.set(x, -1, z, 'tiles'); L.set(x, 0, z, 'air'); L.set(x, 1, z, 'air'); L.set(x, 2, z, 'air'); return; }
      const h = 2 + (noise2(x, z, 4, 15) > 0.55 ? 1 : 0);
      for (let y = 0; y < h; y++) L.set(x, y, z, y === 1 && (x + z) % 4 === 0 ? 'temple_stone_carved' : hash2(x, z, 16) < 0.2 ? 'temple_stone_mossy' : 'temple_stone');
      used[I(x, z)] = true;
    };
    for (let x = x0; x <= x1; x++) { wall(x, z0); wall(x, z1); }
    for (let z = z0; z <= z1; z++) { wall(x0, z); wall(x1, z); }
    for (const [gx, gz] of gates) { L.addDecor({ name: 'vines_hanging', pos: [gx - 2.5, 2.2, gz + 0.5], rot: [0], on: [gx - 3, 2, gz] }); L.set(gx - 3, 0, gz + (gz === z0 ? 1 : -1), 'torch'); L.set(gx + 3, 0, gz + (gz === z0 ? 1 : -1), 'torch'); }
  }
  // ---------- prefabs ----------
  const stamp = (id: string, x: number, z: number, q = 0): void => {
    const p = lib[id];
    if (!p) throw new Error(`No prefab "${id}"`);
    const r = stampPrefab(L, p, x, 0, z, q);
    for (const d of r.decor) L.addDecor(d);
    L.entities.push(...r.entities);
    const rx = Math.ceil((q % 2 ? p.size[2] : p.size[0]) / 2) + 1, rz = Math.ceil((q % 2 ? p.size[0] : p.size[2]) / 2) + 1;
    for (let xx = x - rx; xx <= x + rx; xx++) for (let zz = z - rz; zz <= z + rz; zz++) if (inMap(xx, zz)) used[I(xx, zz)] = true;
  };
  for (const [id, x, y, q] of PREFABS) stamp(id, px(x), pz(y), q);
  // start: tent and signpost
  L.addDecor({ name: 'tent', pos: [px(735) - 4, 0, pz(1415) - 3], rot: [160] });
  L.addDecor({ name: 'signpost', pos: [px(760), 0, pz(1400)], rot: [30] });
  // ---------- mob posts, loot and merchants — the ground under them stays clear ----------
  const rooms: MobRoomSpec[] = [];
  for (const [id, title, enter, posts] of GROUPS) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const take = (x: number, z: number) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
    for (const p of posts) { take(p.x, p.z); for (const [rx, rz] of p.route ?? []) take(rx, rz); }
    for (const p of posts) for (let xx = Math.floor(p.x) - 1; xx <= Math.ceil(p.x) + 1; xx++) for (let zz = Math.floor(p.z) - 1; zz <= Math.ceil(p.z) + 1; zz++) used[I(xx, zz)] = true;
    rooms.push({ id, title, x0: x0 - 6, x1: x1 + 6, z0: z0 - 6, z1: z1 + 6, enter: { x: px(enter[0]), z: pz(enter[1]), yaw: 0 }, posts, respawn: false });
  }
  for (const [kind, x, y] of ITEMS) {
    const [wx, wz] = P(x, y);
    L.entities.push({ kind, x: wx, y: 0, z: wz, rot: Math.floor(hash2(wx, wz, 17) * 360) });
    for (let xx = wx - 1; xx <= wx + 1; xx++) for (let zz = wz - 1; zz <= wz + 1; zz++) used[I(xx, zz)] = true;
  }
  const merchants = [
    { kind: 'smith', x: px(1680), z: pz(205), yaw: 0 }, { kind: 'merchant', x: px(1715), z: pz(240), yaw: -Math.PI / 2 },
    { kind: 'merchant', x: px(1418), z: pz(1104), yaw: Math.PI / 2 },
  ];
  for (const m of merchants) for (let xx = m.x - 2; xx <= m.x + 2; xx++) for (let zz = m.z - 2; zz <= m.z + 2; zz++) used[I(xx, zz)] = true;
  // ---------- warden arena: inside the temple fence, the warden at the foot of the pyramid ----------
  const [ex, ez] = temple.gates[0];
  const arena: BossArenaSpec = {
    id: 'druse', title: 'Druse Golem',
    x0: temple.x0 + 1, x1: temple.x1 - 1, z0: temple.z0 + 1, z1: temple.z1 - 1,
    gate: { x: ex, z: ez, rot: Math.PI / 2 },
    gates: temple.gates.map(([gx, gz]) => ({ x: gx, z: gz, w: 5, rot: gx === temple.x1 ? Math.PI / 2 : 0 })),
    trigger: { x0: temple.x0 + 2, x1: temple.x1 - 2, z0: temple.z0 + 2, z1: temple.z1 - 2 },
    exit: { x: ex + 4, z: ez, yaw: -Math.PI / 2 },
    home: { x: px(930), z: pz(690), yaw: Math.PI / 2 },
  };
  for (let xx = arena.home!.x - 3; xx <= arena.home!.x + 3; xx++) for (let zz = arena.home!.z - 3; zz <= arena.home!.z + 3; zz++) used[I(xx, zz)] = true;
  // ---------- forest and grass ----------
  const free = (x: number, z: number, r: number): boolean => {
    for (let xx = x - r; xx <= x + r; xx++) for (let zz = z - r; zz <= z + r; zz++) if (!inMap(xx, zz) || !land[I(xx, zz)] || used[I(xx, zz)] || river[I(xx, zz)] || L.topAt(xx, zz) !== -1) return false;
    return true;
  };
  const mark = (x: number, z: number, r: number): void => { for (let xx = x - r; xx <= x + r; xx++) for (let zz = z - r; zz <= z + r; zz++) if (inMap(xx, zz)) used[I(xx, zz)] = true; };
  for (const [kind, p, density] of FORESTS) {
    for (let z = -N; z < N; z++) for (let x = -N; x < N; x++) {
      if (!land[I(x, z)] || !inside(p, x, z) || hash2(x, z, 18) > density) continue;
      const r = hash2(x, z, 19);
      if (kind === 'oak') {
        if (!free(x, z, 3)) continue;
        if (r < 0.3) stamp(r < 0.1 ? 'tree_golden_big' : 'tree_golden_small', x, z); else tree(L, x, 0, z, 3 + (r > 0.7 ? 1 : 0), 2);
        mark(x, z, 3);
      } else if (kind === 'jungle') {
        const big = r < 0.3;
        if (!free(x, z, big ? 4 : 3)) continue;
        stamp(big ? (r < 0.15 ? 'jungle_tree_big' : 'jungle_tree_big_2') : r < 0.65 ? 'jungle_tree_small' : 'jungle_tree_small_2', x, z);
      } else if (kind === 'pine') {
        if (!free(x, z, 2)) continue;
        stamp(r < 0.5 ? 'tree_pine_snow' : r < 0.85 ? 'tree_pine_snow_2' : 'tree_dead_snow', x, z);
      } else if (kind === 'palmvillage') {
        if (!free(x, z, 3)) continue;
        stamp(r < 0.5 ? 'jungle_tree_small' : 'jungle_tree_small_2', x, z);
      }
    }
  }
  const FLORA = ['tall_grass', 'tall_grass', 'fern', 'flower_red', 'flower_yellow', 'flower_blue', 'flower_white', 'daisies'];
  for (let z = -N; z < N; z++) for (let x = -N; x < N; x++) {
    const i = I(x, z);
    if (!land[i] || used[i] || !L.isAir(x, 0, z)) continue;
    const top = L.nameAt(x, -1, z), h = hash2(x, z, 20);
    if (top === 'grass' && h < 0.08) L.set(x, 0, z, biome[i] === 'springs' ? (h < 0.06 ? 'dry_grass' : 'tall_grass') : FLORA[Math.floor(hash2(x, z, 21) * FLORA.length)]);
    else if (top === 'gravel' && h < 0.1) L.set(x, 0, z, 'dry_grass');
    else if (top.startsWith('jungle_floor') && h < 0.05) L.set(x, 0, z, hash2(x, z, 22) < 0.5 ? 'fern_big' : 'flower_pink');
  }
  // Soller's sunny glade: a ring of flowers
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2, x = Math.round(px(350) + Math.cos(a) * 2.8), z = Math.round(pz(925) + Math.sin(a) * 2.8);
    if (L.nameAt(x, -1, z) === 'grass' && L.isAir(x, 0, z)) L.set(x, 0, z, i % 3 ? 'flower_yellow' : 'flower_white');
  }

  L.spawn = [px(745), 0, pz(1445)];
  L.meta = {
    spawnYaw: 0,
    goal: ['Reach the temple and defeat the Druse Golem', 'Island'],
    mobRooms: rooms,
    arenas: [arena],
    merchants,
  };
  L.dirty.clear();
  return L;
}
