/**
 * Режим «Оборона куста» (tower defence, wiki/design-tower-defence.md): всё, что карта говорит режиму, лежит в `meta.td`.
 * Координаты — метры мира, как у постов мобов и сундуков. Карта с `meta.td` играется в этом режиме (src/td/td.ts).
 */

/** Площадка под башню: центр клетки; башня занимает круг радиуса ~1,2 м */
export interface TdPad { x: number; z: number }

/** Дорога врагов: от логова (первая точка) к кусту (последняя); враги идут по точкам, башни бьют первого по дороге */
export interface TdLane { id: string; title: string; points: [number, number][] }

/** Куст малины — что защищаем: где стоит и сколько выдержит */
export interface TdBush { x: number; z: number; hp: number }

/** Группа волны: kind — моб из реестра (src/mobs/roster.ts), count штук с шагом every секунд по дороге lane (id), с задержкой delay от начала волны */
export interface TdWaveGroup { kind: string; count: number; every: number; lane: string; delay?: number }

/** Волна: группы и награда малиной за зачистку */
export interface TdWave { title?: string; groups: TdWaveGroup[]; bounty: number }

export interface TdSpec {
  bush: TdBush;
  lanes: TdLane[];
  pads: TdPad[];
  /** Малина на старте */
  berries: number;
  /** Волны по порядку; нет — режим ждёт, враги только из панели F1 */
  waves?: TdWave[];
  /** Пауза между волнами, с */
  rest?: number;
}
