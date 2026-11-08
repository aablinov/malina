import { t } from '../i18n/i18n.ts';
import { Profile, type ProfileData, type ProfileStorage } from '../items.ts';
import type { NetClient } from './client.ts';
import type { ProfileReply } from './protocol.ts';

/** The browser save from before the server kept the hero — brought to the server once, then removed */
export const LEGACY_KEY = 'malina.profile';
/** Changes go to the server this long after the last one */
const PUSH_MS = 800;

/** The old browser save, if there is one (it goes into the registration or into the first write of an old account) */
export function legacyProfile(): ProfileData | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    const d = raw ? (JSON.parse(raw) as ProfileData) : null;
    return d && d.version === 1 && Array.isArray(d.items) ? d : null;
  } catch { return null; }
}

function dropLegacy(): void { try { localStorage.removeItem(LEGACY_KEY); } catch { /* closed storage */ } }

/** The server refused the request: no hero for the token (401) — sign in again */
export class AuthLost extends Error {}

/**
 * The hero profile lives only on the server (wiki/design-multiplayer.md, section 5): `load()` takes it at page start,
 * the camp profile and battle growth go back with `PUT /api/profile` (optimistic version), `flush()` before leaving the page.
 * A version conflict (another tab, battle rewards) — the server copy wins and replaces the stored one
 */
export class ServerProfileStore implements ProfileStorage {
  private readonly net: NetClient;
  private data: ProfileData | null = null;
  private version = 0;
  /** The camp profile linked with `attach` — its data is the stored profile itself */
  private linked: Profile | null = null;
  private timer = 0;
  private dirty = false;
  private inflight: Promise<void> | null = null;
  /** The client itself writes the server copy into the linked profile — not a change to send back */
  private taking = false;
  /** Online battle: the server pays growth and loot itself (finishMatch) — the page writes nothing */
  frozen = false;

  constructor(net: NetClient) {
    this.net = net;
    // closing the tab: the last change goes out anyway
    window.addEventListener('pagehide', () => this.beacon());
  }

  stored(): ProfileData | null { return this.data; }

  /** The profile from the server; an old account without one — the browser save or the starter one goes there first */
  async load(): Promise<ProfileData> {
    const r = await this.net.api('GET', '/api/profile');
    if (r.status === 401) throw new AuthLost();
    if (r.status === 404) {
      const w = await this.net.api('PUT', '/api/profile', { version: 0, data: legacyProfile() ?? Profile.starter() });
      if (!w.ok && w.status !== 409) throw new Error(`profile ${w.status}`);
      this.take((await w.json()) as ProfileReply);
    } else if (r.ok) this.take((await r.json()) as ProfileReply);
    else throw new Error(`profile ${r.status}`);
    dropLegacy();
    const d = this.data as ProfileData;
    if (Profile.upgrade(d)) this.schedule();
    return d;
  }

  /** The camp profile: its changes go to the server, server copies (rewards) come into it */
  attach(p: Profile): void {
    this.linked = p;
    p.data = this.data ?? p.data;
    p.onChange(() => { if (!this.taking) this.schedule(); });
  }

  update(f: (d: ProfileData) => void): void {
    if (!this.data || this.frozen) return;
    f(this.data);
    this.schedule();
  }

  /** A server copy (the match reward, a conflict answer) */
  take(srv: ProfileReply): void {
    this.version = srv.version;
    const d = srv.data as ProfileData;
    d.equip.aura ??= null;
    this.data = d;
    const p = this.linked;
    if (!p) return;
    p.data = d;
    this.taking = true;
    p.save();
    this.taking = false;
  }

  private schedule(): void {
    this.dirty = true;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), PUSH_MS);
  }

  /** Everything changed goes to the server now — before going to another page */
  async flush(): Promise<void> {
    window.clearTimeout(this.timer);
    while (this.inflight) await this.inflight;
    if (!this.dirty || !this.data) return;
    this.dirty = false;
    this.inflight = this.push().finally(() => { this.inflight = null; });
    await this.inflight;
  }

  private async push(): Promise<void> {
    try {
      const r = await this.net.api('PUT', '/api/profile', { version: this.version, data: this.data });
      if (r.ok) { this.version = ((await r.json()) as ProfileReply).version; return; }
      if (r.status === 409) { this.take((await r.json()) as ProfileReply); return; }
      const e = ((await r.json().catch(() => ({}))) as { error?: string }).error;
      this.net.onError?.(e ? t(e) : t('The profile was not saved on the server'));
    } catch {
      this.dirty = true;
      this.net.onError?.(t('The profile was not saved on the server'));
    }
  }

  /** The page is closing with an unsent change: a keepalive request outlives it */
  private beacon(): void {
    if (!this.dirty || !this.data || this.inflight) return;
    this.dirty = false;
    void this.net.api('PUT', '/api/profile', { version: this.version, data: this.data }, true).catch(() => undefined);
  }
}

/** Dev pages without the server (`?dev=playground`, `?map=…` not from the camp): the starter hero in memory */
export class MemoryProfileStore implements ProfileStorage {
  private readonly data: ProfileData;
  constructor(data: ProfileData) { this.data = structuredClone(data); }
  stored(): ProfileData { return this.data; }
  update(f: (d: ProfileData) => void): void { f(this.data); }
}
