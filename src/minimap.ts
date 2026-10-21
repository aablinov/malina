import type * as THREE from 'three';
import type { MissionMap } from './map';
import type { CampRuntime } from './mission';
import { LEVEL_COLORS } from './lobby';

export interface MinimapData {
  camps: readonly CampRuntime[];
  players: readonly { pos: THREE.Vector3; facing: number; color: string; down: boolean }[];
  beetles: readonly { pos: THREE.Vector3; ranged: boolean }[];
  caches: readonly { pos: THREE.Vector3 }[];
  drop: THREE.Vector3;
}

/** Мини-карта в углу: вся карта целиком, перерисовка 12 раз в секунду */
export class Minimap {
  private readonly bg: HTMLCanvasElement;
  private acc = 0;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly map: MissionMap) {
    this.bg = document.createElement('canvas');
    this.bg.width = canvas.width; this.bg.height = canvas.height;
    const g = this.bg.getContext('2d');
    if (!g) return;
    const { W, H, X, Z } = this.tf();
    g.fillStyle = '#0d1118'; g.fillRect(0, 0, W, H);
    for (const r of map.regions) {
      g.globalAlpha = 0.28; g.fillStyle = r.color;
      g.fillRect(X(r.x0), Z(r.z0), X(r.x1) - X(r.x0), Z(r.z1) - Z(r.z0));
    }
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(200,170,120,0.35)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, Z(0)); g.lineTo(W, Z(0)); g.moveTo(X(0), 0); g.lineTo(X(0), H); g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.4)';
    for (const o of map.obstacles) { g.beginPath(); g.arc(X(o.x), Z(o.z), Math.max(1, o.r * 1.2), 0, Math.PI * 2); g.fill(); }
  }

  private tf() {
    const W = this.canvas.width, H = this.canvas.height;
    const { halfX, halfZ } = this.map;
    return { W, H, X: (x: number) => ((x + halfX) / (2 * halfX)) * W, Z: (z: number) => ((z + halfZ) / (2 * halfZ)) * H };
  }

  update(dt: number, d: MinimapData, t: number): void {
    this.acc += dt;
    if (this.acc < 1 / 12) return;
    this.acc = 0;
    const g = this.canvas.getContext('2d');
    if (!g) return;
    const { X, Z } = this.tf();
    g.drawImage(this.bg, 0, 0);
    // точка высадки
    g.strokeStyle = '#ffd84a'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(X(d.drop.x), Z(d.drop.z), 5, 0, Math.PI * 2); g.stroke();
    for (const c of d.caches) { g.fillStyle = '#ffd25a'; g.fillRect(X(c.pos.x) - 1.5, Z(c.pos.z) - 1.5, 3, 3); }
    for (const c of d.camps) {
      const x = X(c.pos.x), z = Z(c.pos.z);
      if (c.state === 'captured') {
        g.fillStyle = '#5fe04a';
        g.fillRect(x - 1, z - 7, 2, 9);
        g.fillStyle = '#e0284f'; g.fillRect(x + 1, z - 7, 5, 4);
        continue;
      }
      const col = LEVEL_COLORS[c.level - 1];
      const blink = (c.state === 'blocked' || c.state === 'capturing') && Math.sin(t * 10) > 0;
      g.fillStyle = '#0b0d12'; g.beginPath(); g.arc(x, z, 6, 0, Math.PI * 2); g.fill();
      g.strokeStyle = blink ? '#ffffff' : col; g.lineWidth = 2; g.beginPath(); g.arc(x, z, 5.5, 0, Math.PI * 2); g.stroke();
      if (c.progress > 0) { g.strokeStyle = '#ffd84a'; g.beginPath(); g.arc(x, z, 8, -Math.PI / 2, -Math.PI / 2 + c.progress * Math.PI * 2); g.stroke(); }
      g.fillStyle = col; g.font = 'bold 7px "Press Start 2P", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(c.level), x + 0.5, z + 0.5);
    }
    for (const b of d.beetles) { g.fillStyle = b.ranged ? '#7aff3a' : '#ff4a4a'; g.fillRect(X(b.pos.x) - 1, Z(b.pos.z) - 1, 2.5, 2.5); }
    for (const p of d.players) {
      const x = X(p.pos.x), z = Z(p.pos.z);
      g.save(); g.translate(x, z); g.rotate(-p.facing + Math.PI);
      g.fillStyle = p.down ? '#888' : p.color; g.strokeStyle = '#000'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, -6); g.lineTo(4, 4); g.lineTo(0, 2); g.lineTo(-4, 4); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
    g.textBaseline = 'alphabetic';
  }
}
