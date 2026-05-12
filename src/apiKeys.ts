const K_MAPBOX = 'mr.keys.mapbox.v1';
const K_GOOGLE = 'mr.keys.google.v1';

function readLS(k: string): string {
  try {
    return localStorage.getItem(k) ?? '';
  } catch {
    return '';
  }
}

function writeLS(k: string, v: string): void {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    /* localStorage may be disabled */
  }
}

export function getMapboxToken(): string {
  return readLS(K_MAPBOX) || (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined) || '';
}

export function getGoogleKey(): string {
  return readLS(K_GOOGLE) || (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) || '';
}

export function setMapboxToken(token: string): void {
  writeLS(K_MAPBOX, token.trim());
}

export function setGoogleKey(key: string): void {
  writeLS(K_GOOGLE, key.trim());
}

export function isFromLocalStorage(which: 'mapbox' | 'google'): boolean {
  return !!readLS(which === 'mapbox' ? K_MAPBOX : K_GOOGLE);
}
