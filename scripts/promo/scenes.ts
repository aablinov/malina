/**
 * The trailer's scenes (scripts/promo/record.ts). `setup` and `frame` run in the page — they are serialised, so they use only
 * their arguments: `m` is `window.__malina` (src/dev/playground.ts), `S` — the scene's own scratch object.
 * `frame` is called before every frame's simulation step and may return the playback rate and a white flash.
 */
export interface Scene {
  name: string;
  /** The battle's query string (the map) */
  query: string;
  /** Seconds */
  dur: number;
  /** Keep the game HUD in the picture */
  hud?: boolean;
  css?: string;
  overlay: { tag?: string; title?: string; side?: 'left' | 'right'; logo?: boolean; noIn?: boolean; noOut?: boolean };
  setup: (m: any, S: any) => void;
  frame: (m: any, t: number, dt: number, S: any) => { rate?: number; flash?: number } | void;
}

export const SCENES: Scene[] = [
  // ---- the hook: the Crystal Glade under attack from three roads
  {
    name: 'glade', query: 'map=td2&seed=7', dur: 3.2,
    overlay: { tag: 'CO-OP TOWER DEFENCE', title: 'DEFEND THE BUSH', noIn: true },
    setup: (m, S) => {
      const td = m.td, b = td.bush.pos, d = (p: any) => Math.hypot(p.pos.x - b.x, p.pos.z - b.z);
      m.profile.data.berries = 90000; m.hero.god = true;
      const pads = [...td.pads].sort((p: any, q: any) => d(p) - d(q));
      m.hero.place(b.x + 3, b.z + 4, -2.4);
      td.callWave();
      // the crowd walks in with no towers on the map, then the whole defence opens up on camera
      const kinds = ['runner', 'frostling', 'ram', 'hopper', 'runner', 'sporeling', 'wolf', 'shellback'];
      for (let i = 0; i < 40; i++) { for (const lane of ['west', 'north', 'east']) td.spawnOn(kinds[(i + lane.length) % kinds.length], lane); m.step(0.4); td.bush.hp = td.bush.maxHp; }
      ['storm', 'frost', 'magic', 'arrow', 'fire', 'splash', 'meteor', 'arrow', 'storm'].forEach((k, i) => { td.build(pads[i], k); td.upgrade(pads[i]); });
      // long enough for the price tags of the build to float away
      m.step(1.8);
      S.b = b;
    },
    frame: (m, t, _dt, S) => {
      const k = t / 3.2, e = k * k * (3 - 2 * k);
      m.td.bush.hp = m.td.bush.maxHp;
      m.setCam(42 - 8 * e); m.setCamTarget(S.b.x - 2 + 2 * e, S.b.z - 3 + 3 * e);
    },
  },
  // ---- towers going up one after another on the Raspberry Spiral
  {
    name: 'build', query: 'map=td4&seed=7', dur: 3,
    overlay: { tag: '10 TOWERS · UPGRADES', title: 'BUILD YOUR DEFENCE', side: 'right' },
    setup: (m, S) => {
      const td = m.td, b = td.bush.pos, d = (p: any) => Math.hypot(p.pos.x - b.x, p.pos.z - b.z);
      m.profile.data.berries = 90000; m.hero.god = true;
      S.pads = [...td.pads].sort((p: any, q: any) => d(p) - d(q)).slice(0, 7);
      S.kinds = ['meteor', 'frost', 'storm', 'fire', 'magic', 'winter', 'splash'];
      S.n = 0; S.up = 0; S.b = b;
      // the hero waits out of the picture: this scene is about the towers
      m.hero.place(b.x + 26, b.z + 26, -2.4);
      td.callWave();
      const lanes = td.spec.lanes.map((l: any) => l.id), kinds = ['runner', 'ram', 'gardener', 'berryling', 'hopper'];
      for (let i = 0; i < 30; i++) { for (const lane of lanes) td.spawnOn(kinds[i % kinds.length], lane); m.step(0.45); }
    },
    frame: (m, t, _dt, S) => {
      const td = m.td, k = t / 3, e = k * k * (3 - 2 * k);
      // a tower every fifth of a second, then the upgrades roll over them
      while (S.n < S.pads.length && t > 0.35 + S.n * 0.23) td.build(S.pads[S.n], S.kinds[S.n++]);
      while (S.up < S.pads.length * 2 && t > 1.9 + S.up * 0.06) td.upgrade(S.pads[S.up++ % S.pads.length]);
      m.setCam(34 - 6 * e); m.setCamTarget(S.b.x + 1 - 2 * e, S.b.z + 1 - 2 * e);
    },
  },
  // ---- the castle: walls, ballistas and tar against a crowd at the gate
  {
    name: 'castle', query: 'map=td3&seed=7', dur: 3,
    overlay: { tag: 'CASTLE WALLS · BALLISTAS · TAR', title: 'HOLD THE WALLS' },
    setup: (m, S) => {
      const td = m.td, w = td.walls[0].pos, d = (p: any) => Math.hypot(p.pos.x - w.x, p.pos.z - w.z);
      m.profile.data.berries = 90000; m.hero.god = true;
      m.hero.place(td.bush.pos.x + 2, td.bush.pos.z + 2, -2.4);
      td.callWave();
      const lanes = td.spec.lanes.map((l: any) => l.id), kinds = ['squire', 'ram', 'gardener', 'shellback', 'runner', 'sapper'];
      S.keep = () => { td.bush.hp = td.bush.maxHp; for (const x of td.walls) if (x.maxHp) x.hp = x.maxHp; };
      for (let i = 0; i < 40; i++) { for (const lane of lanes) td.spawnOn(kinds[i % kinds.length], lane); m.step(0.4); S.keep(); }
      // the towers by this wall, every kind the map sells
      const pads = [...td.pads].sort((p: any, q: any) => d(p) - d(q)), ks = ['ballista', 'oil', 'arrow', 'fire', 'ballista', 'splash'].filter((k) => td.kinds.includes(k));
      pads.slice(0, 6).forEach((p: any, i: number) => { td.build(p, ks[i % ks.length]); td.upgrade(p); });
      m.step(1.8); S.keep();
      // look at the crowd in front of this wall, not at the wall itself
      const near = td.pack.mobs.filter((x: any) => !x.dead && Math.hypot(x.pos.x - w.x, x.pos.z - w.z) < 16);
      const cx = near.reduce((a: number, x: any) => a + x.pos.x, 0) / (near.length || 1), cz = near.reduce((a: number, x: any) => a + x.pos.z, 0) / (near.length || 1);
      S.w = near.length ? { x: (w.x + cx * 2) / 3, z: (w.z + cz * 2) / 3 } : w;
    },
    frame: (m, t, _dt, S) => {
      const k = t / 3, e = k * k * (3 - 2 * k);
      S.keep();
      m.setCam(27 - 7 * e); m.setCamTarget(S.w.x + 2 - 2 * e, S.w.z + 2 - 2 * e);
    },
  },
  // ---- the hero in the thick of it: combo, roll, the weapon art
  {
    name: 'fight', query: 'map=td3&seed=7', dur: 3.2,
    overlay: { tag: 'COMBOS · DODGE ROLL · WEAPON ARTS', title: 'FIGHT BACK', side: 'right' },
    setup: (m, S) => {
      const td = m.td, b = td.bush.pos, V = m.hero.pos.constructor;
      m.profile.data.berries = 90000; m.hero.god = true;
      S.x = b.x + 9; S.z = b.z + 9;
      m.hero.place(S.x, S.z, -2.4);
      m.weapon('katana'); m.temper(['fireAspect', 'smiting', 'swirling']);
      const kinds = ['gardener', 'runner', 'berryling', 'ram', 'gardener', 'squire', 'runner', 'berryling', 'hopper', 'gardener', 'runner', 'ram', 'berryling', 'squire'];
      kinds.forEach((kd, i) => { const a = i / kinds.length * Math.PI * 2, r = 3.2 + (i % 3) * 1.6; td.spawn(kd, new V(S.x + Math.cos(a) * r, 0, S.z + Math.sin(a) * r)); });
      m.setCam(15); m.setCamTarget();
      m.step(0.5);
      S.near = () => { let best: any = null, bd = 1e9; for (const x of td.pack.mobs) { if (x.dead) continue; const dd = Math.hypot(x.pos.x - m.hero.pos.x, x.pos.z - m.hero.pos.z); if (dd < bd) { bd = dd; best = x; } } return best; };
    },
    frame: (m, t, _dt, S) => {
      const tg = S.near(), h = m.hero.pos;
      if (tg) m.click(tg.pos.x, tg.pos.z);
      if (t > 1.25 && !S.roll) { S.roll = true; m.press('roll'); }
      if (t > 1.9 && !S.art) { S.art = true; m.gear.arts.meter = 1; m.special(tg ? tg.pos.x : h.x - 2, tg ? tg.pos.z : h.z - 2); }
      m.setCam(15 - 2.5 * (t / 3.2));
      const slow = t > 1.95 && t < 2.45;
      return { rate: slow ? 0.5 : 1 };
    },
  },
  // ---- four weapons, four arts: a cut every 0.8 s
  {
    name: 'arsenal', query: 'map=td2&seed=5', dur: 3.4,
    overlay: { tag: 'KATANAS · HAMMERS · SCYTHES · TWIN BLADES', title: '14 WEAPONS' },
    setup: (m, S) => {
      const td = m.td, b = td.bush.pos, V = m.hero.pos.constructor;
      m.profile.data.berries = 90000; m.hero.god = true;
      S.x = b.x + 5; S.z = b.z + 6; S.i = -1;
      S.list = [['hammer', ['smiting', 'knockback']], ['scythe', ['soulSiphon', 'swirling']], ['pontiff', ['fireAspect', 'critical']], ['halberd', ['smiting', 'sharpness']]];
      S.kinds = ['gardener', 'runner', 'berryling', 'ram', 'gardener', 'hopper', 'runner', 'berryling'];
      S.next = () => {
        const [id, temper] = S.list[++S.i];
        for (const x of td.pack.mobs) if (!x.dead) x.vanish();
        m.hero.place(S.x, S.z, -2.4);
        m.weapon(id); m.temper(temper);
        S.kinds.forEach((kd: string, i: number) => { const a = i / S.kinds.length * Math.PI * 2 + S.i, r = 2.6 + (i % 2) * 1.3; td.spawn(kd, new V(S.x + Math.cos(a) * r, 0, S.z + Math.sin(a) * r)); });
        S.done = false;
      };
      m.setCam(15); m.setCamTarget(S.x, S.z);
      S.next(); m.step(0.3);
      S.near = () => { let best: any = null, bd = 1e9; for (const x of td.pack.mobs) { if (x.dead) continue; const dd = Math.hypot(x.pos.x - m.hero.pos.x, x.pos.z - m.hero.pos.z); if (dd < bd) { bd = dd; best = x; } } return best; };
    },
    frame: (m, t, _dt, S) => {
      const seg = 0.8, at = 0.3 + S.i * seg, cut = t >= 0.3 + (S.i + 1) * seg && S.i < S.list.length - 1;
      if (cut) S.next();
      const u = t - (0.3 + S.i * seg), tg = S.near();
      if (tg) m.click(tg.pos.x, tg.pos.z);
      if (u > 0.22 && !S.done && tg) { S.done = true; m.gear.arts.meter = 1; m.special(tg.pos.x, tg.pos.z); }
      m.setCam(15 - 1.5 * Math.max(0, u));
      return { flash: at > 0.3 && u >= 0 && u < 0.12 ? 0.8 * (1 - u / 0.12) : 0 };
    },
  },
  // ---- spells on the Misty Clearing
  {
    name: 'magic', query: 'map=td5&seed=7', dur: 3,
    overlay: { tag: '24 SPELLS · 12 AURAS', title: 'UNLEASH MAGIC', side: 'right' },
    setup: (m, S) => {
      const td = m.td, b = td.bush.pos, V = m.hero.pos.constructor;
      m.profile.data.berries = 90000; m.hero.god = true;
      S.x = b.x + 8; S.z = b.z + 8;
      m.hero.place(S.x, S.z, -2.4);
      const kinds = ['gardener', 'runner', 'berryling', 'ram', 'moth', 'frostling'];
      // two crowds: one for the fireball, one for the ice
      S.a = { x: S.x - 7, z: S.z - 3 }; S.c = { x: S.x - 2, z: S.z - 8 };
      for (const c of [S.a, S.c]) for (let i = 0; i < 9; i++) { const a = i * 2.4, r = 0.8 + (i % 4) * 0.7; td.spawn(kinds[i % kinds.length], new V(c.x + Math.cos(a) * r, 0, c.z + Math.sin(a) * r)); }
      m.setCam(25); m.setCamTarget(S.x - 3.5, S.z - 3.5);
      m.step(0.3);
      S.cool = () => { for (const a of m.gear.artT) a[0] = 0; };
    },
    frame: (m, t, _dt, S) => {
      if (t > 0.35 && !S.f1) { S.f1 = true; S.cool(); m.artifact(0, S.a.x, S.a.z, 0.5); }
      if (t > 1.1 && !S.f2) { S.f2 = true; S.cool(); m.artifact(1, S.c.x, S.c.z, 1); }
      if (t > 1.7 && !S.f3) { S.f3 = true; S.cool(); m.flare(); }
      m.setCam(25 - 3 * (t / 3));
    },
  },
  // ---- an expedition: the hero runs into a patrol
  {
    name: 'explore', query: 'map=expedition&seed=3&obj=lairs&d=1', dur: 3.2,
    css: 'body>div[class*="exp"]{visibility:hidden!important}',
    overlay: { tag: 'SEEDED MAPS · OBJECTIVES · EXTRACTION', title: 'GO ON EXPEDITIONS' },
    setup: (m, S) => {
      const s = m.exp.sim;
      m.hero.god = true;
      const g = s.garrisons.rooms.find((r: any) => r.spec.id.startsWith('patrol') && r.mobs[0] && !r.mobs[0].dead) ?? s.garrisons.rooms.find((r: any) => r.mobs[0] && !r.mobs[0].dead);
      S.mobs = g.mobs; S.p = g.mobs[0].pos;
      m.hero.place(S.p.x + 8, S.p.z + 8, -2.4);
      m.weapon('claymore'); m.temper(['fireAspect', 'swirling']);
      m.setCam(24); m.setCamTarget();
      m.step(0.3);
    },
    frame: (m, t, _dt, S) => {
      const tg = S.mobs.find((x: any) => !x.dead) ?? S.mobs[0];
      m.click(tg.pos.x, tg.pos.z);
      if (t > 0.5 && !S.roll) { S.roll = true; m.press('roll'); }
      if (t > 2.1 && !S.art) { S.art = true; m.gear.arts.meter = 1; m.special(tg.pos.x, tg.pos.z); }
      m.setCam(24 - 6 * (t / 3.2));
    },
  },
  // ---- a chief on the lava map
  {
    name: 'boss', query: 'map=td&seed=7', dur: 3.4,
    overlay: { tag: 'CHIEFS · WARDENS · 12 WAVES', title: 'TAKE DOWN BOSSES' },
    setup: (m, S) => {
      const td = m.td, b = td.bush.pos, V = m.hero.pos.constructor, d = (p: any) => Math.hypot(p.pos.x - b.x, p.pos.z - b.z);
      m.profile.data.berries = 90000; m.hero.god = true;
      const pads = [...td.pads].sort((p: any, q: any) => d(p) - d(q));
      const p = pads[0].pos;
      ['frost', 'arrow'].forEach((k, i) => td.build(pads[i + 1], k));
      S.x = p.x - 4; S.z = p.z - 4;
      m.hero.place(p.x - 1, p.z - 1, -2.4);
      m.weapon('dragonslayer'); m.temper(['fireAspect', 'critical']);
      S.boss = td.spawn('chief_warden', new V(S.x, 0, S.z));
      for (const [dx, dz, kd] of [[-2, 1, 'gardener'], [1, -2.5, 'ram'], [-3, -2, 'gardener'], [-1, -4, 'runner'], [-4.5, 0, 'berryling'], [0.5, -5, 'ram']] as const) td.spawn(kd, new V(S.x + dx, 0, S.z + dz));
      m.setCam(21); m.setCamTarget(S.x + 1, S.z + 1);
      m.step(0.6);
    },
    frame: (m, t, _dt, S) => {
      const bp = S.boss.pos;
      if (!S.boss.dead) m.click(bp.x, bp.z);
      if (t > 1.6 && !S.art) { S.art = true; m.gear.arts.meter = 1; m.special(bp.x, bp.z); }
      m.setCamTarget(bp.x + 1, bp.z + 1); m.setCam(21 - 3 * (t / 3.4));
      return { rate: t > 1.65 && t < 2.15 ? 0.5 : 1 };
    },
  },
  // ---- the end card over the glade
  {
    name: 'end', query: 'map=td2&seed=11', dur: 3.6,
    overlay: { logo: true, title: 'CO-OP ACTION + TOWER DEFENCE', tag: 'FREE &amp; OPEN SOURCE · PLAYS IN YOUR BROWSER', noOut: true },
    setup: (m, S) => {
      const td = m.td, b = td.bush.pos, d = (p: any) => Math.hypot(p.pos.x - b.x, p.pos.z - b.z);
      m.profile.data.berries = 90000; m.hero.god = true;
      const pads = [...td.pads].sort((p: any, q: any) => d(p) - d(q));
      ['storm', 'frost', 'magic', 'arrow'].forEach((k, i) => td.build(pads[i], k));
      m.hero.place(b.x + 2.5, b.z + 3.5, -2.4);
      m.step(1);
      S.b = b;
    },
    frame: (m, t, _dt, S) => { m.setCam(20 + 3 * (t / 3.6)); m.setCamTarget(S.b.x, S.b.z); },
  },
];
