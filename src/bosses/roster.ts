import type * as THREE from 'three';
import type { Rect } from './arena.ts';
import type { BossHooks } from './kit.ts';
import type { MiniBoss } from './mini.ts';
import { Cauldron } from './cauldron.ts';
// IMPORTS: каждый страж — своя строка импорта ниже
import { FrostBoar } from './boar.ts';
import { StormGolem } from './storm-golem.ts';
import { GoldenRider } from './golden-rider.ts';
import { NightRider } from './night-rider.ts';
import { DruseGolem } from './druse-golem.ts';
import { Gatherer } from './gatherer.ts';
import { GraveCat } from './grave-cat.ts';
import { CrimsonSerpent } from './serpent.ts';
import { ThunderBeast } from './thunder-beast.ts';
import { StarQueen } from './star-queen.ts';
import { OrderJudge } from './judge.ts';
import { GeneralRdyan } from './general.ts';
import { WinterMistress } from './winter-mistress.ts';
import { FallenStar } from './fallen-star.ts';
import { FirstGardener } from './first-gardener.ts';

/** Мини-боссы зала стражей (wiki/design-bosses.md, раздел 2): id арены → страж */
export type MiniBossCtor = new (h: BossHooks, home: THREE.Vector3, yaw: number, arena: Rect) => MiniBoss;

export const MINI_BOSSES: Record<string, MiniBossCtor> = {
  cauldron: Cauldron,
  boar: FrostBoar,
  storm: StormGolem,
  golden: GoldenRider,
  night: NightRider,
  druse: DruseGolem,
  gatherer: Gatherer,
  cat: GraveCat,
  serpent: CrimsonSerpent,
  beast: ThunderBeast,
  queen: StarQueen,
  judge: OrderJudge,
  general: GeneralRdyan,
  winter: WinterMistress,
  star: FallenStar,
  gardener: FirstGardener,
};
