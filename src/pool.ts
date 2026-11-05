/**
 * Object pool with no allocations in battle (wiki/dev-performance.md): free ones are a stack of indices, live ones a dense array
 * with swap removal. Overflow: 'steal-oldest' takes the oldest live object, 'drop' refuses.
 */
export class FxPool<T> {
  private readonly items: T[] = [];
  private readonly free: Int32Array;
  private freeN = 0;
  /** Indices of live objects in order of issue (the oldest first) */
  private readonly liveIdx: Int32Array;
  /** Position of the index in liveIdx (for swap removal) */
  private readonly where: Int32Array;
  private liveN = 0;

  readonly capacity: number;
  private readonly overflow: 'steal-oldest' | 'drop';
  constructor(make: () => T, capacity: number, overflow: 'steal-oldest' | 'drop' = 'steal-oldest') { this.capacity = capacity; this.overflow = overflow;
    this.free = new Int32Array(capacity);
    this.liveIdx = new Int32Array(capacity);
    this.where = new Int32Array(capacity).fill(-1);
    for (let i = 0; i < capacity; i++) { this.items.push(make()); this.free[this.freeN++] = capacity - 1 - i; }
  }

  get live(): number { return this.liveN; }

  /** Take a free object; null — the pool is full and overflow is forbidden. onSteal — the one taken from its old owner */
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

  /** Return to the pool */
  release(t: T): void {
    const i = this.items.indexOf(t);
    if (i < 0 || this.where[i] < 0) return;
    this.removeLive(i);
    this.free[this.freeN++] = i;
  }

  /** Iterate live objects; returning false from fn frees the object (safe during iteration) */
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
