import { CFG } from './config';
import { WEAPONS, type WeaponId } from './weapons';

/** То, что игрок уносит из миссии в миссию */
export interface Profile {
  /** Малина — валюта лобби */
  berries: number;
  /** Уровень каждого ствола, 0 — не куплен */
  levels: Record<WeaponId, number>;
  /** Сколько миссий пройдено до конца */
  cleared: number;
}

const KEY = 'malina-profile-v1';

function fresh(): Profile {
  return {
    berries: CFG.START_BERRIES,
    levels: Object.fromEntries(WEAPONS.map((w) => [w.id, w.price === 0 ? 1 : 0])) as Record<WeaponId, number>,
    cleared: 0,
  };
}

export function loadProfile(): Profile {
  const base = fresh();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<Profile>;
    return {
      berries: typeof p.berries === 'number' ? p.berries : base.berries,
      levels: { ...base.levels, ...(p.levels ?? {}) },
      cleared: typeof p.cleared === 'number' ? p.cleared : 0,
    };
  } catch {
    return base;
  }
}

export function saveProfile(p: Profile): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* хранилище недоступно — профиль живёт до перезагрузки */ }
}

export function resetProfile(): Profile {
  const p = fresh();
  saveProfile(p);
  return p;
}
