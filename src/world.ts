import * as THREE from 'three';
import type { Level } from './level/level.ts';

/**
 * Настройки мира карты: солнце, небо и глобальное освещение, дымка, погода, постобработка.
 * Хранятся в карте (meta.world), правятся в редакторе (панель «Настройки мира»), применяются в игре (Lighting.applyWorld, Weather).
 * Пустые поля — значения по умолчанию (день «как в Unreal», src/lighting.ts).
 */

export type WeatherKind = 'clear' | 'rain' | 'storm' | 'snow' | 'leaves' | 'embers';
export const WEATHER_TITLES: Record<WeatherKind, string> = {
  clear: 'Ясно', rain: 'Дождь', storm: 'Гроза', snow: 'Снег', leaves: 'Листопад', embers: 'Искры и пепел',
};

export interface WorldSettings {
  sun: { color: string; intensity: number; /** Высота над горизонтом, ° */ elevation: number; /** Азимут, ° (0 — с +X, 90 — с +Z) */ azimuth: number; shadows: boolean };
  /** Небо и глобальное освещение: фон, полусферический свет (небо сверху, отражённый от земли снизу), заполняющий */
  sky: { color: string; hemiSky: string; hemiGround: string; hemi: number; ambient: number };
  fog: { enabled: boolean; color: string; /** Начало и конец дымки, м от камеры игры (24 м до героя); в редакторе масштабируется по дальности камеры */ near: number; far: number };
  weather: { kind: WeatherKind; /** 0..1 */ intensity: number; /** Ветер, м/с вдоль +X */ wind: number };
  post: {
    enabled: boolean; exposure: number;
    bloom: number; bloomRadius: number; bloomThreshold: number;
    ao: number; aoRadius: number;
    saturation: number; contrast: number; vignette: number;
    /** Тон теней и светлого (добавка к RGB) */
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

/** Готовые наборы для быстрого старта */
export const WORLD_PRESETS: Record<string, { title: string; patch: DeepPartial<WorldSettings> }> = {
  day: { title: 'День', patch: {} },
  morning: { title: 'Утро', patch: { sun: { color: '#ffc58f', intensity: 1.8, elevation: 18, azimuth: 70 }, sky: { color: '#f3c9a8', hemiSky: '#ffd9c0', hemiGround: '#a89070', hemi: 1.6 }, fog: { color: '#f4d8c4', near: 14, far: 80 } } },
  evening: { title: 'Закат', patch: { sun: { color: '#ff9a5a', intensity: 1.9, elevation: 10, azimuth: 250 }, sky: { color: '#e88e6a', hemiSky: '#ffb08a', hemiGround: '#6a4a5a', hemi: 1.4 }, fog: { color: '#e9a184', near: 16, far: 90 }, post: { bloom: 0.6 } } },
  night: { title: 'Ночь', patch: { sun: { color: '#8fb4ff', intensity: 0.6, elevation: 40, azimuth: 200 }, sky: { color: '#0e2a44', hemiSky: '#5f8ed6', hemiGround: '#1d3a3a', hemi: 0.85, ambient: 0.1 }, fog: { color: '#1b3c5c' }, post: { bloom: 0.75, exposure: 1.1 } } },
  overcast: { title: 'Пасмурно', patch: { sun: { color: '#dfe6ee', intensity: 0.9, elevation: 60 }, sky: { color: '#9aa7b2', hemiSky: '#c7d2dc', hemiGround: '#8a8a7a', hemi: 2.4 }, fog: { color: '#aab6bf', near: 12, far: 70 }, weather: { kind: 'rain', intensity: 0.5 }, post: { saturation: 0.85 } } },
  winter: { title: 'Зима', patch: { sun: { color: '#e8eef8', intensity: 1.5, elevation: 24, azimuth: 160 }, sky: { color: '#c9d6e2', hemiSky: '#dbe6f2', hemiGround: '#b8c4cc', hemi: 2.2, ambient: 0.22 }, fog: { color: '#d5dfe8', near: 14, far: 70 }, weather: { kind: 'snow', intensity: 0.5, wind: 1.2 }, post: { saturation: 0.9, shadowTint: '#5a8fd0', tintAmount: 0.08 } } },
  dungeon: { title: 'Подземелье', patch: { sun: { color: '#6a7aa0', intensity: 0.25, shadows: false }, sky: { color: '#0b0c12', hemiSky: '#2a3348', hemiGround: '#1a1410', hemi: 0.5, ambient: 0.05 }, fog: { color: '#0b0c12', near: 10, far: 45 }, weather: { kind: 'embers', intensity: 0.3 }, post: { bloom: 0.9, vignette: 0.35 } } },
};

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

/** Слить частичные настройки поверх полных (по разделам) */
export function mergeWorld(base: WorldSettings, patch: DeepPartial<WorldSettings> | undefined): WorldSettings {
  const out = clone(base);
  if (!patch) return out;
  for (const k of Object.keys(out) as (keyof WorldSettings)[]) Object.assign(out[k], patch[k] ?? {});
  return out;
}

/** Настройки мира карты (по умолчанию — день) */
export function worldOf(L: Level): WorldSettings {
  return mergeWorld(WORLD_DEFAULTS, L.meta.world as DeepPartial<WorldSettings> | undefined);
}

/** Записать настройки в карту — только отличия от значений по умолчанию */
export function setWorld(L: Level, ws: WorldSettings): void {
  const diff: Record<string, Record<string, unknown>> = {};
  for (const k of Object.keys(ws) as (keyof WorldSettings)[]) {
    const d = WORLD_DEFAULTS[k] as unknown as Record<string, unknown>, v = ws[k] as unknown as Record<string, unknown>;
    for (const f of Object.keys(v)) if (JSON.stringify(v[f]) !== JSON.stringify(d[f])) (diff[k] ??= {})[f] = v[f];
  }
  if (Object.keys(diff).length) L.meta.world = diff; else delete L.meta.world;
}

/** Откуда светит солнце относительно точки интереса */
export function sunOffset(ws: WorldSettings, dist = 35, out = new THREE.Vector3()): THREE.Vector3 {
  const e = THREE.MathUtils.degToRad(ws.sun.elevation), a = THREE.MathUtils.degToRad(ws.sun.azimuth);
  return out.set(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)).multiplyScalar(dist);
}

/** Цвет тонировки → добавка к RGB (−0.5..0.5 от серого) × сила */
export function tintVec(hex: string, amount: number, out = new THREE.Vector3()): THREE.Vector3 {
  // экранные цвета, без перевода в линейные: тонировка идёт после OutputPass
  const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const l = (r + g + b) / 3;
  return out.set(r - l, g - l, b - l).multiplyScalar(amount * 2);
}

/**
 * Поставленный источник света — сущность карты (entities, kind 'light'). Точечный светит во все стороны,
 * прожектор — конусом вниз по своему повороту (рыск и наклон в градусах).
 */
export interface LightData { type: 'point' | 'spot'; color: string; intensity: number; distance: number; angle: number; pitch: number; shadows: boolean; name?: string }
export const LIGHT_DEFAULTS: LightData = { type: 'point', color: '#ffc870', intensity: 6, distance: 8, angle: 35, pitch: -90, shadows: false };
export const lightData = (d: Record<string, unknown> | undefined): LightData => ({ ...LIGHT_DEFAULTS, ...(d as Partial<LightData> | undefined) });

/** Свет сущности в three: точечный или прожектор (у прожектора цель — child target) */
export function makeLight(d: LightData): THREE.PointLight | THREE.SpotLight {
  if (d.type === 'spot') {
    const s = new THREE.SpotLight(d.color, d.intensity, d.distance, THREE.MathUtils.degToRad(d.angle), 0.35, 1.2);
    s.add(s.target);
    return s;
  }
  return new THREE.PointLight(d.color, d.intensity, d.distance, 1.2);
}

/** Направить прожектор: рыск (rot сущности, °) и наклон (pitch, ° — −90 вниз) */
export function aimLight(l: THREE.Light, yaw: number, pitch: number): void {
  if (!(l as THREE.SpotLight).isSpotLight) return;
  const y = THREE.MathUtils.degToRad(yaw), p = THREE.MathUtils.degToRad(pitch);
  (l as THREE.SpotLight).target.position.set(Math.cos(p) * Math.cos(y), Math.sin(p), Math.cos(p) * Math.sin(y));
}
