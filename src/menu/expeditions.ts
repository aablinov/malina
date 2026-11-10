import { BED_KINDS, bedCost, BEDS, bedsOf, orderOf, seedsOf, unlockedDifficulty, type BedKind } from '../expedition/camp.ts';
import { boardDay, dailyBoard, dailyOrder, MAX_DIFFICULTY, missionId, missionMods, OP_BONUS, OP_STEP, operation, parseMission, type Mission, type Modifier, type OrderKind } from '../expedition/mission.ts';
import type { ExpeditionParams, ExpeditionSpec, ObjectiveKind } from '../expedition/types.ts';
import { iconURL } from '../icons.ts';
import { t } from '../i18n/i18n.ts';
import type { ProfileData } from '../items.ts';
import { buildExpedition } from '../level/expedition-map.ts';
import { LIBRARY } from '../level/prefab-lib/index.ts';

/**
 * The mission board of the camp (wiki/design-expeditions.md, sections 2 and 10): three operations a day per difficulty, the same
 * for everyone; the card of the chosen mission with its place in the operation, the modifiers and a sketch of the map where the
 * squad picks a landing; under the board — the order of the day and the camp beds planted with seeds
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
const MOD_TITLE: Record<Modifier, string> = { mist: t('Mist'), downpour: t('Downpour'), fullmoon: t('Full moon'), fury: t('Order\'s fury'), quiet: t('Quiet forest') };
const MOD_HINT: Record<Modifier, string> = {
  mist: t('the haze stands close'), downpour: t('parcels fly twice as long'), fullmoon: t('dusk comes sooner, a golden seed turns up earlier'),
  fury: t('larger patrols, a quarter more loot'), quiet: t('no horn-blowers, tougher lairs'),
};
const ORDER_TEXT: Record<OrderKind, string> = { lairs: t('Burn {n} lairs'), beacons: t('Light {n} beacons'), seeds: t('Bring out {n} seeds'), missions: t('Complete {n} missions') };
const BED_TITLE: Record<BedKind, string> = { totem: t('Totem bed'), stash: t('Stash bed'), haste: t('Courier bed') };
const BED_HINT: Record<BedKind, string> = { totem: t('+1 totem for the squad'), stash: t('+25 raspberries at the start of a mission'), haste: t('parcels rest 10 % less') };

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
const icon = (k: ObjectiveKind): string => `<img class="px" src="${iconURL(OBJECTIVE_ICON[k])}" alt="">`;
const pct = (k: number): string => `+${Math.round(k * 100)} %`;

/** Missions of an operation won in a row — the next one pays more (src/expedition/mission.ts `operationMult`) */
export interface Streak { seed: number; difficulty: number; next: number }

/** The mission of an operation the squad is on: the one after the last won, the first otherwise */
export const currentStep = (seed: number, difficulty: number, streak: Streak | null): Mission => {
  const op = operation(seed, difficulty);
  return op.missions[streak && streak.seed === seed && streak.difficulty === difficulty ? Math.min(streak.next, op.missions.length - 1) : 0];
};

/** The board: difficulty buttons (locked above the hero's ladder), the day's three operations, the order of the day and the camp beds */
export function boardHtml(selected: string, difficulty: number, profile: ProfileData, streak: Streak | null, now = Date.now()): string {
  const sel = parseMission(selected), open = unlockedDifficulty(profile);
  const diffs = Array.from({ length: MAX_DIFFICULTY }, (_, i) => `<button class="mm-btn small${i + 1 === difficulty ? ' primary' : ''}${i + 1 > open ? ' locked' : ''}" data-diff="${i + 1}"${i + 1 > open ? ` title="${t('Win a mission of difficulty {n} first', { n: i })}"` : ''}>${i + 1 > open ? '🔒' : i + 1}</button>`).join('');
  const tiles = dailyBoard(boardDay(now), difficulty).map((op) => {
    const on = !!sel?.op && sel.op.seed === op.seed && sel.difficulty === op.difficulty;
    const step = currentStep(op.seed, op.difficulty, streak);
    return `<button class="mm-map${on ? ' sel' : ''}" data-map="${on ? selected : missionId(step)}" style="--bg:${OBJECTIVE_BG[step.objective]}">
      <span class="mm-map-art">${icon(step.objective)}</span>
      <b>${op.missions.map((m, i) => `<i class="mm-op-step${i === step.op!.index ? ' on' : i < step.op!.index ? ' done' : ''}">${icon(m.objective)}</i>`).join('<i class="mm-op-arrow">›</i>')}</b>
      <span class="mm-diff d${tone(op.difficulty)}">${pips(op.difficulty)} · ${op.mods.map((m) => MOD_TITLE[m]).join(', ')}</span>
    </button>`;
  }).join('');
  return `<h4 class="mm-pane-title">${t('Expeditions — today\'s operations')}</h4>
    <div class="mm-exp-diff"><span>${t('Difficulty')}</span>${diffs}</div>
    <div class="mm-maps">${tiles}</div>${campHtml(profile, now)}`;
}

/** Under the board: the order of the day, the seeds and the beds they are planted in */
function campHtml(profile: ProfileData, now: number): string {
  const day = boardDay(now), order = dailyOrder(day), prog = orderOf(profile, day), seeds = seedsOf(profile), beds = bedsOf(profile);
  const cost = (c: { common: number; rare: number; golden: number }): string => [[c.common, '#8fd45a'], [c.rare, '#5ab8ff'], [c.golden, '#ffcc3a']].filter(([n]) => (n as number) > 0).map(([n, col]) => `<span style="color:${col}">${n}</span>`).join(' + ');
  const rows = BED_KINDS.map((k) => {
    const lv = beds[k], full = lv >= BEDS[k].max, c = bedCost(lv + 1), can = !full && seeds.common >= c.common && seeds.rare >= c.rare && seeds.golden >= c.golden;
    return `<button class="mm-btn small${can ? '' : ' locked'}" data-bed="${k}"><b>${BED_TITLE[k]} ${'●'.repeat(lv)}${'○'.repeat(BEDS[k].max - lv)}</b><small>${BED_HINT[k]}${full ? '' : ` · ${t('seeds')}: ${cost(c)}`}</small></button>`;
  }).join('');
  return `<h4 class="mm-pane-title">${t('Order of the day')}</h4>
    <p class="mm-exp-order${prog.done ? ' done' : ''}">${t(ORDER_TEXT[order.kind], { n: order.need })} — ${prog.done ? t('done') : `${prog.n} / ${order.need}`} · ${t('reward')}: ${order.berries} ${t('raspberries')}, <span style="color:#5ab8ff">${order.rare}</span></p>
    <h4 class="mm-pane-title">${t('Camp beds')} · ${t('seeds')}: <span style="color:#8fd45a">${seeds.common}</span> · <span style="color:#5ab8ff">${seeds.rare}</span> · <span style="color:#ffcc3a">${seeds.golden}</span></h4>
    <div class="mm-parcels">${rows}</div>`;
}

/** The chosen mission: its place in the operation, the modifiers, what is on the map and the sketch with the landing points */
export function missionCardHtml(map: string, streak: Streak | null): string {
  const p = parseMission(map);
  if (!p) return '';
  const s = missionSpec(p), H = s.half;
  const dot = (x: number, z: number, r: number, cls: string): string => `<circle cx="${x}" cy="${z}" r="${r}" class="${cls}"/>`;
  const marks = [
    ...s.lairs.map((l) => dot(l.x, l.z, 3 + l.size * 1.5, p.objective === 'lairs' ? 'obj' : 'lair')),
    ...(p.objective === 'lairs' ? [] : s.objective.sites.map((o) => dot(o.x, o.z, 5, 'obj'))),
    dot(s.extraction.x, s.extraction.z, 6, 'pad'),
    ...s.landings.map((l, i) => `<g class="land${i === p.landing ? ' on' : ''}" data-landing="${i}">${dot(l.x, l.z, 8, '')}<text x="${l.x}" y="${l.z + 3.5}">${i + 1}</text></g>`),
  ].join('');
  const op = p.op ? operation(p.op.seed, p.difficulty) : null;
  const inRow = !!op && !!streak && streak.seed === op.seed && streak.difficulty === p.difficulty && streak.next === p.op!.index;
  const chain = op ? `<p class="mm-exp-chain">${t('Mission {n} of {total}', { n: p.op!.index + 1, total: op.missions.length })} · ${t('each next one pays {k} more, the last — another {b}', { k: pct(OP_STEP), b: pct(OP_BONUS) })}${inRow && p.op!.index > 0 ? ` · <b>${t('in a row')}</b>` : ''}</p>` : '';
  const mods = missionMods(p).map((m) => `<li><b>${MOD_TITLE[m]}</b> — ${MOD_HINT[m]}</li>`).join('');
  return `<div class="mm-card map" style="--bg:${OBJECTIVE_BG[p.objective]}"><div class="mm-card-tag">${t('Expedition')} · ${t('difficulty {n}', { n: p.difficulty })}</div>
    <h3>${OBJECTIVE_TITLE[p.objective]}</h3><p>${OBJECTIVE_BLURB[p.objective]}</p>${chain}${mods ? `<ul>${mods}</ul>` : ''}
    <dl><dt>${t('Lairs')}</dt><dd>${s.lairs.length}</dd><dt>${t('Secondary')}</dt><dd>${s.secondary.length}</dd><dt>${t('Points of interest')}</dt><dd>${s.pois.length}</dd><dt>${t('Seeds')}</dt><dd>${s.pois.filter((q) => q.seed).length}</dd></dl>
    <svg class="mm-exp-map" viewBox="${-H} ${-H} ${H * 2} ${H * 2}"><rect x="${-H + 4}" y="${-H + 4}" width="${H * 2 - 8}" height="${H * 2 - 8}" rx="6"/>${marks}</svg>
    <p class="mm-exp-legend">${t('Pick a landing: 1, 2 or 3 · yellow — objective · blue — balloon · red — lairs')}</p></div>`;
}
