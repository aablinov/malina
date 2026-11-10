import type * as THREE from 'three';
import type { Obstacle } from '../collision.ts';
import type { ExpeditionSpec } from '../expedition/types.ts';
import { t } from '../i18n/i18n.ts';
import type { EntityState } from '../net/snapshot.ts';
import type { Target } from '../target.ts';
import { clampRating, lootK } from '../td/scaling.ts';
import { Garrisons } from './garrison.ts';
import type { Rules, RulesCommand, RulesState } from './rules.ts';
import type { SimWorld } from './world.ts';

/**
 * Expedition rules (wiki/design-expeditions.md): the squad lands on a seeded map with garrisons and patrols. So far — the
 * map's population, the purses and the match loot; objectives, seeds and extraction come with stage 3
 */
export class SimExpedition implements Rules {
  readonly spec: ExpeditionSpec;
  readonly garrisons: Garrisons;
  state: RulesState = 'play';
  players: number;
  rating = 1;
  fallen = 0;
  readonly personal: boolean;
  private readonly purses = new Map<number, number>();
  private readonly loots = new Map<number, number>();
  /** Hint to the player (seat, text) */
  onToast: ((seat: number, text: string) => void) | null = null;
  private readonly w: SimWorld;
  private readonly none: Obstacle[] = [];

  constructor(w: SimWorld, spec: ExpeditionSpec, players: number, personal: boolean) {
    this.w = w;
    this.spec = spec;
    this.players = Math.max(1, Math.round(players));
    this.personal = personal;
    w.h.setScale(this.base, this.players);
    this.garrisons = new Garrisons(w, spec.garrisons);
    w.piles.onPick = (seat, n) => this.gain(seat, n);
  }

  /** Pack level: the mission's plus the heroes' strength */
  get base(): number { return this.spec.level + this.rating - 1; }
  get stage(): number { return 0; }
  get progress(): number { return 0; }
  get goal(): number { return this.spec.objective.sites.length; }
  get paid(): boolean { return this.state === 'won'; }
  get solids(): Obstacle[] { return this.none; }
  get foeSolids(): Obstacle[] { return this.none; }
  get muster(): [number, number, number] { const l = this.spec.landings[0]; return [l.x, this.w.floor(l.x, l.z, 2), l.z]; }
  targets(): Target[] { return []; }

  setPlayers(n: number): void { this.players = Math.max(1, Math.round(n)); this.w.h.setScale(this.base, this.players); }
  setRating(r: number): void { this.rating = clampRating(r); this.setPlayers(this.players); }

  private key(seat: number): number { return this.personal ? seat : 0; }
  berries(seat = 0): number { return this.purses.get(this.key(seat)) ?? 0; }
  gain(seat: number, n: number): void { this.purses.set(this.key(seat), Math.max(0, this.berries(seat) + n)); }
  fund(seat: number): void { if (!this.purses.has(this.key(seat))) this.purses.set(this.key(seat), 0); }
  spend(seat: number, cost: number): boolean {
    if (cost <= 0) return true;
    if (this.berries(seat) < cost) { this.onToast?.(seat, t('Not enough raspberries: {cost} needed', { cost })); return false; }
    this.gain(seat, -cost);
    return true;
  }
  lootOf(seat = 0): number { return Math.floor(this.loots.get(this.key(seat)) ?? 0); }

  killed(at: THREE.Vector3, pile: number, base: number): void {
    this.fallen++;
    this.w.piles.drop(at, pile);
    if (this.state !== 'play') return;
    const n = base * lootK(this.rating);
    for (const seat of this.purses.keys()) this.loots.set(seat, (this.loots.get(seat) ?? 0) + n);
  }

  command(_seat: number, _c: RulesCommand): boolean { return false; }

  update(_dt: number): void { this.garrisons.update(); }

  entities(out: EntityState[]): void {
    out.push({ id: 'exp', state: this.state, players: this.players, rating: this.rating, fallen: this.fallen, guards: this.garrisons.alive });
    for (const [seat, n] of this.purses) out.push({ id: `purse${seat}`, seat, n });
    for (const seat of this.purses.keys()) out.push({ id: `loot${seat}`, seat, n: this.lootOf(seat) });
  }
}
