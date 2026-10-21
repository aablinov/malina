/**
 * Инструменты разработчика (плейграунд по ?dev=playground и F9 в меню).
 * В сборке для игроков их можно выключить: VITE_DEV_TOOLS=off npm run build
 */
export const DEV_TOOLS: boolean = import.meta.env.VITE_DEV_TOOLS !== 'off';

export function wantsPlayground(): boolean {
  return DEV_TOOLS && new URLSearchParams(window.location.search).get('dev') === 'playground';
}

export function openPlayground(): void {
  const u = new URL(window.location.href);
  u.searchParams.set('dev', 'playground');
  window.location.href = u.toString();
}
