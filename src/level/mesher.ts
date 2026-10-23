import * as THREE from 'three';
import type { Textures } from '../textures';
import { Atlas } from './atlas';
import { CH, type Level } from './level.ts';
import { DIRS } from './obj.ts';
import { paletteTextures, type Layer } from './palette.ts';
import { decorTextures } from './decor.ts';
import { DecorRenderer } from './decor-render.ts';
import { getShape } from './shapes';

/**
 * Рендер уровня: на каждый чанк — по одной сетке на слой (opaque / cutout / water / fire).
 * Грани между непрозрачными соседями не рисуются, углы затенены (AO), яркость чуть гуляет от блока к блоку.
 * Изменился чанк (level.dirty) — вызови sync(), и он перестроится.
 *
 * Клетка (x, y, z) стоит в мире центром на целых x и z: занимает [x−0,5; x+0,5) × [y; y+1) × [z−0,5; z+0,5).
 */

interface LightSpot { x: number; y: number; z: number; color: THREE.Color; intensity: number; dist: number; seed: number }

const LAYERS: Layer[] = ['opaque', 'cutout', 'water', 'acid', 'fire', 'glow', 'detail', 'river', 'falls'];

/**
 * «Рентген»: блоки между камерой и героем (в цилиндре радиуса uXrayR вокруг луча камера → герой,
 * выше ног героя) растворяются сеточкой Байера, чтобы стены не закрывали бойца. uXrayR = 0 — выключено.
 * «Разрез»: всё выше uXrayCut не рисуется (герой в доме — видно этаж без потолка и верхних этажей).
 * У непрозрачных блоков (caps) тогда рисуются и задние грани — тёмным, это «срез» стен сверху.
 */
const XRAY_UNIFORMS = { uXrayHero: { value: new THREE.Vector3() }, uXrayCam: { value: new THREE.Vector3() }, uXrayR: { value: 0 }, uXrayCut: { value: 1e9 } };
const CUT_OFF = 1e8;
function withXray(m: THREE.Material, caps = false): THREE.Material {
  if (caps) m.side = THREE.DoubleSide;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, XRAY_UNIFORMS);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vXrayPos;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vec4 xrayP = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
xrayP = instanceMatrix * xrayP;
#endif
vXrayPos = (modelMatrix * xrayP).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vXrayPos;
uniform vec3 uXrayHero; uniform vec3 uXrayCam; uniform float uXrayR; uniform float uXrayCut;
float xrayBayer() {
  int x = int(mod(gl_FragCoord.x, 4.0)), y = int(mod(gl_FragCoord.y, 4.0));
  int i = x + y * 4;
  int m[16]; m[0]=0; m[1]=8; m[2]=2; m[3]=10; m[4]=12; m[5]=4; m[6]=14; m[7]=6; m[8]=3; m[9]=11; m[10]=1; m[11]=9; m[12]=15; m[13]=7; m[14]=13; m[15]=5;
  for (int k = 0; k < 16; k++) if (k == i) return (float(m[k]) + 0.5) / 16.0;
  return 0.5;
}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (vXrayPos.y > uXrayCut) discard;
${caps ? `if (!gl_FrontFacing && uXrayCut > ${CUT_OFF.toFixed(1)}) discard;` : ''}
if (uXrayR > 0.0 && vXrayPos.y > uXrayHero.y - 0.55) {
  vec3 ab = uXrayHero - uXrayCam;
  float t = clamp(dot(vXrayPos - uXrayCam, ab) / dot(ab, ab), 0.0, 1.0);
  if (t < 0.97) {
    float d = length(vXrayPos - (uXrayCam + ab * t));
    float hole = smoothstep(uXrayR, uXrayR * 0.45, d);
    if (xrayBayer() < hole) discard;
  }
}`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
${caps ? 'if (!gl_FrontFacing) gl_FragColor = vec4(0.11, 0.1, 0.09, 1.0);' : ''}`);
  };
  return m;
}
/**
 * Живая вода (и кислота): верх колышется волнами, по поверхности бегут каустика и мерцающие блики,
 * у берегов — пена. Атрибут shore = 1 в углах, где рядом нет такой же жидкости.
 * Блики ярче 1 — их подхватывает bloom.
 */
const WATER_UNIFORMS = { uTime: { value: 0 } };
/** Время анимации воды (для тестов) */
export const liquidTime = (): number => WATER_UNIFORMS.uTime.value;
/** foamK — доля береговой пены: в узком русле реки берег у каждого угла, полная пена закрыла бы воду */
function liquid(m: THREE.Material, foam: string, spark: [number, number, number], caustic: [number, number, number], foamK = 0.7): THREE.Material {
  const f = new THREE.Color(foam);
  const v3 = (c: [number, number, number] | THREE.Color) => Array.isArray(c) ? `vec3(${c.map((x) => x.toFixed(3)).join(',')})` : `vec3(${c.r.toFixed(3)},${c.g.toFixed(3)},${c.b.toFixed(3)})`;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, WATER_UNIFORMS);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float shore;
attribute vec2 flow;
uniform float uTime;
varying vec3 vWater; varying float vShore; varying float vTop; varying vec2 vFlow;
float waterWave(vec2 p, float t) {
  return sin(p.x * 1.1 + t * 1.4) * 0.035 + sin(p.y * 1.4 - t * 1.1 + p.x * 0.5) * 0.03 + sin((p.x + p.y) * 2.3 + t * 2.2) * 0.012;
}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vec3 wp0 = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTop = step(0.8, fract(wp0.y + 0.001));
transformed.y += vTop * (waterWave(wp0.xz, uTime) - 0.05);
vWater = wp0; vShore = shore; vFlow = flow;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
varying vec3 vWater; varying float vShore; varying float vTop; varying vec2 vFlow;
float wHash(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
if (vTop > 0.5) {
  float t = uTime;
  // течение (река): всё, что нарисовано по поверхности, уносит по направлению потока
  vec2 p = vWater.xz - vFlow * t;
  // наклон волны: склоны к солнцу светлее
  float sx = cos(p.x * 1.1 + t * 1.4) * 0.0385 + cos(p.y * 1.4 - t * 1.1 + p.x * 0.5) * 0.015;
  float sz = cos(p.y * 1.4 - t * 1.1 + p.x * 0.5) * 0.042;
  vec3 col = gl_FragColor.rgb * (1.0 + (sz - sx) * 6.0);
  // каустика: светлые переплетающиеся полосы
  float caus = pow(abs(sin(p.x * 2.1 + sin(p.y * 1.7 + t) * 1.3 + t * 0.8) * sin(p.y * 2.3 + sin(p.x * 1.5 - t * 0.9) * 1.2 - t * 0.6)), 6.0);
  col += ${v3(caustic)} * caus;
  // мерцающие пиксельные блики (1/8 блока), медленно плывут
  vec2 cell = floor(p * 8.0 + vec2(t * 0.35, t * 0.2));
  float h = wHash(cell);
  float tw = 0.5 + 0.5 * sin(t * 3.0 + h * 40.0);
  col += ${v3(spark)} * step(0.968, h) * smoothstep(0.55, 1.0, tw);
  // пена у берега: рваный пиксельный край, дышит
  float fn = wHash(floor(p * 8.0) + floor(t * 2.0) * 0.37);
  float foam = smoothstep(0.68, 0.9, vShore + (fn - 0.5) * 0.22 + sin(t * 2.0 + p.x * 3.0 + p.y * 2.0) * 0.07);
  col = mix(col, ${v3(f)}, foam * ${foamK.toFixed(2)});
  // река: светлые штрихи вдоль течения, рвутся и бегут
  float fl = length(vFlow);
  if (fl > 0.0) {
    vec2 fd = vFlow / fl, fn2 = vec2(-fd.y, fd.x);
    float lane = floor(dot(vWater.xz, fn2) * 5.0);
    float run = fract(dot(p, fd) * 0.6 + wHash(vec2(lane, 3.1)));
    float streak = step(0.8, wHash(vec2(lane, 7.7))) * smoothstep(0.0, 0.1, run) * smoothstep(0.45, 0.25, run);
    col = mix(col, ${v3(f)}, streak * 0.3);
  }
  gl_FragColor = vec4(col, max(gl_FragColor.a, foam * 0.95));
}`);
  };
  return m;
}

const AO_SHADE = [0.5, 0.68, 0.84, 1];
/** Бахрома: свисает на 8/16 и отстоит от грани на 1/16 (не мерцает с текстурой бока) */
const FRINGE_H = 0.5, FRINGE_OUT = 1 / 16;
/** Рваный край: на сколько верх блока может зайти на соседа, м (маска рисует 0–8 px из 16) */
const BLEED_D = 0.5, BLEED_LIFT = 0.004;
/** Общая верхняя грань с соседом по стороне d в долях клетки (без сдвига) */
const BLEED_EDGE: [number, number, number, number][] = [[1, 0, 1, 1], [1, 1, 0, 1], [0, 1, 0, 0], [0, 0, 1, 0]];
/** Концы верхнего края блока в долях клетки для каждой стороны (0 +X, 1 +Z, 2 −X, 3 −Z), уже со сдвигом наружу */
const FRINGE_EDGE: [number, number, number, number][] = [
  [1 + FRINGE_OUT, 0, 1 + FRINGE_OUT, 1], [1, 1 + FRINGE_OUT, 0, 1 + FRINGE_OUT],
  [-FRINGE_OUT, 1, -FRINGE_OUT, 0], [0, -FRINGE_OUT, 1, -FRINGE_OUT],
];
const MAX_LIGHTS = 8;

/**
 * Пятна цвета природной земли по миру (как трава на скриншотах Minecraft Dungeons): два слоя плавного шума — 9 м и 3 м;
 * светлые пятна теплее и желтее, тёмные — холоднее. Множители RGB для вершины, ±6 %.
 */
function macroTint(x: number, z: number): [number, number, number] {
  const vn = (sx: number, sz: number, cell: number, seed: number) => {
    const gx = Math.floor(sx / cell), gz = Math.floor(sz / cell), fx = sx / cell - gx, fz = sz / cell - gz;
    const sm = (t: number) => t * t * (3 - 2 * t), u = sm(fx), v = sm(fz);
    const a = hash(gx, 0, gz, seed), b = hash(gx + 1, 0, gz, seed), c = hash(gx, 0, gz + 1, seed), d = hash(gx + 1, 0, gz + 1, seed);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  const t = vn(x, z, 9, 91) * 0.65 + vn(x + 17, z - 5, 3, 92) * 0.35;
  const k = (t - 0.5) * 2; // −1 … 1
  return [1 + 0.06 * k, 1 + 0.045 * k, 1 - 0.01 * k];
}

function hash(x: number, y: number, z: number, s = 0): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 1103515245) + Math.imul(z | 0, 668265263) + Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

class Bucket {
  pos: number[] = []; nrm: number[] = []; uv: number[] = []; col: number[] = []; shore: number[] = []; flow: number[] = [];
  get empty(): boolean { return this.pos.length === 0; }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('shore', new THREE.Float32BufferAttribute(this.shore, 1));
    g.setAttribute('flow', new THREE.Float32BufferAttribute(this.flow, 2));
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
  private readonly fallsTex: THREE.Texture;
  /** Свободный декор поверх блоков (src/level/decor.ts) */
  readonly decor: DecorRenderer;

  constructor(private readonly scene: THREE.Scene, private readonly level: Level, T: Textures) {
    this.atlas = new Atlas(T, [...new Set([...paletteTextures(), ...decorTextures()])]);
    this.waterTex = T.water;
    this.acidTex = T.acid;
    this.fireTex = T.fire;
    this.fallsTex = T.waterfall;
    this.mats = {
      opaque: withXray(new THREE.MeshLambertMaterial({ map: this.atlas.texture, vertexColors: true }), true),
      cutout: withXray(new THREE.MeshLambertMaterial({ map: this.atlas.texture, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide })),
      water: liquid(new THREE.MeshLambertMaterial({ map: T.water, vertexColors: true, transparent: true, opacity: 0.82 }), '#e8fbff', [1.7, 1.9, 2.1], [0.12, 0.3, 0.36]),
      // река: глубже и темнее пруда, бирюза; течение — атрибут flow
      river: liquid(new THREE.MeshLambertMaterial({ map: T.river, vertexColors: true, transparent: true, opacity: 0.96 }), '#e4f4f6', [1.2, 1.4, 1.5], [0.04, 0.1, 0.13], 0.22),
      // водопад: непрозрачные струи, текстура бежит вниз
      falls: withXray(new THREE.MeshLambertMaterial({ map: T.waterfall, vertexColors: true, emissive: new THREE.Color('#0d3a4a'), emissiveIntensity: 0.6 })),
      acid: liquid(new THREE.MeshLambertMaterial({ map: T.acid, vertexColors: true, transparent: true, opacity: 0.85, emissive: new THREE.Color('#2a7a10'), emissiveIntensity: 0.8 }), '#d8ffb0', [1.4, 2.4, 0.8], [0.2, 0.4, 0.1]),
      fire: new THREE.MeshBasicMaterial({ map: T.fire, alphaTest: 0.4, side: THREE.DoubleSide, toneMapped: false, color: new THREE.Color(1.8, 1.5, 1.1) }),
      // мелкая трава: только лицевая сторона (пучки выпускаются в обе стороны) — иначе обратная сторона переворачивает
      // нормаль «вверх» и темнеет; тени не отбрасывает
      // polygonOffset — рваный край лежит прямо на верхе соседа и не должен мерцать с ним
      detail: withXray(new THREE.MeshLambertMaterial({ map: this.atlas.texture, vertexColors: true, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })),
      // светится сам (грибы, стекло фонаря): без освещения, ярче 1 — подхватывает bloom
      glow: withXray(new THREE.MeshBasicMaterial({ map: this.atlas.texture, vertexColors: true, alphaTest: 0.5, toneMapped: false, color: new THREE.Color(1.5, 1.4, 1.2) })),
    };
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = new THREE.PointLight('#ffa040', 0, 8, 1.6);
      this.group.add(l);
      this.pool.push(l);
    }
    this.decor = new DecorRenderer(level, this.atlas, this.mats);
    this.group.add(this.decor.group);
    scene.add(this.group);
    this.rebuildAll();
  }

  rebuildAll(): void {
    for (const k of this.meshes.keys()) this.level.dirty.add(k);
    for (const k of this.level.chunks.keys()) this.level.dirty.add(k);
    this.sync();
    this.decor.maxY = this.maxY;
    this.decor.sync(true);
  }

  /** Перестроить чанки, помеченные в level.dirty */
  sync(): void {
    this.decor.maxY = this.maxY;
    this.decor.sync();
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
    const buckets: Record<Layer, Bucket> = { opaque: new Bucket(), cutout: new Bucket(), water: new Bucket(), acid: new Bucket(), fire: new Bucket(), glow: new Bucket(), detail: new Bucket(), river: new Bucket(), falls: new Bucket() };
    const spots: LightSpot[] = [];
    const isFull = (x: number, y: number, z: number) => L.defAt(x, y, z).full;
    /** Четырёхугольник в слой: 4 точки мира, uv в долях тайла атласа, нормаль, яркость */
    const quad = (b: Bucket, p: number[][], uv: number[][], n: readonly number[], tex: string, c: number) => {
      const r = this.atlas.uv(tex);
      for (const k of [0, 1, 2, 0, 2, 3]) {
        b.pos.push(p[k][0], p[k][1], p[k][2]);
        b.nrm.push(n[0], n[1], n[2]);
        b.uv.push(r.u0 + (r.u1 - r.u0) * uv[k][0], r.v0 + (r.v1 - r.v0) * uv[k][1]);
        // трава поверх блока — того же оттенка, что земля под ней
        const [tr, tg, tb] = macroTint(p[k][0], p[k][2]);
        b.col.push(c * tr, c * tg, c * tb);
        b.shore.push(0);
        b.flow.push(0, 0);
      }
    };
    /** Плотность пучков: плавный шум с шагом 5 м — трава растёт пятнами */
    const density = (x: number, z: number) => {
      const gx = Math.floor(x / 5), gz = Math.floor(z / 5), fx = x / 5 - gx, fz = z / 5 - gz;
      const sm = (t: number) => t * t * (3 - 2 * t), u = sm(fx), v = sm(fz);
      const a = hash(gx, 0, gz, 31), b = hash(gx + 1, 0, gz, 31), c = hash(gx, 0, gz + 1, 31), d = hash(gx + 1, 0, gz + 1, 31);
      return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    };

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
        const atlasUV = (part.layer ?? 'opaque') === 'opaque' || part.layer === 'cutout' || part.layer === 'glow';
        const isLiquid = part.layer === 'water' || part.layer === 'acid' || part.layer === 'river';
        const flowX = def.flow ? DIRS[rot][0] * def.flow : 0, flowZ = def.flow ? DIRS[rot][2] * def.flow : 0;
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
              if (def.natural) {
                const [tr, tg, tb] = macroTint(x + (px - 0.5) * scale + ox, z + (pz - 0.5) * scale + oz);
                bucket.col.push(cv * tr, cv * tg, cv * tb);
              } else bucket.col.push(cv, cv, cv);
              // берег: в этом углу рядом нет той же жидкости
              let shore = 0;
              if (isLiquid) {
                const sx = px < 0.5 ? -1 : 1, sz = pz < 0.5 ? -1 : 1;
                if (L.idAt(x + sx, y, z) !== id || L.idAt(x, y, z + sz) !== id || L.idAt(x + sx, y, z + sz) !== id) shore = 1;
              }
              bucket.shore.push(shore);
              bucket.flow.push(flowX, flowZ);
            }
          }
        }
      }

      // трава поверх блоков (как в Minecraft Dungeons): бахрома свисает с края уступа, сверху — пучки пятнами
      if ((def.fringe || def.tufts) && !L.defAt(x, y + 1, z).full) {
        const c0 = bright * 0.97;
        if (def.fringe) for (let d = 0; d < 4; d++) {
          const n = L.defAt(x + DIRS[d][0], y, z + DIRS[d][2]);
          if (n.full || n.collide >= 1) continue;
          const [ax, az, bx, bz] = FRINGE_EDGE[d];
          const top = y + 1, bot = y + 1 - FRINGE_H;
          quad(buckets.detail, [[x + ax - 0.5, top, z + az - 0.5], [x + bx - 0.5, top, z + bz - 0.5], [x + bx - 0.5, bot, z + bz - 0.5], [x + ax - 0.5, bot, z + az - 0.5]],
            [[0, 1], [1, 1], [1, 1 - FRINGE_H], [0, 1 - FRINGE_H]], DIRS[d], def.fringe, c0);
        }
        if (def.tufts && L.isAir(x, y + 1, z)) {
          const n = Math.max(0, Math.min(5, Math.floor(density(x, z) * 7 + hash(x, y, z, 32) * 1.5 - 1.2)));
          for (let i = 0; i < n; i++) {
            const tx = x - 0.38 + hash(x, y, z, 33 + i) * 0.76, tz = z - 0.38 + hash(x, y, z, 40 + i) * 0.76;
            const sz = (4 + Math.floor(hash(x, y, z, 47 + i) * 4)) / 16;
            const u0 = Math.floor(hash(x, y, z, 54 + i) * (17 - sz * 16)) / 16;
            const tex = def.tufts[Math.floor(hash(x, y, z, 61 + i) * def.tufts.length)];
            const ang = hash(x, y, z, 68 + i) * Math.PI;
            const c = c0 * (0.88 + hash(x, y, z, 75 + i) * 0.2);
            for (const a of [ang, ang + Math.PI / 2]) {
              const dx = Math.cos(a) * sz / 2, dz = Math.sin(a) * sz / 2;
              // нормаль вверх: пучок освещён, как земля под ним
              const p0 = [tx - dx, y + 1, tz - dz], p1 = [tx + dx, y + 1, tz + dz], p2 = [tx + dx, y + 1 + sz, tz + dz], p3 = [tx - dx, y + 1 + sz, tz - dz];
              quad(buckets.detail, [p0, p1, p2, p3], [[u0, 0], [u0 + sz, 0], [u0 + sz, sz], [u0, sz]], [0, 1, 0], tex, c);
              quad(buckets.detail, [p1, p0, p3, p2], [[u0 + sz, 0], [u0, 0], [u0, sz], [u0 + sz, sz]], [0, 1, 0], tex, c);
            }
          }
        }
      }

      // рваный край (как дороги в Minecraft Dungeons): верх этого блока заходит на верх соседа другой природной земли
      if (def.bleed && !L.defAt(x, y + 1, z).full) for (let d = 0; d < 4; d++) {
        const nx = x + DIRS[d][0], nz = z + DIRS[d][2];
        const nDef = L.defAt(nx, y, nz);
        // своё семейство (трава ↔ скала с травой) не перекрываем — та же текстура
        if (!nDef.natural || L.idAt(nx, y, nz) === id || nDef.bleed?.[0] === def.bleed[0] || L.defAt(nx, y + 1, nz).full) continue;
        const tex = def.bleed[Math.floor(hash(x, y, z, 80 + d) * def.bleed.length)];
        const flip = hash(x, y, z, 84 + d) < 0.5;
        const [ax, az, bx, bz] = BLEED_EDGE[d], ox = DIRS[d][0] * BLEED_D, oz = DIRS[d][2] * BLEED_D;
        const yy = y + 1 + BLEED_LIFT;
        const P = (u: number, w: number) => [x + u - 0.5, yy, z + w - 0.5];
        const u0 = flip ? 1 : 0, u1 = flip ? 0 : 1;
        const c = 1 - (nDef.jitter ?? 0) * hash(nx, y, nz, 9);
        // a → b по грани, внутрь соседа; обход против часовой сверху — нормаль вверх (материал односторонний)
        quad(buckets.detail, [P(ax, az), P(bx, bz), P(bx + ox, bz + oz), P(ax + ox, az + oz)],
          [[u0, 0], [u1, 0], [u1, BLEED_D], [u0, BLEED_D]], [0, 1, 0], tex, c);
      }
    }

    const meshes: THREE.Mesh[] = [];
    for (const layer of LAYERS) {
      const b = buckets[layer];
      if (b.empty) continue;
      const m = new THREE.Mesh(b.geometry(), this.mats[layer]);
      m.castShadow = layer === 'opaque' || layer === 'cutout';
      m.receiveShadow = layer === 'opaque' || layer === 'cutout' || layer === 'detail';
      m.frustumCulled = true;
      this.group.add(m);
      meshes.push(m);
    }
    this.meshes.set(key, meshes);
    if (spots.length) this.lights.set(key, spots);
  }

  /** Сколько треугольников в слое по всем чанкам (для тестов и замеров) */
  triangles(layer: Layer): number {
    let n = 0;
    for (const list of this.meshes.values()) for (const m of list) if (m.material === this.mats[layer]) n += m.geometry.getAttribute('position').count / 3;
    return n;
  }

  /** Прозрачность стен между камерой и героем: hero — точка груди героя, radius — радиус окна (0 — выключить) */
  setXray(hero: THREE.Vector3, cam: THREE.Vector3, radius: number): void {
    XRAY_UNIFORMS.uXrayHero.value.copy(hero);
    XRAY_UNIFORMS.uXrayCam.value.copy(cam);
    XRAY_UNIFORMS.uXrayR.value = radius;
  }

  /** Разрез: не рисовать блоки выше y; Infinity — выключить */
  setCut(y: number): void {
    XRAY_UNIFORMS.uXrayCut.value = Math.min(y, 1e9);
  }

  /** Анимация воды и огня, ближайшие к focus источники света. night 0..1 */
  update(t: number, night: number, focus: THREE.Vector3): void {
    WATER_UNIFORMS.uTime.value = t;
    this.waterTex.offset.set(Math.sin(t * 0.4) * 0.06, t * 0.02);
    this.acidTex.offset.set(t * 0.015, Math.sin(t * 0.3) * 0.05);
    this.fallsTex.offset.y = t * 1.6;
    this.fireTex.offset.y = (2 - (Math.floor(t * 9) % 3)) / 3;
    const all: LightSpot[] = [];
    for (const l of this.lights.values()) all.push(...l);
    all.push(...this.decor.lights);
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
    this.decor.dispose();
    this.scene.remove(this.group);
    for (const m of Object.values(this.mats)) m.dispose();
    this.atlas.texture.dispose();
  }
}
