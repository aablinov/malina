import { NetClient } from '../net/client.ts';
import { VoiceChat } from '../net/voice.ts';
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

/** Room voice chat (src/net/voice.ts): key T in the camp and in battle — one's microphone on / off */
export const VOICE = new VoiceChat(NET);

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

