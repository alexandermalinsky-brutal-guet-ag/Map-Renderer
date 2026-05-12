import type { Locator } from './types';

const KEY = 'mr.userLocators.v1';

export function loadUserLocators(): Locator[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as Locator[] : [];
  } catch {
    return [];
  }
}

export function saveUserLocators(list: Locator[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function upsertUserLocator(loc: Locator): Locator[] {
  const list = loadUserLocators();
  const idx = list.findIndex(l => l.id === loc.id);
  if (idx >= 0) list[idx] = loc;
  else list.push(loc);
  saveUserLocators(list);
  return list;
}

export function removeUserLocator(id: string): Locator[] {
  const list = loadUserLocators().filter(l => l.id !== id);
  saveUserLocators(list);
  return list;
}
