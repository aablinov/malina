/**
 * Виды башен обороны куста (wiki/design-tower-defence.md, раздел 3). Числа — за один уровень; улучшение (до III)
 * умножает урон на UPGRADE_DMG и прибавляет дальности UPGRADE_RANGE. Цена улучшения — доля цены постройки.
 */

export type TowerKind = 'arrow' | 'frost' | 'splash' | 'fire' | 'magic';

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
  /** Клавиша в меню */
  key: string;
}

export const TOWERS: Record<TowerKind, TowerDef> = {
  arrow: { id: 'arrow', title: 'Стрелковая вышка', hint: 'быстрые болты по одному', cost: 60, range: 9, cd: 0.4, dmg: 6, color: '#d8b872', key: '1' },
  frost: { id: 'frost', title: 'Морозный шпиль', hint: 'иней: замедляет и бьёт', cost: 80, range: 8, cd: 1.1, dmg: 8, color: '#7ad8ff', key: '2' },
  splash: { id: 'splash', title: 'Катапульта', hint: 'камень по площади', cost: 110, range: 11, cd: 2.4, dmg: 26, color: '#c88a5a', key: '3' },
  fire: { id: 'fire', title: 'Огненная жаровня', hint: 'струя пламени, поджигает', cost: 100, range: 6, cd: 0.9, dmg: 10, color: '#ff8a3a', key: '4' },
  magic: { id: 'magic', title: 'Волшебный обелиск', hint: 'сфера бьёт цепью, ослабляет', cost: 130, range: 10, cd: 1.5, dmg: 18, color: '#c48aff', key: '5' },
};

export const TOWER_ORDER: TowerKind[] = ['arrow', 'frost', 'splash', 'fire', 'magic'];

export const MAX_LEVEL = 3;
/** Урон за уровень: I ×1, II ×1,6, III ×2,4 */
export const UPGRADE_DMG = [1, 1.6, 2.4];
export const UPGRADE_RANGE = [0, 1, 2];
/** Цена улучшения — доля цены постройки */
export const UPGRADE_COST = [0, 0.7, 1.0];
/** Возврат при продаже — доля всего вложенного */
export const SELL_BACK = 0.7;

export const upgradeCost = (def: TowerDef, toLevel: number): number => Math.round(def.cost * UPGRADE_COST[toLevel - 1]);
