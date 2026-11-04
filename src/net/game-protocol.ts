import type { EntityState } from './snapshot.ts';
import type { GearAction, TdCommand } from './protocol.ts';

/**
 * Протокол боя (wiki/design-multiplayer.md, раздел 7) — отдельный WebSocket `/game` поверх `Channel` (src/net/channel.ts):
 * ненадёжная полоса — команды ввода (`Cmd`) от клиента и дельты снимков (`Delta`) от сервера; надёжная — вход в матч,
 * постройки, действия снаряжения, наборы, итог. Сервер считает бой (src/game/match.ts), клиент предсказывает своего героя
 */

/** Команда ввода — usercmd: номер, подтверждённый снимок, движение, прицел, удар, перекат (однократно), лук, пинг */
export interface Cmd {
  seq: number;
  /** Последний применённый снимок (его номер — база следующей дельты) */
  snap: number;
  move: [number, number];
  aim: [number, number, number];
  attack: boolean;
  roll: boolean;
  bow: boolean;
  ping: number;
}

export type GameClientMsg =
  | { t: 'hello'; token: string; matchId: string; protocol: number }
  | ({ t: 'td' } & Omit<TdCommand, 't'>)
  | ({ t: 'act' } & GearAction)
  /** Свой набор снаряжения (предметы и надетое) — купил у маркитанта за cost малины боя */
  | { t: 'kit'; items: unknown[]; equip: unknown; cost?: number };

export type GameServerMsg =
  | { t: 'welcome'; seat: number; tick: number }
  | { t: 'kit'; seat: number; items: unknown[]; equip: unknown }
  | ({ t: 'act'; seat: number } & GearAction)
  | { t: 'toast'; text: string }
  | { t: 'over'; result: 'won' | 'lost' | 'abandoned'; wave: number }
  | { t: 'error'; text: string };

/** Герой в снимке: `h<место>` */
export type HeroEnt = EntityState & { seat: number; x: number; y: number; z: number; yaw: number; hp: number; maxHp: number; down: 0 | 1; mx: number; mz: number; ax: number; az: number; attack: 0 | 1; roll: 0 | 1; bow: 0 | 1; ack: number; ping: number };
/** Враг в снимке: `m<сетевой id>` */
export type MobEnt = EntityState & { kind: string; x: number; y: number; z: number; yaw: number; hp: number; maxHp: number; flags: number; attack: string; seq: number; ax: number; az: number; lane: string; marchI: number };
/** Флаги врага в снимке: призван (без малины), оглушён, замедлен холодом, воодушевлён знаменем, заметил героя */
export const MOB_FLAG = { summoned: 1, daze: 2, chill: 4, rally: 8, alerted: 16 } as const;

/** Такт физики и кадр сервера (снимок после каждого кадра) */
export const TICK = 1 / 60;
export const FRAME_MS = 50;
export const CMD_BACKLOG = 8;
/** Команд в одном кадре клиента: последняя и столько же предыдущих (cl_packetdup) — потеря кадра не теряет ввод */
export const CMD_DUP = 3;
/** Ненадёжная часть кадра клиента — пачка последних команд по возрастанию seq */
export type CmdBatch = Cmd[];
/** Снимков в кольце сервера */
export const SNAP_RING = 32;
/** Конец боя → итог через столько секунд: сбор урожая долетает в кошельки */
export const LOOT_DELAY = 4.5;
