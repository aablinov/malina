import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

/**
 * Simulation boundary guard (wiki/design-multiplayer.md): modules in src/sim, src/net, src/game must load in Node
 * and must not pull in the three scene, DOM, FX, sound, styles or non-deterministic sources — they are shared by server and client.
 */
const ROOT = join(import.meta.dirname, '..', '..');
/** Pure directories: no view, DOM or randomness; src/game — headless battle on the same classes as in the browser: only has to load in Node */
const PURE = ['src/sim', 'src/net'];
const DIRS = [...PURE, 'src/game'];
/** Gameplay the server runs (hero, gear, magic, mobs, wardens): scene and sound allowed, randomness and clocks not */
const GAMEPLAY = ['src/mobs', 'src/bosses', 'src/magic', 'src/knight.ts', 'src/gear.ts', 'src/spells.ts', 'src/weapon-arts.ts', 'src/aura-offense.ts', 'src/auras.ts', 'src/weapon-synergies.ts', 'src/decoys.ts', 'src/collision.ts', 'src/level/pathfind.ts'];
/** Client modules that belong in src/net for the shared protocol but do not load in Node (browser WebSocket, DOM) */
const CLIENT_ONLY = new Set(['src/net/client.ts', 'src/net/battle-ui.ts']);
const BANNED: [RegExp, string][] = [
  [/from '[^']*\/(fx|textures|audio|spell-audio|weapon-audio|loot-look)(\.ts)?'/, 'view and sound'],
  [/\.css'/, 'styles'],
  [/THREE\.(Group|Mesh|Material|MeshBasicMaterial|MeshStandardMaterial|Texture|Scene|Object3D|Sprite|Points)\b/, 'three scene'],
  [/\b(document|window|localStorage|sessionStorage|navigator)\./, 'DOM'],
  [/\bMath\.random\b/, 'Math.random — only world.rng'],
  [/\b(performance\.now|Date\.now)\b/, 'clock — only the world tick'],
];

function walk(dir: string): string[] {
  if (!statSync(dir).isDirectory()) return [dir];
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (f.endsWith('.ts') && !f.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const list = (dirs: string[]): string[] => dirs.flatMap((d) => { try { return walk(join(ROOT, d)); } catch { return []; } })
  .map((p) => relative(ROOT, p)).filter((p) => !CLIENT_ONLY.has(p));
const pure = list(PURE), files = list(DIRS), gameplay = list(GAMEPLAY);
const DETERMINISM = BANNED.filter(([, why]) => why.startsWith('Math.random') || why.startsWith('clock'));

test('simulation and net modules do not touch DOM, scene or randomness', () => {
  const bad: string[] = [];
  for (const f of pure) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    for (const [re, why] of BANNED) {
      const m = re.exec(src);
      if (m) bad.push(`${f}: ${why} (${m[0]})`);
    }
  }
  assert.deepEqual(bad, []);
});

test('simulation and net modules load in Node', async () => {
  for (const f of files) await import(join(ROOT, f));
});

test('server gameplay (hero, gear, magic, mobs, wardens) does not touch Math.random or clocks — only rnd() and battle time', () => {
  const bad: string[] = [];
  for (const f of gameplay) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    for (const [re, why] of DETERMINISM) {
      const m = re.exec(src);
      if (m) bad.push(`${f}: ${why} (${m[0]})`);
    }
  }
  assert.deepEqual(bad, []);
});
