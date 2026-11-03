import type { SpellKind } from '../items.ts';
import { DARK_ARCANE } from './dark-arcane.ts';
import { EARTH } from './earth.ts';
import { FIRE_ICE } from './fire-ice.ts';
import type { Spell } from './kit.ts';
import { STORM_LIGHT } from './storm-light.ts';
import { BASE_BLOOD } from './base-blood.ts';
import { BASE_FIRE } from './base-fire.ts';
import { BASE_LIGHT } from './base-light.ts';
import { BASE_SUMMON } from './base-summon.ts';
import { STARTERS } from './starters.ts';

export type { Spell, Tier } from './kit.ts';

/** Все заклинания по id предмета (src/items.ts): стартовые, базовые у торговца и с боссов */
export const SPELLS: Record<SpellKind, Spell> = { ...STARTERS, ...FIRE_ICE, ...STORM_LIGHT, ...DARK_ARCANE, ...EARTH, ...BASE_FIRE, ...BASE_SUMMON, ...BASE_BLOOD, ...BASE_LIGHT };

/** Заклинание по виду артефакта; обычный артефакт (огненная стрела, тотем…) — null */
export const spellOf = (kind: string): Spell | null => (SPELLS as Partial<Record<string, Spell>>)[kind] ?? null;
