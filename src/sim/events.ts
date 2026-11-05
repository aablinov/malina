/**
 * Simulation events — the analogue of entityState.event in Quake 3: everything the view must show (sparks, numbers, sound, shake)
 * the simulation puts into `world.events` as a flat record, the snapshot carries them to the client, `src/cgame/effects.ts` plays them.
 * `t` — type, `id` — entity (tower `t3`, wall `w:gate`), `x y z` — where. The other fields depend on the type (see the table in effects.ts)
 */
export interface SimEvent {
  t: string;
  id?: string;
  x?: number;
  y?: number;
  z?: number;
  [k: string]: unknown;
}
