import * as THREE from 'three';
import { PLOTS, SHOP, type Collider } from './config';
import { buildGunModel, WEAPON_BY_ID, type WeaponId } from './weapons';
import type { Textures } from './textures';

type BlockType = 'grass' | 'dirt' | 'stone' | 'mossy' | 'farm' | 'path' | 'log' | 'leaves' | 'planks' | 'roof';
/** x, y, z, яркость, и пометка 'rail' для тонких бортиков грядок */
type Block = [number, number, number, number, ('rail' | undefined)?];
type PlantKind = 'grass' | 'f0' | 'f1' | 'f2' | 'f3';
type Plant = [number, number, number, number];

export interface World {
  colliders: Collider[];
  /** night: 0 — день, 1 — ночь */
  update(t: number, night: number): void;
}

function hash(x: number, z: number, s = 0): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash(xi, zi, 7), b = hash(xi + 1, zi, 7), c = hash(xi, zi + 1, 7), d = hash(xi + 1, zi + 1, 7);
  const u = s(fx), v = s(fz);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const R = 27, F = 15;

export function isBed(x: number, z: number): boolean {
  return Math.abs(x) <= 7 && [-4, 0, 4].some((bz) => Math.abs(z - bz) <= 1);
}
function isPath(x: number, z: number): boolean {
  const side = hash(x, z, 3) > 0.35;
  // дорожки от входов
  if (Math.abs(z) >= 8 && (x === 0 || (Math.abs(x) === 1 && (side || Math.abs(z) > F)))) return true;
  if (Math.abs(x) >= 10 && (z === 0 || (Math.abs(z) === 1 && (side || Math.abs(x) > F)))) return true;
  // рамка вокруг огорода
  if ((Math.abs(z) === 7 && Math.abs(x) <= 9) || (Math.abs(x) === 9 && Math.abs(z) <= 7)) return side || hash(x, z, 4) > 0.5;
  return false;
}
function isEntrance(x: number, z: number): boolean {
  return (Math.abs(x) <= 1 && Math.abs(z) > F) || (Math.abs(z) <= 1 && Math.abs(x) > F);
}

export function buildWorld(scene: THREE.Scene, T: Textures): World {
  const L: Record<BlockType, Block[]> = { grass: [], dirt: [], stone: [], mossy: [], farm: [], path: [], log: [], leaves: [], planks: [], roof: [] };
  const colliders: Collider[] = [];
  const solid = new Set<string>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const put = (type: BlockType, x: number, y: number, z: number, tint = 1) => { L[type].push([x, y, z, tint]); solid.add(key(x, Math.round(y + 0.5), z)); };

  const heights = new Map<string, number>();
  const H = (x: number, z: number): number => {
    const k = x + ',' + z;
    const cached = heights.get(k);
    if (cached !== undefined) return cached;
    let h = 0;
    const inField = Math.abs(x) <= F && Math.abs(z) <= F;
    if (!inField && !isEntrance(x, z)) {
      const dist = Math.max(Math.abs(x), Math.abs(z)) - F;
      h = 1 + Math.floor(vnoise(x * 0.2, z * 0.2) * 3.2) + Math.floor(dist / 5);
      const nearEntr = (Math.abs(x) === 2 && Math.abs(z) > F) || (Math.abs(z) === 2 && Math.abs(x) > F);
      if (nearEntr) h = Math.min(h, 2);
      const camSide = (x > F && z > -F + 2) || (z > F && x > -F + 2);
      if (camSide) h = dist <= 2 ? 1 : 0;
    }
    heights.set(k, h);
    return h;
  };

  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
    const h = H(x, z);
    const tint = 0.86 + hash(x, z, 9) * 0.16;
    if (h === 0) {
      const inField = Math.abs(x) <= F && Math.abs(z) <= F;
      if (inField && isBed(x, z)) put('farm', x, -0.56, z, tint);
      else if (isPath(x, z) || isEntrance(x, z)) put('path', x, -0.5, z, tint);
      else put('grass', x, -0.5, z, tint);
      continue;
    }
    for (let k = 0; k <= h; k++) {
      const y = k - 0.5;
      const ao = k === h ? 1 : 0.72 + 0.06 * k;
      if (k === h) put(hash(x, z, 5) < 0.12 ? 'mossy' : 'grass', x, y, z, tint);
      else if (k === h - 1) put('dirt', x, y, z, tint * ao);
      else put(hash(x, z, k) < 0.25 ? 'mossy' : 'stone', x, y, z, tint * ao);
    }
  }

  // Деревья
  const addTree = (x: number, z: number, base: number, size = 1) => {
    const t = 3 + Math.floor(hash(x, z, 11) * 2) + (size > 1 ? 1 : 0);
    for (let k = 0; k < t; k++) put('log', x, base + k + 0.5, z, 0.9 + hash(x, k, 2) * 0.1);
    const r = 2.2 * size, cy = base + t;
    const ri = Math.ceil(r);
    for (let dx = -ri; dx <= ri; dx++) for (let dy = -1; dy <= ri; dy++) for (let dz = -ri; dz <= ri; dz++) {
      const d2 = dx * dx + dy * dy * 1.4 + dz * dz;
      if (d2 > r * r + 0.5) continue;
      if (dx === 0 && dz === 0 && dy < 1) continue;
      if (d2 > r * r * 0.6 && hash(x + dx, z + dz, dy + 20) < 0.35) continue;
      put('leaves', x + dx, cy + dy + 0.5, z + dz, 0.8 + hash(x + dx, dy, z + dz) * 0.25);
    }
  };
  const treeSpots: [number, number][] = [];
  for (let x = -R + 1; x <= R - 1; x++) for (let z = -R + 1; z <= R - 1; z++) {
    const far = x < -F - 1 || z < -F - 1;
    if (!far) continue;
    if (Math.abs(x) <= 4 || Math.abs(z) <= 4) continue;
    if (hash(x, z, 33) > 0.09) continue;
    if (treeSpots.some(([a, b]) => Math.abs(a - x) < 4 && Math.abs(b - z) < 4)) continue;
    treeSpots.push([x, z]);
    addTree(x, z, H(x, z), hash(x, z, 1) > 0.6 ? 1.3 : 1);
  }
  for (const [x, z] of [[-13, 6], [5, -13], [-6, -13], [-13, -3]]) {
    addTree(x, z, 0, 1.1);
    colliders.push({ x, z, r: 0.75 });
  }

  // Домик
  const cx = -11, cz = -11;
  for (let x = cx - 2; x <= cx + 2; x++) for (let z = cz - 2; z <= cz + 2; z++) {
    const edge = Math.abs(x - cx) === 2 || Math.abs(z - cz) === 2;
    if (!edge) continue;
    const corner = Math.abs(x - cx) === 2 && Math.abs(z - cz) === 2;
    for (let k = 0; k < 3; k++) {
      if (x === cx && z === cz + 2 && k < 2) continue; // дверь
      if (z === cz + 2 && Math.abs(x - cx) === 1 && k === 1) continue; // окна
      if (x === cx + 2 && z === cz && k === 1) continue;
      put(corner ? 'log' : 'planks', x, k + 0.5, z, 0.9 + hash(x, z, k) * 0.1);
    }
  }
  for (let layer = 0; layer < 4; layer++) {
    const r = 3 - layer;
    for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
      if (layer < 3 && Math.abs(x - cx) < r && Math.abs(z - cz) < r) continue;
      put('roof', x, 3.5 + layer, z, 0.85 + hash(x, z, layer) * 0.15);
    }
  }
  colliders.push({ x: cx, z: cz, r: 3.1 });
  // ящики у домика
  for (const [x, z, y] of [[-8, -12, 0.5], [-8, -13, 0.5], [-8, -13, 1.5], [-12, -8, 0.5]]) put('planks', x, y, z, 0.8);
  colliders.push({ x: -8, z: -12.5, r: 1 }, { x: -12, z: -8, r: 0.7 });

  // место под лавку (сама лавка строится ниже)
  colliders.push({ x: SHOP.x, z: SHOP.z + 0.3, r: 1.65 });

  // Камни
  for (const [x, z] of [[-14, 11], [12, -14], [13, 12], [-4, 12], [11, 5]]) {
    put('mossy', x, 0.5, z, 0.85);
    colliders.push({ x, z, r: 0.7 });
  }

  // Бортики грядок
  for (const bz of [-4, 0, 4]) for (const s of [-1, 1]) for (let x = -7; x <= 7; x++) {
    L.log.push([x, -0.02, bz + s * 1.5, 0.75, 'rail']);
  }

  // Строим инстансы
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const lam = (map: THREE.Texture) => new THREE.MeshLambertMaterial({ map });
  const M: Record<BlockType, THREE.Material | THREE.Material[]> = {
    grass: [lam(T.grassSide), lam(T.grassSide), lam(T.grassTop), lam(T.dirt), lam(T.grassSide), lam(T.grassSide)],
    dirt: lam(T.dirt), stone: lam(T.stone), mossy: lam(T.mossy), farm: lam(T.farm), path: lam(T.path),
    log: [lam(T.logSide), lam(T.logSide), lam(T.logTop), lam(T.logTop), lam(T.logSide), lam(T.logSide)],
    leaves: lam(T.leaves), planks: lam(T.planks), roof: lam(T.roof),
  };
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  for (const type of Object.keys(L) as BlockType[]) {
    const list = L[type];
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(geo, M[type], list.length);
    list.forEach((b, i) => {
      dummy.position.set(b[0], b[1], b[2]);
      if (b[4] === 'rail') dummy.scale.set(1.02, 0.16, 0.14); else dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, col.setScalar(b[3]));
    });
    mesh.castShadow = type !== 'farm' && type !== 'path' && type !== 'grass';
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // Трава и цветы
  const cross = (() => {
    const a = new THREE.PlaneGeometry(0.9, 0.9); a.translate(0, 0.45, 0);
    const b = a.clone(); b.rotateY(Math.PI / 2);
    const g = new THREE.BufferGeometry();
    const pos = [...a.attributes.position.array, ...b.attributes.position.array];
    const uv = [...a.attributes.uv.array, ...b.attributes.uv.array];
    const nrm: number[] = []; for (let i = 0; i < pos.length / 3; i++) nrm.push(0, 1, 0);
    // у PlaneGeometry индекс есть всегда
    const fwd = [...a.index!.array, ...b.index!.array.map((v) => v + 4)];
    const back: number[] = [];
    for (let i = 0; i < fwd.length; i += 3) back.push(fwd[i], fwd[i + 2], fwd[i + 1]);
    const idx = [...fwd, ...back];
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setIndex(idx);
    return g;
  })();
  const plants: Record<PlantKind, Plant[]> = { grass: [], f0: [], f1: [], f2: [], f3: [] };
  const blocked = (x: number, z: number) => colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 0.3) || PLOTS.some((p) => Math.abs(p.x - x) < 1.2 && Math.abs(p.z - z) < 1.2);
  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
    const h = H(x, z);
    const inField = Math.abs(x) <= F && Math.abs(z) <= F;
    if (h === 0 && (isPath(x, z) || isEntrance(x, z) || (inField && isBed(x, z)))) continue;
    if (h === 0 && blocked(x, z)) continue;
    if (solid.has(key(x, h + 1, z))) continue;
    const r = hash(x, z, 50);
    if (r < 0.4) {
      const n = r < 0.15 ? 2 : 1;
      for (let i = 0; i < n; i++) plants.grass.push([x + (hash(x, z, 60 + i) - 0.5) * 0.6, h, z + (hash(x, z, 70 + i) - 0.5) * 0.6, 0.55 + hash(x, i, z) * 0.5]);
    } else if (r < 0.47) {
      plants[`f${Math.floor(hash(x, z, 80) * 4)}` as PlantKind].push([x + (hash(x, z, 61) - 0.5) * 0.5, h, z + (hash(x, z, 71) - 0.5) * 0.5, 0.6 + hash(x, z, 90) * 0.3]);
    }
  }
  const pMat = (map: THREE.Texture) => new THREE.MeshLambertMaterial({ map, alphaTest: 0.5 });
  const pMats: Record<PlantKind, THREE.Material> = { grass: pMat(T.tallGrass), f0: pMat(T.flowers[0]), f1: pMat(T.flowers[1]), f2: pMat(T.flowers[2]), f3: pMat(T.flowers[3]) };
  for (const k of Object.keys(plants) as PlantKind[]) {
    const list = plants[k];
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(cross, pMats[k], list.length);
    list.forEach((p, i) => {
      dummy.position.set(p[0], p[1], p[2]);
      dummy.rotation.set(0, hash(i, 3, 9) * Math.PI, 0);
      dummy.scale.setScalar(p[3]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    dummy.rotation.set(0, 0, 0);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // Фонари
  const lanterns: THREE.PointLight[] = [];
  const shopParts: { merchant?: THREE.Group } = {};
  const postMat = new THREE.MeshLambertMaterial({ map: T.logSide });
  const lampMat = new THREE.MeshStandardMaterial({ color: '#2a2018', emissive: '#ffae42', emissiveIntensity: 3.2 });
  const capMat = new THREE.MeshLambertMaterial({ color: '#3a3a3a' });
  for (const [x, z] of [[-9.6, -7.6], [9.6, -7.6], [-9.6, 7.6], [9.6, 7.6], [-3, 14.6], [14.6, -3]]) {
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
    colliders,
    update(t: number, night: number) {
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
