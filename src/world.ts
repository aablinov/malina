import * as THREE from 'three';
import { SHOP, type Collider } from './config';
import { buildGunModel, WEAPON_BY_ID, type WeaponId } from './weapons';
import type { Textures } from './textures';
import { Level, type LevelJSON } from './level/level.ts';
import { LevelRenderer } from './level/mesher';
import { terrainOf, type Terrain } from './level/collide.ts';
import { GARDEN_CRATES, GARDEN_HOUSE, GARDEN_LANTERNS, GARDEN_ROCKS, GARDEN_TREES } from './level/garden.ts';
import gardenJson from '../assets/maps/garden.json';

/**
 * Огород (хаб): блоки берутся из карты assets/maps/garden.json (пересобрать — `npm run map:garden`,
 * править — редактор `?dev=editor`), а фонари, лавка торговца и светлячки — обычные объекты сцены.
 */

export interface World {
  level: Level;
  terrain: Terrain;
  renderer: LevelRenderer;
  /** Круглые препятствия для пуль и героя: деревья, домик, камни, фонари, лавка */
  colliders: Collider[];
  /** night: 0 — день, 1 — ночь; focus — куда смотрит камера (для ближайших источников света) */
  update(t: number, night: number, focus: THREE.Vector3): void;
}

/** ?map=editor — карта из автосохранения редактора (кнопка «Играть» в ?dev=editor), иначе встроенный огород */
function pickMap(): LevelJSON {
  if (new URLSearchParams(window.location.search).get('map') === 'editor') {
    try {
      const raw = localStorage.getItem('malina.editor.level');
      if (raw) return JSON.parse(raw) as LevelJSON;
    } catch { /* нет сохранения — огород */ }
  }
  return gardenJson as unknown as LevelJSON;
}

export function buildWorld(scene: THREE.Scene, T: Textures): World {
  const level = Level.fromJSON(pickMap());
  const renderer = new LevelRenderer(scene, level, T);
  const terrain = terrainOf(level);

  const colliders: Collider[] = [];
  for (const [x, z] of GARDEN_TREES) colliders.push({ x, z, r: 0.75 });
  colliders.push({ x: GARDEN_HOUSE.x, z: GARDEN_HOUSE.z, r: GARDEN_HOUSE.r });
  for (const [x, , z] of GARDEN_CRATES) colliders.push({ x, z, r: 0.7 });
  for (const [x, z] of GARDEN_ROCKS) colliders.push({ x, z, r: 0.7 });
  // место под лавку (сама лавка строится ниже)
  colliders.push({ x: SHOP.x, z: SHOP.z + 0.3, r: 1.65 });

  // Фонари
  const lanterns: THREE.PointLight[] = [];
  const shopParts: { merchant?: THREE.Group } = {};
  const postMat = new THREE.MeshLambertMaterial({ map: T.logSide });
  const lampMat = new THREE.MeshStandardMaterial({ color: '#2a2018', emissive: '#ffae42', emissiveIntensity: 3.2 });
  const capMat = new THREE.MeshLambertMaterial({ color: '#3a3a3a' });
  for (const [x, z] of GARDEN_LANTERNS) {
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.2, 0.22), postMat); post.position.y = 1.1; post.castShadow = true;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.12), postMat); arm.position.set(0.25, 2.1, 0);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.38, 0.32), lampMat); lamp.position.set(0.48, 1.78, 0);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.08, 0.38), capMat); cap.position.set(0.48, 2.0, 0);
    g.add(post, arm, lamp, cap);
    g.position.set(x, 0, z);
    g.rotation.y = Math.atan2(-x, -z) + Math.PI / 2;
    scene.add(g);
    const light = new THREE.PointLight('#ffa040', 14, 11, 1.6);
    lamp.getWorldPosition(light.position);
    g.updateMatrixWorld(); lamp.getWorldPosition(light.position);
    scene.add(light);
    lanterns.push(light);
    colliders.push({ x, z, r: 0.35 });
  }

  // Лавка торговца
  {
    const g = new THREE.Group();
    g.position.set(SHOP.x, 0, SHOP.z);
    scene.add(g);
    const add = (m: THREE.Mesh, x: number, y: number, z: number) => { m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
    const planks = new THREE.MeshLambertMaterial({ map: T.planks });
    const log = new THREE.MeshLambertMaterial({ map: T.logSide });
    add(new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.9, 0.7), planks), 0, 0.45, 0.75);
    add(new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.1, 0.85), new THREE.MeshLambertMaterial({ color: '#7a5634' })), 0, 0.95, 0.75);
    for (const [x, z] of [[-1.35, 1.0], [1.35, 1.0], [-1.35, -1.0], [1.35, -1.0]]) add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.5, 0.18), log), x, 1.25, z);
    add(new THREE.Mesh(new THREE.BoxGeometry(2.9, 1.7, 0.12), planks), 0, 0.85, -1.05);
    const awning = add(new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.12, 2.7), new THREE.MeshLambertMaterial({ map: T.awning })), 0, 2.55, 0.05);
    awning.rotation.x = 0.16;
    const sign = add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.46, 0.06), [planks, planks, planks, planks, new THREE.MeshBasicMaterial({ map: T.sign }), planks]), 0, 2.05, 1.32);
    sign.castShadow = false;
    // товар на прилавке
    const show = (id: WeaponId, x: number, rotY: number) => {
      const w = buildGunModel(WEAPON_BY_ID[id]);
      w.rotation.set(0, rotY, 0);
      w.position.set(x, 1.08, 0.72);
      g.add(w);
    };
    show('shotgun', -0.7, 1.4); show('plasma', 0.2, 1.7); show('launcher', 0.95, 1.5);
    // торговец
    const merchant = new THREE.Group();
    merchant.position.set(0, 0, -0.35);
    const robe = new THREE.MeshLambertMaterial({ color: '#3f6a4a' });
    const skin = new THREE.MeshLambertMaterial({ map: T.skin });
    merchant.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.15, 0.42), robe), { castShadow: true }));
    merchant.children[0].position.y = 0.58;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.46), [skin, skin, skin, skin, new THREE.MeshLambertMaterial({ map: T.face }), skin]);
    head.position.y = 1.4; merchant.add(head);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.24, 0.54), new THREE.MeshLambertMaterial({ color: '#2d4f36' }));
    hood.position.y = 1.68; merchant.add(hood);
    const beard = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.06), new THREE.MeshLambertMaterial({ color: '#d8d0c0' }));
    beard.position.set(0, 1.2, 0.24); merchant.add(beard);
    g.add(merchant);
    shopParts.merchant = merchant;
    const lamp = add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.26), lampMat), 1.35, 2.05, 1.2);
    lamp.castShadow = false;
    const l = new THREE.PointLight('#ffa040', 14, 9, 1.6);
    l.position.set(SHOP.x + 1.35, 1.9, SHOP.z + 1.4);
    scene.add(l);
    lanterns.push(l);
  }

  // Светлячки
  const N = 160;
  const fpos = new Float32Array(N * 3);
  const seeds: { x: number; y: number; z: number; p: number; s: number }[] = [];
  for (let i = 0; i < N; i++) {
    seeds.push({ x: (Math.random() - 0.5) * 40, z: (Math.random() - 0.5) * 40, y: 0.4 + Math.random() * 3.5, p: Math.random() * 10, s: 0.3 + Math.random() * 0.7 });
  }
  const fgeo = new THREE.BufferGeometry();
  fgeo.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
  const fmat = new THREE.PointsMaterial({ size: 0.32, map: T.glow, color: new THREE.Color('#ffe58a').multiplyScalar(2.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const flies = new THREE.Points(fgeo, fmat);
  scene.add(flies);

  return {
    level, terrain, renderer, colliders,
    update(t: number, night: number, focus: THREE.Vector3) {
      renderer.sync();
      renderer.update(t, night, focus);
      for (let i = 0; i < N; i++) {
        const s = seeds[i];
        fpos[i * 3] = s.x + Math.sin(t * 0.3 * s.s + s.p) * 1.5;
        fpos[i * 3 + 1] = s.y + Math.sin(t * 0.9 * s.s + s.p * 2) * 0.4;
        fpos[i * 3 + 2] = s.z + Math.cos(t * 0.25 * s.s + s.p) * 1.5;
      }
      fgeo.attributes.position.needsUpdate = true;
      lanterns.forEach((l, i) => { l.intensity = night * (13 + Math.sin(t * 7 + i) * 0.8 + Math.sin(t * 13 + i * 3) * 0.6); });
      lampMat.emissiveIntensity = 0.25 + night * 3;
      fmat.opacity = night;
      flies.visible = night > 0.02;
      if (shopParts.merchant) {
        // ночью торговец уходит спать
        shopParts.merchant.visible = night < 0.5;
        shopParts.merchant.rotation.y = Math.sin(t * 0.7) * 0.3;
      }
    },
  };
}
