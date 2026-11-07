import ru from './ru.ts';

/**
 * Interface language. Chosen once in the main menu (the first screen asks), stored in localStorage
 * `malina.lang`; a direct game URL without a stored choice follows the browser language. Switching
 * reloads the page: strings are resolved when modules load, so one page runs in one language.
 * Source strings are English; `t()` looks them up in the Russian dictionary (src/i18n/ru.ts).
 * Works without DOM (Node, headless battle): no storage → English.
 */
export type Lang = 'en' | 'ru';
export const LANG_KEY = 'malina.lang';
export const LANGS: readonly Lang[] = ['en', 'ru'];

const g = globalThis as { localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void }; navigator?: { language?: string } };

/** Stored choice, or null when the player has not chosen yet */
export function storedLang(): Lang | null {
  try { const v = g.localStorage?.getItem(LANG_KEY); return v === 'ru' || v === 'en' ? v : null; } catch { return null; }
}

function detect(): Lang {
  const s = storedLang();
  if (s) return s;
  try { if (g.navigator?.language?.toLowerCase().startsWith('ru')) return 'ru'; } catch { /* no navigator */ }
  return 'en';
}

/** Language of this page load */
export const LANG: Lang = detect();

/** Remember the choice; the caller reloads the page */
export function setLang(l: Lang): void {
  try { g.localStorage?.setItem(LANG_KEY, l); } catch { /* storage closed */ }
}

/**
 * Translate an English source string; `{name}` placeholders are filled from `params`.
 * Unknown strings fall back to the English source.
 */
export function t(s: string, params?: Record<string, string | number>): string {
  let r = LANG === 'ru' ? (ru[s] ?? s) : s;
  if (params) for (const k of Object.keys(params)) r = r.split(`{${k}}`).join(String(params[k]));
  return r;
}

/** Russian → English source key for a stored string (e.g. a map name saved while the page ran in Russian); unknown strings pass through */
let back: Map<string, string> | null = null;
export function untranslate(s: string): string {
  back ??= new Map(Object.entries(ru).map(([k, v]) => [v, k]));
  return back.get(s) ?? s;
}
