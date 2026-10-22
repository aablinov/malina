/**
 * Инструменты разработчика (плейграунд по ?dev=playground и F9 в меню).
 * В сборке для игроков их можно выключить: VITE_DEV_TOOLS=off npm run build
 */
export const DEV_TOOLS: boolean = import.meta.env.VITE_DEV_TOOLS !== 'off';

/** Сборка только плейграунда (для публикации отдельной страницей): VITE_PLAYGROUND=only */
const PLAYGROUND_ONLY: boolean = import.meta.env.VITE_PLAYGROUND === 'only';

export function wantsPlayground(): boolean {
  if (PLAYGROUND_ONLY) return true;
  return DEV_TOOLS && new URLSearchParams(window.location.search).get('dev') === 'playground';
}

/** Редактор уровней: ?dev=editor (или F10 в меню) */
export function wantsEditor(): boolean {
  return DEV_TOOLS && !PLAYGROUND_ONLY && new URLSearchParams(window.location.search).get('dev') === 'editor';
}

export function openEditor(): void {
  const u = new URL(window.location.href);
  u.searchParams.set('dev', 'editor');
  window.location.href = u.toString();
}

export function openPlayground(): void {
  const u = new URL(window.location.href);
  u.searchParams.set('dev', 'playground');
  window.location.href = u.toString();
}
