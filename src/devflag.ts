/**
 * Modes: the playground is the main scene, the level editor is ?dev=editor (F10 in the playground).
 * In a build for players the editor can be turned off: VITE_DEV_TOOLS=off npm run build
 */
export const DEV_TOOLS: boolean = import.meta.env.VITE_DEV_TOOLS !== 'off';

export function wantsEditor(): boolean {
  return DEV_TOOLS && new URLSearchParams(window.location.search).get('dev') === 'editor';
}

/** Straight into the game, past the main menu: a map (?map=…) or the playground (?dev=playground) is open */
export function wantsGame(): boolean {
  const q = new URLSearchParams(window.location.search);
  return q.has('map') || q.get('dev') === 'playground';
}

/** Came into battle from the main menu (?from=menu): pause on Esc, "To camp", no debug hints */
export function fromMenu(): boolean {
  return new URLSearchParams(window.location.search).get('from') === 'menu';
}

export function openEditor(): void {
  const u = new URL(window.location.href);
  u.searchParams.set('dev', 'editor');
  window.location.href = u.toString();
}
