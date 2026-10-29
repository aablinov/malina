import * as THREE from 'three';
import type { ArtifactStats, BossSpellKind } from '../items';
import { additive, additiveSprite, raysTex } from '../loot-look';
import { bell, boom, deg, hiss, voice } from '../spell-audio';
import type { Spells } from '../spells';
import type { Target } from '../target';
import { rand, type Spell } from './kit';

/** Базовые заклинания (wiki/design-spells.md, раздел «Базовые заклинания»). Свет: ослепляющая вспышка */

const ROOT = 523.25;

/** Яркий колокол, «дзынь» стекла, мягкий низ */
function flashSound(k: number): void {
  boom(130 - k * 30, 50, 0.5, 0.35 + k * 0.15, 0, 0.3);
  [0, 2, 4, 7].forEach((d, i) => bell(deg(ROOT * 2, d), 1.2 + k * 0.4, 0.06, i * 0.03, 0.6));
  for (let i = 0; i < 6; i++) voice({ type: 'triangle', f: deg(ROOT * 4, (Math.random() * 7) | 0), dur: 0.14, vol: 0.03, delay: 0.02 + Math.random() * 0.15, verb: 0.4 });
  hiss({ dur: 0.18, vol: 0.18, f: 7000, type: 'highpass', verb: 0.3 });
}

function blindflash(kit: Spells, a: ArtifactStats, power: number, _at: THREE.Vector3, k: number): void {
  const fx = kit.h.fx, s = kit.color('star'), hero = kit.h.hero;
  const R = a.radius ?? 4, stun = a.duration ?? 1.5, tele = 0.25;
  kit.windup('star', k);
  // замах: круг света раскрывается под ногами, свет стягивается к герою
  kit.groundSigil('star', hero.pos, R * 0.75, tele, 0.1, 0.3);
  hiss({ dur: tele + 0.05, vol: 0.1, f: 1500, f1: 7000, q: 0.7, attack: tele * 0.8, verb: 0.3 });
  voice({ type: 'sine', f: ROOT, f1: ROOT * 2, dur: tele, vol: 0.04, attack: tele * 0.8, verb: 0.4 });
  const core = hero.pos.clone().setY(hero.pos.y + 1);
  for (let i = 0; i < 24; i++) {
    const ang = Math.random() * Math.PI * 2, r = rand(1.5, R), life = rand(0.18, tele);
    const from = core.clone().add(new THREE.Vector3(Math.cos(ang) * r, rand(-0.6, 1.4), Math.sin(ang) * r));
    fx.particle({ pos: from, vel: core.clone().sub(from).divideScalar(life), life, size: rand(0.05, 0.08), color: i % 2 ? s.a : s.b, gravity: 0, shrink: false });
  }
  kit.later(tele, () => {
    const c = hero.pos.clone(), mid = c.clone().setY(c.y + 1);
    kit.impact('star', c, k, 16, 0.3);
    kit.pomp('common', c, 'star');
    flashSound(k);
    fx.flash(mid, s.b.clone().multiplyScalar(0.55), R, 0.25);
    fx.shock(c.clone().setY(c.y + 0.06), R, s.a, 0.4, 0.2);
    fx.shock(c.clone().setY(c.y + 0.06), R * 0.6, s.b, 0.3, 0.12);
    fx.burst(mid, [s.a, s.b], 30 + Math.round(k * 20), { speed: R * 2, up: 2, size: 0.07, life: 0.5, glow: true, gravity: 2 });
    // лучи-звезда: вертикальная звезда над героем и плоская на полу, раскрываются и тают
    const g = new THREE.Group();
    const up = new THREE.Sprite(additiveSprite(raysTex(), s.b.clone().multiplyScalar(0.35)));
    up.position.copy(mid);
    const flat = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive(raysTex(), s.a.clone().multiplyScalar(0.4)));
    flat.rotation.x = -Math.PI / 2; flat.position.copy(c).setY(c.y + 0.08);
    const mats: THREE.Material[] = [up.material, flat.material as THREE.Material];
    g.add(up, flat);
    fx.custom(g, 0.55, (t) => {
      const e = 1 - (1 - t) ** 3;
      up.scale.setScalar(R * 1.3 * (0.4 + e)); up.material.rotation = t * 0.6;
      flat.scale.setScalar(R * 2.2 * (0.3 + e)); flat.rotation.z = -t * 0.5;
      for (const m of mats) m.opacity = (1 - t) ** 1.5;
    }, () => { flat.geometry.dispose(); mats.forEach((m) => m.dispose()); });
    // урон, лёгкий отброс, оглушение рядовых
    kit.h.aoe(c, R, Math.round(power), 1.2, false);
    const stunned: Target[] = [];
    for (const t of kit.within(c, R)) if (!t.prop && t.stun) { t.stun(stun); stunned.push(t); }
    // над оглушёнными кружат звёздочки
    let st = 0;
    kit.proc((dt) => {
      st += dt;
      for (const t of stunned) {
        if (!t.alive) continue;
        const top = t.pos.y + Math.min(2.6, (t.topY ?? 1.8)) + 0.25;
        for (let j = 0; j < 3; j++) {
          const ang = kit.time * 6 + (j / 3) * Math.PI * 2;
          if (Math.random() < 0.8) fx.particle({ pos: new THREE.Vector3(t.pos.x + Math.cos(ang) * 0.5, top, t.pos.z + Math.sin(ang) * 0.5), vel: new THREE.Vector3(0, 0.1, 0), life: 0.22, size: 0.12, color: j % 2 ? s.a : s.b, gravity: 0 });
        }
      }
      return st < stun;
    });
    // послевкусие: светлый круг на полу и искры, медленно поднимающиеся вверх
    fx.decal(c, kit.tex.glow(), s.a.clone().multiplyScalar(0.3), R * 2, 2, true);
    let left = 1.2;
    kit.proc((dt) => {
      left -= dt;
      if (Math.random() < 0.6) {
        const ang = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R;
        fx.particle({ pos: c.clone().add(new THREE.Vector3(Math.cos(ang) * r, 0.1, Math.sin(ang) * r)), vel: new THREE.Vector3(0, rand(0.6, 1.4), 0), life: 0.7, size: 0.05, color: s.b, gravity: -0.3 });
      }
      return left > 0;
    });
  });
}

export const BASE_LIGHT = {
  blindflash: { school: 'star', tier: 'common', title: 'Ослепляющая вспышка', cast: blindflash },
} satisfies Partial<Record<BossSpellKind, Spell>>;
