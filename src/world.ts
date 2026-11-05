import * as THREE from 'three';
import type { Level } from './level/level.ts';
import { t } from './i18n/i18n.ts';

/**
 * Map world settings: sun, sky and global illumination, haze, weather, post-processing.
 * Stored in the map (meta.world), edited in the editor (the "World settings" panel), applied in the game (Lighting.applyWorld, Weather).
 * Empty fields are the defaults (day "as in Unreal", src/lighting.ts).
 */

export type WeatherKind = 'clear' | 'rain' | 'storm' | 'snow' | 'leaves' | 'embers' | 'fireflies';
export const WEATHER_TITLES: Record<WeatherKind, string> = {
  clear: t('Clear'), rain: t('Rain'), storm: t('Storm'), snow: t('Snow'), leaves: t('Falling leaves'), embers: t('Embers and ash'), fireflies: t('Fireflies'),
};

export interface WorldSettings {
  sun: { color: string; intensity: number; /** Elevation above the horizon, ° */ elevation: number; /** Azimuth, ° (0 — from +X, 90 — from +Z) */ azimuth: number; shadows: boolean };
  /** Sky and global illumination: background, hemisphere light (sky from above, ground bounce from below), fill */
  sky: { color: string; hemiSky: string; hemiGround: string; hemi: number; ambient: number };
  fog: { enabled: boolean; color: string; /** Haze start and end, m from the game camera (24 m to the hero); in the editor scaled by the camera distance */ near: number; far: number };
  weather: { kind: WeatherKind; /** 0..1 */ intensity: number; /** Wind, m/s along +X */ wind: number };
  post: {
    enabled: boolean; exposure: number;
    bloom: number; bloomRadius: number; bloomThreshold: number;
    ao: number; aoRadius: number;
    saturation: number; contrast: number; vignette: number;
    /** Tint of shadows and highlights (added to RGB) */
    shadowTint: string; highTint: string; tintAmount: number;
  };
}

export const WORLD_DEFAULTS: WorldSettings = {
  sun: { color: '#ffdcae', intensity: 2.2, elevation: 48, azimuth: 149, shadows: true },
  sky: { color: '#9ed6f0', hemiSky: '#bfe4ff', hemiGround: '#d8c49a', hemi: 2.0, ambient: 0.2 },
  fog: { enabled: true, color: '#d6ecf4', near: 22, far: 100 },
  weather: { kind: 'clear', intensity: 0.6, wind: 1.5 },
  post: {
    enabled: true, exposure: 1.02,
    bloom: 0.42, bloomRadius: 0.4, bloomThreshold: 0.85,
    ao: 0.85, aoRadius: 0.55,
    saturation: 1.0, contrast: 0.98, vignette: 0.12,
    shadowTint: '#4a8fd6', highTint: '#d6b07a', tintAmount: 0.06,
  },
};

/** Ready-made sets for a quick start */
export const WORLD_PRESETS: Record<string, { title: string; patch: DeepPartial<WorldSettings> }> = {
  day: { title: t('Day'), patch: {} },
  morning: { title: t('Morning'), patch: { sun: { color: '#ffc58f', intensity: 1.8, elevation: 18, azimuth: 70 }, sky: { color: '#f3c9a8', hemiSky: '#ffd9c0', hemiGround: '#a89070', hemi: 1.6 }, fog: { color: '#f4d8c4', near: 14, far: 80 } } },
  evening: { title: t('Sunset'), patch: { sun: { color: '#ff9a5a', intensity: 1.9, elevation: 10, azimuth: 250 }, sky: { color: '#e88e6a', hemiSky: '#ffb08a', hemiGround: '#6a4a5a', hemi: 1.4 }, fog: { color: '#e9a184', near: 16, far: 90 }, post: { bloom: 0.6 } } },
  night: { title: t('Night'), patch: { sun: { color: '#8fb4ff', intensity: 0.6, elevation: 40, azimuth: 200 }, sky: { color: '#0e2a44', hemiSky: '#5f8ed6', hemiGround: '#1d3a3a', hemi: 0.85, ambient: 0.1 }, fog: { color: '#1b3c5c' }, post: { bloom: 0.75, exposure: 1.1 } } },
  overcast: { title: t('Overcast'), patch: { sun: { color: '#dfe6ee', intensity: 0.9, elevation: 60 }, sky: { color: '#9aa7b2', hemiSky: '#c7d2dc', hemiGround: '#8a8a7a', hemi: 2.4 }, fog: { color: '#aab6bf', near: 12, far: 70 }, weather: { kind: 'rain', intensity: 0.5 }, post: { saturation: 0.85 } } },
  winter: { title: t('Winter'), patch: { sun: { color: '#e8eef8', intensity: 1.5, elevation: 24, azimuth: 160 }, sky: { color: '#c9d6e2', hemiSky: '#dbe6f2', hemiGround: '#b8c4cc', hemi: 2.2, ambient: 0.22 }, fog: { color: '#d5dfe8', near: 14, far: 70 }, weather: { kind: 'snow', intensity: 0.5, wind: 1.2 }, post: { saturation: 0.9, shadowTint: '#5a8fd0', tintAmount: 0.08 } } },
  // jungle with crystals (reference 16): a warm sun through a greenish haze, turquoise sky, saturation slightly higher
  jungle: { title: t('Jungle'), patch: { sun: { color: '#ffe2b0', intensity: 2.0, elevation: 52, azimuth: 140 }, sky: { color: '#7fd0c8', hemiSky: '#a8e6d8', hemiGround: '#5a7a4a', hemi: 2.1, ambient: 0.22 }, fog: { color: '#b8dcc0', near: 18, far: 85 }, weather: { kind: 'clear' }, post: { saturation: 1.12, bloom: 0.5, shadowTint: '#2f8a80', tintAmount: 0.07 } } },
  dungeon: { title: t('Dungeon'), patch: { sun: { color: '#6a7aa0', intensity: 0.25, shadows: false }, sky: { color: '#0b0c12', hemiSky: '#2a3348', hemiGround: '#1a1410', hemi: 0.5, ambient: 0.05 }, fog: { color: '#0b0c12', near: 10, far: 45 }, weather: { kind: 'embers', intensity: 0.3 }, post: { bloom: 0.9, vignette: 0.35 } } },
};

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

/** Merge partial settings over full ones (by section) */
export function mergeWorld(base: WorldSettings, patch: DeepPartial<WorldSettings> | undefined): WorldSettings {
  const out = clone(base);
  if (!patch) return out;
  for (const k of Object.keys(out) as (keyof WorldSettings)[]) Object.assign(out[k], patch[k] ?? {});
  return out;
}

/** Map world settings (default — day) */
export function worldOf(L: Level): WorldSettings {
  return mergeWorld(WORLD_DEFAULTS, L.meta.world as DeepPartial<WorldSettings> | undefined);
}

/** Write the settings into the map — only differences from the defaults */
export function setWorld(L: Level, ws: WorldSettings): void {
  const diff: Record<string, Record<string, unknown>> = {};
  for (const k of Object.keys(ws) as (keyof WorldSettings)[]) {
    const d = WORLD_DEFAULTS[k] as unknown as Record<string, unknown>, v = ws[k] as unknown as Record<string, unknown>;
    for (const f of Object.keys(v)) if (JSON.stringify(v[f]) !== JSON.stringify(d[f])) (diff[k] ??= {})[f] = v[f];
  }
  if (Object.keys(diff).length) L.meta.world = diff; else delete L.meta.world;
}

/** Where the sun shines from relative to the point of interest */
export function sunOffset(ws: WorldSettings, dist = 35, out = new THREE.Vector3()): THREE.Vector3 {
  const e = THREE.MathUtils.degToRad(ws.sun.elevation), a = THREE.MathUtils.degToRad(ws.sun.azimuth);
  return out.set(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)).multiplyScalar(dist);
}

/** Tint colour → RGB offset (−0.5..0.5 from grey) × strength */
export function tintVec(hex: string, amount: number, out = new THREE.Vector3()): THREE.Vector3 {
  // screen colours, no conversion to linear: the tint is applied after OutputPass
  const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const l = (r + g + b) / 3;
  return out.set(r - l, g - l, b - l).multiplyScalar(amount * 2);
}

/**
 * A placed light source is a map entity (entities, kind 'light'). A point light shines in all directions,
 * a spotlight — in a cone down along its rotation (yaw and pitch in degrees).
 */
export interface LightData { type: 'point' | 'spot'; color: string; intensity: number; distance: number; angle: number; pitch: number; shadows: boolean; name?: string }
export const LIGHT_DEFAULTS: LightData = { type: 'point', color: '#ffc870', intensity: 6, distance: 8, angle: 35, pitch: -90, shadows: false };
export const lightData = (d: Record<string, unknown> | undefined): LightData => ({ ...LIGHT_DEFAULTS, ...(d as Partial<LightData> | undefined) });

/** The entity's light in three: a point light or a spotlight (the spotlight's target is the child target) */
export function makeLight(d: LightData): THREE.PointLight | THREE.SpotLight {
  if (d.type === 'spot') {
    const s = new THREE.SpotLight(d.color, d.intensity, d.distance, THREE.MathUtils.degToRad(d.angle), 0.35, 1.2);
    s.add(s.target);
    return s;
  }
  return new THREE.PointLight(d.color, d.intensity, d.distance, 1.2);
}

/** Aim the spotlight: yaw (the entity's rot, °) and pitch (°, −90 is down) */
export function aimLight(l: THREE.Light, yaw: number, pitch: number): void {
  if (!(l as THREE.SpotLight).isSpotLight) return;
  const y = THREE.MathUtils.degToRad(yaw), p = THREE.MathUtils.degToRad(pitch);
  (l as THREE.SpotLight).target.position.set(Math.cos(p) * Math.cos(y), Math.sin(p), Math.cos(p) * Math.sin(y));
}
