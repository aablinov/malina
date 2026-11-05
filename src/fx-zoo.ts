import * as THREE from 'three';
import { bookMats, coverMat } from './bosses/grimoire.ts';
import { ITEMS } from './items.ts';
import { beamTex, glowTex, raysTex, starTex } from './loot-look.ts';
import { sigilTextures } from './sigils.ts';
import { frostTex, scorchTex } from './spells.ts';
import { shieldTex } from './auras.ts';
import type { Textures } from './textures.ts';

/**
 * Warm-up at load (wiki/dev-performance.md): three compiles a shader program when a new material variant first
 * appears — synchronously, right in a battle frame (main pass, shadow pass, normals for AO). The "zoo" is one
 * body of every variant that is born in battle: spells, loot, grimoires, numbers. We compile everything with one
 * `compileAsync`, then remove the bodies from the scene but keep the materials alive: while a material lives, three does not evict
 * its program from the cache. Along the way we draw and upload to the GPU the cacheable textures (sigils, glow, grimoire icons).
 */

const KEEP: THREE.Material[] = [];

function variants(T: Textures): THREE.Material[] {
  const map = glowTex();
  const L = (o: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial(o);
  const B = (o: THREE.MeshBasicMaterialParameters) => new THREE.MeshBasicMaterial(o);
  return [
    // Lambert: spell bodies, loot, wardens, grimoire
    L({ color: '#888' }),
    L({ color: '#888', emissive: '#222' }),
    L({ map: T.square }),
    L({ vertexColors: true }),
    L({ map: T.square, vertexColors: true }),
    L({ color: '#888', side: THREE.DoubleSide }),
    L({ color: '#888', transparent: true, opacity: 0.5 }),
    L({ map: T.square, alphaTest: 0.5, side: THREE.DoubleSide }),
    // Basic: glow, lightning, decals, floor
    B({ color: '#888' }),
    B({ color: '#888', toneMapped: false }),
    B({ color: '#888', toneMapped: false, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
    B({ color: '#888', toneMapped: false, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    // blade trails and streak ribbons (src/trail.ts, src/fx-streaks.ts): vertex colours
    B({ vertexColors: true, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    B({ map, toneMapped: false }),
    B({ map, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    B({ map, transparent: true, depthWrite: false }),
    B({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    B({ map, alphaTest: 0.4, side: THREE.DoubleSide, toneMapped: false }),
    B({ map, toneMapped: false, color: new THREE.Color(1.5, 1.4, 1.2), side: THREE.DoubleSide }),
    // sprites: halos, flashes, rays, glyphs
    new THREE.SpriteMaterial({ map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    new THREE.SpriteMaterial({ map, transparent: true }),
    new THREE.SpriteMaterial({ color: '#fff' }),
    // lines and points: weather, overlays
    new THREE.LineBasicMaterial({ color: '#fff', transparent: true, opacity: 0.5, depthWrite: false }),
    new THREE.PointsMaterial({ color: '#fff', size: 0.1, transparent: true, depthWrite: false, sizeAttenuation: true }),
    new THREE.PointsMaterial({ map, color: '#fff', size: 0.1, transparent: true, depthWrite: false, sizeAttenuation: true }),
  ];
}

/** Build the zoo, compile all scene programs and upload textures. Returns the program count after the warm-up */
export async function warmUp(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, T: Textures, target: THREE.WebGLRenderTarget | null = null): Promise<number> {
  const zoo = new THREE.Group();
  zoo.name = 'zoo';
  const box = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  const pts = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0.1, 0)]);
  const mats = variants(T);
  const book = bookMats();
  const spells = ITEMS.filter((d) => d.slot === 'artifact' && d.spell).map((d) => coverMat(d.icon));
  mats.push(book.leather, book.gold, book.paper, book.spine, ...spells);
  for (const m of mats) {
    let o: THREE.Object3D;
    if (m instanceof THREE.SpriteMaterial) o = new THREE.Sprite(m);
    else if (m instanceof THREE.PointsMaterial) o = new THREE.Points(pts, m);
    else if (m instanceof THREE.LineBasicMaterial) o = new THREE.LineSegments(pts, m);
    else {
      const mesh = new THREE.Mesh(box, m);
      mesh.castShadow = mesh.receiveShadow = true;
      o = mesh;
      // instances with colour — pools of particles, lightning, loot
      const inst = new THREE.InstancedMesh(box, m, 1);
      inst.setColorAt(0, new THREE.Color('#fff'));
      inst.castShadow = true;
      zoo.add(inst);
    }
    zoo.add(o);
  }
  zoo.position.set(0, -100, 0);
  scene.add(zoo);
  KEEP.push(...mats);
  // textures: draw and hand to the GPU now, not on the first cast
  // and the textures of everything already standing in the world but not yet in frame (sleeping wardens, shops): otherwise they load
  // on their first appearance on screen — e.g. when the camera pulls back on a mythic spell
  const textures = new Set<THREE.Texture>([...sigilTextures(), glowTex(), raysTex(), beamTex(), starTex(), scorchTex(), frostTex(), shieldTex(), T.glow, T.square]);
  scene.traverse((o) => {
    const mats = (o as THREE.Mesh).material;
    for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
      for (const k of ['map', 'alphaMap', 'emissiveMap'] as const) {
        const t = (m as unknown as Record<string, unknown>)[k];
        if (t instanceof THREE.Texture) textures.add(t);
      }
    }
  });
  for (const t of textures) renderer.initTexture(t);
  try {
    // the program depends on the target colour space: canvas (sRGB) and composer buffer (linear) — compile for both
    await renderer.compileAsync(scene, camera);
    if (target) {
      renderer.setRenderTarget(target);
      try { await renderer.compileAsync(scene, camera); } finally { renderer.setRenderTarget(null); }
    }
  } finally {
    scene.remove(zoo);
  }
  return renderer.info.programs?.length ?? 0;
}
