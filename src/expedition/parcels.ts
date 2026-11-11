import { t } from '../i18n/i18n.ts';
import type { ParcelKind } from '../sim/parcel.ts';

/** Names of the parcels (src/sim/parcel.ts) for the HUD and the camp */
export const PARCEL_TITLE: Record<ParcelKind, string> = {
  'tower:arrow': t('Archer tower'), 'tower:frost': t('Frost spire'), 'tower:splash': t('Catapult'), 'tower:fire': t('Fire brazier'), 'tower:magic': t('Arcane obelisk'),
  volley: t('Spell volley'), heal: t('Healing totem'),
};
export const PARCEL_HINT: Record<ParcelKind, string> = {
  'tower:arrow': t('stands for a minute where it lands'), 'tower:frost': t('stands for a minute where it lands'), 'tower:splash': t('stands for a minute where it lands'),
  'tower:fire': t('stands for a minute where it lands'), 'tower:magic': t('stands for a minute where it lands'),
  volley: t('a strike over an area'), heal: t('mends the heroes around it'),
};
