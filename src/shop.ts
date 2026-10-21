import { WEAPONS, AMMO, AMMO_TYPES, MAX_LEVEL, levelMul, upgradeCost, gunPreview, type AmmoType, type WeaponDef, type WeaponId } from './weapons';

export interface ShopHooks {
  berries(): number;
  /** Уровень ствола, 0 — не куплен */
  level(id: WeaponId): number;
  equipped(): WeaponId;
  ammo(t: AmmoType): number;
  buy(id: WeaponId): boolean;
  upgrade(id: WeaponId): boolean;
  buyAmmo(t: AmmoType): boolean;
  equip(id: WeaponId): void;
  close(): void;
}

/** Номер клавиши для ствола: 1…8 */
export const weaponKey = (i: number): string => String(i + 1);

const dps = (w: WeaponDef) => w.dmg * w.pellets * w.rate + (w.explode ? w.explode.dmg * w.rate : 0);
const MAX = { dps: 50, rate: 20, range: 18 };

function bar(label: string, k: number): string {
  const pct = Math.round(Math.min(1, Math.max(0.05, k)) * 100);
  return `<div class="st"><span>${label}</span><i><b style="width:${pct}%"></b></i></div>`;
}
const css = (rgb: readonly number[]) => `rgb(${rgb.map((v) => Math.round(Math.min(255, (v / 3.6) * 255))).join(',')})`;

/** Окно лавки оружия */
export class ShopUI {
  private readonly list: HTMLElement;
  private readonly ammoRow: HTMLElement;
  private readonly wallet: HTMLElement;

  constructor(private readonly root: HTMLElement, private readonly hooks: ShopHooks) {
    root.innerHTML = `
      <div class="card shop-card" role="dialog" aria-label="Лавка оружия">
        <div class="shop-head">
          <div>
            <h2>Лавка оружия</h2>
            <p class="shop-sub">Плата — малиной. Улучшение: +20% урона и короче перезарядка мода. Стволы меняй клавишами 1–8.</p>
          </div>
          <div class="shop-wallet"><span class="ic ic-berry"></span><b id="shopAmmo">0</b></div>
        </div>
        <div class="ammo-row" id="ammoRow"></div>
        <div class="shop-list" id="shopList"></div>
        <div class="shop-foot"><button class="btn" id="shopClose">ЗАКРЫТЬ <small>E / Esc</small></button></div>
      </div>`;
    this.list = root.querySelector<HTMLElement>('#shopList')!;
    this.ammoRow = root.querySelector<HTMLElement>('#ammoRow')!;
    this.wallet = root.querySelector<HTMLElement>('#shopAmmo')!;
    root.querySelector<HTMLElement>('#shopClose')!.addEventListener('click', () => hooks.close());
    root.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      if (!btn) return;
      const id = btn.dataset.id!;
      let ok = true;
      switch (btn.dataset.act) {
        case 'buy': ok = this.hooks.buy(id as WeaponId); break;
        case 'up': ok = this.hooks.upgrade(id as WeaponId); break;
        case 'take': this.hooks.equip(id as WeaponId); break;
        case 'ammo': ok = this.hooks.buyAmmo(id as AmmoType); break;
      }
      if (!ok) { btn.classList.remove('nope'); void btn.offsetWidth; btn.classList.add('nope'); return; }
      this.render();
    });
  }

  get isOpen(): boolean { return !this.root.classList.contains('hidden'); }

  open(): void {
    this.render();
    this.root.classList.remove('hidden');
  }

  close(): void { this.root.classList.add('hidden'); }

  render(): void {
    const berries = this.hooks.berries();
    this.wallet.textContent = String(berries);
    this.ammoRow.innerHTML = AMMO_TYPES.map((t) => {
      const a = AMMO[t], have = Math.floor(this.hooks.ammo(t)), full = have >= a.max;
      return `<div class="ammo-cell">
        <span class="ic ic-${t}"></span>
        <div><b>${a.name}</b><small>${have} / ${a.max}</small></div>
        <button class="buy${berries < a.packPrice || full ? ' poor' : ''}" data-act="ammo" data-id="${t}" ${full ? 'disabled' : ''}>+${a.pack} · <span class="ic ic-berry"></span>${a.packPrice}</button>
      </div>`;
    }).join('');
    const eq = this.hooks.equipped();
    this.list.innerHTML = WEAPONS.map((w, i) => this.item(w, i, this.hooks.level(w.id), eq === w.id, berries)).join('');
  }

  private item(w: WeaponDef, i: number, lvl: number, inHand: boolean, berries: number): string {
    const has = lvl > 0;
    const mul = levelMul(Math.max(1, lvl));
    const buttons: string[] = [];
    if (!has) {
      buttons.push(`<button class="buy${berries < w.price ? ' poor' : ''}" data-act="buy" data-id="${w.id}"><span class="ic ic-berry"></span>${w.price}</button>`);
    } else {
      buttons.push(inHand ? '<button class="buy on" disabled>В руках</button>' : `<button class="buy own" data-act="take" data-id="${w.id}">Взять</button>`);
      if (lvl < MAX_LEVEL) {
        const cost = upgradeCost(w, lvl);
        buttons.push(`<button class="buy up${berries < cost ? ' poor' : ''}" data-act="up" data-id="${w.id}">★ <span class="ic ic-berry"></span>${cost}</button>`);
      } else buttons.push('<button class="buy on" disabled>★ макс</button>');
    }
    const stars = has ? `<span class="stars">${'★'.repeat(lvl)}<em>${'☆'.repeat(MAX_LEVEL - lvl)}</em></span>` : '';
    return `
      <div class="item${inHand ? ' equipped' : ''}${has ? ' owned' : ''}" style="--wg:${css(w.glow)}" title="${w.perk}">
        <div class="item-pv">
          <img src="${gunPreview(w, Math.max(1, lvl))}" alt="${w.name}" />
          <kbd>${weaponKey(i)}</kbd>
        </div>
        <div class="item-body">
          <div class="item-name">${w.name} ${stars}</div>
          <div class="stats">
            ${bar('Урон', (dps(w) * mul) / MAX.dps)}
            ${bar('Темп', w.rate / MAX.rate)}
            ${bar('Дальн.', w.range / MAX.range)}
          </div>
          <div class="sp"><span class="am"><span class="ic ic-${w.ammo}"></span>${AMMO[w.ammo].name}${w.ammoPerShot > 1 ? ` ×${w.ammoPerShot}` : ''}</span> · <b>Q: ${w.mod.name}</b></div>
        </div>
        <div class="item-btns">${buttons.join('')}</div>
      </div>`;
  }
}
