/**
 * Настройки игры (wiki/design-main-menu.md): меню меняет, игра читает при запуске.
 * Хранятся в localStorage `malina.settings`; закрытое хранилище — значения по умолчанию.
 */
export interface Settings {
  /** Общая громкость 0..1 */
  volume: number;
  /** Громкость музыки 0..1 (поверх общей) */
  music: number;
  /** Постобработка: bloom, AO, цветокоррекция */
  postFX: boolean;
  /** Тени от солнца */
  shadows: boolean;
  /** Качество картинки: high — плотность пикселей до 1,5, low — 1 */
  quality: 'high' | 'low';
  /** Подсказка по управлению в начале боя */
  help: boolean;
}

const KEY = 'malina.settings';
export const DEFAULT_SETTINGS: Settings = { volume: 1, music: 1, postFX: true, shadows: true, quality: 'high', help: true };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch { /* закрытое хранилище или битый JSON */ }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* закрытое хранилище */ }
}

/** Плотность пикселей рендера по качеству */
export const pixelRatio = (s: Settings): number => Math.min(window.devicePixelRatio, s.quality === 'low' ? 1 : 1.5);
