import type * as THREE from 'three';
import type { Rect } from './arena';
import type { BossHooks } from './kit';
import type { MiniBoss } from './mini';
import { Cauldron } from './cauldron';
// IMPORTS: каждый страж — своя строка импорта ниже
import { FrostBoar } from './boar';
import { StormGolem } from './storm-golem';
import { GoldenRider } from './golden-rider';
import { NightRider } from './night-rider';
import { DruseGolem } from './druse-golem';
import { Gatherer } from './gatherer';
import { GraveCat } from './grave-cat';
import { CrimsonSerpent } from './serpent';
import { ThunderBeast } from './thunder-beast';
import { StarQueen } from './star-queen';
import { OrderJudge } from './judge';
import { GeneralRdyan } from './general';
import { WinterMistress } from './winter-mistress';
import { FallenStar } from './fallen-star';
import { FirstGardener } from './first-gardener';

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
