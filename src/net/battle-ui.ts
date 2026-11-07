import { t } from '../i18n/i18n.ts';

/**
 * Network battle on top of the game (src/cgame/net-battle.ts): the player list — name, health, ping, host — and the room chat.
 * Enter — write (Enter again — send, Esc — close), messages live 12 s; T — one's microphone (voice chat, src/net/voice.ts), 🎤 in the list
 */
export interface RosterRow { seat: number; name: string; hp: number; maxHp: number; ping: number; host: boolean; me: boolean; down: boolean; /** Mic on */ voice: boolean; /** Talking right now */ speaking: boolean }

const LIFE_MS = 12_000;

export class BattleNetUi {
  private readonly roster = document.createElement('div');
  private readonly chatEl = document.createElement('div');
  private readonly log = document.createElement('div');
  private readonly input = document.createElement('input');
  private rosterHtml = '';
  /** Send a chat message */
  onSend?: (text: string) => void;

  constructor(parent: HTMLElement) {
    this.roster.className = 'net-roster';
    this.chatEl.className = 'net-chat';
    this.log.className = 'net-chat-log';
    this.input.className = 'net-chat-input';
    this.input.maxLength = 200;
    this.input.placeholder = t('Message — Enter, Esc — close');
    this.chatEl.append(this.log, this.input);
    parent.append(this.roster, this.chatEl);
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter') { const t = this.input.value.trim(); if (t) this.onSend?.(t); this.closeChat(); }
      else if (e.code === 'Escape') this.closeChat();
    });
    // keys in the field are for the text only: the game does not see them
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
  }

  get typing(): boolean { return this.chatEl.classList.contains('open'); }

  openChat(): void { this.chatEl.classList.add('open'); this.input.value = ''; this.input.focus(); }
  closeChat(): void { this.chatEl.classList.remove('open'); this.input.blur(); }

  /** Message into the feed: name and text (system — no name) */
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

  /** Player list: by seat, the host with a crown, exhausted — paler */
  setRoster(rows: RosterRow[]): void {
    const esc = (v: string): string => v.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    const html = rows.sort((a, b) => a.seat - b.seat).map((r) => {
      const k = r.maxHp > 0 ? Math.max(0, Math.min(1, r.hp / r.maxHp)) : 0;
      const ping = r.ping > 0 ? t('{ms} ms', { ms: Math.round(r.ping) }) : '—';
      const mic = r.voice ? `<em class="${r.speaking ? 'talk' : ''}">🎤</em>` : '<em></em>';
      return `<div class="net-row${r.me ? ' me' : ''}${r.down ? ' down' : ''}">${mic}<b>${r.host ? '♛ ' : ''}${esc(r.name)}</b><i><u style="width:${(k * 100).toFixed(0)}%"></u></i><span class="${r.ping > 200 ? 'bad' : ''}">${ping}</span></div>`;
    }).join('');
    if (html !== this.rosterHtml) { this.rosterHtml = html; this.roster.innerHTML = html; }
  }

  dispose(): void { this.roster.remove(); this.chatEl.remove(); }
}
