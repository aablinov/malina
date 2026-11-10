import * as THREE from 'three';
import type { BossHooks } from '../bosses/kit.ts';
import type { Knight } from '../knight.ts';
import type { Target } from '../target.ts';
import type { Mob, MobHooks } from './mob.ts';
import { MOBS } from './roster.ts';

/**
 * Pack of rank-and-file mobs (wiki/design-mobs.md): who is alive, who was summoned, jostling, scaling and raspberries from the fallen.
 * Level and player count as for wardens (src/bosses/scaling.ts).
 */
export class Pack {
  readonly mobs: Mob[] = [];
  private level = 1;
  private players = 1;
  /** Pack of a shared-battle guest: puppets by the host snapshot */
  mirror = false;
  /** Network id counter (snapshot records, src/game/match.ts) */
  private seq = 0;
  private readonly hooks: MobHooks;

  /** loot — raspberries from the fallen: where and how many (n — the pile, base — the mob's own loot before scaling) */
  private readonly loot: (at: THREE.Vector3, n: number, base: number, kind: string) => void;
  constructor(h: BossHooks, loot: (at: THREE.Vector3, n: number, base: number, kind: string) => void) { this.loot = loot;
    // client puppets (src/cgame/net-battle.ts) summon nobody: the server snapshot will send the summoned
    this.hooks = { ...h, allies: () => this.mobs.filter((m) => m.alive), spawn: (kind, at) => (this.mirror ? null : this.spawn(kind, at)) };
  }

  /** A mob from the registry at a point (null — no such mob) */
  spawn(kind: string, at: THREE.Vector3): Mob | null {
    const def = MOBS[kind];
    if (!def) return null;
    const m = new def.make(this.hooks, at);
    m.setScale(this.level, this.players);
    m.net = ++this.seq;
    m.onDeath = (p) => { if (!m.summoned) this.loot(p, Math.max(1, Math.round(m.loot * m.lootMult)), m.loot, kind); };
    this.mobs.push(m);
    return m;
  }

  /** Squad: kinds around a point, in a ring of radius spread */
  squad(kinds: readonly string[], at: THREE.Vector3, spread = 2.5): Mob[] {
    const out: Mob[] = [];
    kinds.forEach((k, i) => {
      const a = (i / kinds.length) * Math.PI * 2, r = kinds.length > 1 ? spread : 0;
      const m = this.spawn(k, at.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)));
      if (m) out.push(m);
    });
    return out;
  }

  setScale(level: number, players: number): void {
    this.level = level;
    this.players = players;
    for (const m of this.mobs) m.setScale(level, players);
  }

  /** Hero slow from the pack's zones */
  get heroSlow(): number { return this.slowFor(null); }
  /** Hero slow from the zones of those chasing him (shared battle: k — a guest's hero, null — own) */
  slowFor(k: Knight | null): number { return this.mobs.reduce((a, m) => ((m.target ?? null) === k ? Math.max(a, m.heroSlow) : a), 0); }

  targets(): Target[] { return [...this.mobs.filter((m) => m.alive), ...this.mobs.flatMap((m) => m.extras())]; }

  update(dt: number): void {
    // those summoned this frame think from the next one
    const list = this.mobs.slice();
    for (const m of list) m.update(dt);
    // jostling: the living do not stand inside each other, the light yields to the heavy
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.dead) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.dead) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz), R = a.radius + b.radius;
        if (d >= R || d < 1e-4) continue;
        const k = (R - d) / d, wa = b.mass / (a.mass + b.mass);
        a.pos.x -= dx * k * wa; a.pos.z -= dz * k * wa;
        b.pos.x += dx * k * (1 - wa); b.pos.z += dz * k * (1 - wa);
      }
    }
    for (let i = this.mobs.length - 1; i >= 0; i--) if (this.mobs[i].gone) { this.mobs[i].dispose(); this.mobs.splice(i, 1); }
  }

  /** Puppets (shared-battle guest) — only step and pose by the host snapshot; remove the crumbled */
  puppets(dt: number): void {
    for (const m of this.mobs) m.puppetStep(dt);
    for (let i = this.mobs.length - 1; i >= 0; i--) if (this.mobs[i].gone) { this.mobs[i].dispose(); this.mobs.splice(i, 1); }
  }

  /** Remove everyone */
  clear(): void { for (const m of this.mobs.splice(0)) m.dispose(); }
}
