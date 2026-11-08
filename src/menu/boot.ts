import { fromMenu } from '../devflag.ts';
import { t } from '../i18n/i18n.ts';
import { Profile, setProfileStorage, type ProfileData } from '../items.ts';
import { AuthLost, MemoryProfileStore } from '../net/profile-store.ts';
import { NET } from './session.ts';
import './menu.css';

/**
 * Page start (wiki/design-main-menu.md): the game always goes through the server. No server — a "Server unavailable · Retry"
 * screen; no hero in this browser (`malina.net`) — the "Hero name" screen; then the hero profile from the server
 * (src/net/profile-store.ts). The camp and the battle page get a `Profile` only after that
 */

const esc = (v: string): string => v.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** A full-screen card over the page: the logo, a line, the content */
function card(html: string): HTMLElement {
  document.querySelector('.mm-boot')?.remove();
  const el = document.createElement('div');
  el.className = 'mm-boot';
  el.innerHTML = `<div class="mm-logo">${t('Malina')}<small>${t('Bush Defence')}</small></div>${html}`;
  document.body.appendChild(el);
  return el;
}

/** The server is not answering: wait for "Retry" */
function unavailable(): Promise<void> {
  const el = card(`<p class="mm-boot-ask">${t('Server unavailable')}</p>
    <p class="mm-note">${esc(NET.base)}</p>
    <nav class="mm-nav"><button class="mm-btn big focus" data-act="retry">${t('Check again')}</button></nav>`);
  return new Promise((ok) => {
    const go = (): void => { window.removeEventListener('keydown', key); el.remove(); ok(); };
    const key = (e: KeyboardEvent): void => { if (e.code === 'Enter') go(); };
    el.querySelector('[data-act="retry"]')?.addEventListener('click', go);
    window.addEventListener('keydown', key);
  });
}

/** First entry: the hero name → `POST /api/auth` (an old browser save goes along) */
function askName(): Promise<void> {
  const el = card(`<p class="mm-boot-ask">${t('Hero name')}</p>
    <nav class="mm-nav"><input class="mm-field" data-field="name" maxlength="16" placeholder="${t('2–16 letters')}" autocomplete="off">
    <p class="mm-boot-err" data-id="err"></p>
    <button class="mm-btn big focus" data-act="login">${t('Log in')}</button></nav>
    <p class="mm-note">${t('No password: the server remembers the hero in this browser.')}</p>`);
  const input = el.querySelector<HTMLInputElement>('[data-field="name"]') as HTMLInputElement;
  const err = el.querySelector('[data-id="err"]') as HTMLElement;
  input.focus();
  return new Promise((ok) => {
    let busy = false;
    const go = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      err.textContent = '';
      const was = NET.onError;
      NET.onError = (text) => { err.textContent = text; };
      try {
        if (await NET.login(input.value.trim())) { NET.onError = was; el.remove(); ok(); return; }
      } catch { err.textContent = t('Server unavailable'); }
      NET.onError = was;
      busy = false;
    };
    el.querySelector('[data-act="login"]')?.addEventListener('click', () => void go());
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.code === 'Enter') void go(); });
  });
}

/** Server up, signed in, the stored profile loaded — retries until it is */
async function serverProfile(): Promise<ProfileData> {
  for (;;) {
    if (!(await NET.probe())) { await unavailable(); continue; }
    if (!NET.auth) { await askName(); continue; }
    try {
      const data = await NET.profiles.load();
      setProfileStorage(NET.profiles);
      return data;
    } catch (e) {
      // the server forgot the token (a new database) — the name again
      if (e instanceof AuthLost) NET.logout();
      else await unavailable();
    }
  }
}

/** The camp's hero: its changes go back to the server, server copies (match rewards) come into it */
export async function campProfile(): Promise<Profile> {
  const p = new Profile(await serverProfile());
  NET.profiles.attach(p);
  return p;
}

/**
 * The battle page's hero. From the camp (`from=menu`, a room) — the stored profile from the server: the battle works on a copy,
 * solo growth and loot go back (`Profile.keepGrowth`, `creditStored`), online the server pays them itself.
 * Dev launches (`?dev=playground`, `?map=…` by hand) — the starter hero in memory, nothing is saved
 */
export async function battleProfile(): Promise<Profile> {
  const room = new URLSearchParams(window.location.search).has('room');
  if (!fromMenu() && !room) {
    const store = new MemoryProfileStore(Profile.starter());
    setProfileStorage(store);
    return new Profile(store.stored());
  }
  const data = await serverProfile();
  NET.profiles.frozen = room;
  return new Profile(structuredClone(data));
}

/** Go to another page once the profile is on the server */
export async function go(url: string): Promise<void> {
  await NET.profiles.flush();
  window.location.href = url;
}
