/**
 * Пул объектов без выделений в бою (wiki/dev-performance.md): свободные — стек индексов, живые — плотный массив
 * с удалением свапом. Переполнение: 'steal-oldest' забирает самый старый живой объект, 'drop' отказывает.
 */
export class FxPool<T> {
  private readonly items: T[] = [];
  private readonly free: Int32Array;
  private freeN = 0;
  /** Индексы живых по порядку выдачи (самый старый — первый) */
  private readonly liveIdx: Int32Array;
  /** Позиция индекса в liveIdx (для удаления свапом) */
  private readonly where: Int32Array;
  private liveN = 0;

  constructor(make: () => T, readonly capacity: number, private readonly overflow: 'steal-oldest' | 'drop' = 'steal-oldest') {
    this.free = new Int32Array(capacity);
    this.liveIdx = new Int32Array(capacity);
    this.where = new Int32Array(capacity).fill(-1);
    for (let i = 0; i < capacity; i++) { this.items.push(make()); this.free[this.freeN++] = capacity - 1 - i; }
  }

  get live(): number { return this.liveN; }

  /** Взять свободный объект; null — пул полон и переполнение запрещено. onSteal — забранный у старого владельца */
  acquire(onSteal?: (t: T) => void): T | null {
    let i: number;
    if (this.freeN > 0) i = this.free[--this.freeN];
    else if (this.overflow === 'drop') return null;
    else {
      i = this.liveIdx[0];
      onSteal?.(this.items[i]);
      this.removeLive(i);
    }
    this.where[i] = this.liveN;
    this.liveIdx[this.liveN++] = i;
    return this.items[i];
  }

  /** Вернуть в пул */
  release(t: T): void {
    const i = this.items.indexOf(t);
    if (i < 0 || this.where[i] < 0) return;
    this.removeLive(i);
    this.free[this.freeN++] = i;
  }

  /** Обойти живых; вернуть false из fn — освободить объект (безопасно во время обхода) */
  forEachLive(fn: (t: T) => boolean | void): void {
    for (let k = this.liveN - 1; k >= 0; k--) {
      const i = this.liveIdx[k];
      if (fn(this.items[i]) === false) { this.removeLive(i); this.free[this.freeN++] = i; }
    }
  }

  private removeLive(i: number): void {
    const k = this.where[i], last = this.liveIdx[--this.liveN];
    this.liveIdx[k] = last; this.where[last] = k;
    this.where[i] = -1;
  }
}
