import * as THREE from 'three';
import { iconImg, iconURL } from '../icons';
import {
  armorHealth, enchantDef, itemDef, PERK_TEXT, powerMult, RARITY, salvageValue, SLOT_TITLE, spentPoints, xpToNext,
  type EnchantDef, type Item, type ItemSlot, type Profile,
} from '../items';
import { emptyInput, Knight } from '../knight';
import { rng, type Textures } from '../textures';
import { DEFAULT_WEAPONS, getWeapon, weaponMetrics } from '../weapons';
import './inventory.css';

/**
 * Инвентарь как в Minecraft Dungeons (wiki/design-inventory.md), под ПК: слева герой в 3D с надетым —
 * ближнее оружие, броня, дальнее, три артефакта, уровень и сила; в центре вкладки и сетка предметов 3 в ряд;
 * справа карточка — сила, редкость, название, свойства, описание, полосы оружия и гнёзда зачарований.
 * Мышь: клик — выбрать, двойной клик или ПКМ — надеть, перетащить на гнездо — надеть туда.
 * Клавиши: I / Esc — закрыть, Q / E — вкладки, стрелки — по сетке, Enter — надеть, X — разобрать.
 */

type Tab = 'all' | ItemSlot | 'enchanted';
const TABS: { id: Tab; title: string; icon: string }[] = [
  { id: 'all', title: 'Все', icon: 'grid' },
  { id: 'melee', title: 'Ближний бой', icon: 'sword' },
  { id: 'ranged', title: 'Дальний бой', icon: 'bow' },
  { id: 'armor', title: 'Броня', icon: 'helmet' },
  { id: 'artifact', title: 'Артефакты', icon: 'flask' },
  { id: 'enchanted', title: 'Зачарованные', icon: 'spiral' },
];
/** Значок силы по виду предмета */
const SLOT_ICON: Record<ItemSlot, string> = { melee: 'sword', ranged: 'bow', armor: 'helmet', artifact: 'flask' };
const ROMAN = ['', 'I', 'II', 'III'];
const SLOT_ORDER: Record<ItemSlot, number> = { melee: 0, armor: 1, ranged: 2, artifact: 3 };
const fmt = (v: number, d = 1): string => (Math.round(v * 10 ** d) / 10 ** d).toString().replace('.', ',');

/** Полосы оружия: максимум по стандартному оружию */
const METRIC_MAX = (() => {
  const ms = DEFAULT_WEAPONS.map((w) => weaponMetrics(w));
  return { dps: Math.max(...ms.map((m) => m.dps)), speed: Math.max(...ms.map((m) => 1 / m.comboTime)), area: Math.max(...ms.map((m) => m.coverage)) };
})();

export class Inventory {
  readonly el: HTMLDivElement;
  private tab: Tab = 'all';
  private sel: string | null = null;
  /** Открытое гнездо зачарования и выбранный в нём вариант */
  private enchSlot = -1;
  private enchOpt = -1;
  private confirm = false;
  private gridHtml = '';
  private preview: Preview | null = null;
  onClose?: () => void;
  onChange?: () => void;

  constructor(parent: HTMLElement, private readonly profile: Profile, private readonly T: Textures) {
    const el = document.createElement('div');
    el.className = 'inv';
    el.innerHTML = `
      <div class="inv-bg"></div>
      <div class="inv-top">
        <span title="Малина">${iconImg('berry')}<b data-id="berries"></b></span>
        <span title="Очки зачарования">${iconImg('spiral')}<b data-id="points"></b></span>
      </div>
      <button class="inv-x" data-act="close" title="Закрыть (I, Esc)">✕</button>
      <section class="inv-hero">
        <canvas class="inv-model"></canvas>
        <div class="inv-eq" data-eq="melee" style="left:2%;top:13%"></div>
        <div class="inv-eq" data-eq="armor" style="left:37%;top:4%"></div>
        <div class="inv-eq" data-eq="ranged" style="left:72%;top:13%"></div>
        <div class="inv-level" title="Уровень героя: опыт до следующего">
          <svg viewBox="0 0 100 100"><polygon class="ring-bg" points="50,4 90,27 90,73 50,96 10,73 10,27"/><polygon class="ring" data-id="ring" points="50,4 90,27 90,73 50,96 10,73 10,27"/></svg>
          ${iconImg('spiral', 'inv-level-ico')}<span>Уровень</span><b data-id="level"></b>
        </div>
        <div class="inv-power" title="Сила: среднее надетого"><div class="inv-power-ico">${iconImg('power')}</div><div><span>Сила</span><b data-id="power"></b></div></div>
        <div class="inv-eq art" data-eq="art0" style="left:8%;bottom:2%"></div>
        <div class="inv-eq art" data-eq="art1" style="left:37%;bottom:2%"></div>
        <div class="inv-eq art" data-eq="art2" style="left:66%;bottom:2%"></div>
      </section>
      <section class="inv-mid">
        <div class="inv-tablabel" data-id="tabLabel"></div>
        <div class="inv-tabs"><kbd data-act="tabPrev">Q</kbd>${TABS.map((t) => `<button class="inv-tab" data-tab="${t.id}" title="${t.title}">${iconImg(t.icon, '', '#e8e4ef')}</button>`).join('')}<kbd data-act="tabNext">E</kbd></div>
        <div class="inv-gridwrap"><div class="inv-grid" data-id="grid"></div></div>
      </section>
      <section class="inv-detail" data-id="detail"></section>
      <footer class="inv-actions">
        <button data-act="close">Назад <kbd>Esc</kbd></button>
        <button data-act="equip">Надеть <kbd>Enter</kbd></button>
        <button data-act="salvage">Разобрать <kbd>X</kbd></button>
        <span class="inv-hint">ЛКМ — выбрать · двойной клик или ПКМ — надеть · перетащи на гнездо</span>
      </footer>`;
    parent.appendChild(el);
    this.el = el;
    // фон из крупных «пикселей» разной яркости, как в MCD
    const noise = document.createElement('canvas');
    noise.width = 40; noise.height = 24;
    const g = noise.getContext('2d');
    if (g) {
      const r = rng(5);
      for (let y = 0; y < noise.height; y++) for (let x = 0; x < noise.width; x++) {
        g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${(r() * 0.3).toFixed(2)})` : `rgba(255,255,255,${(r() * 0.05).toFixed(2)})`;
        g.fillRect(x, y, 1, 1);
      }
      (el.querySelector('.inv-bg') as HTMLElement).style.backgroundImage = `url(${noise.toDataURL()})`;
    }
    this.bind();
  }

  get open(): boolean { return this.el.classList.contains('open'); }

  show(): void {
    if (this.open) return;
    this.el.classList.add('open');
    this.enchSlot = -1; this.confirm = false;
    if (!this.sel || !this.profile.get(this.sel)) this.sel = this.profile.data.equip.melee;
    this.preview ??= new Preview(this.el.querySelector('canvas') as HTMLCanvasElement, this.T);
    this.preview.start();
    this.render();
  }

  hide(): void {
    if (!this.open) return;
    this.el.classList.remove('open');
    this.preview?.stop();
    this.onClose?.();
  }

  toggle(): void { if (this.open) this.hide(); else this.show(); }

  /** Отфильтрованные предметы вкладки: сначала надетые, потом по виду и силе */
  list(): Item[] {
    const p = this.profile;
    return p.data.items.filter((it) => {
      const d = itemDef(it.def);
      if (this.tab === 'all') return true;
      if (this.tab === 'enchanted') return spentPoints(it) > 0;
      return d.slot === this.tab;
    }).sort((a, b) => Number(p.isEquipped(b.uid)) - Number(p.isEquipped(a.uid))
      || SLOT_ORDER[itemDef(a.def).slot] - SLOT_ORDER[itemDef(b.def).slot] || b.power - a.power || a.uid.localeCompare(b.uid));
  }

  select(uid: string | null): void {
    if (uid !== this.sel) { this.enchSlot = -1; this.enchOpt = -1; this.confirm = false; }
    this.sel = uid;
    const it = this.profile.get(uid);
    if (it?.isNew) { it.isNew = false; this.profile.save(); }
    this.render();
  }

  setTab(t: Tab): void { this.tab = t; this.render(); }

  equipSelected(at?: number): void {
    if (!this.sel) return;
    this.profile.equip(this.sel, at);
    this.onChange?.();
    this.render();
  }

  /** Разобрать выбранное (после подтверждения) */
  salvageSelected(): void {
    if (!this.sel) return;
    const list = this.list(), i = list.findIndex((x) => x.uid === this.sel);
    if (!this.profile.salvage(this.sel)) return;
    const rest = this.list();
    this.sel = rest[Math.min(i, rest.length - 1)]?.uid ?? null;
    this.confirm = false;
    this.onChange?.();
    this.render();
  }

  /** Клавиши, пока инвентарь открыт; true — съедено */
  key(e: KeyboardEvent): boolean {
    if (!this.open) return false;
    const list = this.list(), i = list.findIndex((x) => x.uid === this.sel);
    const move = (d: number): void => { const n = list[Math.max(0, Math.min(list.length - 1, (i < 0 ? 0 : i) + d))]; if (n) this.select(n.uid); this.scrollToSel(); };
    switch (e.code) {
      case 'Escape': if (this.confirm) { this.confirm = false; this.render(); } else if (this.enchSlot >= 0) { this.enchSlot = -1; this.render(); } else this.hide(); break;
      case 'KeyI': this.hide(); break;
      case 'KeyQ': this.setTab(TABS[(TABS.findIndex((t) => t.id === this.tab) + TABS.length - 1) % TABS.length].id); break;
      case 'KeyE': this.setTab(TABS[(TABS.findIndex((t) => t.id === this.tab) + 1) % TABS.length].id); break;
      case 'ArrowRight': move(1); break;
      case 'ArrowLeft': move(-1); break;
      case 'ArrowDown': move(3); break;
      case 'ArrowUp': move(-3); break;
      case 'Enter': if (this.confirm) this.salvageSelected(); else this.equipSelected(); break;
      case 'KeyX': this.askSalvage(); break;
      default: return false;
    }
    return true;
  }

  private askSalvage(): void {
    if (!this.sel || this.profile.isEquipped(this.sel)) return;
    this.confirm = true;
    this.enchSlot = -1;
    this.render();
  }

  private scrollToSel(): void {
    this.el.querySelector('.inv-grid .it.sel')?.scrollIntoView({ block: 'nearest' });
  }

  private bind(): void {
    const el = this.el;
    // клики внутри инвентаря не доходят до сцены
    for (const ev of ['mousedown', 'mouseup', 'wheel', 'contextmenu'] as const) el.addEventListener(ev, (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
      const tab = t.closest<HTMLElement>('[data-tab]')?.dataset.tab as Tab | undefined;
      const uid = t.closest<HTMLElement>('[data-uid]')?.dataset.uid;
      const eq = t.closest<HTMLElement>('[data-eq]')?.dataset.eq;
      const slot = t.closest<HTMLElement>('[data-slot]')?.dataset.slot;
      const opt = t.closest<HTMLElement>('[data-opt]')?.dataset.opt;
      if (act === 'close') this.hide();
      else if (act === 'tabPrev') this.key(new KeyboardEvent('keydown', { code: 'KeyQ' }));
      else if (act === 'tabNext') this.key(new KeyboardEvent('keydown', { code: 'KeyE' }));
      else if (act === 'equip') this.equipSelected();
      else if (act === 'salvage') this.askSalvage();
      else if (act === 'salvageOk') this.salvageSelected();
      else if (act === 'salvageNo') { this.confirm = false; this.render(); }
      else if (act === 'unequip') { const i = this.profile.data.equip.artifacts.indexOf(this.sel); if (i >= 0) { this.profile.unequipArtifact(i); this.onChange?.(); this.render(); } }
      else if (act === 'enchant' && this.sel) { if (this.profile.enchant(this.sel, this.enchSlot, this.enchOpt)) { this.onChange?.(); this.flash(); } this.render(); }
      else if (act === 'enchBack') { this.enchSlot = -1; this.render(); }
      else if (opt !== undefined) { this.enchOpt = Number(opt); this.render(); }
      else if (slot !== undefined) { this.openSlot(Number(slot)); }
      else if (tab) this.setTab(tab);
      else if (uid) this.select(uid);
      else if (eq) { const u = this.eqUid(eq); if (u) this.select(u); }
    });
    el.addEventListener('dblclick', (e) => {
      const uid = (e.target as HTMLElement).closest<HTMLElement>('.inv-grid [data-uid]')?.dataset.uid;
      if (uid) { this.select(uid); this.equipSelected(); }
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const uid = (e.target as HTMLElement).closest<HTMLElement>('.inv-grid [data-uid]')?.dataset.uid;
      if (uid) { this.select(uid); this.equipSelected(); }
    });
    // перетаскивание: из сетки на гнездо героя
    el.addEventListener('dragstart', (e) => {
      const uid = (e.target as HTMLElement).closest<HTMLElement>('[data-uid]')?.dataset.uid;
      if (!uid || !e.dataTransfer) return;
      e.dataTransfer.setData('text/plain', uid);
      e.dataTransfer.effectAllowed = 'move';
      this.select(uid);
      const slot = itemDef(this.profile.get(uid)?.def ?? 'sword').slot;
      el.querySelectorAll<HTMLElement>('[data-eq]').forEach((x) => x.classList.toggle('drop', eqSlot(x.dataset.eq ?? '') === slot));
    });
    el.addEventListener('dragend', () => el.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop')));
    el.addEventListener('dragover', (e) => { if ((e.target as HTMLElement).closest('.drop')) e.preventDefault(); });
    el.addEventListener('drop', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('.drop');
      const uid = e.dataTransfer?.getData('text/plain');
      if (!target || !uid) return;
      e.preventDefault();
      const eq = target.dataset.eq ?? '';
      this.sel = uid;
      this.equipSelected(eq.startsWith('art') ? Number(eq.slice(3)) : undefined);
    });
  }

  private eqUid(eq: string): string | null {
    const e = this.profile.data.equip;
    return eq.startsWith('art') ? e.artifacts[Number(eq.slice(3))] : e[eq as 'melee' | 'ranged' | 'armor'];
  }

  private openSlot(i: number): void {
    const it = this.profile.get(this.sel);
    if (!it || !it.enchants[i]) return;
    this.enchSlot = i;
    this.enchOpt = Math.max(0, it.enchants[i].chosen);
    this.confirm = false;
    this.render();
  }

  private flash(): void {
    const d = this.el.querySelector('.inv-detail');
    d?.classList.remove('flash'); void (d as HTMLElement | null)?.offsetWidth; d?.classList.add('flash');
  }

  // ---------- отрисовка ----------

  private tile(it: Item, cls = ''): string {
    const d = itemDef(it.def), p = this.profile;
    const spent = spentPoints(it);
    let cmp = '';
    if (!p.isEquipped(it.uid) && d.slot !== 'artifact') {
      const cur = p.equipped(d.slot);
      if (cur && it.power > cur.power) cmp = '<i class="it-cmp up"></i>';
      else if (cur && it.power < cur.power) cmp = '<i class="it-cmp down"></i>';
    }
    return `<div class="it r-${d.rarity}${spent ? ' ench' : ''}${p.isEquipped(it.uid) ? ' on' : ''} ${cls}" data-uid="${it.uid}" draggable="true" title="${d.title}">
      <img class="px it-ico" src="${iconURL(d.icon)}" alt="" draggable="false">
      <span class="it-pw">${iconImg(SLOT_ICON[d.slot], '', '#fff')}${it.power}</span>
      ${spent ? `<span class="it-sp">${iconImg('spiral')}${spent}</span>` : ''}${cmp}${it.isNew ? '<i class="it-new"></i>' : ''}
    </div>`;
  }

  render(): void {
    const p = this.profile, D = p.data, q = (id: string): HTMLElement => this.el.querySelector(`[data-id="${id}"]`) as HTMLElement;
    q('berries').textContent = String(D.berries);
    q('points').textContent = String(D.points);
    q('level').textContent = String(D.level);
    q('power').textContent = String(p.power);
    // кольцо опыта вокруг шестиугольника уровня
    const ring = q('ring') as unknown as SVGPolygonElement;
    const per = 6 * 46;
    ring.style.strokeDasharray = `${per * (D.xp / xpToNext(D.level))} ${per}`;
    q('tabLabel').textContent = TABS.find((t) => t.id === this.tab)?.title ?? '';
    this.el.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));

    // надетое
    this.el.querySelectorAll<HTMLElement>('[data-eq]').forEach((slot) => {
      const it = p.get(this.eqUid(slot.dataset.eq ?? ''));
      const kind = eqSlot(slot.dataset.eq ?? '');
      slot.innerHTML = it ? this.tile(it, 'big') : `<div class="it empty big">${iconImg(SLOT_ICON[kind], 'it-ghost', '#55515e')}</div>`;
      slot.title = it ? itemDef(it.def).title : SLOT_TITLE[kind];
    });

    // сетка: пустые клетки до полного ряда и минимум 12, как в MCD
    const list = this.list();
    const cells = Math.max(12, Math.ceil(list.length / 3) * 3);
    // сетку перестраиваем, только если поменялось содержимое: иначе первый клик двойного заменил бы плитку
    const html = list.map((it) => this.tile(it)).join('') + '<div class="it empty"></div>'.repeat(cells - list.length);
    if (html !== this.gridHtml) { this.gridHtml = html; q('grid').innerHTML = html; }
    this.el.querySelectorAll<HTMLElement>('.it[data-uid]').forEach((t) => t.classList.toggle('sel', t.dataset.uid === this.sel));

    q('detail').innerHTML = this.detail();
    this.el.querySelector<HTMLButtonElement>('[data-act="salvage"]')!.disabled = !this.sel || p.isEquipped(this.sel);
    this.el.querySelector<HTMLButtonElement>('[data-act="equip"]')!.disabled = !this.sel || (p.isEquipped(this.sel) && itemDef(p.get(this.sel)?.def ?? 'sword').slot !== 'artifact');
    this.preview?.dress(p);
  }

  private detail(): string {
    const p = this.profile, it = p.get(this.sel);
    if (!it) return '<div class="d-empty">Выбери предмет</div>';
    const d = itemDef(it.def), R = RARITY[d.rarity];
    const lines: string[] = [];
    const line = (icon: string, text: string): void => { lines.push(`<li>${iconImg(icon, '', '#d8d4e0')}<span>${text}</span></li>`); };
    let bars = '';
    const k = powerMult(it.power);
    if (d.slot === 'melee') {
      const w = getWeapon(d.weapon ?? '');
      if (w) {
        const sharp = 1 + enchantSum(it, 'sharpness') / 100;
        const dm = w.stats.swings.map((s) => Math.round(s.dmg * k * sharp));
        line('sword', `Урон ${Math.min(...dm)}–${Math.max(...dm)} за удар`);
        for (const t of d.traits ?? []) line('e-star', t);
        const m = weaponMetrics(w);
        const cur = p.equipped('melee'), cm = cur && cur.uid !== it.uid ? weaponMetrics(getWeapon(itemDef(cur.def).weapon ?? '') ?? w) : null;
        const bar = (name: string, v: number, c: number | null): string =>
          `<div class="d-bar"><span>${name}</span><div><i style="width:${Math.min(100, v * 100)}%"></i>${c !== null ? `<u style="left:${Math.min(100, c * 100)}%"></u>` : ''}</div></div>`;
        bars = `<div class="d-bars">${bar('Сила', (m.dps * k) / METRIC_MAX.dps / 1.6, cm && cur ? (cm.dps * powerMult(cur.power)) / METRIC_MAX.dps / 1.6 : null)}${bar('Скорость', 1 / m.comboTime / METRIC_MAX.speed, cm ? 1 / cm.comboTime / METRIC_MAX.speed : null)}${bar('Площадь', m.coverage / METRIC_MAX.area, cm ? cm.coverage / METRIC_MAX.area : null)}</div>`;
      }
    } else if (d.ranged) {
      const r = d.ranged;
      line('arrow', `Урон стрелы ${Math.round(r.dmg * k)}${r.shots ? ` × ${r.shots}` : ''}`);
      line('e-clock', `Выстрел каждые ${fmt(r.cd, 2)} с`);
      line('e-arrow', `Дальность ${r.range} м`);
    } else if (d.armor) {
      line('heart', `+${armorHealth(it)} к здоровью`);
      for (const pk of d.armor.perks) line('e-star', PERK_TEXT[pk.kind](pk.value));
    } else if (d.artifact) {
      const a = d.artifact, v = Math.round(a.power * k);
      const what: Record<string, string> = {
        firework: `Взрыв: ${v} урона в радиусе ${a.radius} м`, totem: `Лечит ${v} здоровья в секунду, ${a.duration} с`,
        boots: `Скорость ×${fmt(a.power)} на ${a.duration} с`, horn: `${v} урона и отбрасывание в радиусе ${a.radius} м`,
        lightning: `Молния: ${v} урона трём ближайшим`, harvester: `Взрыв душ: ${v} урона в радиусе ${a.radius} м`,
      };
      line(d.icon, what[a.kind]);
      if (a.souls) line('soul', `Тратит ${a.souls} душ`);
      line('e-clock', `Перезарядка ${fmt(a.cd * p.stats().artifactCdMult)} с`);
    }
    for (const s of it.enchants) if (s.chosen >= 0 && s.tier > 0) { const e = enchantDef(s.options[s.chosen]); line(e.icon, `${e.title} ${ROMAN[s.tier]}: ${e.text(e.tiers[s.tier - 1])}`); }

    const equipped = p.isEquipped(it.uid);
    const head = `<div class="d-head"><span class="d-pw">${it.power}${iconImg(SLOT_ICON[d.slot], '', '#fff')}</span><span class="d-rar" style="--c:${R.color}">${R.title}</span>${equipped ? '<span class="d-on">Надето</span>' : ''}</div>
      <h2 class="d-title">${d.title}</h2>
      <img class="px d-art" src="${iconURL(d.icon)}" alt="">`;

    let body: string;
    if (this.confirm) {
      const pts = spentPoints(it);
      body = `<div class="d-salvage">
        <h3>Выручка за разбор</h3>
        <div class="d-pay">${iconImg('berry')}<b>${salvageValue(it)}</b>${pts ? `${iconImg('spiral')}<b>${pts}</b>` : ''}</div>
        <div class="d-btns"><button data-act="salvageNo">Отмена <kbd>Esc</kbd></button><button class="ok" data-act="salvageOk">Разобрать <kbd>Enter</kbd></button></div>
      </div>`;
    } else if (this.enchSlot >= 0 && it.enchants[this.enchSlot]) {
      body = this.enchantPanel(it);
    } else {
      body = `<ul class="d-stats">${lines.join('')}</ul><p class="d-desc">${d.description}</p>${bars}`;
    }
    const slots = d.slot === 'artifact' ? '' : `<div class="d-enchtitle">Зачарования</div><div class="d-ench">${[0, 1, 2].map((i) => this.slotGem(it, i)).join('')}</div>`;
    const unequip = equipped && d.slot === 'artifact' ? '<button class="d-unequip" data-act="unequip">Снять</button>' : '';
    return head + body + unequip + slots;
  }

  /** Ромб гнезда зачарования: пусто — три варианта вокруг спирали; выбран — значок и ступень; нет гнезда — серый */
  private slotGem(it: Item, i: number): string {
    const s = it.enchants[i];
    if (!s) return '<div class="gem locked"><i></i></div>';
    const open = i === this.enchSlot ? ' open' : '';
    if (s.chosen >= 0) {
      const e = enchantDef(s.options[s.chosen]);
      return `<div class="gem chosen${open}" data-slot="${i}" title="${e.title} ${ROMAN[s.tier]}"><i style="--c:${e.color}">${iconImg(e.icon)}</i><b>${ROMAN[s.tier]}</b></div>`;
    }
    const mini = s.options.map((id, j) => { const e = enchantDef(id); return `<i class="m m${j}${e.powerful ? ' pw' : ''}" style="--c:${e.color}">${iconImg(e.icon)}</i>`; }).join('');
    return `<div class="gem cluster${open}" data-slot="${i}" title="Пустое гнездо: выбери зачарование">${mini}<span class="gem-sp">${iconImg('spiral')}</span><em>Пустое гнездо</em></div>`;
  }

  private enchantPanel(it: Item): string {
    const s = it.enchants[this.enchSlot], pts = this.profile.data.points;
    const rows = s.options.map((id, j) => {
      const e: EnchantDef = enchantDef(id);
      const locked = s.chosen >= 0 && s.chosen !== j;
      const tier = s.chosen === j ? s.tier : 0;
      return `<div class="eo${j === this.enchOpt ? ' on' : ''}${locked ? ' locked' : ''}" data-opt="${j}">
        <i class="eo-gem${e.powerful ? ' pw' : ''}" style="--c:${e.color}">${iconImg(e.icon)}</i>
        <div><b>${e.title}${e.powerful ? ' <small>мощное</small>' : ''}</b><span class="eo-tiers">${[1, 2, 3].map((t) => `<u class="${t <= tier ? 'got' : ''}">${ROMAN[t]}</u>`).join('')}</span></div>
      </div>`;
    }).join('');
    const e = enchantDef(s.options[this.enchOpt] ?? s.options[0]);
    const cur = s.chosen === this.enchOpt ? s.tier : 0;
    const cost = this.profile.nextCost(it, this.enchSlot, this.enchOpt);
    const tierText = [1, 2, 3].map((t) => `<li class="${t <= cur ? 'got' : t === cur + 1 ? 'next' : ''}"><b>${ROMAN[t]}</b> ${e.text(e.tiers[t - 1])} <i>${iconImg('spiral')}${t + (e.powerful ? 1 : 0)}</i></li>`).join('');
    const btn = cost === null
      ? `<button disabled>${cur >= 3 ? 'Наивысшая ступень' : 'Гнездо занято другим'}</button>`
      : `<button class="ok" data-act="enchant"${cost > pts ? ' disabled' : ''}>${cur ? `Улучшить до ${ROMAN[cur + 1]}` : 'Зачаровать'} — ${iconImg('spiral')}${cost}</button>`;
    return `<div class="d-enchpanel">
      <div class="eo-list">${rows}</div>
      <div class="eo-info"><h3 style="color:${e.color}">${e.title}</h3><ul>${tierText}</ul>
        <div class="d-btns"><button data-act="enchBack">Назад <kbd>Esc</kbd></button>${btn}</div>
        ${cost !== null && cost > pts ? '<p class="eo-warn">Не хватает очков зачарования — их дают за новый уровень, а разбор зачарованных вещей возвращает потраченные</p>' : ''}
      </div>
    </div>`;
  }
}

const eqSlot = (eq: string): ItemSlot => (eq.startsWith('art') ? 'artifact' : (eq as ItemSlot));
const enchantSum = (it: Item, id: string): number => it.enchants.reduce((a, s) => a + (s.chosen >= 0 && s.tier > 0 && s.options[s.chosen] === id ? enchantDef(s.options[s.chosen]).tiers[s.tier - 1] : 0), 0);

/**
 * Герой в инвентаре: свой рендер на холсте, медленно поворачивается, тянуть мышью — крутить.
 * Тот же Knight, что в игре, с надетым оружием и бронёй.
 */
class Preview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
  private readonly knight: Knight;
  private raf = 0;
  private yaw = 0.5;
  private drag: number | null = null;
  private weapon = '';
  private armor = '-';
  private last = 0;

  constructor(private readonly canvas: HTMLCanvasElement, T: Textures) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.add(new THREE.HemisphereLight('#c8d8ff', '#3a2a3a', 1.6));
    const key = new THREE.DirectionalLight('#fff2dc', 2.6);
    key.position.set(3, 5, 4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#b08aff', 1.6);
    rim.position.set(-4, 3, -3);
    this.scene.add(rim);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.9, 32), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35 }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.01;
    this.scene.add(disc);
    this.knight = new Knight(this.scene, T);
    this.knight.place(0, 0, 0);
    this.camera.position.set(0, 1.7, 8.4);
    this.camera.lookAt(0, 1.05, 0);
    canvas.addEventListener('pointerdown', (e) => { this.drag = e.clientX; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (this.drag !== null) { this.yaw += (e.clientX - this.drag) * 0.012; this.drag = e.clientX; } });
    canvas.addEventListener('pointerup', () => { this.drag = null; });
  }

  dress(p: Profile): void {
    const m = p.equipped('melee');
    const w = m ? getWeapon(itemDef(m.def).weapon ?? '') : undefined;
    if (w && w.id !== this.weapon) { this.weapon = w.id; this.knight.setWeapon(w); }
    const a = p.equipped('armor');
    if ((a?.def ?? '') !== this.armor) { this.armor = a?.def ?? ''; this.knight.setArmor(a ? itemDef(a.def).armor?.look ?? null : null); }
  }

  start(): void {
    cancelAnimationFrame(this.raf);
    this.last = performance.now();
    const input = emptyInput();
    const loop = (): void => {
      this.raf = requestAnimationFrame(loop);
      const now = performance.now(), dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      if (w && h && (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio()) || this.canvas.height !== Math.round(h * this.renderer.getPixelRatio()))) {
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
      if (this.drag === null) this.yaw += dt * 0.35;
      input.aim.set(Math.sin(this.yaw) * 5, 0, Math.cos(this.yaw) * 5);
      this.knight.yaw = this.yaw;
      this.knight.update(dt, input, []);
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  stop(): void { cancelAnimationFrame(this.raf); }
}

