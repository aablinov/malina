import * as THREE from 'three';
import { initAudio, sfx, toggleMute } from '../audio';
import { Music } from '../music';
import { Lighting } from '../lighting';
import { Props, type LootKind } from '../props';
import { type Obstacle } from '../collision';
import { FX } from '../fx';
import { Perf } from './perf';
import { warmUp } from '../fx-zoo';
import { emptyInput, Knight, type Strike } from '../knight';
import type { Target } from '../target';
import { makeTextures, rng } from '../textures';
import { Level, type LevelJSON } from '../level/level.ts';
import { LevelRenderer, liquidTime } from '../level/mesher';
import { ceilingAt, collideTop, decorSolids, obstaclesOf, raycastVoxels, terrainOf } from '../level/collide.ts';
import { Pathfinder } from '../level/pathfind.ts';
import { mapByName, ROOMS } from '../level/maps';
import { buildFloor } from '../level/dungeon.ts';
import { surfaceAt } from '../level/kit.ts';
import { worldSource } from '../world/gen.ts';
import { RegionManager } from '../world/regions.ts';
import { mapSource, STREAM_CHUNKS } from '../world/map-source.ts';
import { BOSS_ARENAS, MOB_ROOMS, type BossArenaSpec, type MobRoomSpec, type PgLabel } from '../level/playground-map.ts';
import { Arena } from '../bosses/arena';
import { BossBar } from '../bosses/boss-bar';
import { MINI_BOSSES } from '../bosses/roster';
import type { MiniBoss } from '../bosses/mini';
import { Grimoire } from '../bosses/grimoire';
import { Pack } from '../mobs/pack';
import { MOB_PARTS, MOBS, SQUADS, TD_FOES } from '../mobs/roster';
import { HERO, SWORD, snapshotTuning } from '../tuning';
import { getWeapon, onWeaponChange, pickWeapon, weapons } from '../weapons';
import { MELEE_ENCHANTS, TEMPER_LOOK, type MeleeEnchant } from '../temper';
import { weaponHit, weaponSwing } from '../weapon-audio';
import { enchantDef, itemDef, Profile } from '../items';
import { arrowsLootMesh, Gear, itemLootMesh } from '../gear';
import { Hud } from '../hud/hud';
import { Inventory } from '../hud/inventory';
import { AutoMap } from '../hud/automap';
import { Shop } from '../hud/shop';
import { Merchant, MERCHANT_TITLE } from '../merchants';
import { Weather } from '../weather';
import { aimLight, lightData, makeLight, worldOf } from '../world';
import { Dummy } from './dummies';
import { Overlays } from './overlay';
import { DEV_TOOLS, fromMenu, openEditor } from '../devflag';
import { loadSettings, pixelRatio } from '../menu/settings';
import { applyAudio, SettingsPanel } from '../menu/settings-panel';
import { BattleMenu } from '../menu/pause';
import { markWon, stashBerries, stashGear } from '../menu/session';
import { campaignMap } from '../menu/campaign';
import { TowerDefense, type Pad } from '../td/td';
import { LavaFx } from '../td/lava-fx';
import { MistFx } from '../td/mist-fx';
import type { TdSpec } from '../td/types';
import { button, Panel, select, toggle } from './panel';
import '../style.css';
import './playground.css';

declare global {
  interface Window { __malina?: unknown }
}

/**
 * ?map=editor — автосохранение редактора (кнопка «Играть»), ?map=dungeon&seed=42&floor=2 — этаж подземелья из комнат-заготовок,
 * ?map=<имя> — файл из assets/maps/, иначе playground.json
 */
function pickMap(): LevelJSON {
  const q = new URLSearchParams(window.location.search);
  const name = q.get('map');
  if (name === 'dungeon') return buildFloor({ seed: Number(q.get('seed')) || 1, floor: Number(q.get('floor')) || 1, rooms: ROOMS }).toJSON();
  if (name === 'editor') {
    try {
      const raw = localStorage.getItem('malina.editor.level');
      if (raw) return JSON.parse(raw) as LevelJSON;
    } catch { /* нет сохранения — плейграунд */ }
  } else if (name) {
    const j = mapByName(name);
    if (j) return j;
  }
  const j = mapByName('playground');
  if (!j) throw new Error('Нет карты assets/maps/playground.json — запусти npm run map:playground');
  return j;
}

export function runPlayground(): void {
  /**
   * Плейграунд: основная сцена разработки (ADR-004). Арена из блоков, соломенные чучела для меча, склад, пруд,
   * ступени на площадку, витрина блоков. Механики живут в общих модулях (knight.ts, trail.ts), здесь — сцена и отладка.
   */

  // оружие — надетое в инвентаре (src/items.ts); ?weapon=<id> — поверх него, для отладки (src/weapons.ts).
  // Числа надетого — стартовые для «Сброса» в F1
  const urlWeapon = new URLSearchParams(window.location.search).has('weapon') ? pickWeapon() : null;
  const profile = new Profile();
  // настройки из главного меню (src/menu/settings.ts): громкость, качество, постобработка, тени, подсказка
  const settings = loadSettings();
  applyAudio(settings);
  /** Бой начат из главного меню: пауза по Esc, «В лагерь», без отладочной телеметрии */
  const FROM_MENU = fromMenu();
  document.body.classList.add('dev-playground');
  if (FROM_MENU) document.body.classList.add('from-menu');
  document.title = 'Малина — плейграунд';

  const $ = <E extends HTMLElement = HTMLElement>(id: string): E => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Нет элемента #${id}`);
    return el as E;
  };

  // ---------- Рендер ----------
  const canvas = $<HTMLCanvasElement>('c');
  // без MSAA на канвасе: кадр собирает композер в своих буферах (src/lighting.ts), на канвас ложится готовая картинка;
  // плотность пикселей канваса — как у композера, иначе финальный проход и bloom масштабировались бы в пустую
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatio(settings));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  // замеры кадра (F8): CPU симуляции и рендера, вызовы, программы, геометрии; длинные кадры с метками причин
  const perf = new Perf(renderer);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 220);
  const CAM_DIR = new THREE.Vector3(1, 1.38, 1).normalize();
  let camDist = 24;
  /** Для скриншотов и тестов: камера смотрит в заданную точку */
  let camOverride: THREE.Vector3 | null = null;
  const camTarget = new THREE.Vector3();

  // свет и постобработка «как в Unreal» (src/lighting.ts, wiki/style-lighting.md): день — тёплое низкое солнце и голубое небо,
  // ночь — лунный синий, а светят факелы, вода и светлячки; AO, bloom, цветокоррекция, дымка. U — сравнить без них
  const look = new Lighting(renderer, scene, camera);
  const sun = look.sun;
  let night = false;
  function applyNight(): void { look.setNight(night); }
  let postFX = settings.postFX;

  function resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    look.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Сцена ----------
  const T = makeTextures();
  const overlayEl = $('overlay');
  const fx = new FX(scene, camera, T, overlayEl);
  const HALF = 24;
  // Арена и витрина — карта assets/maps/playground.json (генератор src/level/playground-map.ts, `npm run map:playground`,
  // правка — редактор ?dev=editor).
  // Регионы 32 × 32 м (src/world/): в сцену попадают только регионы вокруг героя. Источник — карта целиком в памяти
  // (большая карта стримится сама, любая — с ?stream=1) или процедурный генератор для отладки (?map=world&seed=N)
  const query = new URLSearchParams(window.location.search);
  const WORLD = query.get('map') === 'world';
  /** Открыта карта (?map=…): чучела, склад и подписи плейграунда не ставятся */
  const hasMap = query.has('map');
  const worldSeed = Number(query.get('seed')) || 1;
  const sourceLevel = WORLD ? null : Level.fromJSON(pickMap());
  const STREAM = WORLD || query.has('stream') || (sourceLevel !== null && sourceLevel.chunks.size > STREAM_CHUNKS);
  const level = STREAM ? new Level(sourceLevel?.name ?? 'мир') : sourceLevel!;
  if (STREAM && sourceLevel) { level.adoptPalette(sourceLevel); level.entities.push(...sourceLevel.entities); level.spawn = sourceLevel.spawn; Object.assign(level.meta, sourceLevel.meta); }
  // настройки мира из редактора (meta.world): солнце, небо, дымка, постобработка, погода; поставленный свет — сущности 'light'
  const weather = new Weather(scene);
  if (level.meta.world) {
    const ws = worldOf(level);
    look.applyWorld(ws);
    weather.set(ws.weather.kind, ws.weather.intensity, ws.weather.wind);
    if (!ws.post.enabled) postFX = false;
  }
  for (const e of level.entities) {
    if (e.kind !== 'light') continue;
    const d = lightData(e.data);
    const l = makeLight(d);
    l.position.set(e.x, e.y, e.z);
    aimLight(l, e.rot ?? 0, d.pitch);
    if (d.shadows) { l.castShadow = true; l.shadow.mapSize.set(512, 512); l.shadow.bias = -0.002; }
    scene.add(l);
  }
  const view = new LevelRenderer(scene, level, T);
  if (!settings.shadows) sun.castShadow = false;
  // лава (src/td/lava-fx.ts): дымка над разломами и искры; есть на карте целиком в сцене — при стриминге клетки меняются
  const lavaFx = !STREAM && level.palette.includes('lava') ? new LavaFx(scene, fx, level) : null;
  /** Герой стоит в лаве: ожог раз в 0,4 с */
  let lavaT = 0;
  const terrain = terrainOf(level);
  const pathfinder = new Pathfinder(level, terrain);
  const bounds = level.getBounds() ?? { minX: -HALF, maxX: HALF, minZ: -HALF, maxZ: HALF, minY: -1, maxY: 0 };
  // для врагов и пуль: блоки выше шага и декор с коллайдерами (колонны, фонари, ящики); при стриминге — по загруженным регионам
  const obstacles: Obstacle[] = STREAM ? [] : [...obstaclesOf(level, 0, bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ), ...decorSolids(level)];
  const regionObstacles = new Map<string, Obstacle[]>();
  let obstaclesCache: Obstacle[] | null = null, obstaclesDecorV = -1;
  /** Препятствия врагов сейчас: статичные или по регионам вокруг героя плюс декор */
  const obstaclesNow = (): Obstacle[] => {
    if (!STREAM) return obstacles;
    if (!obstaclesCache || obstaclesDecorV !== level.decorVersion) { obstaclesCache = [...regionObstacles.values()].flat().concat(decorSolids(level)); obstaclesDecorV = level.decorVersion; }
    return obstaclesCache;
  };

  // ---------- Надписи на полу ----------
  function floorLabel(text: string, x: number, z: number, size = 1, rot = 0, color = '#1f3a22'): void {
    const c = document.createElement('canvas');
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    const fs = 64;
    g.font = `700 ${fs}px Rubik, system-ui, sans-serif`;
    const w = Math.ceil(g.measureText(text).width) + 16;
    c.width = w; c.height = fs + 16;
    g.font = `700 ${fs}px Rubik, system-ui, sans-serif`;
    g.fillStyle = color;
    g.textBaseline = 'middle';
    g.fillText(text, 8, c.height / 2);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    const h = 0.55 * size;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(h * (c.width / c.height), h), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
    m.rotation.set(-Math.PI / 2, 0, rot);
    m.position.set(x, 0.012, z);
    scene.add(m);
  }
  for (const l of (level.meta.labels as PgLabel[] | undefined) ?? []) floorLabel(l.text, l.x, l.z, l.size ?? 0.6);
  /** Плейграунд как есть: не карта и не мир */
  const PG = !STREAM && !hasMap;
  if (PG) {
    floorLabel('укрытия', 6.5, -6.6, 0.9);
    floorLabel('колонна', 9, -2.3, 0.9);
    floorLabel('угол', 18, 7, 0.9);
    floorLabel('коридор 3 м · проём 1 м', 7, 18.8, 0.9);
    floorLabel('диагональ', 17, -0.4, 0.9);
  }

  // ---------- Чучела ----------
  const dummies: Dummy[] = [];
  // кучка из четырёх — проверить, что широкий удар задевает нескольких, и одиночное в стороне
  if (PG) for (const [x, z, name] of [[-6, -3, 'чучело 1'], [-7.4, -3.7, 'чучело 2'], [-4.6, -3.7, 'чучело 3'], [-6, -5.2, 'чучело 4'], [-11, 0, 'одиночное']] as [number, number, string][]) {
    dummies.push(new Dummy(scene, overlayEl, 'static', x, z, Math.PI / 4, name));
  }
  if (PG) {
    floorLabel('чучела: ЛКМ — удар, держи — комбо', -6, -1.6, 0.85);
    const rail = new Dummy(scene, overlayEl, 'rail', 0, -17, 0, 'на рельсе');
    rail.railA = -9; rail.railB = 9;
    dummies.push(rail);
    const r = new THREE.Mesh(new THREE.BoxGeometry(18.6, 0.05, 0.16), new THREE.MeshLambertMaterial({ color: '#7a5232' }));
    r.position.set(0, 0.025, -17);
    r.receiveShadow = true;
    scene.add(r);
    floorLabel('подвижное чучело', -9, -15.8, 0.9);
  }

  // ---------- Склад: интерактивные предметы ----------
  const props = new Props(scene, fx, rng(99), {
    explode: (at, r, dmg) => explode(at, r, dmg),
    give: (kind, amount, at, data) => giveLoot(kind, amount, at, data),
    // сундук: ещё связка стрел и случайный предмет снаряжения (луч цвета редкости, как в MCD)
    chestExtra: () => {
      const it = profile.rollLoot();
      return [{ kind: 'arrows', amount: gear.stats.arrowBundle, mesh: arrowsLootMesh() }, { kind: 'item', amount: 1, data: it, mesh: itemLootMesh(it) }];
    },
    sound: (k, v = 0) => {
      if (scripted) return;
      ({
        charge: () => sfx.chestCharge(), burst: () => sfx.chestOpen(), pop: () => sfx.lootPop(v), land: () => sfx.lootLand(),
        itemLand: () => sfx.itemLand(v), berry: () => sfx.berry(v), item: () => sfx.treasure(v),
        pickup: () => sfx.pickup(), break: () => sfx.crateBreak(), heal: () => sfx.ready(), ignite: () => sfx.flame(),
      } as const)[k]();
    },
    // предмет региона исчерпан — в сохранение мира, чтобы после выгрузки и перезагрузки он не вернулся
    changed: (id) => regions?.kill(id),
  }, !PG ? { barrels: [], crates: [], supplies: [], terminals: [] } : {
    barrels: [[-11, 11], [-10.25, 11.6], [-10.9, 10.15], [-6, 12.2], [-3.4, 18]],
    crates: [[-8.6, 14, 0], [-7.6, 14, 0], [-6.6, 14, 0], [-4.2, 15.2, 15], [-12.8, 15.6, 0], [-12.8, 16.6, 0]],
    supplies: [[-9.6, 17.6, 145], [-5.4, 19, 160]],
    terminals: [[-2.6, 10.6, 50]],
  });
  if (PG) floorLabel('склад: бочки, сундуки (F), источник здоровья (F), ящики', -7.5, 21.3, 0.9);
  // карта целиком в сцене (без регионов): её сундуки, ящики, бочки и источники — из сущностей, как у регионов
  if (hasMap && !STREAM) {
    const kinds = new Set(['chest', 'barrel', 'crate', 'terminal']);
    props.addGroup('map', level.entities.filter((e) => kinds.has(e.kind)).map((e, i) => ({ id: `map:${i}`, kind: e.kind as 'chest' | 'barrel' | 'crate' | 'terminal', x: e.x, z: e.z, rot: e.rot ?? 0 })));
  }
  // лавки кузнеца и торговца — на плейграунде, в северо-западном углу (src/merchants.ts)
  // режим «Оборона куста» (src/td/, wiki/design-tower-defence.md): на карте с meta.td — площадки, башни, враги по дорогам
  let td: TowerDefense | null = null;
  const tdSpec = level.meta.td as TdSpec | undefined;
  // туман у лагерей врагов (src/td/mist-fx.ts): точки выхода скрыты
  const mistFx = tdSpec?.mist ? new MistFx(scene, tdSpec.lanes, tdSpec.mist) : null;
  // на карте — из meta.merchants ({ kind, x, z, yaw }), на плейграунде — в северо-западном углу
  const merchantSpecs = hasMap ? ((level.meta.merchants as { kind: 'smith' | 'merchant'; x: number; z: number; yaw: number }[] | undefined) ?? []) : [{ kind: 'smith' as const, x: -17, z: -13, yaw: 0 }, { kind: 'merchant' as const, x: -19, z: -6, yaw: Math.PI / 2 }];
  const merchants: Merchant[] = merchantSpecs.map((m) => new Merchant(scene, overlayEl, T, m.kind, m.x, m.z, m.yaw));
  /** Плоские препятствия героя и пути: предметы склада, декор и лавки (пересобираются, когда меняется одно из них) */
  let solidsCache: Obstacle[] = [], solidsKey: [Obstacle[], number] | null = null;
  const solids = (): Obstacle[] => {
    const p = props.solids;
    if (!solidsKey || solidsKey[0] !== p || solidsKey[1] !== level.decorVersion) {
      solidsCache = [...p, ...decorSolids(level), ...merchants.map((m) => m.solid)];
      solidsKey = [p, level.decorVersion];
    }
    // решётки арены стража — пока подняты; башни обороны
    const gates = arenas.filter((a) => a.solids.length);
    const towers = td ? td.solids : [];
    if (!gates.length && !towers.length) return solidsCache;
    return solidsCache.concat(...gates.map((a) => a.solids), towers);
  };
  /** Нажали F — использовать ближайший предмет */
  let interactReq = false;

  function giveLoot(kind: LootKind, amount: number, at: THREE.Vector3, data?: unknown): void {
    let text = '';
    if (kind === 'berry') { profile.addBerries(amount); text = `+${amount} малины`; }
    else if (kind === 'arrows') { profile.addArrows(amount); text = `+${amount} стрел`; }
    else if (kind === 'item') {
      const d = data as { def: string; power: number };
      profile.add(d.def, d.power);
      profile.save();
      const def = itemDef(d.def);
      hud.banner(`${def.title}<small>Новый предмет — открой инвентарь (I)</small>`, 2.6);
      text = def.title;
    } else { hero.hp = Math.min(hero.maxHp, hero.hp + amount); text = `+${amount} здоровья`; }
    fx.text(at.clone().setY(0.4), text, kind === 'berry' ? 'berry' : kind === 'item' ? 'loot' : 'heal');
  }

  // ---------- Герой ----------
  const fxRand = rng(7);
  const hero = new Knight(scene, T);
  hero.place(0, 4, Math.PI);
  // точка появления карты из редактора (?map=…): клетка и взгляд (meta.spawnYaw, ° — 0 к +X, 90 к +Z)
  if (level.spawn && new URLSearchParams(window.location.search).has('map')) {
    const a = THREE.MathUtils.degToRad((level.meta.spawnYaw as number | undefined) ?? 0);
    hero.place(level.spawn[0], level.spawn[2], Math.atan2(Math.cos(a), Math.sin(a)), level.spawn[1]);
  }
  // снаряжение: оружие, броня, лук, артефакты, зелье, души и опыт (src/gear.ts)
  const gear: Gear = new Gear({
    scene, fx, hero, terrain,
    targets: () => targets(),
    blast: (at, r, dmg) => props.blast(at, r, dmg),
    sound: (k) => {
      if (scripted) return;
      ({ shoot: sfx.dash, potion: sfx.ready, level: sfx.harvest, boom: sfx.blast, horn: sfx.shout, zap: sfx.zap, totem: sfx.plant, dash: sfx.dash, souls: sfx.wave, empty: sfx.empty, hit: sfx.hit } as const)[k]();
    },
    toast: (t) => toast(t),
    banner: (h) => hud.banner(h),
    quiet: () => scripted,
  }, profile);
  if (urlWeapon) { gear.weaponOverride = urlWeapon; gear.apply(); }
  snapshotTuning();
  onWeaponChange((w) => gear.refreshWeapon(w));
  hero.onStep = () => { if (!scripted && hero.grounded) sfx.step(); };
  // свист взмаха и звук попадания — свои у каждого вида оружия (src/weapon-audio.ts)
  hero.onSwing = (step) => { if (!scripted) weaponSwing(gear.arts.category, step); };
  hero.onLand = (v) => {
    if (v > 5) fx.burst(hero.pos.clone().setY(hero.pos.y + 0.05), ['#d8cfa8', '#b9ad88', '#9a8f70'], Math.min(14, Math.round(v)), { speed: 2, up: 1.2, size: 0.1, life: 0.4, gravity: 5 });
    if (!scripted) sfx.land();
  };
  hero.onRoll = () => { if (!scripted) sfx.roll(); };
  hero.onStrike = (s) => strike(s);

  // ---------- Страж: Багровый дракон на арене за северной стеной (src/bosses/, wiki/design-bosses.md) ----------
  const bossBar = new BossBar(document.body);
  // зал стражей за северной стеной: восемь арен, на каждой — свой мини-босс (src/bosses/roster.ts)
  /** Препятствия врагов: уровень, декор и башни обороны (кэш, пока состав тот же) */
  let foeObsCache: Obstacle[] = [], foeObsKey: [Obstacle[], Obstacle[]] | null = null;
  const foeObstacles = (): Obstacle[] => {
    const base = obstaclesNow(), towers = td ? td.foeSolids : [];
    if (!towers.length) return base;
    if (!foeObsKey || foeObsKey[0] !== base || foeObsKey[1] !== towers) { foeObsCache = base.concat(towers); foeObsKey = [base, towers]; }
    return foeObsCache;
  };
  const bossHooks = {
    scene, fx, hero, terrain,
    obstacles: () => foeObstacles(),
    hurtHero: (dmg: number, from: THREE.Vector3, knock: number) => hurtHero(dmg, from, knock),
    quiet: () => scripted,
  };
  const bosses: MiniBoss[] = [];
  const arenas: Arena[] = [];
  /** id арены каждого стража (для тестов и кнопок) */
  const bossIds: string[] = [];
  // арены: зал стражей плейграунда или meta.arenas карты (BossArenaSpec с home и gates)
  const arenaSpecs: BossArenaSpec[] = hasMap ? ((level.meta.arenas as BossArenaSpec[] | undefined) ?? []) : BOSS_ARENAS;
  for (const spec of arenaSpecs) {
    const Ctor = MINI_BOSSES[spec.id];
    if (!Ctor) continue;
    // страж стоит в глубине арены, мордой к воротам (или где сказано в home)
    const left = spec.x0 < 0;
    const home = spec.home ? new THREE.Vector3(spec.home.x, 0, spec.home.z) : new THREE.Vector3(left ? spec.x0 + 6 : spec.x1 - 6, 0, (spec.z0 + spec.z1) / 2);
    const boss = new Ctor(bossHooks, home, spec.home ? spec.home.yaw : left ? Math.PI / 2 : -Math.PI / 2, spec);
    const arena = new Arena(scene, fx, { trigger: spec.trigger, gates: spec.gates ?? [{ x: spec.gate.x, z: spec.gate.z, w: 3, rot: spec.gate.rot }], exit: spec.exit }, boss, bossBar, () => scripted);
    bosses.push(boss);
    arenas.push(arena);
    bossIds.push(spec.id);
  }
  // рядовые мобы Ордена (src/mobs/, wiki/design-mobs.md): выходят по кнопкам F1, малина с павших — кучкой
  const pack = new Pack(bossHooks, (at, n) => props.berries(at, n));
  /** Отряд в 9 м перед героем */
  function spawnSquad(kinds: readonly string[]): void {
    const f = new THREE.Vector3(Math.sin(hero.yaw), 0, Math.cos(hero.yaw));
    pack.squad(kinds, hero.pos.clone().setY(0).addScaledVector(f, 9), kinds.length > 4 ? 3.5 : 2);
  }
  // комнаты мобов за западной стеной (казарма Ордена, Терновый сад): гарнизон стоит на постах и просыпается, когда
  // герой рядом (5 м); весь гарнизон пал, а герой вышел — комната снова полна
  // комнаты мобов: плейграунд — MOB_ROOMS, карта — meta.mobRooms (группы, засады с малым aggro, патрули по route)
  const roomSpecs: MobRoomSpec[] = hasMap ? ((level.meta.mobRooms as MobRoomSpec[] | undefined) ?? []) : MOB_ROOMS;
  const garrison = roomSpecs.length > 0;
  const mobRooms = roomSpecs.map((spec) => ({ spec, pack: new Pack(bossHooks, (at, n) => props.berries(at, n)) }));
  const inRoom = (r: MobRoomSpec, pad: number): boolean => hero.pos.x >= r.x0 - pad && hero.pos.x <= r.x1 + pad && hero.pos.z >= r.z0 - pad && hero.pos.z <= r.z1 + pad;
  function fillRoom(room: (typeof mobRooms)[number]): void {
    room.pack.clear();
    if (!garrison) return;
    for (const p of room.spec.posts) {
      const m = room.pack.spawn(p.kind, new THREE.Vector3(p.x, 0, p.z));
      if (!m) continue;
      // смотрят на вход, видят героя вблизи (засада — ещё ближе), патруль ходит по маршруту
      m.yaw = Math.atan2(room.spec.enter.x - p.x, room.spec.enter.z - p.z);
      m.aggro = Math.min(m.aggro, p.aggro ?? (hasMap ? 9 : 5));
      if (p.route) m.route = p.route.map(([x, z]) => new THREE.Vector3(x, 0, z));
    }
  }
  for (const r of mobRooms) fillRoom(r);
  // масштаб стражей (src/bosses/scaling.ts): уровень — по уровню героя или из панели F1, число игроков — из панели
  let bossLevelPick: 'hero' | string = 'hero';
  let bossPlayers = 1;
  const bossLevel = (): number => bossLevelPick === 'hero' ? profile.data.level : Number(bossLevelPick);
  let scaleKey = '';
  /** Пересчитать здоровье и урон всех стражей, если уровень или число игроков сменились */
  function rescaleBosses(): void {
    const key = `${bossLevel()}/${bossPlayers}`;
    if (key === scaleKey) return;
    scaleKey = key;
    for (const b of bosses) b.setScale(bossLevel(), bossPlayers);
    pack.setScale(bossLevel(), bossPlayers);
    for (const r of mobRooms) r.pack.setScale(bossLevel(), bossPlayers);
    td?.setPlayers(bossPlayers);
  }
  rescaleBosses();
  const grimoires: Grimoire[] = [];
  arenas.forEach((arena, i) => {
    arena.onWin = (at) => {
      // сердце лопнуло: фонтан малины (чем сильнее страж, тем больше) и гримуар — у боссов этажа пара на выбор
      const boss = bosses[i], drops = boss.drops;
      props.fountain(at, boss.berries);
      const side = new THREE.Vector3(Math.cos(boss.yaw), 0, -Math.sin(boss.yaw));
      const pair = drops.map((id, j) => new Grimoire(scene, fx, at.clone().addScaledVector(side, (j - (drops.length - 1) / 2) * 3.2), id, profile.power + 1, () => scripted));
      for (const g of pair) g.siblings = pair.filter((x) => x !== g);
      grimoires.push(...pair);
      const names = drops.map((id) => `«${itemDef(id).title}»`).join(' или ');
      hud.banner(`Страж повержен<small>+${boss.berries} малины · ${drops.length > 1 ? `выбери гримуар: ${names}` : `гримуар ${names}`}</small>`, 3.5);
    };
  });
  /** Удар по герою от стража: урон, цифра, отброс */
  function hurtHero(dmg: number, from: THREE.Vector3, knock: number): void {
    const hp0 = hero.hp;
    if (!hero.hurt(dmg)) return;
    const lost = hp0 - hero.hp;
    if (lost >= 1) fx.text(hero.pos.clone().setY(hero.pos.y + 1.2), `−${Math.round(lost)}`, 'bad');
    if (knock > 0) {
      const d = new THREE.Vector3(hero.pos.x - from.x, 0, hero.pos.z - from.z);
      if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
      hero.vel.addScaledVector(d.normalize(), knock);
      fx.shake = Math.max(fx.shake, 0.3);
    }
    if (!scripted) sfx.hit();
  }

  /** Все цели для удара: чучела, бочки, ящики, страж */
  const targets = (): Target[] => {
    const list: Target[] = [...dummies, ...props.targets];
    for (const b of bosses) if (b.awake) list.push(...b.targets());
    list.push(...pack.targets());
    for (const r of mobRooms) list.push(...r.pack.targets());
    if (td) list.push(...td.targets());
    return list;
  };
  let lastStrike: { s: Strike; t: number } | null = null;

  /** Удар меча: цели в дуге перед героем (и в волне добивающего), без стены между */
  function strike(s: Strike): number {
    lastStrike = { s, t: simTime };
    const fwd = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    const finisher = s.step === 2;
    const impact = s.from.clone().addScaledVector(fwd, 1.5).setY(hero.pos.y);
    const hit = new Set<Target>();
    for (const t of targets()) {
      if (!t.alive || Math.abs(t.pos.y - hero.pos.y) > 1.6) continue;
      const dx = t.pos.x - s.from.x, dz = t.pos.z - s.from.z, d = Math.hypot(dx, dz);
      const inArc = d - t.radius <= s.range && (d < 0.7 || Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - s.yaw), Math.cos(Math.atan2(dx, dz) - s.yaw))) <= s.half + Math.atan(t.radius / Math.max(d, 0.3)));
      const inWave = finisher && Math.hypot(t.pos.x - impact.x, t.pos.z - impact.z) - t.radius <= SWORD.shockR * gear.stats.waveMult;
      if (!inArc && !inWave) continue;
      if (terrain.blocked(s.from.x, s.from.z, t.pos.x, t.pos.z, hero.pos.y + 0.5)) continue;
      hit.add(t);
    }
    let smite = false;
    for (const t of hit) {
      const dir = new THREE.Vector3(t.pos.x - s.from.x, 0, t.pos.z - s.from.z).normalize();
      const point = t.pos.clone().setY(1.1).addScaledVector(dir, -t.radius);
      // сила оружия и зачарования (src/gear.ts): острота, крит, огонь, отбрасывание
      const d = gear.meleeDamage(s.dmg);
      t.hit(d.dmg, dir, point, s.knock * gear.stats.knockMult);
      fx.text(point, d.crit ? `${d.dmg}!` : String(d.dmg), finisher || d.crit ? 'crit' : '');
      fx.burst(point, finisher ? [new THREE.Color(3.4, 2.6, 1.1), '#e8c35a'] : [new THREE.Color(1.8, 2.6, 3.4), '#e8c35a'], 10, { speed: 4, up: 2.5, size: 0.09, life: 0.45, glow: true, gravity: 8 });
      // закалка: вспышка и эффект каждого зачарования (огонь, капли, души, разряд…) — src/weapon-arts.ts
      gear.arts.onHitTarget(t, point, dir, d.crit, finisher);
      gear.onHit(d.dmg, true, t.pos, t);
      smite ||= !finisher && gear.stats.smiteChance > 0 && Math.random() < gear.stats.smiteChance;
    }
    if (smite) {
      // «Сокрушение»: обычный удар тоже даёт волну
      const r = SWORD.shockR * 0.7;
      fx.shock(impact.clone().setY(impact.y + 0.05), r, new THREE.Color(2.4, 1.4, 3.4), 0.35, 0.15);
      for (const t of targets()) if (t.alive && !hit.has(t) && Math.hypot(t.pos.x - impact.x, t.pos.z - impact.z) - t.radius <= r) {
        const v = Math.round(s.dmg * gear.stats.meleeMult * 0.5);
        t.hit(v, new THREE.Vector3(t.pos.x - impact.x, 0, t.pos.z - impact.z).normalize(), t.pos.clone().setY(1), 1);
        fx.text(t.pos.clone().setY(1.1), String(v), 'crit');
      }
    }
    // серп удара, шкала спец-удара, синергии закалки на добивающем
    gear.arts.onStrike(s, [...hit], impact);
    if (finisher) {
      // ударная волна: кольцо по земле, пыль и тряска
      fx.shock(impact.clone().setY(impact.y + 0.05), SWORD.shockR * gear.stats.waveMult, new THREE.Color(3.2, 2.4, 1.0), 0.4, 0.18);
      fx.burst(impact.clone().setY(impact.y + 0.1), ['#d8cfa8', '#b9ad88', '#9a8f70'], 14, { speed: 3.2, up: 2.2, size: 0.12, life: 0.5, gravity: 6 });
      fx.shake = Math.max(fx.shake, 0.55);
      if (!scripted) sfx.quake();
    } else if (hit.size) fx.shake = Math.max(fx.shake, 0.18);
    if (hit.size && !scripted) weaponHit(gear.arts.category, finisher);
    return hit.size;
  }

  /** Взрыв бочки: бьёт героя, чучела и предметы вокруг */
  function explode(at: THREE.Vector3, r: number, dmg: number): void {
    fx.explosion(at.clone().setY(1), r, new THREE.Color(3.4, 1.4, 0.3));
    fx.shake = Math.max(fx.shake, 1);
    if (!scripted) sfx.blast();
    const k = (p: THREE.Vector3) => { const d = Math.hypot(p.x - at.x, p.z - at.z); return d >= r ? 0 : 1 - (d / r) * 0.6; };
    const dir = (p: THREE.Vector3) => new THREE.Vector3(p.x - at.x, 0, p.z - at.z).normalize();
    const kh = k(hero.pos);
    const hp0 = hero.hp;
    if (kh > 0 && hero.hurt(dmg * kh)) fx.text(hero.pos.clone().setY(hero.pos.y + 1), `−${Math.round(hp0 - hero.hp)}`, 'bad');
    for (const d of dummies) if (k(d.pos) > 0) d.hit(dmg * k(d.pos), dir(d.pos), d.pos, 1);
    props.blast(at, r, dmg);
  }

  // ---------- Светлячки: медленно плывут вокруг камеры, ночью ярче ----------
  // Положение каждого светлячка считает вершинный шейдер по сиду и времени (wiki/dev-performance.md): CPU ничего не
  // пересчитывает и не перезаливает матрицы, с кадра в кадр меняются два uniform-а
  const MOTES = 70;
  const moteU = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() } };
  const moteMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.9, 0.7), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  moteMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, moteU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 seed; uniform float uTime; uniform vec3 uCam;
// точка в квадрате 2R вокруг камеры, переносится по кругу, чтобы светлячки не кончались
float wrapR(float v, float o, float R) { return o + mod(v - o + R, 2.0 * R) - R; }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float R = 14.0, t = uTime, a = seed.x, b = seed.y, c = seed.z, d = seed.w;
  float x = wrapR(a * 2.0 * R + sin(t * 0.3 + d * 9.0) * 2.0 + t * 0.15, uCam.x, R);
  float z = wrapR(b * 2.0 * R + cos(t * 0.25 + c * 7.0) * 2.0, uCam.z, R);
  // высота — от земли под камерой, а не от героя: в падении светлячки остаются на месте
  float y = uCam.y + 0.4 + c * 2.6 + sin(t * (0.6 + d) + a * 20.0) * 0.3;
  float s = 0.6 + 0.5 * max(0.0, sin(t * (1.2 + c * 2.0) + b * 30.0));
  transformed = transformed * s + vec3(x, y, z);
}`);
  };
  moteMat.customProgramCacheKey = () => 'motes';
  const moteGeo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
  moteGeo.setAttribute('seed', new THREE.InstancedBufferAttribute(Float32Array.from({ length: MOTES * 4 }, () => fxRand()), 4));
  const motes = new THREE.InstancedMesh(moteGeo, moteMat, MOTES);
  motes.frustumCulled = false;
  scene.add(motes);
  function updateMotes(t: number): void {
    moteMat.opacity = night ? 1 : 0.45;
    moteU.uTime.value = t;
    moteU.uCam.value.copy(camTarget);
  }

  // ---------- Ввод ----------
  const keys = new Set<string>();
  const mouseNdc = new THREE.Vector2();
  const mousePx = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  let mouseSeen = false;
  let lmb = false;
  /** ПКМ держат — стрелять из лука */
  let rmb = false;
  const edges = { roll: false };
  const input = emptyInput();
  /** Ввод из теста (Playwright): клавиатура и мышь игнорируются */
  let scripted = false;

  const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const raycaster = new THREE.Raycaster();

  const panel = new Panel(document.body);
  const overlays = new Overlays(scene, obstacles);

  let timeScale = 1;
  const TIME_SCALES = [1, 0.5, 0.25, 0.1];
  let paused = false;
  let stepOnce = false;
  let showTelemetry = !FROM_MENU;
  let showFps = false;

  window.addEventListener('keydown', (e) => {
    if (['Space', 'Tab', 'F1', 'F2', 'F3', 'F4', 'F6', 'F7', 'F8', 'F9', 'F10'].includes(e.code)) e.preventDefault();
    initAudio();
    if (e.repeat) return;
    // пауза и итог боя из меню: клавиши — им
    if (battle?.key(e)) return;
    // инвентарь открыт: клавиши — ему (Esc, I, Q/E, стрелки, Enter, X)
    if (inventory.open) { inventory.key(e); return; }
    if (shop.open) { shop.key(e); return; }
    // меню площадки обороны: цифры — выбор башни, Esc / F — закрыть
    if (td?.menuOpen && td.key(e)) return;
    if (e.code === 'F10' && DEV_TOOLS) { openEditor(); return; }
    keys.add(e.code);
    switch (e.code) {
      case 'Space': edges.roll = true; break;
      case 'Digit1': case 'Digit2': case 'Digit3': gear.pressArtifact(Number(e.code.slice(5)) - 1, aimPoint()); break;
      case 'KeyE': gear.potion(); break;
      case 'KeyR': gear.flareAura(); break;
      case 'KeyQ': gear.special(aimPoint()); break;
      case 'KeyF': interactReq = true; break;
      case 'KeyI': openInventory(); break;
      case 'KeyM': hud.toggleMap(); break;
      case 'Tab': hud.toggleOverlay(); break;
      case 'Escape': if (hud.mapOpen) hud.toggleMap(); else battle?.pause(); break;
      case 'KeyH': helpOn = !helpOn; helpT = helpOn ? Infinity : 0; break;
      case 'F9': toast(toggleMute() ? 'Звук выключен' : 'Звук включён'); break;
      case 'KeyL': night = !night; applyNight(); toast(night ? 'Ночь' : 'День'); refreshControls(); break;
      case 'KeyU': look.unreal = !look.unreal; toast(look.unreal ? 'Свет как в Unreal' : 'Простой свет'); refreshControls(); break;
      case 'KeyB': postFX = !postFX; toast(postFX ? 'Постобработка включена' : 'Постобработка выключена'); refreshControls(); break;
      case 'KeyN': resetTargets(); break;
      case 'KeyG': td?.callWave(); break;
      case 'F1': panel.toggle(); break;
      case 'F2': overlays.colliders = !overlays.colliders; toast(`Коллайдеры: ${overlays.colliders ? 'вкл' : 'выкл'}`); break;
      case 'F3': overlays.aim = !overlays.aim; toast(`Дуга удара: ${overlays.aim ? 'вкл' : 'выкл'}`); break;
      case 'F4': showTelemetry = !showTelemetry; break;
      case 'F6': hero.god = !hero.god; toast(`Бессмертие: ${hero.god ? 'вкл' : 'выкл'}`); refreshControls(); break;
      case 'F7': timeScale = TIME_SCALES[(TIME_SCALES.indexOf(timeScale) + 1) % TIME_SCALES.length]; toast(`Время ×${timeScale}`); break;
      case 'F8': showFps = !showFps; break;
      case 'KeyP': paused = !paused; toast(paused ? 'Пауза' : 'Продолжаем'); break;
      case 'Period': if (paused) stepOnce = true; break;
      default: break;
    }
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    // заклинание заряжалось, пока клавиша была зажата, — отпустили, значит каст
    if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') gear.releaseArtifact(Number(e.code.slice(5)) - 1, aimPoint());
  });
  window.addEventListener('blur', () => { keys.clear(); lmb = false; rmb = false; gear.cancelCast(); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('mousemove', (e) => {
    mouseNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    mousePx.x = e.clientX; mousePx.y = e.clientY;
    mouseSeen = true;
  });
  canvas.addEventListener('mousedown', (e) => { initAudio(); if (e.button === 0) lmb = true; if (e.button === 2) rmb = true; });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) lmb = false; if (e.button === 2) rmb = false; });
  canvas.addEventListener('wheel', (e) => { camDist = THREE.MathUtils.clamp(camDist + Math.sign(e.deltaY) * 2, 12, 60); }, { passive: true });

  // экран вверх = мир (−1, −1)
  const FWD = new THREE.Vector2(-1, -1).normalize();
  const RIGHT = new THREE.Vector2(1, -1).normalize();

  function readInput(): void {
    if (scripted) return;
    const m = new THREE.Vector2();
    if (keys.has('KeyW') || keys.has('ArrowUp')) m.add(FWD);
    if (keys.has('KeyS') || keys.has('ArrowDown')) m.sub(FWD);
    if (keys.has('KeyD') || keys.has('ArrowRight')) m.add(RIGHT);
    if (keys.has('KeyA') || keys.has('ArrowLeft')) m.sub(RIGHT);
    if (m.lengthSq() > 1) m.normalize();
    input.move.copy(m);
    pointer.down = lmb && !panel.el.contains(document.activeElement);
    pointer.shift = keys.has('ShiftLeft') || keys.has('ShiftRight');
    if (mouseSeen) {
      // курсор на земле — верх блока под лучом камеры (срезанное над героем пропускаем), цель — по тому же лучу
      raycaster.setFromCamera(mouseNdc, camera);
      groundAt(raycaster.ray, pointer.ground);
      pointer.hover = pickRay(raycaster.ray);
      pointer.pad = td && !pointer.hover ? td.padAt(raycaster.ray) : null;
      if (td) td.hoverPad = pointer.pad;
    }
    input.roll = edges.roll;
  }

  function clearEdges(): void {
    edges.roll = false;
    input.roll = false;
  }

  // ---------- Мышь как в Minecraft Dungeons ----------
  // ЛКМ по земле — идти туда (держишь — идёт за курсором), ЛКМ по цели — подойти на длину меча и бить
  // (держишь — комбо), Shift + ЛКМ — бить на месте в сторону курсора. WASD отменяет приказ мыши.
  const pointer = { down: false, shift: false, ground: new THREE.Vector3(), hover: null as Target | null, pad: null as Pad | null };
  let pointerWas = false;
  /** Режим текущего нажатия: идти, бить цель, бить на месте, подойти к площадке обороны */
  let pressMode: 'walk' | 'chase' | 'here' | 'pad' = 'walk';
  let goal: THREE.Vector3 | null = null;
  /** Площадка, к которой идём по клику: дошли — откроется меню */
  let padGoal: Pad | null = null;
  let chase: Target | null = null;
  /** Сколько ударов было на момент приказа: отпустил ЛКМ — хватит одного удара по цели */
  let chaseSwings = 0;
  let stuckT = 0;
  /** Путь в обход стен (src/level/pathfind.ts): точки, к которым идти, и куда он проложен */
  let path: THREE.Vector3[] = [];
  const pathTo = new THREE.Vector3(Infinity, 0, 0);
  let repathT = 0;
  let stuckRepaths = 0;
  let arrived = false;
  /** Срез над героем под крышей (всё выше не рисуется и не ловит клик) */
  let cutY = Infinity;

  /** Точка на земле под лучом: верх первого твёрдого блока; мимо уровня — плоскость на высоте героя */
  function groundAt(ray: THREE.Ray, out: THREE.Vector3): THREE.Vector3 {
    const o = ray.origin, d = ray.direction;
    const h = raycastVoxels(level, o.x, o.y, o.z, d.x, d.y, d.z, 250, Infinity, (x, y, z) => y < cutY && collideTop(level, x, y, z) > -Infinity);
    if (!h) { aimPlane.constant = -hero.pos.y; return ray.intersectPlane(aimPlane, out) ?? out; }
    out.copy(o).addScaledVector(d, h.t);
    const f = terrain.floorAt(out.x, out.z, h.face === 4 ? h.y + 1 : out.y + 0.5);
    if (f > -Infinity) out.y = f;
    return out;
  }

  /**
   * Проложить путь к to: заново — только если цель сдвинулась больше чем на 0,4 м (не чаще раза в 0,15 с, пока тянут курсор)
   * или герой упёрся (repathT сброшен). Поиск дорогой — по таймеру путь не перекладываем.
   */
  function route(to: THREE.Vector3, dt: number): void {
    repathT -= dt;
    const moved = to.distanceTo(pathTo) >= 0.4;
    // пришли (или ближе к недостижимой цели не подойти) — ждём, пока цель сдвинется
    if (arrived && !moved) return;
    if (path.length && !(moved && repathT <= 0) && repathT > -1e8) return;
    arrived = false;
    path = pathfinder.find(hero.pos, to, { solids: solids() });
    pathTo.copy(to);
    repathT = 0.15;
  }

  /** Шаг по пути: направление к ближайшей точке; true — пришли */
  function walkPath(dt: number, slowAtEnd: boolean): boolean {
    while (path.length > 1 && Math.hypot(path[0].x - hero.pos.x, path[0].z - hero.pos.z) < 0.35) path.shift();
    const p = path[0];
    if (!p) { input.move.set(0, 0); arrived = true; return true; }
    const dx = p.x - hero.pos.x, dz = p.z - hero.pos.z, d = Math.hypot(dx, dz);
    if (path.length === 1 && d < HERO.arrive) { path = []; input.move.set(0, 0); arrived = true; return true; }
    // упёрся: перепроложить путь; не помогло трижды — приказ снимается, чтобы герой не толкался на месте
    stuckT = hero.touching && hero.speed < 0.5 ? stuckT + dt : 0;
    if (stuckT > 0.35) { stuckT = 0; repathT = -1e9; if (++stuckRepaths > 3) { path = []; input.move.set(0, 0); arrived = true; return true; } }
    input.move.set(dx / d, dz / d).multiplyScalar(slowAtEnd && path.length === 1 ? Math.min(1, d / 0.6 + 0.35) : 1);
    return false;
  }
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.4, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.8, 2), transparent: true, depthWrite: false, toneMapped: false }));
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  scene.add(marker);
  let markerT = 0;

  /** Цель под лучом камеры: ближайшая к камере, у которой луч проходит сквозь «столбик» тела */
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  function pickRay(ray: THREE.Ray): Target | null {
    let best: Target | null = null, bestD = Infinity;
    for (const t of targets()) {
      if (!t.alive) continue;
      _a.copy(t.pos); _b.copy(t.pos).setY(t.pos.y + (t.topY ?? 1.8));
      const d2 = ray.distanceSqToSegment(_a, _b);
      const r = t.radius + 0.2;
      if (d2 > r * r) continue;
      const d = ray.origin.distanceTo(t.pos);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }
  /** Цель в точке на земле (для тестов) */
  function pickAt(x: number, z: number): Target | null {
    let best: Target | null = null, bestD = Infinity;
    for (const t of targets()) {
      const d = Math.hypot(t.pos.x - x, t.pos.z - z);
      if (t.alive && d < t.radius + 0.3 && d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

  /** Превратить мышь в ввод героя: направление движения, точка удара, удар */
  function orders(dt: number): void {
    const keyMove = !scripted ? input.move.lengthSq() > 0.01 : false;
    const pressed = pointer.down && !pointerWas;
    pointerWas = pointer.down;
    // тест управляет вводом сам, пока не «кликает» мышью
    if (scripted && !pointer.down && !goal && !chase) return;
    input.attack = false;
    if (keyMove) { goal = null; chase = null; }
    if (pressed) {
      pressMode = pointer.shift ? 'here' : pointer.hover ? 'chase' : pointer.pad ? 'pad' : 'walk';
      chase = null; goal = null; path = []; stuckRepaths = 0; repathT = 0; arrived = false; padGoal = null;
      if (pressMode === 'chase') { chase = pointer.hover; chaseSwings = hero.swings; }
      // клик по площадке обороны: подойти к её краю, там откроется меню
      if (pressMode === 'pad' && td && pointer.pad) { padGoal = pointer.pad; goal = td.approach(pointer.pad, hero.pos); marker.position.set(goal.x, goal.y + 0.04, goal.z); marker.visible = true; markerT = 0.5; }
      if (pressMode === 'walk' && !keyMove) { marker.position.set(pointer.ground.x, pointer.ground.y + 0.04, pointer.ground.z); marker.visible = true; markerT = 0.5; }
    }
    if (pointer.down && pressMode === 'walk' && !keyMove) goal = pointer.ground.clone();
    if (pointer.down && pressMode === 'here') {
      input.attack = true;
      input.aim.copy(pointer.ground);
      if (!keyMove) input.move.set(0, 0);
      return;
    }
    if (chase) {
      if (!chase.alive) chase = null;
      else {
        const d = Math.hypot(chase.pos.x - hero.pos.x, chase.pos.z - hero.pos.z);
        input.aim.copy(chase.pos);
        const reach = SWORD.swings[0].range + chase.radius - 0.5;
        // достаёт мечом: рядом, на той же высоте и без стены между — бить, иначе — идти в обход
        const canHit = d <= reach && Math.abs(chase.pos.y - hero.pos.y) < 1 && !terrain.blocked(hero.pos.x, hero.pos.z, chase.pos.x, chase.pos.z, hero.pos.y + 0.5);
        if (!canHit) { route(chase.pos, dt); walkPath(dt, false); }
        else {
          path = [];
          input.move.set(0, 0);
          if (pointer.down || hero.swings === chaseSwings) input.attack = true;
          else if (!hero.attacking) chase = null;
        }
        return;
      }
    }
    if (goal) {
      route(goal, dt);
      if (walkPath(dt, true) && !pointer.down) goal = null;
      input.aim.copy(goal ?? hero.pos);
      return;
    }
    if (!scripted || keyMove) input.aim.copy(pointer.ground);
  }

  /** Куда целятся артефакты и лук: цель под курсором, иначе точка на земле */
  function aimPoint(): THREE.Vector3 { return pointer.hover?.alive ? pointer.hover.pos.clone() : pointer.ground.clone(); }

  function resetTargets(): void {
    for (const d of dummies) d.reset();
    props.reset();
    for (const a of arenas) a.reset();
    for (const g of grimoires.splice(0)) g.dispose();
    pack.clear();
    for (const r of mobRooms) fillRoom(r);
    td?.reset();
    toast(td ? 'Оборона заново: башни снесены, казна полная' : 'Чучела и склад на местах');
  }

  // ---------- Панель: переключатели ----------
  const refreshers: (() => void)[] = [];
  function refreshControls(): void { for (const r of refreshers) r(); }
  {
    const c = panel.controls;
    refreshers.push(toggle(c, 'Ночь (L)', () => night, (v) => { night = v; applyNight(); }));
    refreshers.push(toggle(c, 'Бессмертие (F6)', () => hero.god, (v) => { hero.god = v; }));
    refreshers.push(toggle(c, 'Постобработка, bloom (B)', () => postFX, (v) => { postFX = v; }));
    refreshers.push(toggle(c, 'Свет как в Unreal: AO, цвет, дымка (U)', () => look.unreal, (v) => { look.unreal = v; }));
    refreshers.push(toggle(c, 'Тени', () => sun.castShadow, (v) => { sun.castShadow = v; }));
    const row = document.createElement('div');
    row.className = 'pg-btnrow';
    c.appendChild(row);
    button(row, 'Сбросить чучела и склад (N)', resetTargets);
    button(row, 'Герой в центр', () => hero.place(0, 4, Math.PI));
    // зал стражей: встать у ворот любого
    const row2 = document.createElement('div');
    row2.className = 'pg-btnrow';
    c.appendChild(row2);
    for (const spec of BOSS_ARENAS) button(row2, `Страж: ${spec.title}`, () => hero.place(spec.exit.x, spec.exit.z, spec.exit.yaw));
    // рядовые мобы: отряд перед героем
    const row3 = document.createElement('div');
    row3.className = 'pg-btnrow';
    c.appendChild(row3);
    button(row3, 'Мобы: первая партия', () => spawnSquad(SQUADS.first));
    button(row3, 'Мобы: вторая партия', () => spawnSquad(SQUADS.second));
    button(row3, 'Мобы: третья партия', () => spawnSquad(SQUADS.third));
    button(row3, 'Мобы: четвёртая партия', () => spawnSquad(SQUADS.fourth));
    for (const [id, def] of Object.entries(MOBS)) if (!MOB_PARTS.has(id) && !TD_FOES.has(id)) button(row3, `Моб: ${def.title}`, () => spawnSquad(SQUADS[id] ?? [id]));
    button(row3, 'Убрать мобов', () => pack.clear());
    // оборона куста: враг на каждую дорогу
    if (tdSpec) for (const l of tdSpec.lanes) button(row3, `На дорогу: ${l.title}`, () => td?.spawnOn(['berryling', 'gardener', 'wolf', 'runner', 'ram', 'moth', 'shellback', 'sporeling', 'hopper', 'sapper', 'ballista'][Math.floor(Math.random() * 11)], l.id));
    if (tdSpec) button(row3, 'Волна сейчас (G)', () => td?.callWave());
    for (const r of roomSpecs) button(row3, r.title, () => hero.place(r.enter.x, r.enter.z, r.enter.yaw));
    // масштаб стражей: уровень и число игроков
    refreshers.push(select(c, 'Уровень стражей', [['hero', 'по герою'], ...[1, 3, 5, 10, 15, 20, 30].map((v): [string, string] => [String(v), String(v)])], () => bossLevelPick, (v) => { bossLevelPick = v; rescaleBosses(); }));
    // закалка для проверки: любое оружие и до трёх зачарований на III (вид, синергии, спец-удар)
    const tempPick: (MeleeEnchant | '')[] = ['', '', ''];
    const applyTemper = (): void => {
      const ids = [...new Set(tempPick.filter((x): x is MeleeEnchant => !!x))];
      gear.temperOverride = ids.length ? ids.map((id) => ({ id, tier: 3 })) : null;
      gear.apply();
    };
    refreshers.push(select(c, 'Оружие', [['', 'надетое'], ...weapons().map((w): [string, string] => [w.id, `${w.title} (${w.category})`])], () => gear.weaponOverride?.id ?? '', (v) => {
      gear.weaponOverride = v ? getWeapon(v) ?? null : null;
      gear.apply();
    }));
    for (let i = 0; i < 3; i++) refreshers.push(select<MeleeEnchant | ''>(c, `Закалка ${i + 1}`, [['', '—'], ...MELEE_ENCHANTS.map((id): [MeleeEnchant, string] => [id, `${enchantDef(id).title} · ${TEMPER_LOOK[id].name}`])], () => tempPick[i], (v) => { tempPick[i] = v; applyTemper(); }));
    refreshers.push(select(c, 'Игроков', [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']], () => String(bossPlayers), (v) => { bossPlayers = Number(v); rescaleBosses(); }));
  }

  // ---------- HUD и инвентарь как в Minecraft Dungeons (src/hud/) ----------
  const hud = new Hud(document.body, profile);
  const questGoal = (level.meta.goal as [string, string] | undefined) ?? ['Исследуй плейграунд', 'Плейграунд Малины'];
  hud.setGoal(questGoal[0], questGoal[1]);
  // стены замка меняют блоки (пролом, починка): препятствия врагов — заново
  const levelChanged = (): void => { if (STREAM) return; obstacles.length = 0; obstacles.push(...obstaclesOf(level, 0, bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ), ...decorSolids(level)); foeObsKey = null; };
  // из меню: малина героя откладывается — оборона ставит в профиль свою казну, лагерь вернёт собранное (src/menu/session.ts)
  if (tdSpec && FROM_MENU) { stashBerries(profile.data.berries); stashGear(JSON.parse(JSON.stringify({ items: profile.data.items, equip: profile.data.equip, arrows: profile.data.arrows }))); }
  if (tdSpec) td = new TowerDefense({ scene, fx, hero, profile, boss: bossHooks, loot: (at, n) => props.berries(at, n), toast: (s) => toast(s), banner: (h, sec) => hud.banner(h, sec), quiet: () => scripted, level, levelChanged, harvest: () => props.harvest() }, tdSpec, document.body);
  // оборона: малину с павших тянет издалека — в бою некогда бегать за каждой кучкой
  if (tdSpec) props.berryReach = 6;
  // число игроков партии (сетевая игра — позже): ?players=N
  if (FROM_MENU) bossPlayers = Math.max(1, Math.min(4, Number(query.get('players')) || 1));
  td?.setPlayers(bossPlayers);
  const inventory = new Inventory(document.body, profile, T);
  inventory.onClose = () => { lmb = false; rmb = false; keys.clear(); };
  function openInventory(): void { gear.cancelCast(); if (hud.mapOpen) hud.toggleMap(); inventory.show(); }
  hud.onInventory = openInventory;
  hud.onPotion = () => gear.potion();
  hud.onArtifact = (i) => gear.useArtifact(i, aimPoint());
  hud.onAura = () => gear.flareAura();
  hud.onSpecial = () => gear.special(aimPoint());
  // карта с туманом войны: мини в углу, Tab — поверх игры, M — полная (src/hud/automap.ts)
  const automap = new AutoMap(level, !STREAM);
  hud.setMap(automap, new URLSearchParams(window.location.search).has('map') ? level.name : 'Плейграунд');
  // открытый мир: регионы вокруг героя, их предметы — в склад, их колонны — в карту; состояние — в localStorage
  const regions: RegionManager | null = STREAM ? new RegionManager(level, sourceLevel ? mapSource(sourceLevel) : worldSource(worldSeed), {
    spawn: (key, rx, rz, entities) => {
      props.addGroup(key, entities);
      regionObstacles.set(key, obstaclesOf(level, 0, rx * 32, rz * 32, rx * 32 + 31, rz * 32 + 31)); obstaclesCache = null;
      automap.addTile(rx, rz);
      const seen = regions?.seenOf(key);
      if (seen) automap.restoreSeen(rx, rz, seen);
    },
    despawn: (key) => { props.removeGroup(key); regionObstacles.delete(key); obstaclesCache = null; },
    seenOf: (_key, rx, rz) => automap.seenOf(rx, rz),
  }, `malina.world.${sourceLevel ? level.name : worldSeed}`) : null;
  if (regions) {
    // старт — точка появления карты, у процедурного мира — перекрёсток дорог у начала координат (там ровно)
    const sp = level.spawn ?? [1, 0, 4];
    regions.warm([{ x: sp[0], z: sp[2] }]);
    const a = THREE.MathUtils.degToRad((level.meta.spawnYaw as number | undefined) ?? 0);
    hero.place(sp[0], sp[2], level.spawn ? Math.atan2(Math.cos(a), Math.sin(a)) : Math.PI, Math.max(sp[1], surfaceAt(level, sp[0], sp[2])));
    view.sync();
  }
  hud.onMap = () => hud.toggleMap();
  let revealAt = '';
  let mapT = 0;
  // торговцы: окно покупок (src/hud/shop.ts)
  const shop = new Shop(document.body, profile);
  // бой из главного меню (src/menu/pause.ts): Esc — пауза с настройками, конец обороны — итог и «В лагерь»
  const mapName = query.get('map') ?? '';
  if (FROM_MENU) document.title = `Малина — ${tdSpec ? campaignMap(mapName).title : level.name}`;
  const battle = FROM_MENU ? new BattleMenu(document.body, new SettingsPanel(document.body), tdSpec ? campaignMap(mapName).title : level.name) : null;
  if (battle) {
    battle.onRestart = () => { resetTargets(); if (hero.down) hero.revive(); else hero.hp = hero.maxHp; };
    battle.settings.onChange = (st) => {
      postFX = st.postFX; sun.castShadow = st.shadows; helpOn = st.help;
      refreshControls();
    };
  }
  /** Итог обороны уже показан (для этой партии) */
  let tdEndShown: 'play' | 'won' | 'lost' = 'play';
  shop.onClose = () => { lmb = false; rmb = false; keys.clear(); };
  shop.onSound = (ok) => { if (!scripted) (ok ? sfx.pickup : sfx.empty)(); };
  /** Подсказка по управлению: первые 15 с, потом — по H */
  let helpOn = settings.help;
  let helpT = 15;

  const dev = document.createElement('div');
  dev.className = 'pg-hud';
  dev.innerHTML = `
    <div class="pg-tele" id="pgTele"></div>
    <div class="pg-fps" id="pgFps"></div>
    <div class="pg-toast" id="pgToast"></div>
    <div class="pg-prompt" id="pgPrompt"></div>
    <div class="pg-help" id="pgHelp">ЛКМ по земле — идти · ЛКМ по цели — подойти и бить (держи — комбо) · Shift + ЛКМ — бить на месте · ПКМ — стрелять · WASD — ходьба · Space — перекат · 1/2/3 — заклинания и артефакты (держи — заряд) · G — волна сейчас · Q — спец-удар оружия · R — вспышка ауры · E — зелье · F — использовать, торговать · I — инвентарь · M — карта · Tab — карта поверх игры${FROM_MENU ? ' · Esc — пауза' : `<br>
    F1 параметры · F2 коллайдеры · F3 дуга удара · F4 телеметрия · F6 бессмертие · F7 время · P пауза · . кадр · F8 FPS · F9 звук · B bloom · U свет · L день/ночь · N сброс · F10 редактор`} · H — скрыть подсказку</div>
    <div class="pg-reticle" id="pgRet"><i></i></div>`;
  document.body.appendChild(dev);

  let toastT = 0;
  let lastNearChest: unknown = null;
  function toast(s: string): void { const t = $('pgToast'); t.textContent = s; t.classList.add('show'); toastT = 1.4; }

  const cache: Record<string, string> = {};
  function setHTML(id: string, v: string): void { if (cache[id] !== v) { cache[id] = v; $(id).innerHTML = v; } }

  function updateHUD(dt: number, _fps: number, _frameMs: number): void {
    const pad = td && !td.menuOpen && !hero.down ? td.nearPad(hero.pos) : null;
    const wall = td && !pad && !hero.down ? td.nearWall(hero.pos) : null;
    const trader = hero.down || pad || wall ? null : merchants.find((m) => m.near(hero.pos)) ?? null;
    const near = hero.down || trader || pad || wall ? null : props.nearest(hero.pos, hero.hp, hero.maxHp);
    // подошёл к сундуку — он тихо звенит
    const nearChest = near?.kind === 'supply' ? near.target : null;
    if (nearChest && nearChest !== lastNearChest && !scripted) sfx.twinkle();
    lastNearChest = nearChest;
    const promptEl = $('pgPrompt');
    promptEl.style.display = (near || trader || pad || wall) && !inventory.open && !shop.open ? '' : 'none';
    if (pad && td) setHTML('pgPrompt', `<kbd>F</kbd>${td.prompt(pad)}`);
    else if (wall && td) setHTML('pgPrompt', `<kbd>F</kbd>${td.wallPrompt(wall)}`);
    else if (trader) setHTML('pgPrompt', `<kbd>F</kbd>Торговать: ${MERCHANT_TITLE[trader.kind].toLowerCase()}`);
    else if (near) setHTML('pgPrompt', `<kbd>F</kbd>${near.prompt}`);
    hud.update(gear.hudState(), dt);
    hud.el.classList.toggle('show-hp', showTelemetry);
    const cell = `${Math.round(hero.pos.x)},${Math.round(hero.pos.z)}`;
    if (cell !== revealAt) { revealAt = cell; automap.reveal(hero.pos.x, hero.pos.z); }
    // карты — 2D-канвас, перерисовка каждый кадр заметна; 10 раз в секунду хватает
    mapT -= dt;
    if (mapT <= 0 || hud.mapOpen) { mapT = 0.1; hud.drawMaps({ x: hero.pos.x, z: hero.pos.z, yaw: hero.yaw }, [
      ...props.supplies.map((c) => ({ x: c.pos.x, z: c.pos.z, icon: 'chest', dim: c.opened })),
      ...props.terminals.map((t) => ({ x: t.pos.x, z: t.pos.z, icon: 'heart' })),
      ...merchants.map((m) => ({ x: m.pos.x, z: m.pos.z, icon: m.kind === 'smith' ? 'hammer' : 'berry', always: true })),
      ...(td?.alarmMarkers ?? []),
    ], [props.supplies.filter((c) => c.opened).length, props.supplies.length]); }
    helpT -= dt;
    $('pgHelp').style.opacity = helpOn && helpT > 0 ? String(Math.min(0.9, helpT)) : '0';

    const tele = $('pgTele');
    tele.style.display = showTelemetry ? '' : 'none';
    if (showTelemetry) {
      setHTML('pgTele', [
        `<b>${hero.state}</b>${hero.touching ? ' · у стены' : ''}`,
        `скорость <b>${hero.speed.toFixed(2)}</b> м/с`,
        `высота <b>${hero.pos.y.toFixed(2)}</b> м${hero.grounded ? '' : ` · v<sub>y</sub> ${hero.vy.toFixed(1)}`}`,
        `ударов <b>${hero.swings}</b>${lastStrike ? ` · последний: ${['слева', 'справа', 'сверху'][lastStrike.s.step]}, ${lastStrike.s.dmg}` : ''}`,
        `x ${hero.pos.x.toFixed(2)} · z ${hero.pos.z.toFixed(2)}`,
        `время ×${timeScale}${paused ? ' · <span class="bad">пауза</span>' : ''}${hero.god ? ' · бессмертие' : ''}`,
      ].join('<br>'));
    }
    const f = $('pgFps');
    f.style.display = showFps ? '' : 'none';
    if (showFps) setHTML('pgFps', perf.html());

    toastT -= dt;
    if (toastT <= 0) $('pgToast').classList.remove('show');

    const ret = $('pgRet');
    const show = mouseSeen && !scripted && !inventory.open && !shop.open && !hud.mapOpen;
    ret.style.display = show ? '' : 'none';
    if (show) {
      ret.style.transform = `translate(${mousePx.x}px,${mousePx.y}px)`;
      ret.classList.toggle('hover', !!pointer.hover && !pointer.shift);
      ret.classList.toggle('here', pointer.shift);
      ret.classList.toggle('pad', !!pointer.pad && !pointer.hover && !pointer.shift);
    }
  }

  // ---------- Цикл ----------
  const STEP = 1 / 60;
  let simTime = 0;
  let downT = 0;

  function tick(dt: number): void {
    simTime += dt;
    readInput();
    orders(dt);
    gear.update(dt, rmb && !scripted, aimPoint());
    markerT -= dt;
    marker.visible = markerT > 0;
    (marker.material as THREE.MeshBasicMaterial).opacity = Math.max(0, markerT * 2);
    marker.scale.setScalar(1 + (0.5 - markerT));
    // зоны мобов (паутина лозоплёта) замедляют героя
    const slow = Math.max(pack.heroSlow, ...mobRooms.map((r) => r.pack.heroSlow));
    hero.slow = Math.min(0.8, slow);
    hero.update(dt, input, solids(), terrain);
    // под крышей: срезать потолок и всё, что выше, — виден этаж, где стоит герой
    cutY = ceilingAt(level, hero.pos.x, hero.pos.z, hero.pos.y);

    if (interactReq) {
      interactReq = false;
      const pad = td && !hero.down ? td.nearPad(hero.pos) : null;
      const wall = td && !pad && !hero.down ? td.nearWall(hero.pos) : null;
      const trader = pad || wall ? null : merchants.find((m) => m.near(hero.pos));
      if (pad && td) { if (td.menuOpen) td.closeMenu(); else td.openMenu(pad); }
      else if (wall && td) td.repair(wall);
      if (trader && !hero.down) { shop.show(trader.kind); }
      const it = trader || pad ? null : props.nearest(hero.pos, hero.hp, hero.maxHp);
      if (it && !hero.down) props.interact(it, hero.hp, hero.maxHp);
    }
    // шёл к площадке по клику: подошёл — меню; приказ сняли — забыть
    if (td && padGoal) {
      const d = Math.hypot(hero.pos.x - padGoal.pos.x, hero.pos.z - padGoal.pos.z);
      if (d < 2.3) { td.openMenu(padGoal); padGoal = null; goal = null; path = []; input.move.set(0, 0); }
      else if (!goal) padGoal = null;
    }
    // в лаве горит: урон раз в 0,4 с, искры и шипение; перекат не спасает — выходи на берег
    if (lavaFx && level.nameAt(Math.round(hero.pos.x), Math.floor(hero.pos.y - 0.01), Math.round(hero.pos.z)) === 'lava') {
      lavaT -= dt;
      if (lavaT <= 0) {
        lavaT = 0.4;
        const hp0 = hero.hp;
        if (hero.hurt(6)) fx.text(hero.pos.clone().setY(hero.pos.y + 1.2), `−${Math.round(hp0 - hero.hp)}`, 'bad');
        fx.burst(hero.pos.clone().setY(hero.pos.y + 0.2), [new THREE.Color(3.4, 1.4, 0.3), '#ff8a2a'], 8, { speed: 1.5, up: 3, size: 0.09, life: 0.5, glow: true, gravity: 2 });
        if (!scripted) sfx.flame();
      }
    } else lavaT = 0;
    const healed = props.update(dt, hero);
    if (healed > 0) hero.hp = Math.min(hero.maxHp, hero.hp + healed);
    clearEdges();
    if (hero.down) { if (downT === 0) gear.onDown(); downT += dt; if (downT > 2) { hero.revive(); downT = 0; } }
    for (const d of dummies) d.update(dt);
    for (const m of merchants) m.update(dt, hero.pos);
    pack.update(dt);
    td?.update(dt);
    lavaFx?.update(dt, hero.pos);
    mistFx?.update(dt);
    // комната думает, когда герой рядом или гарнизон в бою; пал весь, а герой вышел — гарнизон снова на постах
    for (const r of mobRooms) {
      if (inRoom(r.spec, 30) || r.pack.mobs.some((m) => m.alerted)) r.pack.update(dt);
      if (garrison && r.spec.respawn !== false && !inRoom(r.spec, 3) && r.pack.mobs.every((m) => m.dead)) fillRoom(r);
    }
    if (arenas.length) {
      rescaleBosses();
      for (const a of arenas) a.update(dt, hero);
      // спящие стражи дальних арен не думают — только тот, чья арена рядом или в бою
      for (const b of bosses) if (b.awake || b.dead || Math.hypot(b.pos.x - hero.pos.x, b.pos.z - hero.pos.z) < 30) b.update(dt);
      for (let i = grimoires.length - 1; i >= 0; i--) {
        const g = grimoires[i];
        if (g.update(dt, hero.pos)) {
          profile.add(g.item, g.power);
          profile.save();
          hud.banner(`${itemDef(g.item).title}<small>Заклинание стража — надень в гнездо 1/2/3 (I)</small>`, 3);
        }
        if (g.done) { g.dispose(); grimoires.splice(i, 1); }
      }
    }
    fx.update(dt, window.innerWidth, window.innerHeight);
  }

  // фоновая музыка (src/music.ts): тихая в покое, ещё тише в бою, тревожная при низком здоровье
  const music = new Music();
  const near = (p: THREE.Vector3, r: number): boolean => Math.hypot(p.x - hero.pos.x, p.z - hero.pos.z) < r;
  /** Бой: проснувшийся страж или моб, поднявший тревогу, в 25 м от героя */
  const inFight = (): boolean =>
    bosses.some((b) => b.awake && !b.dead) ||
    [pack, ...mobRooms.map((r) => r.pack), ...(td ? [td.pack] : [])].some((p) => p.mobs.some((m) => m.alerted && !m.dead && near(m.pos, 25)));

  let acc = 0;
  let last = performance.now();
  let fpsAcc = 0, fpsN = 0, fpsVal = 60, frameMs = 16;

  function frame(): void {
    requestAnimationFrame(frame);
    const now = performance.now();
    const real = Math.min(0.1, (now - last) / 1000);
    last = now;
    fpsAcc += real; fpsN++;
    if (fpsAcc > 0.5) { fpsVal = fpsN / fpsAcc; frameMs = (fpsAcc / fpsN) * 1000; fpsAcc = 0; fpsN = 0; }

    // стоп-кадр удара заклинания: время почти стоит (src/fx.ts hitstop)
    const stop = fx.hitstop > 0 ? 0.04 : fx.slowmo > 0 ? 0.33 : 1;
    fx.updateReal(real);
    // инвентарь открыт — игра на паузе, как в одиночной MCD
    if (!paused && !inventory.open && !shop.open && !battle?.pausing) acc += real * timeScale * stop;
    else if (stepOnce) { acc += STEP; stepOnce = false; }
    perf.begin();
    let n = 0;
    perf.tickStart();
    while (acc >= STEP && n < 6) { tick(STEP); acc -= STEP; n++; }
    perf.tickEnd();
    if (n >= 6) acc = 0;
    music.update(real, inFight(), hero.down ? 0 : hero.hp / hero.maxHp);
    if (battle && td && td.state !== tdEndShown) {
      tdEndShown = td.state;
      if (td.state === 'won') markWon(mapName);
      if (td.state !== 'play') battle.end(td.state === 'won', `волн отбито ${td.state === 'won' ? td.waves.length : Math.max(0, td.wave - 1)} из ${td.waves.length}, врагов повержено ${td.fallen}`);
    }
    perf.renderStart();
    render(real);
    perf.renderEnd();
    perf.end(real);
  }

  /** Уровень: перестроить изменённые чанки, вода и огонь, ближайшие факелы, рентген и срез — раз в кадр, не в каждом тике */
  function syncView(dt: number): void {
    if (regions) regions.update(dt, [hero.pos]);
    // в мире мешер работает с бюджетом: остальные чанки — в следующих кадрах, ближние к герою первыми
    view.sync(regions ? 4 : Infinity, hero.pos);
    view.update(simTime, night ? 1 : 0.4, hero.pos);
    view.setXray(_xray.copy(hero.pos).setY(hero.pos.y + 0.9), camera.position, 2.0);
    view.setCut(cutY - 0.01);
  }
  const _xray = new THREE.Vector3();

  /** Камера, оверлеи, HUD и кадр; real — сколько прошло реального времени */
  function render(real: number): void {
    syncView(real);
    // камера следит за героем; по высоте — плавно, чтобы падение не дёргало кадр
    const want = hero.pos.clone();
    if (camOverride) camTarget.copy(camOverride); else if (scripted) camTarget.copy(want); else {
      camTarget.x += (want.x - camTarget.x) * Math.min(1, real * 6);
      camTarget.z += (want.z - camTarget.z) * Math.min(1, real * 6);
      camTarget.y += ((hero.grounded ? want.y : camTarget.y) - camTarget.y) * Math.min(1, real * 3);
    }
    const sh = fx.shake * 0.2;
    camera.position.copy(camTarget).addScaledVector(CAM_DIR, camDist * (1 + fx.zoom)).add(new THREE.Vector3((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh));
    camera.lookAt(camTarget.x, camTarget.y + 0.6, camTarget.z);
    look.follow(camTarget, camDist);
    weather.update(real, camTarget);
    updateMotes(simTime);

    overlays.update();
    if (overlays.colliders) {
      const list = [{ x: hero.pos.x, z: hero.pos.z, r: HERO.radius, y: hero.pos.y + 0.05 }];
      for (const d of dummies) list.push({ x: d.pos.x, z: d.pos.z, r: d.radius, y: 0.05 });
      for (const t of props.targets) list.push({ x: t.pos.x, z: t.pos.z, r: t.radius, y: 0.05 });
      overlays.drawCircles(list);
      overlays.drawPaths(path.length ? [[hero.pos, ...path]] : []);
    } else { overlays.drawCircles([]); overlays.drawPaths([]); }
    // F3: дуга последнего удара, пока он виден
    const ls = lastStrike && simTime - lastStrike.t < 0.4 ? lastStrike.s : null;
    overlays.drawAim(ls ? ls.from.clone().setY(hero.pos.y + 0.1) : hero.pos, ls ? ls.yaw : hero.yaw, ls ? ls.half : 0, ls ? ls.range : 0.01);

    const w = window.innerWidth, h = window.innerHeight;
    for (const d of dummies) d.drawLabel(camera, w, h);
    for (const m of merchants) m.drawLabel(camera, w, h);
    if (panel.open) panel.sync();
    updateHUD(real, fpsVal, frameMs);


    if (postFX) look.render();
    else look.renderPlain(camera);
  }
  // прогрев шейдеров и текстур боя (src/fx-zoo.ts): компилируем до первого каста, а не в кадре удара
  const ready = warmUp(renderer, scene, camera, T, look.composer.renderTarget1).catch((e) => { console.warn('прогрев не удался', e); return 0; });
  frame();

  // ---------- Отладочный хук ----------
  window.__malina = {
    mode: 'playground',
    hero, input, dummies, obstacles, camera, HERO, SWORD, props, level, terrain,
    /** Рендер уровня и декора */
    view,
    /** Препятствия героя: склад и декор */
    get solids() { return solids(); },
    get berries() { return profile.data.berries; },
    /** Снаряжение и прокачка: профиль (src/items.ts), бой (src/gear.ts), HUD и инвентарь (src/hud/) */
    profile, gear, hud, inventory, shop, merchants, automap,
    /** Закалка и спец-удар (src/weapon-arts.ts): шкала, синергии, счётчики */
    arts: gear.arts,
    special(x: number, z: number) { return gear.special(new THREE.Vector3(x, hero.pos.y, z)); },
    /** Оружие для отладки поверх надетого (id из src/weapons.ts; пусто — надетое) и закалка на III */
    weapon(id = '') { gear.weaponOverride = id ? getWeapon(id) ?? null : null; gear.apply(); return gear.weaponOverride?.category ?? null; },
    temper(ids: MeleeEnchant[] = []) { gear.temperOverride = ids.length ? ids.map((id) => ({ id, tier: 3 })) : null; gear.apply(); return gear.arts.synergies.map((x) => x.id); },
    /** Страж и его арена (src/bosses/): boss.state, arena.state, гримуары после победы */
    bosses, arenas, bossIds, grimoires, bossBar,
    /** Встать у ворот стража (id арены: cauldron, boar, …) */
    /** Масштаб стражей: уровень (число или 'hero') и число игроков */
    bossScale(level: number | 'hero', players = bossPlayers) { bossLevelPick = String(level); bossPlayers = players; rescaleBosses(); return { level: bossLevel(), players: bossPlayers }; },
    /** Рядовые мобы (src/mobs/): pack.mobs; вызвать моба в точку */
    pack,
    /** Оборона куста (src/td/): pads, towers, build(pad, kind), pack врагов, walls (осада); lavaFx — дымка и искры лавы (cells) */
    td, lavaFx, mistFx,
    /** Комнаты мобов: spec (посты, вход) и стая гарнизона; fillRoom — заново на постах */
    mobRooms, fillRoom,
    spawnMob(kind: string, x: number, z: number) { return pack.spawn(kind, new THREE.Vector3(x, 0, z)); },
    toBoss(id: string) { const s = BOSS_ARENAS.find((a) => a.id === id); if (s) hero.place(s.exit.x, s.exit.z, s.exit.yaw); return !!s; },
    /** Эффекты: стоп-кадр, засветка, свет заклинаний */
    fx,
    /** Фоновая музыка (src/music.ts): mood, bpm, notes */
    music,
    /** Замеры кадра (src/dev/perf.ts): snapshot() — сводка, длинные кадры с метками; renderer.info */
    perf, renderer,
    /** Прогрев шейдеров завершён (число программ) */
    ready,
    /** Погода (src/weather.ts): set(kind, intensity, wind) */
    weather,
    /** Регионы открытого мира (?map=world): loaded, stats, kill(id), save() */
    regions,
    /** Подойти к торговцу и нажать F */
    trade(kind: 'smith' | 'merchant' | 'sutler') { const m = merchants.find((x) => x.kind === kind); if (!m) return false; hero.place(m.front.x, m.front.z, Math.PI); interactReq = true; tick(STEP); return shop.open; },
    /** ПКМ: выстрел к точке */
    shoot(x: number, z: number) { return gear.shoot(new THREE.Vector3(x, hero.pos.y, z)); },
    /** Клавиши 1/2/3: артефакт к точке; charge 0..1 — заклинание с зарядом, без удержания */
    artifact(i: number, x: number, z: number, charge = 0) { return gear.useArtifact(i, new THREE.Vector3(x, hero.pos.y, z), charge); },
    /** Зажать клавишу 1/2/3 и отпустить через sec секунд симуляции */
    hold(i: number, x: number, z: number, sec: number) {
      const at = new THREE.Vector3(x, hero.pos.y, z);
      if (!gear.pressArtifact(i, at)) return false;
      const n = Math.round(sec / STEP); for (let j = 0; j < n; j++) tick(STEP);
      return gear.releaseArtifact(i, at);
    },
    potion() { return gear.potion(); },
    /** Клавиша R: вспышка ауры */
    flare() { return gear.flareAura(); },
    /** Нажать E */
    interact() { interactReq = true; },
    /** Ввод из теста: клавиатура и мышь перестают влиять на героя */
    script(on = true) { scripted = on; if (on) { input.move.set(0, 0); input.attack = false; pointer.down = false; goal = null; chase = null; path = []; } },
    /** Прогнать симуляцию sec секунд без реального времени */
    step(sec: number) { const n = Math.round(sec / STEP); for (let i = 0; i < n; i++) tick(STEP); syncView(sec); },
    /** Нарисовать кадр сейчас (вкладка в фоне не получает requestAnimationFrame) */
    render() { render(0); },
    /** Нажатие пробела: перекат */
    press(what: 'roll') { input[what] = true; },
    /** Нажать ЛКМ в точке на земле (shift — удар на месте); цель в этой точке — подойти и бить */
    click(x: number, z: number, shift = false, y?: number) { pointer.ground.set(x, y ?? terrain.floorAt(x, z, hero.pos.y + 4), z); pointer.hover = pickAt(x, z); pointer.pad = td && !pointer.hover ? td.nearPad(new THREE.Vector3(x, y ?? 0, z)) : null; pointer.shift = shift; pointer.down = true; },
    /** Отпустить ЛКМ */
    release() { pointer.down = false; },
    get goal() { return goal; },
    get path() { return path; },
    pathfinder,
    get chase() { return chase; },
    resetTargets,
    setAim(x: number, z: number) { input.aim.set(x, hero.pos.y, z); },
    setCamTarget(x?: number, z?: number) { camOverride = x === undefined || z === undefined ? null : new THREE.Vector3(x, 0, z); },
    setCam(dist: number, dir?: [number, number, number]) { camDist = dist; if (dir) CAM_DIR.set(...dir).normalize(); },
    setNight(on: boolean) { night = on; applyNight(); },
    /** Время воды в шейдере — растёт, значит вода анимирована */
    get waterTime() { return liquidTime(); },
    trail: hero.trail,
    toggles: { get postFX() { return postFX; }, set postFX(v: boolean) { postFX = v; }, get unreal() { return look.unreal; }, set unreal(v: boolean) { look.unreal = v; } },
    look,
  };
}
