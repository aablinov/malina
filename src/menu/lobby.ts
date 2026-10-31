import { sfx } from '../audio';
import { iconImg, iconURL } from '../icons';
import { itemDef, RARITY, xpToNext, type Item, type ItemSlot, type Profile } from '../items';
import { Inventory } from '../hud/inventory';
import type { Textures } from '../textures';
import { CAMPAIGN, campaignMap, difficultyTitle, type CampaignMap } from './campaign';
import type { MenuScene } from './scene';
import { battleUrl, loadMenuState, NET, saveMenuState, type GameMode } from './session';

/**
 * Лагерь перед боем (wiki/design-main-menu.md) — как инвентарь и экран героя в Minecraft Dungeons:
 * слева герой в 3D (фон меню, src/menu/scene.ts), в центре вкладки «Снаряжение» и «Карта», справа карточка выбранного.
 * Снаряжение: гнёзда по группам — оружие, броня, артефакты, аура; «Сменить» открывает инвентарь на нужной вкладке.
 * Карта: три карты обороны куста по сложности. «Начать игру» — бой на выбранной карте.
 * Сетевая игра — тот же лагерь с панелью сессий; сети пока нет, панель — заглушка, старт закрыт.
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
  /** Сетевая панель: «закрытая игра» — пока только переключатель */
  private privateGame = false;
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
  }

  get open(): boolean { return this.el.classList.contains('open'); }

  show(mode: GameMode): void {
    this.mode = mode;
    this.el.classList.add('open');
    this.el.classList.toggle('online', mode === 'online');
    this.render();
  }

  hide(): void { this.el.classList.remove('open'); }

  setPane(p: Pane): void { this.pane = p; this.render(); }

  selectMap(id: string): void {
    this.map = campaignMap(id).id;
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

  /** В бой: одиночная — сразу, сетевая — пока закрыта */
  startGame(): void {
    if (this.mode === 'online' && !NET.available) { this.flash('Сетевая игра появится позже — пока играй в одиночную'); return; }
    sfx.twinkle();
    window.location.href = battleUrl({ mode: this.mode, map: this.map, players: 1 });
  }

  key(e: KeyboardEvent): void {
    if (this.inventory.open) { this.inventory.key(e); return; }
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
        case 'refresh': this.flash('Сессий не найдено — сетевая игра появится позже'); break;
        case 'host': case 'friend': this.flash('Сетевая игра появится позже'); break;
        case 'private': this.privateGame = !this.privateGame; this.render(); break;
        default: break;
      }
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
    this.q('side').innerHTML = this.pane === 'gear' ? this.itemCard() : this.mapCard() + (this.mode === 'online' ? this.onlineHtml() : '');
    const lock = this.mode === 'online' && !NET.available;
    const startBtn = this.el.querySelector('[data-act="start"]') as HTMLButtonElement;
    startBtn.classList.toggle('locked', lock);
    startBtn.title = lock ? 'Сетевая игра появится позже' : `Начать: ${campaignMap(this.map).title}`;
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

  /** Панель сетевой игры по образцу MCD: создать сессию, закрытая игра, список сессий, друзья — пока заглушки */
  private onlineHtml(): string {
    return `<div class="mm-online">
      <button class="mm-btn host locked" data-act="host">Создать онлайн-сессию</button>
      <label class="mm-toggle" data-act="private">Закрытая игра<i class="${this.privateGame ? 'on' : ''}"></i></label>
      <div class="mm-online-h"><b>Сессии</b><button class="mm-btn small" data-act="refresh">Обновить</button></div>
      <div class="mm-online-empty">Сессий не найдено</div>
      <div class="mm-online-h"><b>Друзья</b><button class="mm-btn small" data-act="friend">+ Добавить</button></div>
      <div class="mm-online-empty">Друзей пока нет</div>
      <p class="mm-note">Сетевая игра появится позже. Снаряжение и карту можно выбрать уже сейчас.</p>
    </div>`;
  }
}
