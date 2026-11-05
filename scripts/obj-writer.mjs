/**
 * Writing shapes to Wavefront OBJ: boxes, crossed planes, rotated parts.
 * Shared by scripts/gen-blocks.mjs (blocks in the 0..1 cube) and scripts/gen-decor.mjs (decor of any size).
 */

export class Obj {
  constructor(name) { this.name = name; this.v = []; this.vt = []; this.vn = []; this.faces = []; this.group = ''; }
  /** Quad: 4 points [x,y,z], 4 uv [u,v], group. Counter-clockwise winding seen from outside. */
  quad(pts, uvs, group, normal) {
    const [a, b, c] = pts;
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const len = Math.hypot(...n) || 1;
    n = n.map((k) => k / len);
    if (normal && n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2] < 0) { pts = [pts[0], pts[3], pts[2], pts[1]]; uvs = [uvs[0], uvs[3], uvs[2], uvs[1]]; n = n.map((k) => -k); }
    const vi = pts.map((p) => this.v.push(p)), ti = uvs.map((t) => this.vt.push(t));
    const ni = this.vn.push(n);
    this.faces.push({ group, idx: [0, 1, 2].map((k) => `${vi[k]}/${ti[k]}/${ni}`) }, { group, idx: [0, 2, 3].map((k) => `${vi[k]}/${ti[k]}/${ni}`) });
  }
  /** Box from (x0,y0,z0) to (x1,y1,z1); groups — a slot for each face px/nx/py/ny/pz/nz (null — no face) */
  box(x0, y0, z0, x1, y1, z1, groups) {
    const g = typeof groups === 'string' ? { px: groups, nx: groups, py: groups, ny: groups, pz: groups, nz: groups } : { px: 'side', nx: 'side', pz: 'side', nz: 'side', py: 'top', ny: 'bottom', ...groups };
    if (g.py) this.quad([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [[x0, 1 - z0], [x0, 1 - z1], [x1, 1 - z1], [x1, 1 - z0]], g.py, [0, 1, 0]);
    if (g.ny) this.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [[x0, 1 - z0], [x1, 1 - z0], [x1, 1 - z1], [x0, 1 - z1]], g.ny, [0, -1, 0]);
    if (g.px) this.quad([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [[1 - z0, y0], [1 - z0, y1], [1 - z1, y1], [1 - z1, y0]], g.px, [1, 0, 0]);
    if (g.nx) this.quad([[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]], [[z1, y0], [z1, y1], [z0, y1], [z0, y0]], g.nx, [-1, 0, 0]);
    if (g.pz) this.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], g.pz, [0, 0, 1]);
    if (g.nz) this.quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [[1 - x1, y0], [1 - x0, y0], [1 - x0, y1], [1 - x1, y1]], g.nz, [0, 0, -1]);
    return this;
  }
  /** Two diagonally crossed planes (grass, flowers, fire); drawn double-sided */
  cross(group, x0 = 0, x1 = 1, y0 = 0, y1 = 1) {
    const m = (x0 + x1) / 2, h = (x1 - x0) / 2;
    this.quad([[m - h, y0, m - h], [m + h, y0, m + h], [m + h, y1, m + h], [m - h, y1, m - h]], [[0, y0], [1, y0], [1, y1], [0, y1]], group);
    this.quad([[m + h, y0, m - h], [m - h, y0, m + h], [m - h, y1, m + h], [m + h, y1, m - h]], [[0, y0], [1, y0], [1, y1], [0, y1]], group);
    return this;
  }
  text() {
    const r = (n) => +n.toFixed(5);
    const out = [`# ${this.name} — Malina block shape, 1 block = 1 m, 1/16 grid`, `o ${this.name}`];
    for (const p of this.v) out.push(`v ${r(p[0])} ${r(p[1])} ${r(p[2])}`);
    for (const t of this.vt) out.push(`vt ${r(t[0])} ${r(t[1])}`);
    for (const n of this.vn) out.push(`vn ${r(n[0])} ${r(n[1])} ${r(n[2])}`);
    let g = null;
    for (const f of this.faces) {
      if (f.group !== g) { g = f.group; out.push(`usemtl ${g}`); }
      out.push(`f ${f.idx.join(' ')}`);
    }
    return out.join('\n') + '\n';
  }

  /**
   * Box of any size (decor): faces are cut along the cell grid — on X and Z at half-integers (a cell is centred on an integer,
   * as in the world), on Y at integers — and each tile takes its own piece of texture. So a 3 m item does not stretch its texture,
   * and pixels come out 16 per metre, as on blocks. groups — as in box.
   */
  tbox(x0, y0, z0, x1, y1, z1, groups) {
    const cuts = (a, b, off) => {
      // a zero-thickness plane (cobweb) — a single "cell"
      if (b - a < 1e-9) { const k = Math.floor(a + off + 1e-9); return [[a, b, k - off]]; }
      const out = [];
      let lo = a;
      while (lo < b - 1e-9) {
        const k = Math.floor(lo + off + 1e-9);
        const hi = Math.min(b, k + 1 - off);
        out.push([lo, hi, k - off]);
        lo = hi;
      }
      return out;
    };
    const g = typeof groups === 'string' ? { px: groups, nx: groups, py: groups, ny: groups, pz: groups, nz: groups } : { px: 'side', nx: 'side', pz: 'side', nz: 'side', py: 'top', ny: 'bottom', ...groups };
    for (const [ax, bx, ox] of cuts(x0, x1, 0.5)) for (const [ay, by, oy] of cuts(y0, y1, 0)) for (const [az, bz, oz] of cuts(z0, z1, 0.5)) {
      // only faces on the boundary of the whole box
      const sub = {
        px: bx >= x1 - 1e-9 ? g.px : null, nx: ax <= x0 + 1e-9 ? g.nx : null,
        py: by >= y1 - 1e-9 ? g.py : null, ny: ay <= y0 + 1e-9 ? g.ny : null,
        pz: bz >= z1 - 1e-9 ? g.pz : null, nz: az <= z0 + 1e-9 ? g.nz : null,
      };
      if (!Object.values(sub).some(Boolean)) continue;
      const v0 = this.v.length;
      this.box(ax - ox, ay - oy, az - oz, bx - ox, by - oy, bz - oz, sub);
      for (let i = v0; i < this.v.length; i++) { const p = this.v[i]; this.v[i] = [p[0] + ox, p[1] + oy, p[2] + oz]; }
    }
    return this;
  }
  /**
   * Rotate and move everything fn builds: rot — degrees around X, Y, Z (YXZ order, like Euler in three),
   * around pivot, then the move offset. UVs are computed before the rotation — pixel density does not change.
   */
  xf({ rot = [0, 0, 0], pivot = [0, 0, 0], move = [0, 0, 0] }, fn) {
    const v0 = this.v.length, n0 = this.vn.length;
    fn(this);
    const [rx, ry, rz] = rot.map((d) => (d * Math.PI) / 180);
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    // R = Ry · Rx · Rz
    const R = (p) => {
      let [x, y, z] = p;
      [x, y] = [x * cz - y * sz, x * sz + y * cz];
      [y, z] = [y * cx - z * sx, y * sx + z * cx];
      [x, z] = [x * cy + z * sy, -x * sy + z * cy];
      return [x, y, z];
    };
    for (let i = v0; i < this.v.length; i++) {
      const p = this.v[i];
      const q = R([p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]]);
      this.v[i] = [q[0] + pivot[0] + move[0], q[1] + pivot[1] + move[1], q[2] + pivot[2] + move[2]];
    }
    for (let i = n0; i < this.vn.length; i++) this.vn[i] = R(this.vn[i]);
    return this;
  }
}
