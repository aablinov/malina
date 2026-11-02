import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AuthReply } from '../src/net/protocol.ts';
import type { PlayerRow, Players } from './repo/players.ts';

/**
 * Вход без пароля: имя героя → случайный токен. Токен хранит браузер (localStorage `malina.net`),
 * в базе — только его sha256. Потерял токен — герой с этим именем потерян, как сохранение в localStorage
 */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
export const newToken = (): string => randomBytes(32).toString('base64url');
export const newId = (): string => randomUUID();

export class Auth {
  private readonly players: Players;
  constructor(players: Players) { this.players = players; }

  /** Игрок по токену или null */
  check(token: unknown): PlayerRow | null {
    return typeof token === 'string' && token.length >= 20 && token.length <= 100 ? this.players.byToken(hashToken(token)) : null;
  }

  /** Новый герой; null — имя занято */
  register(name: string, now: number): AuthReply | null {
    if (this.players.byName(name)) return null;
    const token = newToken(), id = newId();
    this.players.create(id, name, hashToken(token), now);
    return { playerId: id, name, token };
  }
}
