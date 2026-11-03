import * as THREE from 'three';
import { bookMats, coverMat } from './bosses/grimoire.ts';
import { ITEMS } from './items.ts';
import { beamTex, glowTex, raysTex, starTex } from './loot-look.ts';
import { sigilTextures } from './sigils.ts';
import { frostTex, scorchTex } from './spells.ts';
import { shieldTex } from './auras.ts';
import type { Textures } from './textures.ts';

/**
 * Прогрев при загрузке (wiki/dev-performance.md): three компилирует шейдерную программу при первом появлении нового
 * варианта материала — синхронно, прямо в кадре боя (основной проход, теневой, нормали для AO). «Зоопарк» — по одному
 * телу каждого варианта, который рождается в бою: заклинания, лут, гримуары, цифры. Компилируем всё одним
 * `compileAsync`, затем убираем тела из сцены, а материалы держим живыми: пока материал жив, three не выбрасывает
 * программу из кэша. Заодно рисуем и загружаем на GPU кэшируемые текстуры (сигилы, свечение, иконки гримуаров).
 */

const KEEP: THREE.Material[] = [];

function variants(T: Textures): THREE.Material[] {
  const map = glowTex();
  const L = (o: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial(o);
  const B = (o: THREE.MeshBasicMaterialParameters) => new THREE.MeshBasicMaterial(o);
  return [
    // Lambert: тела заклинаний, лут, стражи, гримуар
    L({ color: '#888' }),
    L({ color: '#888', emissive: '#222' }),
    L({ map: T.square }),
    L({ vertexColors: true }),
    L({ map: T.square, vertexColors: true }),
    L({ color: '#888', side: THREE.DoubleSide }),
    L({ color: '#888', transparent: true, opacity: 0.5 }),
    L({ map: T.square, alphaTest: 0.5, side: THREE.DoubleSide }),
    // Basic: свечение, молнии, декали, пол
    B({ color: '#888' }),
    B({ color: '#888', toneMapped: false }),
    B({ color: '#888', toneMapped: false, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
    B({ color: '#888', toneMapped: false, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    // следы клинков и ленты-шлейфы (src/trail.ts, src/fx-streaks.ts): цвет в вершинах
    B({ vertexColors: true, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    B({ map, toneMapped: false }),
    B({ map, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    B({ map, transparent: true, depthWrite: false }),
    B({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    B({ map, alphaTest: 0.4, side: THREE.DoubleSide, toneMapped: false }),
    B({ map, toneMapped: false, color: new THREE.Color(1.5, 1.4, 1.2), side: THREE.DoubleSide }),
    // спрайты: ореолы, вспышки, лучи, глифы
    new THREE.SpriteMaterial({ map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    new THREE.SpriteMaterial({ map, transparent: true }),
    new THREE.SpriteMaterial({ color: '#fff' }),
    // линии и точки: погода, оверлеи
    new THREE.LineBasicMaterial({ color: '#fff', transparent: true, opacity: 0.5, depthWrite: false }),
    new THREE.PointsMaterial({ color: '#fff', size: 0.1, transparent: true, depthWrite: false, sizeAttenuation: true }),
    new THREE.PointsMaterial({ map, color: '#fff', size: 0.1, transparent: true, depthWrite: false, sizeAttenuation: true }),
  ];
}

/** Собрать зоопарк, скомпилировать все программы сцены и загрузить текстуры. Возвращает число программ после прогрева */
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
      // инстансы с цветом — пулы частиц, молний, лута
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
  // текстуры: нарисовать и отдать на GPU сейчас, а не при первом касте
  // и текстуры всего, что уже стоит в мире, но ещё не попадало в кадр (спящие стражи, лавки): иначе они грузятся
  // при первом появлении на экране — например, когда камера отъезжает на мифическом заклинании
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
    // программа зависит от цветового пространства цели: канвас (sRGB) и буфер композера (линейное) — компилируем под оба
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
