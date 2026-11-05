import type * as THREE from 'three';
import type { Mob, MobHooks } from './mob.ts';
import { BerryHealer, EmberMage, VineSummoner } from './mages.ts';
import { BannerBearer, Crossbowman, Hammerer, ShieldKnight, Spearman, Squire } from './knights.ts';
import { Berryling, RaspWolf, WitheredGardener } from './critters.ts';
import { Reaper, BoneArcher, Wisp, Crow, Scarecrow } from './fallen.ts';
import { Boarlet, BurrowBeetle, VineSpider, Bee, Hive } from './beasts.ts';
import { BasketMimic, DruseGolemling, HopPot, JamKeg, WardObelisk } from './constructs.ts';
import { SunKnight } from './soller.ts';
import { BeaverGnawer, BerryRunner, CrystalShellback, FrostImp, PollenMoth, RainbowHopper, Sporeling, VineRam, StumpSapper, VineBallista } from './td-foes.ts';
import { RaspberryBrute, SlimeQueen, SnowShaman } from './td-chiefs.ts';
import { BerrySlime, BerrySlimeMid, BerrySlimeSmall, BudSpitter, ThornBall, ThornHorror, VineWhip } from './bush.ts';
import { t } from '../i18n/i18n.ts';

/** Rank-and-file mobs (wiki/design-mobs.md): id → name and class. Numbers are from the list of thirty */
export type MobCtor = new (h: MobHooks, at: THREE.Vector3) => Mob;

export const MOBS: Record<string, { title: string; make: MobCtor }> = {
  healer: { title: t('Berry Healer'), make: BerryHealer },
  pyro: { title: t('Ember Mage'), make: EmberMage },
  summoner: { title: t('Vine Summoner'), make: VineSummoner },
  squire: { title: t('Squire'), make: Squire },
  shield: { title: t('Shieldbearer'), make: ShieldKnight },
  berryling: { title: t('Berryling'), make: Berryling },
  gardener: { title: t('Withered Gardener'), make: WitheredGardener },
  wolf: { title: t('Raspberry Wolf'), make: RaspWolf },
  // second batch: knights and bush spawn
  spear: { title: t('Spearman'), make: Spearman },
  crossbow: { title: t('Crossbowman'), make: Crossbowman },
  banner: { title: t('Bannerman'), make: BannerBearer },
  hammer: { title: t('Hammerer'), make: Hammerer },
  slime: { title: t('Berry Slime'), make: BerrySlime },
  slime_mid: { title: t('Medium Slime'), make: BerrySlimeMid },
  slime_small: { title: t('Small Slime'), make: BerrySlimeSmall },
  hedgehog: { title: t('Prickle Ball'), make: ThornBall },
  vine: { title: t('Whip Vine'), make: VineWhip },
  bud: { title: t('Spitting Bud'), make: BudSpitter },
  horror: { title: t('Bramble Horror'), make: ThornHorror },
  // third batch: fallen gardeners and beasts
  reaper: { title: t('Sickle Reaper'), make: Reaper },
  archer: { title: t('Bone Archer'), make: BoneArcher },
  wisp: { title: t('Mourning Wisp'), make: Wisp },
  scarecrow: { title: t('Scarecrow'), make: Scarecrow },
  crow: { title: t('Crow'), make: Crow },
  boarlet: { title: t('Berry Boarlet'), make: Boarlet },
  beetle: { title: t('Berry Beetle'), make: BurrowBeetle },
  spider: { title: t('Vine Weaver'), make: VineSpider },
  hive: { title: t('Order Hive'), make: Hive },
  bee: { title: t('Bumblebee'), make: Bee },
  // fourth batch: constructs and relics
  druseling: { title: t('Druse Golemling'), make: DruseGolemling },
  pot: { title: t('Hopping Pot'), make: HopPot },
  obelisk: { title: t('Guardian Obelisk'), make: WardObelisk },
  mimic: { title: t('Basket Mimic'), make: BasketMimic },
  keg: { title: t('Jam Keg'), make: JamKeg },
  // loners: rare strong warriors
  soller: { title: t('Soller Knight of the Sun'), make: SunKnight },
  // Bush Defence foes (src/mobs/td-foes.ts, wiki/design-tower-defence.md): march along the roads, barely notice the hero
  runner: { title: t('Berry Courier'), make: BerryRunner },
  ram: { title: t('Vine Battering Ram'), make: VineRam },
  moth: { title: t('Pollen Moth'), make: PollenMoth },
  shellback: { title: t('Crystal Shellback'), make: CrystalShellback },
  sporeling: { title: t('Sporeling'), make: Sporeling },
  hopper: { title: t('Rainbow Hopper'), make: RainbowHopper },
  sapper: { title: t('Stump Sapper'), make: StumpSapper },
  ballista: { title: t('Vine Ballista'), make: VineBallista },
  gnawer: { title: t('Gnawer Beaver'), make: BeaverGnawer },
  frostling: { title: t('Ice Warlock'), make: FrostImp },
  chief_brute: { title: t('Raspberry Giant'), make: RaspberryBrute },
  chief_slime: { title: t('Slime Queen'), make: SlimeQueen },
  chief_frost: { title: t('Snow Shaman'), make: SnowShaman },
};

/** Bush Defence foes — not needed in the playground showcase buttons, they come in waves */
export const TD_FOES = new Set(['runner', 'ram', 'moth', 'shellback', 'sporeling', 'hopper', 'sapper', 'ballista', 'gnawer', 'frostling', 'chief_brute', 'chief_slime', 'chief_frost']);

/** Slime fragments, scarecrow crows, hive bumblebees — present in the pack, not needed in the showcase buttons */
export const MOB_PARTS = new Set(['slime_mid', 'slime_small', 'crow', 'bee']);

/** Squads for the showcase: who comes out by the button and how many */
export const SQUADS: Record<string, readonly string[]> = {
  berryling: ['berryling', 'berryling', 'berryling', 'berryling'],
  wolf: ['wolf', 'wolf', 'wolf'],
  gardener: ['gardener', 'gardener', 'gardener'],
  /** First batch together: shield knights in front, mages behind them */
  first: ['shield', 'squire', 'squire', 'healer', 'pyro', 'summoner', 'gardener', 'wolf', 'wolf', 'berryling'],
  /** Second batch: the guard with a banner and bush spawn */
  second: ['banner', 'spear', 'spear', 'crossbow', 'hammer', 'slime', 'hedgehog', 'vine', 'bud', 'horror'],
  /** Third batch: fallen gardeners and beasts */
  third: ['reaper', 'reaper', 'archer', 'wisp', 'wisp', 'scarecrow', 'boarlet', 'beetle', 'spider', 'hive'],
  /** Fourth batch: constructs — the obelisk shields the golemling and the pots */
  fourth: ['obelisk', 'druseling', 'pot', 'pot', 'mimic', 'keg', 'keg', 'keg'],
  keg: ['keg', 'keg', 'keg'],
  reaper: ['reaper', 'reaper'],
  wisp: ['wisp', 'wisp', 'wisp'],
  spear: ['spear', 'spear'],
  vine: ['vine', 'vine', 'vine'],
};
