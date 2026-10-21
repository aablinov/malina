import * as THREE from 'three';
import { Bush } from './bush';
import type { Beetle, BeetleKind } from './beetle';
import type { FX } from './fx';
import type { Textures } from './textures';
import { campGuards, campLevel, rng, REGION_BY_ID, type Camp, type MissionMap, type RegionId } from './map';

export type CampState = 'dormant' | 'guarded' | 'capturing' | 'blocked' | 'captured';

/** Сколько секунд поднимать флаг одному игроку */
export const CAPTURE_TIME = 8;
/** Радиус зоны захвата вокруг куста */
export const CAPTURE_R = 3.6;
/** Если жук ближе этого к кусту, флаг не поднимается */
export const BLOCK_R = 8;
/** На каком расстоянии лагерь просыпается */
const WAKE_R = 34;

export interface CampRuntime {
  def: Camp;
  level: number;
  state: CampState;
  /** 0..1 — высота флага */
  progress: number;
  /** Сколько жуков ещё не вылезло из нор */
  guards: BeetleKind[];
  spawned: boolean;
  reinforced: boolean;
  /** Сколько жуков рядом мешают подъёму */
  enemiesNear: number;
  /** Сколько игроков стоят в зоне */
  playersIn: number;
  bush: Bush;
  flag: THREE.Mesh;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  pos: THREE.Vector3;
}

export interface MissionHooks {
  spawnBeetle(kind: BeetleKind, x: number, z: number, level: number, camp: number): Beetle;
  beetles(): readonly Beetle[];
  /** Позиции игроков сессии (для захвата важно, кто стоит в зоне) */
  players(): readonly { pos: THREE.Vector3; down: boolean }[];
  /** Флаг поднят: сколько малины дать */
  onCapture(c: CampRuntime, berries: number): void;
  sound(k: 'wave' | 'harvest' | 'explosion' | 'flag'): void;
}

/** Состояние одной миссии на карте: лагеря, захват, итог */
export class Mission {
  readonly camps: CampRuntime[];
  readonly drop: THREE.Vector3;
  readonly region: RegionId;
  time = 0;
  completeT = -1;
  private readonly group = new THREE.Group();
  private readonly r = rng(Math.floor(Math.random() * 1e9));

  constructor(private readonly scene: THREE.Scene, T: Textures, private readonly fx: FX, map: MissionMap, region: RegionId, private readonly h: MissionHooks) {
    this.region = region;
    const d = REGION_BY_ID[region].drop;
    this.drop = new THREE.Vector3(d.x, 0, d.z);
    scene.add(this.group);

    const poleMat = new THREE.MeshLambertMaterial({ map: T.logSide });
    const flagMat = new THREE.MeshLambertMaterial({ map: T.flag, side: THREE.DoubleSide });
    const stoneMat = new THREE.MeshLambertMaterial({ map: T.stone });
    const holeMat = new THREE.MeshBasicMaterial({ color: '#120a06' });
    const lampMat = new THREE.MeshStandardMaterial({ color: '#2a2018', emissive: '#ffae42', emissiveIntensity: 2.6 });

    this.camps = map.camps.map((def) => {
      const level = campLevel(def, d);
      const pos = new THREE.Vector3(def.x, 0, def.z);
      const bush = new Bush(scene, T, { x: def.x, z: def.z }, { mature: true, harvestT: 999 });
      bush.update(0.01, 0, true);
      // флагшток и флаг
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.4, 0.12), poleMat);
      pole.position.set(def.x + 1.6, 1.7, def.z - 0.4);
      pole.castShadow = true;
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshStandardMaterial({ color: '#ffcf5a', emissive: '#ffb020', emissiveIntensity: 1 }));
      top.position.set(def.x + 1.6, 3.45, def.z - 0.4);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.75), flagMat);
      flag.geometry.translate(0.62, 0, 0);
      flag.position.set(def.x + 1.66, 0.6, def.z - 0.4);
      flag.castShadow = true;
      flag.visible = false;
      // кольцо зоны захвата
      const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(CAPTURE_R - 0.18, CAPTURE_R, 56), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(def.x, 0.06, def.z);
      // каменный венец, норы и фонари
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + this.r() * 0.3;
        if (i % 3 === 0) continue;
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35 + this.r() * 0.3, 0.5), stoneMat);
        s.position.set(def.x + Math.cos(a) * (CAPTURE_R + 0.6), 0.15, def.z + Math.sin(a) * (CAPTURE_R + 0.6));
        s.rotation.y = a;
        s.castShadow = true;
        this.group.add(s);
      }
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.5;
        const hole = new THREE.Mesh(new THREE.CircleGeometry(0.5, 10), holeMat);
        hole.rotation.x = -Math.PI / 2;
        hole.position.set(def.x + Math.cos(a) * 6, 0.03, def.z + Math.sin(a) * 6);
        this.group.add(hole);
      }
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.6, 0.16), poleMat);
        post.position.set(def.x + s * 2.6, 0.8, def.z + 2.6);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), lampMat);
        lamp.position.set(def.x + s * 2.6, 1.75, def.z + 2.6);
        this.group.add(post, lamp);
      }
      this.group.add(pole, top, flag, ring);
      return {
        def, level, state: 'dormant' as CampState, progress: 0, guards: campGuards(level, this.r),
        spawned: false, reinforced: false, enemiesNear: 0, playersIn: 0, bush, flag, ring, ringMat, pos,
      };
    });
  }

  get captured(): number { return this.camps.filter((c) => c.state === 'captured').length; }
  get total(): number { return this.camps.length; }
  get complete(): boolean { return this.captured === this.total; }

  /** Ближайший незахваченный лагерь к точке */
  nearest(p: THREE.Vector3): CampRuntime | null {
    let best: CampRuntime | null = null, bd = Infinity;
    for (const c of this.camps) {
      if (c.state === 'captured') continue;
      const d = c.pos.distanceTo(p);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  /** Вылезти жукам из нор вокруг лагеря */
  private spawnGroup(c: CampRuntime, kinds: BeetleKind[], minR: number, maxR: number, alert: boolean): void {
    kinds.forEach((kind, i) => {
      const a = (i / kinds.length) * Math.PI * 2 + this.r() * 0.8;
      const rr = minR + this.r() * (maxR - minR);
      const x = c.def.x + Math.cos(a) * rr, z = c.def.z + Math.sin(a) * rr;
      const b = this.h.spawnBeetle(kind, x, z, c.level, c.def.id);
      if (alert) b.alert(20);
      this.fx.burst(new THREE.Vector3(x, 0.2, z), ['#6b452c', '#8b5e3c', '#4a2f1c'], 8, { speed: 2, up: 3, size: 0.14, life: 0.8 });
    });
  }

  update(dt: number, t: number): void {
    this.time += dt;
    const players = this.h.players();
    const beetles = this.h.beetles();
    for (const c of this.camps) {
      c.bush.update(dt, t, c.state !== 'captured');
      if (c.state === 'captured') {
        c.flag.rotation.y = Math.sin(t * 3 + c.def.id) * 0.25;
        c.ringMat.color.setRGB(0.4, 2.2, 0.6);
        c.ringMat.opacity = 0.35;
        continue;
      }
      const near = players.some((p) => !p.down && p.pos.distanceTo(c.pos) < WAKE_R);
      if (!c.spawned && near) {
        c.spawned = true;
        c.state = 'guarded';
        this.spawnGroup(c, c.guards, 2, 6.5, false);
        c.guards = [];
      }
      c.playersIn = players.filter((p) => !p.down && Math.hypot(p.pos.x - c.pos.x, p.pos.z - c.pos.z) < CAPTURE_R).length;
      c.enemiesNear = beetles.filter((b) => !b.dead && Math.hypot(b.pos.x - c.pos.x, b.pos.z - c.pos.z) < BLOCK_R).length;

      if (c.playersIn > 0) {
        // при первой попытке захвата лезет подкрепление
        if (!c.reinforced) {
          c.reinforced = true;
          const n = 2 + c.level;
          const kinds: BeetleKind[] = Array.from({ length: n }, (_, i) => (i % 3 === 2 && c.level >= 2 ? 'spitter' : i % 4 === 3 && c.level >= 3 ? 'big' : c.level >= 2 && i % 2 ? 'fast' : 'small'));
          this.spawnGroup(c, kinds, 8, 11, true);
          this.h.sound('wave');
          this.fx.text(c.pos.clone(), 'Жуки лезут из нор!', 'bad');
        }
        if (c.enemiesNear > 0) {
          c.state = 'blocked';
        } else {
          c.state = 'capturing';
          // вдвоём быстрее, втроём ещё быстрее
          c.progress = Math.min(1, c.progress + (dt / CAPTURE_TIME) * (1 + 0.5 * (c.playersIn - 1)));
          if (Math.random() < dt * 10) this.fx.burst(c.pos.clone().setY(0.2), [new THREE.Color(3, 2.4, 0.8)], 1, { speed: 1, up: 2.5, size: 0.06, life: 0.6, glow: true, gravity: -0.5 });
        }
      } else {
        c.state = 'guarded';
        c.progress = Math.max(0, c.progress - dt * 0.05);
      }
      c.flag.visible = c.progress > 0.01;
      c.flag.position.y = 0.6 + c.progress * 2.5;
      c.flag.rotation.y = Math.sin(t * 3 + c.def.id) * 0.25;

      const pulse = 0.5 + Math.sin(t * 6) * 0.2;
      if (c.state === 'blocked') { c.ringMat.color.setRGB(3, 0.4, 0.4); c.ringMat.opacity = pulse; }
      else if (c.state === 'capturing') { c.ringMat.color.setRGB(3, 2.4, 0.6); c.ringMat.opacity = pulse + 0.2; }
      else { c.ringMat.color.setRGB(1.6, 1.6, 1.8); c.ringMat.opacity = 0.35; }

      if (c.progress >= 1) {
        c.state = 'captured';
        const berries = 15 + c.level * 8;
        this.h.onCapture(c, berries);
        this.h.sound('flag');
        c.bush.harvest();
        this.fx.burst(c.pos.clone().setY(3.2), [new THREE.Color(3.4, 0.6, 1), new THREE.Color(3, 2.6, 1)], 40, { speed: 5, up: 5, size: 0.09, life: 1.2, glow: true, gravity: 4 });
        this.fx.shock(c.pos, CAPTURE_R + 1, new THREE.Color(0.6, 3, 0.8), 0.6, 0.15);
        if (this.complete) this.completeT = 0;
      }
    }
    if (this.completeT >= 0) this.completeT += dt;
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    for (const c of this.camps) c.bush.dispose();
  }
}
