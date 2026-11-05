import { auraLines } from '../aura-offense.ts';
import { t } from '../i18n/i18n.ts';
import { iconImg, iconURL } from '../icons.ts';
import { armorHealth, ITEMS, itemDef, PERK_TEXT, powerMult, PRICE, RARITY, SLOT_TITLE, type Item, type ItemDef, type ItemSlot, type Profile } from '../items.ts';
import { MERCHANT_TITLE, type MerchantKind } from '../merchants.ts';
import { priceOf } from '../prices.ts';
import { WEAPON_SPECIAL } from '../temper.ts';
import { getWeapon, weaponMetrics } from '../weapons.ts';
import './shop.css';

/**
 * Trade window (wiki/design-inventory.md, "Merchants"): nothing at random — everything is visible and everything can be bought.
 * Kind tabs at the top (Q / E), the ware grid on the left with the price under each, the card of the selection on the right — power,
 * rarity, damage, range, weapon art, comparison with the equipped (▲ / ▼) and "Buy". Price from the stats (src/prices.ts), ware power —
 * the hero's power. The blacksmith has weapons and armour and reforging of the equipped (+1 power), the merchant has everything: weapons, bows,
 * armour, artifacts, common spells and arrows. Keys: arrows — select, Enter — buy (after a purchase — equip), Esc — close.
 * The game is paused.
 */

type Tab = ItemSlot | 'spell';
interface TabDef { id: Tab; title: string; icon: string }
/** Ware: a catalog item or a bundle of arrows */
interface Ware { key: string; def?: ItemDef; arrows?: number; price: number }

const TAB: Record<Tab, TabDef> = {
  melee: { id: 'melee', title: SLOT_TITLE.melee, icon: 'sword' },
  ranged: { id: 'ranged', title: SLOT_TITLE.ranged, icon: 'bow' },
  armor: { id: 'armor', title: SLOT_TITLE.armor, icon: 'helmet' },
  artifact: { id: 'artifact', title: SLOT_TITLE.artifact, icon: 'flask' },
  aura: { id: 'aura', title: SLOT_TITLE.aura, icon: 'a-bastion' },
  spell: { id: 'spell', title: t('Spells'), icon: 'fireball' },
};
const TABS: Record<MerchantKind, Tab[]> = { smith: ['melee', 'ranged', 'armor'], merchant: ['melee', 'ranged', 'armor', 'artifact', 'spell'], sutler: ['melee', 'ranged', 'armor', 'artifact', 'spell', 'aura'] };
const DESC: Record<MerchantKind, string> = {
  sutler: t('The defence sutler: weapons, bows, armour, artifacts, all spells and auras for the battle raspberries. Purchases serve until the end of the battle — towers or the hero, your call.'),
  smith: t('Forges any weapon or armour to your power and reforges the equipped — +1 power for raspberries.'),
  merchant: t('Sells everything: weapons, bows, armour, artifacts, common spells and arrows. Price by item power.'),
};
const SLOT_ICON: Record<ItemSlot, string> = { melee: 'sword', ranged: 'bow', armor: 'helmet', artifact: 'flask', aura: 'a-bastion' };
const COLS = 4;
/** Defence sutler prices (wiki/design-tower-defence.md, section 12): by rarity, expensive — invest in the hero or in two or three towers */
export const SUTLER_PRICE: Record<ItemDef['rarity'], number> = { common: 240, rare: 480, unique: 780 };
export const SUTLER_ARROWS = 45;
const ARROWS = 24;

export class Shop {
  readonly el: HTMLDivElement;
  private kind: MerchantKind = 'smith';
  private tab: Tab = 'melee';
  /** Selected ware (key) */
  private sel = '';
  private wares: Ware[] = [];
  private bought: Item | null = null;
  onClose?: () => void;
  onChange?: () => void;
  /** Sound: bought or not enough */
  onSound?: (ok: boolean) => void;

  private readonly profile: Profile;
  constructor(parent: HTMLElement, profile: Profile) { this.profile = profile;
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
  /** Selected ware and tab (for tests) */
  get selected(): string { return this.sel; }
  get currentTab(): Tab { return this.tab; }
  /** Wares of the open tab: key and price */
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

  /** Select a ware: a catalog item id or 'arrows' */
  select(key: string): void {
    this.sel = key;
    this.bought = null;
    this.render();
    this.el.querySelector('.trade-grid .it.sel')?.scrollIntoView({ block: 'nearest' });
  }

  /** Wares of the tab: by price, cheapest first; boss spells, starter ones and auras (dropped by bosses) are not for sale */
  private makeWares(): Ware[] {
    const pw = this.profile.power;
    const sutler = this.kind === 'sutler';
    const of = (f: (d: ItemDef) => boolean): Ware[] => ITEMS.filter(f).map((d) => ({ key: d.id, def: d, price: sutler ? SUTLER_PRICE[d.rarity] : priceOf(d.id, pw) }));
    let w: Ware[];
    switch (this.tab) {
      // the sutler has all spells (starter, shop, boss) and all auras
      case 'spell': w = of((d) => (sutler ? d.slot === 'artifact' && !!d.spell : d.spell === 'shop')); break;
      case 'aura': w = of((d) => d.slot === 'aura'); break;
      case 'artifact': w = of((d) => d.slot === 'artifact' && !d.spell); break;
      default: w = of((d) => d.slot === this.tab && !d.spell);
    }
    w.sort((a, b) => a.price - b.price);
    if (this.tab === 'ranged') w.unshift({ key: 'arrows', arrows: ARROWS, price: sutler ? SUTLER_ARROWS : PRICE.arrows });
    return w;
  }

  /** Buy the selected ware (or ware key): false — not enough raspberries or nothing to buy */
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

  /** Ware tile: icon, price, how many of these are owned, comparison with the equipped */
  private wareTile(w: Ware): string {
    const D = this.profile.data, poor = D.berries < w.price;
    const rar = w.def?.rarity ?? 'common', icon = w.def?.icon ?? 'arrows';
    const have = w.def ? D.items.filter((i) => i.def === w.def!.id).length : 0;
    const cmp = w.def ? this.compare(w.def) : 0;
    return `<div class="trade-ware" data-ware="${w.key}" title="${w.def?.title ?? t('Bundle of arrows')}">
      <div class="it r-${rar}${w.key === this.sel ? ' sel' : ''}${poor ? ' poor' : ''}"><img class="px it-ico" src="${iconURL(icon)}" alt="">
        ${w.arrows ? `<span class="it-pw">×${w.arrows}</span>` : ''}${have ? `<span class="trade-have">${t('owned')}${have > 1 ? ` ×${have}` : ''}</span>` : ''}${cmp ? `<i class="it-cmp ${cmp > 0 ? 'up' : 'down'}"></i>` : ''}</div>
      <div class="trade-cost${poor ? ' poor' : ''}">${iconImg('berry')}${w.price}</div>
    </div>`;
  }

  /** Stronger (+1) or weaker (−1) than the equipped of the same kind; 0 — nothing to compare */
  private compare(d: ItemDef): number {
    if (d.slot !== 'melee' && d.slot !== 'ranged' && d.slot !== 'armor') return 0;
    const cur = this.profile.equipped(d.slot);
    if (!cur || cur.def === d.id) return 0;
    const a = this.score(d, this.profile.power), b = this.score(itemDef(cur.def), cur.power);
    return Math.abs(a - b) < 0.02 * b ? 0 : a > b ? 1 : -1;
  }

  /** Item strength for comparison: damage per second for weapons, health for armour */
  private score(d: ItemDef, power: number): number {
    const k = powerMult(power);
    if (d.slot === 'melee') { const w = getWeapon(d.weapon ?? ''); return w ? weaponMetrics(w).dps * k : 0; }
    if (d.ranged) return ((d.ranged.dmg * (d.ranged.shots ?? 1)) / d.ranged.cd) * k;
    if (d.armor) return d.armor.health * k;
    return 0;
  }

  /** Card of the selection: what it is, how hard it hits, how it differs, price and "Buy" */
  private detail(w: Ware | undefined): string {
    const D = this.profile.data, pw = this.profile.power;
    if (!w) return `<div class="d-empty">${t('Select a ware in the grid')}</div>`;
    const poor = D.berries < w.price;
    const buy = `<div class="trade-buy"><div class="trade-price">${iconImg('berry')}<b class="${poor ? 'poor' : ''}">${w.price}</b></div>
      <button class="ok" data-act="buy"${poor ? ' disabled' : ''}>${poor ? t('Not enough raspberries') : t('Buy')} <kbd>Enter</kbd></button></div>`;
    if (w.arrows) {
      return `<h2 class="d-title">${t('Bundle of arrows')}</h2><img class="px d-art" src="${iconURL('arrows')}" alt="">
        <ul class="d-stats"><li>${iconImg('arrows', '', '#d8d4e0')}<span>${t('+{n} arrows straight into the quiver', { n: w.arrows })}</span></li><li>${iconImg('e-arrow', '', '#d8d4e0')}<span>${t('In the quiver now: <b>{n}</b>', { n: D.arrows })}</span></li></ul>${buy}`;
    }
    const d = w.def!, R = RARITY[d.rarity], k = powerMult(pw);
    const lines: string[] = [];
    const line = (icon: string, text: string): void => { lines.push(`<li>${iconImg(icon, '', '#d8d4e0')}<span>${text}</span></li>`); };
    if (d.slot === 'melee') {
      const wd = getWeapon(d.weapon ?? '');
      if (wd) {
        const m = weaponMetrics(wd), dm = wd.stats.swings.map((s) => Math.round(s.dmg * k));
        line('sword', t('Damage {dmg} over three hits', { dmg: dm.join(' / ') }));
        line('e-clock', t('{dps} damage per second · combo {s} s', { dps: Math.round(m.dps * k), s: m.comboTime.toFixed(1).replace('.', ',') }));
        line('e-arrow', t('Range up to {m} m · crit {pct} %', { m: m.maxReach.toFixed(1).replace('.', ','), pct: Math.round(wd.stats.critChance * 100) }));
        for (const t of d.traits ?? []) line('e-star', t);
        line('e-bolt', `<b>Q — ${WEAPON_SPECIAL[wd.category].title}:</b> ${WEAPON_SPECIAL[wd.category].text}`);
      }
    } else if (d.ranged) {
      const r = d.ranged;
      line('arrow', t('Arrow damage {dmg}', { dmg: `${Math.round(r.dmg * k)}${r.shots ? ` × ${r.shots}` : ''}` }));
      line('e-clock', t('A shot every {s} s', { s: r.cd.toFixed(2).replace('.', ',') }));
      line('e-arrow', t('Range {m} m', { m: r.range }));
    } else if (d.armor) {
      line('heart', t('+{n} health', { n: armorHealth({ uid: '', def: d.id, power: pw, enchants: [] }) }));
      for (const p of d.armor.perks) line('e-star', PERK_TEXT[p.kind](p.value));
    } else if (d.artifact) {
      const a = d.artifact;
      if (a.info) line(d.icon, a.info.replace('{v}', String(Math.round(a.power * k))).replace('{r}', String(a.radius ?? '')).replace('{d}', String(a.duration ?? '')));
      if (a.radius) line('e-arrow', t('Radius {r} m', { r: a.radius }));
      if (a.souls) line('soul', t('Spends {n} souls', { n: a.souls }));
      line('e-clock', t('Cooldown {s} s', { s: a.cd }));
    } else if (d.aura) {
      for (const [icon, text] of auraLines(d.aura, k, d.icon)) line(icon, text);
    }
    const cmp = this.compare(d);
    if (cmp) line(cmp > 0 ? 'e-star' : 'e-fist', cmp > 0 ? `<b class="up">${t('▲ stronger than the equipped')}</b>` : `<b class="down">${t('▼ weaker than the equipped')}</b>`);
    const have = D.items.filter((i) => i.def === d.id).length;
    return `<div class="d-head"><span class="d-pw">${pw}${iconImg(SLOT_ICON[d.slot], '', '#fff')}</span><span class="d-rar" style="--c:${R.color}">${R.title}</span>${have ? `<span class="d-on">${t('In the inventory: {n}', { n: have })}</span>` : ''}</div>
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
      side += `<div class="trade-got"><h3>${t('Purchase')}</h3>${this.tile(this.bought, 'big got')}
        <div class="d-head"><span class="d-pw">${this.bought.power}${iconImg(SLOT_ICON[d.slot], '', '#fff')}</span><span class="d-rar" style="--c:${R.color}">${R.title}</span></div>
        <h2 class="d-title">${d.title}</h2>
        <div class="d-btns"><button class="ok" data-act="equip">${t('Equip')} <kbd>Enter</kbd></button><button data-act="keep">${t('To inventory')}</button></div></div>`;
    } else side += `<div class="trade-detail">${this.detail(sel)}</div>`;
    if (this.kind === 'smith') {
      const rows = (['melee', 'armor', 'ranged'] as const).map((s) => P.equipped(s)).filter((x): x is Item => !!x).map((it) => {
        const price = PRICE.reforge(it.power), d = itemDef(it.def);
        return `<div class="trade-forge">${this.tile(it)}<div><b>${d.title}</b><span>${t('Power {from} → <em>{to}</em>', { from: it.power, to: it.power + 1 })}</span></div>
          <button data-act="forge:${it.uid}"${D.berries < price ? ' disabled' : ''}>${iconImg('berry')}${price}</button></div>`;
      }).join('');
      side += `<div class="trade-forgebox"><h3>${t('Reforge the equipped')}</h3>${rows}</div>`;
    }

    this.el.innerHTML = `
      <div class="inv-top"><span title="${t('Raspberries')}">${iconImg('berry')}<b>${D.berries}</b></span><span title="${t('Enchantment points')}">${iconImg('spiral')}<b>${D.points}</b></span></div>
      <button class="inv-x" data-act="close" title="${t('Close (Esc)')}">✕</button>
      <div class="trade-head"><h1>${MERCHANT_TITLE[this.kind]}</h1><p>${DESC[this.kind]}</p></div>
      <div class="trade-body">
        <section class="trade-shelf">
          <div class="inv-tablabel">${TAB[this.tab].title}</div>
          <div class="inv-tabs"><kbd data-act="tabPrev">Q</kbd>${tabs}<kbd data-act="tabNext">E</kbd></div>
          <div class="inv-gridwrap"><div class="trade-grid" style="--cols:${COLS}">${this.wares.map((w) => this.wareTile(w)).join('')}</div></div>
        </section>
        <section class="trade-side">${side}</section>
      </div>
      <div class="inv-actions"><button data-act="close">${t('Back')} <kbd>Esc</kbd></button><span class="inv-hint">${t('Q / E — tabs · arrows — select · Enter or double click — buy')}${this.bought ? ` · ${t('Enter — equip the purchase')}` : ''}</span></div>`;
  }
}
