/** Туман над логовами (`src/td/mist-fx.ts`): радиус, плотность 0..1, цвет */
export interface TdMist { radius: number; density?: number; color?: string }

/**
 * Режим «Оборона куста» (tower defence, wiki/design-tower-defence.md): всё, что карта говорит режиму, лежит в `meta.td`.
 * Координаты — метры мира, как у постов мобов и сундуков. Карта с `meta.td` играется в этом режиме (src/td/td.ts).
 */

/** Площадка под башню: центр клетки; башня занимает круг радиуса ~1,2 м. y — высота пола (площадки на стенах замка) */
export interface TdPad { x: number; z: number; y?: number }

/**
 * Дорога врагов: от логова (первая точка) к кусту (последняя); враги идут по точкам, башни бьют первого по дороге.
 * Осада (раздел 9 вики): дорога может упираться в стену или ворота (`wall` — id из `walls`): враги бьют их у конца дороги,
 * а когда пролом пробит, идут дальше по `inner` к кусту. Летуны идут по `inner` сразу.
 */
export interface TdLane { id: string; title: string; points: [number, number][]; wall?: string; inner?: [number, number][] }

/**
 * Стена или ворота замка (осада, раздел 9 вики): прямоугольник клеток [x0..x1] × [z0..z1], блоки с y0 по y1, здоровье.
 * breach — клетка наружной грани, куда бьют враги и где пробивается пролом (±2 клетки вдоль стены, вся толщина); out — единичный вектор наружу.
 * Ворота (`gate`) — проём без блоков: створки закрыты для врагов, герой проходит через калитку.
 */
export interface TdWall {
  id: string; title: string; kind: 'wall' | 'gate';
  x0: number; z0: number; x1: number; z1: number; y0: number; y1: number;
  hp: number; breach: [number, number]; out: [number, number];
}

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
  /** Уровень стаи на первой волне (дальше +3 за волну, src/td/scaling.ts); нет — 1 */
  level?: number;
  /** Стены и ворота замка (осада); нет — куст в чистом поле */
  walls?: TdWall[];
  /** Какие башни можно строить (src/td/towers.ts); нет — пять базовых */
  towers?: string[];
  /** Цена починки стены: малины за 100 здоровья (нет — 20) */
  repair?: number;
  /** Туман у лагерей врагов (src/td/mist-fx.ts): точки выхода не видны */
  mist?: TdMist;
}
