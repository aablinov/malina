/**
 * Режимы: плейграунд — основная сцена, редактор уровней — ?dev=editor (F10 в плейграунде).
 * В сборке для игроков редактор можно выключить: VITE_DEV_TOOLS=off npm run build
 */
export const DEV_TOOLS: boolean = import.meta.env.VITE_DEV_TOOLS !== 'off';

export function wantsEditor(): boolean {
  return DEV_TOOLS && new URLSearchParams(window.location.search).get('dev') === 'editor';
}

/** Сразу в игру, мимо главного меню: открыта карта (?map=…) или плейграунд (?dev=playground) */
export function wantsGame(): boolean {
  const q = new URLSearchParams(window.location.search);
  return q.has('map') || q.get('dev') === 'playground';
}

/** Пришли в бой из главного меню (?from=menu): пауза по Esc, «В лагерь», без отладочных подсказок */
export function fromMenu(): boolean {
  return new URLSearchParams(window.location.search).get('from') === 'menu';
}

export function openEditor(): void {
  const u = new URL(window.location.href);
  u.searchParams.set('dev', 'editor');
  window.location.href = u.toString();
}
