import * as THREE from 'three';
import type { SysEvent } from './events.ts';

/**
 * Input state for a tick — Quake 3's `cl_input.c` (`kbutton_t`, `CL_CreateCmd`): keys with "pressed since the last
 * tick" latches (a tap shorter than a tick is not lost), the mouse with a click latch, and hero actions from keys (potion, artifacts, aura, weapon art,
 * interact, wave) — they accumulate and run at the start of the tick in order, like usercmd buttons, not in `keydown`.
 * Movement from keys — `move()`; mouse orders — `orders.ts`
 */
export type Action =
  | { k: 'potion' }
  | { k: 'aura' }
  | { k: 'special' }
  | { k: 'interact' }
  | { k: 'wave' }
  | { k: 'artifact'; i: number; down: boolean }
  /** HUD button: an artifact without holding */
  | { k: 'use'; i: number };

export class KeyState {
  readonly down = new Set<string>();
  /** Pressed since the last tick (even if already released) */
  readonly pressed = new Set<string>();
  /** Held or was pressed since the last tick */
  has(code: string): boolean { return this.down.has(code) || this.pressed.has(code); }
  /** Pressed since the last tick (edge) */
  tapped(code: string): boolean { return this.pressed.has(code); }
  feed(code: string, isDown: boolean): void {
    if (isDown) { if (!this.down.has(code)) this.pressed.add(code); this.down.add(code); } else this.down.delete(code);
  }
  /** End of tick: latches reset */
  endTick(): void { this.pressed.clear(); }
  clear(): void { this.down.clear(); this.pressed.clear(); }
}

/** Window size for converting the cursor to NDC; by default the browser window */
export type ViewSize = () => { w: number; h: number };
const windowSize: ViewSize = () => ({ w: window.innerWidth, h: window.innerHeight });

export class MouseState {
  readonly px = { x: 0, y: 0 };
  readonly ndc = new THREE.Vector2();
  seen = false;
  lmb = false;
  rmb = false;
  /** LMB pressed since the last tick */
  lmbTap = false;
  /** Wheel since the last drain (total) */
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
  /** LMB pressed now or was pressed since the last tick */
  get lmbHeld(): boolean { return this.lmb || this.lmbTap; }
  endTick(): void { this.lmbTap = false; }
  release(): void { this.lmb = false; this.rmb = false; this.lmbTap = false; }
}

/** Key → hero action (press; artifacts also release: spell charge) */
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

  /** The event reached the game (not consumed by the menu, inventory or chat) */
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

  /** An action not from a key (HUD button) — into the same queue */
  queue(a: Action): void { this.pending.push(a); }

  /** Actions since the last tick in order; the queue is cleared */
  takeActions(): Action[] { const a = this.pending; this.pending = []; return a; }

  /** Movement from WASD and arrows in world axes: fwd — where "screen up" leads, right — "screen right" */
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
  /** Menu, inventory or shop opened: keys and buttons go to them, forget the actions */
  clear(): void { this.keys.clear(); this.mouse.release(); this.pending = []; }
}
