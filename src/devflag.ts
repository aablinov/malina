/**
 * Режимы: плейграунд — основная сцена, редактор уровней — ?dev=editor (F10 в плейграунде).
 * В сборке для игроков редактор можно выключить: VITE_DEV_TOOLS=off npm run build
 */
export const DEV_TOOLS: boolean = import.meta.env.VITE_DEV_TOOLS !== 'off';

export function wantsEditor(): boolean {
  return DEV_TOOLS && new URLSearchParams(window.location.search).get('dev') === 'editor';
}

export function openEditor(): void {
  const u = new URL(window.location.href);
  u.searchParams.set('dev', 'editor');
  window.location.href = u.toString();
}
