import { sfx } from '../audio';
import { iconImg, iconURL } from '../icons';
import { itemDef, RARITY, xpToNext, type Item, type ItemSlot, type Profile } from '../items';
import { Inventory } from '../hud/inventory';
import type { Textures } from '../textures';
import { CAMPAIGN, campaignMap, difficultyTitle, type CampaignMap } from './campaign';
import type { MenuScene } from './scene';
import { battleUrl, loadMenuState, NET, netBattleUrl, saveMenuState, type GameMode } from './session';
import type { FriendInfo, RoomInfo, ServerMsg } from '../net/protocol';

/**
 * Лагерь перед боем (wiki/design-main-menu.md) — как инвентарь и экран героя в Minecraft Dungeons:
 * слева герой в 3D (фон меню, src/menu/scene.ts), в центре вкладки «Снаряжение» и «Карта», справа карточка выбранного.
 * Снаряжение: гнёзда по группам — оружие, броня, артефакты, аура; «Сменить» открывает инвентарь на нужной вкладке.
 * Карта: три карты обороны куста по сложности. «Начать игру» — бой на выбранной карте.
 * Сетевая игра — тот же лагерь с панелью сессий (src/net/client.ts, wiki/design-multiplayer.md): вход по имени, создать комнату
 * или войти по коду, места и готовность; «Начать игру» у хоста — «В бой» для всей комнаты, у гостя — «Готов».
 * Клавиши: Q / E — вкладки, стрелки — выбор, I — инвентарь, Enter — начать, Esc — назад.
 */
type Pane = 'gear' | 'map';
type SlotId = 'melee' | 'ranged' | 'armor' | 'art0' | 'art1' | 'art2' | 'aura';

const GROUPS: { title: string; icon: string; slots: SlotId[] }[] = [
  { title: 'Оружие', icon: 'sword', slots: ['melee', 'ranged'] },
  { title: 'Броня', icon: 'helmet', slots: ['armor'] },
  { title: 'Артефакты', icon: 'flask', slots: ['art0', 'art1', 'art2'] },
  { title: 'Аура', icon: 'a-bastion', slots: ['aura'] },
];
const SLOT_ORDER: SlotId[] = GROUPS.flatMap((g) => g.slots);
const SLOT_KIND = (s: SlotId): ItemSlot => (s.startsWith('art') ? 'artifact' : (s as ItemSlot));
const SLOT_EMPTY: Record<ItemSlot, string> = { melee: 'Ближнее оружие', ranged: 'Лук', armor: 'Броня', artifact: 'Артефакт', aura: 'Аура' };
const STAT_ICON: Record<ItemSlot, string> = { melee: 'sword', ranged: 'bow', armor: 'helmet', artifact: 'flask', aura: 'a-bastion' };

export class Lobby {
  readonly el: HTMLDivElement;
  private readonly inventory: Inventory;
  private pane: Pane = 'gear';
  private mode: GameMode = 'solo';
  private slot: SlotId = 'melee';
  private map: string;
  private won: string[];
  /** Сетевая панель: создать закрытую комнату (не видна в списке, вход по коду) */
  private privateGame = false;
  /** Набранное в полях панели — переживает перерисовку */
  private nameDraft = NET.auth?.name ?? '';
  private codeDraft = '';
  /** Публичные комнаты сервера: null — ещё не спрашивали */
  private rooms: RoomInfo[] | null = null;
  /** Друзья: на связи ли, в какой комнате; набранное имя друга и сообщение чата */
  private friends: FriendInfo[] = [];
  private friendDraft = '';
  private chatDraft = '';
  /** Чат комнаты: последние сообщения */
  private chatLog: { name: string; text: string }[] = [];
  onBack?: () => void;
  onSettings?: () => void;

  constructor(parent: HTMLElement, private readonly profile: Profile, T: Textures, private readonly scene: MenuScene) {
    const st = loadMenuState();
    this.map = campaignMap(st.map).id;
    this.won = st.won;
    const el = document.createElement('div');
    el.className = 'mm-lobby';
    el.innerHTML = `
      <header class="mm-top">
        <div class="mm-tabs"><kbd>Q</kbd><button data-pane="gear">Снаряжение</button><button data-pane="map">Карта</button><kbd>E</kbd></div>
        <div class="mm-mode" data-id="mode"></div>
        <div class="mm-cur"><span title="Малина">${iconImg('berry')}<b data-id="berries"></b></span><span title="Очки зачарования">${iconImg('spiral')}<b data-id="points"></b></span>
          <button class="mm-btn icon" data-act="settings" title="Настройки">⚙</button></div>
      </header>
      <section class="mm-hero">
        <div class="mm-level"><span>Уровень</span><b data-id="level"></b><i class="mm-xp"><u data-id="xp"></u></i></div>
        <div class="mm-hero-hint">тяни мышью — повернуть</div>
      </section>
      <section class="mm-pane" data-id="pane"></section>
      <aside class="mm-side" data-id="side"></aside>
      <footer class="mm-bottom">
        <button class="mm-btn small" data-act="back">Назад <kbd>Esc</kbd></button>
        <span class="mm-hint" data-id="hint"></span>
        <button class="mm-btn start" data-act="start">Начать игру <kbd>Enter</kbd></button>
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

  /** Сообщение сервера: комната изменилась — перерисовать панель; бой начался — в бой */
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
    // сетевая: в лагере сразу карта — там панель сессий
    if (mode === 'online') { this.pane = 'map'; void NET.probe().then(() => this.connectNet()); }
    this.render();
  }

  hide(): void { this.el.classList.remove('open'); }

  setPane(p: Pane): void { this.pane = p; this.render(); }

  selectMap(id: string): void {
    if (this.mode === 'online' && NET.room && !NET.isHost) { this.flash('Карту выбирает хост'); return; }
    this.map = campaignMap(id).id;
    if (this.mode === 'online' && NET.room) NET.setMap(this.map);
    const st = loadMenuState();
    st.map = this.map;
    saveMenuState(st);
    this.renderSel();
  }

  /** Открыть инвентарь (на вкладке гнезда); фон меню на это время стоит — у инвентаря свой рендер героя */
  openInventory(slot?: SlotId): void {
    this.scene.stop();
    this.inventory.show(slot ? SLOT_KIND(slot) : undefined);
  }

  /** В бой: одиночная — сразу; сетевая — хост ведёт комнату в бой, гость отмечается готовым */
  startGame(): void {
    if (this.mode === 'online') {
      if (!NET.available) { this.flash('Сервер сетевой игры недоступен — пока играй в одиночную'); return; }
      const r = NET.room;
      if (!r) { this.flash('Создай комнату или войди по коду'); return; }
      if (NET.isHost) NET.startBattle();
      else NET.setReady(!r.seats.find((x) => x.seat === r.you)?.ready);
      return;
    }
    sfx.twinkle();
    window.location.href = battleUrl({ mode: this.mode, map: this.map, players: 1 });
  }

  key(e: KeyboardEvent): void {
    if (this.inventory.open) { this.inventory.key(e); return; }
    // в полях сетевой панели клавиши — для текста, Enter — кнопка поля
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
    this.q('mode').innerHTML = this.mode === 'online' ? 'Сетевая игра' : 'Одиночная игра';
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-pane]')) b.classList.toggle('on', b.dataset.pane === this.pane);
    this.q('pane').innerHTML = this.pane === 'gear' ? this.gearHtml() : this.mapsHtml();
    this.renderSel();
  }

  /**
   * Выбор гнезда или карты: подсветка и карточка справа. Панель не перерисовывается —
   * иначе второй клик двойного попадёт в новый элемент и двойной клик потеряется
   */
  private renderSel(): void {
    for (const e of this.el.querySelectorAll<HTMLElement>('[data-slot]')) e.classList.toggle('sel', e.dataset.slot === this.slot);
    for (const e of this.el.querySelectorAll<HTMLElement>('[data-map]')) e.classList.toggle('sel', e.dataset.map === this.map);
    // перерисовка сетевой панели (пришло сообщение, сменился состав) не сбивает набор в поле
    const focus = (document.activeElement as HTMLInputElement | null)?.dataset?.field;
    this.q('side').innerHTML = this.pane === 'gear' ? this.itemCard() : this.mapCard() + (this.mode === 'online' ? this.onlineHtml() : '');
    if (focus) { const f = this.el.querySelector<HTMLInputElement>(`[data-field="${focus}"]`); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }
    const lock = this.mode === 'online' && !NET.room;
    const startBtn = this.el.querySelector('[data-act="start"]') as HTMLButtonElement;
    startBtn.classList.toggle('locked', lock);
    startBtn.title = lock ? 'Сначала комната: создай или войди по коду' : `Начать: ${campaignMap(this.map).title}`;
    const guest = this.mode === 'online' && NET.room && !NET.isHost;
    const ready = guest && NET.room?.seats.find((x) => x.seat === NET.room?.you)?.ready;
    startBtn.firstChild!.textContent = guest ? (ready ? 'Не готов ' : 'Готов ') : 'Начать игру ';
    this.q('hint').classList.remove('warn');
    this.q('hint').textContent = this.pane === 'gear'
      ? 'Клик — гнездо · двойной клик или I — сменить · Q / E — вкладки'
      : `Карта: ${campaignMap(this.map).title} · двойной клик — сразу в бой`;
  }

  private gearHtml(): string {
    const p = this.profile;
    const stat = (s: ItemSlot, v: number): string => `<span>${iconImg(STAT_ICON[s], '', '#7fe0ff')}<b>${v}</b></span>`;
    const arts = p.artifacts().filter((x): x is Item => !!x);
    const head = `<div class="mm-power"><div><span>Сила снаряжения</span><b>${p.power}</b></div>
      <div class="mm-stats">${stat('melee', p.equipped('melee')?.power ?? 0)}${stat('ranged', p.equipped('ranged')?.power ?? 0)}${stat('armor', p.equipped('armor')?.power ?? 0)}${stat('artifact', arts.length ? Math.round(arts.reduce((a, x) => a + x.power, 0) / arts.length) : 0)}</div></div>`;
    const groups = GROUPS.map((g) => `<div class="mm-group"><h4>${iconImg(g.icon, '', '#cfd8e0')}${g.title}</h4><div class="mm-slots">${g.slots.map((s) => this.slotHtml(s)).join('')}</div></div>`).join('');
    const total = p.data.items.length, fresh = p.data.items.filter((x) => x.isNew).length;
    return `${head}${groups}<button class="mm-btn small" data-act="inventory">${iconImg('chest')}Все вещи · ${total}${fresh ? ` <i class="mm-new">+${fresh} новых</i>` : ''} <kbd>I</kbd></button>`;
  }

  private slotHtml(s: SlotId): string {
    const it = this.itemOf(s), on = s === this.slot ? ' sel' : '';
    if (!it) return `<div class="mm-slot empty${on}" data-slot="${s}" title="${SLOT_EMPTY[SLOT_KIND(s)]}: пусто"><span>+</span></div>`;
    const d = itemDef(it.def);
    return `<div class="mm-slot it r-${d.rarity}${on}" data-slot="${s}" title="${d.title}"><img class="px it-ico" src="${iconURL(d.icon)}" alt="" draggable="false"><span class="it-pw">${it.power}</span></div>`;
  }

  private itemCard(): string {
    const it = this.itemOf(this.slot), kind = SLOT_KIND(this.slot);
    if (!it) {
      const have = this.profile.data.items.filter((x) => itemDef(x.def).slot === kind && !this.profile.isEquipped(x.uid)).length;
      return `<div class="mm-card"><div class="mm-card-tag">Пусто</div><h3>${SLOT_EMPTY[kind]}</h3>
        <p>${have ? `В сумке подходящих: ${have}. Надень — и в бой.` : 'Подходящих вещей пока нет: ищи их в сундуках, у торговцев и в бою.'}</p>
        <button class="mm-btn small primary" data-act="change"${have ? '' : ' disabled'}>Надеть <kbd>I</kbd></button></div>`;
    }
    const d = itemDef(it.def), r = RARITY[d.rarity];
    const traits = d.traits?.length ? `<ul>${d.traits.map((t) => `<li>${t}</li>`).join('')}</ul>` : '';
    return `<div class="mm-card"><div class="mm-card-tag">Надето</div>
      <div class="mm-card-head"><b class="mm-card-pw">${it.power}</b><i class="mm-rar" style="--c:${r.color}">${r.title}</i><img class="px" src="${iconURL(d.icon)}" alt=""></div>
      <h3>${d.title}</h3><p>${d.description}</p>${traits}
      <button class="mm-btn small primary" data-act="change">Сменить <kbd>I</kbd></button></div>`;
  }

  private mapsHtml(): string {
    return `<h4 class="mm-pane-title">Оборона куста — выбери карту</h4><div class="mm-maps">${CAMPAIGN.map((m) => this.mapTile(m)).join('')}</div>`;
  }

  private mapTile(m: CampaignMap): string {
    const won = this.won.includes(m.id);
    return `<button class="mm-map${m.id === this.map ? ' sel' : ''}" data-map="${m.id}" style="--bg:${m.bg}">
      <span class="mm-map-art">${iconImg(m.icon)}</span>
      <b>${m.title}</b>
      <span class="mm-diff d${m.difficulty}">${'◆'.repeat(m.difficulty)}${'◇'.repeat(3 - m.difficulty)} ${difficultyTitle(m.difficulty)}</span>
      ${won ? '<i class="mm-won">пройдена</i>' : ''}
    </button>`;
  }

  private mapCard(): string {
    const m = campaignMap(this.map);
    return `<div class="mm-card map" style="--bg:${m.bg}"><div class="mm-card-tag">${difficultyTitle(m.difficulty)}</div>
      <h3>${m.title}</h3><p>${m.blurb}</p>
      <dl><dt>Волн</dt><dd>${m.waves}</dd><dt>Дорог</dt><dd>${m.lanes}</dd><dt>Куст</dt><dd>${m.bush}</dd><dt>Казна</dt><dd>${m.berries}</dd></dl>
      ${this.won.includes(m.id) ? '<p class="mm-won-line">Карта пройдена — куст отбит!</p>' : ''}</div>`;
  }

  /** Действия сетевой панели: кнопки и Enter в полях */
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
      case 'refresh': void NET.list().then((r) => { this.rooms = r; this.renderSel(); if (!r.length) this.flash('Открытых комнат нет — создай свою'); }); this.loadFriends(); break;
      case 'friend-add': {
        const name = this.friendDraft.trim();
        if (name) void NET.addFriend(name).then((ok) => { if (ok) { this.friendDraft = ''; this.loadFriends(); } });
        break;
      }
      case 'chat': if (this.chatDraft.trim()) { NET.chat(this.chatDraft); this.chatDraft = ''; this.renderSel(); } break;
      default: break;
    }
  }

  /** Сервер есть и вход сделан: связать профиль, открыть соединение, спросить список комнат */
  connectNet(): void {
    if (NET.available && NET.auth) {
      void NET.syncProfile(this.profile).then(() => { if (this.open) this.render(); });
      NET.connect();
      void NET.list().then((r) => { this.rooms = r; if (this.open && this.mode === 'online') this.renderSel(); });
      this.loadFriends();
    }
    if (this.open && this.mode === 'online') this.renderSel();
  }

  /** Друзья с сервера: на связи ли и в какой комнате */
  private loadFriends(): void {
    void NET.friends().then((f) => { this.friends = f; if (this.open && this.mode === 'online') this.renderSel(); });
  }

  /** Друзья: на связи — зелёная точка, в комнате с местом — «Войти» (и в идущий бой), ✕ — убрать */
  private friendsHtml(esc: (v: string) => string): string {
    const rows = this.friends.map((f) => {
      const r = f.room, can = r && r.players < r.max && r.code !== NET.room?.room.code;
      const where = r ? `${campaignMap(r.map).title}${r.state === 'battle' ? ' · в бою' : ''} · ${r.players}/${r.max}` : f.online ? 'на связи' : 'не в игре';
      return `<li class="mm-friend${f.online ? ' on' : ''}" data-player="${f.playerId}"><b>${esc(f.name)}</b><i>${where}</i>
        ${can ? `<button class="mm-btn small" data-act="join-room" data-code="${r.code}">Войти</button>` : ''}<button class="mm-btn small" data-act="friend-del" title="Убрать из друзей">✕</button></li>`;
    }).join('');
    return `<div class="mm-online-h"><b>Друзья</b></div>
      <div class="mm-join"><input class="mm-field" data-field="friend" data-enter="friend-add" maxlength="16" placeholder="Имя героя" value="${esc(this.friendDraft)}"><button class="mm-btn small" data-act="friend-add">+ Добавить</button></div>
      ${rows ? `<ul class="mm-rooms">${rows}</ul>` : '<div class="mm-online-empty">Друзей пока нет</div>'}`;
  }

  /** Чат комнаты: последние сообщения и поле */
  private chatHtml(esc: (v: string) => string): string {
    const log = this.chatLog.map((m) => `<div><b>${esc(m.name)}:</b> ${esc(m.text)}</div>`).join('');
    return `<div class="mm-online-h"><b>Чат</b></div><div class="mm-chat">${log || '<i>Пока тихо</i>'}</div>
      <div class="mm-join"><input class="mm-field" data-field="chat" data-enter="chat" maxlength="200" placeholder="Сообщение" value="${esc(this.chatDraft)}"><button class="mm-btn small" data-act="chat">→</button></div>`;
  }

  /** Панель сетевой игры по образцу MCD: вход, комната с местами, создать сессию, список сессий, вход по коду */
  private onlineHtml(): string {
    const esc = (v: string): string => v.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    if (!NET.available) {
      return `<div class="mm-online">
      <div class="mm-online-empty">Сервер недоступен</div>
      <p class="mm-note">Сетевая игра идёт через сервер «Малины» (${esc(NET.base)}): <code>npm run server</code>. Снаряжение и карту можно выбрать уже сейчас.</p>
      <button class="mm-btn small" data-act="probe">Проверить снова</button>
    </div>`;
    }
    if (!NET.auth) {
      return `<div class="mm-online">
      <div class="mm-online-h"><b>Имя героя</b></div>
      <input class="mm-field" data-field="name" data-enter="login" maxlength="16" placeholder="2–16 букв" value="${esc(this.nameDraft)}">
      <button class="mm-btn host" data-act="login">Войти</button>
      <p class="mm-note">Без пароля: сервер запомнит героя в этом браузере.</p>
    </div>`;
    }
    const who = `<div class="mm-online-h"><b>${esc(NET.auth.name)}</b><button class="mm-btn small" data-act="logout" title="Забыть вход в этом браузере">Выйти</button></div>`;
    const r = NET.room;
    if (r) {
      const seats = r.seats.map((x) => `<li class="mm-seat${x.online ? '' : ' off'}${x.seat === r.you ? ' me' : ''}" data-player="${x.playerId}">
        <b>${x.host ? '♛ ' : ''}${esc(x.name)}</b><i>${x.host ? 'хост' : x.ready ? 'готов' : 'не готов'}${x.online ? '' : ' · нет связи'}</i>
        ${NET.isHost && !x.host ? '<button class="mm-btn small" data-act="kick" title="Убрать из комнаты">✕</button>' : ''}</li>`).join('');
      return `<div class="mm-online">${who}
      <div class="mm-online-h"><b>Комната</b><span class="mm-code" title="Код для друзей">${r.room.code}</span></div>
      <ul class="mm-seats">${seats}${'<li class="mm-seat empty">свободно</li>'.repeat(Math.max(0, r.room.max - r.seats.length))}</ul>
      <p class="mm-note">${campaignMap(r.room.map).title}${r.room.private ? ' · закрытая' : ''} · ${NET.isHost ? 'все готовы — «Начать игру»' : '«Готов» — и ждём хоста'}</p>
      ${this.chatHtml(esc)}
      <button class="mm-btn small" data-act="leave">Покинуть комнату</button>
      ${this.friendsHtml(esc)}
    </div>`;
    }
    const list = this.rooms === null ? '<div class="mm-online-empty">…</div>'
      : this.rooms.length ? `<ul class="mm-rooms">${this.rooms.map((x) => `<li><b>${esc(x.host)}</b><i>${campaignMap(x.map).title}${x.state === 'battle' ? ' · в бою' : ''} · ${x.players}/${x.max}</i><button class="mm-btn small" data-act="join-room" data-code="${x.code}">Войти</button></li>`).join('')}</ul>`
        : '<div class="mm-online-empty">Сессий не найдено</div>';
    return `<div class="mm-online">${who}
      <button class="mm-btn host" data-act="host">Создать онлайн-сессию</button>
      <label class="mm-toggle" data-act="private">Закрытая игра<i class="${this.privateGame ? 'on' : ''}"></i></label>
      <div class="mm-online-h"><b>Код комнаты</b></div>
      <div class="mm-join"><input class="mm-field" data-field="code" data-enter="join" maxlength="6" placeholder="ABCDEF" value="${esc(this.codeDraft)}"><button class="mm-btn small" data-act="join">Войти</button></div>
      <div class="mm-online-h"><b>Сессии</b><button class="mm-btn small" data-act="refresh">Обновить</button></div>
      ${list}
      ${this.friendsHtml(esc)}
    </div>`;
  }
}
