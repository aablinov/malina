import { sfx } from '../audio.ts';
import { t } from '../i18n/i18n.ts';
import { iconImg, iconURL } from '../icons.ts';
import { itemDef, RARITY, xpToNext, type Item, type ItemSlot, type Profile } from '../items.ts';
import { Inventory } from '../hud/inventory.ts';
import { Shop } from '../hud/shop.ts';
import type { MerchantKind } from '../merchants.ts';
import type { Textures } from '../textures.ts';
import { CAMPAIGN, campaignMap, difficultyTitle, type CampaignMap } from './campaign.ts';
import { boardHtml, missionCardHtml } from './expeditions.ts';
import { isMission, MAX_DIFFICULTY, parseMission, sameMission, sameOperation, withLanding } from '../expedition/mission.ts';
import { plantBed, unlockedDifficulty, type BedKind } from '../expedition/camp.ts';
import { PARCEL_HINT, PARCEL_TITLE } from '../expedition/parcels.ts';
import { PARCEL_KINDS, parcelLoadout } from '../sim/parcel.ts';
import type { MenuScene } from './scene.ts';
import { go } from './boot.ts';
import { battleUrl, loadMenuState, NET, netBattleUrl, record, saveMenuState, VOICE, type GameMode } from './session.ts';
import type { FriendInfo, RoomInfo, ServerMsg } from '../net/protocol.ts';
import { TUTORIAL } from '../tutorial/tutorial.ts';

/**
 * Camp before a battle (wiki/design-main-menu.md) — like the inventory and hero screen in Minecraft Dungeons:
 * the hero in 3D on the left (menu background, src/menu/scene.ts), the "Gear" and "Map" tabs in the centre, the card of the selection on the right.
 * Gear: slots by group — weapons, armour, artifacts, aura; "Change" opens the inventory on the right tab.
 * Map: three Bush Defence maps by difficulty. "Start game" — a battle on the chosen map.
 * Rooms (online only): every live room of the server, like a server browser — lock, creator, map, wave, players; a locked one asks for the password,
 * one's own running battle — "Return" (closed the tab: back without the password).
 * Online game — the same camp with a sessions panel (src/net/client.ts, wiki/design-multiplayer.md): log in by name, create a room
 * or join by code, seats and readiness; "Start game" for the host — "To battle" for the whole room, for a guest — "Ready".
 * Keys: Q / E — tabs, arrows — select, I — inventory, Enter — start, Esc — back.
 */
/** `t` under another name: click handlers call their event target `t` */
const tr = t;

type Pane = 'gear' | 'map' | 'missions' | 'rooms';
/** The tutorial card of each tab (src/tutorial/cards.ts) */
const PANE_CARD: Record<Pane, string> = { gear: 'camp.gear', map: 'camp.map', missions: 'camp.exp', rooms: 'camp.rooms' };
/** Room list refresh while the "Rooms" tab is open, ms */
const ROOMS_POLL_MS = 3000;
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
  /** Camp shops (wiki/design-inventory.md, "Merchants"): the merchant and the blacksmith for the account raspberries — what is bought stays with the hero */
  readonly shop: Shop;
  private pane: Pane = 'gear';
  private mode: GameMode = 'solo';
  private slot: SlotId = 'melee';
  private map: string;
  /** Expeditions: the difficulty of the board on screen */
  private expDiff = 1;
  private won: string[];
  /** Online panel: password of the room being created ('' — open) */
  private passDraft = '';
  /** Room list: the selected row, the room asking for a password and what was typed */
  private selCode: string | null = null;
  private passFor: string | null = null;
  private joinPass = '';
  private pollTimer = 0;
  /** What was typed into the panel fields — survives a re-render */
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
    this.expDiff = Math.max(1, Math.min(MAX_DIFFICULTY, Math.round(st.expDiff ?? campaignMap(st.map).mission?.difficulty ?? 1)));
    const el = document.createElement('div');
    el.className = 'mm-lobby';
    el.innerHTML = `
      <header class="mm-top">
        <div class="mm-tabs"><kbd>Q</kbd><button data-pane="gear">${t('Gear')}</button><button data-pane="map">${t('Map')}</button><button data-pane="missions">${t('Expeditions')}</button><button data-pane="rooms">${t('Rooms')}</button><kbd>E</kbd></div>
        <div class="mm-mode" data-id="mode"></div>
        <div class="mm-cur"><span title="${t('Raspberries')}">${iconImg('berry')}<b data-id="berries"></b></span><span title="${t('Enchantment points')}">${iconImg('spiral')}<b data-id="points"></b></span>
          <button class="mm-btn icon" data-act="help" title="${t('How to play')}">?</button>
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
    this.shop = new Shop(document.body, profile);
    this.shop.onClose = () => { this.scene.start(); this.render(); };
    this.shop.onChange = () => { this.scene.dress(this.profile); this.render(); };
    this.shop.onSound = (ok) => { if (ok) sfx.twinkle(); };
    this.bind();
    NET.onError = (text) => this.flash(text);
    NET.onPassword = (code, bad) => this.askPassword(code, bad);
    NET.on((m) => this.onNet(m));
  }

  /** Server message: the room changed — re-render the panel; the battle started — go to battle */
  private onNet(m: ServerMsg): void {
    // reconnected while one's battle runs (closed the tab): not straight into battle — the camp offers "Return to battle"
    if (m.t === 'battle.start' && m.resume) { if (this.open && this.mode === 'online') this.renderSel(); return; }
    if (m.t === 'battle.start') {
      sfx.twinkle();
      void go(netBattleUrl(m.map, m.players, NET.room?.room.code ?? ''));
      return;
    }
    if (m.t === 'chat') { this.chatLog.push({ name: m.name, text: m.text }); this.chatLog = this.chatLog.slice(-6); }
    if (m.t === 'room.left') this.chatLog = [];
    // entered or left a room — the list shows it at once (own row: "you are here")
    if ((m.t === 'room.state' && this.passFor !== null) || m.t === 'room.left') this.poll();
    if (m.t === 'room.state') this.passFor = null;
    // the room's map: a guest follows the host; the host follows the server when it moves the room on to an operation's next mission
    if (m.t === 'room.state' && (!NET.isHost || (isMission(m.room.map) && sameOperation(m.room.map, this.map)))) this.map = m.room.map;
    if ((m.t === 'room.state' || m.t === 'room.left' || m.t === 'welcome' || m.t === 'chat') && this.open && this.mode === 'online') this.renderSel();
  }

  get open(): boolean { return this.el.classList.contains('open'); }

  show(mode: GameMode): void {
    this.mode = mode;
    this.el.classList.add('open');
    this.el.classList.toggle('online', mode === 'online');
    // online: the camp opens on the room list (in a room — on the map); the sessions panel is on the right
    if (mode === 'online') {
      this.pane = NET.room ? 'map' : 'rooms';
      void NET.probe().then(() => this.connectNet());
      window.clearInterval(this.pollTimer);
      this.pollTimer = window.setInterval(() => this.poll(), ROOMS_POLL_MS);
    } else if (this.pane === 'rooms') this.pane = 'gear';
    this.render();
    TUTORIAL.fire(PANE_CARD[this.pane]);
  }

  hide(): void { this.el.classList.remove('open'); window.clearInterval(this.pollTimer); }

  /** Tabs in order: "Rooms" only in the online game */
  private panes(): Pane[] { return this.mode === 'online' ? ['gear', 'map', 'missions', 'rooms'] : ['gear', 'map', 'missions']; }

  /** The room list refreshes by itself while it is on screen */
  private poll(): void {
    if (!this.open || this.mode !== 'online' || this.pane !== 'rooms' || !NET.available || !NET.auth) return;
    void NET.list().then((r) => { this.rooms = r; this.renderRooms(); });
  }

  setPane(p: Pane): void { this.pane = p; this.render(); TUTORIAL.fire(PANE_CARD[p]); }

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
    TUTORIAL.fire('camp.items');
  }

  /** Open a camp shop: the merchant (everything at the hero's power) or the blacksmith (forge, reforge the equipped) */
  openShop(kind: MerchantKind = 'merchant'): void {
    this.scene.stop();
    this.shop.show(kind);
  }

  /** To battle: solo — at once; online — the host leads the room into battle, a guest marks itself ready; the room's battle runs — back into it */
  startGame(): void {
    if (this.mode === 'online') {
      if (!NET.available) { this.flash(t('The online game server is unavailable — play solo for now')); return; }
      const r = NET.room;
      if (!r) { this.flash(t('Create a room or join by code')); return; }
      if (r.room.state === 'battle') { this.rejoin(); return; }
      if (NET.isHost) NET.startBattle();
      else NET.setReady(!r.seats.find((x) => x.seat === r.you)?.ready);
      return;
    }
    // a remembered mission above the hero's ladder (another hero played here before) does not start
    const mission = parseMission(this.map);
    if (mission && mission.difficulty > unlockedDifficulty(this.profile.data)) { this.flash(t('Win a mission of difficulty {n} first', { n: mission.difficulty - 1 })); return; }
    sfx.twinkle();
    void go(battleUrl({ mode: this.mode, map: this.map, players: 1 }));
  }

  /** Back into the room's running battle (reconnected after closing the tab) */
  private rejoin(): void {
    const r = NET.room;
    if (!r || r.room.state !== 'battle') return;
    sfx.twinkle();
    void go(netBattleUrl(r.room.map, r.seats.length, r.room.code));
  }

  /** Into a room from the list, by code or from friends: a locked one — the password field under its row (one's own running battle needs none) */
  private joinCode(code: string): void {
    const r = this.rooms?.find((x) => x.code === code);
    if (r?.locked && !this.isReturn(r)) { this.askPassword(code, false); return; }
    NET.joinRoom(code);
  }

  /** The room is one's own running battle: closed the tab — "Return" without the password */
  private isReturn(r: RoomInfo): boolean { return r.state === 'battle' && NET.lastRoom?.code === r.code; }

  /** The room wants a password: the "Rooms" tab, the field under its row */
  private askPassword(code: string, bad: boolean): void {
    this.passFor = code;
    this.selCode = code;
    this.joinPass = '';
    if (bad) this.flash(t('Wrong password'));
    if (this.pane !== 'rooms') this.setPane('rooms'); else this.renderRooms();
    this.el.querySelector<HTMLInputElement>('[data-field="joinpass"]')?.focus();
  }

  key(e: KeyboardEvent): void {
    if (this.inventory.open) { this.inventory.key(e); return; }
    if (this.shop.open) { this.shop.key(e); return; }
    // in the online panel fields keys are for text, Enter — the field's button
    const field = (e.target as HTMLElement | null)?.closest?.('input');
    if (field) { if (e.code === 'Enter') { e.preventDefault(); this.netAct(field.dataset.enter); } return; }
    switch (e.code) {
      case 'Escape': this.onBack?.(); break;
      case 'KeyQ': case 'KeyE': { const ps = this.panes(); this.setPane(ps[(ps.indexOf(this.pane) + (e.code === 'KeyE' ? 1 : -1) + ps.length) % ps.length]); break; }
      case 'KeyI': this.openInventory(this.pane === 'gear' ? this.slot : undefined); break;
      case 'KeyB': this.openShop('merchant'); break;
      // voice chat in the room: one's microphone on / off
      case 'KeyT': if (NET.room) void VOICE.toggle().then((err) => { this.flash(err ?? (VOICE.on ? t('Microphone on') : t('Microphone off'))); this.render(); }); break;
      case 'Enter': e.preventDefault(); if (this.pane === 'rooms' && this.selCode && !NET.room) this.joinCode(this.selCode); else this.startGame(); break;
      case 'ArrowRight': case 'ArrowDown': this.step(1); break;
      case 'ArrowLeft': case 'ArrowUp': this.step(-1); break;
      default: break;
    }
  }

  private step(d: number): void {
    if (this.pane === 'gear') { this.slot = SLOT_ORDER[(SLOT_ORDER.indexOf(this.slot) + d + SLOT_ORDER.length) % SLOT_ORDER.length]; this.renderSel(); }
    else if (this.pane === 'rooms') {
      const list = this.rooms ?? [];
      if (!list.length) return;
      const i = list.findIndex((r) => r.code === this.selCode);
      this.selCode = list[i < 0 ? 0 : (i + d + list.length) % list.length].code;
      this.renderRooms();
    } else if (this.pane === 'missions') { this.expDiff = ((this.expDiff - 1 + d + MAX_DIFFICULTY) % MAX_DIFFICULTY) + 1; this.render(); }
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
      // expeditions: the board's difficulty and the landing point on the mission's sketch
      const diff = Number(t.closest<HTMLElement>('[data-diff]')?.dataset.diff);
      if (diff && diff > unlockedDifficulty(this.profile.data)) { this.flash(tr('Win a mission of difficulty {n} first', { n: diff - 1 })); return; }
      const bed = t.closest<HTMLElement>('[data-bed]')?.dataset.bed as BedKind | undefined;
      if (bed) { if (plantBed(this.profile.data, bed)) { this.profile.save(); sfx.twinkle(); this.render(); } else this.flash(tr('Not enough seeds for this bed')); return; }
      if (diff) { this.expDiff = diff; const st = loadMenuState(); st.expDiff = diff; saveMenuState(st); this.render(); return; }
      const parcel = t.closest<HTMLElement>('[data-parcel]')?.dataset.parcel;
      if (parcel !== undefined) { this.cycleParcel(Number(parcel)); return; }
      const landing = t.closest<SVGElement>('[data-landing]')?.dataset.landing;
      if (landing !== undefined) { this.selectMap(withLanding(this.map, Number(landing))); return; }
      const row = t.closest<HTMLElement>('[data-room]')?.dataset.room;
      // only the highlight, not a re-render: otherwise the second click of a double click lands on a new element
      if (row && !t.closest('[data-act]') && !t.closest('input')) { this.selCode = row; for (const e of this.el.querySelectorAll<HTMLElement>('[data-room]')) e.classList.toggle('sel', e.dataset.room === row); return; }
      switch (t.closest<HTMLElement>('[data-act]')?.dataset.act) {
        case 'back': this.onBack?.(); break;
        case 'settings': this.onSettings?.(); break;
        case 'help': TUTORIAL.openBook(PANE_CARD[this.pane]); break;
        case 'start': this.startGame(); break;
        case 'change': this.openInventory(this.slot); break;
        case 'inventory': this.openInventory(); break;
        case 'shop': this.openShop('merchant'); break;
        case 'smith': this.openShop('smith'); break;
        case 'friend-del': { const id = t.closest<HTMLElement>('[data-player]')?.dataset.player; if (id) void NET.removeFriend(id).then(() => this.loadFriends()); break; }
        case 'join-room': { const code = t.closest<HTMLElement>('[data-code]')?.dataset.code; if (code) this.joinCode(code); break; }
        case 'rejoin': this.rejoin(); break;
        case 'kick': { const id = t.closest<HTMLElement>('[data-player]')?.dataset.player; if (id) NET.kick(id); break; }
        default: this.netAct(t.closest<HTMLElement>('[data-act]')?.dataset.act); break;
      }
    });
    this.el.addEventListener('input', (e) => {
      const f = e.target as HTMLInputElement;
      if (f.dataset.field === 'code') { f.value = f.value.replace(/\D/g, ''); this.codeDraft = f.value; }
      if (f.dataset.field === 'friend') this.friendDraft = f.value;
      if (f.dataset.field === 'chat') this.chatDraft = f.value;
      if (f.dataset.field === 'pass') this.passDraft = f.value;
      if (f.dataset.field === 'joinpass') this.joinPass = f.value;
    });
    this.el.addEventListener('dblclick', (e) => {
      const slot = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]')?.dataset.slot as SlotId | undefined;
      if (slot) this.openInventory(slot);
      const map = (e.target as HTMLElement).closest<HTMLElement>('[data-map]')?.dataset.map;
      if (map) this.startGame();
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-room]');
      if (row?.dataset.room && !row.classList.contains('full') && !(e.target as HTMLElement).closest('[data-act], input')) this.joinCode(row.dataset.room);
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
    this.el.classList.toggle('rooms', this.pane === 'rooms');
    this.q('pane').innerHTML = this.pane === 'gear' ? this.gearHtml() + this.parcelsHtml() : this.pane === 'map' ? this.mapsHtml() : this.pane === 'missions' ? boardHtml(this.map, this.expDiff, this.profile.data, this.streak()) : this.roomsHtml();
    this.renderSel();
  }

  /** Re-render without losing typing: the focused field gets its focus and caret back */
  private keepFocus(f: () => void): void {
    const focus = (document.activeElement as HTMLInputElement | null)?.dataset?.field;
    f();
    if (focus) { const el = this.el.querySelector<HTMLInputElement>(`[data-field="${focus}"]`); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
  }

  /** Only the room table (the list came, a row was selected) */
  private renderRooms(): void {
    if (this.open && this.pane === 'rooms') this.keepFocus(() => { this.q('pane').innerHTML = this.roomsHtml(); });
  }

  /**
   * Slot or map selection: highlight and the card on the right. The pane is not re-rendered —
   * otherwise the second click of a double click would land on a new element and the double click would be lost
   */
  private renderSel(): void {
    for (const e of this.el.querySelectorAll<HTMLElement>('[data-slot]')) e.classList.toggle('sel', e.dataset.slot === this.slot);
    // a mission tile is the same mission whatever landing is picked: it follows the selection's id
    for (const e of this.el.querySelectorAll<HTMLElement>('[data-map]')) { if (e.dataset.map && sameMission(e.dataset.map, this.map)) e.dataset.map = this.map; e.classList.toggle('sel', e.dataset.map === this.map); }
    // re-rendering the online panel (a message arrived, the roster changed) does not disturb typing in a field
    this.keepFocus(() => {
      this.q('side').innerHTML = this.pane === 'gear' ? this.itemCard() : this.mapCard() + (this.mode === 'online' ? this.onlineHtml() : '');
      if (this.pane === 'rooms') this.q('pane').innerHTML = this.roomsHtml();
    });
    const lock = this.mode === 'online' && !NET.room;
    const startBtn = this.el.querySelector('[data-act="start"]') as HTMLButtonElement;
    startBtn.classList.toggle('locked', lock);
    startBtn.title = lock ? t('A room first: create one or join by code') : t('Start: {map}', { map: campaignMap(this.map).title });
    const inBattle = this.mode === 'online' && NET.room?.room.state === 'battle';
    const guest = this.mode === 'online' && NET.room && !NET.isHost;
    const ready = guest && NET.room?.seats.find((x) => x.seat === NET.room?.you)?.ready;
    startBtn.firstChild!.textContent = inBattle ? `${t('Return to battle')} ` : guest ? (ready ? `${t('Not ready')} ` : `${t('Ready')} `) : `${t('Start game')} `;
    this.q('hint').classList.remove('warn');
    this.q('hint').textContent = this.pane === 'gear'
      ? t('Click — slot · double click or I — change · B — shop · Q / E — tabs')
      : this.pane === 'rooms' ? t('Click — select · double click — join · Q / E — tabs')
        : this.pane === 'missions' ? t('Click — mission · 1–3 on the sketch — landing · Q / E — tabs')
          : t('Map: {map} · double click — straight to battle', { map: campaignMap(this.map).title });
  }

  private gearHtml(): string {
    const p = this.profile;
    const stat = (s: ItemSlot, v: number): string => `<span>${iconImg(STAT_ICON[s], '', '#7fe0ff')}<b>${v}</b></span>`;
    const arts = p.artifacts().filter((x): x is Item => !!x);
    const head = `<div class="mm-power"><div><span>${t('Gear power')}</span><b>${p.power}</b><small title="${t('Gear power plus half the level: the Order grows stronger, the loot grows bigger')}">${t('defence strength {n}', { n: p.rating })}</small></div>
      <div class="mm-stats">${stat('melee', p.equipped('melee')?.power ?? 0)}${stat('ranged', p.equipped('ranged')?.power ?? 0)}${stat('armor', p.equipped('armor')?.power ?? 0)}${stat('artifact', arts.length ? Math.round(arts.reduce((a, x) => a + x.power, 0) / arts.length) : 0)}</div></div>`;
    const groups = GROUPS.map((g) => `<div class="mm-group"><h4>${iconImg(g.icon, '', '#cfd8e0')}${g.title}</h4><div class="mm-slots">${g.slots.map((s) => this.slotHtml(s)).join('')}</div></div>`).join('');
    const total = p.data.items.length, fresh = p.data.items.filter((x) => x.isNew).length;
    const shops = `<div class="mm-shops"><button class="mm-btn small primary" data-act="shop">${iconImg('berry')}${t('Shop')} <kbd>B</kbd></button><button class="mm-btn small" data-act="smith">${iconImg('sword')}${t('Blacksmith')}</button></div>`;
    return `${head}${groups}<button class="mm-btn small" data-act="inventory">${iconImg('chest')}${t('All items')} · ${total}${fresh ? ` <i class="mm-new">${t('+{n} new', { n: fresh })}</i>` : ''} <kbd>I</kbd></button>${shops}`;
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

  /** Missions of an operation won in a row: solo — remembered by the menu; in a room the server keeps it, and the room's map is the step it is on */
  private streak(): { seed: number; difficulty: number; next: number } | null {
    if (this.mode === 'solo') return loadMenuState().streak ?? null;
    const m = NET.room ? parseMission(NET.room.room.map) : null;
    return m?.op ? { seed: m.op.seed, difficulty: m.difficulty, next: m.op.index } : null;
  }

  /** Parcels for expeditions (src/sim/parcel.ts): three slots under the gear; a click puts the next kind into the slot */
  private parcelsHtml(): string {
    const kinds = parcelLoadout(this.profile.data.parcels);
    return `<h4 class="mm-pane-title">${t('Parcels for expeditions')} · ${t('click — change')}</h4><div class="mm-parcels">${kinds.map((k, i) => `<button class="mm-btn small" data-parcel="${i}"><kbd>${'ZXC'[i]}</kbd> <b>${PARCEL_TITLE[k]}</b><small>${PARCEL_HINT[k]}</small></button>`).join('')}</div>`;
  }

  /** The next parcel kind into a slot — one not taken by the other slots */
  private cycleParcel(i: number): void {
    const kinds = parcelLoadout(this.profile.data.parcels);
    let k = PARCEL_KINDS.indexOf(kinds[i]);
    do k = (k + 1) % PARCEL_KINDS.length; while (kinds.some((x, j) => j !== i && x === PARCEL_KINDS[k]));
    kinds[i] = PARCEL_KINDS[k];
    this.profile.data.parcels = kinds;
    this.profile.save();
    this.render();
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
    if (m.mission) return missionCardHtml(m.id, this.streak());
    return `<div class="mm-card map" style="--bg:${m.bg}"><div class="mm-card-tag">${difficultyTitle(m.difficulty)}</div>
      <h3>${m.title}</h3><p>${m.blurb}</p>
      <dl><dt>${t('Waves')}</dt><dd>${m.endless ? '∞' : m.waves}</dd><dt>${t('Lanes')}</dt><dd>${m.lanes}</dd><dt>${t('Bush')}</dt><dd>${m.bush}</dd><dt>${t('Treasury')}</dt><dd>${m.berries}</dd></dl>
      ${m.endless ? (record(m.id) ? `<p class="mm-won-line">${t('Record: {n} waves held', { n: record(m.id) })}</p>` : '') : this.won.includes(m.id) ? `<p class="mm-won-line">${t('Map won — the bush held!')}</p>` : ''}</div>`;
  }

  /**
   * Room list like a server browser (the screenshot of CS 1.6 in the brief): lock, creator, map, wave, players.
   * Full — greyed out; locked — the password field under the row; one's own running battle — "Return"
   */
  private roomsHtml(): string {
    const esc = (v: string): string => v.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    const head = `<h4 class="mm-pane-title">${t('Rooms')}${this.rooms?.length ? ` · ${this.rooms.length}` : ''}<button class="mm-btn small" data-act="refresh">${t('Refresh')}</button></h4>`;
    if (!NET.available) return `${head}<div class="mm-online-empty">${t('Server unavailable')}</div>`;
    if (this.rooms === null) return `${head}<div class="mm-online-empty">…</div>`;
    if (!this.rooms.length) return `${head}<div class="mm-online-empty">${t('No rooms yet — create your own')}</div>`;
    const here = NET.room?.room.code;
    const rows = this.rooms.map((r) => {
      const full = r.players >= r.max, back = this.isReturn(r), mine = r.code === here;
      const wave = r.state === 'battle' ? (r.wave ? `${r.wave} / ${r.waves}` : t('preparing')) : t('lobby');
      const act = mine ? `<i>${t('you are here')}</i>`
        : back ? `<button class="mm-btn small primary" data-act="join-room" data-code="${r.code}">${t('Return')}</button>`
          : full ? `<i>${t('no seats')}</i>`
            : `<button class="mm-btn small" data-act="join-room" data-code="${r.code}">${t('Join')}</button>`;
      const cls = [r.code === this.selCode ? 'sel' : '', full && !mine ? 'full' : '', back || mine ? 'mine' : ''].filter(Boolean).join(' ');
      const pass = this.passFor === r.code && !mine
        ? `<tr class="mm-pass-row"><td colspan="6"><div class="mm-join"><input class="mm-field pass" data-field="joinpass" data-enter="join-pass" type="password" maxlength="32" placeholder="${t('Room password')}" value="${esc(this.joinPass)}"><button class="mm-btn small primary" data-act="join-pass">${t('Join')}</button></div></td></tr>` : '';
      return `<tr data-room="${r.code}" class="${cls}"><td class="lk">${r.locked ? '🔒' : ''}</td><td><b>${esc(r.creator)}</b></td><td>${campaignMap(r.map).title}</td><td>${wave}</td><td>${r.players} / ${r.max}</td><td class="act">${act}</td></tr>${pass}`;
    }).join('');
    return `${head}<table class="mm-browser"><thead><tr><th class="lk">🔒</th><th>${t('Creator')}</th><th>${t('Map')}</th><th>${t('Wave')}</th><th>${t('Players')}</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  /** Online panel actions: buttons and Enter in fields */
  private netAct(a: string | undefined): void {
    switch (a) {
      case 'probe': void NET.probe().then(() => this.connectNet()); break;
      // the hero is forgotten in this browser — the page asks for a name again (src/menu/boot.ts)
      case 'logout': void NET.profiles.flush().then(() => { NET.logout(); window.location.reload(); }); break;
      case 'host': NET.createRoom(this.map, this.passDraft.trim()); break;
      case 'join-pass': if (this.passFor && this.joinPass) NET.joinRoom(this.passFor, this.joinPass); break;
      case 'join': if (this.codeDraft.trim()) this.joinCode(this.codeDraft.trim()); break;
      case 'leave': NET.leaveRoom(); this.renderSel(); break;
      case 'refresh': void NET.list().then((r) => { this.rooms = r; this.renderSel(); if (!r.length) this.flash(t('No rooms yet — create your own')); }); this.loadFriends(); break;
      case 'friend-add': {
        const name = this.friendDraft.trim();
        if (name) void NET.addFriend(name).then((ok) => { if (ok) { this.friendDraft = ''; this.loadFriends(); } });
        break;
      }
      case 'chat': if (this.chatDraft.trim()) { NET.chat(this.chatDraft); this.chatDraft = ''; this.renderSel(); } break;
      default: break;
    }
  }

  /** The server is there and the login is done: open the connection, ask for the room list */
  connectNet(): void {
    if (NET.available && NET.auth) {
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
      const where = r ? `${r.locked ? '🔒 ' : ''}${campaignMap(r.map).title}${r.state === 'battle' ? ` · ${t('in battle')}` : ''} · ${r.players}/${r.max}` : f.online ? t('online') : t('not in game');
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
    const who = `<div class="mm-online-h"><b>${esc(NET.auth?.name ?? '')}</b><button class="mm-btn small" data-act="logout" title="${t('Forget the login in this browser')}">${t('Log out')}</button></div>`;
    const r = NET.room;
    if (r) {
      const seats = r.seats.map((x) => `<li class="mm-seat${x.online ? '' : ' off'}${x.seat === r.you ? ' me' : ''}" data-player="${x.playerId}">
        <b>${x.host ? '♛ ' : ''}${esc(x.name)}${(x.seat === r.you ? VOICE.on : x.voice) ? ` <span class="mm-mic" title="${t('Microphone on')}">🎤</span>` : ''}</b><i>${x.host ? t('host') : x.ready ? t('ready') : t('not ready')}${x.online ? '' : ` · ${t('no connection')}`}</i>
        ${NET.isHost && !x.host ? `<button class="mm-btn small" data-act="kick" title="${t('Remove from the room')}">✕</button>` : ''}</li>`).join('');
      return `<div class="mm-online">${who}
      <div class="mm-online-h"><b>${t('Room')}</b><span>${r.room.locked ? `<span title="${t('Locked with a password')}">🔒</span> ` : ''}<span class="mm-code" title="${t('Code for friends')}">${r.room.code}</span></span></div>
      ${r.room.state === 'battle' ? `<div class="mm-battle-on"><b>${t('The battle is on')}${r.room.wave ? ` · ${t('wave {n} of {total}', { n: r.room.wave, total: r.room.waves })}` : ''}</b><button class="mm-btn small primary" data-act="rejoin">${t('Return to battle')}</button></div>` : ''}
      <ul class="mm-seats">${seats}${`<li class="mm-seat empty">${t('free')}</li>`.repeat(Math.max(0, r.room.max - r.seats.length))}</ul>
      <p class="mm-note">${campaignMap(r.room.map).title} · ${NET.isHost ? t('everyone ready — "Start game"') : t('"Ready" — then wait for the host')}</p>
      <p class="mm-note">${VOICE.on ? t('🎤 Microphone on — T to turn off') : t('T — turn on the microphone (voice chat)')}</p>
      ${this.chatHtml(esc)}
      <button class="mm-btn small" data-act="leave">${t('Leave the room')}</button>
      ${this.friendsHtml(esc)}
    </div>`;
    }
    return `<div class="mm-online">${who}
      <button class="mm-btn host" data-act="host">${t('Create an online session')}</button>
      <input class="mm-field pass" data-field="pass" data-enter="host" maxlength="32" placeholder="${t('Password (optional)')}" value="${esc(this.passDraft)}">
      <p class="mm-note">${t('The room is visible to everyone in the list; with a password only those who know it get in.')}</p>
      <div class="mm-online-h"><b>${t('Room code')}</b></div>
      <div class="mm-join"><input class="mm-field" data-field="code" data-enter="join" inputmode="numeric" maxlength="5" placeholder="12345" value="${esc(this.codeDraft)}"><button class="mm-btn small" data-act="join">${t('Join')}</button></div>
      ${this.pane === 'rooms' ? '' : `<button class="mm-btn small" data-pane="rooms">${t('Room list')} →</button>`}
      ${this.friendsHtml(esc)}
    </div>`;
  }
}
