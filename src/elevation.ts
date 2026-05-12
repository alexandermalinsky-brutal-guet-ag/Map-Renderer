const ELEVATION_URL = 'https://maps.googleapis.com/maps/api/elevation/json';

export type ElevationPoint = { lng: number; lat: number };

export async function fetchElevations(
  apiKey: string,
  points: ElevationPoint[],
): Promise<number[]> {
  if (points.length === 0) return [];

  const out: number[] = [];
  const CHUNK = 256;
  for (let i = 0; i < points.length; i += CHUNK) {
    const chunk = points.slice(i, i + CHUNK);
    const locations = chunk.map(p => `${p.lat},${p.lng}`).join('|');
    const url = `${ELEVATION_URL}?locations=${encodeURIComponent(locations)}&key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Elevation HTTP ${res.status}`);
    const data = await res.json() as {
      status: string;
      error_message?: string;
      results: Array<{ elevation: number; location: { lat: number; lng: number }; resolution: number }>;
    };
    if (data.status !== 'OK') {
      const hint = data.status === 'REQUEST_DENIED'
        ? ' — enable "Elevation API" on this Google Cloud project'
        : '';
      throw new Error(`Elevation API: ${data.status}${hint}${data.error_message ? ' — ' + data.error_message : ''}`);
    }
    for (const r of data.results) out.push(r.elevation);
  }
  return out;
}
