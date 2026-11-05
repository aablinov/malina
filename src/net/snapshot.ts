/**
 * World snapshots and deltas — modelled on Quake 3's sv_snapshot.c and cl_parse.c: the server keeps a ring of recent snapshots and sends the client
 * the difference from the snapshot it acknowledged (`SnapAck` in its command); no ack, or one older than the ring —
 * a full base snapshot (`base: 0`). The client also keeps a ring of received states (`cl.snapshots[PACKET_BACKUP]`): while its
 * ack is in flight to the server, deltas arrive from the previous base — it restores that base from history instead of dropping them.
 * Events (`ev`) come in groups per snapshot after the base: the client plays only those newer than the one already applied.
 * An entity is a flat object with a short `id` key (kind + number: `h1`, `m23`, `t4`, `td`) and primitive fields
 */
export type Prim = number | string | boolean;
export type EntityState = { id: string } & Record<string, Prim>;

export interface Snapshot<E = unknown> {
  n: number;
  tick: number;
  ents: Map<string, EntityState>;
  events: E[];
}

export interface Delta<E = unknown> {
  n: number;
  /** Snapshot the difference is computed from; 0 — full */
  base: number;
  tick: number;
  add: EntityState[];
  upd: ({ id: string } & Partial<Record<string, Prim>>)[];
  del: string[];
  /** Events of snapshots `base+1 … n`, one group per snapshot (full — a single group: the events of snapshot n) */
  ev: E[][];
}

export class SnapshotRing<E = unknown> {
  private readonly ring: Snapshot<E>[] = [];
  private readonly size: number;
  private n = 0;

  constructor(size = 32) { this.size = size; }

  get last(): Snapshot<E> | null { return this.ring.length ? this.ring[this.ring.length - 1] : null; }

  /** New snapshot from an entity list; returns its number */
  push(tick: number, ents: Iterable<EntityState>, events: E[]): Snapshot<E> {
    const s: Snapshot<E> = { n: ++this.n, tick, ents: new Map(), events };
    for (const e of ents) s.ents.set(e.id, e);
    this.ring.push(s);
    if (this.ring.length > this.size) this.ring.shift();
    return s;
  }

  get(n: number): Snapshot<E> | null { return this.ring.find((s) => s.n === n) ?? null; }

  /** Delta of the latest snapshot from the one the client acknowledged (0 or unknown — full) */
  delta(ack: number): Delta<E> | null {
    const cur = this.last;
    if (!cur) return null;
    const base = ack > 0 ? this.get(ack) : null;
    if (!base || base === cur) return base === cur ? empty(cur) : full(cur);
    const d: Delta<E> = { n: cur.n, base: base.n, tick: cur.tick, add: [], upd: [], del: [], ev: [] };
    for (const [id, e] of cur.ents) {
      const b = base.ents.get(id);
      if (!b) { d.add.push(e); continue; }
      let u: Delta<E>['upd'][number] | null = null;
      for (const k in e) if (k !== 'id' && e[k] !== b[k]) (u ??= { id })[k] = e[k];
      if (u) d.upd.push(u);
    }
    for (const id of base.ents.keys()) if (!cur.ents.has(id)) d.del.push(id);
    for (const s of this.ring) if (s.n > base.n && s.n <= cur.n) d.ev.push(s.events);
    return d;
  }
}

const full = <E>(s: Snapshot<E>): Delta<E> => ({ n: s.n, base: 0, tick: s.tick, add: [...s.ents.values()], upd: [], del: [], ev: [s.events] });
const empty = <E>(s: Snapshot<E>): Delta<E> => ({ n: s.n, base: s.n, tick: s.tick, add: [], upd: [], del: [], ev: [] });

type State = Map<string, EntityState>;

/**
 * Client copy of the world: applies deltas and remembers the last `keep` received states. The current `ents` records are the same
 * objects from snapshot to snapshot (fields are patched in place), the history holds copies. Acknowledge `n` to the server
 */
export class SnapshotView<E = unknown> {
  n = 0;
  tick = 0;
  readonly ents: State = new Map();
  /** What changed relative to the previous current state */
  added: EntityState[] = [];
  updated: EntityState[] = [];
  removed: EntityState[] = [];
  /** Events not yet played: from snapshots newer than the previous `n` */
  events: E[] = [];
  /** Deltas from a base missing in the history (a full snapshot is needed) */
  rejected = 0;
  private readonly history = new Map<number, State>();
  private readonly keep: number;

  constructor(keep = 32) { this.keep = keep; }

  /** false — stale or duplicate (`n` not above the current) or the base is unknown (missed or older than the history) */
  apply(d: Delta<E>): boolean {
    if (d.n <= this.n && d.base !== 0) return false;
    let target: State;
    let played = 0;
    if (d.base === 0) {
      target = new Map();
      for (const e of d.add) target.set(e.id, { ...e });
    } else {
      const base = this.history.get(d.base);
      if (!base) { this.rejected++; return false; }
      target = new Map();
      for (const [id, e] of base) target.set(id, { ...e });
      for (const e of d.add) target.set(e.id, { ...e });
      for (const u of d.upd) {
        const e = target.get(u.id);
        if (!e) continue;
        for (const k in u) if (k !== 'id') e[k] = u[k] as Prim;
      }
      for (const id of d.del) target.delete(id);
      // event groups belong to snapshots base+1 … n; skip those already played (up to and including the current n)
      played = Math.max(0, Math.min(d.ev.length, this.n - d.base));
    }
    this.sync(target);
    this.events = d.ev.slice(played).flat();
    this.history.set(d.n, target);
    while (this.history.size > this.keep) { const first = this.history.keys().next().value as number; this.history.delete(first); }
    this.n = d.n;
    this.tick = d.tick;
    return true;
  }

  /** Current records ← target state: in place, with the difference for the view */
  private sync(target: State): void {
    this.added = []; this.updated = []; this.removed = [];
    for (const [id, e] of this.ents) if (!target.has(id)) { this.ents.delete(id); this.removed.push(e); }
    for (const [id, t] of target) {
      const e = this.ents.get(id);
      if (!e) { const copy = { ...t }; this.ents.set(id, copy); this.added.push(copy); continue; }
      let changed = false;
      for (const k in t) if (e[k] !== t[k]) { e[k] = t[k]; changed = true; }
      for (const k in e) if (!(k in t)) { delete e[k]; changed = true; }
      if (changed) this.updated.push(e);
    }
  }
}
