/**
 * Снимки мира и дельты — по образцу sv_snapshot.c и cl_parse.c Quake 3: сервер хранит кольцо последних снимков, клиенту уходит
 * разница с тем снимком, который тот подтвердил (`SnapAck` в его команде); подтверждения нет или оно старше кольца —
 * полный базовый снимок (`base: 0`). Клиент тоже хранит кольцо принятых состояний (`cl.snapshots[PACKET_BACKUP]`): пока его
 * подтверждение летит к серверу, дельты приходят от прежней базы — он восстанавливает её из истории, а не отбрасывает.
 * События (`ev`) — по группам на каждый снимок после базового: клиент играет только те, что новее уже применённого.
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
  /** События снимков `base+1 … n`, группа на снимок (полный — одна группа: события снимка n) */
  ev: E[][];
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
    for (const s of this.ring) if (s.n > base.n && s.n <= cur.n) d.ev.push(s.events);
    return d;
  }
}

const full = <E>(s: Snapshot<E>): Delta<E> => ({ n: s.n, base: 0, tick: s.tick, add: [...s.ents.values()], upd: [], del: [], ev: [s.events] });
const empty = <E>(s: Snapshot<E>): Delta<E> => ({ n: s.n, base: s.n, tick: s.tick, add: [], upd: [], del: [], ev: [] });

type State = Map<string, EntityState>;

/**
 * Клиентская копия мира: применяет дельты и помнит последние `keep` принятых состояний. Текущие записи `ents` — одни и те же
 * объекты от снимка к снимку (поля правятся на месте), история — копии. Подтверждать серверу — `n`
 */
export class SnapshotView<E = unknown> {
  n = 0;
  tick = 0;
  readonly ents: State = new Map();
  /** Что изменилось относительно прежнего текущего состояния */
  added: EntityState[] = [];
  updated: EntityState[] = [];
  removed: EntityState[] = [];
  /** События, ещё не игранные: снимков новее прежнего `n` */
  events: E[] = [];
  /** Дельт от базы, которой нет в истории (нужен полный снимок) */
  rejected = 0;
  private readonly history = new Map<number, State>();
  private readonly keep: number;

  constructor(keep = 32) { this.keep = keep; }

  /** false — старый или дубль (`n` не больше текущего) либо база неизвестна (пропущена или старше истории) */
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
      // группы событий — снимков base+1 … n; уже игранные (до текущего n включительно) пропускаем
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

  /** Текущие записи ← целевое состояние: на месте, с разницей для вью */
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
