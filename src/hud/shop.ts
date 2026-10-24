import { iconImg, iconURL } from '../icons';
import { itemDef, PRICE, RARITY, SHOP_SPELLS, type Item, type ItemSlot, type Profile } from '../items';
import { MERCHANT_TITLE, type MerchantKind } from '../merchants';
import { rng } from '../textures';
import './shop.css';

/**
 * Окно торговли как у торговцев Minecraft Dungeons (wiki/design-inventory.md, «Торговцы»): слева предложения
 * карточками (у торговца четвёртое — обычное заклинание, wiki/design-spells.md) — что продают и почём, справа — купленное (надеть сразу или оставить в инвентаре), у кузнеца ещё
 * перековка надетого (+1 к силе). Случайный товар — «?» до покупки, особый товар торговца виден заранее.
 * Клавиши: 1 / 2 / 3 / 4 — купить, Enter — надеть купленное, Esc — закрыть. Игра на паузе.
 */

interface Offer { id: string; title: string; icon: string; price: number; slots?: ItemSlot[]; arrows?: number; item?: { def: string; power: number } }

const DESC: Record<MerchantKind, string> = {
  smith: 'Выкует случайное оружие или броню по твоей силе и перекуёт надетое — +1 к силе за малину.',
  merchant: 'Продаёт артефакты наугад, стрелы связками, особый товар, который видно заранее, и обычные заклинания.',
};
const SLOT_ICON: Record<ItemSlot, string> = { melee: 'sword', ranged: 'bow', armor: 'helmet', artifact: 'flask', aura: 'a-bastion' };

export class Shop {
  readonly el: HTMLDivElement;
  private kind: MerchantKind = 'smith';
  private offers: Offer[] = [];
  /** Особый товар торговца (меняется после покупки) */
  private special: { def: string; power: number } | null = null;
  /** Заклинание на прилавке торговца: сначала то, которого у героя ещё нет; меняется после покупки */
  private spell: string | null = null;
  private bought: Item | null = null;
  private readonly rand = rng(Date.now() % 100000 || 7);
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
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!t) return;
      const a = t.dataset.act ?? '';
      if (a === 'close') this.hide();
      else if (a.startsWith('buy')) this.buy(Number(a.slice(3)));
      else if (a === 'equip') this.equipBought();
      else if (a === 'keep') { this.bought = null; this.render(); }
      else if (a.startsWith('forge:')) this.reforge(a.slice(6));
    });
  }

  get open(): boolean { return this.el.classList.contains('open'); }
  get current(): MerchantKind { return this.kind; }

  show(kind: MerchantKind): void {
    this.kind = kind;
    this.bought = null;
    this.el.classList.add('open');
    this.render();
  }

  hide(): void { if (!this.open) return; this.el.classList.remove('open'); this.onClose?.(); }

  key(e: KeyboardEvent): boolean {
    if (!this.open) return false;
    if (e.code === 'Escape' || e.code === 'KeyF') this.hide();
    else if (/^Digit[1234]$/.test(e.code)) this.buy(Number(e.code.slice(5)) - 1);
    else if (e.code === 'Enter') this.equipBought();
    else return false;
    return true;
  }

  private makeOffers(): Offer[] {
    const pw = this.profile.power;
    if (this.kind === 'smith') return [
      { id: 'melee', title: 'Оружие ближнего боя', icon: 'sword', price: PRICE.gear(pw), slots: ['melee'] },
      { id: 'ranged', title: 'Оружие дальнего боя', icon: 'bow', price: PRICE.gear(pw), slots: ['ranged'] },
      { id: 'armor', title: 'Броня', icon: 'helmet', price: PRICE.gear(pw), slots: ['armor'] },
    ];
    this.special ??= this.profile.rollLoot(this.rand);
    this.spell ??= this.pickSpell();
    return [
      { id: 'artifact', title: 'Артефакт', icon: 'flask', price: PRICE.artifact(pw), slots: ['artifact'] },
      { id: 'arrows', title: 'Связка стрел', icon: 'arrows', price: PRICE.arrows, arrows: 24 },
      { id: 'special', title: 'Особый товар', icon: itemDef(this.special.def).icon, price: PRICE.offer(this.special), item: this.special },
      { id: 'spell', title: 'Заклинание', icon: itemDef(this.spell).icon, price: PRICE.spell(pw), item: { def: this.spell, power: pw } },
    ];
  }

  /** Обычное заклинание на прилавок: из тех, которых у героя нет, иначе любое */
  private pickSpell(): string {
    const all = SHOP_SPELLS(), have = new Set(this.profile.data.items.map((i) => i.def));
    const fresh = all.filter((d) => !have.has(d) && d !== this.spell);
    const pool = fresh.length ? fresh : all.filter((d) => d !== this.spell);
    return pool[Math.floor(this.rand() * pool.length)] ?? all[0];
  }

  /** Купить предложение i: false — не хватает малины */
  buy(i: number): boolean {
    const o = this.offers[i];
    if (!o) return false;
    if (!this.profile.pay(o.price)) { this.onSound?.(false); this.flash(i); return false; }
    if (o.arrows) { this.profile.addArrows(o.arrows); this.bought = null; }
    else {
      const got = o.item ?? this.profile.rollLoot(this.rand, o.slots);
      this.bought = this.profile.add(got.def, got.power);
      this.profile.save();
      if (o.id === 'special') this.special = null;
      if (o.id === 'spell') this.spell = this.pickSpell();
    }
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

  private flash(i: number): void {
    const c = this.el.querySelectorAll('.trade-card')[i];
    c?.classList.remove('poor'); void (c as HTMLElement | undefined)?.offsetWidth; c?.classList.add('poor');
  }

  private tile(it: { def: string; power: number }, cls = ''): string {
    const d = itemDef(it.def);
    return `<div class="it r-${d.rarity} ${cls}"><img class="px it-ico" src="${iconURL(d.icon)}" alt=""><span class="it-pw">${iconImg(SLOT_ICON[d.slot], '', '#fff')}${it.power}</span></div>`;
  }

  render(): void {
    const P = this.profile, D = P.data;
    this.offers = this.makeOffers();
    const cards = this.offers.map((o, i) => {
      const poor = D.berries < o.price;
      const face = o.item
        ? this.tile(o.item, 'big')
        : `<div class="it r-${o.id === 'arrows' ? 'common' : 'rare'} big trade-mystery"><img class="px it-ico" src="${iconURL(o.icon)}" alt="">${o.arrows ? `<span class="it-pw">×${o.arrows}</span>` : '<b>?</b>'}</div>`;
      const sub = o.item ? `<small style="color:${RARITY[itemDef(o.item.def).rarity].color}">${itemDef(o.item.def).title}</small>` : `<small>${o.arrows ? 'Сразу в колчан' : `Сила около ${P.power}`}</small>`;
      return `<div class="trade-card${poor ? ' dim' : ''}">
        <h3>${o.title}</h3>${sub}${face}
        <div class="trade-price">${iconImg('berry')}<b>${o.price}</b></div>
        <button data-act="buy${i}"${poor ? ' disabled' : ''}>Купить <kbd>${i + 1}</kbd></button>
      </div>`;
    }).join('');

    let side = '';
    if (this.bought) {
      const d = itemDef(this.bought.def), R = RARITY[d.rarity];
      side += `<div class="trade-got"><h3>Покупка</h3>${this.tile(this.bought, 'big got')}
        <div class="d-head"><span class="d-pw">${this.bought.power}${iconImg(SLOT_ICON[d.slot], '', '#fff')}</span><span class="d-rar" style="--c:${R.color}">${R.title}</span></div>
        <h2 class="d-title">${d.title}</h2>
        <div class="d-btns"><button class="ok" data-act="equip">Надеть <kbd>Enter</kbd></button><button data-act="keep">В инвентарь</button></div></div>`;
    }
    if (this.kind === 'smith') {
      const rows = (['melee', 'armor', 'ranged'] as const).map((s) => P.equipped(s)).filter((x): x is Item => !!x).map((it) => {
        const price = PRICE.reforge(it.power), d = itemDef(it.def);
        return `<div class="trade-forge">${this.tile(it)}<div><b>${d.title}</b><span>Сила ${it.power} → <em>${it.power + 1}</em></span></div>
          <button data-act="forge:${it.uid}"${D.berries < price ? ' disabled' : ''}>${iconImg('berry')}${price}</button></div>`;
      }).join('');
      side += `<div class="trade-forgebox"><h3>Перековка надетого</h3>${rows}</div>`;
    } else if (!this.bought) {
      side += `<div class="trade-tip">Особый товар и заклинание меняются после покупки. Обычные заклинания продаёт только торговец, редкие и сильнее — падают с боссов. Стрел в колчане: <b>${D.arrows}</b></div>`;
    }

    this.el.innerHTML = `
      <div class="inv-top"><span title="Малина">${iconImg('berry')}<b>${D.berries}</b></span><span title="Очки зачарования">${iconImg('spiral')}<b>${D.points}</b></span></div>
      <button class="inv-x" data-act="close" title="Закрыть (Esc)">✕</button>
      <div class="trade-head"><h1>${MERCHANT_TITLE[this.kind]}</h1><p>${DESC[this.kind]}</p></div>
      <div class="trade-body"><section class="trade-offers" style="--n:${this.offers.length}">${cards}</section><section class="trade-side">${side}</section></div>
      <div class="inv-actions"><button data-act="close">Назад <kbd>Esc</kbd></button><span class="inv-hint">${this.offers.map((_, i) => i + 1).join(' / ')} — купить · Enter — надеть покупку</span></div>`;
  }
}
