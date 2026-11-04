import * as THREE from 'three';
import type { Obstacle } from '../collision.ts';
import type { Knight, KnightInput } from '../knight.ts';
import type { Terrain } from '../level/collide.ts';
import type { Pathfinder } from '../level/pathfind.ts';
import type { SimPad } from '../sim/td.ts';
import type { Target } from '../target.ts';
import { HERO, SWORD } from '../tuning.ts';

/**
 * Мышь как в Minecraft Dungeons → ввод героя (`KnightInput`): ЛКМ по земле — идти туда (держишь — идёт за курсором),
 * ЛКМ по цели — подойти на длину меча и бить (держишь — комбо), Shift + ЛКМ — бить на месте в сторону курсора,
 * клик по площадке обороны — подойти к её краю. WASD отменяет приказ мыши. Путь в обход стен — `Pathfinder`.
 * Это слой «цель → движение → usercmd» над общим вводом (wiki/arch-layers.md) — тот же, каким пойдут боты
 */
export interface Pointer {
  down: boolean;
  shift: boolean;
  /** Курсор на земле (верх блока под лучом) */
  ground: THREE.Vector3;
  /** Цель под курсором */
  hover: Target | null;
  /** Площадка обороны под курсором */
  pad: SimPad | null;
}

export interface OrdersHooks {
  hero: Knight;
  terrain: Terrain;
  pathfinder: Pathfinder;
  solids(): readonly Obstacle[];
  /** Ввод ведёт тест — приказы мыши только по его «клику» */
  scripted(): boolean;
  /** Куда подойти к площадке (null — обороны нет) */
  approach(pad: SimPad): THREE.Vector3 | null;
}

export class MouseOrders {
  readonly pointer: Pointer = { down: false, shift: false, ground: new THREE.Vector3(), hover: null, pad: null };
  /** Площадка, к которой идём по клику: дошли — откроется меню */
  padGoal: SimPad | null = null;
  /** Путь в обход стен: точки, к которым идти */
  path: THREE.Vector3[] = [];
  /** Кольцо-метка на земле, куда велели идти */
  readonly marker: THREE.Mesh;
  private markerT = 0;
  private pointerWas = false;
  /** Режим текущего нажатия: идти, бить цель, бить на месте, подойти к площадке обороны */
  private pressMode: 'walk' | 'chase' | 'here' | 'pad' = 'walk';
  goal: THREE.Vector3 | null = null;
  chase: Target | null = null;
  /** Сколько ударов было на момент приказа: отпустил ЛКМ — хватит одного удара по цели */
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

  /** Приказ есть (идёт или бьёт по мыши) */
  get busy(): boolean { return !!(this.goal || this.chase); }

  /** Снять все приказы (тест берёт ввод на себя, меню площадки открылось) */
  reset(): void { this.goal = null; this.chase = null; this.path = []; this.padGoal = null; this.pointer.down = false; }

  /** Превратить мышь в ввод героя: направление движения, точка удара, удар */
  update(dt: number, input: KnightInput): void {
    const hero = this.h.hero, p = this.pointer, scripted = this.h.scripted();
    const keyMove = !scripted ? input.move.lengthSq() > 0.01 : false;
    const pressed = p.down && !this.pointerWas;
    this.pointerWas = p.down;
    // тест управляет вводом сам, пока не «кликает» мышью
    if (scripted && !p.down && !this.goal && !this.chase) return;
    input.attack = false;
    if (keyMove) { this.goal = null; this.chase = null; }
    if (pressed) {
      this.pressMode = p.shift ? 'here' : p.hover ? 'chase' : p.pad ? 'pad' : 'walk';
      this.chase = null; this.goal = null; this.path = []; this.stuckRepaths = 0; this.repathT = 0; this.arrived = false; this.padGoal = null;
      if (this.pressMode === 'chase') { this.chase = p.hover; this.chaseSwings = hero.swings; }
      // клик по площадке обороны: подойти к её краю, там откроется меню
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
        // достаёт мечом: рядом, на той же высоте и без стены между — бить, иначе — идти в обход
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

  /** Шёл к площадке по клику: подошёл — вернёт её (приказ снят); приказ сняли — забыть */
  reachedPad(input: KnightInput): SimPad | null {
    const pg = this.padGoal;
    if (!pg) return null;
    const hero = this.h.hero, d = Math.hypot(hero.pos.x - pg.pos.x, hero.pos.z - pg.pos.z);
    if (d < 2.3) { this.padGoal = null; this.goal = null; this.path = []; input.move.set(0, 0); return pg; }
    if (!this.goal) this.padGoal = null;
    return null;
  }

  /** Куда целятся артефакты и лук: цель под курсором, иначе точка на земле */
  aimPoint(): THREE.Vector3 { const p = this.pointer; return p.hover?.alive ? p.hover.pos.clone() : p.ground.clone(); }

  /** Метка на земле гаснет за полсекунды */
  updateMarker(dt: number): void {
    this.markerT -= dt;
    this.marker.visible = this.markerT > 0;
    (this.marker.material as THREE.MeshBasicMaterial).opacity = Math.max(0, this.markerT * 2);
    this.marker.scale.setScalar(1 + (0.5 - this.markerT));
  }

  private mark(at: THREE.Vector3): void { this.marker.position.set(at.x, at.y + 0.04, at.z); this.marker.visible = true; this.markerT = 0.5; }

  /**
   * Проложить путь к to: заново — только если цель сдвинулась больше чем на 0,4 м (не чаще раза в 0,15 с, пока тянут курсор)
   * или герой упёрся (repathT сброшен). Поиск дорогой — по таймеру путь не перекладываем.
   */
  private route(to: THREE.Vector3, dt: number): void {
    this.repathT -= dt;
    const moved = to.distanceTo(this.pathTo) >= 0.4;
    // пришли (или ближе к недостижимой цели не подойти) — ждём, пока цель сдвинется
    if (this.arrived && !moved) return;
    if (this.path.length && !(moved && this.repathT <= 0) && this.repathT > -1e8) return;
    this.arrived = false;
    this.path = this.h.pathfinder.find(this.h.hero.pos, to, { solids: this.h.solids() });
    this.pathTo.copy(to);
    this.repathT = 0.15;
  }

  /** Шаг по пути: направление к ближайшей точке; true — пришли */
  private walkPath(dt: number, slowAtEnd: boolean, input: KnightInput): boolean {
    const hero = this.h.hero;
    while (this.path.length > 1 && Math.hypot(this.path[0].x - hero.pos.x, this.path[0].z - hero.pos.z) < 0.35) this.path.shift();
    const p = this.path[0];
    if (!p) { input.move.set(0, 0); this.arrived = true; return true; }
    const dx = p.x - hero.pos.x, dz = p.z - hero.pos.z, d = Math.hypot(dx, dz);
    if (this.path.length === 1 && d < HERO.arrive) { this.path = []; input.move.set(0, 0); this.arrived = true; return true; }
    // упёрся: перепроложить путь; не помогло трижды — приказ снимается, чтобы герой не толкался на месте
    this.stuckT = hero.touching && hero.speed < 0.5 ? this.stuckT + dt : 0;
    if (this.stuckT > 0.35) { this.stuckT = 0; this.repathT = -1e9; if (++this.stuckRepaths > 3) { this.path = []; input.move.set(0, 0); this.arrived = true; return true; } }
    input.move.set(dx / d, dz / d).multiplyScalar(slowAtEnd && this.path.length === 1 ? Math.min(1, d / 0.6 + 0.35) : 1);
    return false;
  }
}
