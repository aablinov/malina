import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { initAudio, sfx, toggleMute } from '../audio';
import { Arachnid, ARACHNID_NAMES, type ArachnidContext } from '../arachnid';
import { buildCoverPoints } from '../cover';
import { Grenades } from '../grenade';
import { Jailer, JAILER_NAMES, type JailerContext } from '../jailer';
import { Beetle, type BeetleKind } from '../beetle';
import { distToObstacle, NavGrid } from '../nav';
import { obstacle, raycastObstacles, resolveCircle, type Obstacle } from '../collision';
import { FIREARMS, PRIMARIES, type FirearmId } from '../firearms';
import { FX } from '../fx';
import { rng, traceShot, type FireRequest, type GunEvent, type GunState, type Shootable } from '../gunplay';
import { emptyInput, Hero, type HeroInput } from '../hero';
import { makeTextures } from '../textures';
import { ARACHNIDS, BEETLES, CALIBERS, GRENADE, GUNS, HERO, JAILERS, snapshotTuning, type ArachnidKind, type JailerKind } from '../tuning';
import { Dummy, Spits, type Spit } from './dummies';
import { Overlays } from './overlay';
import { button, Panel, select, toggle } from './panel';
import '../style.css';
import './playground.css';

declare global {
  interface Window { __malina?: unknown }
}

export function runPlayground(): void {
  /**
   * Плейграунд разработчика (этап 0, design-dungeon.md, раздел 16).
   * Служебная сцена: шахматный пол 48 × 48 м, стены, укрытия, коридор, стрельбище и инструменты.
   * Механики живут в общих модулях (hero.ts, gunplay.ts, firearms.ts), здесь — только сцена и отладка.
   */

  snapshotTuning();
  document.body.classList.add('dev-playground');
  document.title = 'Малина — плейграунд';

  const $ = <E extends HTMLElement = HTMLElement>(id: string): E => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Нет элемента #${id}`);
    return el as E;
  };

  // ---------- Рендер ----------
  const canvas = $<HTMLCanvasElement>('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#c9d2db');

  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 220);
  const CAM_DIR = new THREE.Vector3(1, 1.38, 1).normalize();
  let camDist = 26;
  /** Для скриншотов и тестов: камера смотрит в заданную точку */
  let camOverride: THREE.Vector3 | null = null;
  const camTarget = new THREE.Vector3();

  scene.add(new THREE.HemisphereLight('#ffffff', '#7a7f86', 1.1));
  scene.add(new THREE.AmbientLight('#ffffff', 0.2));
  const sun = new THREE.DirectionalLight('#ffffff', 2.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 90 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const SUN_OFFSET = new THREE.Vector3(-14, 30, 9);

  const flashLight = new THREE.PointLight('#ffd27a', 0, 7, 1.6);
  scene.add(flashLight);
  let flashT = 0;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.45, 0.4, 0.85);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let postFX = true;

  function resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
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
  const obstacles: Obstacle[] = [];
  /** Высокие стены, которые становятся прозрачными, если закрывают героя */
  const xray: { mesh: THREE.Mesh; mat: THREE.MeshLambertMaterial; box: THREE.Box3 }[] = [];

  function floorTex(): THREE.CanvasTexture {
    // тайл 10 × 10 м: клетка 1 м, разметка каждые 5 м
    const px = 16, n = 10, size = px * n;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      g.fillStyle = (x + y) % 2 ? '#8b8e94' : '#9c9fa5';
      g.fillRect(x * px, y * px, px, px);
    }
    g.fillStyle = '#5f6268';
    for (const k of [0, 5]) { g.fillRect(k * px - 1, 0, 2, size); g.fillRect(0, k * px - 1, size, 2); }
    g.fillRect(size - 1, 0, 1, size); g.fillRect(0, size - 1, size, 1);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.anisotropy = 8;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.repeat.set((HALF * 2) / 10, (HALF * 2) / 10);
    t.offset.set(0.6, 0.6);
    return t;
  }

  function wallTex(a: string, b: string): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { g.fillStyle = (x + y) % 2 ? b : a; g.fillRect(x * 16, y * 16, 16, 16); }
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), new THREE.MeshLambertMaterial({ map: floorTex() }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // крест нулевой точки
  const crossMat = new THREE.MeshBasicMaterial({ color: '#2b2e33' });
  for (const [w, d] of [[1.6, 0.08], [0.08, 1.6]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.01, d), crossMat);
    m.position.y = 0.006;
    scene.add(m);
  }

  const WALL_TEX = wallTex('#b9ab90', '#a7987c');
  const COVER_TEX = wallTex('#8e9fb0', '#7d8ea0');

  /** Коробка с UV в метрах: клетка 1 × 1 м на каждой грани */
  function meterBox(w: number, h: number, d: number): THREE.BoxGeometry {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * dims[f][0] / 2, uv.getY(k) * dims[f][1] / 2);
    }
    return g;
  }

  /**
   * Стена или укрытие. visH — видимая высота (со стороны камеры стены низкие), h — высота для пуль.
   */
  function wall(x: number, z: number, w: number, d: number, h: number, opts: { rot?: number; visH?: number; tex?: THREE.Texture; xray?: boolean } = {}): void {
    const visH = opts.visH ?? h;
    const mat = new THREE.MeshLambertMaterial({ map: opts.tex ?? WALL_TEX, transparent: !!opts.xray });
    const m = new THREE.Mesh(meterBox(w, visH, d), mat);
    m.position.set(x, visH / 2, z);
    m.rotation.y = THREE.MathUtils.degToRad(opts.rot ?? 0);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    obstacles.push(obstacle(x, z, w, d, h, opts.rot ?? 0));
    if (opts.xray) { m.updateMatrixWorld(); xray.push({ mesh: m, mat, box: new THREE.Box3().setFromObject(m) }); }
  }

  // стены по периметру: дальние 3 м, со стороны камеры (+X, +Z) — 0,5 м
  const T_W = 1;
  wall(0, -HALF - T_W / 2, HALF * 2 + T_W * 2, T_W, 3);
  wall(-HALF - T_W / 2, 0, T_W, HALF * 2, 3);
  wall(0, HALF + T_W / 2, HALF * 2 + T_W * 2, T_W, 3, { visH: 0.5 });
  wall(HALF + T_W / 2, 0, T_W, HALF * 2, 3, { visH: 0.5 });

  // укрытия: низкие 0,9 м и высокие 2 м
  wall(6, -8, 3, 0.6, 0.9, { tex: COVER_TEX });
  wall(10.5, -13, 0.6, 3, 0.9, { tex: COVER_TEX });
  wall(3, -13, 3, 0.6, 2, { tex: COVER_TEX, xray: true });
  wall(14.5, -9, 2, 0.6, 2, { tex: COVER_TEX, xray: true });
  // колонна
  wall(9, -3.5, 1, 1, 3, { xray: true });
  // стена под 45° — для рикошетов и скольжения
  wall(19, -3, 6, 0.6, 3, { rot: 45, xray: true });
  // угол комнаты
  wall(18.3, 5, 6, 0.6, 3, { xray: true });
  wall(15.6, 7.7, 0.6, 6, 3, { xray: true });
  // коридор шириной 2 м с дверным проёмом 1 м посередине
  wall(7, 13.7, 10, 0.6, 2.4, { xray: true });
  wall(7, 16.3, 10, 0.6, 2.4, { xray: true });
  wall(7, 14.25, 0.3, 0.5, 2.4, { xray: true });
  wall(7, 15.75, 0.3, 0.5, 2.4, { xray: true });

  // ---------- Надписи на полу ----------
  function floorLabel(text: string, x: number, z: number, size = 1, rot = 0, color = '#2b2e33'): void {
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

  // стрельбище: огневой рубеж z = 19, мишени на 5–30 м вдоль −Z
  const RANGE_X = -19, LINE_Z = 19;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(8, 0.012, 0.12), new THREE.MeshBasicMaterial({ color: '#f2efe6' }));
  stripe.position.set(RANGE_X, 0.006, LINE_Z);
  scene.add(stripe);
  for (const x of [RANGE_X - 4, RANGE_X + 4]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.012, 31), new THREE.MeshBasicMaterial({ color: '#d8d4c8' }));
    s.position.set(x, 0.006, LINE_Z - 15.5);
    scene.add(s);
  }
  floorLabel('огневой рубеж', RANGE_X, LINE_Z + 0.9, 1);
  floorLabel('стрельбище', RANGE_X, LINE_Z + 2.2, 1.6);
  floorLabel('укрытия 0,9 м', 7.5, -6.6, 0.9);
  floorLabel('укрытия 2 м', 6, -15, 0.9);
  floorLabel('колонна', 9, -2.3, 0.9);
  floorLabel('стена 45°', 17, -0.4, 0.9);
  floorLabel('угол', 18, 7, 0.9);
  floorLabel('коридор 2 м · проём 1 м', 7, 18, 0.9);
  floorLabel('0', 0.5, 0.6, 0.8);

  // ---------- Мишени ----------
  const dummies: Dummy[] = [];
  // мишени разнесены по ширине дорожки, чтобы ближние не закрывали дальние
  [5, 10, 15, 20, 30].forEach((d, i) => {
    const x = RANGE_X - 3.2 + i * 1.6;
    dummies.push(new Dummy(scene, overlayEl, 'static', x, LINE_Z - d, 0, `${d} м`));
    floorLabel(`${d} м`, x, LINE_Z - d + 0.9, 0.9);
  });
  const rail = new Dummy(scene, overlayEl, 'rail', 0, -17, 0, 'рельс');
  rail.railA = -9; rail.railB = 9;
  dummies.push(rail);
  {
    const r = new THREE.Mesh(new THREE.BoxGeometry(18.6, 0.05, 0.16), new THREE.MeshLambertMaterial({ color: '#5a5e66' }));
    r.position.set(0, 0.025, -17);
    r.receiveShadow = true;
    scene.add(r);
    floorLabel('подвижная мишень', -9, -15.8, 0.9);
  }
  const shooter = new Dummy(scene, overlayEl, 'shooter', 13, -20, 0, 'стрелок');
  dummies.push(shooter);

  const spits = new Spits(scene, fx);
  const grenades = new Grenades(scene, fx, (at) => explode(at, GRENADE.radius, GRENADE.dmg));

  // ---------- Загон врагов ----------
  // Все враги стоят в строю и спят. Попадание или пуля рядом будит именно этого врага. N — все обратно на места.
  const nav = new NavGrid(HALF, obstacles, 0.75);
  const covers = buildCoverPoints(obstacles, nav);
  type EnemySpec = { type: 'beetle'; kind: BeetleKind; x: number } | { type: 'arachnid'; kind: ArachnidKind; x: number }
    | { type: 'jailer'; kind: JailerKind; x: number; z: number; yaw: number };
  const PEN_Z = -10;
  const ROSTER: EnemySpec[] = [
    { type: 'beetle', kind: 'small', x: -15 }, { type: 'beetle', kind: 'fast', x: -13 }, { type: 'beetle', kind: 'spitter', x: -11 },
    { type: 'beetle', kind: 'bombardier', x: -9 }, { type: 'beetle', kind: 'big', x: -7 },
    { type: 'arachnid', kind: 'warrior', x: -3.5 }, { type: 'arachnid', kind: 'spinner', x: 1.2 }, { type: 'arachnid', kind: 'leaper', x: 5.6 },
    // пост ЧВК «Тюремщики» у угла комнаты
    { type: 'jailer', kind: 'rifle', x: 16.5, z: 12, yaw: -2.1 }, { type: 'jailer', kind: 'shotgun', x: 19, z: 12.5, yaw: -2.1 }, { type: 'jailer', kind: 'flamer', x: 21.5, z: 13, yaw: -2.1 },
  ];
  const ARACH_GLOW: Record<ArachnidKind, THREE.Color> = { warrior: new THREE.Color(3.2, 2.2, 0.3), spinner: new THREE.Color(0.7, 3.2, 0.4), leaper: new THREE.Color(2.6, 1, 3) };
  const BEETLE_NAMES: Record<BeetleKind, string> = { small: 'мелкий', fast: 'быстрый', spitter: 'плевун', bombardier: 'бомбардир', big: 'носорог' };
  const ARACH_COLORS: Record<ArachnidKind, string> = { warrior: '#c79a1c', spinner: '#3c9a2a', leaper: '#9a3cb0' };

  interface Enemy {
    spec: EnemySpec;
    name: string;
    beetle: Beetle | null;
    arach: Arachnid | null;
    jailer: Jailer | null;
    /** Малина уже высыпалась из убитого тюремщика */
    looted: boolean;
    awake: boolean;
    gone: boolean;
    label: HTMLDivElement;
    labelText: string;
  }
  const enemies: Enemy[] = [];
  let beetleAI = true;
  const aiRand = rng(4242);

  for (const sp of ROSTER) {
    if (sp.type === 'jailer') { floorLabel(JAILER_NAMES[sp.kind], sp.x, sp.z + 1.3, 0.75, 0, '#1a1b1e'); continue; }
    floorLabel(sp.type === 'beetle' ? BEETLE_NAMES[sp.kind] : ARACHNID_NAMES[sp.kind], sp.x, PEN_Z + (sp.type === 'arachnid' ? 2.4 : 1.3), sp.type === 'arachnid' ? 0.9 : 0.7,
      0, sp.type === 'arachnid' ? ARACH_COLORS[sp.kind] : '#2b2e33');
  }
  floorLabel('пост ЧВК «Тюремщики»', 19, 15.6, 1, 0, '#c4284f');
  floorLabel('загон врагов: выстрел будит, N — на места', -5.5, PEN_Z + 4, 1);

  function spawnEnemies(): void {
    for (const sp of ROSTER) {
      const label = document.createElement('div');
      label.className = 'pg-dummy pg-enemy';
      overlayEl.appendChild(label);
      const e: Enemy = { spec: sp, name: '', beetle: null, arach: null, jailer: null, looted: false, awake: false, gone: false, label, labelText: '' };
      if (sp.type === 'jailer') {
        e.jailer = new Jailer(scene, T, fx, sp.kind, sp.x, sp.z, sp.yaw, aiRand, enemyFire, onEnemyGunEvent);
        e.name = JAILER_NAMES[sp.kind];
      } else if (sp.type === 'beetle') {
        const b = new Beetle(scene, sp.kind, [sp.x, PEN_Z], [sp.x, PEN_Z]);
        b.placeAt(sp.x, PEN_Z, 0);
        e.beetle = b;
        e.name = BEETLE_NAMES[sp.kind];
      } else {
        e.arach = new Arachnid(scene, sp.kind, sp.x, PEN_Z, 0, aiRand, fx);
        e.name = ARACHNID_NAMES[sp.kind];
      }
      enemies.push(e);
    }
  }

  function clearEnemies(): void {
    for (const e of enemies) {
      e.beetle?.dispose();
      e.arach?.dispose();
      e.jailer?.dispose(scene);
      e.label.remove();
    }
    enemies.length = 0;
  }

  function resetEnemies(): void {
    clearEnemies();
    spawnEnemies();
    spits.clear();
    grenades.clear();
  }

  function wakeEnemy(e: Enemy): void {
    if (e.gone) return;
    if (!e.awake && !scripted) (e.jailer ? sfx.shout : sfx.screech)();
    e.awake = true;
    e.arach?.wake();
    e.jailer?.wake();
  }

  /** Обёртка жука под попадания пули */
  function beetleTarget(e: Enemy, b: Beetle): Shootable {
    return {
      pos: b.pos, radius: b.radius * 0.9, alive: !b.dead,
      hit(dmg, dir, point) {
        wakeEnemy(e);
        const d = dmg * BEETLES.dmgScale;
        fx.hit(point, dir, new THREE.Color(3, 2.4, 1), 0.7);
        if (b.damage(d, dir)) killBeetle(b);
      },
    };
  }

  function killBeetle(b: Beetle): void {
    if (!scripted) sfx.kill();
    fx.burst(b.pos.clone().setY(0.35), [b.K.shell, b.K.sheen, '#14161c'], 16, { speed: 4, up: 4.5, size: 0.16 * b.K.scale, life: 1.2 });
  }

  const liveBeetles = (): Beetle[] => enemies.filter((e) => e.beetle && !e.gone).map((e) => e.beetle as Beetle);
  const liveArachnids = (): Arachnid[] => enemies.filter((e) => e.arach && !e.gone).map((e) => e.arach as Arachnid);
  const liveJailers = (): Jailer[] => enemies.filter((e) => e.jailer && !e.gone).map((e) => e.jailer as Jailer);
  spawnEnemies();

  /** Подпись над врагом: имя, состояние, здоровье */
  function drawEnemyLabel(e: Enemy, w: number, h: number): void {
    const obj = e.arach ?? e.beetle ?? e.jailer;
    if (!obj || e.gone) { e.label.style.display = 'none'; return; }
    const top = e.arach ? 3.4 * e.arach.T.scale : e.jailer ? 2.4 : 1.2;
    const v = obj.pos.clone().setY(top).project(camera);
    const on = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
    e.label.style.display = on ? '' : 'none';
    if (!on) return;
    e.label.style.transform = `translate(${((v.x * 0.5 + 0.5) * w).toFixed(1)}px,${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%,-100%)`;
    const hpK = e.arach ? e.arach.hp / e.arach.T.hp : e.beetle ? e.beetle.hp / e.beetle.maxHp : e.jailer ? e.jailer.hero.hp / e.jailer.hero.maxHp : 0;
    const state = e.arach ? e.arach.state : e.jailer ? e.jailer.state : e.awake ? 'охота' : 'спит';
    const t = `<i>${e.name} · ${state}</i><s style="--k:${Math.max(0, hpK).toFixed(2)}"></s>`;
    if (t !== e.labelText) { e.labelText = t; e.label.innerHTML = t; }
  }

  // ---------- Герой ----------
  const rand = rng(20261021);
  const fxRand = rng(7);
  let infiniteAmmo = false;

  const hero = new Hero(scene, T, fx, 'ak74', rand, onFire, onGunEvent);
  hero.place(0, 4, Math.PI);
  hero.onStep = () => { if (!scripted) sfx.step(); };
  hero.onGrenade = (from, target, fuse) => { grenades.throw(from, target, fuse, 'герой'); if (!scripted) sfx.swing(0.8); };

  // прицел гранаты: дуга полёта и кольцо радиуса в точке падения, пока держим G
  const arcMat = new THREE.LineDashedMaterial({ color: '#ffd25a', dashSize: 0.25, gapSize: 0.15, transparent: true, opacity: 0.9, depthTest: false, toneMapped: false });
  const arcLine = new THREE.Line(new THREE.BufferGeometry(), arcMat);
  arcLine.renderOrder = 11;
  arcLine.frustumCulled = false;
  const aimRing = new THREE.Mesh(new THREE.RingGeometry(GRENADE.radius - 0.1, GRENADE.radius, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.6, 0.4), transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  aimRing.rotation.x = -Math.PI / 2;
  const aimDot = new THREE.Mesh(new THREE.CircleGeometry(0.18, 20), aimRing.material);
  aimDot.rotation.x = -Math.PI / 2;
  scene.add(arcLine, aimRing, aimDot);
  function drawGrenadeAim(): void {
    const t = hero.grenadePreview;
    arcLine.visible = aimRing.visible = aimDot.visible = !!t;
    if (!t) return;
    const from = hero.pos.clone().setY(1.6);
    const dx = t.x - from.x, dz = t.z - from.z, d = Math.hypot(dx, dz);
    const T = 0.45 + d * 0.06, g = 14;
    const vy = (0.1 - from.y + 0.5 * g * T * T) / T;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 28; i++) {
      const k = (i / 28) * T;
      pts.push(new THREE.Vector3(from.x + (dx / T) * k, Math.max(0.05, from.y + vy * k - 0.5 * g * k * k), from.z + (dz / T) * k));
    }
    arcLine.geometry.dispose();
    arcLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    arcLine.computeLineDistances();
    aimRing.position.set(t.x, 0.05, t.z);
    aimDot.position.set(t.x, 0.06, t.z);
  }

  /** Попадания по манекенам за выстрел — для одной цифры урона на дробь */
  const hitSum = new Map<Shootable, { d: number; p: THREE.Vector3 }>();

  function targets(): Shootable[] {
    const list: Shootable[] = [...dummies];
    for (const e of enemies) {
      if (e.gone) continue;
      if (e.beetle && !e.beetle.dead) list.push(beetleTarget(e, e.beetle));
      if (e.arach && !e.arach.dead) list.push(e.arach);
      if (e.jailer) {
        if (e.jailer.alive) list.push(e.jailer);
        if (e.jailer.tanks && e.jailer.tanks.alive) list.push(e.jailer.tanks);
      }
    }
    return list;
  }

  /** Расстояние от точки до отрезка в плоскости XZ */
  function segDist(px: number, pz: number, a: THREE.Vector3, b: THREE.Vector3): number {
    const dx = b.x - a.x, dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1;
    const t = THREE.MathUtils.clamp(((px - a.x) * dx + (pz - a.z) * dz) / l2, 0, 1);
    return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
  }
  let lastShot = -9;

  function onFire(req: FireRequest, h: Hero): void {
    const g = req.gun;
    const def = g.def;
    const muzzle = h.muzzle();
    const tg = targets();
    hitSum.clear();
    const tracer = new THREE.Color(...def.tracer);
    for (const a of req.angles) {
      const res = traceShot(muzzle, h.upperYaw + a, req.dmg, def.t.range, req.knock, obstacles, tg, rand);
      for (const s of res.segments) drawTracer(s.from, s.to, tracer);
      for (const w of res.wallHits) {
        chip(w.point, w.nx, w.nz);
        if (w.ricochet) { fx.ricochet(w.point, new THREE.Color(3.2, 2.6, 1.4)); if (fxRand() < 0.5) sfx.ricochet(); }
      }
      for (const t of res.targetHits) {
        const e = hitSum.get(t.target);
        if (e) e.d += t.dmg; else hitSum.set(t.target, { d: t.dmg, p: t.point });
      }
      // пуля прошла рядом: проснувшийся арахнид пугается и может отпрыгнуть,
      // а из спящих будится только первый на пути пули — именно тот, в кого стреляли
      let first: Enemy | null = null, firstT = Infinity;
      for (const en of enemies) {
        if (en.gone) continue;
        const pos = en.arach ? en.arach.pos : en.beetle ? en.beetle.pos : en.jailer && en.jailer.alive ? en.jailer.pos : null;
        if (!pos) continue;
        const r = en.arach ? en.arach.radius : en.jailer ? en.jailer.radius : (en.beetle as Beetle).radius;
        for (const sg of res.segments) {
          const d = segDist(pos.x, pos.z, sg.from, sg.to);
          if (en.awake) { if (d < r + 0.9) { en.arach?.nearMiss(); en.jailer?.suppress(); } continue; }
          if (d < r + 0.4) {
            const t = sg.from.distanceTo(pos);
            if (t < firstT) { firstT = t; first = en; }
          }
        }
      }
      if (first) { first.arach?.nearMiss(); wakeEnemy(first); }
    }
    lastShot = simTime;
    for (const [t, e] of hitSum) {
      if (t instanceof Arachnid) {
        fx.text(e.p, fmtDmg(e.d), req.double ? 'crit' : '');
        fx.burst(e.p, [ARACH_GLOW[t.kind].clone()], 4, { speed: 3, up: 2, size: 0.06, life: 0.35, glow: true, gravity: 6 });
        if (!scripted) sfx.hit();
        for (const en of enemies) if (en.arach === t) wakeEnemy(en);
      }
      if (t instanceof Jailer) {
        fx.text(e.p, fmtDmg(e.d), req.double ? 'crit' : '');
        fx.burst(e.p, ['#22242a', '#141619', '#3a2a24'], 4, { speed: 2.5, up: 2, size: 0.06, life: 0.4 });
        if (!scripted) sfx.hit();
        for (const en of enemies) if (en.jailer === t) wakeEnemy(en);
      }
      for (const en of enemies) if (en.jailer && en.jailer.tanks === t) { fx.burst(e.p, [new THREE.Color(3, 1.6, 0.4)], 6, { speed: 3, up: 2, size: 0.05, life: 0.3, glow: true }); if (!scripted) sfx.ricochet(); }
      if (t instanceof Dummy) {
        fx.text(e.p, fmtDmg(e.d), req.double ? 'crit' : '');
        fx.burst(e.p, ['#d8b779', '#b8935a'], 3, { speed: 2, up: 1.5, size: 0.06, life: 0.4 });
        sfx.hit();
      }
    }
    const yaw = h.upperYaw;
    fx.muzzle(muzzle, yaw, tracer, def.muzzleSize * (req.double ? 1.5 : 1));
    flashLight.position.copy(muzzle);
    flashLight.intensity = 6 * def.muzzleSize;
    flashT = 0.05;
    fx.shake = Math.max(fx.shake, 0.05 + def.t.kick * 0.08 * (req.double ? 2 : 1));
    if (!scripted) {
      if (def.sound === 'dbl' && req.double) sfx.dblBoth();
      else sfx[def.sound]();
    }
  }

  /** Герой как цель для пуль врагов; присев за укрытием, прячется за ним */
  const playerTarget: Shootable = {
    get pos() { return hero.pos; },
    radius: 0.38,
    get alive() { return !hero.down; },
    get shieldY() { return hero.crouched ? 0.8 : undefined; },
    hit(dmg) {
      if (hero.hurt(dmg)) { fx.text(hero.pos, `−${fmtDmg(dmg)}`, 'bad'); fx.shake = Math.max(fx.shake, 0.15); if (!scripted) sfx.hurt(); }
    },
  };

  /** Выстрел тюремщика: пули по герою (и рикошеты), огнемёт — струя пламени */
  function enemyFire(req: FireRequest, h: Hero): void {
    const def = req.gun.def;
    const muzzle = h.muzzle();
    const owner = liveJailers().find((j) => j.hero === h);
    const JT = owner?.T ?? JAILERS.rifle;
    if (def.id === 'flamer') {
      const dir = new THREE.Vector3(Math.sin(h.upperYaw), 0, Math.cos(h.upperYaw));
      fx.spray(muzzle, dir, [new THREE.Color(3.4, 1.4, 0.25), new THREE.Color(3.4, 2.4, 0.5), new THREE.Color(2.4, 0.6, 0.1)], 5, { speed: 9, spread: 0.2, life: 0.5, size: 0.14, gravity: -1.5 });
      if (fxRand() < 0.25) fx.burst(muzzle.clone().addScaledVector(dir, 3 + fxRand() * 2), ['#2a2622', '#3a3430'], 1, { speed: 0.6, up: 1.5, size: 0.25, life: 1.2, gravity: -1.2, drag: 2 });
      flashLight.position.copy(muzzle).addScaledVector(dir, 2);
      flashLight.color.setRGB(1, 0.55, 0.2);
      flashLight.intensity = 5;
      flashT = 0.06;
      // урон: герой в струе (конус, дальность, без стены между)
      const P = hero.pos;
      const dx = P.x - muzzle.x, dz = P.z - muzzle.z;
      const d = Math.hypot(dx, dz);
      const a = Math.atan2(dx, dz) - h.upperYaw;
      const ang = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
      if (!hero.down && d < def.t.range && ang < THREE.MathUtils.degToRad(def.t.spread) + Math.atan(0.4 / Math.max(d, 0.3))
        && !raycastObstacles(muzzle.x, muzzle.z, dx / (d || 1), dz / (d || 1), d, 1.0, obstacles)) {
        if (hero.hurt(JT.flameDps / def.t.rate)) hero.applyBurn(JT.burnDps, JT.burnTime);
      }
      if (!scripted && fxRand() < 0.35) sfx.flame();
      return;
    }
    const tracer = new THREE.Color(...def.tracer);
    for (const a of req.angles) {
      const res = traceShot(muzzle, h.upperYaw + a, req.dmg * JT.dmgMul, def.t.range, req.knock, obstacles, [playerTarget], rand);
      for (const s of res.segments) drawTracer(s.from, s.to, tracer);
      for (const w of res.wallHits) {
        chip(w.point, w.nx, w.nz);
        if (w.ricochet) fx.ricochet(w.point, new THREE.Color(3.2, 2.6, 1.4));
      }
    }
    fx.muzzle(muzzle, h.upperYaw, tracer, def.muzzleSize * (req.double ? 1.5 : 1));
    flashLight.position.copy(muzzle);
    flashLight.color.set('#ffd27a');
    flashLight.intensity = 5 * def.muzzleSize;
    flashT = 0.05;
    if (!scripted) {
      if (def.sound === 'dbl' && req.double) sfx.dblBoth();
      else sfx[def.sound]();
    }
  }

  function onEnemyGunEvent(ev: GunEvent): void {
    if (scripted) return;
    const snd: Partial<Record<GunEvent, () => void>> = { magOut: sfx.magOut, magIn: sfx.magIn, rack: sfx.rack, open: sfx.breakOpen, close: sfx.breakClose, shellsIn: sfx.shellsIn };
    snd[ev]?.();
  }

  /** Взрыв баллонов огнемётчика: бьёт всех вокруг — героя, тюремщиков, жуков, арахнидов, манекены */
  function explode(at: THREE.Vector3, r: number, dmg: number): void {
    fx.explosion(at.clone().setY(1), r, new THREE.Color(3.4, 1.4, 0.3));
    flashLight.position.copy(at).setY(1.5);
    flashLight.color.setRGB(1, 0.6, 0.25);
    flashLight.intensity = 30;
    flashT = 0.2;
    fx.shake = Math.max(fx.shake, 1);
    if (!scripted) sfx.blast();
    // урон падает к краю радиуса; укрытие между взрывом и целью оставляет малую долю
    const k = (p: THREE.Vector3) => {
      const dx = p.x - at.x, dz = p.z - at.z, d = Math.hypot(dx, dz);
      if (d >= r) return 0;
      let f = 1 - (d / r) * 0.6;
      if (d > 0.3 && raycastObstacles(at.x, at.z, dx / d, dz / d, d, 0.6, obstacles)) f *= GRENADE.coverMul;
      return f;
    };
    const dir = (p: THREE.Vector3) => new THREE.Vector3(p.x - at.x, 0, p.z - at.z).normalize();
    const kh = k(hero.pos);
    if (kh > 0 && hero.hurt(dmg * kh)) { hero.applyBurn(6, 2); fx.text(hero.pos, `−${Math.round(dmg * kh)}`, 'bad'); }
    for (const e of enemies) {
      if (e.gone) continue;
      const p = e.jailer?.pos ?? e.arach?.pos ?? e.beetle?.pos;
      if (!p) continue;
      // грохот будит всех поблизости
      if (Math.hypot(p.x - at.x, p.z - at.z) < r * 2.5) wakeEnemy(e);
      if (k(p) <= 0) continue;
      if (e.jailer && e.jailer.alive) e.jailer.hit(dmg * k(p));
      if (e.arach && !e.arach.dead) e.arach.hit(dmg * k(p), dir(p), p, 1);
      if (e.beetle && !e.beetle.dead && e.beetle.damage(dmg * k(p) * BEETLES.dmgScale, dir(p))) killBeetle(e.beetle);
      wakeEnemy(e);
    }
    for (const d of dummies) if (k(d.pos) > 0) d.hit(dmg * k(d.pos), dir(d.pos), d.pos, 1);
  }

  function onGunEvent(ev: GunEvent, g: GunState): void {
    if (scripted) return;
    const snd: Partial<Record<GunEvent, () => void>> = {
      dry: sfx.dry, magOut: sfx.magOut, magIn: sfx.magIn, rack: sfx.rack, open: sfx.breakOpen, close: sfx.breakClose, shellsIn: sfx.shellsIn, draw: () => sfx.draw(0.6),
    };
    snd[ev]?.();
    if (ev === 'dry') fx.text(hero.pos.clone().setY(1), g.rounds ? 'щёлк' : 'пусто', 'bad');
  }

  const fmtDmg = (d: number): string => (Math.abs(d - Math.round(d)) < 0.05 ? String(Math.round(d)) : d.toFixed(1));

  // трассеры: короткий светящийся отрезок пролетает путь пули
  const tracerGeo = new THREE.BoxGeometry(0.035, 0.035, 1);
  function drawTracer(from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color): void {
    const len = from.distanceTo(to);
    if (len < 0.05) return;
    const mat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.9), transparent: true, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(tracerGeo, mat);
    const dir = to.clone().sub(from).normalize();
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const streak = Math.min(len, 2.2);
    m.scale.set(1, 1, streak);
    scene.add(m);
    const dur = Math.max(0.035, len / 320);
    fx.custom(m, dur, (k) => {
      const head = Math.min(len, k * (len + streak));
      const tail = Math.max(0, head - streak);
      m.position.copy(from).addScaledVector(dir, (head + tail) / 2);
      m.scale.z = Math.max(0.01, head - tail);
      mat.opacity = 1 - k * 0.5;
    }, () => mat.dispose());
  }

  // сколы на стенах: пул тёмных квадратиков
  const CHIP_MAX = 400;
  const chips = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.11, 0.11), new THREE.MeshBasicMaterial({ color: '#3a342c', transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), CHIP_MAX);
  chips.count = 0;
  chips.frustumCulled = false;
  scene.add(chips);
  let chipIdx = 0;
  function chip(p: THREE.Vector3, nx: number, nz: number): void {
    const n = new THREE.Vector3(nx, 0, nz);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), fxRand() * Math.PI));
    const s = 0.7 + fxRand() * 0.7;
    chips.setMatrixAt(chipIdx % CHIP_MAX, new THREE.Matrix4().compose(p.clone().addScaledVector(n, 0.004), q, new THREE.Vector3(s, s, s)));
    chipIdx++;
    chips.count = Math.min(CHIP_MAX, chipIdx);
    chips.instanceMatrix.needsUpdate = true;
    const out = p.clone().addScaledVector(n, 0.05);
    fx.burst(out, ['#b9ab90', '#8f8270', '#6a604f'], 3, { speed: 1.6, up: 1.6, size: 0.05, life: 0.5 });
    fx.burst(out, [new THREE.Color(3, 2.4, 1.2)], 2, { speed: 2.5, up: 1, size: 0.035, life: 0.12, glow: true, gravity: 4 });
  }

  // ---------- Ввод ----------
  const keys = new Set<string>();
  const mouseNdc = new THREE.Vector2();
  const mousePx = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  let mouseSeen = false;
  let lmb = false;
  let rmb = false;
  const edges = { crouch: false, roll: false, reload: false, slot: null as HeroInput['slot'] };
  const input = emptyInput();
  /** Ввод из теста (Playwright): клавиатура и мышь игнорируются */
  let scripted = false;

  const AIM_Y = 1.25;
  const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -AIM_Y);
  const raycaster = new THREE.Raycaster();

  const panel = new Panel(document.body);
  const overlays = new Overlays(scene, obstacles);

  let timeScale = 1;
  const TIME_SCALES = [1, 0.5, 0.25, 0.1];
  let paused = false;
  let stepOnce = false;
  let showTelemetry = true;
  let showFps = false;

  window.addEventListener('keydown', (e) => {
    if (['Space', 'Tab', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9'].includes(e.code)) e.preventDefault();
    if (e.ctrlKey && /^Digit\d$/.test(e.code)) e.preventDefault();
    initAudio();
    if (e.repeat) return;
    keys.add(e.code);
    if (e.ctrlKey) {
      const n = Number(e.code.slice(5));
      if (e.code.startsWith('Digit')) {
        if (n === 0) { beetleAI = !beetleAI; toast(beetleAI ? 'ИИ врагов включён' : 'ИИ врагов заморожен'); }
      }
      return;
    }
    switch (e.code) {
      case 'KeyC': edges.crouch = true; break;
      case 'Space': edges.roll = true; break;
      case 'KeyR': edges.reload = true; break;
      case 'Digit1': edges.slot = 'primary'; break;
      case 'Digit2': edges.slot = 'pistol'; break;
      case 'KeyT': cyclePrimary(); break;
      case 'KeyM': toggleMute(); break;
      case 'KeyB': postFX = !postFX; toast(postFX ? 'Постобработка включена' : 'Постобработка выключена'); refreshControls(); break;
      case 'KeyN': resetTargets(); break;
      case 'F1': panel.toggle(); break;
      case 'F2': overlays.colliders = !overlays.colliders; toast(`Коллайдеры: ${overlays.colliders ? 'вкл' : 'выкл'}`); break;
      case 'F3': overlays.aim = !overlays.aim; toast(`Луч и разброс: ${overlays.aim ? 'вкл' : 'выкл'}`); break;
      case 'F4': showTelemetry = !showTelemetry; break;
      case 'F5': infiniteAmmo = !infiniteAmmo; hero.gunner.infinite = infiniteAmmo; toast(`Бесконечные патроны: ${infiniteAmmo ? 'вкл' : 'выкл'}`); refreshControls(); break;
      case 'F6': hero.god = !hero.god; toast(`Бессмертие: ${hero.god ? 'вкл' : 'выкл'}`); refreshControls(); break;
      case 'F7': timeScale = TIME_SCALES[(TIME_SCALES.indexOf(timeScale) + 1) % TIME_SCALES.length]; toast(`Время ×${timeScale}`); break;
      case 'F8': showFps = !showFps; break;
      case 'KeyP': paused = !paused; toast(paused ? 'Пауза' : 'Продолжаем'); break;
      case 'Period': if (paused) stepOnce = true; break;
      default: break;
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); lmb = rmb = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('mousemove', (e) => {
    mouseNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    mousePx.x = e.clientX; mousePx.y = e.clientY;
    mouseSeen = true;
  });
  canvas.addEventListener('mousedown', (e) => {
    initAudio();
    if (e.button === 0) lmb = true;
    if (e.button === 2) rmb = true;
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) lmb = false; if (e.button === 2) rmb = false; });
  canvas.addEventListener('wheel', (e) => { camDist = THREE.MathUtils.clamp(camDist + Math.sign(e.deltaY) * 2, 12, 60); }, { passive: true });

  // экран вверх = мир (−1, −1): так же, как в игре
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
    input.run = keys.has('ShiftLeft') || keys.has('ShiftRight');
    input.aimDown = rmb;
    input.grenade = keys.has('KeyG') && !panel.el.contains(document.activeElement);
    input.fire = lmb && !panel.el.contains(document.activeElement);
    if (mouseSeen) {
      raycaster.setFromCamera(mouseNdc, camera);
      raycaster.ray.intersectPlane(aimPlane, input.aim);
    } else input.aim.set(hero.pos.x + Math.sin(hero.upperYaw) * 4, 0, hero.pos.z + Math.cos(hero.upperYaw) * 4);
    input.crouch = edges.crouch; input.roll = edges.roll; input.reload = edges.reload; input.slot = edges.slot;
  }

  function clearEdges(): void {
    edges.crouch = edges.roll = edges.reload = false; edges.slot = null;
    input.crouch = input.roll = input.reload = false; input.slot = null;
  }

  function cyclePrimary(): void {
    const i = PRIMARIES.indexOf(hero.gunner.primary.def.id);
    equip(PRIMARIES[(i + 1) % PRIMARIES.length]);
  }

  function equip(id: FirearmId): void {
    const slot = (v: 'primary' | 'pistol') => { if (scripted) input.slot = v; else edges.slot = v; };
    if (FIREARMS[id].slot === 'pistol') { slot('pistol'); return; }
    hero.setPrimary(id);
    if (hero.gunner.active !== 'primary') slot('primary');
    toast(FIREARMS[id].name);
    refreshControls();
  }

  function resetTargets(): void {
    for (const d of dummies) d.reset();
    resetEnemies();
    toast('Мишени и враги на местах');
  }

  // ---------- Панель: переключатели ----------
  const refreshers: (() => void)[] = [];
  function refreshControls(): void { for (const r of refreshers) r(); }
  {
    const c = panel.controls;
    refreshers.push(select<FirearmId>(c, 'Основной ствол', PRIMARIES.map((id) => [id, FIREARMS[id].name]), () => hero.gunner.primary.def.id, equip));
    refreshers.push(select(c, 'Подвижная мишень', [['2', '2 м/с'], ['4', '4 м/с'], ['6', '6 м/с']], () => String(rail.railSpeed) as '2' | '4' | '6', (v) => { rail.railSpeed = Number(v); }));
    refreshers.push(toggle(c, 'Манекен-стрелок', () => shooter.active, (v) => { shooter.active = v; }));
    refreshers.push(toggle(c, 'Бесконечные патроны (F5)', () => infiniteAmmo, (v) => { infiniteAmmo = v; hero.gunner.infinite = v; }));
    refreshers.push(toggle(c, 'Бессмертие (F6)', () => hero.god, (v) => { hero.god = v; }));
    refreshers.push(toggle(c, 'Постобработка, bloom (B)', () => postFX, (v) => { postFX = v; }));
    refreshers.push(toggle(c, 'Тени', () => sun.castShadow, (v) => { sun.castShadow = v; }));
    const row = document.createElement('div');
    row.className = 'pg-btnrow';
    c.appendChild(row);
    button(row, 'Сбросить мишени и врагов (N)', resetTargets);
    button(row, 'Разбудить всех врагов', () => { for (const e of enemies) wakeEnemy(e); });
    button(row, 'Пополнить патроны', () => { for (const k of Object.keys(CALIBERS) as (keyof typeof CALIBERS)[]) hero.gunner.reserve[k] = CALIBERS[k].max; hero.grenades = 3; });
    button(row, 'Герой в центр', () => hero.place(0, 4, Math.PI));
  }

  // ---------- HUD ----------
  const hud = document.createElement('div');
  hud.className = 'pg-hud';
  hud.innerHTML = `
    <div class="pg-tele" id="pgTele"></div>
    <div class="pg-fps" id="pgFps"></div>
    <div class="pg-toast" id="pgToast"></div>
    <div class="pg-bottom">
      <div class="pg-hp"><i id="pgHp"></i><b id="pgHpN">100</b></div>
      <div class="pg-gun"><span id="pgGun">АК-74</span><span class="pg-ammo" id="pgAmmo">30 / 180</span><div class="pg-rl"><i id="pgRl"></i></div><span class="pg-gren" id="pgGren">РГД-5 × 3</span></div>
    </div>
    <div class="pg-help">WASD — ходьба · Shift — бег · ПКМ — прицел · C — присед · Space — перекат · R — перезарядка · 1/2 — основной/пистолет · T — сменить основной · G — граната (держи — дальше)<br>
    F1 параметры · F2 коллайдеры · F3 разброс · F4 телеметрия · F5 патроны ∞ · F6 бессмертие · F7 время · P пауза · . кадр · F8 FPS · B bloom · N сброс мишеней и врагов · Ctrl+0 заморозить врагов<br>Враги стоят в загоне и спят: попадание или пуля рядом будит именно этого врага</div>
    <div class="pg-reticle" id="pgRet"><i></i></div>`;
  document.body.appendChild(hud);

  let toastT = 0;
  function toast(s: string): void { const t = $('pgToast'); t.textContent = s; t.classList.add('show'); toastT = 1.4; }

  const cache: Record<string, string> = {};
  function setHTML(id: string, v: string): void { if (cache[id] !== v) { cache[id] = v; $(id).innerHTML = v; } }

  function updateHUD(dt: number, fps: number, frameMs: number): void {
    const g = hero.gun;
    const res = infiniteAmmo ? '∞' : String(hero.gunner.reserve[g.def.caliber]);
    const low = g.rounds < g.capacity * 0.25;
    setHTML('pgGun', `${g.def.name} <small>${CALIBERS[g.def.caliber].name}</small>`);
    setHTML('pgGren', `РГД-5 × ${hero.infiniteGrenades ? '∞' : hero.grenades}`);
    setHTML('pgAmmo', `<b class="${low ? 'low' : ''}">${g.rounds}</b> / ${res}`);
    const rl = g.reload ? g.reload.t / g.reload.dur : 0;
    $('pgRl').style.width = `${rl * 100}%`;
    $('pgHp').style.width = `${(hero.hp / HERO.hp) * 100}%`;
    setHTML('pgHpN', String(Math.ceil(hero.hp)));

    const tele = $('pgTele');
    tele.style.display = showTelemetry ? '' : 'none';
    if (showTelemetry) {
      const spread = THREE.MathUtils.radToDeg(hero.gunner.spread(hero.spreadMul));
      const r = g.reload;
      const rlTxt = r ? `${r.kind === 'tac' ? 'тактическая' : r.kind === 'full' ? 'полная' : 'переламывание'} ${(rl * 100).toFixed(0)}%` : '—';
      setHTML('pgTele', [
        `<b>${hero.state}</b>${hero.touching ? ' · у стены' : ''}${hero.exhausted ? ' · <span class="bad">устал</span>' : ''}`,
        `скорость <b>${hero.speed.toFixed(2)}</b> м/с`,
        `выносливость <b>${hero.stamina.toFixed(0)}</b>`,
        `разброс <b>${spread.toFixed(2)}°</b> (стойка ×${hero.spreadMul.toFixed(2)})`,
        `раскачка <b>${(g.bloom * 100).toFixed(0)}%</b>`,
        `патроны <b>${g.mag}${g.def.reload === 'mag' ? (g.chamber ? '+1' : '+0') : ''}</b> / ${res}`,
        `перезарядка ${rlTxt}`,
        `выстрелов ${hero.gunner.shots}`,
        `врагов не спит <b>${enemies.filter((e) => e.awake && !e.gone).length}</b> / ${enemies.filter((e) => !e.gone).length} · уклонов ${enemies.reduce((a, e) => a + (e.arach?.dodges ?? 0), 0)}`,
        hero.slowT > 0 || hero.poisonT > 0 ? `<span class="bad">паутина ${hero.slowT.toFixed(1)} с · яд ${hero.poisonT.toFixed(1)} с</span>` : '',
        `x ${hero.pos.x.toFixed(2)} · z ${hero.pos.z.toFixed(2)}`,
        `время ×${timeScale}${paused ? ' · <span class="bad">пауза</span>' : ''}${hero.god ? ' · бессмертие' : ''}${infiniteAmmo ? ' · патроны ∞' : ''}`,
      ].join('<br>'));
    }
    const f = $('pgFps');
    f.style.display = showFps ? '' : 'none';
    if (showFps) setHTML('pgFps', `${fps.toFixed(0)} FPS · ${frameMs.toFixed(1)} мс`);

    toastT -= dt;
    if (toastT <= 0) $('pgToast').classList.remove('show');

    // прицел: круг радиусом текущего разброса на расстоянии курсора
    const ret = $('pgRet');
    const show = mouseSeen && !scripted;
    ret.style.display = show ? '' : 'none';
    if (show) {
      const m = hero.muzzle();
      const dist = Math.max(1, Math.hypot(input.aim.x - m.x, input.aim.z - m.z));
      const sp = hero.gunner.spread(hero.spreadMul);
      const side = new THREE.Vector3(Math.cos(hero.upperYaw), 0, -Math.sin(hero.upperYaw)).multiplyScalar(Math.tan(sp) * dist);
      const c0 = input.aim.clone().project(camera);
      const c1 = input.aim.clone().add(side).project(camera);
      const rpx = Math.max(4, Math.hypot((c1.x - c0.x) * 0.5 * window.innerWidth, (c1.y - c0.y) * 0.5 * window.innerHeight));
      ret.style.transform = `translate(${mousePx.x}px,${mousePx.y}px)`;
      ret.style.setProperty('--r', `${rpx.toFixed(1)}px`);
      ret.classList.toggle('blocked', hero.running || hero.rolling || !!g.reload);
    }
  }

  // ---------- Цикл ----------
  const STEP = 1 / 60;
  let simTime = 0;
  let downT = 0;

  function tick(dt: number): void {
    simTime += dt;
    readInput();
    hero.infiniteGrenades = infiniteAmmo;
    hero.update(dt, input, obstacles);
    clearEdges();
    if (hero.down) { downT += dt; if (downT > 2) { hero.revive(); downT = 0; } }

    const ctx = { hero: hero.pos, obstacles, spit: (from: THREE.Vector3, to: THREE.Vector3) => { spits.fire(from, to, 10, 8); if (!scripted) sfx.spit(); } };
    for (const d of dummies) d.update(dt, ctx);

    // враги: спят, пока их не разбудит выстрел
    const allBeetles = liveBeetles();
    const arachs = liveArachnids();
    const actx: ArachnidContext = {
      hero: {
        pos: hero.pos, vel: hero.vel, upperYaw: hero.upperYaw + hero.gun.drift, aiming: hero.aiming, running: hero.running, rolling: hero.rolling,
        down: hero.down, reloading: !!hero.gun.reload || hero.gunner.switchT > 0, muzzle: hero.muzzle(),
        spread: hero.gunner.spread(hero.spreadMul), range: hero.gun.def.t.range,
      },
      firing: simTime - lastShot < 0.25 || input.fire,
      nav, obstacles, others: arachs,
      hurtHero(dmg, from, what) {
        if (hero.hurt(dmg)) {
          fx.text(hero.pos, `−${dmg}`, 'bad');
          fx.shake = Math.max(fx.shake, what === 'pounce' ? 0.6 : 0.3);
          // толчок от удара
          const push = hero.pos.clone().sub(from).setY(0).setLength(what === 'pounce' ? 1.2 : 0.5);
          hero.pos.add(push);
          resolveCircle(hero.pos, HERO.radius, obstacles);
          if (!scripted) sfx.hurt();
          return true;
        }
        if (hero.rolling) fx.text(hero.pos, 'уклон', '');
        return false;
      },
      web(from, vel, t) { spits.fireWeb(from, vel, t); },
      dangers: grenades.list,
      sound(k) { if (!scripted) sfx[k](); },
    };
    for (const e of enemies) {
      if (e.gone || !e.awake || !beetleAI) continue;
      if (e.arach) e.arach.update(dt, actx);
      const b = e.beetle;
      if (b && !b.dead) {
        b.update(dt, simTime, [], hero, allBeetles, () => {}, (_b, from, to, r) => {
          spits.fire(from.clone().setY(0.9), to.clone().setY(0.9), r.speed, r.dmg, new THREE.Color(...r.color));
          if (!scripted) sfx.spit();
        });
        resolveCircle(b.pos, b.radius * 0.8, obstacles);
        if (!b.ranged && !hero.down) {
          const d = Math.hypot(b.pos.x - hero.pos.x, b.pos.z - hero.pos.z);
          if (d < b.radius + 0.45 && hero.hurt(b.bite * BEETLES.biteMul * dt) && !scripted) sfx.chew();
        }
      }
    }
    // спящие арахниды дышат и светятся
    for (const e of enemies) if (e.arach && !e.awake && !e.gone) e.arach.update(dt, actx);

    // тюремщики
    const jailers = liveJailers();
    const jctx: JailerContext = {
      player: hero, obstacles, nav, covers, others: jailers,
      alert(from) {
        // тревога: просыпаются соседи по посту
        for (const en of enemies) if (en.jailer && !en.awake && en.jailer.pos.distanceTo(from.pos) < 16) wakeEnemy(en);
      },
      dangers: grenades.list,
      throwGrenade(from, target, fuse, who) { grenades.throw(from, target, fuse, who.name); if (!scripted) sfx.swing(0.8); },
      say(text, who) { fx.text(who.pos.clone().setY(0.6), text, 'bad'); if (!scripted) sfx.shout(); },
    };
    for (const e of enemies) {
      const j = e.jailer;
      if (!j || e.gone) continue;
      if (j.blastPending) { j.blastPending = false; explode(j.tanks ? j.tanks.pos : j.pos, j.T.blastR, j.T.blastDmg); j.hero.hurt(9999); }
      if (e.awake && !beetleAI && !j.hero.down) continue;
      j.update(dt, jctx);
      if (j.hero.down && !e.looted) {
        // из убитого тюремщика высыпается украденная малина
        e.looted = true;
        fx.burst(j.pos.clone().setY(1), ['#c4284f', '#e0284f', '#8a1030'], 18, { speed: 3, up: 4, size: 0.12, life: 1.4 });
        fx.text(j.pos, '+малина', 'berry');
        if (!scripted) sfx.harvest();
      }
    }
    // горит — языки пламени на герое
    if (hero.burnT > 0 && fxRand() < 0.6) fx.burst(hero.pos.clone().add(new THREE.Vector3((fxRand() - 0.5) * 0.5, 0.4 + fxRand() * 1.2, (fxRand() - 0.5) * 0.5)), [new THREE.Color(3.4, 1.5, 0.3), new THREE.Color(3.4, 2.6, 0.6)], 1, { speed: 0.4, up: 1.8, size: 0.09, life: 0.4, glow: true, gravity: -2 });
    for (const e of enemies) {
      if (e.gone) continue;
      if (e.beetle?.dead) { e.beetle.dispose(); e.gone = true; }
      if (e.arach?.dead) { e.arach.explode(); if (!scripted) sfx.kill(); e.arach.dispose(); e.gone = true; }
    }

    grenades.update(dt, obstacles);

    spits.update(dt, obstacles, (s: Spit) => {
      if (Math.hypot(s.pos.x - hero.pos.x, s.pos.z - hero.pos.z) > 0.45) return false;
      if (s.pos.y > hero.headTop) return false; // пролетел над каской
      if (hero.rolling && hero.invulnerable) { fx.text(hero.pos, 'уклон', ''); return false; }
      if (s.web) {
        // паутина: урон, замедление и яд
        if (hero.applyWeb(s.web.webSlow, s.web.webSlowTime, s.web.poisonDps, s.web.poisonTime)) {
          hero.hurt(s.dmg);
          fx.text(hero.pos, 'паутина!', 'bad');
          if (!scripted) sfx.webHit();
        }
      } else if (hero.hurt(s.dmg)) { fx.text(hero.pos, `−${s.dmg}`, 'bad'); if (!scripted) sfx.hurt(); }
      fx.burst(s.pos.clone(), [new THREE.Color(0.9, 3, 0.4)], s.web ? 14 : 8, { speed: 2.5, up: 2, size: 0.07, life: 0.4, glow: true, gravity: 6 });
      return true;
    });

    fx.update(dt, window.innerWidth, window.innerHeight);
    flashT = Math.max(0, flashT - dt);
    flashLight.intensity = flashT > 0 ? flashLight.intensity * 0.6 : 0;
  }

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

    if (!paused) acc += real * timeScale;
    else if (stepOnce) { acc += STEP; stepOnce = false; }
    let n = 0;
    while (acc >= STEP && n < 6) { tick(STEP); acc -= STEP; n++; }
    if (n >= 6) acc = 0;

    // камера: как в игре; в прицеле сдвигается к точке прицела
    const shift = hero.aiming ? HERO.aimCamShift : 0;
    const want = hero.pos.clone().lerp(input.aim.clone().setY(0), shift);
    if (camOverride) camTarget.copy(camOverride); else if (scripted) camTarget.copy(want); else camTarget.lerp(want, Math.min(1, real * 6));
    const sh = fx.shake * 0.2;
    camera.position.copy(camTarget).addScaledVector(CAM_DIR, camDist).add(new THREE.Vector3((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh));
    camera.lookAt(camTarget.x, 0.6, camTarget.z);
    sun.position.copy(camTarget).add(SUN_OFFSET);
    sun.target.position.copy(camTarget);

    drawGrenadeAim();

    // «рентген»: высокие стены между камерой и героем полупрозрачны
    const eye = camera.position.clone();
    const chest = hero.pos.clone().setY(1.1);
    const ray = new THREE.Ray(eye, chest.clone().sub(eye).normalize());
    const maxD = eye.distanceTo(chest);
    const hitP = new THREE.Vector3();
    for (const w of xray) {
      const hit = ray.intersectBox(w.box, hitP);
      const block = !!hit && eye.distanceTo(hitP) < maxD;
      w.mat.opacity += ((block ? 0.28 : 1) - w.mat.opacity) * Math.min(1, real * 10);
      w.mat.depthWrite = w.mat.opacity > 0.95;
    }

    // оверлеи
    overlays.update();
    if (overlays.colliders) {
      const list = [{ x: hero.pos.x, z: hero.pos.z, r: HERO.radius }];
      for (const d of dummies) list.push({ x: d.pos.x, z: d.pos.z, r: d.radius });
      for (const b of liveBeetles()) list.push({ x: b.pos.x, z: b.pos.z, r: b.radius * 0.9 });
      for (const a of liveArachnids()) list.push({ x: a.pos.x, z: a.pos.z, r: a.radius });
      for (const j of liveJailers()) { list.push({ x: j.pos.x, z: j.pos.z, r: j.radius }); if (j.tanks?.alive) { const p = j.tanks.pos; list.push({ x: p.x, z: p.z, r: j.tanks.radius }); } }
      overlays.drawCircles(list);
      overlays.drawPaths(liveArachnids().filter((a) => a.active).map((a) => [a.pos, ...a.debugPath]));
    } else { overlays.drawCircles([]); overlays.drawPaths([]); }
    overlays.drawAim(hero.muzzle(), hero.upperYaw + hero.gun.drift, hero.gunner.spread(hero.spreadMul), hero.gun.def.t.range * 1.5);

    const w = window.innerWidth, h = window.innerHeight;
    for (const d of dummies) d.drawLabel(camera, w, h);
    for (const e of enemies) drawEnemyLabel(e, w, h);
    panel.setGun(hero.gun.def.id, hero.gun.def.name);
    if (panel.open) panel.sync();
    updateHUD(real, fpsVal, frameMs);

    if (postFX) composer.render();
    else renderer.render(scene, camera);
  }
  frame();

  // ---------- Отладочный хук ----------
  window.__malina = {
    mode: 'playground',
    hero, input, dummies, obstacles, camera, GUNS, HERO, ARACHNIDS, nav,
    get enemies() { return enemies; },
    get beetles() { return liveBeetles(); },
    get arachnids() { return liveArachnids(); },
    get jailers() { return liveJailers(); },
    grenades,
    covers,
    /** Разбудить врага по имени вида ('warrior', 'small'…) или всех */
    wake(kind?: string) { for (const e of enemies) if (!kind || e.spec.kind === kind) wakeEnemy(e); },
    resetEnemies,
    /** Для тестов: луч на уровне пола против препятствий и расстояние до ближайшего */
    raycast(x: number, z: number, dx: number, dz: number, d: number) { return raycastObstacles(x, z, dx, dz, d, 0.05, obstacles) !== null; },
    minObsDist(x: number, z: number) { return Math.min(...obstacles.map((o) => distToObstacle(x, z, o))); },
    /** Ввод из теста: клавиатура и мышь перестают влиять на героя */
    script(on = true) { scripted = on; if (on) { input.move.set(0, 0); input.fire = false; input.run = false; input.aimDown = false; } },
    /** Прогнать симуляцию sec секунд без реального времени */
    step(sec: number) { const n = Math.round(sec / STEP); for (let i = 0; i < n; i++) tick(STEP); },
    /** Нажатие: crouch | roll | reload | primary | pistol */
    press(what: 'crouch' | 'roll' | 'reload' | 'primary' | 'pistol') {
      if (what === 'primary' || what === 'pistol') input.slot = what; else input[what] = true;
    },
    equip, resetTargets,
    setAim(x: number, z: number) { input.aim.set(x, AIM_Y, z); },
    setCamTarget(x?: number, z?: number) { camOverride = x === undefined || z === undefined ? null : new THREE.Vector3(x, 0, z); },
    /** Заморозить или разморозить ИИ врагов (как Ctrl+0) */
    freezeAI(on = true) { beetleAI = !on; },
    setCam(dist: number, dir?: [number, number, number]) { camDist = dist; if (dir) CAM_DIR.set(...dir).normalize(); },
    toggles: { get postFX() { return postFX; }, set postFX(v: boolean) { postFX = v; } },
  };
}
