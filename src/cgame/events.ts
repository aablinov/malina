/**
 * Единая очередь системных событий — `Sys_QueEvent`/`Com_EventLoop` Quake 3 (wiki/arch-layers.md): обработчики DOM и
 * транспорт сети ничего не делают сами, только кладут событие с меткой времени в кольцо; цикл кадра разбирает очередь
 * перед тактами (`drain`) — порядок «ввод → сеть → такт → кадр» один и тот же, клавиша-тап короче такта не теряется,
 * геймплей не выполняется внутри `keydown`. В обработчиках остаётся лишь то, что нельзя отложить: `preventDefault`
 * и первый жест для звука
 */
export type SysInput =
  | { kind: 'key'; code: string; down: boolean; repeat: boolean; e: KeyboardEvent }
  | { kind: 'mouse'; x: number; y: number }
  | { kind: 'button'; button: number; down: boolean }
  | { kind: 'wheel'; dy: number }
  | { kind: 'blur' }
  /** Кадр сети: доставить получателю при разборе очереди */
  | { kind: 'net'; deliver: () => void };
/** Событие в очереди: с меткой времени (мс, часы очереди) */
export type SysEvent = SysInput & { t: number };

/** Как `MAX_QUED_EVENTS` в Quake 3 */
export const MAX_QUEUED = 256;

export class EventQueue {
  private readonly ring: (SysEvent | undefined)[] = new Array<SysEvent | undefined>(MAX_QUEUED);
  private head = 0;
  private tail = 0;
  /** Событий выброшено из-за переполнения (старейшие) */
  dropped = 0;
  private readonly clock: () => number;

  constructor(clock: () => number = () => performance.now()) { this.clock = clock; }

  get size(): number { return this.tail - this.head; }

  push(e: SysInput): void {
    if (this.tail - this.head >= MAX_QUEUED) { this.head++; this.dropped++; }
    this.ring[this.tail++ % MAX_QUEUED] = { ...e, t: this.clock() } as SysEvent;
  }

  /** Разобрать всё, что накопилось к этому моменту (события, добавленные по ходу разбора, — в следующий раз) */
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
  /** Коды клавиш, у которых браузерное действие глушится сразу (Space, Tab, F-клавиши) */
  prevent: (e: KeyboardEvent) => boolean;
  /** Первый жест пользователя — разрешить звук; зовётся в обработчике, не из очереди */
  gesture?: () => void;
}

/** Слушатели окна и холста, которые только кладут события в очередь; вернёт снятие */
export function bindDom(q: EventQueue, canvas: HTMLElement, b: DomBinding, target: Window = window): () => void {
  const onKeyDown = (e: KeyboardEvent): void => { if (b.prevent(e)) e.preventDefault(); b.gesture?.(); q.push({ kind: 'key', code: e.code, down: true, repeat: e.repeat, e }); };
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
