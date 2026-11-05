import type * as THREE from 'three';

/**
 * Decoys (wiki/design-spells.md, "Base spells"): summoned wolves, elementals and golems, and in Bush Defence —
 * the bush, walls and towers (siege). A mob picks the nearest target among the hero and the decoys; a decoy with taunt pulls everyone
 * within that radius onto itself even if the hero is closer. Mob damage to a decoy goes to its hurt, not to the hero (src/mobs/mob.ts).
 * The list belongs to the world (`SimWorld.decoys`): it is current for the duration of a step (`useDecoys`), so matches in one process do not mix
 */
export interface Decoy {
  readonly pos: THREE.Vector3;
  readonly radius: number;
  readonly alive: boolean;
  /** Radius within which the decoy pulls mobs off the hero onto itself, m */
  readonly taunt?: number;
  /** Siege target (a Bush Defence tower): only hunters see it (Mob.hunter), the rest walk past */
  readonly siege?: boolean;
  hurt(dmg: number, from: THREE.Vector3): void;
  /** Freeze for sec seconds (tower); false — does not freeze */
  freeze?(sec: number): boolean;
}

/** List outside a world step (playground without defence, tests) */
const DEFAULT: Decoy[] = [];
let current: Decoy[] = DEFAULT;

/** Current decoys */
export function decoyList(): readonly Decoy[] { return current; }
/** Make the list current; returns a rollback */
export function useDecoys(list: Decoy[]): () => void { const prev = current; current = list; return () => { current = prev; }; }

export function addDecoy(d: Decoy, list: Decoy[] = current): () => void {
  list.push(d);
  return () => { const i = list.indexOf(d); if (i >= 0) list.splice(i, 1); };
}

/**
 * Target of a mob at point at: a decoy or null (then — the hero). hunter — the mob hunts towers: it sees siege decoys
 * if they are no farther than reachY in height (a tower on the castle wall cannot be chewed from the ground, but a snowball reaches it)
 */
export function pickDecoy(at: THREE.Vector3, hero: THREE.Vector3, aggro: number, hunter = false, reachY = 1.5, list: readonly Decoy[] = current): Decoy | null {
  const dh = Math.hypot(hero.x - at.x, hero.z - at.z);
  let best: Decoy | null = null, bd = Infinity;
  for (const d of list) {
    if (!d.alive) continue;
    if (d.siege && (!hunter || Math.abs(d.pos.y - at.y) > reachY)) continue;
    const dist = Math.hypot(d.pos.x - at.x, d.pos.z - at.z);
    if (dist > Math.max(aggro, d.taunt ?? 0)) continue;
    const score = d.taunt && dist < d.taunt ? dist - 100 : dist;
    if (score < bd) { bd = score; best = d; }
  }
  return best && (bd < 0 || bd < dh) ? best : null;
}
