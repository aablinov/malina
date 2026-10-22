import * as THREE from 'three';
import { textureByName, type Textures } from '../textures';

/**
 * Атлас текстур блоков: все тайлы 16 × 16 из textures.ts складываются в одну картинку,
 * чтобы чанк рисовался одним вызовом. Каждый тайл лежит в слоте 32 × 32 с полями из
 * растянутых краёв — мип-уровни тогда не подмешивают соседей.
 */

export interface TileUV { u0: number; v0: number; u1: number; v1: number }

export class Atlas {
  readonly texture: THREE.CanvasTexture;
  private readonly tiles = new Map<string, TileUV>();

  constructor(T: Textures, names: string[]) {
    const TILE = 16, SLOT = 32, PAD = (SLOT - TILE) / 2;
    const cols = Math.ceil(Math.sqrt(names.length));
    const rows = Math.ceil(names.length / cols);
    const W = cols * SLOT, H = rows * SLOT;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    if (!g) throw new Error('Canvas 2D недоступен');
    g.imageSmoothingEnabled = false;
    names.forEach((name, i) => {
      const img = textureByName(T, name).image as HTMLCanvasElement;
      const sx = (i % cols) * SLOT + PAD, sy = Math.floor(i / cols) * SLOT + PAD;
      const w = img.width, h = img.height;
      // поля: края тайла растянуты наружу
      g.drawImage(img, 0, 0, w, 1, sx - PAD, sy - PAD, TILE + PAD * 2, PAD);
      g.drawImage(img, 0, h - 1, w, 1, sx - PAD, sy + TILE, TILE + PAD * 2, PAD);
      g.drawImage(img, 0, 0, 1, h, sx - PAD, sy - PAD, PAD, TILE + PAD * 2);
      g.drawImage(img, w - 1, 0, 1, h, sx + TILE, sy - PAD, PAD, TILE + PAD * 2);
      g.drawImage(img, 0, 0, w, h, sx, sy, TILE, TILE);
      this.tiles.set(name, { u0: sx / W, v0: 1 - (sy + TILE) / H, u1: (sx + TILE) / W, v1: 1 - sy / H });
    });
    this.texture = new THREE.CanvasTexture(c);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  uv(name: string): TileUV {
    const t = this.tiles.get(name);
    if (!t) throw new Error(`Текстуры «${name}» нет в атласе`);
    return t;
  }
}
