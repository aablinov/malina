import type * as THREE from 'three';
import type { Mob, MobHooks } from './mob';
import { BerryHealer, EmberMage, VineSummoner } from './mages';
import { BannerBearer, Crossbowman, Hammerer, ShieldKnight, Spearman, Squire } from './knights';
import { Berryling, RaspWolf, WitheredGardener } from './critters';
import { BerrySlime, BerrySlimeMid, BerrySlimeSmall, BudSpitter, ThornBall, ThornHorror, VineWhip } from './bush';

/** Рядовые мобы (wiki/design-mobs.md): id → имя и класс. Номера — из списка тридцати */
export type MobCtor = new (h: MobHooks, at: THREE.Vector3) => Mob;

export const MOBS: Record<string, { title: string; make: MobCtor }> = {
  healer: { title: 'Ягодная целительница', make: BerryHealer },
  pyro: { title: 'Жгучий маг', make: EmberMage },
  summoner: { title: 'Лозовый призыватель', make: VineSummoner },
  squire: { title: 'Оруженосец', make: Squire },
  shield: { title: 'Щитоносец', make: ShieldKnight },
  berryling: { title: 'Малинёныш', make: Berryling },
  gardener: { title: 'Увядший садовник', make: WitheredGardener },
  wolf: { title: 'Малиновый волк', make: RaspWolf },
  // вторая партия: рыцари и порождения куста
  spear: { title: 'Копейщик', make: Spearman },
  crossbow: { title: 'Арбалетчик', make: Crossbowman },
  banner: { title: 'Знаменосец', make: BannerBearer },
  hammer: { title: 'Молотобоец', make: Hammerer },
  slime: { title: 'Ягодный слизень', make: BerrySlime },
  slime_mid: { title: 'Слизень средний', make: BerrySlimeMid },
  slime_small: { title: 'Слизень малый', make: BerrySlimeSmall },
  hedgehog: { title: 'Колючий клубок', make: ThornBall },
  vine: { title: 'Лоза-хлыст', make: VineWhip },
  bud: { title: 'Бутон-плевун', make: BudSpitter },
  horror: { title: 'Терновое чудище', make: ThornHorror },
};

/** Осколки слизня — в стае есть, в кнопках витрины не нужны */
export const MOB_PARTS = new Set(['slime_mid', 'slime_small']);

/** Отряды для витрины: кто в каком количестве выходит по кнопке */
export const SQUADS: Record<string, readonly string[]> = {
  berryling: ['berryling', 'berryling', 'berryling', 'berryling'],
  wolf: ['wolf', 'wolf', 'wolf'],
  gardener: ['gardener', 'gardener', 'gardener'],
  /** Первая партия вместе: рыцари со щитом впереди, маги за ними */
  first: ['shield', 'squire', 'squire', 'healer', 'pyro', 'summoner', 'gardener', 'wolf', 'wolf', 'berryling'],
  /** Вторая партия: гвардия со знаменем и порождения куста */
  second: ['banner', 'spear', 'spear', 'crossbow', 'hammer', 'slime', 'hedgehog', 'vine', 'bud', 'horror'],
  spear: ['spear', 'spear'],
  vine: ['vine', 'vine', 'vine'],
};
