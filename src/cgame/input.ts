import * as THREE from 'three';
import type { SysEvent } from './events.ts';

/**
 * Состояние ввода для такта — `cl_input.c` Quake 3 (`kbutton_t`, `CL_CreateCmd`): клавиши с защёлками «нажато с прошлого
 * такта» (тап короче такта не теряется), мышь с защёлкой клика, и действия героя с клавиш (зелье, артефакты, аура, спец-удар,
 * взаимодействие, волна) — они копятся и исполняются в начале такта по порядку, как кнопки usercmd, а не в `keydown`.
 * Движение из клавиш — `move()`; приказы мыши — `orders.ts`
 */
export type Action =
  | { k: 'potion' }
  | { k: 'aura' }
  | { k: 'special' }
  | { k: 'interact' }
  | { k: 'wave' }
  | { k: 'artifact'; i: number; down: boolean }
  /** Кнопка HUD: артефакт без удержания */
  | { k: 'use'; i: number };

export class KeyState {
  readonly down = new Set<string>();
  /** Нажато с прошлого такта (и уже отпущено — тоже) */
  readonly pressed = new Set<string>();
  /** Зажата или была нажата с прошлого такта */
  has(code: string): boolean { return this.down.has(code) || this.pressed.has(code); }
  /** Нажата с прошлого такта (фронт) */
  tapped(code: string): boolean { return this.pressed.has(code); }
  feed(code: string, isDown: boolean): void {
    if (isDown) { if (!this.down.has(code)) this.pressed.add(code); this.down.add(code); } else this.down.delete(code);
  }
  /** Конец такта: защёлки сброшены */
  endTick(): void { this.pressed.clear(); }
  clear(): void { this.down.clear(); this.pressed.clear(); }
}

/** Размер окна для перевода курсора в NDC; по умолчанию — окно браузера */
export type ViewSize = () => { w: number; h: number };
const windowSize: ViewSize = () => ({ w: window.innerWidth, h: window.innerHeight });

export class MouseState {
  readonly px = { x: 0, y: 0 };
  readonly ndc = new THREE.Vector2();
  seen = false;
  lmb = false;
  rmb = false;
  /** ЛКМ нажата с прошлого такта */
  lmbTap = false;
  /** Колесо с прошлого разбора (суммарно) */
  wheel = 0;
  private readonly size: ViewSize;
  constructor(size: ViewSize = windowSize) { this.size = size; const { w, h } = size(); this.px.x = w / 2; this.px.y = h / 2; }
  feed(e: SysEvent): void {
    switch (e.kind) {
      case 'mouse': {
        const { w, h } = this.size();
        this.px.x = e.x; this.px.y = e.y;
        this.ndc.set((e.x / w) * 2 - 1, -(e.y / h) * 2 + 1);
        this.seen = true;
        break;
      }
      case 'button':
        if (e.button === 0) { if (e.down && !this.lmb) this.lmbTap = true; this.lmb = e.down; }
        if (e.button === 2) this.rmb = e.down;
        break;
      case 'wheel': this.wheel += e.dy; break;
      default: break;
    }
  }
  /** ЛКМ нажата сейчас или была нажата с прошлого такта */
  get lmbHeld(): boolean { return this.lmb || this.lmbTap; }
  endTick(): void { this.lmbTap = false; }
  release(): void { this.lmb = false; this.rmb = false; this.lmbTap = false; }
}

/** Клавиша → действие героя (нажатие; артефакты — и отпускание: заряд заклинания) */
const ACTIONS: Record<string, Action | undefined> = {
  KeyE: { k: 'potion' },
  KeyR: { k: 'aura' },
  KeyQ: { k: 'special' },
  KeyF: { k: 'interact' },
  KeyG: { k: 'wave' },
};

export class GameInput {
  readonly keys = new KeyState();
  readonly mouse: MouseState;
  private pending: Action[] = [];

  constructor(size: ViewSize = windowSize) { this.mouse = new MouseState(size); }

  /** Событие дошло до игры (не съедено меню, инвентарём, чатом) */
  feed(e: SysEvent): void {
    switch (e.kind) {
      case 'key': {
        if (e.repeat) return;
        this.keys.feed(e.code, e.down);
        const art = /^Digit[123]$/.test(e.code) ? Number(e.code.slice(5)) - 1 : -1;
        if (art >= 0) this.pending.push({ k: 'artifact', i: art, down: e.down });
        else if (e.down) { const a = ACTIONS[e.code]; if (a) this.pending.push(a); }
        break;
      }
      case 'blur': this.keys.clear(); this.mouse.release(); break;
      default: this.mouse.feed(e); break;
    }
  }

  /** Действие не с клавиши (кнопка HUD) — в ту же очередь */
  queue(a: Action): void { this.pending.push(a); }

  /** Действия с прошлого такта по порядку; очередь очищается */
  takeActions(): Action[] { const a = this.pending; this.pending = []; return a; }

  /** Движение из WASD и стрелок в мировых осях: fwd — куда ведёт «вверх экрана», right — «вправо» */
  move(fwd: THREE.Vector2, right: THREE.Vector2, out: THREE.Vector2): THREE.Vector2 {
    const k = this.keys;
    out.set(0, 0);
    if (k.has('KeyW') || k.has('ArrowUp')) out.add(fwd);
    if (k.has('KeyS') || k.has('ArrowDown')) out.sub(fwd);
    if (k.has('KeyD') || k.has('ArrowRight')) out.add(right);
    if (k.has('KeyA') || k.has('ArrowLeft')) out.sub(right);
    if (out.lengthSq() > 1) out.normalize();
    return out;
  }

  get shift(): boolean { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); }

  endTick(): void { this.keys.endTick(); this.mouse.endTick(); }
  /** Меню, инвентарь, лавка открылись: клавиши и кнопки — им, действия забыть */
  clear(): void { this.keys.clear(); this.mouse.release(); this.pending = []; }
}
