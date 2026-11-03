import type { EntityState } from '../net/snapshot.ts';

/**
 * Записи сущностей для снимка (src/net/snapshot.ts): плоские, с короткими ключами. Ключ `id` — вид и номер:
 * `td` — оборона, `t<площадка>` — башня, `w:<id>` — стена, `b<n>` — снаряд башни, `pool<n>` — лужа смолы,
 * `p<n>` — кучка малины, `lair:<дорога>` — логово, `purse<место>` — малина игрока. Вид рисует только по ним и событиям
 */
export type TdEnt = EntityState & { id: 'td'; state: 'play' | 'lost' | 'won'; wave: number; next: number; running: 0 | 1; players: number; bush: number; bushMax: number; bushDead: 0 | 1; spawned: number; fallen: number };
export type TowerEnt = EntityState & { pad: number; kind: string; level: number; hp: number; maxHp: number; frozen: number; yaw: number; x: number; y: number; z: number; spent: number; recoil: number };
export type WallEnt = EntityState & { hp: number; maxHp: number; dead: 0 | 1; cracked: 0 | 1 };
export type BoltEnt = EntityState & { kind: string; fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; k: number; h: number };
export type PoolEnt = EntityState & { x: number; z: number; r: number; t: number };
export type PileEnt = EntityState & { x: number; y: number; z: number; n: number };
export type LairEnt = EntityState & { lane: string; warn: number };
export type PurseEnt = EntityState & { seat: number; n: number };

export const r2 = (v: number): number => Math.round(v * 100) / 100;
export const r1 = (v: number): number => Math.round(v * 10) / 10;
