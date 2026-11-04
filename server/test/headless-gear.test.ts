import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { AURA_METER } from '../../src/auras.ts';
import { ITEMS, MAX_SOULS } from '../../src/items.ts';
import { headlessBattle } from './headless-helpers.ts';

/**
 * Снаряжение на безголовом сервере: каждое заклинание и артефакт, каждая аура и спец-удар каждого оружия творятся в Node
 * без DOM (`document` там нет — любая забытая текстура или холст уронила бы матч, как руны в src/sigils.ts)
 */
test('все артефакты и заклинания творятся на сервере без DOM', () => {
  const b = headlessBattle('td', 3);
  const at = b.hero.pos.clone().add(new THREE.Vector3(3, 0, 0));
  for (let i = 0; i < 4; i++) b.pack.spawn('berryling', at.clone().add(new THREE.Vector3(i * 0.8, 0, 0.5)));
  const arts = ITEMS.filter((d) => d.artifact);
  assert.ok(arts.length > 30);
  const failed: string[] = [];
  for (const d of arts) {
    const it = b.profile.add(d.id, 1);
    b.profile.equip(it.uid, 0);
    b.gear.artT[0][0] = 0;
    b.profile.data.souls = MAX_SOULS;
    try {
      const pressed = b.gear.pressArtifact(0, at);
      for (let k = 0; k < 30; k++) b.step();
      if (pressed && b.gear.spells.charging) b.gear.releaseArtifact(0, at);
      else if (!pressed) b.gear.useArtifact(0, at, 1);
      for (let k = 0; k < 60 * 4; k++) b.step();
    } catch (e) { failed.push(`${d.id}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  assert.deepEqual(failed, []);
});

test('все ауры вспыхивают и все спец-удары оружия идут на сервере без DOM', () => {
  const b = headlessBattle('td', 4);
  const at = b.hero.pos.clone().add(new THREE.Vector3(2.5, 0, 0));
  for (let i = 0; i < 3; i++) b.pack.spawn('berryling', at.clone().add(new THREE.Vector3(i * 0.7, 0, 0)));
  const failed: string[] = [];
  for (const d of ITEMS.filter((x) => x.aura)) {
    try {
      const it = b.profile.add(d.id, 1);
      b.profile.equip(it.uid);
      b.gear.auras.meter = AURA_METER;
      b.gear.auras.flareT = 0;
      b.gear.flareAura();
      b.input.attack = true;
      for (let k = 0; k < 60 * 2; k++) { b.input.aim.copy(at); b.step(); }
    } catch (e) { failed.push(`${d.id}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  for (const d of ITEMS.filter((x) => x.weapon)) {
    try {
      const it = b.profile.add(d.id, 1);
      b.profile.equip(it.uid);
      b.gear.arts.meter = 1;
      assert.ok(b.gear.special(at), `${d.id}: спец-удар начался`);
      for (let k = 0; k < 60 * 3; k++) { b.input.aim.copy(at); b.step(); }
    } catch (e) { failed.push(`${d.id}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  assert.deepEqual(failed, []);
});
