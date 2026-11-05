import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AuthReply } from '../src/net/protocol.ts';
import type { PlayerRow, Players } from './repo/players.ts';

/**
 * Passwordless sign-in: hero name → random token. The browser keeps the token (localStorage `malina.net`),
 * the database only its sha256. Lose the token and the hero with that name is lost, like a localStorage save
 */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
export const newToken = (): string => randomBytes(32).toString('base64url');
export const newId = (): string => randomUUID();

export class Auth {
  private readonly players: Players;
  constructor(players: Players) { this.players = players; }

  /** Player by token or null */
  check(token: unknown): PlayerRow | null {
    return typeof token === 'string' && token.length >= 20 && token.length <= 100 ? this.players.byToken(hashToken(token)) : null;
  }

  /** New hero; null — name is taken */
  register(name: string, now: number): AuthReply | null {
    if (this.players.byName(name)) return null;
    const token = newToken(), id = newId();
    this.players.create(id, name, hashToken(token), now);
    return { playerId: id, name, token };
  }
}
