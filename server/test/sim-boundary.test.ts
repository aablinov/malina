import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

/**
 * Страж границы симуляции (wiki/design-multiplayer.md): модули src/sim, src/net, src/game должны грузиться в Node
 * и не тянуть сцену three, DOM, FX, звук, стили и недетерминированные источники — они общие для сервера и клиента.
 */
const ROOT = join(import.meta.dirname, '..', '..');
/** Чистые каталоги: без вида, DOM и случайности; src/game — безголовый бой на тех же классах, что в браузере: только грузится в Node */
const PURE = ['src/sim', 'src/net'];
const DIRS = [...PURE, 'src/game'];
/** Клиентские модули, которым место в src/net ради общего протокола, но в Node они не грузятся (WebSocket браузера, DOM) */
const CLIENT_ONLY = new Set(['src/net/client.ts', 'src/net/battle-ui.ts']);
const BANNED: [RegExp, string][] = [
  [/from '[^']*\/(fx|textures|audio|spell-audio|weapon-audio|loot-look)(\.ts)?'/, 'вид и звук'],
  [/\.css'/, 'стили'],
  [/THREE\.(Group|Mesh|Material|MeshBasicMaterial|MeshStandardMaterial|Texture|Scene|Object3D|Sprite|Points)\b/, 'сцена three'],
  [/\b(document|window|localStorage|sessionStorage|navigator)\./, 'DOM'],
  [/\bMath\.random\b/, 'Math.random — только world.rng'],
  [/\b(performance\.now|Date\.now)\b/, 'часы — только тик мира'],
];

function walk(dir: string): string[] {
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
const pure = list(PURE), files = list(DIRS);

test('модули симуляции и сети не трогают DOM, сцену и случайность', () => {
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

test('модули симуляции и сети грузятся в Node', async () => {
  for (const f of files) await import(join(ROOT, f));
});
