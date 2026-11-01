/**
 * Виды башен обороны куста (wiki/design-tower-defence.md, раздел 3). Числа — за один уровень; улучшение (до III)
 * умножает урон на UPGRADE_DMG и прибавляет дальности UPGRADE_RANGE. Цена улучшения — доля цены постройки.
 */

export type TowerKind = 'arrow' | 'frost' | 'splash' | 'fire' | 'magic' | 'meteor' | 'storm' | 'winter' | 'ballista' | 'oil';

export interface TowerDef {
  id: TowerKind;
  title: string;
  /** Чем бьёт — короткая строка в меню */
  hint: string;
  cost: number;
  range: number;
  /** Перезарядка, с */
  cd: number;
  dmg: number;
  /** Цвет башни в меню и в её свете, CSS */
  color: string;
  /** Прочность на уровне I: её грызут охотники на башни (src/mobs/td-foes.ts); ноль — башня в руинах */
  hp: number;
}

export const TOWERS: Record<TowerKind, TowerDef> = {
  arrow: { id: 'arrow', title: 'Стрелковая вышка', hint: 'быстрые болты по одному', cost: 60, range: 9, cd: 0.4, dmg: 6, color: '#d8b872', hp: 120 },
  frost: { id: 'frost', title: 'Морозный шпиль', hint: 'иней: замедляет и бьёт', cost: 80, range: 8, cd: 1.1, dmg: 8, color: '#7ad8ff', hp: 140 },
  splash: { id: 'splash', title: 'Катапульта', hint: 'камень по площади', cost: 110, range: 11, cd: 2.4, dmg: 26, color: '#c88a5a', hp: 160 },
  fire: { id: 'fire', title: 'Огненная жаровня', hint: 'струя пламени, поджигает', cost: 100, range: 6, cd: 0.9, dmg: 10, color: '#ff8a3a', hp: 150 },
  magic: { id: 'magic', title: 'Волшебный обелиск', hint: 'сфера бьёт цепью, ослабляет', cost: 130, range: 10, cd: 1.5, dmg: 18, color: '#c48aff', hp: 140 },
  // раздел 14 вики: дорогие башни по площади, на всех картах
  meteor: { id: 'meteor', title: 'Звездочёт', hint: 'метеорит в самую толпу: взрыв 4,5 м, поджог', cost: 500, range: 14, cd: 4.5, dmg: 150, color: '#ffb84a', hp: 220 },
  storm: { id: 'storm', title: 'Грозовой шпиль', hint: 'молния цепью: 6 врагов, на II — 8, на III — 10', cost: 350, range: 11, cd: 1.8, dmg: 40, color: '#7ab8ff', hp: 180 },
  winter: { id: 'winter', title: 'Сердце зимы', hint: 'вьюга вокруг: урон и −50 % всем, ледяная волна', cost: 400, range: 7, cd: 1, dmg: 12, color: '#bfeaff', hp: 200 },
  // осада (раздел 9 вики): только на картах с `meta.td.towers`
  ballista: { id: 'ballista', title: 'Стенная баллиста', hint: 'тяжёлый болт сквозь строй, пробивает броню', cost: 120, range: 14, cd: 2.2, dmg: 45, color: '#b8a070', hp: 200 },
  oil: { id: 'oil', title: 'Котёл со смолой', hint: 'лужа смолы: вязнут и горят', cost: 90, range: 6, cd: 3.5, dmg: 7, color: '#5a3a1a', hp: 160 },
};

/** Порядок в меню; первые восемь — доступны везде; баллиста и котёл — где карта разрешает (`meta.td.towers`) */
export const TOWER_ORDER: TowerKind[] = ['arrow', 'frost', 'splash', 'fire', 'magic', 'meteor', 'storm', 'winter', 'ballista', 'oil'];
/** Сколько видов из TOWER_ORDER доступны на карте без `meta.td.towers` */
export const BASE_TOWERS = 8;
/** Клавиша карточки в меню площадки — по месту в списке карты: 1…9, 0 */
export const menuKey = (i: number): string => String((i + 1) % 10);

export const MAX_LEVEL = 3;
/** Урон за уровень: I ×1, II ×1,6, III ×2,4 */
export const UPGRADE_DMG = [1, 1.6, 2.4];
export const UPGRADE_RANGE = [0, 1, 2];
/** Цена улучшения — доля цены постройки */
export const UPGRADE_COST = [0, 0.7, 1.0];
/** Прочность за уровень: II ×1,3, III ×1,69 */
export const UPGRADE_HP = 1.3;
/** Починка руин — доля всего вложенного */
export const REPAIR_COST = 0.4;
/** Возврат при продаже — доля всего вложенного */
export const SELL_BACK = 0.7;

export const upgradeCost = (def: TowerDef, toLevel: number): number => Math.round(def.cost * UPGRADE_COST[toLevel - 1]);
