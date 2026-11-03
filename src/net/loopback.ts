import type { Rand } from '../rng.ts';
import type { Transport } from './transport.ts';

/**
 * Петля в памяти: пара связанных транспортов. Без часов кадры доходят сразу (одиночная игра — «listen server»);
 * с часами — через delayMs ± jitterMs, с долей потерь loss и перестановок, по вызову `pump(now)` (тесты канала)
 */
export interface LoopbackOpts {
  clock?: () => number;
  delayMs?: number;
  jitterMs?: number;
  /** Доля потерянных кадров 0..1 */
  loss?: number;
  /** Доля кадров, которые приходят позже следующего */
  reorder?: number;
  rng?: Rand;
}

interface Pending { at: number; frame: string; to: LoopbackEnd }

export class LoopbackEnd implements Transport {
  onMessage: ((frame: string) => void) | null = null;
  onClose: ((code: number) => void) | null = null;
  peer!: LoopbackEnd;
  closed = false;
  /** Отправлено и доставлено кадров — для тестов */
  sent = 0;
  delivered = 0;
  private readonly link: Link;

  constructor(link: Link) { this.link = link; }

  send(frame: string): void {
    if (this.closed || this.peer.closed) return;
    this.sent++;
    this.link.post(frame, this.peer);
  }

  close(code = 1000): void {
    if (this.closed) return;
    this.closed = true;
    this.peer.closed = true;
    this.onClose?.(code);
    this.peer.onClose?.(code);
  }
}

class Link {
  private readonly o: LoopbackOpts;
  private readonly queue: Pending[] = [];
  private draining = false;

  constructor(o: LoopbackOpts) { this.o = o; }

  post(frame: string, to: LoopbackEnd): void {
    const r = this.o.rng;
    if (this.o.loss && r && r() < this.o.loss) return;
    const now = this.o.clock?.() ?? 0;
    let at = now + (this.o.delayMs ?? 0) + (this.o.jitterMs && r ? (r() * 2 - 1) * this.o.jitterMs : 0);
    if (this.o.reorder && r && r() < this.o.reorder) at += (this.o.delayMs ?? 1) * 1.5 + 1;
    this.queue.push({ at, frame, to });
    if (!this.o.clock) this.drain(Infinity);
  }

  /** Доставить всё, что созрело к now (в порядке срока) */
  pump(now: number): void { this.drain(now); }

  private drain(now: number): void {
    if (this.draining) return;
    this.draining = true;
    try {
      for (;;) {
        let k = -1;
        for (let i = 0; i < this.queue.length; i++) if (this.queue[i].at <= now && (k < 0 || this.queue[i].at < this.queue[k].at)) k = i;
        if (k < 0) break;
        const [p] = this.queue.splice(k, 1);
        if (p.to.closed) continue;
        p.to.delivered++;
        p.to.onMessage?.(p.frame);
      }
    } finally { this.draining = false; }
  }
}

export interface LoopbackPair { a: LoopbackEnd; b: LoopbackEnd; pump: (now: number) => void }

export function loopbackPair(o: LoopbackOpts = {}): LoopbackPair {
  const link = new Link(o);
  const a = new LoopbackEnd(link), b = new LoopbackEnd(link);
  a.peer = b; b.peer = a;
  return { a, b, pump: (now) => link.pump(now) };
}
