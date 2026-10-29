import type { SpellKind } from '../items';
import { DARK_ARCANE } from './dark-arcane';
import { EARTH } from './earth';
import { FIRE_ICE } from './fire-ice';
import type { Spell } from './kit';
import { STORM_LIGHT } from './storm-light';
import { BASE_BLOOD } from './base-blood';
import { BASE_FIRE } from './base-fire';
import { BASE_LIGHT } from './base-light';
import { BASE_SUMMON } from './base-summon';
import { STARTERS } from './starters';

export type { Spell, Tier } from './kit';

/** Все заклинания по id предмета (src/items.ts): стартовые, базовые у торговца и с боссов */
export const SPELLS: Record<SpellKind, Spell> = { ...STARTERS, ...FIRE_ICE, ...STORM_LIGHT, ...DARK_ARCANE, ...EARTH, ...BASE_FIRE, ...BASE_SUMMON, ...BASE_BLOOD, ...BASE_LIGHT };

/** Заклинание по виду артефакта; обычный артефакт (огненная стрела, тотем…) — null */
export const spellOf = (kind: string): Spell | null => (SPELLS as Partial<Record<string, Spell>>)[kind] ?? null;
