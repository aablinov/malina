import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CFG, PLOTS, ENTRANCES, SHOP, RESPAWN, type Entrance, type EntranceName } from './config';
import { makeTextures } from './textures';
import { buildWorld } from './world';
import { FX } from './fx';
import { Player } from './player';
import { Bush } from './bush';
import { Beetle, type BeetleKind, type BiteHandler, type ShootHandler } from './beetle';
import { initAudio, toggleMute, sfx } from './audio';
import { installIcons } from './icons';
import { DayNight } from './daynight';
import { WEAPONS, WEAPON_BY_ID, AMMO, AMMO_TYPES, MAX_LEVEL, upgradeCost, gunPreview, type AmmoType, type WeaponDef, type WeaponId } from './weapons';
import { ShopUI } from './shop';
import { Combat } from './combat';
import { DEV_TOOLS, openEditor, openPlayground } from './devflag';
import './style.css';

declare global {
  interface Window { __malina?: unknown }
}

export function runGame(): void {
  installIcons();

  function $<E extends HTMLElement = HTMLElement>(id: string): E {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Нет элемента #${id}`);
    return el as E;
  }
  function q<E extends HTMLElement = HTMLElement>(root: ParentNode, sel: string): E {
    const el = root.querySelector<E>(sel);
    if (!el) throw new Error(`Нет элемента ${sel}`);
    return el;
  }

  // ---------- Рендер ----------
  const canvas = $<HTMLCanvasElement>('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0x000000, 34, 62);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 200);
  const CAM_DIR = new THREE.Vector3(1, 1.38, 1).normalize();
  let camDist = 29;
  const camTarget = new THREE.Vector3(0, 0, 2);

  const hemi = new THREE.HemisphereLight();
  const ambient = new THREE.AmbientLight();
  const sun = new THREE.DirectionalLight();
  scene.add(hemi, ambient);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 1; sc.far = 80;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // Вспышки света от выстрелов и взрывов: постоянный набор ламп, чтобы не пересобирать шейдеры
  const flashLights = Array.from({ length: 4 }, () => { const l = new THREE.PointLight('#ffffff', 0, 9, 1.6); scene.add(l); return { l, t: 0, dur: 1, peak: 0 }; });
  let flashIdx = 0;
  function lightFlash(pos: THREE.Vector3, color: THREE.Color, intensity: number, dur: number): void {
    const f = flashLights[flashIdx++ % flashLights.length];
    f.l.position.copy(pos);
    f.l.color.copy(color).multiplyScalar(1 / Math.max(color.r, color.g, color.b, 1));
    f.peak = intensity; f.t = dur; f.dur = dur;
  }

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.45, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Мир ----------
  const T = makeTextures();
  const world = buildWorld(scene, T);
  const overlay = $('overlay');
  const fx = new FX(scene, camera, T, overlay);
  const player = new Player(scene, T, fx);
  const dn = new DayNight();
  const hoverMarker = fx.marker(new THREE.Color(3, 0.4, 0.4), 1.3);
  hoverMarker.visible = false;

  const moundMat = new THREE.MeshLambertMaterial({ map: T.dirt, color: '#b08a70' });
  for (const p of PLOTS) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.14, 0.8), moundMat);
    m.position.set(p.x, 0.0, p.z);
    m.receiveShadow = true;
    scene.add(m);
  }

  const berryGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  const flyMat = new THREE.MeshStandardMaterial({ color: '#d0123f', emissive: '#ff2a55', emissiveIntensity: 1.6 });

  // ---------- Состояние ----------
  type GameState = 'menu' | 'play' | 'pause' | 'shop' | 'over';

  /** Ягода, летящая с куста к игроку после сбора урожая */
  interface Flyer { m: THREE.Mesh; from: THREE.Vector3; t: number; dur: number; h: number }
  interface SpawnOrder { at: number; kind: BeetleKind; e: Entrance; mul: number }

  interface Game {
    state: GameState;
    time: number;
    /** Ягоды: на посадку, стволы, улучшения и патроны в лавке */
    berries: number;
    ammo: Record<AmmoType, number>;
    kills: number;
    harvested: number;
    /** По одному месту на каждую грядку из PLOTS */
    bushes: (Bush | null)[];
    beetles: Beetle[];
    flyers: Flyer[];
    spawnQueue: SpawnOrder[];
    /** Уровень каждого ствола, 0 — не куплен */
    levels: Record<WeaponId, number>;
    weapon: WeaponDef;
    firing: boolean;
    /** Стоп-кадр после сильного попадания */
    hitStop: number;
    respawnT: number;
  }

  const G: Game = {
    state: 'menu',
    time: 0,
    berries: CFG.START_BERRIES,
    ammo: { bullets: 150, shells: 0, cells: 0, grenades: 0 },
    kills: 0,
    harvested: 0,
    bushes: PLOTS.map(() => null),
    beetles: [],
    flyers: [],
    spawnQueue: [],
    levels: Object.fromEntries(WEAPONS.map((w) => [w.id, w.price === 0 ? 1 : 0])) as Record<WeaponId, number>,
    weapon: WEAPON_BY_ID.rifle,
    firing: false,
    hitStop: 0,
    respawnT: 0,
  };
  G.bushes[5] = new Bush(scene, T, PLOTS[5], { mature: true, harvestT: 32 });
  G.bushes[6] = new Bush(scene, T, PLOTS[6], { mature: true, harvestT: 40 });
  G.bushes[2] = new Bush(scene, T, PLOTS[2], { mature: true, harvestT: 22 });

  const lvl = (id: WeaponId = G.weapon.id): number => G.levels[id];
  /** Нужен ли этот тип патронов хоть одному купленному стволу */
  const ammoOwned = (t: AmmoType): boolean => WEAPONS.some((w) => G.levels[w.id] > 0 && w.ammo === t);

  // ---------- Ввод ----------
  const keys = new Set<string>();
  const mouse = new THREE.Vector2(0, 0);
  const mousePx = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  let mouseSeen = false;
  const raycaster = new THREE.Raycaster();
  const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.4);
  const aim = new THREE.Vector3();

  // ---------- Урон ----------
  let hovered: Beetle | null = null;
  let hitSoundT = 0;
  let hurtFlash = 0;
  let hitMark = 0;

  function killBeetle(b: Beetle): void {
    G.kills++;
    sfx.kill();
    const col = [b.K.shell, b.K.sheen, '#14161c'];
    fx.burst(b.pos.clone().setY(0.35), col, 14 + (b.kind === 'big' ? 12 : 0), { speed: 4, up: 4.5, size: 0.16 * b.K.scale, life: 1.2 });
    fx.burst(b.pos.clone().setY(0.35), ['#3a5a1a', '#5a7a2a', '#2a3a10'], 10, { speed: 3, up: 3, size: 0.1, life: 0.9 });
    combat.drop(b.pos, b.kind === 'big' || b.kind === 'bombardier');
    if (b === hovered) hovered = null;
  }

  function damageBeetle(b: Beetle, dmg: number, dir: THREE.Vector3, big = false): void {
    if (b.dead) return;
    const dead = b.damage(dmg, dir);
    // цифры урона копятся, чтобы очереди не сливались в кашу
    b.numAcc += dmg;
    if (big || dead || G.time - b.numT > 0.14) {
      if (b.numAcc >= 0.5) fx.text(b.pos, String(Math.round(b.numAcc * 10)), big ? 'crit' : '');
      b.numAcc = 0;
      b.numT = G.time;
    }
    hitMark = 0.12;
    if (hitSoundT <= 0) { sfx.hit(); hitSoundT = 0.04; }
    if (big) G.hitStop = Math.max(G.hitStop, 0.04);
    if (dead) killBeetle(b);
  }

  function hurtPlayer(d: number): void {
    if (player.down) return;
    player.hurt(d);
    hurtFlash = 0.35;
    sfx.hurt();
    if (player.hp <= 0) knockOut();
  }

  const combat = new Combat({
    scene, fx, player, T,
    beetles: () => G.beetles,
    bushes: () => G.bushes,
    weapon: () => G.weapon,
    level: () => lvl(),
    aim: () => aim.clone(),
    hovered: () => hovered,
    ammo: (t) => G.ammo[t],
    useAmmo: (t, n) => { if (G.ammo[t] < n) return false; G.ammo[t] -= n; return true; },
    addAmmo: (t, n) => { G.ammo[t] = Math.min(AMMO[t].max, G.ammo[t] + n); },
    damageBeetle,
    hurtPlayer,
    hurtBush: (b, d) => { b.damage(d); fx.burst(b.pos.clone().setY(0.6), ['#3e8a33', '#58a845'], 4, { speed: 2, up: 2, size: 0.1, life: 0.6 }); },
    sound: (k) => { sfx[k](); },
    light: lightFlash,
    owned: ammoOwned,
    colliders: () => world.colliders,
  });

  // ---------- Оружие и лавка ----------
  function equip(id: WeaponId, force = false): void {
    if (!G.levels[id] || (G.weapon.id === id && !force)) return;
    combat.reset();
    G.weapon = WEAPON_BY_ID[id];
    player.setWeapon(G.weapon, lvl(id));
    const glow = new THREE.Color(...G.weapon.glow);
    fx.flash(player.pos.clone().setY(1.3), glow, 1.8, 0.3);
    fx.shock(player.pos, 1.4, glow, 0.3, 0.12);
    sfx.draw(0.8);
    refreshWeaponSlot();
    if (G.state === 'play') fx.text(player.pos, `${G.weapon.name} ${'★'.repeat(lvl(id))}`);
  }

  function upgrade(id: WeaponId): boolean {
    const w = WEAPON_BY_ID[id], l = G.levels[id];
    if (!l || l >= MAX_LEVEL) return false;
    const cost = upgradeCost(w, l);
    if (G.berries < cost) { sfx.empty(); return false; }
    G.berries -= cost;
    G.levels[id] = l + 1;
    sfx.harvest();
    if (G.weapon.id === id) equip(id, true);
    return true;
  }

  const shop = new ShopUI($('shop'), {
    berries: () => G.berries,
    level: (id) => G.levels[id],
    equipped: () => G.weapon.id,
    ammo: (t) => G.ammo[t],
    buy(id) {
      const w = WEAPON_BY_ID[id];
      if (G.levels[id] || G.berries < w.price) { sfx.empty(); return false; }
      G.berries -= w.price;
      G.levels[id] = 1;
      // к новому стволу — стартовый запас патронов
      G.ammo[w.ammo] = Math.min(AMMO[w.ammo].max, G.ammo[w.ammo] + AMMO[w.ammo].pack);
      equip(id);
      sfx.harvest();
      return true;
    },
    upgrade,
    buyAmmo(t) {
      const a = AMMO[t];
      if (G.berries < a.packPrice || G.ammo[t] >= a.max) { sfx.empty(); return false; }
      G.berries -= a.packPrice;
      G.ammo[t] = Math.min(a.max, G.ammo[t] + a.pack);
      sfx.pickup();
      return true;
    },
    equip: (id) => equip(id),
    close: () => closeShop(),
  });

  function nearShop(): boolean {
    return Math.hypot(player.pos.x - SHOP.standX, player.pos.z - SHOP.standZ) < CFG.SHOP_DIST;
  }
  function openShop(): void {
    if (dn.phase !== 'day') { fx.text(player.pos, 'торговец спит до утра', 'bad'); sfx.empty(); return; }
    G.state = 'shop';
    G.firing = false;
    shop.open();
  }
  function closeShop(): void {
    if (G.state !== 'shop') return;
    shop.close();
    G.state = 'play';
  }

  window.addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    if (e.repeat) { keys.add(e.code); return; }
    keys.add(e.code);
    if (e.code === 'KeyM') toggleMute();
    // F9 в главном меню — плейграунд разработчика
    if (e.code === 'F9' && G.state === 'menu' && DEV_TOOLS) { e.preventDefault(); openPlayground(); return; }
    if (e.code === 'F10' && G.state === 'menu' && DEV_TOOLS) { e.preventDefault(); openEditor(); return; }
    if (G.state === 'shop') {
      if (e.code === 'Escape' || e.code === 'KeyE') closeShop();
      return;
    }
    if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
    if (G.state !== 'play') return;
    if (e.code === 'KeyE' || e.code === 'KeyF') interact();
    if (e.code === 'KeyQ') combat.mod();
    if (e.code === 'Space') G.firing = true;
    const digit = /^Digit(\d)$/.exec(e.code);
    if (digit) {
      const w = WEAPONS[Number(digit[1]) - 1];
      if (w && G.levels[w.id]) equip(w.id);
      else if (w) fx.text(player.pos, `${w.name} — в лавке`, 'bad');
    }
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.code); if (e.code === 'Space') G.firing = false; });
  window.addEventListener('blur', () => { keys.clear(); G.firing = false; if (G.state === 'play') togglePause(); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('mousemove', (e) => {
    mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    mousePx.x = e.clientX; mousePx.y = e.clientY;
    mouseSeen = true;
  });
  canvas.addEventListener('mousedown', (e) => {
    initAudio();
    if (G.state !== 'play') return;
    if (e.button === 0) G.firing = true;
    if (e.button === 2) combat.mod();
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) G.firing = false; });
  canvas.addEventListener('wheel', (e) => { camDist = THREE.MathUtils.clamp(camDist + Math.sign(e.deltaY) * 2, 22, 44); }, { passive: true });

  // ---------- Огород ----------
  function nearestPlot(maxD: number): number {
    let best = -1, bd = maxD;
    PLOTS.forEach((p, i) => {
      const d = Math.hypot(p.x - player.pos.x, p.z - player.pos.z);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  function addBerries(n: number): void {
    G.berries = Math.min(CFG.BERRY_MAX, G.berries + n);
    const a = $('berryBox'); a.classList.remove('bump'); void a.offsetWidth; a.classList.add('bump');
  }

  function harvest(i: number): void {
    const b = G.bushes[i];
    if (!b) return;
    b.harvest();
    G.harvested += CFG.HARVEST_YIELD;
    sfx.harvest();
    fx.text(b.pos, `+${CFG.HARVEST_YIELD}`, 'berry');
    for (let k = 0; k < CFG.HARVEST_YIELD; k++) {
      const m = new THREE.Mesh(berryGeo, flyMat);
      const from = b.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.8));
      m.position.copy(from);
      m.scale.setScalar(0.7);
      scene.add(m);
      G.flyers.push({ m, from, t: -k * 0.04, dur: 0.45, h: 1.2 + Math.random() });
    }
    addBerries(CFG.HARVEST_YIELD);
  }

  function interact(): void {
    if (player.down) return;
    const i = nearestPlot(CFG.INTERACT_DIST);
    if (i < 0) { if (nearShop()) openShop(); return; }
    const b = G.bushes[i];
    if (b && b.ready) { harvest(i); return; }
    if (!b) {
      if (G.berries < CFG.PLANT_COST) { sfx.empty(); flashSlot('slotSeed'); fx.text(new THREE.Vector3(PLOTS[i].x, 0, PLOTS[i].z), 'мало ягод', 'bad'); return; }
      G.berries -= CFG.PLANT_COST;
      G.bushes[i] = new Bush(scene, T, PLOTS[i]);
      sfx.plant();
      fx.burst(new THREE.Vector3(PLOTS[i].x, 0.2, PLOTS[i].z), ['#6b452c', '#8b5e3c', '#5fb83a'], 12, { speed: 2, up: 3 });
    }
  }

  function flashSlot(id: string): void { const s = $(id); s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); }

  // ---------- День и ночь ----------
  const ENTR_NAMES: Record<EntranceName, string> = { север: 'севера', запад: 'запада', юг: 'юга', восток: 'востока' };
  let bannerTimer = 0;
  function banner(t1: string, t2: string, mood: 'good' | 'bad' | 'night' = 'bad'): void {
    const b = $('banner');
    b.innerHTML = `<div class="b1">${t1}</div><div class="b2">${t2}</div>`;
    b.classList.toggle('good', mood === 'good');
    b.classList.toggle('nightb', mood === 'night');
    b.classList.add('show');
    bannerTimer = 3.2;
  }

  /** Ночь n: жуки приходят партиями в первые две трети ночи */
  function startNight(n: number): void {
    const entrCount = Math.min(4, 1 + Math.floor((n - 1) / 2));
    const entr = [...ENTRANCES].sort(() => Math.random() - 0.5).slice(0, entrCount);
    const count: Record<BeetleKind, number> = {
      small: Math.min(20, 2 + n * 2),
      fast: n >= 3 ? Math.floor(n / 2) + 1 : 0,
      big: Math.floor((n - 1) / 2),
      spitter: Math.min(10, Math.ceil(n * 0.7)),
      bombardier: n >= 3 ? Math.floor((n - 1) / 2) : 0,
    };
    const mul = Math.min(1.5, 1 + (n - 1) * 0.04);
    const list: BeetleKind[] = [];
    for (const k of Object.keys(count) as BeetleKind[]) for (let i = 0; i < count[k]; i++) list.push(k);
    list.sort(() => Math.random() - 0.5);
    const spread = CFG.NIGHT_LENGTH * 0.62;
    const groups = n === 1 ? 1 : Math.min(4, 1 + Math.ceil(n / 2));
    list.forEach((kind, i) => {
      const g = i % groups;
      const at = G.time + 1.5 + (g / groups) * spread + Math.floor(i / groups) * 0.5;
      G.spawnQueue.push({ at, kind, e: entr[i % entr.length], mul });
    });
    sfx.wave();
    const from = entr.map((e) => ENTR_NAMES[e.name]);
    const txt = from.length > 1 ? from.slice(0, -1).join(', ') + ' и ' + from.at(-1) : from[0];
    const shooters = count.spitter + count.bombardier;
    banner(`НОЧЬ ${n}`, `Жуки ползут с ${txt}! Стрелков: ${shooters}`, 'night');
    if (shop.isOpen) closeShop();
  }

  /** Рассвет: оставшиеся жуки зарываются в землю */
  function dawn(): void {
    for (const b of G.beetles) {
      fx.burst(b.pos.clone().setY(0.2), ['#6b452c', '#8b5e3c', '#4a2f1c'], 10, { speed: 2, up: 3, size: 0.14, life: 0.9 });
      if (b === hovered) hovered = null;
      b.dispose();
    }
    G.beetles.length = 0;
    G.spawnQueue.length = 0;
    combat.clearEnemyShots();
    sfx.harvest();
    banner('РАССВЕТ', `Ночь ${dn.survived} пережита. Малина снова растёт, лавка открыта`, 'good');
  }

  // ---------- Здоровье ----------
  function knockOut(): void {
    player.knockOut();
    combat.reset();
    G.respawnT = CFG.RESPAWN_TIME;
    G.firing = false;
    sfx.bushDead();
    fx.text(player.pos, 'без сознания!', 'bad');
  }

  // ---------- Оверлеи грядок ----------
  const plotUI = PLOTS.map(() => {
    const el = document.createElement('div');
    el.className = 'plot-ui';
    el.innerHTML = '<div class="ready"><span class="ic ic-berry"></span><kbd>E</kbd></div><div class="ring"><span></span></div><div class="hp"><i></i></div><div class="plus">E +</div>';
    overlay.appendChild(el);
    return { el, ready: q(el, '.ready'), kbd: q(el, '.ready kbd'), ring: q(el, '.ring'), ringTxt: q(el, '.ring span'), hp: q(el, '.hp'), hpBar: q(el, '.hp i'), plus: q(el, '.plus'), cache: {} as { t?: string } };
  });
  const arrows = Array.from({ length: 14 }, () => { const a = document.createElement('div'); a.className = 'arrow'; a.style.display = 'none'; overlay.appendChild(a); return a; });

  function setVis(el: HTMLElement, v: boolean): void { const s = v ? '' : 'none'; if (el.style.display !== s) el.style.display = s; }

  const _v = new THREE.Vector3();
  function updateOverlays(w: number, h: number): void {
    const near = nearestPlot(CFG.INTERACT_DIST);
    PLOTS.forEach((p, i) => {
      const ui = plotUI[i];
      const b = G.bushes[i];
      const show = G.state !== 'menu';
      _v.set(p.x, b ? 0.6 + 1.25 * (0.3 + 0.7 * b.growK) : 0.6, p.z).project(camera);
      const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
      ui.el.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`;
      setVis(ui.el, show);
      if (!show) return;
      setVis(ui.plus, !b && near === i);
      setVis(ui.ready, !!(b && b.ready));
      setVis(ui.kbd, near === i);
      const ringOn = !!(b && !b.ready);
      setVis(ui.ring, ringOn);
      if (b && ringOn) {
        const growing = !b.mature;
        const k = growing ? b.growK : b.harvestK;
        ui.ring.style.setProperty('--p', (k * 100).toFixed(1));
        ui.ring.style.setProperty('--c', growing ? '#7fd04a' : '#e0284f');
        ui.ring.classList.toggle('paused', !dn.growing);
        const sec = Math.ceil(growing ? CFG.GROW_TIME - b.growT : CFG.HARVEST_TIME - b.harvestT);
        const t = String(Math.max(0, sec));
        if (ui.cache.t !== t) { ui.ringTxt.textContent = t; ui.cache.t = t; }
      }
      const hpOn = !!(b && (b.hp < b.maxHp));
      setVis(ui.hp, hpOn);
      if (b && hpOn) {
        const k = Math.max(0, b.hp / b.maxHp);
        ui.hpBar.style.width = (k * 100).toFixed(0) + '%';
        ui.hp.className = 'hp' + (k < 0.3 ? ' low' : k < 0.6 ? ' mid' : '');
      }
    });

    let ai = 0;
    if (G.state === 'play') for (const b of G.beetles) {
      if (ai >= arrows.length) break;
      _v.set(b.pos.x, 0.4, b.pos.z).project(camera);
      if (Math.abs(_v.x) < 0.98 && Math.abs(_v.y) < 0.98) continue;
      const k = 0.9 / Math.max(Math.abs(_v.x), Math.abs(_v.y));
      const nx = _v.x * k, ny = _v.y * k;
      const a = arrows[ai++];
      a.style.display = '';
      a.classList.toggle('shooter', !!b.ranged);
      a.style.transform = `translate(${(nx * 0.5 + 0.5) * w}px,${(-ny * 0.5 + 0.5) * h}px) translate(-50%,-50%) rotate(${Math.atan2(-ny * h, nx * w)}rad)`;
    }
    for (; ai < arrows.length; ai++) if (arrows[ai].style.display !== 'none') arrows[ai].style.display = 'none';
  }

  // ---------- HUD ----------
  const hudCache: Record<string, string> = {};
  function setText(id: string, v: string): void { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
  const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const cssColor = (rgb: readonly number[]) => `rgb(${rgb.map((v) => Math.round(Math.min(255, (v / 3.6) * 255))).join(',')})`;

  /** Иконки, звёзды, цвет свечения и вид прицела под текущий ствол */
  function refreshWeaponSlot(): void {
    const w = G.weapon;
    const pv = `url(${gunPreview(w, lvl())})`;
    $('wIcon').className = 'gunpv';
    $('wIcon').style.backgroundImage = pv;
    $('wName').textContent = w.name;
    $('wStars').textContent = '★'.repeat(lvl()) + '☆'.repeat(MAX_LEVEL - lvl());
    $('ammoIcon').className = `ic ic-${w.ammo} big`;
    $('modName').textContent = w.mod.name;
    $('modIcon').className = 'gunpv';
    $('modIcon').style.backgroundImage = pv;
    document.documentElement.style.setProperty('--wglow', cssColor(w.glow));
    $('reticle').className = `r-${w.reticle}`;
    $('heatBar').style.display = w.mod.kind === 'heatBlast' ? '' : 'none';
  }

  function updateAmmoList(): void {
    const html = AMMO_TYPES.filter(ammoOwned).map((t) => {
      const a = AMMO[t], n = Math.floor(G.ammo[t]);
      const cur = G.weapon.ammo === t ? ' cur' : '';
      return `<div class="al${cur}${n < a.max * 0.15 ? ' low' : ''}"><span class="ic ic-${t}"></span><b>${n}</b><i><s style="width:${(n / a.max) * 100}%"></s></i></div>`;
    }).join('');
    if (hudCache.ammoList !== html) { hudCache.ammoList = html; $('ammoList').innerHTML = html; }
  }

  function updateHUD(): void {
    const w = G.weapon;
    setText('ammoN', String(Math.floor(G.ammo[w.ammo])));
    setText('ammoL', AMMO[w.ammo].name.toLowerCase());
    $('ammoBox').classList.toggle('low', G.ammo[w.ammo] < w.ammoPerShot * 5);
    setText('berryN', String(G.berries));
    updateAmmoList();

    const isDay = dn.phase === 'day';
    const panel = $('dayPanel');
    panel.classList.toggle('day', isDay);
    panel.classList.toggle('night', !isDay);
    $('dayIcon').className = `ic ${isDay ? 'ic-sun' : 'ic-moon'}`;
    setText('dayTitle', `${isDay ? 'ДЕНЬ' : 'НОЧЬ'} ${dn.day}`);
    const alive = G.beetles.length + G.spawnQueue.length;
    const timer = $('dayTimer');
    if (isDay) { setText('dayTimer', `Ночь через ${fmt(dn.left)}`); timer.classList.toggle('danger', dn.left < 8); }
    else { setText('dayTimer', `Жуков: ${alive} · рассвет через ${fmt(dn.left)}`); timer.classList.toggle('danger', alive > 0); }
    $('dayBar').style.width = `${dn.progress * 100}%`;

    setText('bushN', `${G.bushes.filter((b) => b).length}/${PLOTS.length}`);
    setText('harvN', String(G.harvested));
    setText('killN', String(G.kills));

    const modK = combat.modProgress(w);
    q($('slotMod'), '.cd').style.height = `${modK * 100}%`;
    const active = combat.akimboT > 0 || combat.turretT > 0 || combat.overloadT > 0;
    $('slotMod').classList.toggle('ready', modK <= 0 && !active);
    $('slotMod').classList.toggle('active', active);
    $('heatBar').style.width = `${combat.heat * 100}%`;
    $('slotSeed').classList.toggle('off', G.berries < CFG.PLANT_COST);

    const hpK = player.hp / player.maxHp;
    $('hpFill').style.height = `${hpK * 100}%`;
    setText('hpN', String(Math.ceil(player.hp)));
    $('hpOrb').classList.toggle('low', hpK < 0.3 && !player.down);

    const down = $('downMsg');
    down.classList.toggle('hidden', !player.down);
    if (player.down) setText('downMsg', `Без сознания\nОчнёшься у домика через ${Math.ceil(G.respawnT)}`);

    // Подсказка
    const i = nearestPlot(CFG.INTERACT_DIST);
    let p = '', bad = false;
    if (player.down) p = '';
    else if (i >= 0) {
      const b = G.bushes[i];
      if (!b) { p = `<kbd>E</kbd>Посадить малину — ${CFG.PLANT_COST} ягод`; bad = G.berries < CFG.PLANT_COST; }
      else if (b.ready) p = `<kbd>E</kbd>Собрать урожай (+${CFG.HARVEST_YIELD})`;
      else if (!dn.growing) p = 'Ночью малина не растёт';
      else if (!b.mature) p = 'Куст растёт…';
      else p = `Урожай через ${Math.ceil(CFG.HARVEST_TIME - b.harvestT)} с`;
    } else if (nearShop()) {
      if (isDay) p = '<kbd>E</kbd>Лавка: стволы, улучшения, патроны';
      else { p = 'Лавка закрыта до утра'; bad = true; }
    } else if (G.ammo[w.ammo] < w.ammoPerShot) { p = `Кончились ${AMMO[w.ammo].name.toLowerCase()} — смени ствол или подбери коробки`; bad = true; }
    const pr = $('prompt');
    if (hudCache.prompt !== p) { hudCache.prompt = p; pr.innerHTML = p; }
    pr.classList.toggle('show', !!p);
    pr.classList.toggle('bad', bad);
  }

  /** Прицел у курсора: расходится от стрельбы, показывает перезарядку мода */
  function updateReticle(): void {
    const r = $('reticle');
    const show = G.state === 'play' && mouseSeen && !player.down;
    r.style.display = show ? '' : 'none';
    if (!show) return;
    const w = G.weapon;
    const spread = 10 + w.spread * 120 * (1 + combat.bloom * 0.8) + combat.bloom * 6;
    r.style.transform = `translate(${mousePx.x}px,${mousePx.y}px)`;
    r.style.setProperty('--s', `${spread.toFixed(1)}px`);
    r.style.setProperty('--m', `${(1 - combat.modProgress(w)) * 100}%`);
    r.style.setProperty('--spin', `${combat.spin * 100}%`);
    r.classList.toggle('hit', hitMark > 0);
    r.classList.toggle('target', !!hovered);
  }

  // ---------- Экраны ----------
  function bestScore(): number { try { return Number(localStorage.getItem('malina-best') || 0); } catch { return 0; } }
  function showBest(): void { const b = bestScore(); $('best').textContent = b ? `Рекорд: ${b} очков` : ''; }
  showBest();

  function startGame(): void {
    initAudio();
    $('menu').classList.add('hidden');
    $('hud').classList.remove('hidden');
    G.state = 'play';
    equip('rifle', true);
    banner('ДЕНЬ 1', 'Ухаживай за малиной — к ночи готовь стволы', 'good');
  }
  function togglePause(): void {
    if (G.state === 'play') { G.state = 'pause'; $('pause').classList.remove('hidden'); G.firing = false; }
    else if (G.state === 'pause') { G.state = 'play'; $('pause').classList.add('hidden'); }
  }
  function gameOver(): void {
    G.state = 'over';
    G.firing = false;
    const score = G.harvested + G.kills * 5 + dn.survived * 25;
    const prev = bestScore();
    if (score > prev) { try { localStorage.setItem('malina-best', String(score)); } catch { /* нет хранилища */ } }
    $('rWave').textContent = String(dn.survived);
    $('rHarv').textContent = String(G.harvested);
    $('rKill').textContent = String(G.kills);
    $('rTime').textContent = fmt(G.time);
    $('rScore').textContent = String(score);
    $('rBest').textContent = score > prev ? 'Новый рекорд!' : `Рекорд: ${prev}`;
    setTimeout(() => { $('over').classList.remove('hidden'); $('hud').classList.add('hidden'); }, 900);
  }
  $('playBtn').addEventListener('click', startGame);
  $('resumeBtn').addEventListener('click', togglePause);
  $('againBtn').addEventListener('click', () => window.location.reload());

  // ---------- Цикл ----------
  const clock = new THREE.Clock();
  let gt = 0;
  const lights = { scene, renderer, hemi, ambient, sun, bloom };
  player.setWeapon(G.weapon, 1);
  refreshWeaponSlot();

  const onBite: BiteHandler = (_b, bush, d) => {
    bush.damage(d);
    sfx.chew();
    if (Math.random() < 0.15) fx.burst(bush.pos.clone().setY(0.5), ['#3e8a33', '#58a845'], 1, { speed: 1.5, up: 2, size: 0.12, life: 0.6 });
  };
  const onShoot: ShootHandler = (_b, from, to, r, atPlayer) => combat.enemyShoot(from, to, r, atPlayer);

  function update(dt: number): void {
    const play = G.state === 'play';
    gt += dt;
    world.update(gt, dn.night, camTarget);

    // прицел
    if (mouseSeen) {
      raycaster.setFromCamera(mouse, camera);
      raycaster.ray.intersectPlane(aimPlane, aim);
    } else aim.copy(player.pos).add(player.forward.multiplyScalar(3));

    for (const f of flashLights) {
      f.t = Math.max(0, f.t - dt);
      f.l.intensity = f.peak * (f.t / f.dur);
    }

    if (!play) {
      fx.update(dt, window.innerWidth, window.innerHeight);
      for (const b of G.bushes) if (b) b.update(0, gt, false);
      if (G.state === 'menu') player.update(dt, new Set<string>(), null, world.colliders, world.terrain);
      return;
    }

    // стоп-кадр после попадания: время почти замирает
    let sdt = dt;
    if (G.hitStop > 0) { G.hitStop -= dt; sdt = dt * 0.15; }
    hitSoundT -= dt;
    hitMark = Math.max(0, hitMark - dt);

    G.time += sdt;

    // смена дня и ночи
    const ev = dn.update(sdt);
    if (ev === 'dusk') startNight(dn.day);
    if (ev === 'dawn') dawn();

    // игрок
    if (player.down) {
      G.respawnT -= sdt;
      if (G.respawnT <= 0) {
        player.revive(RESPAWN.x, RESPAWN.z);
        fx.burst(player.pos.clone().setY(0.6), [new THREE.Color(3, 2.6, 1)], 16, { speed: 2, up: 3, size: 0.08, life: 0.7, glow: true, gravity: 0 });
      }
    }
    player.update(sdt, keys, aim, world.colliders, world.terrain);
    combat.trigger(G.firing && !player.down, sdt);
    combat.update(sdt, gt);
    // пули понемногу копятся сами, чтобы автомат не замолкал насовсем
    if (G.ammo.bullets < CFG.BULLET_REGEN_CAP) G.ammo.bullets = Math.min(CFG.BULLET_REGEN_CAP, G.ammo.bullets + CFG.BULLET_REGEN * sdt);

    // кусты
    G.bushes.forEach((b, i) => {
      if (!b) return;
      if (b.update(sdt, gt, dn.growing)) {
        sfx.ready();
        fx.burst(b.pos.clone().setY(0.8), [new THREE.Color(3, 0.5, 1)], 10, { speed: 1.5, up: 2.5, size: 0.08, life: 0.7, glow: true, gravity: 3 });
      }
      if (b.ready && !player.down && Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z) < 0.95) harvest(i);
      if (b.dead) {
        sfx.bushDead();
        fx.burst(b.pos.clone().setY(0.5), ['#3e8a33', '#58a845', '#285e20', '#6b4a2b'], 26, { speed: 3, up: 4, size: 0.2, life: 1.2 });
        fx.text(b.pos, 'куст съеден!', 'bad');
        b.dispose();
        G.bushes[i] = null;
      }
    });

    // жуки появляются
    for (let i = G.spawnQueue.length - 1; i >= 0; i--) {
      const s = G.spawnQueue[i];
      if (G.time < s.at) continue;
      G.spawnQueue.splice(i, 1);
      G.beetles.push(new Beetle(scene, s.kind, s.e.spawn, s.e.gate, s.mul));
    }

    // жуки
    for (const b of G.beetles) {
      if (b.dead) continue;
      b.update(sdt, gt, G.bushes, player, G.beetles, onBite, onShoot);
      // ближние кусают героя, если он рядом
      if (!player.down && b.frozenT <= 0 && !b.ranged) {
        const d = Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z);
        if (d < b.radius + 0.45) {
          player.hurt(b.bite * CFG.BITE_TO_PLAYER * sdt);
          hurtFlash = Math.max(hurtFlash, 0.2);
          sfx.chew();
        }
      }
    }
    if (!player.down && player.hp <= 0) knockOut();
    // днём раны понемногу заживают
    if (!player.down && dn.phase === 'day') player.heal(CFG.DAY_REGEN * sdt);
    for (let i = G.beetles.length - 1; i >= 0; i--) if (G.beetles[i].dead) { G.beetles[i].dispose(); G.beetles.splice(i, 1); }

    // наведение
    let hv: Beetle | null = null, hd = 1.4;
    for (const b of G.beetles) {
      const d = Math.hypot(b.pos.x - aim.x, b.pos.z - aim.z) - b.radius * 0.5;
      if (d < hd) { hd = d; hv = b; }
    }
    if (hovered !== hv) { if (hovered) hovered.setOutline(false); if (hv) hv.setOutline(true); hovered = hv; }
    hoverMarker.visible = !!hovered;
    if (hovered) { hoverMarker.position.set(hovered.pos.x, 0.05, hovered.pos.z); hoverMarker.scale.setScalar(hovered.K.scale); }

    // ягоды летят к игроку
    for (let i = G.flyers.length - 1; i >= 0; i--) {
      const f = G.flyers[i];
      f.t += sdt;
      if (f.t < 0) continue;
      const k = Math.min(1, f.t / f.dur);
      const to = player.pos.clone().setY(1);
      f.m.position.lerpVectors(f.from, to, k);
      f.m.position.y += Math.sin(k * Math.PI) * f.h;
      f.m.rotation.y += sdt * 10;
      if (k >= 1) { scene.remove(f.m); G.flyers.splice(i, 1); }
    }

    fx.update(sdt, window.innerWidth, window.innerHeight);

    if (bannerTimer > 0) { bannerTimer -= dt; if (bannerTimer <= 0) $('banner').classList.remove('show'); }
    hurtFlash = Math.max(0, hurtFlash - dt);

    const aliveBushes = G.bushes.filter((b) => b).length;
    if (aliveBushes === 0 && G.berries < CFG.PLANT_COST) gameOver();
  }

  function frame(): void {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta());
    update(dt);

    const lead = player.forward.multiplyScalar(G.state === 'play' && !player.down ? 1.6 : 0);
    camTarget.lerp(player.pos.clone().add(lead), Math.min(1, dt * 5));
    const shake = fx.shake * 0.25;
    camera.position.copy(camTarget).addScaledVector(CAM_DIR, camDist).add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
    camera.lookAt(camTarget.x, camTarget.y + 0.6, camTarget.z);
    dn.apply(lights);
    sun.position.copy(camTarget).add(dn.sunOffset);
    sun.target.position.copy(camTarget);
    $('hurt').style.opacity = String(Math.min(1, hurtFlash * 3));

    if (G.state !== 'menu') updateHUD();
    updateReticle();
    updateOverlays(window.innerWidth, window.innerHeight);
    composer.render();
  }
  frame();

  // для отладки
  window.__malina = {
    G, player, camera, dn, combat, world, startGame, equip, upgrade, openShop,
    step: (sec: number) => { for (let i = 0; i < sec * 20; i++) update(0.05); },
  };
}
