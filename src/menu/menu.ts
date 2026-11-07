import { initAudio, sfx } from '../audio.ts';
import { DEV_TOOLS, openEditor } from '../devflag.ts';
import { LANG, setLang, storedLang, t } from '../i18n/i18n.ts';
import { Profile } from '../items.ts';
import { makeTextures } from '../textures.ts';
import { Lobby } from './lobby.ts';
import { MenuScene } from './scene.ts';
import { applyAudio, SettingsPanel } from './settings-panel.ts';
import { loadMenuState, saveMenuState, VOICE, type GameMode } from './session.ts';
import '../style.css';
import '../hud/hud.css';
import './menu.css';

/**
 * Main menu in the spirit of Minecraft Dungeons (wiki/design-main-menu.md). The page without parameters opens it,
 * `?dev=playground` and `?map=…` — the game at once (src/main.ts).
 * Start screen: "Solo game", "Online game", "Settings" → camp: the hero's gear and the Bush Defence map choice →
 * "Start game" reloads the page to `?map=td…&from=menu`. "To camp" from a battle returns to `?menu=lobby`.
 * First launch (no stored language, src/i18n/i18n.ts): a language picker over the start screen; the choice reloads the page.
 */
export function runMenu(): void {
  document.title = t('Malina');
  document.body.classList.add('menu');
  const profile = new Profile();

  const app = document.getElementById('app') as HTMLElement;
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  canvas.classList.add('mm-canvas');
  const root = document.createElement('div');
  root.className = 'mm';
  app.appendChild(root);

  const settingsPanel = new SettingsPanel(document.body);
  applyAudio(settingsPanel.settings);
  const T = makeTextures();
  const scene = new MenuScene(canvas, T, settingsPanel.settings);
  scene.dress(profile);
  scene.start();

  // ---------- Start screen ----------
  const start = document.createElement('div');
  start.className = 'mm-start';
  start.innerHTML = `
    <div class="mm-logo">${t('Malina')}<small>${t('Bush Defence')}</small></div>
    <nav class="mm-nav">
      <button class="mm-btn big" data-act="solo">${t('Solo game')}</button>
      <button class="mm-btn big" data-act="online">${t('Online game')}</button>
      <button class="mm-btn big" data-act="settings">${t('Settings')}</button>
      ${DEV_TOOLS ? `<div class="mm-dev"><button class="mm-btn small" data-act="playground">${t('Playground')}</button><button class="mm-btn small" data-act="editor">${t('Editor')}</button></div>` : ''}
    </nav>
    <footer class="mm-foot"><span>${t('↑ ↓ — select · Enter — open')}</span><span>${t('Hero level <b>{level}</b> · items <b>{items}</b>', { level: profile.data.level, items: profile.data.items.length })}</span></footer>`;
  root.appendChild(start);

  const lobby = new Lobby(root, profile, T, scene);
  lobby.onBack = () => showStart();
  lobby.onSettings = () => settingsPanel.show();

  const navButtons = (): HTMLButtonElement[] => [...start.querySelectorAll<HTMLButtonElement>('.mm-nav button')];
  let focus = 0;
  const setFocus = (i: number): void => {
    const b = navButtons();
    focus = (i + b.length) % b.length;
    b.forEach((x, j) => x.classList.toggle('focus', j === focus));
  };

  function showStart(): void {
    lobby.hide();
    start.classList.add('open');
    scene.setView('start');
    setFocus(focus);
  }

  function openLobby(mode: GameMode): void {
    const st = loadMenuState();
    st.mode = mode;
    saveMenuState(st);
    start.classList.remove('open');
    scene.setView('lobby');
    lobby.show(mode);
  }

  function act(a: string | undefined): void {
    initAudio();
    if (!a) return;
    sfx.twinkle();
    if (a === 'solo') openLobby('solo');
    else if (a === 'online') openLobby('online');
    else if (a === 'settings') settingsPanel.show();
    else if (a === 'playground') window.location.search = '?dev=playground';
    else if (a === 'editor') openEditor();
  }

  start.addEventListener('click', (e) => act((e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act));
  start.addEventListener('mousemove', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    const i = b ? navButtons().indexOf(b as HTMLButtonElement) : -1;
    if (i >= 0 && i !== focus) setFocus(i);
  });

  // ---------- Language choice (first launch) ----------
  const langPick = storedLang() === null ? makeLangPick(root) : null;

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    initAudio();
    if (langPick) { langPick.key(e); return; }
    if (settingsPanel.key(e)) return;
    if (lobby.open) { lobby.key(e); return; }
    switch (e.code) {
      case 'ArrowDown': case 'KeyS': setFocus(focus + 1); break;
      case 'ArrowUp': case 'KeyW': setFocus(focus - 1); break;
      case 'Enter': case 'Space': e.preventDefault(); act(navButtons()[focus]?.dataset.act); break;
      default: break;
    }
  });

  // "To camp" from a battle — straight to the camp
  const q = new URLSearchParams(window.location.search);
  if (q.get('menu') === 'lobby') openLobby(loadMenuState().mode);
  else showStart();

  // for tests and debugging
  (window as unknown as { __menu?: unknown }).__menu = {
    profile,
    get screen() { return langPick ? 'lang' : lobby.open ? 'lobby' : 'start'; },
    lobby,
    settings: settingsPanel,
    /** Room voice chat (src/net/voice.ts) */
    voice: VOICE,
  };
}

/**
 * Language picker over the start screen: the logo, the question in both languages (it is shown before the choice)
 * and two buttons; ↑ ↓ Enter like the start screen. The choice is saved with `setLang()` and the page reloads,
 * so every module re-resolves its strings.
 */
function makeLangPick(root: HTMLElement): { key(e: KeyboardEvent): void } {
  const el = document.createElement('div');
  el.className = 'mm-lang';
  el.innerHTML = `
    <div class="mm-logo">${t('Malina')}<small>${t('Bush Defence')}</small></div>
    <p class="mm-lang-ask">Choose your language / Выберите язык</p>
    <nav class="mm-nav">
      <button class="mm-btn big" data-lang="en">English</button>
      <button class="mm-btn big" data-lang="ru">Русский</button>
    </nav>`;
  root.appendChild(el);
  const buttons = (): HTMLButtonElement[] => [...el.querySelectorAll<HTMLButtonElement>('[data-lang]')];
  let focus = LANG === 'ru' ? 1 : 0;
  const setFocus = (i: number): void => {
    const b = buttons();
    focus = (i + b.length) % b.length;
    b.forEach((x, j) => x.classList.toggle('focus', j === focus));
  };
  const choose = (l: string | undefined): void => {
    if (l !== 'en' && l !== 'ru') return;
    sfx.twinkle();
    setLang(l);
    location.reload();
  };
  el.addEventListener('click', (e) => choose((e.target as HTMLElement).closest<HTMLElement>('[data-lang]')?.dataset.lang));
  el.addEventListener('mousemove', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    const i = b ? buttons().indexOf(b as HTMLButtonElement) : -1;
    if (i >= 0 && i !== focus) setFocus(i);
  });
  setFocus(focus);
  return {
    key(e: KeyboardEvent): void {
      switch (e.code) {
        case 'ArrowDown': case 'KeyS': setFocus(focus + 1); break;
        case 'ArrowUp': case 'KeyW': setFocus(focus - 1); break;
        case 'Enter': case 'Space': e.preventDefault(); choose(buttons()[focus]?.dataset.lang); break;
        default: break;
      }
    },
  };
}
