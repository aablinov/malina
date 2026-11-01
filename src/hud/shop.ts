import { auraLines } from '../aura-offense';
import { iconImg, iconURL } from '../icons';
import { armorHealth, ITEMS, itemDef, PERK_TEXT, powerMult, PRICE, RARITY, SLOT_TITLE, type Item, type ItemDef, type ItemSlot, type Profile } from '../items';
import { MERCHANT_TITLE, type MerchantKind } from '../merchants';
import { priceOf } from '../prices';
import { WEAPON_SPECIAL } from '../temper';
import { getWeapon, weaponMetrics } from '../weapons';
import './shop.css';

/**
 * Окно торговли (wiki/design-inventory.md, «Торговцы»): ничего наугад — всё видно и всё можно купить. Сверху вкладки
 * видов (Q / E), слева сетка товаров с ценой под каждым, справа карточка выбранного — сила, редкость, урон, дальность,
 * спец-удар оружия, сравнение с надетым (▲ / ▼) и «Купить». Цена — от характеристик (src/prices.ts), сила товара —
 * сила героя. У кузнеца — оружие и броня и перековка надетого (+1 к силе), у торговца — всё: оружие, луки, броня,
 * артефакты, обычные заклинания и стрелы. Клавиши: стрелки — выбор, Enter — купить (после покупки — надеть), Esc — закрыть.
 * Игра на паузе.
 */

type Tab = ItemSlot | 'spell';
interface TabDef { id: Tab; title: string; icon: string }
/** Товар: предмет каталога или связка стрел */
interface Ware { key: string; def?: ItemDef; arrows?: number; price: number }

const TAB: Record<Tab, TabDef> = {
  melee: { id: 'melee', title: SLOT_TITLE.melee, icon: 'sword' },
  ranged: { id: 'ranged', title: SLOT_TITLE.ranged, icon: 'bow' },
  armor: { id: 'armor', title: SLOT_TITLE.armor, icon: 'helmet' },
  artifact: { id: 'artifact', title: SLOT_TITLE.artifact, icon: 'flask' },
  aura: { id: 'aura', title: SLOT_TITLE.aura, icon: 'a-bastion' },
  spell: { id: 'spell', title: 'Заклинания', icon: 'fireball' },
};
const TABS: Record<MerchantKind, Tab[]> = { smith: ['melee', 'ranged', 'armor'], merchant: ['melee', 'ranged', 'armor', 'artifact', 'spell'], sutler: ['melee', 'ranged', 'armor', 'artifact', 'spell', 'aura'] };
const DESC: Record<MerchantKind, string> = {
  sutler: 'Маркитант обороны: оружие, луки, броня, артефакты, все заклинания и ауры за малину боя. Купленное служит до конца боя — башни или герой, решай сам.',
  smith: 'Выкует любое оружие или броню по твоей силе и перекуёт надетое — +1 к силе за малину.',
  merchant: 'Продаёт всё: оружие, луки, броню, артефакты, обычные заклинания и стрелы. Цена — по силе предмета.',
};
const SLOT_ICON: Record<ItemSlot, string> = { melee: 'sword', ranged: 'bow', armor: 'helmet', artifact: 'flask', aura: 'a-bastion' };
const COLS = 4;
/** Цены маркитанта обороны (wiki/design-tower-defence.md, раздел 12): по редкости, дорого — вложиться в героя или в две-три башни */
export const SUTLER_PRICE: Record<ItemDef['rarity'], number> = { common: 240, rare: 480, unique: 780 };
export const SUTLER_ARROWS = 45;
const ARROWS = 24;

export class Shop {
  readonly el: HTMLDivElement;
  private kind: MerchantKind = 'smith';
  private tab: Tab = 'melee';
  /** Выбранный товар (key) */
  private sel = '';
  private wares: Ware[] = [];
  private bought: Item | null = null;
  onClose?: () => void;
  onChange?: () => void;
  /** Звук: купили или не хватает */
  onSound?: (ok: boolean) => void;

  constructor(parent: HTMLElement, private readonly profile: Profile) {
    const el = document.createElement('div');
    el.className = 'trade';
    parent.appendChild(el);
    this.el = el;
    for (const ev of ['mousedown', 'mouseup', 'wheel', 'contextmenu'] as const) el.addEventListener(ev, (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act], [data-ware], [data-tab]');
      if (!t) return;
      if (t.dataset.tab) { this.setTab(t.dataset.tab as Tab); return; }
      if (t.dataset.ware) { this.select(t.dataset.ware); return; }
      const a = t.dataset.act ?? '';
      if (a === 'close') this.hide();
      else if (a === 'buy') this.buy();
      else if (a === 'equip') this.equipBought();
      else if (a === 'keep') { this.bought = null; this.render(); }
      else if (a === 'tabPrev') this.stepTab(-1);
      else if (a === 'tabNext') this.stepTab(1);
      else if (a.startsWith('forge:')) this.reforge(a.slice(6));
    });
    el.addEventListener('dblclick', (e) => {
      const k = (e.target as HTMLElement).closest<HTMLElement>('[data-ware]')?.dataset.ware;
      if (k) { this.select(k); this.buy(); }
    });
  }

  get open(): boolean { return this.el.classList.contains('open'); }
  get current(): MerchantKind { return this.kind; }
  /** Выбранный товар и вкладка (для тестов) */
  get selected(): string { return this.sel; }
  get currentTab(): Tab { return this.tab; }
  /** Товары открытой вкладки: ключ и цена */
  get list(): { key: string; price: number }[] { return this.wares.map((w) => ({ key: w.key, price: w.price })); }

  show(kind: MerchantKind): void {
    this.kind = kind;
    this.bought = null;
    if (!TABS[kind].includes(this.tab)) this.tab = TABS[kind][0];
    this.el.classList.add('open');
    this.render();
  }

  hide(): void { if (!this.open) return; this.el.classList.remove('open'); this.onClose?.(); }

  key(e: KeyboardEvent): boolean {
    if (!this.open) return false;
    const i = this.wares.findIndex((w) => w.key === this.sel);
    const move = (d: number): void => { const n = this.wares.length; if (n) this.select(this.wares[Math.max(0, Math.min(n - 1, (i < 0 ? 0 : i) + d))].key); };
    switch (e.code) {
      case 'Escape': case 'KeyF': this.hide(); break;
      case 'KeyQ': this.stepTab(-1); break;
      case 'KeyE': this.stepTab(1); break;
      case 'ArrowLeft': case 'KeyA': move(-1); break;
      case 'ArrowRight': case 'KeyD': move(1); break;
      case 'ArrowUp': case 'KeyW': move(-COLS); break;
      case 'ArrowDown': case 'KeyS': move(COLS); break;
      case 'Enter': if (this.bought) this.equipBought(); else this.buy(); break;
      default: return false;
    }
    return true;
  }

  setTab(t: Tab): void {
    if (!TABS[this.kind].includes(t)) return;
    this.tab = t;
    this.sel = '';
    this.bought = null;
    this.render();
  }

  private stepTab(d: number): void {
    const list = TABS[this.kind], i = list.indexOf(this.tab);
    this.setTab(list[(i + d + list.length) % list.length]);
  }

  /** Выбрать товар: id предмета каталога или 'arrows' */
  select(key: string): void {
    this.sel = key;
    this.bought = null;
    this.render();
    this.el.querySelector('.trade-grid .it.sel')?.scrollIntoView({ block: 'nearest' });
  }

  /** Товары вкладки: по цене, дешёвые первыми; заклинания с боссов, стартовые и ауры (падают с боссов) не продаются */
  private makeWares(): Ware[] {
    const pw = this.profile.power;
    const sutler = this.kind === 'sutler';
    const of = (f: (d: ItemDef) => boolean): Ware[] => ITEMS.filter(f).map((d) => ({ key: d.id, def: d, price: sutler ? SUTLER_PRICE[d.rarity] : priceOf(d.id, pw) }));
    let w: Ware[];
    switch (this.tab) {
      // у маркитанта — все заклинания (стартовые, лавочные, с боссов) и все ауры
      case 'spell': w = of((d) => (sutler ? d.slot === 'artifact' && !!d.spell : d.spell === 'shop')); break;
      case 'aura': w = of((d) => d.slot === 'aura'); break;
      case 'artifact': w = of((d) => d.slot === 'artifact' && !d.spell); break;
      default: w = of((d) => d.slot === this.tab && !d.spell);
    }
    w.sort((a, b) => a.price - b.price);
    if (this.tab === 'ranged') w.unshift({ key: 'arrows', arrows: ARROWS, price: sutler ? SUTLER_ARROWS : PRICE.arrows });
    return w;
  }

  /** Купить выбранный товар (или товар key): false — не хватает малины или нечего покупать */
  buy(key = this.sel): boolean {
    if (key !== this.sel) { this.sel = key; this.render(); }
    const w = this.wares.find((x) => x.key === key);
    if (!w) return false;
    if (!this.profile.pay(w.price)) { this.onSound?.(false); this.flash(); return false; }
    if (w.arrows) { this.profile.addArrows(w.arrows); this.bought = null; }
    else if (w.def) { this.bought = this.profile.add(w.def.id, this.profile.power); this.profile.save(); }
    this.onSound?.(true);
    this.onChange?.();
    this.render();
    return true;
  }

  private equipBought(): void {
    if (!this.bought) return;
    this.profile.equip(this.bought.uid);
    this.bought = null;
    this.onChange?.();
    this.render();
  }

  private reforge(uid: string): void {
    const it = this.profile.get(uid);
    if (!it) return;
    const ok = this.profile.reforge(uid, PRICE.reforge(it.power));
    this.onSound?.(ok);
    if (ok) this.onChange?.();
    this.render();
  }

  private flash(): void {
    const c = this.el.querySelector('.trade-buy');
    c?.classList.remove('poor'); void (c as HTMLElement | null)?.offsetWidth; c?.classList.add('poor');
  }

  private tile(it: { def: string; power: number }, cls = ''): string {
    const d = itemDef(it.def);
    return `<div class="it r-${d.rarity} ${cls}"><img class="px it-ico" src="${iconURL(d.icon)}" alt=""><span class="it-pw">${iconImg(SLOT_ICON[d.slot], '', '#fff')}${it.power}</span></div>`;
  }

  /** Плитка товара: иконка, цена, сколько таких уже есть, сравнение с надетым */
  private wareTile(w: Ware): string {
    const D = this.profile.data, poor = D.berries < w.price;
    const rar = w.def?.rarity ?? 'common', icon = w.def?.icon ?? 'arrows';
    const have = w.def ? D.items.filter((i) => i.def === w.def!.id).length : 0;
    const cmp = w.def ? this.compare(w.def) : 0;
    return `<div class="trade-ware" data-ware="${w.key}" title="${w.def?.title ?? 'Связка стрел'}">
      <div class="it r-${rar}${w.key === this.sel ? ' sel' : ''}${poor ? ' poor' : ''}"><img class="px it-ico" src="${iconURL(icon)}" alt="">
        ${w.arrows ? `<span class="it-pw">×${w.arrows}</span>` : ''}${have ? `<span class="trade-have">есть${have > 1 ? ` ×${have}` : ''}</span>` : ''}${cmp ? `<i class="it-cmp ${cmp > 0 ? 'up' : 'down'}"></i>` : ''}</div>
      <div class="trade-cost${poor ? ' poor' : ''}">${iconImg('berry')}${w.price}</div>
    </div>`;
  }

  /** Сильнее (+1) или слабее (−1) надетого того же вида; 0 — нечего сравнивать */
  private compare(d: ItemDef): number {
    if (d.slot !== 'melee' && d.slot !== 'ranged' && d.slot !== 'armor') return 0;
    const cur = this.profile.equipped(d.slot);
    if (!cur || cur.def === d.id) return 0;
    const a = this.score(d, this.profile.power), b = this.score(itemDef(cur.def), cur.power);
    return Math.abs(a - b) < 0.02 * b ? 0 : a > b ? 1 : -1;
  }

  /** Сила предмета для сравнения: урон в секунду у оружия, здоровье у брони */
  private score(d: ItemDef, power: number): number {
    const k = powerMult(power);
    if (d.slot === 'melee') { const w = getWeapon(d.weapon ?? ''); return w ? weaponMetrics(w).dps * k : 0; }
    if (d.ranged) return ((d.ranged.dmg * (d.ranged.shots ?? 1)) / d.ranged.cd) * k;
    if (d.armor) return d.armor.health * k;
    return 0;
  }

  /** Карточка выбранного: что это, сколько бьёт, чем отличается, цена и «Купить» */
  private detail(w: Ware | undefined): string {
    const D = this.profile.data, pw = this.profile.power;
    if (!w) return '<div class="d-empty">Выбери товар в сетке</div>';
    const poor = D.berries < w.price;
    const buy = `<div class="trade-buy"><div class="trade-price">${iconImg('berry')}<b class="${poor ? 'poor' : ''}">${w.price}</b></div>
      <button class="ok" data-act="buy"${poor ? ' disabled' : ''}>${poor ? 'Не хватает малины' : 'Купить'} <kbd>Enter</kbd></button></div>`;
    if (w.arrows) {
      return `<h2 class="d-title">Связка стрел</h2><img class="px d-art" src="${iconURL('arrows')}" alt="">
        <ul class="d-stats"><li>${iconImg('arrows', '', '#d8d4e0')}<span>+${w.arrows} стрел сразу в колчан</span></li><li>${iconImg('e-arrow', '', '#d8d4e0')}<span>Сейчас в колчане: <b>${D.arrows}</b></span></li></ul>${buy}`;
    }
    const d = w.def!, R = RARITY[d.rarity], k = powerMult(pw);
    const lines: string[] = [];
    const line = (icon: string, text: string): void => { lines.push(`<li>${iconImg(icon, '', '#d8d4e0')}<span>${text}</span></li>`); };
    if (d.slot === 'melee') {
      const wd = getWeapon(d.weapon ?? '');
      if (wd) {
        const m = weaponMetrics(wd), dm = wd.stats.swings.map((s) => Math.round(s.dmg * k));
        line('sword', `Урон ${dm.join(' / ')} за три удара`);
        line('e-clock', `${Math.round(m.dps * k)} урона в секунду · комбо ${m.comboTime.toFixed(1).replace('.', ',')} с`);
        line('e-arrow', `Дальность до ${m.maxReach.toFixed(1).replace('.', ',')} м · крит ${Math.round(wd.stats.critChance * 100)} %`);
        for (const t of d.traits ?? []) line('e-star', t);
        line('e-bolt', `<b>Q — ${WEAPON_SPECIAL[wd.category].title}:</b> ${WEAPON_SPECIAL[wd.category].text}`);
      }
    } else if (d.ranged) {
      const r = d.ranged;
      line('arrow', `Урон стрелы ${Math.round(r.dmg * k)}${r.shots ? ` × ${r.shots}` : ''}`);
      line('e-clock', `Выстрел каждые ${r.cd.toFixed(2).replace('.', ',')} с`);
      line('e-arrow', `Дальность ${r.range} м`);
    } else if (d.armor) {
      line('heart', `+${armorHealth({ uid: '', def: d.id, power: pw, enchants: [] })} к здоровью`);
      for (const p of d.armor.perks) line('e-star', PERK_TEXT[p.kind](p.value));
    } else if (d.artifact) {
      const a = d.artifact;
      if (a.info) line(d.icon, a.info.replace('{v}', String(Math.round(a.power * k))).replace('{r}', String(a.radius ?? '')).replace('{d}', String(a.duration ?? '')));
      if (a.radius) line('e-arrow', `Радиус ${a.radius} м`);
      if (a.souls) line('soul', `Тратит ${a.souls} душ`);
      line('e-clock', `Перезарядка ${a.cd} с`);
    } else if (d.aura) {
      for (const [icon, text] of auraLines(d.aura, k, d.icon)) line(icon, text);
    }
    const cmp = this.compare(d);
    if (cmp) line(cmp > 0 ? 'e-star' : 'e-fist', cmp > 0 ? '<b class="up">▲ сильнее надетого</b>' : '<b class="down">▼ слабее надетого</b>');
    const have = D.items.filter((i) => i.def === d.id).length;
    return `<div class="d-head"><span class="d-pw">${pw}${iconImg(SLOT_ICON[d.slot], '', '#fff')}</span><span class="d-rar" style="--c:${R.color}">${R.title}</span>${have ? `<span class="d-on">В инвентаре: ${have}</span>` : ''}</div>
      <h2 class="d-title">${d.title}</h2><img class="px d-art" src="${iconURL(d.icon)}" alt="">
      <ul class="d-stats">${lines.join('')}</ul><p class="d-desc">${d.description}</p>${buy}`;
  }

  render(): void {
    const P = this.profile, D = P.data;
    this.wares = this.makeWares();
    if (!this.wares.some((w) => w.key === this.sel)) this.sel = this.wares[0]?.key ?? '';
    const sel = this.wares.find((w) => w.key === this.sel);
    const tabs = TABS[this.kind].map((t) => `<button class="inv-tab${t === this.tab ? ' on' : ''}" data-tab="${t}" title="${TAB[t].title}">${iconImg(TAB[t].icon, '', '#e8e4ef')}</button>`).join('');

    let side = '';
    if (this.bought) {
      const d = itemDef(this.bought.def), R = RARITY[d.rarity];
      side += `<div class="trade-got"><h3>Покупка</h3>${this.tile(this.bought, 'big got')}
        <div class="d-head"><span class="d-pw">${this.bought.power}${iconImg(SLOT_ICON[d.slot], '', '#fff')}</span><span class="d-rar" style="--c:${R.color}">${R.title}</span></div>
        <h2 class="d-title">${d.title}</h2>
        <div class="d-btns"><button class="ok" data-act="equip">Надеть <kbd>Enter</kbd></button><button data-act="keep">В инвентарь</button></div></div>`;
    } else side += `<div class="trade-detail">${this.detail(sel)}</div>`;
    if (this.kind === 'smith') {
      const rows = (['melee', 'armor', 'ranged'] as const).map((s) => P.equipped(s)).filter((x): x is Item => !!x).map((it) => {
        const price = PRICE.reforge(it.power), d = itemDef(it.def);
        return `<div class="trade-forge">${this.tile(it)}<div><b>${d.title}</b><span>Сила ${it.power} → <em>${it.power + 1}</em></span></div>
          <button data-act="forge:${it.uid}"${D.berries < price ? ' disabled' : ''}>${iconImg('berry')}${price}</button></div>`;
      }).join('');
      side += `<div class="trade-forgebox"><h3>Перековка надетого</h3>${rows}</div>`;
    }

    this.el.innerHTML = `
      <div class="inv-top"><span title="Малина">${iconImg('berry')}<b>${D.berries}</b></span><span title="Очки зачарования">${iconImg('spiral')}<b>${D.points}</b></span></div>
      <button class="inv-x" data-act="close" title="Закрыть (Esc)">✕</button>
      <div class="trade-head"><h1>${MERCHANT_TITLE[this.kind]}</h1><p>${DESC[this.kind]}</p></div>
      <div class="trade-body">
        <section class="trade-shelf">
          <div class="inv-tablabel">${TAB[this.tab].title}</div>
          <div class="inv-tabs"><kbd data-act="tabPrev">Q</kbd>${tabs}<kbd data-act="tabNext">E</kbd></div>
          <div class="inv-gridwrap"><div class="trade-grid" style="--cols:${COLS}">${this.wares.map((w) => this.wareTile(w)).join('')}</div></div>
        </section>
        <section class="trade-side">${side}</section>
      </div>
      <div class="inv-actions"><button data-act="close">Назад <kbd>Esc</kbd></button><span class="inv-hint">Q / E — вкладки · стрелки — выбор · Enter или двойной клик — купить${this.bought ? ' · Enter — надеть покупку' : ''}</span></div>`;
  }
}
