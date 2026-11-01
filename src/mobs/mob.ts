import * as THREE from 'three';
import { resolveCircle } from '../collision';
import { HERO } from '../tuning';
import { boom, hiss } from '../spell-audio';
import { Boss, C, rand, RASP, wrap, type BossHooks } from '../bosses/kit';
import { Field } from '../bosses/field';
import type { Target } from '../target';
import { pickDecoy, type Decoy } from '../decoys';

/**
 * Рядовой моб Ордена Малины (wiki/design-mobs.md): облегчённый мозг мини-босса — без арены, ярости и сердца.
 * Стоит, пока не увидит героя (или пока его не ударят), потом погоня с удержанием дистанции → атака с меткой на полу →
 * иногда оглушение → смерть: рассыпается кубиками, из него — малина. Одна атака и один трюк; тело — 1–6 подвижных частей.
 */

export type MobState = 'spawn' | 'idle' | 'walk' | 'attack' | 'daze' | 'dead';

export interface MobHooks extends BossHooks {
  /** Живые мобы стаи (союзники: лекарь лечит, призыватель считает своих) */
  allies(): readonly Mob[];
  /** Призвать моба в стаю */
  spawn(kind: string, at: THREE.Vector3): Mob | null;
}

/** Зелёный свет лечения */
export const HEAL = C(0.9, 3.4, 1.1);
/** Голубой иней замедления */
const FROST = C(1.6, 3, 4);

export abstract class Mob extends Boss {
  /** id в реестре (src/mobs/roster.ts) */
  abstract readonly kind: string;
  /** Стоимость в бюджете орды (wiki/design-dungeon.md, раздел 5) */
  abstract readonly cost: number;
  override readonly subtitle: string = 'воин Ордена';
  state: MobState = 'spawn';
  attack = '';
  st = 0;
  cd = 0.8;
  /** Скорость бега, м/с; разворот, рад/с; дистанция, которую держит */
  speed = 3;
  turn = 5;
  keep = 1.6;
  /** Видит героя с этого расстояния; ударили — видит всегда */
  aggro = 14;
  /** Заметил героя */
  alerted = false;
  /** Маршрут патруля: пока не заметил героя, ходит по точкам по кругу (src/level/playground-map.ts, MobPost.route) */
  route: THREE.Vector3[] | null = null;
  private routeI = 0;
  /**
   * Марш в один конец (оборона куста, src/td/): идёт по точкам полным ходом, героя замечает только в aggro; в конце дороги —
   * тревога, и куст-приманка (src/decoys.ts) становится целью. Ударенный героем гонится за ним, отбежал дальше leash — снова на дорогу
   */
  march: THREE.Vector3[] | null = null;
  marchI = 0;
  /** Дорога, по которой идёт (id из meta.td.lanes) — чтобы продолжить марш после пролома */
  laneId: string | null = null;
  leash = 10;
  private marchDone = false;
  /** Малина с моба (до масштаба) */
  loot = 1;
  /** Призван — малины нет */
  summoned = false;
  /** Рассыпался — стая уберёт */
  gone = false;
  /** Вес: отброс от удара и толкотня в стае */
  mass = 1;
  /** Рыцарь Ордена: знамя знаменосца его воодушевляет */
  readonly knight: boolean = false;
  /** Воодушевлён знаменем (секунды): урон и скорость +25 % */
  rally = 0;
  /** Призрак: летает сквозь стены */
  ghost = false;
  /** Охотник на башни: осадные приманки (башни обороны, src/td/tower.ts) тянут его с дороги */
  hunter = false;
  /** Насколько выше или ниже себя охотник достаёт башню, м */
  reachY = 1.5;
  /** Под куполом обелиска (секунды): урон по мобу ×0,5 */
  ward = 0;
  /** Замедлен аурой «Стужа»: теряет долю скорости chillK, осталось chillT с */
  chillK = 0;
  chillT = 0;
  protected readonly body = new THREE.Group();
  protected readonly field: Field;
  protected readonly mh: MobHooks;
  protected hitDone = false;
  /** Призванный, в которого целится моб (null — герой) */
  protected focus: Decoy | null = null;
  protected flyY = 0;
  private dazeFor = 0;
  private deathT = 0;
  /** Лечение копится и показывается цифрой раз в 0,5 с */
  private healed = 0;
  private healT = 0;

  constructor(h: MobHooks, hp: number, at: THREE.Vector3, yaw = Math.random() * Math.PI * 2) {
    super(h, hp, at.clone().setY(0), yaw);
    // приманки (src/decoys.ts): пока моб целится в призванного, «герой» для него — приманка, и его удары идут ей
    const base = this.h, me = this;
    const hero = new Proxy(base.hero, {
      get(t, p) {
        const f = me.focus;
        if (f?.alive) { if (p === 'pos') return f.pos; if (p === 'down') return false; }
        const v = Reflect.get(t, p, t) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    });
    (this as unknown as { h: typeof base }).h = { ...base, hero, hurtHero: (dmg, from, knock) => { const f = me.focus; if (f?.alive) f.hurt(dmg, from); else base.hurtHero(dmg, from, knock); } };
    this.mh = h;
    this.field = new Field(this.h);
    this.awake = true;
    this.pos.copy(this.home);
    this.yaw = yaw;
    this.setPlayers(1);
    this.group.add(this.body);
  }

  /** Выбор атаки, когда перезарядка вышла (null — идти дальше) */
  protected abstract choose(dist: number, rel: number): string | null;
  /** Ход атаки: t — время с начала; true — атака кончилась */
  protected abstract act(name: string, t: number, dt: number, dist: number): boolean;
  /** Поза частей тела (раз в кадр); walk — идёт */
  protected abstract animate(dt: number, walk: boolean): void;
  /** Перезарядка после атаки */
  protected rest(): number { return rand(0.8, 1.4); }
  /** Доля урона, которая проходит (щит спереди — меньше) */
  protected guard(_dir: THREE.Vector3): number { return 1; }

  get quiet(): boolean { return this.h.quiet(); }
  /** Урон по героям: масштаб и знамя */
  override get dmgMult(): number { return super.dmgMult * (this.rally > 0 ? 1.25 : 1); }
  /** Скорость бега со знаменем */
  get pace(): number { return this.speed * (this.rally > 0 ? 1.25 : 1) * this.slowMul; }
  /** Скорость на марше: кто сам не ходит (слизень прыгает, лоза растёт), по дороге всё же ползёт */
  protected get marchPace(): number { return this.pace; }
  /** Множитель скорости от холода */
  get slowMul(): number { return this.chillT > 0 ? 1 - this.chillK : 1; }
  /** Замедление героя от зон моба (0..1) */
  get heroSlow(): number { return this.field.heroSlow; }
  /** Ещё цели, кроме самого моба (воткнутое знамя) */
  extras(): Target[] { return []; }

  /** Доля пройденной дороги (0..1) на марше; башни бьют того, у кого больше */
  get progress(): number {
    const r = this.march;
    if (!r || !r.length) return 0;
    if (this.marchI >= r.length) return 1;
    const t = r[this.marchI], prev = r[this.marchI - 1];
    const seg = prev ? Math.hypot(t.x - prev.x, t.z - prev.z) : 1;
    const frac = prev && seg > 0 ? Math.max(0, Math.min(1, 1 - Math.hypot(t.x - this.pos.x, t.z - this.pos.z) / seg)) : 0;
    return (this.marchI - (prev ? 1 : 0) + frac) / r.length;
  }

  /** Заметил героя — и соседи в 8 м тоже. byHit — от удара: на марше выстрел башни издалека не отвлекает */
  notice(byHit = false): void {
    if (this.alerted || this.dead) return;
    if (this.march && byHit) { const hp = this.mh.hero.pos; if (Math.hypot(hp.x - this.pos.x, hp.z - this.pos.z) > this.aggro + 2) return; }
    this.alerted = true;
    for (const m of this.mh.allies()) if (m !== this && Math.hypot(m.pos.x - this.pos.x, m.pos.z - this.pos.z) < 8) m.notice();
  }

  wake(): void { this.notice(); }

  /** Дорога продолжилась (пролом в стене пробит, src/td/wall.ts): новые точки марша, тревога снята — снова в путь */
  extendMarch(points: THREE.Vector3[]): void {
    if (!this.march || this.dead) return;
    this.march.push(...points);
    this.marchDone = false;
    this.alerted = false;
    this.focus = null;
    if (this.state === 'attack') { this.field.clear(); this.go('idle'); }
  }
  /** Встать на дорогу того же марша, что у `from` (порождённые в пути: половинки слизня, подручные) */
  joinMarch(from: Mob): void {
    if (!from.march) return;
    this.march = from.march.map((v) => v.clone());
    this.marchI = from.marchI;
    this.laneId = from.laneId;
    this.aggro = Math.min(this.aggro, from.aggro);
  }
  reset(): void { /* рядовой не возвращается: стая убирает его целиком */ }

  /** Удар без направления (нулевой dir) — пробивающий: броня и щиты его не гасят (стенная баллиста, src/td/tower.ts) */
  override hit(dmg: number, dir: THREE.Vector3, point: THREE.Vector3, knock: number): void {
    if (this.dead || this.state === 'spawn') return;
    const k = (dir.lengthSq() < 1e-6 ? 1 : this.guard(dir)) * (this.ward > 0 ? 0.5 : 1);
    if (k < 1) {
      this.h.fx.text(point.clone().setY(point.y + 0.5), this.ward > 0 && this.guard(dir) >= 1 ? 'купол' : 'блок', '');
      this.h.fx.burst(point, ['#ffffff', '#e8b84a'], 6, { speed: 3, up: 2, size: 0.07, life: 0.3, glow: true, gravity: 8 });
      if (!this.quiet) boom(900, 500, 0.12, 0.15);
    }
    super.hit(dmg * k, dir, point, knock);
    // отброс: лёгкого — дальше; стены поправит update
    this.pos.addScaledVector(dir, (0.15 + knock * 0.5) * k / this.mass);
    this.notice(true);
  }

  /** Пасть без удара (пал хозяин, лопнул сам): мимо щита и появления */
  vanish(): void {
    if (this.dead) return;
    this.hp = 0;
    this.dead = true;
    this.die();
  }

  /** Лечение: здоровье не выше полного, зелёные искры, цифра */
  heal(n: number): void {
    if (this.dead || this.hp >= this.maxHp) return;
    const v = Math.min(n, this.maxHp - this.hp);
    this.hp += v;
    this.healed += v;
    if (Math.random() < 0.3) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(rand(-0.4, 0.4), rand(0.4, this.topY), rand(-0.4, 0.4))), vel: new THREE.Vector3(0, 1.2, 0), life: 0.5, size: 0.1, color: HEAL, gravity: 0 });
  }

  protected go(s: MobState, attack = ''): void { this.state = s; this.attack = attack; this.st = 0; this.hitDone = false; }
  chill(k: number, sec: number): void {
    if (this.dead) return;
    this.chillK = this.chillT > 0 ? Math.max(this.chillK, k) : k;
    this.chillT = Math.max(this.chillT, sec);
  }

  /** Оглушить: стоит, над головой кружат искры */
  daze(sec: number): void { if (this.dead) return; this.dazeFor = sec; this.flyY = 0; this.go('daze'); }
  /** Оглушение от ауры (заморозка «Стужи», толчок «Каменной поступи»): не короче уже идущего */
  stun(sec: number): void { if (this.state === 'spawn' || (this.state === 'daze' && this.dazeFor - this.st >= sec)) return; this.daze(sec); }

  protected die(): void {
    this.flyY = 0;
    this.go('dead');
    this.field.clear();
    if (!this.quiet) { boom(160, 60, 0.3, 0.25); hiss({ dur: 0.3, vol: 0.12, f: 1800, f1: 400, q: 0.6, type: 'lowpass' }); }
  }

  /** Убрать со сцены (стая зовёт, когда моб рассыпался или стаю чистят) */
  dispose(): void {
    this.field.clear();
    this.h.scene.remove(this.group);
    for (const m of this.flashMats) m.dispose();
    for (const s of this.shimmers) s.mat.dispose();
  }

  // ---------- мозг ----------
  update(dt: number): void {
    this.st += dt;
    this.ward -= dt;
    if (this.chillT > 0) {
      this.chillT -= dt;
      if (Math.random() < 0.2) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(rand(-0.4, 0.4), rand(0.2, this.topY), rand(-0.4, 0.4))), vel: new THREE.Vector3(0, -0.4, 0), life: 0.5, size: 0.07, color: FROST, gravity: 0 });
    }
    if (this.rally > 0) {
      this.rally -= dt;
      if (Math.random() < 0.15) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(rand(-0.3, 0.3), this.topY + 0.1, rand(-0.3, 0.3))), vel: new THREE.Vector3(0, 0.8, 0), life: 0.5, size: 0.08, color: RASP, gravity: 0 });
    }
    // цель: ближайшая из героя и приманок; меняем только вне атаки, чтобы удар не перескочил на полпути
    if (this.state !== 'attack') { this.focus = null; this.focus = pickDecoy(this.pos, this.h.hero.pos, this.aggro, this.hunter, this.reachY); }
    const hero = this.h.hero.pos;
    const dx = hero.x - this.pos.x, dz = hero.z - this.pos.z, dist = Math.hypot(dx, dz);
    const rel = wrap(Math.atan2(dx, dz) - this.yaw);
    let walk = false;
    switch (this.state) {
      case 'spawn':
        // вылезает из земли
        this.body.position.y = -this.topY * Math.max(0, 1 - this.st / 0.45);
        if (this.st > 0.45) { this.body.position.y = 0; this.go('idle'); }
        break;
      case 'idle':
      case 'walk': {
        if (!this.alerted && dist < this.aggro && Math.abs(hero.y - this.pos.y) < 2) this.notice();
        // охотник увидел башню — сворачивает к ней с дороги (соседей не тревожит); башня пала — фокус пуст, снова марш
        if (!this.alerted && this.focus?.siege && dist < (this.focus.taunt ?? 0)) this.alerted = true;
        // на марше: герой убежал дальше поводка, приманки нет — тревога снята, снова на дорогу
        if (this.march && this.alerted && !this.focus && dist > this.leash) this.alerted = false;
        if (!this.alerted || this.h.hero.down) { walk = this.march ? this.marching(dt) : !this.alerted && this.patrol(dt); this.state = walk ? 'walk' : 'idle'; break; }
        this.cd -= dt;
        if (this.cd <= 0) {
          const a = this.choose(dist, rel);
          if (a) { this.go('attack', a); break; }
        }
        walk = this.steer(dt, dist, dx, dz, rel);
        this.state = walk ? 'walk' : 'idle';
        break;
      }
      case 'attack':
        if (this.act(this.attack, this.st, dt, dist) && this.state === 'attack') { this.cd = this.rest(); this.go('idle'); }
        break;
      case 'daze':
        if (Math.random() < 0.2) this.h.fx.particle({ pos: this.pos.clone().add(new THREE.Vector3(Math.cos(this.time * 7) * 0.4, this.topY + 0.25, Math.sin(this.time * 7) * 0.4)), vel: new THREE.Vector3(0, 0.2, 0), life: 0.35, size: 0.08, color: C(3.4, 3, 1.2), gravity: 0 });
        if (this.st > this.dazeFor) { this.cd = 0.4; this.go('idle'); }
        break;
      case 'dead': this.dying(dt); break;
    }
    this.field.update(dt);
    if (this.state !== 'dead') {
      // не сквозь стены (кроме призраков); на героя не налезает — уступает ему
      const p = new THREE.Vector3(this.pos.x, 0, this.pos.z);
      if (!this.ghost) resolveCircle(p, this.radius, this.h.obstacles());
      const d = Math.hypot(hero.x - p.x, hero.z - p.z), R = this.radius + HERO.radius;
      if (d < R && d > 1e-3) { const k = (R - d) / d; p.x -= (hero.x - p.x) * k; p.z -= (hero.z - p.z) * k; }
      this.pos.x = p.x; this.pos.z = p.z;
    }
    this.healT -= dt;
    if (this.healed >= 1 && this.healT <= 0) { this.h.fx.text(this.pos.clone().setY(this.topY + 0.3), `+${Math.round(this.healed)}`, 'heal'); this.healed = 0; this.healT = 0.5; }
    this.tickLook(dt, this.state === 'dead' ? Math.max(0.1, 1 - this.st * 2) : 1);
    this.animate(dt, walk);
    this.place();
  }

  /** Идти к герою и держать дистанцию; дальние пятятся, если подошли вплотную. true — шёл */
  protected steer(dt: number, dist: number, dx: number, dz: number, rel: number): boolean {
    this.face(dt);
    const sp = this.pace * dt;
    if (Math.abs(rel) < 1.2 && dist > this.keep + 0.3) { this.pos.x += (dx / dist) * sp; this.pos.z += (dz / dist) * sp; return true; }
    if (this.keep > 4 && dist < this.keep - 2) { this.pos.x -= (dx / dist) * sp * 0.7; this.pos.z -= (dz / dist) * sp * 0.7; return true; }
    return false;
  }

  /** Шаг патруля к очередной точке маршрута (вполсилы); дошёл — к следующей по кругу. true — шёл */
  protected patrol(dt: number): boolean {
    const r = this.route;
    if (!r || !r.length) return false;
    const t = r[this.routeI % r.length], dx = t.x - this.pos.x, dz = t.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.7) { this.routeI = (this.routeI + 1) % r.length; return false; }
    const want = wrap(Math.atan2(dx, dz) - this.yaw), m = this.turn * dt;
    this.yaw += Math.max(-m, Math.min(m, want));
    if (Math.abs(want) > 1) return true;
    const sp = this.pace * 0.55 * dt;
    this.pos.x += (dx / d) * sp; this.pos.z += (dz / d) * sp;
    return true;
  }

  /** Шаг марша к очередной точке дороги (почти полным ходом); конец дороги — тревога: куст-приманка рядом. true — шёл */
  protected marching(dt: number): boolean {
    const r = this.march!;
    if (this.marchI >= r.length) { if (!this.marchDone) { this.marchDone = true; this.notice(); } return false; }
    const t = r[this.marchI], dx = t.x - this.pos.x, dz = t.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.6) { this.marchI++; return true; }
    const want = wrap(Math.atan2(dx, dz) - this.yaw), m = this.turn * 1.5 * dt;
    this.yaw += Math.max(-m, Math.min(m, want));
    const sp = this.marchPace * 0.85 * dt * (Math.abs(want) > 1.2 ? 0.4 : 1);
    this.pos.x += (dx / d) * sp; this.pos.z += (dz / d) * sp;
    return true;
  }

  /** Рывок вдоль dir: speed м/с; true — упёрся в стену */
  protected dash(dir: THREE.Vector3, speed: number, dt: number): boolean {
    const step = speed * this.slowMul * dt;
    this.move(dir, step);
    const p = new THREE.Vector3(this.pos.x, 0, this.pos.z);
    resolveCircle(p, this.radius, this.h.obstacles());
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z) > step * 0.5;
  }

  protected place(): void {
    this.pos.y = this.flyY;
    this.group.position.set(this.pos.x, this.flyY, this.pos.z);
    this.group.rotation.y = this.yaw;
  }

  protected face(dt: number, k = 1): void {
    const hero = this.h.hero.pos;
    const d = wrap(Math.atan2(hero.x - this.pos.x, hero.z - this.pos.z) - this.yaw), m = this.turn * k * dt;
    this.yaw += Math.max(-m, Math.min(m, d));
  }

  /** Шаг: фаза покачивания от времени (ноги, руки) */
  protected stride(speed = 9): number { return Math.sin(this.time * speed); }

  private dying(dt: number): void {
    // валится набок и рассыпается кубиками, малина — стае
    this.body.rotation.z = Math.min(1, this.st / 0.35) * 1.2;
    if (this.st > 0.35 && this.deathT === 0) {
      this.deathT = 1;
      const c = this.pos.clone().setY(this.topY * 0.5);
      this.h.fx.burst(c, [RASP, '#ffffff', ...this.flashMats.slice(0, 2).map((m) => m.color.clone())], 18, { speed: 3.5, up: 3.5, size: 0.11, life: 0.7, gravity: 8 });
      this.onDeath?.(new THREE.Vector3(this.pos.x, 0, this.pos.z));
    }
    if (this.deathT > 0) {
      this.deathT += dt;
      const k = Math.max(0, 1 - (this.deathT - 1) / 0.2);
      this.body.scale.setScalar(k);
      if (k <= 0) this.gone = true;
    }
  }
}
