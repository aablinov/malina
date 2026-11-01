import { initAudio, sfx } from '../audio';
import { DEV_TOOLS, openEditor } from '../devflag';
import { Profile } from '../items';
import { makeTextures } from '../textures';
import { Lobby } from './lobby';
import { MenuScene } from './scene';
import { applyAudio, SettingsPanel } from './settings-panel';
import { loadMenuState, saveMenuState, takeGear, takeStash, type GameMode } from './session';
import '../style.css';
import '../hud/hud.css';
import './menu.css';

/**
 * Главное меню в духе Minecraft Dungeons (wiki/design-main-menu.md). Страница без параметров открывает его,
 * `?dev=playground` и `?map=…` — сразу игру (src/main.ts).
 * Стартовый экран: «Одиночная игра», «Сетевая игра», «Настройки» → лагерь: снаряжение героя и выбор карты обороны куста →
 * «Начать игру» перезагружает страницу на `?map=td…&from=menu`. Из боя «В лагерь» возвращает на `?menu=lobby`.
 */
export function runMenu(): void {
  document.title = 'Малина';
  document.body.classList.add('menu');
  const profile = new Profile();
  // бой отдавал малину героя под казну обороны — вернуть её (src/menu/session.ts)
  const stash = takeStash();
  if (stash !== null) { profile.data.berries = stash; profile.save(); }
  // купленное у маркитанта обороны остаётся в бою: снаряжение — как до него
  const gear = takeGear();
  if (gear) { profile.data.items = gear.items as typeof profile.data.items; profile.data.equip = gear.equip as typeof profile.data.equip; profile.data.arrows = gear.arrows; profile.save(); }

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

  // ---------- Стартовый экран ----------
  const start = document.createElement('div');
  start.className = 'mm-start';
  start.innerHTML = `
    <div class="mm-logo">Малина<small>Оборона куста</small></div>
    <nav class="mm-nav">
      <button class="mm-btn big" data-act="solo">Одиночная игра</button>
      <button class="mm-btn big" data-act="online">Сетевая игра<i class="mm-soon">скоро</i></button>
      <button class="mm-btn big" data-act="settings">Настройки</button>
      ${DEV_TOOLS ? '<div class="mm-dev"><button class="mm-btn small" data-act="playground">Плейграунд</button><button class="mm-btn small" data-act="editor">Редактор</button></div>' : ''}
    </nav>
    <footer class="mm-foot"><span>↑ ↓ — выбрать · Enter — открыть</span><span>Уровень героя <b>${profile.data.level}</b> · предметов <b>${profile.data.items.length}</b></span></footer>`;
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

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    initAudio();
    if (settingsPanel.key(e)) return;
    if (lobby.open) { lobby.key(e); return; }
    switch (e.code) {
      case 'ArrowDown': case 'KeyS': setFocus(focus + 1); break;
      case 'ArrowUp': case 'KeyW': setFocus(focus - 1); break;
      case 'Enter': case 'Space': e.preventDefault(); act(navButtons()[focus]?.dataset.act); break;
      default: break;
    }
  });

  // из боя «В лагерь» — сразу в лагерь
  const q = new URLSearchParams(window.location.search);
  if (q.get('menu') === 'lobby') openLobby(loadMenuState().mode);
  else showStart();

  // для тестов и отладки
  (window as unknown as { __menu?: unknown }).__menu = {
    profile,
    get screen() { return lobby.open ? 'lobby' : 'start'; },
    lobby,
    settings: settingsPanel,
  };
}
