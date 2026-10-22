import * as THREE from 'three';
import type { Textures } from '../textures';
import { Atlas } from './atlas';
import { CH, type Level } from './level.ts';
import { DIRS } from './obj.ts';
import { paletteTextures, type Layer } from './palette.ts';
import { getShape } from './shapes';

/**
 * Рендер уровня: на каждый чанк — по одной сетке на слой (opaque / cutout / water / fire).
 * Грани между непрозрачными соседями не рисуются, углы затенены (AO), яркость чуть гуляет от блока к блоку.
 * Изменился чанк (level.dirty) — вызови sync(), и он перестроится.
 *
 * Клетка (x, y, z) стоит в мире центром на целых x и z: занимает [x−0,5; x+0,5) × [y; y+1) × [z−0,5; z+0,5).
 */

interface LightSpot { x: number; y: number; z: number; color: THREE.Color; intensity: number; dist: number; seed: number }

const LAYERS: Layer[] = ['opaque', 'cutout', 'water', 'acid', 'fire'];
const AO_SHADE = [0.5, 0.68, 0.84, 1];
const MAX_LIGHTS = 8;

function hash(x: number, y: number, z: number, s = 0): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 1103515245) + Math.imul(z | 0, 668265263) + Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

class Bucket {
  pos: number[] = []; nrm: number[] = []; uv: number[] = []; col: number[] = [];
  get empty(): boolean { return this.pos.length === 0; }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

export class LevelRenderer {
  readonly group = new THREE.Group();
  readonly atlas: Atlas;
  /** Рисовать только блоки не выше этого y (срез в редакторе) */
  maxY = Infinity;
  private readonly mats: Record<Layer, THREE.Material>;
  private readonly meshes = new Map<string, THREE.Mesh[]>();
  private readonly lights = new Map<string, LightSpot[]>();
  private readonly pool: THREE.PointLight[] = [];
  private readonly waterTex: THREE.Texture;
  private readonly acidTex: THREE.Texture;
  private readonly fireTex: THREE.Texture;

  constructor(private readonly scene: THREE.Scene, private readonly level: Level, T: Textures) {
    this.atlas = new Atlas(T, paletteTextures());
    this.waterTex = T.water;
    this.acidTex = T.acid;
    this.fireTex = T.fire;
    this.mats = {
      opaque: new THREE.MeshLambertMaterial({ map: this.atlas.texture, vertexColors: true }),
      cutout: new THREE.MeshLambertMaterial({ map: this.atlas.texture, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }),
      water: new THREE.MeshLambertMaterial({ map: T.water, vertexColors: true, transparent: true, opacity: 0.8 }),
      acid: new THREE.MeshLambertMaterial({ map: T.acid, vertexColors: true, transparent: true, opacity: 0.85, emissive: new THREE.Color('#2a7a10'), emissiveIntensity: 0.8 }),
      fire: new THREE.MeshBasicMaterial({ map: T.fire, alphaTest: 0.4, side: THREE.DoubleSide, toneMapped: false, color: new THREE.Color(1.8, 1.5, 1.1) }),
    };
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = new THREE.PointLight('#ffa040', 0, 8, 1.6);
      this.group.add(l);
      this.pool.push(l);
    }
    scene.add(this.group);
    this.rebuildAll();
  }

  rebuildAll(): void {
    for (const k of this.meshes.keys()) this.level.dirty.add(k);
    for (const k of this.level.chunks.keys()) this.level.dirty.add(k);
    this.sync();
  }

  /** Перестроить чанки, помеченные в level.dirty */
  sync(): void {
    if (!this.level.dirty.size) return;
    for (const key of this.level.dirty) this.rebuild(key);
    this.level.dirty.clear();
  }

  private drop(key: string): void {
    const old = this.meshes.get(key);
    if (old) for (const m of old) { this.group.remove(m); m.geometry.dispose(); }
    this.meshes.delete(key);
    this.lights.delete(key);
  }

  private rebuild(key: string): void {
    this.drop(key);
    const chunk = this.level.chunks.get(key);
    if (!chunk) return;
    const [cx, cy, cz] = key.split(',').map(Number);
    const L = this.level;
    const buckets: Record<Layer, Bucket> = { opaque: new Bucket(), cutout: new Bucket(), water: new Bucket(), acid: new Bucket(), fire: new Bucket() };
    const spots: LightSpot[] = [];
    const isFull = (x: number, y: number, z: number) => L.defAt(x, y, z).full;

    for (let i = 0; i < chunk.length; i++) {
      const code = chunk[i];
      if (!code) continue;
      const x = cx * CH + (i & 15), z = cz * CH + ((i >> 4) & 15), y = cy * CH + (i >> 8);
      if (y > this.maxY) continue;
      const id = code >> 2, rot = code & 3;
      const def = L.defOf(id);
      const bright = 1 - (def.jitter ?? 0) * hash(x, y, z, 9);
      let ox = 0, oz = 0, yaw = rot, scale = 1;
      if (def.scatter) { ox = (hash(x, y, z, 13) - 0.5) * 0.5; oz = (hash(x, y, z, 14) - 0.5) * 0.5; yaw = Math.floor(hash(x, y, z, 15) * 4); scale = 0.55 + hash(x, y, z, 16) * 0.45; }
      if (def.light) spots.push({ x, y: y + 0.6, z, color: new THREE.Color(def.light.color), intensity: def.light.intensity, dist: def.light.dist, seed: hash(x, y, z, 21) * 10 });

      for (const part of def.parts) {
        const placements: number[] = [];
        if (part.connect) {
          for (let d = 0; d < 4; d++) {
            const n = L.defAt(x + DIRS[d][0], y, z + DIRS[d][2]);
            if (n.connects || n.name === def.name) placements.push(d);
          }
        } else placements.push(yaw);
        const bucket = buckets[part.layer ?? 'opaque'];
        const atlasUV = (part.layer ?? 'opaque') === 'opaque' || part.layer === 'cutout';
        for (const r of placements) {
          const shape = getShape(part.obj, r);
          for (const t of shape.tris) {
            if (t.cull >= 0) {
              const nx = x + DIRS[t.cull][0], ny = y + DIRS[t.cull][1], nz = z + DIRS[t.cull][2];
              const nDef = L.defAt(nx, ny, nz);
              if (nDef.full || (def.cullSame && L.idAt(nx, ny, nz) === id)) continue;
            }
            const texName = part.tex[t.group] ?? part.tex.side ?? Object.values(part.tex)[0];
            const tex = Array.isArray(texName) ? texName[Math.floor(hash(x, y, z, 7) * texName.length)] : texName;
            const uvRect = atlasUV ? this.atlas.uv(tex) : null;
            for (let k = 0; k < 3; k++) {
              const px = t.pos[k * 3], py = t.pos[k * 3 + 1], pz = t.pos[k * 3 + 2];
              bucket.pos.push(x + (px - 0.5) * scale + ox, y + py * scale, z + (pz - 0.5) * scale + oz);
              bucket.nrm.push(t.nrm[0], t.nrm[1], t.nrm[2]);
              const u = t.uv[k * 2], v = t.uv[k * 2 + 1];
              if (uvRect) bucket.uv.push(uvRect.u0 + (uvRect.u1 - uvRect.u0) * u, uvRect.v0 + (uvRect.v1 - uvRect.v0) * v);
              else bucket.uv.push(u, v);
              let ao = 1;
              if (t.cull >= 0 && def.full) {
                const d = DIRS[t.cull];
                const axis = d[0] ? 0 : d[1] ? 1 : 2;
                const b = axis === 0 ? 1 : 0, c = axis === 2 ? 1 : 2;
                const p = [px, py, pz];
                const sb = p[b] < 0.5 ? -1 : 1, sc = p[c] < 0.5 ? -1 : 1;
                const eb = [0, 0, 0], ec = [0, 0, 0];
                eb[b] = sb; ec[c] = sc;
                const bx = x + d[0], by = y + d[1], bz = z + d[2];
                const s1 = isFull(bx + eb[0], by + eb[1], bz + eb[2]) ? 1 : 0;
                const s2 = isFull(bx + ec[0], by + ec[1], bz + ec[2]) ? 1 : 0;
                const s3 = isFull(bx + eb[0] + ec[0], by + eb[1] + ec[1], bz + eb[2] + ec[2]) ? 1 : 0;
                ao = AO_SHADE[s1 && s2 ? 0 : 3 - (s1 + s2 + s3)];
              }
              const cv = bright * ao;
              bucket.col.push(cv, cv, cv);
            }
          }
        }
      }
    }

    const meshes: THREE.Mesh[] = [];
    for (const layer of LAYERS) {
      const b = buckets[layer];
      if (b.empty) continue;
      const m = new THREE.Mesh(b.geometry(), this.mats[layer]);
      m.castShadow = layer === 'opaque' || layer === 'cutout';
      m.receiveShadow = layer === 'opaque' || layer === 'cutout';
      m.frustumCulled = true;
      this.group.add(m);
      meshes.push(m);
    }
    this.meshes.set(key, meshes);
    if (spots.length) this.lights.set(key, spots);
  }

  /** Анимация воды и огня, ближайшие к focus источники света. night 0..1 */
  update(t: number, night: number, focus: THREE.Vector3): void {
    this.waterTex.offset.set(Math.sin(t * 0.4) * 0.06, t * 0.02);
    this.acidTex.offset.set(t * 0.015, Math.sin(t * 0.3) * 0.05);
    this.fireTex.offset.y = (2 - (Math.floor(t * 9) % 3)) / 3;
    const all: LightSpot[] = [];
    for (const l of this.lights.values()) all.push(...l);
    all.sort((a, b) => (a.x - focus.x) ** 2 + (a.z - focus.z) ** 2 - (b.x - focus.x) ** 2 - (b.z - focus.z) ** 2);
    const k = 0.35 + 0.65 * night;
    this.pool.forEach((pl, i) => {
      const s = all[i];
      if (!s) { pl.intensity = 0; return; }
      pl.position.set(s.x, s.y, s.z);
      pl.color.copy(s.color);
      pl.distance = s.dist;
      pl.intensity = s.intensity * k * (0.9 + Math.sin(t * 9 + s.seed) * 0.06 + Math.sin(t * 15 + s.seed * 3) * 0.04);
    });
  }

  dispose(): void {
    for (const k of [...this.meshes.keys()]) this.drop(k);
    this.scene.remove(this.group);
    for (const m of Object.values(this.mats)) m.dispose();
    this.atlas.texture.dispose();
  }
}
