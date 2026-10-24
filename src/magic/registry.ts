import type { BossSpellKind } from '../items';
import { DARK_ARCANE } from './dark-arcane';
import { EARTH } from './earth';
import { FIRE_ICE } from './fire-ice';
import type { BossSpell } from './kit';
import { STORM_LIGHT } from './storm-light';

export type { BossSpell, Tier } from './kit';

/** Все заклинания с боссов по id предмета (src/items.ts) */
export const BOSS_SPELLS: Partial<Record<string, BossSpell>> = { ...FIRE_ICE, ...STORM_LIGHT, ...DARK_ARCANE, ...EARTH } satisfies Partial<Record<BossSpellKind, BossSpell>>;
