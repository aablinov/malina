import * as THREE from 'three';
import type { FX } from './fx';
import { additive, additiveSprite } from './loot-look';

/**
 * Круги каста (wiki/design-spells.md, раздел 5): у каждой школы свой узор из слоёв — кольцо с засечками, квадраты и ромбы,
 * гексаграмма, снежинка, языки пламени, цветок, кольцо символов. Слои вращаются в разные стороны с разной скоростью
 * и раскрываются ступенями по заряду (0, ¼, ½, ¾): новый слой «щёлкает» — выскакивает крупнее и садится на место.
 * С третьей ступени вокруг героя кружат светящиеся символы, с четвёртой — встаёт стена света.
 * Текстуры белые, рисуются кодом один раз; цвет — в материале.
 */

export type SigilSchool = 'spark' | 'fireball' | 'icerain' | 'heal' | 'star' | 'void' | 'earth' | 'arcane' | 'pact' | 'bastion' | 'rage' | 'clarity' | 'thorns';

type Draw = (g: CanvasRenderingContext2D, c: number, r: number, w: number) => void;

const TAU = Math.PI * 2;
const circle = (g: CanvasRenderingContext2D, x: number, y: number, r: number): void => { g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke(); };
const poly = (g: CanvasRenderingContext2D, c: number, r: number, n: number, rot = -Math.PI / 2): void => {
  g.beginPath();
  for (let i = 0; i <= n; i++) { const a = rot + (i / n) * TAU; g[i ? 'lineTo' : 'moveTo'](c + Math.cos(a) * r, c + Math.sin(a) * r); }
  g.stroke();
};
/** Знак-руна из 2–4 отрезков, детерминированно от seed, в квадрате ±h */
const glyph = (g: CanvasRenderingContext2D, x: number, y: number, h: number, seed: number): void => {
  let s = seed * 9301 + 49297;
  const r = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const snap = (): number => (Math.round(r() * 4) / 4 - 0.5) * 2 * h;
  g.beginPath(); g.moveTo(x + snap(), y + snap());
  for (let i = 0, n = 2 + Math.floor(r() * 3); i < n; i++) g.lineTo(x + snap(), y + snap());
  g.stroke();
  if (r() < 0.5) { g.beginPath(); g.arc(x + snap() * 0.6, y + snap() * 0.6, h * 0.18, 0, TAU); g.fill(); }
};

/** Узоры слоёв: c — центр холста, r — радиус узора, w — базовая толщина линии */
const DRAW: Record<string, Draw> = {
  ticks(g, c, r, w) {
    g.lineWidth = w * 2.2; circle(g, c, c, r);
    g.lineWidth = w; circle(g, c, c, r * 0.9);
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * TAU, l = i % 6 === 0 ? 0.1 : 0.05;
      g.lineWidth = i % 6 === 0 ? w * 1.4 : w * 0.8;
      g.beginPath(); g.moveTo(c + Math.cos(a) * r * 0.9, c + Math.sin(a) * r * 0.9); g.lineTo(c + Math.cos(a) * r * (0.9 - l), c + Math.sin(a) * r * (0.9 - l)); g.stroke();
    }
    g.lineWidth = w * 1.2;
    for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU; circle(g, c + Math.cos(a) * r, c + Math.sin(a) * r, r * 0.06); }
  },
  runes(g, c, r, w) {
    g.lineWidth = w; circle(g, c, c, r); circle(g, c, c, r * 0.74);
    g.lineWidth = w * 1.1;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU, x = c + Math.cos(a) * r * 0.87, y = c + Math.sin(a) * r * 0.87;
      g.save(); g.translate(x, y); g.rotate(a + Math.PI / 2); glyph(g, 0, 0, r * 0.075, i + 3); g.restore();
    }
  },
  square(g, c, r, w) {
    g.lineWidth = w * 1.6; poly(g, c, r, 4, Math.PI / 4);
    g.lineWidth = w * 0.8; poly(g, c, r * 0.86, 4, Math.PI / 4);
    // перекрестье из углов и кружки на углах
    for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + (i / 4) * TAU; g.lineWidth = w * 1.2; circle(g, c + Math.cos(a) * r, c + Math.sin(a) * r, r * 0.08); }
    g.lineWidth = w * 0.6; poly(g, c, r * 0.6, 4, 0);
  },
  hexagram(g, c, r, w) {
    g.lineWidth = w * 1.6; poly(g, c, r, 3); poly(g, c, r, 3, Math.PI / 2);
    g.lineWidth = w * 0.8; circle(g, c, c, r * 0.5);
    for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i / 6) * TAU; g.lineWidth = w; circle(g, c + Math.cos(a) * r, c + Math.sin(a) * r, r * 0.07); }
  },
  triangle(g, c, r, w) {
    g.lineWidth = w * 2; poly(g, c, r, 3);
    g.lineWidth = w; circle(g, c, c, r * 0.5); circle(g, c, c, r);
    g.beginPath(); g.arc(c, c, r * 0.14, 0, TAU); g.fill();
  },
  hexagon(g, c, r, w) {
    g.lineWidth = w * 1.8; poly(g, c, r, 6, 0);
    g.lineWidth = w * 0.8; poly(g, c, r * 0.8, 6, Math.PI / 6);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; g.beginPath(); g.moveTo(c + Math.cos(a) * r * 0.25, c + Math.sin(a) * r * 0.25); g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); g.stroke(); }
  },
  snowflake(g, c, r, w) {
    g.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      g.lineWidth = w * 1.8; g.beginPath(); g.moveTo(c, c); g.lineTo(c + ca * r, c + sa * r); g.stroke();
      g.lineWidth = w * 1.1;
      for (const t of [0.45, 0.72]) {
        const bx = c + ca * r * t, by = c + sa * r * t, l = r * (0.3 - t * 0.18);
        for (const s of [1, -1]) { const b = a + s * 0.75; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(b) * l, by + Math.sin(b) * l); g.stroke(); }
      }
    }
    g.lineWidth = w; poly(g, c, r * 0.22, 6, 0);
  },
  zigzag(g, c, r, w) {
    g.lineWidth = w; circle(g, c, c, r); circle(g, c, c, r * 0.8);
    g.lineWidth = w * 1.6; g.beginPath();
    for (let i = 0; i <= 36; i++) { const a = (i / 36) * TAU, rr = i % 2 ? r * 0.96 : r * 0.84; g[i ? 'lineTo' : 'moveTo'](c + Math.cos(a) * rr, c + Math.sin(a) * rr); }
    g.stroke();
  },
  flames(g, c, r, w) {
    g.lineWidth = w * 1.2; circle(g, c, c, r * 0.8);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      g.save(); g.translate(c + Math.cos(a) * r * 0.8, c + Math.sin(a) * r * 0.8); g.rotate(a + Math.PI / 2);
      const h = r * 0.2, b = r * 0.06;
      g.beginPath(); g.moveTo(-b, 0); g.quadraticCurveTo(-b, -h * 0.6, 0, -h); g.quadraticCurveTo(b * 0.4, -h * 0.5, b, 0); g.stroke();
      g.restore();
    }
  },
  flower(g, c, r, w) {
    const k = r / 2;
    g.lineWidth = w * 1.2; circle(g, c, c, k);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; circle(g, c + Math.cos(a) * k, c + Math.sin(a) * k, k); }
    g.lineWidth = w * 1.6; circle(g, c, c, r);
  },
  leaves(g, c, r, w) {
    g.lineWidth = w; circle(g, c, c, r * 0.82);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      g.save(); g.translate(c + Math.cos(a) * r * 0.82, c + Math.sin(a) * r * 0.82); g.rotate(a + Math.PI / 2 + 0.5);
      const h = r * 0.17;
      g.lineWidth = w * 1.2;
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(h * 0.5, -h * 0.5, 0, -h); g.quadraticCurveTo(-h * 0.5, -h * 0.5, 0, 0); g.stroke();
      g.lineWidth = w * 0.6; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -h * 0.85); g.stroke();
      g.restore();
    }
  },
  dots(g, c, r, w) {
    g.lineWidth = w * 0.7; circle(g, c, c, r * 0.92);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU, x = c + Math.cos(a) * r * 0.92, y = c + Math.sin(a) * r * 0.92;
      g.lineWidth = w * 1.2; circle(g, x, y, r * 0.055);
      if (i % 3 === 0) { g.beginPath(); g.arc(x, y, r * 0.025, 0, TAU); g.fill(); }
    }
  },
  pentagram(g, c, r, w) {
    g.lineWidth = w * 1.6; g.beginPath();
    for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + ((i * 2) / 5) * TAU; g[i ? 'lineTo' : 'moveTo'](c + Math.cos(a) * r, c + Math.sin(a) * r); }
    g.stroke();
    g.lineWidth = w; circle(g, c, c, r);
    for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i / 5) * TAU; circle(g, c + Math.cos(a) * r, c + Math.sin(a) * r, r * 0.07); }
  },
  rays(g, c, r, w) {
    // солнце: 16 лучей-клиньев, длинные и короткие через один
    g.lineWidth = w; circle(g, c, c, r * 0.55);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU, l = i % 2 ? 0.8 : 1, b = 0.06;
      g.lineWidth = w * 1.2; g.beginPath();
      g.moveTo(c + Math.cos(a - b) * r * 0.6, c + Math.sin(a - b) * r * 0.6); g.lineTo(c + Math.cos(a) * r * l, c + Math.sin(a) * r * l); g.lineTo(c + Math.cos(a + b) * r * 0.6, c + Math.sin(a + b) * r * 0.6);
      g.stroke();
    }
  },
  spiral(g, c, r, w) {
    // три рукава спирали — воронка душ
    g.lineWidth = w * 1.4;
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      for (let i = 0; i <= 60; i++) { const t = i / 60, a = k * (TAU / 3) + t * TAU * 1.1, rr = r * (0.12 + t * 0.88); g[i ? 'lineTo' : 'moveTo'](c + Math.cos(a) * rr, c + Math.sin(a) * rr); }
      g.stroke();
    }
    g.lineWidth = w; circle(g, c, c, r);
  },
  eye(g, c, r, w) {
    g.lineWidth = w * 1.6; g.beginPath();
    g.moveTo(c - r, c); g.quadraticCurveTo(c, c - r * 0.9, c + r, c); g.quadraticCurveTo(c, c + r * 0.9, c - r, c); g.stroke();
    g.lineWidth = w; circle(g, c, c, r * 0.32);
    g.beginPath(); g.arc(c, c, r * 0.14, 0, TAU); g.fill();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; g.beginPath(); g.moveTo(c + Math.cos(a) * r * 0.42, c + Math.sin(a) * r * 0.42); g.lineTo(c + Math.cos(a) * r * 0.55, c + Math.sin(a) * r * 0.55); g.stroke(); }
  },
  stones(g, c, r, w) {
    // кольцо из угловатых камней-блоков
    g.lineWidth = w * 0.8; circle(g, c, c, r * 0.86);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU, x = c + Math.cos(a) * r * 0.86, y = c + Math.sin(a) * r * 0.86, h = r * (i % 2 ? 0.06 : 0.09);
      g.save(); g.translate(x, y); g.rotate(a + (i % 3) * 0.3);
      g.lineWidth = w * 1.4; g.strokeRect(-h, -h, h * 2, h * 2);
      if (i % 2 === 0) g.fillRect(-h * 0.4, -h * 0.4, h * 0.8, h * 0.8);
      g.restore();
    }
  },
  cracks(g, c, r, w) {
    // трещины от центра с изломами
    g.lineCap = 'round';
    let seed = 11;
    const rr = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 9; i++) {
      let a = (i / 9) * TAU, x = c, y = c;
      g.lineWidth = w * 1.5; g.beginPath(); g.moveTo(x, y);
      for (let j = 1; j <= 5; j++) { a += (rr() - 0.5) * 0.7; const l = r / 5; x += Math.cos(a) * l; y += Math.sin(a) * l; g.lineTo(x, y); }
      g.stroke();
    }
    g.lineWidth = w; circle(g, c, c, r * 0.2);
  },
  blades(g, c, r, w) {
    // венец из мечей остриём наружу
    g.lineWidth = w * 0.8; circle(g, c, c, r * 0.6);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      g.save(); g.translate(c, c); g.rotate(a);
      g.lineWidth = w * 1.3;
      g.beginPath(); g.moveTo(-r * 0.04, -r * 0.62); g.lineTo(-r * 0.04, -r * 0.92); g.lineTo(0, -r); g.lineTo(r * 0.04, -r * 0.92); g.lineTo(r * 0.04, -r * 0.62); g.stroke();
      g.beginPath(); g.moveTo(-r * 0.1, -r * 0.62); g.lineTo(r * 0.1, -r * 0.62); g.stroke();
      g.restore();
    }
  },
  thorns(g, c, r, w) {
    // лоза волной по кругу и шипы наружу и внутрь
    g.lineWidth = w * 1.6; g.beginPath();
    for (let i = 0; i <= 120; i++) { const a = (i / 120) * TAU, rr = r * (0.9 + Math.sin(a * 10) * 0.035); g[i ? 'lineTo' : 'moveTo'](c + Math.cos(a) * rr, c + Math.sin(a) * rr); }
    g.stroke();
    g.lineWidth = w * 0.9; g.beginPath();
    for (let i = 0; i <= 120; i++) { const a = (i / 120) * TAU, rr = r * (0.9 - Math.sin(a * 10 + 1.5) * 0.035); g[i ? 'lineTo' : 'moveTo'](c + Math.cos(a) * rr, c + Math.sin(a) * rr); }
    g.stroke();
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * TAU + 0.05, out = i % 2 ? 1 : -1, b = r * 0.9;
      const x = c + Math.cos(a) * b, y = c + Math.sin(a) * b, l = r * 0.09;
      g.lineWidth = w * 1.1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a + 0.35 * out) * l * out, y + Math.sin(a + 0.35 * out) * l * out); g.stroke();
    }
  },
  diamonds(g, c, r, w) {
    g.lineWidth = w * 0.7; circle(g, c, c, r * 0.9);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU, x = c + Math.cos(a) * r * 0.9, y = c + Math.sin(a) * r * 0.9, s = r * 0.085;
      g.save(); g.translate(x, y); g.rotate(a);
      g.lineWidth = w * 1.4; g.beginPath(); g.moveTo(0, -s * 1.6); g.lineTo(s, 0); g.lineTo(0, s * 1.6); g.lineTo(-s, 0); g.closePath(); g.stroke();
      g.restore();
    }
  },
};

const texCache = new Map<string, THREE.Texture>();
const layerTex = (key: string): THREE.Texture => {
  let t = texCache.get(key);
  if (t) return t;
  const S = 512, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  g.strokeStyle = g.fillStyle = '#fff'; g.lineJoin = 'round';
  DRAW[key](g, S / 2, S / 2 - 8, S / 170);
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
};
let wallT: THREE.Texture | null = null;
/** Стена света: вертикальные лучи разной яркости, к верху тают (повторяется по кругу) */
const wallTex = (): THREE.Texture => {
  if (wallT) return wallT;
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 64;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  for (let x = 0; x < 128; x++) {
    const v = 0.25 + 0.75 * Math.pow(Math.random(), 3);
    const gr = g.createLinearGradient(0, 64, 0, 0);
    gr.addColorStop(0, `rgba(255,255,255,${v})`); gr.addColorStop(0.5, `rgba(255,255,255,${v * 0.35})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x, 0, 1, 64);
  }
  wallT = new THREE.CanvasTexture(cv);
  wallT.colorSpace = THREE.SRGBColorSpace;
  wallT.wrapS = THREE.RepeatWrapping;
  wallT.repeat.set(3, 1);
  return wallT;
};
const glyphTex: THREE.Texture[] = [];
const glyphSprite = (i: number): THREE.Texture => {
  if (!glyphTex[i]) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d') as CanvasRenderingContext2D;
    g.strokeStyle = g.fillStyle = '#fff'; g.lineWidth = 4; g.lineCap = 'square';
    glyph(g, 32, 32, 20, 40 + i * 7);
    g.lineWidth = 2; circle(g, 32, 32, 29);
    glyphTex[i] = new THREE.CanvasTexture(cv);
    glyphTex[i].colorSpace = THREE.SRGBColorSpace;
  }
  return glyphTex[i];
};

/** Слой: узор, доля радиуса, скорость вращения (рад/с, знак — направление), ступень появления, поворот, второй цвет */
interface Layer { key: string; r: number; speed: number; at: number; rot?: number; alt?: boolean }

const STYLE: Record<SigilSchool, Layer[]> = {
  spark: [
    { key: 'ticks', r: 1, speed: 0.35, at: 0 },
    { key: 'zigzag', r: 0.86, speed: -0.8, at: 0, alt: true },
    { key: 'square', r: 0.7, speed: 0.6, at: 0.25 },
    { key: 'square', r: 0.7, speed: -0.6, at: 0.25, rot: Math.PI / 4, alt: true },
    { key: 'runes', r: 0.5, speed: 1.1, at: 0.5 },
    { key: 'dots', r: 1.18, speed: -0.3, at: 0.75, alt: true },
    { key: 'triangle', r: 0.28, speed: 1.8, at: 0.75 },
  ],
  fireball: [
    { key: 'ticks', r: 1, speed: -0.3, at: 0 },
    { key: 'hexagram', r: 0.82, speed: 0.55, at: 0.25, alt: true },
    { key: 'runes', r: 0.58, speed: -1, at: 0.5 },
    { key: 'flames', r: 1.2, speed: 0.4, at: 0.5, alt: true },
    { key: 'triangle', r: 0.32, speed: 1.6, at: 0.75 },
    { key: 'square', r: 0.45, speed: -1.2, at: 0.75, rot: Math.PI / 4, alt: true },
  ],
  icerain: [
    { key: 'ticks', r: 1, speed: 0.3, at: 0 },
    { key: 'hexagon', r: 0.82, speed: 0.4, at: 0.25, alt: true },
    { key: 'snowflake', r: 0.64, speed: -0.6, at: 0.25 },
    { key: 'diamonds', r: 1.16, speed: 0.3, at: 0.5, alt: true },
    { key: 'runes', r: 0.42, speed: 1, at: 0.75 },
  ],
  // школы заклинаний с боссов (src/magic/)
  star: [
    { key: 'ticks', r: 1, speed: 0.25, at: 0 },
    { key: 'rays', r: 0.8, speed: -0.35, at: 0.25, alt: true },
    { key: 'pentagram', r: 0.62, speed: 0.6, at: 0.5 },
    { key: 'dots', r: 1.18, speed: -0.25, at: 0.75, alt: true },
    { key: 'runes', r: 0.36, speed: 1.2, at: 0.75 },
  ],
  void: [
    { key: 'ticks', r: 1, speed: -0.3, at: 0 },
    { key: 'spiral', r: 0.82, speed: 0.9, at: 0.25, alt: true },
    { key: 'runes', r: 0.6, speed: -0.6, at: 0.5 },
    { key: 'eye', r: 0.34, speed: 0.2, at: 0.75, alt: true },
    { key: 'dots', r: 1.18, speed: 0.3, at: 0.75 },
  ],
  earth: [
    { key: 'ticks', r: 1, speed: 0.15, at: 0 },
    { key: 'cracks', r: 0.8, speed: 0, at: 0, alt: true },
    { key: 'stones', r: 1.16, speed: -0.2, at: 0.25 },
    { key: 'hexagon', r: 0.55, speed: 0.35, at: 0.5, alt: true },
    { key: 'leaves', r: 0.36, speed: -0.6, at: 0.75 },
  ],
  arcane: [
    { key: 'ticks', r: 1, speed: 0.4, at: 0 },
    { key: 'blades', r: 1.18, speed: -0.5, at: 0.25, alt: true },
    { key: 'pentagram', r: 0.7, speed: 0.7, at: 0.25 },
    { key: 'square', r: 0.45, speed: -1, at: 0.5, rot: Math.PI / 4, alt: true },
    { key: 'runes', r: 0.86, speed: 0.5, at: 0.75 },
  ],
  // ауры (src/auras.ts): тусклый круг под героем — слои ступеней 0–1, вспышка раскрывает все
  pact: [
    { key: 'ticks', r: 1, speed: 0.2, at: 0 },
    { key: 'hexagram', r: 0.7, speed: -0.3, at: 0.25, alt: true },
    { key: 'runes', r: 0.5, speed: 0.6, at: 0.5 },
    { key: 'dots', r: 1.16, speed: -0.2, at: 0.75, alt: true },
  ],
  bastion: [
    { key: 'ticks', r: 1, speed: 0.15, at: 0 },
    { key: 'square', r: 0.75, speed: -0.25, at: 0.25, alt: true },
    { key: 'square', r: 0.75, speed: 0.25, at: 0.25, rot: Math.PI / 4 },
    { key: 'hexagon', r: 0.45, speed: 0.5, at: 0.5, alt: true },
    { key: 'diamonds', r: 1.16, speed: -0.2, at: 0.75 },
  ],
  rage: [
    { key: 'ticks', r: 1, speed: -0.4, at: 0 },
    { key: 'flames', r: 1.16, speed: 0.5, at: 0.25, alt: true },
    { key: 'triangle', r: 0.6, speed: 0.8, at: 0.5 },
    { key: 'runes', r: 0.42, speed: -1, at: 0.75, alt: true },
  ],
  clarity: [
    { key: 'ticks', r: 1, speed: 0.3, at: 0 },
    { key: 'runes', r: 0.75, speed: -0.5, at: 0.25, alt: true },
    { key: 'hexagram', r: 0.5, speed: 0.7, at: 0.5 },
    { key: 'dots', r: 1.16, speed: -0.3, at: 0.75, alt: true },
  ],
  thorns: [
    { key: 'thorns', r: 1, speed: 0.15, at: 0 },
    { key: 'leaves', r: 0.8, speed: -0.25, at: 0.25, alt: true },
    { key: 'square', r: 0.55, speed: 0.4, at: 0.5, rot: Math.PI / 4 },
    { key: 'diamonds', r: 1.16, speed: -0.2, at: 0.75, alt: true },
  ],
  heal: [
    { key: 'ticks', r: 1, speed: 0.25, at: 0 },
    { key: 'flower', r: 0.62, speed: 0.3, at: 0.25, alt: true },
    { key: 'square', r: 0.82, speed: -0.4, at: 0.25 },
    { key: 'square', r: 0.82, speed: 0.4, at: 0.5, rot: Math.PI / 4, alt: true },
    { key: 'leaves', r: 1.16, speed: -0.25, at: 0.5 },
    { key: 'runes', r: 0.4, speed: 0.8, at: 0.75, alt: true },
  ],
};

interface Item { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; layer: Layer; t: number }

export class Sigil {
  readonly group = new THREE.Group();
  private readonly items: Item[] = [];
  private readonly glyphs: THREE.Sprite[] = [];
  private readonly wall: THREE.Mesh;
  private readonly wallMat: THREE.MeshBasicMaterial;
  private stageN = -1;
  private time = 0;
  private fade = 1;

  /** R — радиус круга, м; a, b — два цвета слоёв (ярче единицы — светятся) */
  constructor(school: SigilSchool, private readonly R: number, a: THREE.Color, b: THREE.Color, glow = 0.4) {
    STYLE[school].forEach((layer, i) => {
      const mat = additive(layerTex(layer.key), (layer.alt ? b : a).clone().multiplyScalar(glow), 0);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * layer.r, 2 * layer.r), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = layer.rot ?? 0;
      mesh.position.y = 0.05 + i * 0.006;
      mesh.renderOrder = 2;
      mesh.visible = false;
      this.group.add(mesh);
      this.items.push({ mesh, mat, layer, t: -1 });
    });
    // символы по кругу на высоте — с третьей ступени
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Sprite(additiveSprite(glyphSprite(i % 6), (i % 2 ? a : b).clone().multiplyScalar(glow * 1.4), 0));
      s.scale.setScalar(0.32);
      s.visible = false;
      this.group.add(s);
      this.glyphs.push(s);
    }
    // стена света по краю — с четвёртой
    this.wallMat = additive(wallTex(), a.clone().multiplyScalar(glow * 0.5), 0);
    this.wall = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 1, 1.5, 48, 1, true), this.wallMat);
    this.wall.position.y = 0.75;
    this.wall.visible = false;
    this.group.add(this.wall);
    this.group.scale.setScalar(R);
  }

  /** Ступень, до которой раскрылся круг (−1 — ещё ничего) */
  get stage(): number { return this.stageN; }

  /**
   * k — заряд 0..1. Возвращает номер новой ступени, если она только что раскрылась, иначе −1
   */
  update(dt: number, k: number, full = false): number {
    this.time += dt;
    let opened = -1;
    const st = Math.min(3, Math.floor(k * 4 + 1e-6));
    if (st > this.stageN) { this.stageN = st; opened = st; }
    const breathe = full ? 1 + Math.sin(this.time * 14) * 0.18 : 1;
    for (const it of this.items) {
      const L = it.layer;
      if (it.t < 0 && L.at * 4 <= this.stageN) { it.t = 0; it.mesh.visible = true; }
      if (it.t < 0) continue;
      it.t += dt;
      // «щелчок»: выскочил крупнее и ярче, сел на место
      const e = Math.min(1, it.t / 0.28), pop = 1 + 0.45 * (1 - e) * (1 - e);
      it.mesh.scale.setScalar(pop * (1 + k * 0.08));
      it.mesh.rotation.z += dt * L.speed * (1 + k * 1.5);
      it.mat.opacity = this.fade * Math.min(1, it.t * 5) * (0.55 + 0.45 * k + (1 - e) * 0.8) * breathe;
    }
    const gOn = this.stageN >= 2;
    this.glyphs.forEach((s, i) => {
      s.visible = gOn;
      if (!gOn) return;
      const a = (i / this.glyphs.length) * Math.PI * 2 + this.time * (0.8 + k);
      const r = 0.82 + Math.sin(this.time * 3 + i) * 0.03;
      s.position.set(Math.cos(a) * r, (0.25 + Math.sin(this.time * 2.5 + i * 1.7) * 0.08) / this.R * 2, Math.sin(a) * r);
      s.scale.setScalar(0.32 / this.R * 2);
      s.material.opacity = Math.min(1, s.material.opacity + dt * 3) * this.fade * breathe;
    });
    this.wall.visible = this.stageN >= 3;
    if (this.wall.visible) {
      this.wallMat.opacity = Math.min(0.8, this.wallMat.opacity + dt * 3) * this.fade;
      this.wall.scale.set(1, (0.6 + k * 0.6) / this.R * 2, 1);
      this.wall.position.y = this.wall.scale.y * 0.75;
      this.wall.rotation.y += dt;
    }
    return opened;
  }

  /** Каст: круг вспыхивает, расходится и тает; уходит под управление FX */
  burst(fx: FX, dur = 0.45): void {
    const g = this.group, s0 = g.scale.x;
    const mats = [...this.items.map((i) => i.mat), ...this.glyphs.map((s) => s.material), this.wallMat];
    const base = mats.map((m) => m.opacity);
    fx.custom(g, dur, (t) => {
      g.scale.setScalar(s0 * (1 + t * 0.5));
      mats.forEach((m, i) => { m.opacity = base[i] * (1 + 1.5 * (1 - t)) * (1 - t) ** 1.5; });
    }, () => this.dispose());
  }

  /** Плавно погасить на месте (за fadeOut секунд через update) */
  setFade(v: number): void { this.fade = v; }

  dispose(): void {
    this.group.parent?.remove(this.group);
    for (const it of this.items) { it.mesh.geometry.dispose(); it.mat.dispose(); }
    for (const s of this.glyphs) s.material.dispose();
    this.wall.geometry.dispose(); this.wallMat.dispose();
  }
}
