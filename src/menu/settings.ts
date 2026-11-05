/**
 * Game settings (wiki/design-main-menu.md): the menu changes them, the game reads them at start.
 * Stored in localStorage `malina.settings`; a closed storage gives the defaults.
 */
export interface Settings {
  /** Master volume 0..1 */
  volume: number;
  /** Music volume 0..1 (on top of master) */
  music: number;
  /** Post-processing: bloom, AO, colour grading */
  postFX: boolean;
  /** Sun shadows */
  shadows: boolean;
  /** Picture quality: high — pixel density up to 1.5, low — 1 */
  quality: 'high' | 'low';
  /** Controls hint at the start of a battle */
  help: boolean;
}

const KEY = 'malina.settings';
export const DEFAULT_SETTINGS: Settings = { volume: 1, music: 1, postFX: true, shadows: true, quality: 'high', help: true };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch { /* closed storage or broken JSON */ }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* closed storage */ }
}

/** Render pixel density by quality */
export const pixelRatio = (s: Settings): number => Math.min(window.devicePixelRatio, s.quality === 'low' ? 1 : 1.5);
