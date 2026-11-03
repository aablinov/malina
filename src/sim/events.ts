/**
 * События симуляции — аналог entityState.event в Quake 3: всё, что вид должен показать (искры, цифры, звук, тряска),
 * симуляция кладёт в `world.events` плоской записью, снимок уносит их клиенту, `src/cgame/effects.ts` играет.
 * `t` — тип, `id` — сущность (башня `t3`, стена `w:gate`), `x y z` — где. Остальные поля — по типу (см. таблицу в effects.ts)
 */
export interface SimEvent {
  t: string;
  id?: string;
  x?: number;
  y?: number;
  z?: number;
  [k: string]: unknown;
}
