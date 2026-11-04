import { FRAME_MS } from '../../src/net/game-protocol.ts';
import type { Match } from '../../src/game/match.ts';

/**
 * Раннер матчей: один таймер на процесс (кадр FRAME_MS, как sv_fps 20) обходит все идущие матчи.
 * Тесты крутят `frame(dt)` сами с фейковыми часами
 */
export class MatchRunner {
  private readonly matches = new Map<string, Match>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private readonly now: () => number;

  constructor(now: () => number = () => performance.now()) { this.now = now; }

  get size(): number { return this.matches.size; }
  get(id: string): Match | null { return this.matches.get(id) ?? null; }
  add(m: Match): void { this.matches.set(m.id, m); }
  remove(id: string): void { this.matches.delete(id); }

  /** Кадр всех матчей: dt — секунды (по умолчанию — сколько прошло, не больше 0,25 с) */
  frame(dt?: number): void {
    const t = this.now();
    const step = dt ?? (this.last ? Math.min(0.25, (t - this.last) / 1000) : FRAME_MS / 1000);
    this.last = t;
    for (const m of this.matches.values()) m.frame(step);
  }

  start(): void {
    if (this.timer) return;
    this.last = this.now();
    this.timer = setInterval(() => this.frame(), FRAME_MS);
    this.timer.unref?.();
  }

  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
}
