/**
 * Parsing a Wavefront OBJ into a block shape.
 * Supported: v / vt / vn / usemtl / f (triangles and quads, v/vt/vn indices).
 * The shape lives in the 0..1 cube; a face lying entirely on the cube boundary and facing outwards
 * is marked with a direction (cull) — the mesher hides it if the neighbour on that side is opaque.
 */

/** Directions: 0 +X, 1 +Z, 2 −X, 3 −Z, 4 +Y, 5 −Y */
export const DIRS: readonly (readonly [number, number, number])[] = [[1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1], [0, 1, 0], [0, -1, 0]];

export interface Tri {
  /** Texture slot (usemtl) */
  group: string;
  /** 3 vertices × xyz */
  pos: number[];
  /** 3 vertices × uv */
  uv: number[];
  nrm: [number, number, number];
  /** Direction of the cube boundary the face lies on, or −1 */
  cull: number;
}

export interface Shape {
  name: string;
  tris: Tri[];
  groups: string[];
}

const EPS = 1e-4;

function cullDir(pos: number[], n: [number, number, number]): number {
  for (let d = 0; d < 6; d++) {
    const [dx, dy, dz] = DIRS[d];
    if (n[0] * dx + n[1] * dy + n[2] * dz < 0.999) continue;
    const axis = dx ? 0 : dy ? 1 : 2;
    const plane = (dx + dy + dz) > 0 ? 1 : 0;
    let on = true;
    for (let i = 0; i < 3; i++) if (Math.abs(pos[i * 3 + axis] - plane) > EPS) { on = false; break; }
    if (on) return d;
  }
  return -1;
}

export function parseObj(name: string, text: string): Shape {
  const v: number[][] = [], vt: number[][] = [], vn: number[][] = [];
  const tris: Tri[] = [];
  const groups = new Set<string>();
  let group = 'side';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const p = line.split(/\s+/);
    switch (p[0]) {
      case 'v': v.push([+p[1], +p[2], +p[3]]); break;
      case 'vt': vt.push([+p[1], +p[2]]); break;
      case 'vn': vn.push([+p[1], +p[2], +p[3]]); break;
      case 'usemtl': group = p[1]; groups.add(group); break;
      case 'f': {
        const idx = p.slice(1).map((s) => s.split('/').map((k) => (k ? parseInt(k, 10) - 1 : -1)));
        for (let i = 1; i + 1 < idx.length; i++) {
          const corners = [idx[0], idx[i], idx[i + 1]];
          const pos: number[] = [], uv: number[] = [];
          for (const c of corners) {
            pos.push(...v[c[0]]);
            uv.push(...(c[1] >= 0 ? vt[c[1]] : [0, 0]));
          }
          let nrm: [number, number, number];
          if (corners[0][2] >= 0) nrm = vn[corners[0][2]] as [number, number, number];
          else {
            const ax = pos[3] - pos[0], ay = pos[4] - pos[1], az = pos[5] - pos[2];
            const bx = pos[6] - pos[0], by = pos[7] - pos[1], bz = pos[8] - pos[2];
            const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
            const l = Math.hypot(nx, ny, nz) || 1;
            nrm = [nx / l, ny / l, nz / l];
          }
          tris.push({ group, pos, uv, nrm, cull: cullDir(pos, nrm) });
        }
        break;
      }
      default: break;
    }
  }
  if (!tris.length) throw new Error(`OBJ "${name}": no faces`);
  return { name, tris, groups: [...groups] };
}

/** Rotate a shape around the Y axis by rot × 90° around the block centre */
export function rotateShape(s: Shape, rot: number): Shape {
  rot = ((rot % 4) + 4) % 4;
  if (rot === 0) return s;
  const rp = (x: number, z: number): [number, number] => {
    // k = 1: (x, z) → (1 − z, x), i.e. +X turns into +Z
    for (let k = 0; k < rot; k++) { const nx = 1 - z; z = x; x = nx; }
    return [x, z];
  };
  const rv = (x: number, z: number): [number, number] => {
    for (let k = 0; k < rot; k++) { const nx = -z; z = x; x = nx; }
    return [x, z];
  };
  return {
    name: s.name, groups: s.groups,
    tris: s.tris.map((t) => {
      const pos = t.pos.slice();
      for (let i = 0; i < 3; i++) { const [x, z] = rp(pos[i * 3], pos[i * 3 + 2]); pos[i * 3] = x; pos[i * 3 + 2] = z; }
      const [nx, nz] = rv(t.nrm[0], t.nrm[2]);
      const cull = t.cull < 0 ? -1 : t.cull >= 4 ? t.cull : (t.cull + rot) % 4;
      return { group: t.group, pos, uv: t.uv, nrm: [nx, t.nrm[1], nz], cull };
    }),
  };
}
