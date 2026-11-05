import { sfx } from '../audio.ts';
import { t } from '../i18n/i18n.ts';
import { iconImg, iconURL } from '../icons.ts';
import { itemDef, RARITY, xpToNext, type Item, type ItemSlot, type Profile } from '../items.ts';
import { Inventory } from '../hud/inventory.ts';
import type { Textures } from '../textures.ts';
import { CAMPAIGN, campaignMap, difficultyTitle, type CampaignMap } from './campaign.ts';
import type { MenuScene } from './scene.ts';
import { battleUrl, loadMenuState, NET, netBattleUrl, saveMenuState, type GameMode } from './session.ts';
import type { FriendInfo, RoomInfo, ServerMsg } from '../net/protocol.ts';

/**
 * Camp before a battle (wiki/design-main-menu.md) — like the inventory and hero screen in Minecraft Dungeons:
 * the hero in 3D on the left (menu background, src/menu/scene.ts), the "Gear" and "Map" tabs in the centre, the card of the selection on the right.
 * Gear: slots by group — weapons, armour, artifacts, aura; "Change" opens the inventory on the right tab.
 * Map: three Bush Defence maps by difficulty. "Start game" — a battle on the chosen map.
 * Online game — the same camp with a sessions panel (src/net/client.ts, wiki/design-multiplayer.md): log in by name, create a room
 * or join by code, seats and readiness; "Start game" for the host — "To battle" for the whole room, for a guest — "Ready".
 * Keys: Q / E — tabs, arrows — select, I — inventory, Enter — start, Esc — back.
 */
type Pane = 'gear' | 'map';
type SlotId = 'melee' | 'ranged' | 'armor' | 'art0' | 'art1' | 'art2' | 'aura';

const GROUPS: { title: string; icon: string; slots: SlotId[] }[] = [
  { title: t('Weapons'), icon: 'sword', slots: ['melee', 'ranged'] },
  { title: t('Armour'), icon: 'helmet', slots: ['armor'] },
  { title: t('Artifacts'), icon: 'flask', slots: ['art0', 'art1', 'art2'] },
  { title: t('Aura'), icon: 'a-bastion', slots: ['aura'] },
];
const SLOT_ORDER: SlotId[] = GROUPS.flatMap((g) => g.slots);
const SLOT_KIND = (s: SlotId): ItemSlot => (s.startsWith('art') ? 'artifact' : (s as ItemSlot));
const SLOT_EMPTY: Record<ItemSlot, string> = { melee: t('Melee weapon'), ranged: t('Bow'), armor: t('Armour'), artifact: t('Artifact'), aura: t('Aura') };
const STAT_ICON: Record<ItemSlot, string> = { melee: 'sword', ranged: 'bow', armor: 'helmet', artifact: 'flask', aura: 'a-bastion' };

export class Lobby {
  readonly el: HTMLDivElement;
  private readonly inventory: Inventory;
  private pane: Pane = 'gear';
  private mode: GameMode = 'solo';
  private slot: SlotId = 'melee';
  private map: string;
  private won: string[];
  /** Online panel: create a private room (not listed, join by code) */
  private privateGame = false;
  /** What was typed into the panel fields — survives a re-render */
  private nameDraft = NET.auth?.name ?? '';
  private codeDraft = '';
  /** Public rooms of the server: null — not asked yet */
  private rooms: RoomInfo[] | null = null;
  /** Friends: online or not, which room; the typed friend name and chat message */
  private friends: FriendInfo[] = [];
  private friendDraft = '';
  private chatDraft = '';
  /** Room chat: the latest messages */
  private chatLog: { name: string; text: string }[] = [];
  onBack?: () => void;
  onSettings?: () => void;

  private readonly profile: Profile;
  private readonly scene: MenuScene;
  constructor(parent: HTMLElement, profile: Profile, T: Textures, scene: MenuScene) { this.profile = profile; this.scene = scene;
    const st = loadMenuState();
    this.map = campaignMap(st.map).id;
    this.won = st.won;
    const el = document.createElement('div');
    el.className = 'mm-lobby';
    el.innerHTML = `
      <header class="mm-top">
        <div class="mm-tabs"><kbd>Q</kbd><button data-pane="gear">${t('Gear')}</button><button data-pane="map">${t('Map')}</button><kbd>E</kbd></div>
        <div class="mm-mode" data-id="mode"></div>
        <div class="mm-cur"><span title="${t('Raspberries')}">${iconImg('berry')}<b data-id="berries"></b></span><span title="${t('Enchantment points')}">${iconImg('spiral')}<b data-id="points"></b></span>
          <button class="mm-btn icon" data-act="settings" title="${t('Settings')}">⚙</button></div>
      </header>
      <section class="mm-hero">
        <div class="mm-level"><span>${t('Level')}</span><b data-id="level"></b><i class="mm-xp"><u data-id="xp"></u></i></div>
        <div class="mm-hero-hint">${t('drag with the mouse to rotate')}</div>
      </section>
      <section class="mm-pane" data-id="pane"></section>
      <aside class="mm-side" data-id="side"></aside>
      <footer class="mm-bottom">
        <button class="mm-btn small" data-act="back">${t('Back')} <kbd>Esc</kbd></button>
        <span class="mm-hint" data-id="hint"></span>
        <button class="mm-btn start" data-act="start">${t('Start game')} <kbd>Enter</kbd></button>
      </footer>`;
    parent.appendChild(el);
    this.el = el;
    this.inventory = new Inventory(document.body, profile, T);
    this.inventory.onClose = () => { this.scene.start(); this.render(); };
    this.inventory.onChange = () => this.scene.dress(this.profile);
    this.bind();
    NET.onError = (text) => this.flash(text);
    NET.on((m) => this.onNet(m));
  }

  /** Server message: the room changed — re-render the panel; the battle started — go to battle */
  private onNet(m: ServerMsg): void {
    if (m.t === 'battle.start') {
      sfx.twinkle();
      window.location.href = netBattleUrl(m.map, m.players, NET.room?.room.code ?? '');
      return;
    }
    if (m.t === 'chat') { this.chatLog.push({ name: m.name, text: m.text }); this.chatLog = this.chatLog.slice(-6); }
    if (m.t === 'room.left') this.chatLog = [];
    if (m.t === 'room.state' && !NET.isHost) this.map = m.room.map;
    if ((m.t === 'room.state' || m.t === 'room.left' || m.t === 'welcome' || m.t === 'chat') && this.open && this.mode === 'online') this.renderSel();
  }

  get open(): boolean { return this.el.classList.contains('open'); }

  show(mode: GameMode): void {
    this.mode = mode;
    this.el.classList.add('open');
    this.el.classList.toggle('online', mode === 'online');
    // online: the camp opens on the map at once — the sessions panel is there
    if (mode === 'online') { this.pane = 'map'; void NET.probe().then(() => this.connectNet()); }
    this.render();
  }

  hide(): void { this.el.classList.remove('open'); }

  setPane(p: Pane): void { this.pane = p; this.render(); }

  selectMap(id: string): void {
    if (this.mode === 'online' && NET.room && !NET.isHost) { this.flash(t('The host picks the map')); return; }
    this.map = campaignMap(id).id;
    if (this.mode === 'online' && NET.room) NET.setMap(this.map);
    const st = loadMenuState();
    st.map = this.map;
    saveMenuState(st);
    this.renderSel();
  }

  /** Open the inventory (on the slot's tab); the menu background stops meanwhile — the inventory renders the hero itself */
  openInventory(slot?: SlotId): void {
    this.scene.stop();
    this.inventory.show(slot ? SLOT_KIND(slot) : undefined);
  }

  /** To battle: solo — at once; online — the host leads the room into battle, a guest marks itself ready */
  startGame(): void {
    if (this.mode === 'online') {
      if (!NET.available) { this.flash(t('The online game server is unavailable — play solo for now')); return; }
      const r = NET.room;
      if (!r) { this.flash(t('Create a room or join by code')); return; }
      if (NET.isHost) NET.startBattle();
      else NET.setReady(!r.seats.find((x) => x.seat === r.you)?.ready);
      return;
    }
    sfx.twinkle();
    window.location.href = battleUrl({ mode: this.mode, map: this.map, players: 1 });
  }

  key(e: KeyboardEvent): void {
    if (this.inventory.open) { this.inventory.key(e); return; }
    // in the online panel fields keys are for text, Enter — the field's button
    const field = (e.target as HTMLElement | null)?.closest?.('input');
    if (field) { if (e.code === 'Enter') { e.preventDefault(); this.netAct(field.dataset.enter); } return; }
    switch (e.code) {
      case 'Escape': this.onBack?.(); break;
      case 'KeyQ': case 'KeyE': this.setPane(this.pane === 'gear' ? 'map' : 'gear'); break;
      case 'KeyI': this.openInventory(this.pane === 'gear' ? this.slot : undefined); break;
      case 'Enter': e.preventDefault(); this.startGame(); break;
      case 'ArrowRight': case 'ArrowDown': this.step(1); break;
      case 'ArrowLeft': case 'ArrowUp': this.step(-1); break;
      default: break;
    }
  }

  private step(d: number): void {
    if (this.pane === 'gear') { this.slot = SLOT_ORDER[(SLOT_ORDER.indexOf(this.slot) + d + SLOT_ORDER.length) % SLOT_ORDER.length]; this.renderSel(); }
    else { const i = CAMPAIGN.findIndex((m) => m.id === this.map); this.selectMap(CAMPAIGN[(i + d + CAMPAIGN.length) % CAMPAIGN.length].id); }
  }

  private bind(): void {
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const pane = t.closest<HTMLElement>('[data-pane]')?.dataset.pane as Pane | undefined;
      if (pane) { this.setPane(pane); return; }
      const slot = t.closest<HTMLElement>('[data-slot]')?.dataset.slot as SlotId | undefined;
      if (slot) { this.slot = slot; this.renderSel(); return; }
      const map = t.closest<HTMLElement>('[data-map]')?.dataset.map;
      if (map) { this.selectMap(map); return; }
      switch (t.closest<HTMLElement>('[data-act]')?.dataset.act) {
        case 'back': this.onBack?.(); break;
        case 'settings': this.onSettings?.(); break;
        case 'start': this.startGame(); break;
        case 'change': this.openInventory(this.slot); break;
        case 'inventory': this.openInventory(); break;
        case 'friend-del': { const id = t.closest<HTMLElement>('[data-player]')?.dataset.player; if (id) void NET.removeFriend(id).then(() => this.loadFriends()); break; }
        case 'private': this.privateGame = !this.privateGame; this.renderSel(); break;
        case 'join-room': { const code = t.closest<HTMLElement>('[data-code]')?.dataset.code; if (code) NET.joinRoom(code); break; }
        case 'kick': { const id = t.closest<HTMLElement>('[data-player]')?.dataset.player; if (id) NET.kick(id); break; }
        default: this.netAct(t.closest<HTMLElement>('[data-act]')?.dataset.act); break;
      }
    });
    this.el.addEventListener('input', (e) => {
      const f = e.target as HTMLInputElement;
      if (f.dataset.field === 'name') this.nameDraft = f.value;
      if (f.dataset.field === 'code') this.codeDraft = f.value.toUpperCase();
      if (f.dataset.field === 'friend') this.friendDraft = f.value;
      if (f.dataset.field === 'chat') this.chatDraft = f.value;
    });
    this.el.addEventListener('dblclick', (e) => {
      const slot = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]')?.dataset.slot as SlotId | undefined;
      if (slot) this.openInventory(slot);
      const map = (e.target as HTMLElement).closest<HTMLElement>('[data-map]')?.dataset.map;
      if (map) this.startGame();
    });
  }

  private flash(text: string): void {
    const h = this.q('hint');
    h.textContent = text;
    h.classList.remove('warn'); void h.offsetWidth; h.classList.add('warn');
  }

  private q(id: string): HTMLElement { return this.el.querySelector(`[data-id="${id}"]`) as HTMLElement; }

  private itemOf(s: SlotId): Item | null {
    const p = this.profile;
    if (s.startsWith('art')) return p.artifacts()[Number(s.slice(3))] ?? null;
    if (s === 'aura') return p.aura();
    return p.equipped(s as 'melee' | 'ranged' | 'armor');
  }

  render(): void {
    const p = this.profile, D = p.data;
    this.scene.dress(p);
    this.q('berries').textContent = String(D.berries);
    this.q('points').textContent = String(D.points);
    this.q('level').textContent = String(D.level);
    this.q('xp').style.width = `${Math.min(100, (D.xp / xpToNext(D.level)) * 100).toFixed(1)}%`;
    this.q('mode').innerHTML = this.mode === 'online' ? t('Online game') : t('Solo game');
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-pane]')) b.classList.toggle('on', b.dataset.pane === this.pane);
    this.q('pane').innerHTML = this.pane === 'gear' ? this.gearHtml() : this.mapsHtml();
    this.renderSel();
  }

  /**
   * Slot or map selection: highlight and the card on the right. The pane is not re-rendered —
   * otherwise the second click of a double click would land on a new element and the double click would be lost
   */
  private renderSel(): void {
    for (const e of this.el.querySelectorAll<HTMLElement>('[data-slot]')) e.classList.toggle('sel', e.dataset.slot === this.slot);
    for (const e of this.el.querySelectorAll<HTMLElement>('[data-map]')) e.classList.toggle('sel', e.dataset.map === this.map);
    // re-rendering the online panel (a message arrived, the roster changed) does not disturb typing in a field
    const focus = (document.activeElement as HTMLInputElement | null)?.dataset?.field;
    this.q('side').innerHTML = this.pane === 'gear' ? this.itemCard() : this.mapCard() + (this.mode === 'online' ? this.onlineHtml() : '');
    if (focus) { const f = this.el.querySelector<HTMLInputElement>(`[data-field="${focus}"]`); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }
    const lock = this.mode === 'online' && !NET.room;
    const startBtn = this.el.querySelector('[data-act="start"]') as HTMLButtonElement;
    startBtn.classList.toggle('locked', lock);
    startBtn.title = lock ? t('A room first: create one or join by code') : t('Start: {map}', { map: campaignMap(this.map).title });
    const guest = this.mode === 'online' && NET.room && !NET.isHost;
    const ready = guest && NET.room?.seats.find((x) => x.seat === NET.room?.you)?.ready;
    startBtn.firstChild!.textContent = guest ? (ready ? `${t('Not ready')} ` : `${t('Ready')} `) : `${t('Start game')} `;
    this.q('hint').classList.remove('warn');
    this.q('hint').textContent = this.pane === 'gear'
      ? t('Click — slot · double click or I — change · Q / E — tabs')
      : t('Map: {map} · double click — straight to battle', { map: campaignMap(this.map).title });
  }

  private gearHtml(): string {
    const p = this.profile;
    const stat = (s: ItemSlot, v: number): string => `<span>${iconImg(STAT_ICON[s], '', '#7fe0ff')}<b>${v}</b></span>`;
    const arts = p.artifacts().filter((x): x is Item => !!x);
    const head = `<div class="mm-power"><div><span>${t('Gear power')}</span><b>${p.power}</b></div>
      <div class="mm-stats">${stat('melee', p.equipped('melee')?.power ?? 0)}${stat('ranged', p.equipped('ranged')?.power ?? 0)}${stat('armor', p.equipped('armor')?.power ?? 0)}${stat('artifact', arts.length ? Math.round(arts.reduce((a, x) => a + x.power, 0) / arts.length) : 0)}</div></div>`;
    const groups = GROUPS.map((g) => `<div class="mm-group"><h4>${iconImg(g.icon, '', '#cfd8e0')}${g.title}</h4><div class="mm-slots">${g.slots.map((s) => this.slotHtml(s)).join('')}</div></div>`).join('');
    const total = p.data.items.length, fresh = p.data.items.filter((x) => x.isNew).length;
    return `${head}${groups}<button class="mm-btn small" data-act="inventory">${iconImg('chest')}${t('All items')} · ${total}${fresh ? ` <i class="mm-new">${t('+{n} new', { n: fresh })}</i>` : ''} <kbd>I</kbd></button>`;
  }

  private slotHtml(s: SlotId): string {
    const it = this.itemOf(s), on = s === this.slot ? ' sel' : '';
    if (!it) return `<div class="mm-slot empty${on}" data-slot="${s}" title="${t('{slot}: empty', { slot: SLOT_EMPTY[SLOT_KIND(s)] })}"><span>+</span></div>`;
    const d = itemDef(it.def);
    return `<div class="mm-slot it r-${d.rarity}${on}" data-slot="${s}" title="${d.title}"><img class="px it-ico" src="${iconURL(d.icon)}" alt="" draggable="false"><span class="it-pw">${it.power}</span></div>`;
  }

  private itemCard(): string {
    const it = this.itemOf(this.slot), kind = SLOT_KIND(this.slot);
    if (!it) {
      const have = this.profile.data.items.filter((x) => itemDef(x.def).slot === kind && !this.profile.isEquipped(x.uid)).length;
      return `<div class="mm-card"><div class="mm-card-tag">${t('Empty')}</div><h3>${SLOT_EMPTY[kind]}</h3>
        <p>${have ? t('Suitable items in the bag: {n}. Equip one and go to battle.', { n: have }) : t('No suitable items yet: look for them in chests, at merchants and in battle.')}</p>
        <button class="mm-btn small primary" data-act="change"${have ? '' : ' disabled'}>${t('Equip')} <kbd>I</kbd></button></div>`;
    }
    const d = itemDef(it.def), r = RARITY[d.rarity];
    const traits = d.traits?.length ? `<ul>${d.traits.map((t) => `<li>${t}</li>`).join('')}</ul>` : '';
    return `<div class="mm-card"><div class="mm-card-tag">${t('Equipped')}</div>
      <div class="mm-card-head"><b class="mm-card-pw">${it.power}</b><i class="mm-rar" style="--c:${r.color}">${r.title}</i><img class="px" src="${iconURL(d.icon)}" alt=""></div>
      <h3>${d.title}</h3><p>${d.description}</p>${traits}
      <button class="mm-btn small primary" data-act="change">${t('Change')} <kbd>I</kbd></button></div>`;
  }

  private mapsHtml(): string {
    return `<h4 class="mm-pane-title">${t('Bush Defence — choose a map')}</h4><div class="mm-maps">${CAMPAIGN.map((m) => this.mapTile(m)).join('')}</div>`;
  }

  private mapTile(m: CampaignMap): string {
    const won = this.won.includes(m.id);
    return `<button class="mm-map${m.id === this.map ? ' sel' : ''}" data-map="${m.id}" style="--bg:${m.bg}">
      <span class="mm-map-art">${iconImg(m.icon)}</span>
      <b>${m.title}</b>
      <span class="mm-diff d${m.difficulty}">${'◆'.repeat(m.difficulty)}${'◇'.repeat(3 - m.difficulty)} ${difficultyTitle(m.difficulty)}</span>
      ${won ? `<i class="mm-won">${t('won')}</i>` : ''}
    </button>`;
  }

  private mapCard(): string {
    const m = campaignMap(this.map);
    return `<div class="mm-card map" style="--bg:${m.bg}"><div class="mm-card-tag">${difficultyTitle(m.difficulty)}</div>
      <h3>${m.title}</h3><p>${m.blurb}</p>
      <dl><dt>${t('Waves')}</dt><dd>${m.waves}</dd><dt>${t('Lanes')}</dt><dd>${m.lanes}</dd><dt>${t('Bush')}</dt><dd>${m.bush}</dd><dt>${t('Treasury')}</dt><dd>${m.berries}</dd></dl>
      ${this.won.includes(m.id) ? `<p class="mm-won-line">${t('Map won — the bush held!')}</p>` : ''}</div>`;
  }

  /** Online panel actions: buttons and Enter in fields */
  private netAct(a: string | undefined): void {
    switch (a) {
      case 'probe': void NET.probe().then(() => this.connectNet()); break;
      case 'login': {
        const name = this.nameDraft.trim();
        void NET.login(name).then((ok) => { if (ok) this.connectNet(); });
        break;
      }
      case 'logout': NET.logout(); this.rooms = null; this.renderSel(); break;
      case 'host': NET.createRoom(this.map, this.privateGame); break;
      case 'join': if (this.codeDraft.trim()) NET.joinRoom(this.codeDraft.trim()); break;
      case 'leave': NET.leaveRoom(); this.renderSel(); break;
      case 'refresh': void NET.list().then((r) => { this.rooms = r; this.renderSel(); if (!r.length) this.flash(t('No open rooms — create your own')); }); this.loadFriends(); break;
      case 'friend-add': {
        const name = this.friendDraft.trim();
        if (name) void NET.addFriend(name).then((ok) => { if (ok) { this.friendDraft = ''; this.loadFriends(); } });
        break;
      }
      case 'chat': if (this.chatDraft.trim()) { NET.chat(this.chatDraft); this.chatDraft = ''; this.renderSel(); } break;
      default: break;
    }
  }

  /** The server is there and the login is done: sync the profile, open the connection, ask for the room list */
  connectNet(): void {
    if (NET.available && NET.auth) {
      void NET.syncProfile(this.profile).then(() => { if (this.open) this.render(); });
      NET.connect();
      void NET.list().then((r) => { this.rooms = r; if (this.open && this.mode === 'online') this.renderSel(); });
      this.loadFriends();
    }
    if (this.open && this.mode === 'online') this.renderSel();
  }

  /** Friends from the server: online or not and which room */
  private loadFriends(): void {
    void NET.friends().then((f) => { this.friends = f; if (this.open && this.mode === 'online') this.renderSel(); });
  }

  /** Friends: online — a green dot, in a room with a free seat — "Join" (also into a running battle), ✕ — remove */
  private friendsHtml(esc: (v: string) => string): string {
    const rows = this.friends.map((f) => {
      const r = f.room, can = r && r.players < r.max && r.code !== NET.room?.room.code;
      const where = r ? `${campaignMap(r.map).title}${r.state === 'battle' ? ` · ${t('in battle')}` : ''} · ${r.players}/${r.max}` : f.online ? t('online') : t('not in game');
      return `<li class="mm-friend${f.online ? ' on' : ''}" data-player="${f.playerId}"><b>${esc(f.name)}</b><i>${where}</i>
        ${can ? `<button class="mm-btn small" data-act="join-room" data-code="${r.code}">${t('Join')}</button>` : ''}<button class="mm-btn small" data-act="friend-del" title="${t('Remove from friends')}">✕</button></li>`;
    }).join('');
    return `<div class="mm-online-h"><b>${t('Friends')}</b></div>
      <div class="mm-join"><input class="mm-field" data-field="friend" data-enter="friend-add" maxlength="16" placeholder="${t('Hero name')}" value="${esc(this.friendDraft)}"><button class="mm-btn small" data-act="friend-add">${t('+ Add')}</button></div>
      ${rows ? `<ul class="mm-rooms">${rows}</ul>` : `<div class="mm-online-empty">${t('No friends yet')}</div>`}`;
  }

  /** Room chat: the latest messages and the field */
  private chatHtml(esc: (v: string) => string): string {
    const log = this.chatLog.map((m) => `<div><b>${esc(m.name)}:</b> ${esc(m.text)}</div>`).join('');
    return `<div class="mm-online-h"><b>${t('Chat')}</b></div><div class="mm-chat">${log || `<i>${t('Quiet so far')}</i>`}</div>
      <div class="mm-join"><input class="mm-field" data-field="chat" data-enter="chat" maxlength="200" placeholder="${t('Message')}" value="${esc(this.chatDraft)}"><button class="mm-btn small" data-act="chat">→</button></div>`;
  }

  /** Online game panel modelled on MCD: login, a room with seats, create a session, session list, join by code */
  private onlineHtml(): string {
    const esc = (v: string): string => v.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    if (!NET.available) {
      return `<div class="mm-online">
      <div class="mm-online-empty">${t('Server unavailable')}</div>
      <p class="mm-note">${t('Online play goes through the Malina server ({base}): <code>npm run server</code>. Gear and the map can be chosen right now.', { base: esc(NET.base) })}</p>
      <button class="mm-btn small" data-act="probe">${t('Check again')}</button>
    </div>`;
    }
    if (!NET.auth) {
      return `<div class="mm-online">
      <div class="mm-online-h"><b>${t('Hero name')}</b></div>
      <input class="mm-field" data-field="name" data-enter="login" maxlength="16" placeholder="${t('2–16 letters')}" value="${esc(this.nameDraft)}">
      <button class="mm-btn host" data-act="login">${t('Log in')}</button>
      <p class="mm-note">${t('No password: the server remembers the hero in this browser.')}</p>
    </div>`;
    }
    const who = `<div class="mm-online-h"><b>${esc(NET.auth.name)}</b><button class="mm-btn small" data-act="logout" title="${t('Forget the login in this browser')}">${t('Log out')}</button></div>`;
    const r = NET.room;
    if (r) {
      const seats = r.seats.map((x) => `<li class="mm-seat${x.online ? '' : ' off'}${x.seat === r.you ? ' me' : ''}" data-player="${x.playerId}">
        <b>${x.host ? '♛ ' : ''}${esc(x.name)}</b><i>${x.host ? t('host') : x.ready ? t('ready') : t('not ready')}${x.online ? '' : ` · ${t('no connection')}`}</i>
        ${NET.isHost && !x.host ? `<button class="mm-btn small" data-act="kick" title="${t('Remove from the room')}">✕</button>` : ''}</li>`).join('');
      return `<div class="mm-online">${who}
      <div class="mm-online-h"><b>${t('Room')}</b><span class="mm-code" title="${t('Code for friends')}">${r.room.code}</span></div>
      <ul class="mm-seats">${seats}${`<li class="mm-seat empty">${t('free')}</li>`.repeat(Math.max(0, r.room.max - r.seats.length))}</ul>
      <p class="mm-note">${campaignMap(r.room.map).title}${r.room.private ? ` · ${t('private')}` : ''} · ${NET.isHost ? t('everyone ready — "Start game"') : t('"Ready" — then wait for the host')}</p>
      ${this.chatHtml(esc)}
      <button class="mm-btn small" data-act="leave">${t('Leave the room')}</button>
      ${this.friendsHtml(esc)}
    </div>`;
    }
    const list = this.rooms === null ? '<div class="mm-online-empty">…</div>'
      : this.rooms.length ? `<ul class="mm-rooms">${this.rooms.map((x) => `<li><b>${esc(x.host)}</b><i>${campaignMap(x.map).title}${x.state === 'battle' ? ` · ${t('in battle')}` : ''} · ${x.players}/${x.max}</i><button class="mm-btn small" data-act="join-room" data-code="${x.code}">${t('Join')}</button></li>`).join('')}</ul>`
        : `<div class="mm-online-empty">${t('No sessions found')}</div>`;
    return `<div class="mm-online">${who}
      <button class="mm-btn host" data-act="host">${t('Create an online session')}</button>
      <label class="mm-toggle" data-act="private">${t('Private game')}<i class="${this.privateGame ? 'on' : ''}"></i></label>
      <div class="mm-online-h"><b>${t('Room code')}</b></div>
      <div class="mm-join"><input class="mm-field" data-field="code" data-enter="join" maxlength="6" placeholder="ABCDEF" value="${esc(this.codeDraft)}"><button class="mm-btn small" data-act="join">${t('Join')}</button></div>
      <div class="mm-online-h"><b>${t('Sessions')}</b><button class="mm-btn small" data-act="refresh">${t('Refresh')}</button></div>
      ${list}
      ${this.friendsHtml(esc)}
    </div>`;
  }
}
