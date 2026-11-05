/**
 * Single queue of system events — Quake 3's `Sys_QueEvent`/`Com_EventLoop` (wiki/arch-layers.md): DOM handlers and
 * the network transport do nothing themselves, they only put a timestamped event into the ring; the frame loop drains the queue
 * before the ticks (`drain`) — the order "input → network → tick → frame" is always the same, a key tap shorter than a tick is not lost,
 * gameplay never runs inside `keydown`. Only what cannot be deferred stays in the handlers: `preventDefault`,
 * the first gesture for audio and interface keys (menu, inventory, shop, chat — `keyNow`): they are not the game and respond at once
 */
export type SysInput =
  | { kind: 'key'; code: string; down: boolean; repeat: boolean; e: KeyboardEvent }
  | { kind: 'mouse'; x: number; y: number }
  | { kind: 'button'; button: number; down: boolean }
  | { kind: 'wheel'; dy: number }
  | { kind: 'blur' }
  /** Network frame: deliver to the receiver when the queue is drained */
  | { kind: 'net'; deliver: () => void };
/** Queued event: with a timestamp (ms, the queue's clock) */
export type SysEvent = SysInput & { t: number };

/** Like `MAX_QUED_EVENTS` in Quake 3 */
export const MAX_QUEUED = 256;

export class EventQueue {
  private readonly ring: (SysEvent | undefined)[] = new Array<SysEvent | undefined>(MAX_QUEUED);
  private head = 0;
  private tail = 0;
  /** Events dropped due to overflow (the oldest) */
  dropped = 0;
  private readonly clock: () => number;

  constructor(clock: () => number = () => performance.now()) { this.clock = clock; }

  get size(): number { return this.tail - this.head; }

  push(e: SysInput): void {
    if (this.tail - this.head >= MAX_QUEUED) { this.head++; this.dropped++; }
    this.ring[this.tail++ % MAX_QUEUED] = { ...e, t: this.clock() } as SysEvent;
  }

  /** Drain everything accumulated so far (events added during the drain wait for the next one) */
  drain(fn: (e: SysEvent) => void): void {
    const end = this.tail;
    while (this.head < end) {
      const i = this.head++ % MAX_QUEUED;
      const e = this.ring[i]!;
      this.ring[i] = undefined;
      fn(e);
    }
  }

  clear(): void { this.head = this.tail; this.ring.fill(undefined); }
}

export interface DomBinding {
  /** Key codes whose browser action is suppressed right away (Space, Tab, F keys) */
  prevent: (e: KeyboardEvent) => boolean;
  /** The user's first gesture — unlock audio; called in the handler, not from the queue */
  gesture?: () => void;
  /** Interface key (menu, panels): handled at once, does not go into the queue. true — consumed */
  keyNow?: (e: KeyboardEvent) => boolean;
}

/** Window and canvas listeners that only put events into the queue; returns the removal */
export function bindDom(q: EventQueue, canvas: HTMLElement, b: DomBinding, target: Window = window): () => void {
  const onKeyDown = (e: KeyboardEvent): void => { if (b.prevent(e)) e.preventDefault(); b.gesture?.(); if (b.keyNow?.(e)) return; q.push({ kind: 'key', code: e.code, down: true, repeat: e.repeat, e }); };
  const onKeyUp = (e: KeyboardEvent): void => { q.push({ kind: 'key', code: e.code, down: false, repeat: false, e }); };
  const onBlur = (): void => { q.push({ kind: 'blur' }); };
  const onMove = (e: MouseEvent): void => { q.push({ kind: 'mouse', x: e.clientX, y: e.clientY }); };
  const onDown = (e: MouseEvent): void => { b.gesture?.(); q.push({ kind: 'button', button: e.button, down: true }); };
  const onUp = (e: MouseEvent): void => { q.push({ kind: 'button', button: e.button, down: false }); };
  const onWheel = (e: WheelEvent): void => { q.push({ kind: 'wheel', dy: e.deltaY }); };
  const onMenu = (e: Event): void => { e.preventDefault(); };
  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);
  target.addEventListener('mousemove', onMove);
  canvas.addEventListener('mousedown', onDown);
  target.addEventListener('mouseup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: true });
  canvas.addEventListener('contextmenu', onMenu);
  return () => {
    target.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('keyup', onKeyUp);
    target.removeEventListener('blur', onBlur);
    target.removeEventListener('mousemove', onMove);
    canvas.removeEventListener('mousedown', onDown);
    target.removeEventListener('mouseup', onUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onMenu);
  };
}
