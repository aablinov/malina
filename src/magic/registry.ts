import type { BossSpellKind } from '../items';
import { DARK_ARCANE } from './dark-arcane';
import { EARTH } from './earth';
import { FIRE_ICE } from './fire-ice';
import type { BossSpell } from './kit';
import { STORM_LIGHT } from './storm-light';
import { BASE_BLOOD } from './base-blood';
import { BASE_FIRE } from './base-fire';
import { BASE_LIGHT } from './base-light';
import { BASE_SUMMON } from './base-summon';

export type { BossSpell, Tier } from './kit';

/** Все заклинания, кроме стартовых, по id предмета (src/items.ts): с боссов и базовые у торговца */
export const BOSS_SPELLS: Partial<Record<string, BossSpell>> = { ...FIRE_ICE, ...STORM_LIGHT, ...DARK_ARCANE, ...EARTH, ...BASE_FIRE, ...BASE_SUMMON, ...BASE_BLOOD, ...BASE_LIGHT } satisfies Partial<Record<BossSpellKind, BossSpell>>;
