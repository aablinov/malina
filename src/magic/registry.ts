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
import { RELICS } from './relics.ts';
import { STARTERS } from './starters.ts';

export type { Spell, Tier } from './kit.ts';

/** All spells by item id (src/items.ts): starters, base ones from the merchant, boss spells and relics from enemies */
export const SPELLS: Record<SpellKind, Spell> = { ...STARTERS, ...FIRE_ICE, ...STORM_LIGHT, ...DARK_ARCANE, ...EARTH, ...BASE_FIRE, ...BASE_SUMMON, ...BASE_BLOOD, ...BASE_LIGHT, ...RELICS };

/** Spell by artifact kind; an ordinary artifact (fire arrow, totem…) — null */
export const spellOf = (kind: string): Spell | null => (SPELLS as Partial<Record<string, Spell>>)[kind] ?? null;
