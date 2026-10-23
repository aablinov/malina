import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { initAudio, sfx, toggleMute } from '../audio';
import { Props, type LootKind } from '../props';
import { type Obstacle } from '../collision';
import { FX } from '../fx';
import { emptyInput, Knight, type Strike } from '../knight';
import type { Target } from '../target';
import { makeTextures, rng } from '../textures';
import { Level, type LevelJSON } from '../level/level.ts';
import { LevelRenderer, liquidTime } from '../level/mesher';
import { ceilingAt, collideTop, obstaclesOf, raycastVoxels, terrainOf } from '../level/collide.ts';
import { Pathfinder } from '../level/pathfind.ts';
import { mapByName } from '../level/maps';
import type { PgLabel } from '../level/playground-map.ts';
import { HERO, SWORD, snapshotTuning } from '../tuning';
import { Dummy } from './dummies';
import { Overlays } from './overlay';
import { DEV_TOOLS, openEditor } from '../devflag';
import { button, Panel, toggle } from './panel';
import '../style.css';
import './playground.css';

declare global {
  interface Window { __malina?: unknown }
}

/** ?map=editor — автосохранение редактора (кнопка «Играть»), ?map=<имя> — файл из assets/maps/, иначе playground.json */
function pickMap(): LevelJSON {
  const name = new URLSearchParams(window.location.search).get('map');
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
   * ступени на площадку, витрина блоков и дом во дворе. Механики живут в общих модулях (knight.ts, trail.ts), здесь — сцена и отладка.
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
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 220);
  const CAM_DIR = new THREE.Vector3(1, 1.38, 1).normalize();
  let camDist = 24;
  /** Для скриншотов и тестов: камера смотрит в заданную точку */
  let camOverride: THREE.Vector3 | null = null;
  const camTarget = new THREE.Vector3();

  // свет: день — тёплое солнце и голубое небо, ночь — лунный синий, а светят факелы, вода и светлячки (style-guide.md)
  const hemi = new THREE.HemisphereLight('#cdeeff', '#6f9a4a', 1.15);
  const ambient = new THREE.AmbientLight('#ffffff', 0.15);
  scene.add(hemi, ambient);
  const sun = new THREE.DirectionalLight('#fff0d2', 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 90 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const SUN_OFFSET = new THREE.Vector3(-14, 30, 9);
  let night = false;
  function applyNight(): void {
    scene.background = new THREE.Color(night ? '#0e2a44' : '#8fd3f5');
    hemi.color.set(night ? '#5a86c8' : '#cdeeff');
    hemi.groundColor.set(night ? '#1d3a3a' : '#6f9a4a');
    hemi.intensity = night ? 0.75 : 1.15;
    sun.color.set(night ? '#8fb4ff' : '#fff0d2');
    sun.intensity = night ? 0.55 : 2.3;
    bloom.strength = night ? 0.75 : 0.45;
  }

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.45, 0.4, 0.85);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let postFX = true;
  applyNight();

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
  // Арена и витрина — карта assets/maps/playground.json (генератор src/level/playground-map.ts, `npm run map:playground`,
  // правка — редактор ?dev=editor).
  const level = Level.fromJSON(pickMap());
  const view = new LevelRenderer(scene, level, T);
  const terrain = terrainOf(level);
  const pathfinder = new Pathfinder(level, terrain);
  const bounds = level.getBounds() ?? { minX: -HALF, maxX: HALF, minZ: -HALF, maxZ: HALF, minY: -1, maxY: 0 };
  const obstacles: Obstacle[] = obstaclesOf(level, 0, bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ);

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
  floorLabel('укрытия', 6.5, -6.6, 0.9);
  floorLabel('колонна', 9, -2.3, 0.9);
  floorLabel('угол', 18, 7, 0.9);
  floorLabel('коридор 3 м · проём 1 м', 7, 18.8, 0.9);
  floorLabel('диагональ', 17, -0.4, 0.9);

  // ---------- Чучела ----------
  const dummies: Dummy[] = [];
  // кучка из четырёх — проверить, что широкий удар задевает нескольких, и одиночное в стороне
  for (const [x, z, name] of [[-6, -3, 'чучело 1'], [-7.4, -3.7, 'чучело 2'], [-4.6, -3.7, 'чучело 3'], [-6, -5.2, 'чучело 4'], [-11, 0, 'одиночное']] as [number, number, string][]) {
    dummies.push(new Dummy(scene, overlayEl, 'static', x, z, Math.PI / 4, name));
  }
  floorLabel('чучела: ЛКМ — удар, держи — комбо', -6, -1.6, 0.85);
  const rail = new Dummy(scene, overlayEl, 'rail', 0, -17, 0, 'на рельсе');
  rail.railA = -9; rail.railB = 9;
  dummies.push(rail);
  {
    const r = new THREE.Mesh(new THREE.BoxGeometry(18.6, 0.05, 0.16), new THREE.MeshLambertMaterial({ color: '#7a5232' }));
    r.position.set(0, 0.025, -17);
    r.receiveShadow = true;
    scene.add(r);
    floorLabel('подвижное чучело', -9, -15.8, 0.9);
  }

  // ---------- Склад: интерактивные предметы ----------
  const props = new Props(scene, fx, rng(99), {
    explode: (at, r, dmg) => explode(at, r, dmg),
    give: (kind, amount, at) => giveLoot(kind, amount, at),
    sound: (k) => { if (scripted) return; ({ open: sfx.breakOpen, pickup: sfx.pickup, break: sfx.burst, heal: sfx.ready, ignite: sfx.flame } as const)[k](); },
  }, {
    barrels: [[-11, 11], [-10.25, 11.6], [-10.9, 10.15], [-6, 12.2], [-3.4, 18]],
    crates: [[-8.6, 14, 0], [-7.6, 14, 0], [-6.6, 14, 0], [-4.2, 15.2, 15], [-12.8, 15.6, 0], [-12.8, 16.6, 0]],
    supplies: [[-9.6, 17.6, 145], [-5.4, 19, 160]],
    terminals: [[-2.6, 10.6, 50]],
  });
  floorLabel('склад: бочки, сундуки (E), источник здоровья (E), ящики', -7.5, 21.3, 0.9);
  let berries = 0;
  /** Нажали E — использовать ближайший предмет */
  let interactReq = false;

  function giveLoot(kind: LootKind, amount: number, at: THREE.Vector3): void {
    let text = '';
    if (kind === 'berry') { berries += amount; text = `+${amount} малины`; }
    else { hero.hp = Math.min(hero.maxHp, hero.hp + amount); text = `+${amount} здоровья`; }
    fx.text(at.clone().setY(0.4), text, kind === 'berry' ? 'berry' : 'heal');
  }

  // ---------- Герой ----------
  const fxRand = rng(7);
  const hero = new Knight(scene, T);
  hero.place(0, 4, Math.PI);
  hero.onStep = () => { if (!scripted && hero.grounded) sfx.step(); };
  hero.onSwing = (step) => { if (!scripted) sfx.swing(step === 2 ? 0.7 : step === 1 ? 1.15 : 1, step === 2); };
  hero.onLand = (v) => {
    if (v > 5) fx.burst(hero.pos.clone().setY(hero.pos.y + 0.05), ['#d8cfa8', '#b9ad88', '#9a8f70'], Math.min(14, Math.round(v)), { speed: 2, up: 1.2, size: 0.1, life: 0.4, gravity: 5 });
    if (!scripted) sfx.land();
  };
  hero.onRoll = () => { if (!scripted) sfx.roll(); };
  hero.onStrike = (s) => strike(s);

  /** Все цели для удара: чучела, бочки, ящики */
  const targets = (): Target[] => [...dummies, ...props.targets];
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
      const inWave = finisher && Math.hypot(t.pos.x - impact.x, t.pos.z - impact.z) - t.radius <= SWORD.shockR;
      if (!inArc && !inWave) continue;
      if (terrain.blocked(s.from.x, s.from.z, t.pos.x, t.pos.z, hero.pos.y + 0.5)) continue;
      hit.add(t);
    }
    for (const t of hit) {
      const dir = new THREE.Vector3(t.pos.x - s.from.x, 0, t.pos.z - s.from.z).normalize();
      const point = t.pos.clone().setY(1.1).addScaledVector(dir, -t.radius);
      t.hit(s.dmg, dir, point, s.knock);
      fx.text(point, String(s.dmg), finisher ? 'crit' : '');
      fx.burst(point, finisher ? [new THREE.Color(3.4, 2.6, 1.1), '#e8c35a'] : [new THREE.Color(1.8, 2.6, 3.4), '#e8c35a'], 7, { speed: 3.5, up: 2.5, size: 0.08, life: 0.4, glow: true, gravity: 8 });
    }
    if (finisher) {
      // ударная волна: кольцо по земле, пыль и тряска
      fx.shock(impact.clone().setY(impact.y + 0.05), SWORD.shockR, new THREE.Color(3.2, 2.4, 1.0), 0.4, 0.18);
      fx.burst(impact.clone().setY(impact.y + 0.1), ['#d8cfa8', '#b9ad88', '#9a8f70'], 14, { speed: 3.2, up: 2.2, size: 0.12, life: 0.5, gravity: 6 });
      fx.shake = Math.max(fx.shake, 0.55);
      if (!scripted) sfx.quake();
    } else if (hit.size) fx.shake = Math.max(fx.shake, 0.18);
    if (hit.size && !scripted) sfx.hit();
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
    if (kh > 0 && hero.hurt(dmg * kh)) fx.text(hero.pos.clone().setY(hero.pos.y + 1), `−${Math.round(dmg * kh)}`, 'bad');
    for (const d of dummies) if (k(d.pos) > 0) d.hit(dmg * k(d.pos), dir(d.pos), d.pos, 1);
    props.blast(at, r, dmg);
  }

  // ---------- Светлячки: медленно плывут вокруг камеры, ночью ярче ----------
  const MOTES = 70;
  const moteMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.9, 0.7), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const motes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), moteMat, MOTES);
  motes.frustumCulled = false;
  scene.add(motes);
  const moteSeed = Array.from({ length: MOTES }, () => [fxRand(), fxRand(), fxRand(), fxRand()]);
  const moteM = new THREE.Matrix4();
  function updateMotes(t: number): void {
    const R = 14;
    moteMat.opacity = night ? 1 : 0.45;
    moteSeed.forEach(([a, b, c, d], i) => {
      // точка в квадрате 2R вокруг героя, переносится по кругу, чтобы светлячки не кончались
      const wrapR = (v: number, o: number) => o + ((((v - o + R) % (2 * R)) + 2 * R) % (2 * R)) - R;
      const x = wrapR(a * 2 * R + Math.sin(t * 0.3 + d * 9) * 2 + t * 0.15, camTarget.x);
      const z = wrapR(b * 2 * R + Math.cos(t * 0.25 + c * 7) * 2, camTarget.z);
      // высота — от земли под камерой, а не от героя: в падении светлячки остаются на месте
      const y = camTarget.y + 0.4 + c * 2.6 + Math.sin(t * (0.6 + d) + a * 20) * 0.3;
      const s = 0.6 + 0.5 * Math.max(0, Math.sin(t * (1.2 + c * 2) + b * 30));
      moteM.makeScale(s, s, s).setPosition(x, y, z);
      motes.setMatrixAt(i, moteM);
    });
    motes.instanceMatrix.needsUpdate = true;
  }

  // ---------- Ввод ----------
  const keys = new Set<string>();
  const mouseNdc = new THREE.Vector2();
  const mousePx = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  let mouseSeen = false;
  let lmb = false;
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
  let showTelemetry = true;
  let showFps = false;

  window.addEventListener('keydown', (e) => {
    if (['Space', 'Tab', 'F1', 'F2', 'F3', 'F4', 'F6', 'F7', 'F8', 'F9', 'F10'].includes(e.code)) e.preventDefault();
    initAudio();
    if (e.repeat) return;
    if (e.code === 'F10' && DEV_TOOLS) { openEditor(); return; }
    keys.add(e.code);
    switch (e.code) {
      case 'Space': edges.roll = true; break;
      case 'Digit1': case 'Digit2': case 'Digit3': castSpell(Number(e.code.slice(5)) - 1); break;
      case 'KeyE': interactReq = true; break;
      case 'KeyM': toggleMute(); break;
      case 'KeyL': night = !night; applyNight(); toast(night ? 'Ночь' : 'День'); refreshControls(); break;
      case 'KeyB': postFX = !postFX; toast(postFX ? 'Постобработка включена' : 'Постобработка выключена'); refreshControls(); break;
      case 'KeyN': resetTargets(); break;
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
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); lmb = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('mousemove', (e) => {
    mouseNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    mousePx.x = e.clientX; mousePx.y = e.clientY;
    mouseSeen = true;
  });
  canvas.addEventListener('mousedown', (e) => { initAudio(); if (e.button === 0) lmb = true; });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) lmb = false; });
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
      // курсор на земле — верх блока под лучом камеры (срезанные этажи дома пропускаем), цель — по тому же лучу
      raycaster.setFromCamera(mouseNdc, camera);
      groundAt(raycaster.ray, pointer.ground);
      pointer.hover = pickRay(raycaster.ray);
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
  const pointer = { down: false, shift: false, ground: new THREE.Vector3(), hover: null as Target | null };
  let pointerWas = false;
  /** Режим текущего нажатия: идти, бить цель, бить на месте */
  let pressMode: 'walk' | 'chase' | 'here' = 'walk';
  let goal: THREE.Vector3 | null = null;
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
  /** Срез этажей дома (всё выше не рисуется и не ловит клик) */
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
    path = pathfinder.find(hero.pos, to, { solids: props.solids });
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
      pressMode = pointer.shift ? 'here' : pointer.hover ? 'chase' : 'walk';
      chase = null; goal = null; path = []; stuckRepaths = 0; repathT = 0; arrived = false;
      if (pressMode === 'chase') { chase = pointer.hover; chaseSwings = hero.swings; }
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

  // ---------- Заклинания: слоты 1/2/3 с перезарядкой (пока пустые) ----------
  interface Spell { name: string; cd: number; t: number; cast(): void }
  const spells: (Spell | null)[] = [null, null, null];
  function castSpell(i: number): void {
    const sp = spells[i];
    if (!sp) { toast(`Слот ${i + 1}: заклинаний пока нет`); return; }
    if (sp.t > 0) return;
    sp.cast();
    sp.t = sp.cd;
  }

  function resetTargets(): void {
    for (const d of dummies) d.reset();
    props.reset();
    toast('Чучела и склад на местах');
  }

  // ---------- Панель: переключатели ----------
  const refreshers: (() => void)[] = [];
  function refreshControls(): void { for (const r of refreshers) r(); }
  {
    const c = panel.controls;
    refreshers.push(toggle(c, 'Ночь (L)', () => night, (v) => { night = v; applyNight(); }));
    refreshers.push(toggle(c, 'Бессмертие (F6)', () => hero.god, (v) => { hero.god = v; }));
    refreshers.push(toggle(c, 'Постобработка, bloom (B)', () => postFX, (v) => { postFX = v; }));
    refreshers.push(toggle(c, 'Тени', () => sun.castShadow, (v) => { sun.castShadow = v; }));
    const row = document.createElement('div');
    row.className = 'pg-btnrow';
    c.appendChild(row);
    button(row, 'Сбросить чучела и склад (N)', resetTargets);
    button(row, 'Герой в центр', () => hero.place(0, 4, Math.PI));
  }

  // ---------- HUD ----------
  const hud = document.createElement('div');
  hud.className = 'pg-hud';
  hud.innerHTML = `
    <div class="pg-tele" id="pgTele"></div>
    <div class="pg-fps" id="pgFps"></div>
    <div class="pg-toast" id="pgToast"></div>
    <div class="pg-bar">
      <div class="pg-spells">${[1, 2, 3].map((n) => `<div class="pg-slot pg-spell" title="Заклинание ${n}"><div class="pg-cd" id="pgSpellCd${n}"></div><kbd>${n}</kbd></div>`).join('')}</div>
      <div class="pg-slot" title="Меч"><span class="pg-sword"></span><div class="pg-combo" id="pgCombo"><i></i><i></i><i></i></div><kbd>ЛКМ</kbd></div>
      <div class="pg-heart"><div class="pg-heart-fill" id="pgHp"></div><b id="pgHpN">100</b></div>
      <div class="pg-slot" title="Перекат"><span class="pg-roll"></span><div class="pg-cd" id="pgRollCd"></div><kbd>Space</kbd></div>
      <div class="pg-berry"><i></i><b id="pgBerry">0</b></div>
    </div>
    <div class="pg-prompt" id="pgPrompt"></div>
    <div class="pg-help">ЛКМ по земле — идти · ЛКМ по цели — подойти и бить (держи — комбо из трёх) · Shift + ЛКМ — бить на месте · WASD — ходьба · Space — перекат · 1/2/3 — заклинания · E — использовать · L — день/ночь<br>
    F1 параметры · F2 коллайдеры и путь · F3 дуга удара · F4 телеметрия · F6 бессмертие · F7 время · P пауза · . кадр · F8 FPS · B bloom · N сброс чучел и склада · F10 редактор</div>
    <div class="pg-reticle" id="pgRet"><i></i></div>`;
  document.body.appendChild(hud);

  let toastT = 0;
  function toast(s: string): void { const t = $('pgToast'); t.textContent = s; t.classList.add('show'); toastT = 1.4; }

  const cache: Record<string, string> = {};
  function setHTML(id: string, v: string): void { if (cache[id] !== v) { cache[id] = v; $(id).innerHTML = v; } }

  function updateHUD(dt: number, fps: number, frameMs: number): void {
    setHTML('pgBerry', String(berries));
    const near = hero.down ? null : props.nearest(hero.pos, hero.hp, hero.maxHp);
    const promptEl = $('pgPrompt');
    promptEl.style.display = near ? '' : 'none';
    if (near) setHTML('pgPrompt', `<kbd>E</kbd>${near.prompt}`);
    $('pgHp').style.height = `${(hero.hp / hero.maxHp) * 100}%`;
    setHTML('pgHpN', String(Math.ceil(hero.hp)));
    $('pgRollCd').style.height = `${(hero.rollCdT / HERO.rollCd) * 100}%`;
    spells.forEach((sp, i) => { $(`pgSpellCd${i + 1}`).style.height = sp ? `${(sp.t / sp.cd) * 100}%` : '0%'; });
    const pips = $('pgCombo').children;
    for (let i = 0; i < 3; i++) pips[i].classList.toggle('on', hero.combo >= i);

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
    if (showFps) setHTML('pgFps', `${fps.toFixed(0)} FPS · ${frameMs.toFixed(1)} мс`);

    toastT -= dt;
    if (toastT <= 0) $('pgToast').classList.remove('show');

    const ret = $('pgRet');
    const show = mouseSeen && !scripted;
    ret.style.display = show ? '' : 'none';
    if (show) {
      ret.style.transform = `translate(${mousePx.x}px,${mousePx.y}px)`;
      ret.classList.toggle('hover', !!pointer.hover && !pointer.shift);
      ret.classList.toggle('here', pointer.shift);
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
    for (const sp of spells) if (sp) sp.t = Math.max(0, sp.t - dt);
    markerT -= dt;
    marker.visible = markerT > 0;
    (marker.material as THREE.MeshBasicMaterial).opacity = Math.max(0, markerT * 2);
    marker.scale.setScalar(1 + (0.5 - markerT));
    hero.update(dt, input, props.solids, terrain);
    view.sync();
    view.update(simTime, night ? 1 : 0.4, hero.pos);
    view.setXray(hero.pos.clone().setY(hero.pos.y + 0.9), camera.position, 2.0);
    // в доме: срезать потолок и всё, что выше, — виден этаж, где стоит герой
    cutY = ceilingAt(level, hero.pos.x, hero.pos.z, hero.pos.y);
    view.setCut(cutY - 0.01);

    if (interactReq) {
      interactReq = false;
      const it = props.nearest(hero.pos, hero.hp, hero.maxHp);
      if (it && !hero.down) props.interact(it, hero.hp, hero.maxHp);
    }
    const healed = props.update(dt, hero);
    if (healed > 0) hero.hp = Math.min(hero.maxHp, hero.hp + healed);
    clearEdges();
    if (hero.down) { downT += dt; if (downT > 2) { hero.revive(); downT = 0; } }
    for (const d of dummies) d.update(dt);
    fx.update(dt, window.innerWidth, window.innerHeight);
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
    render(real);
  }

  /** Камера, оверлеи, HUD и кадр; real — сколько прошло реального времени */
  function render(real: number): void {
    // камера следит за героем; по высоте — плавно, чтобы падение не дёргало кадр
    const want = hero.pos.clone();
    if (camOverride) camTarget.copy(camOverride); else if (scripted) camTarget.copy(want); else {
      camTarget.x += (want.x - camTarget.x) * Math.min(1, real * 6);
      camTarget.z += (want.z - camTarget.z) * Math.min(1, real * 6);
      camTarget.y += ((hero.grounded ? want.y : camTarget.y) - camTarget.y) * Math.min(1, real * 3);
    }
    const sh = fx.shake * 0.2;
    camera.position.copy(camTarget).addScaledVector(CAM_DIR, camDist).add(new THREE.Vector3((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh));
    camera.lookAt(camTarget.x, camTarget.y + 0.6, camTarget.z);
    sun.position.copy(camTarget).add(SUN_OFFSET);
    sun.target.position.copy(camTarget);
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
    if (panel.open) panel.sync();
    updateHUD(real, fpsVal, frameMs);


    if (postFX) composer.render();
    else renderer.render(scene, camera);
  }
  frame();

  // ---------- Отладочный хук ----------
  window.__malina = {
    mode: 'playground',
    hero, input, dummies, obstacles, camera, HERO, SWORD, props, level, terrain,
    get berries() { return berries; },
    /** Нажать E */
    interact() { interactReq = true; },
    /** Ввод из теста: клавиатура и мышь перестают влиять на героя */
    script(on = true) { scripted = on; if (on) { input.move.set(0, 0); input.attack = false; pointer.down = false; goal = null; chase = null; path = []; } },
    /** Прогнать симуляцию sec секунд без реального времени */
    step(sec: number) { const n = Math.round(sec / STEP); for (let i = 0; i < n; i++) tick(STEP); },
    /** Нарисовать кадр сейчас (вкладка в фоне не получает requestAnimationFrame) */
    render() { render(0); },
    /** Нажатие пробела: перекат */
    press(what: 'roll') { input[what] = true; },
    /** Нажать ЛКМ в точке на земле (shift — удар на месте); цель в этой точке — подойти и бить */
    click(x: number, z: number, shift = false, y?: number) { pointer.ground.set(x, y ?? terrain.floorAt(x, z, hero.pos.y + 4), z); pointer.hover = pickAt(x, z); pointer.shift = shift; pointer.down = true; },
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
    toggles: { get postFX() { return postFX; }, set postFX(v: boolean) { postFX = v; } },
  };
}
