import { mapByName } from '../level/maps.ts';
import type { TdSpec } from '../td/types.ts';

/**
 * Карты обороны куста для выбора в лагере (wiki/design-main-menu.md): по возрастанию сложности.
 * Волны, казна и здоровье куста — из `meta.td` самих карт, здесь только то, чего в карте нет.
 */
export interface CampaignMap {
  /** Имя карты в assets/maps/ — оно же `?map=` */
  id: string;
  title: string;
  /** Сложность 1..3 */
  difficulty: 1 | 2 | 3;
  blurb: string;
  /** Фон карточки — цвета биома */
  bg: string;
  icon: string;
  waves: number;
  lanes: number;
  bush: number;
  berries: number;
}

const DIFFICULTY = ['', 'Лёгкая', 'Средняя', 'Трудная'];
export const difficultyTitle = (d: number): string => DIFFICULTY[d] ?? '';

const BASE: Omit<CampaignMap, 'waves' | 'lanes' | 'bush' | 'berries'>[] = [
  { id: 'td', title: 'Лавовая котловина', difficulty: 1, icon: 'fireball', bg: 'linear-gradient(160deg, #6b2414, #2b1210 70%)',
    blurb: 'Куст малины среди разломов с лавой. Три дороги от пещер через мосты — строй башни у мостов.' },
  { id: 'td2', title: 'Кристальная поляна', difficulty: 2, icon: 'spark', bg: 'linear-gradient(160deg, #134a5c, #101d2e 70%)',
    blurb: 'Ночь, синие порталы и рвы. Панцирники гасят удары, споровики лечат соседей, скакуны прыгают по дороге.' },
  { id: 'td3', title: 'Замок на лугу', difficulty: 3, icon: 'helmet', bg: 'linear-gradient(160deg, #3c5a24, #1d2616 70%)',
    blurb: 'Осада с четырёх сторон. Подрывники ломают стены, баллисты — ворота; чини проломы и держи двор.' },
];

export const CAMPAIGN: readonly CampaignMap[] = BASE.map((b) => {
  const td = mapByName(b.id)?.meta?.td as TdSpec | undefined;
  return { ...b, waves: td?.waves?.length ?? 0, lanes: td?.lanes.length ?? 0, bush: td?.bush.hp ?? 0, berries: td?.berries ?? 0 };
});

export const campaignMap = (id: string): CampaignMap => CAMPAIGN.find((m) => m.id === id) ?? CAMPAIGN[0];
