import type * as THREE from 'three';
import type { Mob, MobHooks } from './mob';
import { BerryHealer, EmberMage, VineSummoner } from './mages';
import { ShieldKnight, Squire } from './knights';
import { Berryling, RaspWolf, WitheredGardener } from './critters';

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
};

/** Отряды для витрины: кто в каком количестве выходит по кнопке */
export const SQUADS: Record<string, readonly string[]> = {
  berryling: ['berryling', 'berryling', 'berryling', 'berryling'],
  wolf: ['wolf', 'wolf', 'wolf'],
  gardener: ['gardener', 'gardener', 'gardener'],
  /** Первая партия вместе: рыцари со щитом впереди, маги за ними */
  first: ['shield', 'squire', 'squire', 'healer', 'pyro', 'summoner', 'gardener', 'wolf', 'wolf', 'berryling'],
};
