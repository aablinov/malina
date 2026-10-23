import * as THREE from 'three';
import type { Atlas } from './atlas';
import { decorDef, decorEuler, type DecorDef } from './decor.ts';
import type { DecorItem, Level } from './level.ts';
import type { Layer } from './palette.ts';
import { getDecorShape } from './shapes';

/**
 * Рендер декора: на каждую пару «предмет × слой» — один InstancedMesh, материалы общие с блоками
 * (рентген, разрез, тени, bloom работают одинаково). Соседей у декора нет, поэтому вместо AO — затемнение
 * у земли (для предметов на полу), а яркость чуть гуляет от экземпляра к экземпляру, как jitter у блоков.
 * Изменился декор (level.decorVersion) — sync() пересобирает экземпляры; геометрии кэшируются.
 */

export interface DecorLight { x: number; y: number; z: number; color: THREE.Color; intensity: number; dist: number; seed: number }

/** Попадание луча в декор: какой предмет и где */
export interface DecorHit { item: DecorItem; point: THREE.Vector3; distance: number }

const ATLAS_LAYERS: Layer[] = ['opaque', 'cutout', 'glow'];

function hash(i: number, s: number): number {
  let h = Math.imul(i | 0, 374761393) + Math.imul(s | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Матрица предмета: поворот YXZ вокруг точки опоры, затем сдвиг */
export function decorMatrix(d: DecorItem, out = new THREE.Matrix4()): THREE.Matrix4 {
  const [x, y, z] = decorEuler(d.rot);
  return out.compose(new THREE.Vector3(...d.pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'YXZ')), new THREE.Vector3(1, 1, 1));
}

export class DecorRenderer {
  readonly group = new THREE.Group();
  /** Рисовать только предметы не выше этого y (срез в редакторе) */
  maxY = Infinity;
  lights: DecorLight[] = [];
  /** Запечённые источники (свечи): в вершины блоков, без PointLight */
  baked: DecorLight[] = [];
  private readonly geoms = new Map<string, THREE.BufferGeometry>();
  private meshes: { mesh: THREE.InstancedMesh; items: DecorItem[] }[] = [];
  private builtVersion = -1;
  private builtMaxY = Infinity;

  constructor(private readonly level: Level, private readonly atlas: Atlas, private readonly mats: Record<Layer, THREE.Material>) {}

  /** Геометрия одного слоя предмета: все части этого слоя, UV из атласа (огонь — своя текстура) */
  geometryOf(def: DecorDef, layer: Layer): THREE.BufferGeometry | null {
    const key = `${def.name}:${layer}`;
    if (this.geoms.has(key)) return this.geoms.get(key)!;
    const pos: number[] = [], nrm: number[] = [], uv: number[] = [], col: number[] = [];
    for (const part of def.parts) {
      if ((part.layer ?? 'opaque') !== layer) continue;
      const shape = getDecorShape(part.obj);
      for (const t of shape.tris) {
        const texName = part.tex[t.group] ?? part.tex.side ?? Object.values(part.tex)[0];
        const tex = Array.isArray(texName) ? texName[0] : texName;
        const r = ATLAS_LAYERS.includes(layer) ? this.atlas.uv(tex) : null;
        for (let k = 0; k < 3; k++) {
          const y = t.pos[k * 3 + 1];
          pos.push(t.pos[k * 3], y, t.pos[k * 3 + 2]);
          nrm.push(...t.nrm);
          const u = t.uv[k * 2], v = t.uv[k * 2 + 1];
          uv.push(r ? r.u0 + (r.u1 - r.u0) * u : u, r ? r.v0 + (r.v1 - r.v0) * v : v);
          // «AO» у земли: низ предмета на полу темнее, как угол у блока
          const ao = def.anchor === 'floor' && layer !== 'glow' ? 0.68 + 0.32 * Math.min(1, y / 0.35) : 1;
          col.push(ao, ao, ao);
        }
      }
    }
    if (!pos.length) { this.geoms.set(key, null as unknown as THREE.BufferGeometry); return null; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.geoms.set(key, g);
    return g;
  }

  /** Пересобрать экземпляры, если декор или срез изменились */
  sync(force = false): void {
    if (!force && this.builtVersion === this.level.decorVersion && this.builtMaxY === this.maxY) return;
    this.builtVersion = this.level.decorVersion;
    this.builtMaxY = this.maxY;
    for (const m of this.meshes) { this.group.remove(m.mesh); m.mesh.dispose(); }
    this.meshes = [];
    this.lights = [];
    this.baked = [];
    const byName = new Map<string, DecorItem[]>();
    for (const d of this.level.decor) {
      if (d.pos[1] > this.maxY + 1) continue;
      let list = byName.get(d.name);
      if (!list) { list = []; byName.set(d.name, list); }
      list.push(d);
    }
    const m4 = new THREE.Matrix4(), c = new THREE.Color();
    for (const [name, items] of byName) {
      const def = decorDef(name);
      for (const layer of Object.keys(this.mats) as Layer[]) {
        const g = this.geometryOf(def, layer);
        if (!g) continue;
        const mesh = new THREE.InstancedMesh(g, this.mats[layer], items.length);
        items.forEach((d, i) => {
          mesh.setMatrixAt(i, decorMatrix(d, m4));
          const b = layer === 'opaque' || layer === 'cutout' ? 1 - 0.1 * hash(Math.round(d.pos[0] * 16), Math.round(d.pos[2] * 16)) : 1;
          mesh.setColorAt(i, c.setScalar(b));
        });
        mesh.castShadow = mesh.receiveShadow = layer === 'opaque' || layer === 'cutout';
        mesh.computeBoundingSphere();
        mesh.name = `decor:${name}:${layer}`;
        this.group.add(mesh);
        this.meshes.push({ mesh, items });
      }
      if (def.light) {
        const v = new THREE.Vector3();
        for (const d of items) {
          v.set(...def.light.at).applyMatrix4(decorMatrix(d, m4));
          (def.light.baked ? this.baked : this.lights).push({ x: v.x, y: v.y, z: v.z, color: new THREE.Color(def.light.color), intensity: def.light.intensity, dist: def.light.dist, seed: hash(Math.round(d.pos[0] * 16), Math.round(d.pos[2] * 16)) * 10 });
        }
      }
    }
  }

  /** Луч по декору (для редактора): ближайший предмет */
  raycast(ray: THREE.Raycaster): DecorHit | null {
    let best: DecorHit | null = null;
    for (const { mesh, items } of this.meshes) {
      for (const h of ray.intersectObject(mesh, false)) {
        if (h.instanceId === undefined) continue;
        if (!best || h.distance < best.distance) best = { item: items[h.instanceId], point: h.point.clone(), distance: h.distance };
      }
    }
    return best;
  }

  /** Сколько экземпляров нарисовано (для тестов) */
  get instances(): number { return this.meshes.reduce((n, m) => n + m.mesh.count, 0); }

  dispose(): void {
    for (const m of this.meshes) { this.group.remove(m.mesh); m.mesh.dispose(); }
    this.meshes = [];
    for (const g of this.geoms.values()) g?.dispose();
    this.geoms.clear();
  }
}
