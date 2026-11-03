import * as THREE from 'three';
import type { BossHooks } from '../bosses/kit.ts';
import type { Knight } from '../knight.ts';
import type { Target } from '../target.ts';
import type { Mob, MobHooks } from './mob.ts';
import { MOBS } from './roster.ts';

/**
 * Стая рядовых мобов (wiki/design-mobs.md): кто жив, кого призвали, толкотня, масштаб и малина с павших.
 * Уровень и число игроков — как у стражей (src/bosses/scaling.ts).
 */
export class Pack {
  readonly mobs: Mob[] = [];
  private level = 1;
  private players = 1;
  /** Стая гостя общего боя: куклы по снимку хоста */
  mirror = false;
  /** Счётчик сетевых id (записи снимка, src/game/match.ts) */
  private seq = 0;
  private readonly hooks: MobHooks;

  /** loot — малина с павшего: где и сколько */
  private readonly loot: (at: THREE.Vector3, n: number) => void;
  constructor(h: BossHooks, loot: (at: THREE.Vector3, n: number) => void) { this.loot = loot;
    // куклы клиента (src/cgame/net-battle.ts) никого не призывают: призванных пришлёт снимок сервера
    this.hooks = { ...h, allies: () => this.mobs.filter((m) => m.alive), spawn: (kind, at) => (this.mirror ? null : this.spawn(kind, at)) };
  }

  /** Моб из реестра в точке (null — нет такого) */
  spawn(kind: string, at: THREE.Vector3): Mob | null {
    const def = MOBS[kind];
    if (!def) return null;
    const m = new def.make(this.hooks, at);
    m.setScale(this.level, this.players);
    m.net = ++this.seq;
    m.onDeath = (p) => { if (!m.summoned) this.loot(p, Math.max(1, Math.round(m.loot * m.lootMult))); };
    this.mobs.push(m);
    return m;
  }

  /** Отряд: kinds вокруг точки, кольцом радиуса spread */
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

  /** Замедление героя от зон стаи */
  get heroSlow(): number { return this.slowFor(null); }
  /** Замедление героя от зон тех, кто за ним гонится (общий бой: k — герой гостя, null — свой) */
  slowFor(k: Knight | null): number { return this.mobs.reduce((a, m) => ((m.target ?? null) === k ? Math.max(a, m.heroSlow) : a), 0); }

  targets(): Target[] { return [...this.mobs.filter((m) => m.alive), ...this.mobs.flatMap((m) => m.extras())]; }

  update(dt: number): void {
    // призванные в этом кадре думают со следующего
    const list = this.mobs.slice();
    for (const m of list) m.update(dt);
    // толкотня: живые не стоят друг в друге, лёгкий уступает тяжёлому
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

  /** Кукол (гость общего боя) — только шаг и поза по снимку хоста; рассыпавшихся убрать */
  puppets(dt: number): void {
    for (const m of this.mobs) m.puppetStep(dt);
    for (let i = this.mobs.length - 1; i >= 0; i--) if (this.mobs[i].gone) { this.mobs[i].dispose(); this.mobs.splice(i, 1); }
  }

  /** Убрать всех */
  clear(): void { for (const m of this.mobs.splice(0)) m.dispose(); }
}
