import { boardDay, dailyBoard, MAX_DIFFICULTY, missionId, parseMission } from '../expedition/mission.ts';
import type { ExpeditionParams, ExpeditionSpec, ObjectiveKind } from '../expedition/types.ts';
import { iconURL } from '../icons.ts';
import { t } from '../i18n/i18n.ts';
import { buildExpedition } from '../level/expedition-map.ts';
import { LIBRARY } from '../level/prefab-lib/index.ts';

/**
 * The mission board of the camp (wiki/design-expeditions.md, section 2): three missions a day per difficulty, the same for
 * everyone; the card of the chosen one with a sketch of its map, where the squad picks one of three landing points
 */

export const OBJECTIVE_TITLE: Record<ObjectiveKind, string> = { lairs: t('Burn the lairs'), beacons: t('Light the beacons'), bush: t('Plant the raspberry bush') };
const OBJECTIVE_BLURB: Record<ObjectiveKind, string> = {
  lairs: t('The Order has dug in. Find every lair on the map and burn it down with sword, arrows and spells.'),
  beacons: t('Old beacons stand dark. Light each one with F and hold it until the fire takes — a raid comes for every beacon.'),
  bush: t('A free plot waits for a seedling. Drive off its guards, plant the bush and hold three raids.'),
};
export const OBJECTIVE_ICON: Record<ObjectiveKind, string> = { lairs: 'axe', beacons: 'spark', bush: 'berry' };
export const OBJECTIVE_BG: Record<ObjectiveKind, string> = {
  lairs: 'linear-gradient(160deg, #5c2338, #20121c 70%)', beacons: 'linear-gradient(160deg, #6a4a16, #24190c 70%)', bush: 'linear-gradient(160deg, #2c5a2a, #132016 70%)',
};
export const missionBlurb = (k: ObjectiveKind): string => OBJECTIVE_BLURB[k];

const specs = new Map<string, ExpeditionSpec>();
/** The mission's map description — built once per mission (≈ 0.1 s) for the sketch; the landing does not change the map */
export function missionSpec(p: ExpeditionParams): ExpeditionSpec {
  const key = missionId({ ...p, landing: 0 });
  let s = specs.get(key);
  if (!s) { s = buildExpedition({ ...p, landing: 0 }, Object.fromEntries(LIBRARY.map((x) => [x.id, x]))).meta.expedition as ExpeditionSpec; specs.set(key, s); }
  return s;
}

const pips = (d: number): string => `${'◆'.repeat(d)}${'◇'.repeat(MAX_DIFFICULTY - d)}`;
const tone = (d: number): number => (d <= 2 ? 1 : d <= 5 ? 2 : 3);

/** The board: difficulty buttons and the day's three missions */
export function boardHtml(selected: string, difficulty: number, now = Date.now()): string {
  const sel = parseMission(selected);
  const diffs = Array.from({ length: MAX_DIFFICULTY }, (_, i) => `<button class="mm-btn small${i + 1 === difficulty ? ' primary' : ''}" data-diff="${i + 1}">${i + 1}</button>`).join('');
  const tiles = dailyBoard(boardDay(now), difficulty).map((m) => {
    const on = !!sel && sel.seed === m.seed && sel.difficulty === m.difficulty && sel.objective === m.objective;
    return `<button class="mm-map${on ? ' sel' : ''}" data-map="${on ? selected : missionId(m)}" style="--bg:${OBJECTIVE_BG[m.objective]}">
      <span class="mm-map-art"><img class="px" src="${iconURL(OBJECTIVE_ICON[m.objective])}" alt=""></span>
      <b>${OBJECTIVE_TITLE[m.objective]}</b>
      <span class="mm-diff d${tone(m.difficulty)}">${pips(m.difficulty)}</span>
    </button>`;
  }).join('');
  return `<h4 class="mm-pane-title">${t('Expeditions — today\'s board')}</h4>
    <div class="mm-exp-diff"><span>${t('Difficulty')}</span>${diffs}</div>
    <div class="mm-maps">${tiles}</div>`;
}

/** The chosen mission: what to do, what is on the map, and the sketch with the landing points */
export function missionCardHtml(map: string): string {
  const p = parseMission(map);
  if (!p) return '';
  const s = missionSpec(p), H = s.half;
  const dot = (x: number, z: number, r: number, cls: string, extra = ''): string => `<circle cx="${x}" cy="${z}" r="${r}" class="${cls}"${extra}/>`;
  const marks = [
    ...s.lairs.map((l) => dot(l.x, l.z, 3 + l.size * 1.5, p.objective === 'lairs' ? 'obj' : 'lair')),
    ...(p.objective === 'lairs' ? [] : s.objective.sites.map((o) => dot(o.x, o.z, 5, 'obj'))),
    dot(s.extraction.x, s.extraction.z, 6, 'pad'),
    ...s.landings.map((l, i) => `<g class="land${i === p.landing ? ' on' : ''}" data-landing="${i}">${dot(l.x, l.z, 8, '')}<text x="${l.x}" y="${l.z + 3.5}">${i + 1}</text></g>`),
  ].join('');
  return `<div class="mm-card map" style="--bg:${OBJECTIVE_BG[p.objective]}"><div class="mm-card-tag">${t('Expedition')} · ${t('difficulty {n}', { n: p.difficulty })}</div>
    <h3>${OBJECTIVE_TITLE[p.objective]}</h3><p>${OBJECTIVE_BLURB[p.objective]}</p>
    <dl><dt>${t('Lairs')}</dt><dd>${s.lairs.length}</dd><dt>${t('Secondary')}</dt><dd>${s.secondary.length}</dd><dt>${t('Points of interest')}</dt><dd>${s.pois.length}</dd><dt>${t('Seeds')}</dt><dd>${s.pois.filter((q) => q.seed).length}</dd></dl>
    <svg class="mm-exp-map" viewBox="${-H} ${-H} ${H * 2} ${H * 2}"><rect x="${-H + 4}" y="${-H + 4}" width="${H * 2 - 8}" height="${H * 2 - 8}" rx="6"/>${marks}</svg>
    <p class="mm-exp-legend">${t('Pick a landing: 1, 2 or 3 · yellow — objective · blue — balloon · red — lairs')}</p></div>`;
}
