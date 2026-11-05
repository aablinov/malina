import { NetClient } from '../net/client.ts';
import type { RoomInfo } from '../net/protocol.ts';

/**
 * The party the camp assembles (wiki/design-main-menu.md): mode, map, player count.
 * Solo play starts at once; online — through a server room (src/net/client.ts): the room's player count
 * goes to `td.setPlayers` (src/td/scaling.ts).
 */
export type GameMode = 'solo' | 'online';

export interface GameSession {
  mode: GameMode;
  /** Bush Defence map (src/menu/campaign.ts) */
  map: string;
  /** Players in the party: 1 in solo */
  players: number;
}

/** Online session in the lobby list — a server room (src/net/protocol.ts) */
export type OnlineLobby = RoomInfo;

/** Network layer: `available` — the server answered, `list()` — open rooms (src/net/client.ts) */
export const NET = new NetClient();

/** Battle address: map and the "from menu" mark — the game shows pause on Esc and the "To camp" button */
export function battleUrl(s: GameSession): string {
  const u = new URL(window.location.href);
  u.search = '';
  u.searchParams.set('map', s.map);
  u.searchParams.set('from', 'menu');
  if (s.players > 1) u.searchParams.set('players', String(s.players));
  return u.toString();
}

/** Online battle address: map, players, room code (the battle page joins it again) */
export function netBattleUrl(map: string, players: number, code: string): string {
  const u = new URL(battleUrl({ mode: 'online', map, players }));
  u.searchParams.set('room', code);
  return u.toString();
}

/** Menu address: the page without parameters; lobby — straight to the camp instead of the start screen */
export function menuUrl(lobby = true): string {
  const u = new URL(window.location.href);
  u.search = '';
  if (lobby) u.searchParams.set('menu', 'lobby');
  return u.toString();
}

// ---------- What the menu remembers ----------
const MENU_KEY = 'malina.menu';
export interface MenuState { map: string; mode: GameMode; /** Maps won */ won: string[] }

export function loadMenuState(): MenuState {
  const d: MenuState = { map: 'td', mode: 'solo', won: [] };
  try {
    const raw = localStorage.getItem(MENU_KEY);
    if (raw) return { ...d, ...(JSON.parse(raw) as Partial<MenuState>) };
  } catch { /* closed storage */ }
  return d;
}

export function saveMenuState(s: MenuState): void {
  try { localStorage.setItem(MENU_KEY, JSON.stringify(s)); } catch { /* closed storage */ }
}

/** Map won — a mark on its card in the camp */
export function markWon(map: string): void {
  const s = loadMenuState();
  if (!s.won.includes(map)) { s.won.push(map); saveMenuState(s); }
}

// ---------- The hero's raspberries for the duration of a battle ----------
// Bush Defence counts its treasury in the profile's raspberries and puts them into the map treasury at start (src/td/td.ts).
// The raspberries the hero has gathered are set aside here and returned in the camp — the battle does not eat them.
const STASH_KEY = 'malina.stash';

/** Set the hero's raspberries aside before a battle (once per battle: a battle reload does not overwrite) */
export function stashBerries(berries: number): void {
  try { if (sessionStorage.getItem(STASH_KEY) === null) sessionStorage.setItem(STASH_KEY, String(berries)); } catch { /* closed storage */ }
}

// the hero's gear too: what was bought from the defence sutler serves only in this battle (wiki/design-tower-defence.md, section 12)
const GEAR_KEY = 'malina.stash.gear';

/** The hero's gear before the battle: items, what is equipped, arrows */
export interface GearStash { items: unknown[]; equip: unknown; arrows: number }

/** Set the hero's gear aside before a battle (once per battle, like the raspberries) */
export function stashGear(g: GearStash): void {
  try { if (sessionStorage.getItem(GEAR_KEY) === null) sessionStorage.setItem(GEAR_KEY, JSON.stringify(g)); } catch { /* closed storage */ }
}

/** Take the gear that was set aside; null — nothing was set aside */
export function takeGear(): GearStash | null {
  try {
    const raw = sessionStorage.getItem(GEAR_KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(GEAR_KEY);
    const g = JSON.parse(raw) as GearStash;
    return Array.isArray(g?.items) && g.equip ? g : null;
  } catch { return null; }
}

/** Take the raspberries that were set aside; null — nothing was set aside */
export function takeStash(): number | null {
  try {
    const raw = sessionStorage.getItem(STASH_KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(STASH_KEY);
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}
