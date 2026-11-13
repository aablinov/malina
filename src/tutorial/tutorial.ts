import { AUTOMATED } from '../devflag.ts';
import { LANG, t } from '../i18n/i18n.ts';
import { CARD, CARDS, GROUP_TITLE, GROUPS, type TutCard } from './cards.ts';
import './tutorial.css';

/**
 * The tutorial (wiki/design-tutorial.md): cards that pop up the first time a mechanic shows up, and the "How to play"
 * handbook with all of them. The game calls `TUTORIAL.fire(id)` from wherever the mechanic appears; a card is shown once
 * per browser (localStorage `malina.tutorial`). One card at a time: urgent ones jump the queue, the rest keep a gap in battle.
 * The host (the menu or a battle) says whether a card may stop the game: solo — it pauses the battle until dismissed,
 * a network battle — a small card aside that fades by itself.
 * An automated run (src/devflag.ts) keeps the tutorial silent unless the test stores `on: true` — a pausing card would stall the specs.
 */
export const TUTORIAL_KEY = 'malina.tutorial';
interface Stored { off?: boolean; on?: boolean; seen?: string[] }

export interface TutHost {
  /** A card stops the game until dismissed (menu, solo battle); false — a side card that fades (network battle) */
  blocking: boolean;
  /** A battle: non-urgent cards keep a gap between each other */
  battle?: boolean;
  /** Another window is open (inventory, shop, pause) — the card waits */
  busy?(): boolean;
  /** No fight around: a card that is not urgent waits for this */
  calm?(): boolean;
  /** A card or the handbook was closed: drop held input */
  onClose?(): void;
}

/** Seconds between two non-urgent cards in a battle */
const GAP = 20;
/** A side card fades after this many seconds */
const SIDE_LIFE = 12;
/** A fresh card ignores the dismiss key this long — the player was in the middle of a fight */
const GUARD_MS = 450;

function load(): Stored {
  try { const raw = localStorage.getItem(TUTORIAL_KEY); if (raw) return JSON.parse(raw) as Stored; } catch { /* closed storage or broken JSON */ }
  return {};
}

export const shotUrl = (id: string): string => `tutorial/${LANG}/${id}.webp`;

/** The body of a card: screenshot, title, text and the numbered legend of the rings on the screenshot */
export function cardHtml(c: TutCard): string {
  const marks = c.marks.length ? `<ol class="tut-marks">${c.marks.map((m) => `<li>${m}</li>`).join('')}</ol>` : '';
  return `<img class="tut-img" src="${shotUrl(c.id)}" alt="" draggable="false"><h3>${c.title}</h3>${c.lines.map((l) => `<p>${l}</p>`).join('')}${marks}`;
}

class Tutorial {
  host: TutHost | null = null;
  private st: Stored = load();
  private readonly seen = new Set<string>(this.st.seen ?? []);
  private queue: string[] = [];
  private cur: TutCard | null = null;
  private shownAt = 0;
  private nextAt = 0;
  private timer = 0;
  private fade = 0;
  private el: HTMLDivElement | null = null;
  private book: HTMLDivElement | null = null;
  private bookSel = CARDS[0].id;

  /** Cards pop up by themselves (the handbook works either way) */
  get active(): boolean { return !this.st.off && (!AUTOMATED || this.st.on === true); }
  get off(): boolean { return !!this.st.off; }
  /** A test asked for the tutorial outside the menu flow (`on: true` in the storage) */
  get forced(): boolean { return this.st.on === true; }
  /** The card on screen, if any */
  get card(): string | null { return this.cur?.id ?? null; }
  get bookOpen(): boolean { return !!this.book?.classList.contains('open'); }
  /** A blocking card or the handbook is up — a solo battle stands still */
  get pausing(): boolean { return this.bookOpen || (!!this.cur && !!this.host?.blocking); }
  has(id: string): boolean { return this.seen.has(id); }

  setOff(off: boolean): void {
    this.st.off = off;
    this.save();
    if (off) { this.queue = []; this.hide(); }
  }

  /** Show every card again */
  reset(): void { this.seen.clear(); this.queue = []; this.save(); }

  private save(): void {
    this.st.seen = [...this.seen];
    try { localStorage.setItem(TUTORIAL_KEY, JSON.stringify(this.st)); } catch { /* closed storage */ }
  }

  /** The mechanic of card `id` has just shown up: queue the card unless it was seen */
  fire(id: string): void {
    if (!this.active || !this.host || this.seen.has(id) || this.cur?.id === id || this.queue.includes(id)) return;
    const c = CARD.get(id);
    if (!c) return;
    if (c.urgent) this.queue.splice(this.queue.findIndex((q) => !CARD.get(q)?.urgent) >>> 0, 0, id); else this.queue.push(id);
    this.pump();
  }

  private pump(): void {
    window.clearTimeout(this.timer);
    this.timer = 0;
    const h = this.host;
    if (this.cur || !this.queue.length || !h) return;
    const c = CARD.get(this.queue[0]) as TutCard;
    const wait = c.urgent || c.chain || !h.battle ? 0 : this.nextAt - performance.now();
    if (this.bookOpen || h.busy?.() || wait > 0 || (!c.urgent && !c.chain && h.calm?.() === false)) { this.timer = window.setTimeout(() => this.pump(), Math.max(300, wait)); return; }
    this.queue.shift();
    this.show(c);
  }

  private root(): HTMLDivElement {
    if (this.el) return this.el;
    const el = document.createElement('div');
    el.className = 'tut';
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'ok') this.close();
      else if (act === 'off') this.setOff(true);
      else if (act === 'book') { const id = this.cur?.id; this.close(); this.openBook(id); }
    });
    // a screenshot that is not there (not shot yet, or the page is opened without its folder) just leaves the text
    el.addEventListener('error', (e) => { if (e.target instanceof HTMLImageElement) e.target.remove(); }, true);
    this.el = el;
    return el;
  }

  private show(c: TutCard): void {
    const el = this.root(), side = !this.host?.blocking;
    this.cur = c;
    this.shownAt = performance.now();
    this.seen.add(c.id);
    this.save();
    el.classList.toggle('side', side);
    el.innerHTML = `<div class="tut-card" data-card="${c.id}">${cardHtml(c)}
      <div class="tut-btns"><button class="tut-link" data-act="off">${t('Do not show hints')}</button>
      <button class="mm-btn small primary" data-act="ok">${t('Got it')}${side ? '' : ' <kbd>Enter</kbd>'}</button></div></div>`;
    el.classList.add('open');
    window.clearTimeout(this.fade);
    if (side) this.fade = window.setTimeout(() => this.close(), SIDE_LIFE * 1000);
  }

  private hide(): void {
    window.clearTimeout(this.fade);
    this.cur = null;
    this.el?.classList.remove('open');
  }

  close(): void {
    if (!this.cur) return;
    this.hide();
    this.nextAt = performance.now() + GAP * 1000;
    this.host?.onClose?.();
    this.pump();
  }

  /** Keys while a card or the handbook is up; true — consumed */
  key(e: KeyboardEvent): boolean {
    if (this.bookOpen) {
      if (e.code === 'Escape' || e.code === 'Enter') this.closeBook();
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') this.stepBook(1);
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.stepBook(-1);
      return true;
    }
    if (!this.cur || !this.host?.blocking) return false;
    if ((e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape') && performance.now() - this.shownAt > GUARD_MS) { e.preventDefault(); this.close(); }
    return true;
  }

  // ---------- handbook ----------
  /** "How to play": every card by section, whether met in the game yet or not */
  openBook(id?: string): void {
    if (!this.book) {
      const b = document.createElement('div');
      b.className = 'tut-book';
      document.body.appendChild(b);
      b.addEventListener('click', (e) => {
        const el = e.target as HTMLElement, card = el.closest<HTMLElement>('[data-card]')?.dataset.card, act = el.closest<HTMLElement>('[data-act]')?.dataset.act;
        if (card) { this.bookSel = card; this.renderBook(); }
        else if (act === 'close' || el === b) this.closeBook();
      });
      b.addEventListener('error', (e) => { if (e.target instanceof HTMLImageElement) e.target.remove(); }, true);
      this.book = b;
    }
    if (id && CARD.has(id)) this.bookSel = id;
    this.renderBook();
    this.book.classList.add('open');
  }

  closeBook(): void {
    if (!this.bookOpen) return;
    this.book?.classList.remove('open');
    this.host?.onClose?.();
    this.pump();
  }

  private stepBook(d: number): void {
    const i = CARDS.findIndex((c) => c.id === this.bookSel);
    this.bookSel = CARDS[(i + d + CARDS.length) % CARDS.length].id;
    this.renderBook();
    this.book?.querySelector('.tut-list .sel')?.scrollIntoView({ block: 'nearest' });
  }

  private renderBook(): void {
    const b = this.book;
    if (!b) return;
    const list = GROUPS.map((g) => `<h4>${GROUP_TITLE[g]}</h4>${CARDS.filter((c) => c.group === g).map((c) => `<button class="tut-item${c.id === this.bookSel ? ' sel' : ''}" data-card="${c.id}">${c.title}</button>`).join('')}`).join('');
    const top = b.querySelector('.tut-list')?.scrollTop ?? 0;
    b.innerHTML = `<div class="tut-win"><header><h2>${t('How to play')}</h2><button class="mm-btn small primary" data-act="close">${t('Done')} <kbd>Esc</kbd></button></header>
      <nav class="tut-list">${list}</nav><article class="tut-page">${cardHtml(CARD.get(this.bookSel) as TutCard)}</article></div>`;
    (b.querySelector('.tut-list') as HTMLElement).scrollTop = top;
  }
}

export const TUTORIAL = new Tutorial();
