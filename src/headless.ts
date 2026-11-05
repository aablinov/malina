import * as THREE from 'three';
import type { FX } from './fx.ts';

/**
 * Headless mode (wiki/design-multiplayer.md): the same hero, gear and mob classes run on the server without rendering —
 * three in Node builds groups and meshes without a DOM, and the texture canvas and `FX` are replaced by stubs.
 */
export const hasDom = typeof document !== 'undefined';

/** Canvas: real in the browser, in Node — a dummy whose every context call does nothing */
export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  if (hasDom) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  const ctx = new Proxy({}, { get: (_t, p) => (p === 'canvas' ? stub : typeof p === 'string' && /^(fillStyle|strokeStyle|lineWidth|font|textAlign|textBaseline|globalAlpha|lineJoin|lineCap|imageSmoothingEnabled)$/.test(p) ? undefined : () => ctx), set: () => true }) as unknown as CanvasRenderingContext2D;
  const stub = { width: w, height: h, getContext: () => ctx, toDataURL: () => '', style: {} } as unknown as HTMLCanvasElement;
  return stub;
}

interface Timed { t: number; dur: number; tick: (k: number) => void; end?: () => void }

/**
 * `FX` without a scene: sparks, flashes and numbers go nowhere, but temporary bodies (`custom`) and ribbons (`streak`) run on time,
 * because their callbacks carry game damage (fireworks, spell meteors); `update(dt)` drives them
 */
export function nullFx(): FX {
  const timed: Timed[] = [];
  const state = {
    shake: 0, hitstop: 0, slowmo: 0, zoom: 0,
    custom: (_o: unknown, dur: number, tick: (k: number) => void, dispose?: () => void) => { timed.push({ t: 0, dur, tick, end: dispose }); },
    streak: (o: { dur: number; path: (k: number, out: THREE.Vector3) => THREE.Vector3; onHead?: (p: THREE.Vector3, k: number) => void; onEnd?: (p: THREE.Vector3) => void }) => {
      const p = new THREE.Vector3();
      timed.push({ t: 0, dur: o.dur, tick: (k) => { o.path(k, p); o.onHead?.(p, k); }, end: () => { o.path(1, p); o.onHead?.(p, 1); o.onEnd?.(p.clone()); } });
    },
    update: (dt: number) => {
      for (let i = timed.length - 1; i >= 0; i--) {
        const x = timed[i];
        x.t += dt;
        const k = x.t / x.dur;
        if (k >= 1) { timed.splice(i, 1); x.end?.(); continue; }
        x.tick(k);
      }
    },
    updateReal: () => {},
    light: () => new THREE.PointLight(),
    marker: () => new THREE.Mesh(),
  };
  return new Proxy(state, { get: (t, p) => (p in t ? (t as Record<PropertyKey, unknown>)[p] : () => undefined) }) as unknown as FX;
}
