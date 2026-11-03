/**
 * Сетевой бой поверх игры (src/net/coop.ts): список игроков — имя, здоровье, пинг, хост — и чат комнаты.
 * Enter — написать (ещё раз Enter — отправить, Esc — закрыть), сообщения живут 12 с
 */
export interface RosterRow { seat: number; name: string; hp: number; maxHp: number; ping: number; host: boolean; me: boolean; down: boolean }

const LIFE_MS = 12_000;

export class BattleNetUi {
  private readonly roster = document.createElement('div');
  private readonly chatEl = document.createElement('div');
  private readonly log = document.createElement('div');
  private readonly input = document.createElement('input');
  private rosterHtml = '';
  /** Отправить сообщение чата */
  onSend?: (text: string) => void;

  constructor(parent: HTMLElement) {
    this.roster.className = 'net-roster';
    this.chatEl.className = 'net-chat';
    this.log.className = 'net-chat-log';
    this.input.className = 'net-chat-input';
    this.input.maxLength = 200;
    this.input.placeholder = 'Сообщение — Enter, Esc — закрыть';
    this.chatEl.append(this.log, this.input);
    parent.append(this.roster, this.chatEl);
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter') { const t = this.input.value.trim(); if (t) this.onSend?.(t); this.closeChat(); }
      else if (e.code === 'Escape') this.closeChat();
    });
    // клавиши в поле — только для текста: игра их не видит
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
  }

  get typing(): boolean { return this.chatEl.classList.contains('open'); }

  openChat(): void { this.chatEl.classList.add('open'); this.input.value = ''; this.input.focus(); }
  closeChat(): void { this.chatEl.classList.remove('open'); this.input.blur(); }

  /** Сообщение в ленту: имя и текст (системное — без имени) */
  add(name: string | null, text: string): void {
    const row = document.createElement('div');
    row.className = 'net-chat-row';
    if (name) { const b = document.createElement('b'); b.textContent = `${name}: `; row.append(b); }
    else row.classList.add('sys');
    row.append(document.createTextNode(text));
    this.log.append(row);
    while (this.log.children.length > 8) this.log.firstChild?.remove();
    window.setTimeout(() => row.classList.add('old'), LIFE_MS);
  }

  /** Список игроков: по месту, хост — с короной, без сил — бледнее */
  setRoster(rows: RosterRow[]): void {
    const esc = (v: string): string => v.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    const html = rows.sort((a, b) => a.seat - b.seat).map((r) => {
      const k = r.maxHp > 0 ? Math.max(0, Math.min(1, r.hp / r.maxHp)) : 0;
      const ping = r.ping > 0 ? `${Math.round(r.ping)} мс` : '—';
      return `<div class="net-row${r.me ? ' me' : ''}${r.down ? ' down' : ''}"><b>${r.host ? '♛ ' : ''}${esc(r.name)}</b><i><u style="width:${(k * 100).toFixed(0)}%"></u></i><span class="${r.ping > 200 ? 'bad' : ''}">${ping}</span></div>`;
    }).join('');
    if (html !== this.rosterHtml) { this.rosterHtml = html; this.roster.innerHTML = html; }
  }

  dispose(): void { this.roster.remove(); this.chatEl.remove(); }
}
