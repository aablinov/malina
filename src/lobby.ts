import { campLevel, REGION_BY_ID, regionAt, type MissionMap, type RegionId } from './map';
import type { Session } from './session';
import { ArsenalUI, type ArsenalHooks } from './shop';
import { WEAPON_BY_ID, gunPreview } from './weapons';

export interface LobbyHooks extends ArsenalHooks {
  session: Session;
  map: MissionMap;
  launch(region: RegionId): void;
  resetProfile(): void;
}

export const LEVEL_COLORS = ['#7fd04a', '#c8d04a', '#ffcf5a', '#ff9a3a', '#ff5a3a', '#d02a6a'];

/** Лобби сессии: отряд, арсенал, карта высадки */
export class Lobby {
  private readonly arsenal: ArsenalUI;
  private readonly canvas: HTMLCanvasElement;
  private tab: 'arsenal' | 'map' = 'map';
  private hover: RegionId | null = null;

  constructor(private readonly root: HTMLElement, private readonly h: LobbyHooks) {
    const s = h.session;
    root.innerHTML = `
      <div class="lobby">
        <header class="lb-head">
          <div class="lb-title"><span class="logo-sm">МАЛИНА</span><span class="lb-sub">Лобби отряда</span></div>
          <div class="lb-session">
            <span>Сессия</span><b id="lbCode">${s.id}</b>
            <button class="mini" id="lbCopy">Копировать</button>
          </div>
          <div class="shop-wallet"><span class="ic ic-berry"></span><b id="lbBerries">0</b></div>
        </header>
        <div class="lb-body">
          <aside class="lb-squad">
            <h3>Отряд <small>${s.players.length}/${s.slots.length}</small></h3>
            <div id="lbSlots" class="slots"></div>
            <p class="lb-note">Друзья смогут подключиться по коду сессии, когда появится сетевая игра.</p>
            <button class="mini ghost" id="lbReset">Сбросить профиль</button>
          </aside>
          <section class="lb-main">
            <nav class="tabs">
              <button data-tab="map" id="tabMap">Карта высадки</button>
              <button data-tab="arsenal" id="tabArsenal">Арсенал</button>
            </nav>
            <div class="tab-map" id="paneMap">
              <div class="map-wrap"><canvas id="lbMap" width="720" height="480"></canvas></div>
              <div class="map-info" id="lbInfo"></div>
            </div>
            <div class="tab-arsenal" id="paneArsenal"></div>
          </section>
        </div>
        <footer class="lb-foot">
          <div id="lbLoadout" class="loadout"></div>
          <button class="btn" id="lbLaunch">ДЕСАНТИРОВАТЬСЯ</button>
        </footer>
      </div>`;
    const q = <E extends HTMLElement>(sel: string) => root.querySelector<E>(sel)!;
    this.canvas = q<HTMLCanvasElement>('#lbMap');
    this.arsenal = new ArsenalUI(q('#paneArsenal'), { ...h, changed: () => { h.changed(); this.render(); } });
    q('#lbCopy').addEventListener('click', () => {
      const code = s.id;
      const done = () => { q('#lbCopy').textContent = 'Скопировано'; setTimeout(() => { q('#lbCopy').textContent = 'Копировать'; }, 1500); };
      navigator.clipboard?.writeText(code).then(done, () => this.selectCode());
    });
    q('#lbReset').addEventListener('click', () => { h.resetProfile(); this.render(); });
    root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => { this.tab = b.dataset.tab as 'map' | 'arsenal'; this.render(); }));
    q('#lbLaunch').addEventListener('click', () => h.launch(s.region));
    this.canvas.addEventListener('mousemove', (e) => { this.hover = this.regionAtEvent(e); this.drawMap(); });
    this.canvas.addEventListener('mouseleave', () => { this.hover = null; this.drawMap(); });
    this.canvas.addEventListener('click', (e) => {
      const r = this.regionAtEvent(e);
      if (r) { s.region = r; this.render(); }
    });
  }

  private selectCode(): void {
    const el = this.root.querySelector('#lbCode');
    if (!el) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges(); sel?.addRange(range);
  }

  private regionAtEvent(e: MouseEvent): RegionId | null {
    const rect = this.canvas.getBoundingClientRect();
    const { halfX, halfZ } = this.h.map;
    const x = ((e.clientX - rect.left) / rect.width) * 2 * halfX - halfX;
    const z = ((e.clientY - rect.top) / rect.height) * 2 * halfZ - halfZ;
    if (Math.abs(x) > halfX || Math.abs(z) > halfZ) return null;
    return regionAt(x, z);
  }

  get visible(): boolean { return !this.root.classList.contains('hidden'); }
  show(): void { this.root.classList.remove('hidden'); this.render(); }
  hide(): void { this.root.classList.add('hidden'); }

  render(): void {
    const s = this.h.session;
    const q = <E extends HTMLElement>(sel: string) => this.root.querySelector<E>(sel)!;
    q('#lbBerries').textContent = String(this.h.berries());
    q('#tabMap').classList.toggle('on', this.tab === 'map');
    q('#tabArsenal').classList.toggle('on', this.tab === 'arsenal');
    q('#paneMap').classList.toggle('hidden', this.tab !== 'map');
    q('#paneArsenal').classList.toggle('hidden', this.tab !== 'arsenal');
    if (this.tab === 'arsenal') this.arsenal.render();

    const w = WEAPON_BY_ID[this.h.equipped()];
    q('#lbSlots').innerHTML = s.slots.map((p, i) => p
      ? `<div class="pslot on" style="--pc:${p.color}">
           <div class="pav"></div>
           <div class="pinfo"><b>${p.name}${p.local ? ' (вы)' : ''}</b><small>${p.ready ? 'Готов' : 'Выбирает снаряжение'}</small></div>
           <img class="pgun" src="${gunPreview(w, this.h.level(w.id))}" alt="" />
         </div>`
      : `<div class="pslot empty" style="--pc:${s.slotColor(i)}"><div class="pav"></div><div class="pinfo"><b>Свободно</b><small>Ждём игрока…</small></div></div>`).join('');

    const reg = REGION_BY_ID[s.region];
    const levels = this.h.map.camps.map((c) => campLevel(c, reg.drop));
    const near = this.h.map.camps.filter((c) => c.region === s.region).length;
    q('#lbInfo').innerHTML = `
      <div class="ri-name" style="--rc:${reg.color}">${reg.name}</div>
      <p>${reg.desc}</p>
      <dl>
        <div><dt>Кустов на карте</dt><dd>${this.h.map.camps.length}</dd></div>
        <div><dt>В этом регионе</dt><dd>${near}</dd></div>
        <div><dt>Уровень жуков</dt><dd>${Math.min(...levels)}–${Math.max(...levels)}</dd></div>
      </dl>
      <p class="hint">Чем дальше от точки высадки, тем жуков больше и они сильнее. Подними флаг над каждым кустом.</p>
      <div class="legend">${LEVEL_COLORS.map((c, i) => `<span style="--lc:${c}">${i + 1}</span>`).join('')}</div>`;
    q('#lbLoadout').innerHTML = `<img src="${gunPreview(w, this.h.level(w.id))}" alt="" /><div><small>Ствол для высадки</small><b>${w.name} ${'★'.repeat(this.h.level(w.id))}</b><small>Остальные купленные — клавишами 1–8 в бою</small></div>`;
    this.drawMap();
  }

  private drawMap(): void {
    const c = this.canvas, g = c.getContext('2d');
    if (!g) return;
    const { halfX, halfZ, regions, camps, obstacles } = this.h.map;
    const W = c.width, H = c.height;
    const X = (x: number) => ((x + halfX) / (2 * halfX)) * W;
    const Z = (z: number) => ((z + halfZ) / (2 * halfZ)) * H;
    const sel = this.h.session.region;
    const drop = REGION_BY_ID[sel].drop;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#10141c'; g.fillRect(0, 0, W, H);
    for (const r of regions) {
      const x0 = X(r.x0), z0 = Z(r.z0), w = X(r.x1) - x0, h = Z(r.z1) - z0;
      g.globalAlpha = r.id === sel ? 0.42 : r.id === this.hover ? 0.3 : 0.18;
      g.fillStyle = r.color; g.fillRect(x0, z0, w, h);
      g.globalAlpha = 1;
      g.strokeStyle = r.id === sel ? '#ffffff' : 'rgba(255,255,255,0.15)';
      g.lineWidth = r.id === sel ? 3 : 1;
      g.strokeRect(x0 + 1.5, z0 + 1.5, w - 3, h - 3);
      g.font = 'bold 15px Rubik, sans-serif';
      g.fillStyle = r.id === sel ? '#fff' : 'rgba(255,255,255,0.7)';
      g.textAlign = 'left';
      g.fillText(r.name, x0 + 12, z0 + 24);
    }
    // дороги
    g.strokeStyle = 'rgba(200,170,120,0.35)'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(X(-halfX), Z(0)); g.lineTo(X(halfX), Z(0)); g.moveTo(X(0), Z(-halfZ)); g.lineTo(X(0), Z(halfZ)); g.stroke();
    // препятствия
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (const o of obstacles) { g.beginPath(); g.arc(X(o.x), Z(o.z), Math.max(2, o.r * 3), 0, Math.PI * 2); g.fill(); }
    // точки высадки
    for (const r of regions) {
      const x = X(r.drop.x), z = Z(r.drop.z);
      const on = r.id === sel;
      g.strokeStyle = on ? '#ffd84a' : 'rgba(255,255,255,0.5)'; g.lineWidth = on ? 3 : 1.5;
      g.beginPath(); g.arc(x, z, on ? 14 : 9, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(x - 6, z - 3); g.lineTo(x + 6, z - 3); g.lineTo(x, z + 7); g.closePath();
      g.fillStyle = on ? '#ffd84a' : 'rgba(255,255,255,0.5)'; g.fill();
    }
    // лагеря с уровнем относительно выбранной точки высадки
    for (const cp of camps) {
      const lvl = campLevel(cp, drop);
      const x = X(cp.x), z = Z(cp.z);
      g.fillStyle = '#0b0d12'; g.beginPath(); g.arc(x, z, 13, 0, Math.PI * 2); g.fill();
      g.strokeStyle = LEVEL_COLORS[lvl - 1]; g.lineWidth = 3; g.beginPath(); g.arc(x, z, 12, 0, Math.PI * 2); g.stroke();
      g.fillStyle = LEVEL_COLORS[lvl - 1];
      g.font = 'bold 12px "Press Start 2P", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(lvl), x + 1, z + 1);
      g.textBaseline = 'alphabetic';
    }
  }
}
