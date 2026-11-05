import * as THREE from 'three';
import type { Obstacle } from '../collision.ts';
import type { Knight, KnightInput } from '../knight.ts';
import type { Terrain } from '../level/collide.ts';
import type { Pathfinder } from '../level/pathfind.ts';
import type { SimPad } from '../sim/td.ts';
import type { Target } from '../target.ts';
import { HERO, SWORD } from '../tuning.ts';

/**
 * Mouse as in Minecraft Dungeons → hero input (`KnightInput`): LMB on the ground — go there (hold — follows the cursor),
 * LMB on a target — close to sword reach and strike (hold — combo), Shift + LMB — strike in place towards the cursor,
 * a click on a defence pad — walk to its edge. WASD cancels the mouse order. The path around walls — `Pathfinder`.
 * This is the "target → movement → usercmd" layer above the shared input (wiki/arch-layers.md) — the same one the bots will use
 */
export interface Pointer {
  down: boolean;
  shift: boolean;
  /** Cursor on the ground (top of the block under the ray) */
  ground: THREE.Vector3;
  /** Target under the cursor */
  hover: Target | null;
  /** Defence pad under the cursor */
  pad: SimPad | null;
}

export interface OrdersHooks {
  hero: Knight;
  terrain: Terrain;
  pathfinder: Pathfinder;
  solids(): readonly Obstacle[];
  /** A test drives the input — mouse orders only on its "click" */
  scripted(): boolean;
  /** Where to approach the pad (null — no defence) */
  approach(pad: SimPad): THREE.Vector3 | null;
}

export class MouseOrders {
  readonly pointer: Pointer = { down: false, shift: false, ground: new THREE.Vector3(), hover: null, pad: null };
  /** Pad we are walking to after a click: on arrival the menu opens */
  padGoal: SimPad | null = null;
  /** Path around walls: points to walk to */
  path: THREE.Vector3[] = [];
  /** Ring marker on the ground where we were told to go */
  readonly marker: THREE.Mesh;
  private markerT = 0;
  private pointerWas = false;
  /** Mode of the current press: go, hit a target, strike in place, approach a defence pad */
  private pressMode: 'walk' | 'chase' | 'here' | 'pad' = 'walk';
  goal: THREE.Vector3 | null = null;
  chase: Target | null = null;
  /** How many strikes there were at the time of the order: LMB released — one strike at the target is enough */
  private chaseSwings = 0;
  private stuckT = 0;
  private readonly pathTo = new THREE.Vector3(Infinity, 0, 0);
  private repathT = 0;
  private stuckRepaths = 0;
  private arrived = false;
  private readonly h: OrdersHooks;

  constructor(h: OrdersHooks, scene: THREE.Scene) {
    this.h = h;
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.4, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.8, 2), transparent: true, depthWrite: false, toneMapped: false }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    scene.add(this.marker);
  }

  /** There is an order (walking or striking by mouse) */
  get busy(): boolean { return !!(this.goal || this.chase); }

  /** Clear all orders (a test takes over the input, the pad menu opened) */
  reset(): void { this.goal = null; this.chase = null; this.path = []; this.padGoal = null; this.pointer.down = false; }

  /** Turn the mouse into hero input: movement direction, strike point, strike */
  update(dt: number, input: KnightInput): void {
    const hero = this.h.hero, p = this.pointer, scripted = this.h.scripted();
    const keyMove = !scripted ? input.move.lengthSq() > 0.01 : false;
    const pressed = p.down && !this.pointerWas;
    this.pointerWas = p.down;
    // the test drives the input itself until it "clicks" the mouse
    if (scripted && !p.down && !this.goal && !this.chase) return;
    input.attack = false;
    if (keyMove) { this.goal = null; this.chase = null; }
    if (pressed) {
      this.pressMode = p.shift ? 'here' : p.hover ? 'chase' : p.pad ? 'pad' : 'walk';
      this.chase = null; this.goal = null; this.path = []; this.stuckRepaths = 0; this.repathT = 0; this.arrived = false; this.padGoal = null;
      if (this.pressMode === 'chase') { this.chase = p.hover; this.chaseSwings = hero.swings; }
      // click on a defence pad: walk to its edge, the menu opens there
      if (this.pressMode === 'pad' && p.pad) { const to = this.h.approach(p.pad); if (to) { this.padGoal = p.pad; this.goal = to; this.mark(to); } }
      if (this.pressMode === 'walk' && !keyMove) this.mark(p.ground);
    }
    if (p.down && this.pressMode === 'walk' && !keyMove) this.goal = p.ground.clone();
    if (p.down && this.pressMode === 'here') {
      input.attack = true;
      input.aim.copy(p.ground);
      if (!keyMove) input.move.set(0, 0);
      return;
    }
    const chase = this.chase;
    if (chase) {
      if (!chase.alive) this.chase = null;
      else {
        const d = Math.hypot(chase.pos.x - hero.pos.x, chase.pos.z - hero.pos.z);
        input.aim.copy(chase.pos);
        const reach = SWORD.swings[0].range + chase.radius - 0.5;
        // within sword reach: close, at the same height and no wall in between — strike, otherwise walk around
        const canHit = d <= reach && Math.abs(chase.pos.y - hero.pos.y) < 1 && !this.h.terrain.blocked(hero.pos.x, hero.pos.z, chase.pos.x, chase.pos.z, hero.pos.y + 0.5);
        if (!canHit) { this.route(chase.pos, dt); this.walkPath(dt, false, input); }
        else {
          this.path = [];
          input.move.set(0, 0);
          if (p.down || hero.swings === this.chaseSwings) input.attack = true;
          else if (!hero.attacking) this.chase = null;
        }
        return;
      }
    }
    if (this.goal) {
      this.route(this.goal, dt);
      if (this.walkPath(dt, true, input) && !p.down) this.goal = null;
      input.aim.copy(this.goal ?? hero.pos);
      return;
    }
    if (!scripted || keyMove) input.aim.copy(p.ground);
  }

  /** Was walking to a pad after a click: arrived — returns it (order cleared); order cleared — forget */
  reachedPad(input: KnightInput): SimPad | null {
    const pg = this.padGoal;
    if (!pg) return null;
    const hero = this.h.hero, d = Math.hypot(hero.pos.x - pg.pos.x, hero.pos.z - pg.pos.z);
    if (d < 2.3) { this.padGoal = null; this.goal = null; this.path = []; input.move.set(0, 0); return pg; }
    if (!this.goal) this.padGoal = null;
    return null;
  }

  /** Where artifacts and the bow aim: the target under the cursor, otherwise a point on the ground */
  aimPoint(): THREE.Vector3 { const p = this.pointer; return p.hover?.alive ? p.hover.pos.clone() : p.ground.clone(); }

  /** The ground marker fades in half a second */
  updateMarker(dt: number): void {
    this.markerT -= dt;
    this.marker.visible = this.markerT > 0;
    (this.marker.material as THREE.MeshBasicMaterial).opacity = Math.max(0, this.markerT * 2);
    this.marker.scale.setScalar(1 + (0.5 - this.markerT));
  }

  private mark(at: THREE.Vector3): void { this.marker.position.set(at.x, at.y + 0.04, at.z); this.marker.visible = true; this.markerT = 0.5; }

  /**
   * Route a path to `to`: anew only if the target moved more than 0.4 m (no more than once per 0.15 s while the cursor is dragged)
   * or the hero got stuck (repathT reset). The search is expensive — we do not re-route on a timer.
   */
  private route(to: THREE.Vector3, dt: number): void {
    this.repathT -= dt;
    const moved = to.distanceTo(this.pathTo) >= 0.4;
    // arrived (or cannot get closer to an unreachable target) — wait until the target moves
    if (this.arrived && !moved) return;
    if (this.path.length && !(moved && this.repathT <= 0) && this.repathT > -1e8) return;
    this.arrived = false;
    this.path = this.h.pathfinder.find(this.h.hero.pos, to, { solids: this.h.solids() });
    this.pathTo.copy(to);
    this.repathT = 0.15;
  }

  /** Step along the path: direction to the nearest point; true — arrived */
  private walkPath(dt: number, slowAtEnd: boolean, input: KnightInput): boolean {
    const hero = this.h.hero;
    while (this.path.length > 1 && Math.hypot(this.path[0].x - hero.pos.x, this.path[0].z - hero.pos.z) < 0.35) this.path.shift();
    const p = this.path[0];
    if (!p) { input.move.set(0, 0); this.arrived = true; return true; }
    const dx = p.x - hero.pos.x, dz = p.z - hero.pos.z, d = Math.hypot(dx, dz);
    if (this.path.length === 1 && d < HERO.arrive) { this.path = []; input.move.set(0, 0); this.arrived = true; return true; }
    // stuck: re-route; three failures — the order is cleared so the hero does not shove in place
    this.stuckT = hero.touching && hero.speed < 0.5 ? this.stuckT + dt : 0;
    if (this.stuckT > 0.35) { this.stuckT = 0; this.repathT = -1e9; if (++this.stuckRepaths > 3) { this.path = []; input.move.set(0, 0); this.arrived = true; return true; } }
    input.move.set(dx / d, dz / d).multiplyScalar(slowAtEnd && this.path.length === 1 ? Math.min(1, d / 0.6 + 0.35) : 1);
    return false;
  }
}
