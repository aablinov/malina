import { NetClient } from '../net/client';
import type { RoomInfo } from '../net/protocol';

/**
 * Партия, которую собирает лагерь (wiki/design-main-menu.md): режим, карта, число игроков.
 * Одиночная игра запускается сразу; сетевая — через комнату сервера (src/net/client.ts): число игроков комнаты
 * уходит в `td.setPlayers` (src/td/scaling.ts).
 */
export type GameMode = 'solo' | 'online';

export interface GameSession {
  mode: GameMode;
  /** Карта обороны куста (src/menu/campaign.ts) */
  map: string;
  /** Игроков в партии: в одиночной — 1 */
  players: number;
}

/** Онлайн-сессия в списке лобби — комната сервера (src/net/protocol.ts) */
export type OnlineLobby = RoomInfo;

/** Сетевой слой: `available` — сервер ответил, `list()` — открытые комнаты (src/net/client.ts) */
export const NET = new NetClient();

/** Адрес боя: карта и метка «из меню» — игра покажет паузу по Esc и кнопку «В лагерь» */
export function battleUrl(s: GameSession): string {
  const u = new URL(window.location.href);
  u.search = '';
  u.searchParams.set('map', s.map);
  u.searchParams.set('from', 'menu');
  if (s.players > 1) u.searchParams.set('players', String(s.players));
  return u.toString();
}

/** Адрес меню: страница без параметров; lobby — сразу в лагерь, а не на стартовый экран */
export function menuUrl(lobby = true): string {
  const u = new URL(window.location.href);
  u.search = '';
  if (lobby) u.searchParams.set('menu', 'lobby');
  return u.toString();
}

// ---------- Что запоминает меню ----------
const MENU_KEY = 'malina.menu';
export interface MenuState { map: string; mode: GameMode; /** Пройденные карты */ won: string[] }

export function loadMenuState(): MenuState {
  const d: MenuState = { map: 'td', mode: 'solo', won: [] };
  try {
    const raw = localStorage.getItem(MENU_KEY);
    if (raw) return { ...d, ...(JSON.parse(raw) as Partial<MenuState>) };
  } catch { /* закрытое хранилище */ }
  return d;
}

export function saveMenuState(s: MenuState): void {
  try { localStorage.setItem(MENU_KEY, JSON.stringify(s)); } catch { /* закрытое хранилище */ }
}

/** Карта пройдена — отметка на карточке в лагере */
export function markWon(map: string): void {
  const s = loadMenuState();
  if (!s.won.includes(map)) { s.won.push(map); saveMenuState(s); }
}

// ---------- Малина героя на время боя ----------
// Оборона куста считает казну в малине профиля и на старте ставит её в казну карты (src/td/td.ts).
// Собранная малина героя откладывается здесь и возвращается в лагере — бой её не съедает.
const STASH_KEY = 'malina.stash';

/** Отложить малину героя перед боем (один раз за бой: перезагрузка боя не перезаписывает) */
export function stashBerries(berries: number): void {
  try { if (sessionStorage.getItem(STASH_KEY) === null) sessionStorage.setItem(STASH_KEY, String(berries)); } catch { /* закрытое хранилище */ }
}

// снаряжение героя тоже: купленное у маркитанта обороны служит только в этом бою (wiki/design-tower-defence.md, раздел 12)
const GEAR_KEY = 'malina.stash.gear';

/** Снаряжение героя до боя: вещи, что надето, стрелы */
export interface GearStash { items: unknown[]; equip: unknown; arrows: number }

/** Отложить снаряжение героя перед боем (один раз за бой, как малину) */
export function stashGear(g: GearStash): void {
  try { if (sessionStorage.getItem(GEAR_KEY) === null) sessionStorage.setItem(GEAR_KEY, JSON.stringify(g)); } catch { /* закрытое хранилище */ }
}

/** Забрать отложенное снаряжение; null — ничего не откладывали */
export function takeGear(): GearStash | null {
  try {
    const raw = sessionStorage.getItem(GEAR_KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(GEAR_KEY);
    const g = JSON.parse(raw) as GearStash;
    return Array.isArray(g?.items) && g.equip ? g : null;
  } catch { return null; }
}

/** Забрать отложенную малину; null — ничего не откладывали */
export function takeStash(): number | null {
  try {
    const raw = sessionStorage.getItem(STASH_KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(STASH_KEY);
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}
