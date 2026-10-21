import type { RegionId } from './map';

/** Место игрока в отряде. Пока занято только локальное, остальные ждут сетевую часть */
export interface PlayerSlot {
  id: string;
  name: string;
  /** Этот игрок управляется с этого компьютера */
  local: boolean;
  ready: boolean;
  /** Цвет маркера на карте и под ногами */
  color: string;
}

export const MAX_PLAYERS = 4;
const COLORS = ['#ffd84a', '#5ad0ff', '#ff6a8a', '#8aff6a'];

/** Код сессии вида MLN-4821-KP — по нему друзья смогут подключиться */
export function newSessionId(): string {
  const digits = String(Math.floor(1000 + Math.random() * 9000));
  const abc = 'ABCEHKMPTXY';
  const letters = abc[Math.floor(Math.random() * abc.length)] + abc[Math.floor(Math.random() * abc.length)];
  return `MLN-${digits}-${letters}`;
}

/** Сессия: отряд, выбранный регион высадки. Сеть подключится сюда позже */
export class Session {
  readonly id = newSessionId();
  readonly slots: (PlayerSlot | null)[] = Array.from({ length: MAX_PLAYERS }, () => null);
  region: RegionId = 'meadow';

  constructor(localName: string) {
    this.slots[0] = { id: 'p1', name: localName, local: true, ready: true, color: COLORS[0] };
  }

  get players(): PlayerSlot[] { return this.slots.filter((s): s is PlayerSlot => !!s); }
  get local(): PlayerSlot { return this.players.find((p) => p.local)!; }
  slotColor(i: number): string { return COLORS[i % COLORS.length]; }
}
