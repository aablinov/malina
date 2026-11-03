/**
 * Снимки мира и дельты — по образцу sv_snapshot.c Quake 3: сервер хранит кольцо последних снимков, клиенту уходит
 * разница с тем снимком, который тот подтвердил (`SnapAck` в его команде); подтверждения нет или оно старше кольца —
 * полный базовый снимок (`base: 0`). События (`ev`) — всех снимков после базового, чтобы ни одно не потерялось.
 * Сущность — плоский объект с коротким ключом `id` (вид + номер: `h1`, `m23`, `t4`, `td`) и примитивными полями
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
  /** Снимок, от которого считана разница; 0 — полный */
  base: number;
  tick: number;
  add: EntityState[];
  upd: ({ id: string } & Partial<Record<string, Prim>>)[];
  del: string[];
  ev: E[];
}

export class SnapshotRing<E = unknown> {
  private readonly ring: Snapshot<E>[] = [];
  private readonly size: number;
  private n = 0;

  constructor(size = 32) { this.size = size; }

  get last(): Snapshot<E> | null { return this.ring.length ? this.ring[this.ring.length - 1] : null; }

  /** Новый снимок из списка сущностей; вернёт его номер */
  push(tick: number, ents: Iterable<EntityState>, events: E[]): Snapshot<E> {
    const s: Snapshot<E> = { n: ++this.n, tick, ents: new Map(), events };
    for (const e of ents) s.ents.set(e.id, e);
    this.ring.push(s);
    if (this.ring.length > this.size) this.ring.shift();
    return s;
  }

  get(n: number): Snapshot<E> | null { return this.ring.find((s) => s.n === n) ?? null; }

  /** Дельта последнего снимка от подтверждённого клиентом (0 или неизвестный — полный) */
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
    for (const s of this.ring) if (s.n > base.n && s.n <= cur.n) d.ev.push(...s.events);
    return d;
  }
}

const full = <E>(s: Snapshot<E>): Delta<E> => ({ n: s.n, base: 0, tick: s.tick, add: [...s.ents.values()], upd: [], del: [], ev: s.events });
const empty = <E>(s: Snapshot<E>): Delta<E> => ({ n: s.n, base: s.n, tick: s.tick, add: [], upd: [], del: [], ev: [] });

/** Клиентская копия мира: применяет дельты, помнит номер последнего применённого снимка (его и подтверждать) */
export class SnapshotView<E = unknown> {
  n = 0;
  tick = 0;
  readonly ents = new Map<string, EntityState>();
  /** Что случилось в последней применённой дельте */
  added: EntityState[] = [];
  updated: EntityState[] = [];
  removed: EntityState[] = [];
  events: E[] = [];

  /** false — дельта от неизвестного базового снимка (пропущен или слишком старый), нужен полный */
  apply(d: Delta<E>): boolean {
    if (d.base !== 0 && d.base !== this.n) return false;
    if (d.n <= this.n && d.base !== 0) return false;
    this.added = []; this.updated = []; this.removed = [];
    if (d.base === 0) {
      const keep = new Set(d.add.map((e) => e.id));
      for (const [id, e] of this.ents) if (!keep.has(id)) { this.ents.delete(id); this.removed.push(e); }
      for (const e of d.add) {
        const old = this.ents.get(e.id);
        const copy = { ...e };
        this.ents.set(e.id, copy);
        (old ? this.updated : this.added).push(copy);
      }
    } else {
      for (const e of d.add) { const copy = { ...e }; this.ents.set(e.id, copy); this.added.push(copy); }
      for (const u of d.upd) {
        const e = this.ents.get(u.id);
        if (!e) continue;
        for (const k in u) if (k !== 'id') e[k] = u[k] as Prim;
        this.updated.push(e);
      }
      for (const id of d.del) { const e = this.ents.get(id); if (e) { this.ents.delete(id); this.removed.push(e); } }
    }
    this.events = d.ev;
    this.n = d.n;
    this.tick = d.tick;
    return true;
  }
}
