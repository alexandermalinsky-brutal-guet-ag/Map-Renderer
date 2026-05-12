import mapboxgl from 'mapbox-gl';
import { frameAtT, totalDurationSec, unwrapBearings } from './path';
import { createThreeLayer, type MarkerLayer } from './threeLayer';
import { createRecorder, downloadBlob } from './recorder';
import { prerender } from './prerender';
import { openAddLocationModal } from './addLocationModal';
import { loadUserLocators, upsertUserLocator } from './locatorStore';
import { adjustKeyframesForTerrain, enforceMinAltAboveTarget } from './terrainSafety';
import { MAP_PACKS_ENABLED, loadAllBlobUrls, lookupBlobUrl, openMapPacksModal } from '@internal';
import type { LightPreset, Locator } from './types';

const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
if (!TOKEN) {
  document.body.innerHTML =
    '<div style="padding:32px;font:16px system-ui;color:#fff;background:#111;height:100vh">' +
    '<h2>Missing <code>VITE_MAPBOX_TOKEN</code></h2>' +
    '<p>Create a <code>.env</code> file in the project root with:</p>' +
    '<pre>VITE_MAPBOX_TOKEN=pk.your_mapbox_public_token</pre>' +
    '<p>Get one at <a style="color:#6af" href="https://account.mapbox.com/">account.mapbox.com</a>, then restart <code>npm run dev</code>.</p>' +
    '</div>';
  throw new Error('VITE_MAPBOX_TOKEN not set');
}
mapboxgl.accessToken = TOKEN;

const BUILTIN_LOCATORS: Array<{ id: string; name: string; file: string }> = [
  { id: 'emirates', name: 'Emirates Stadium', file: '/locators/emirates.json' },
  { id: 'anfield',  name: 'Anfield',           file: '/locators/anfield.json'  },
];

const statusEl = document.getElementById('status')!;
const playBtn = document.getElementById('play') as HTMLButtonElement;
const recordBtn = document.getElementById('record') as HTMLButtonElement;
const stopBtn = document.getElementById('stop') as HTMLButtonElement;
const locatorSel = document.getElementById('locator-select') as HTMLSelectElement;
const lightSel = document.getElementById('light-select') as HTMLSelectElement;
const styleSel = document.getElementById('style-select') as HTMLSelectElement;
const addBtn = document.getElementById('add-location') as HTMLButtonElement | null;
const markerBtn = document.getElementById('marker-toggle') as HTMLButtonElement | null;
const mapPacksBtn = document.getElementById('map-packs') as HTMLButtonElement | null;
if (!MAP_PACKS_ENABLED) mapPacksBtn?.remove();

function refreshMarkerBtn() {
  if (!markerBtn) return;
  markerBtn.textContent = markerVisible ? '● Marker on' : '○ Marker off';
  markerBtn.style.borderColor = markerVisible ? '#e11d2a' : '#333';
  markerBtn.style.color = markerVisible ? '#ff5c6c' : '#fff';
}
refreshMarkerBtn();

function rebuildLocatorOptions(preserveId?: string) {
  locatorSel.innerHTML = '';
  for (const b of BUILTIN_LOCATORS) {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.name;
    locatorSel.appendChild(opt);
  }
  const user = loadUserLocators();
  if (user.length > 0) {
    const sep = document.createElement('option');
    sep.disabled = true;
    sep.textContent = '────────';
    locatorSel.appendChild(sep);
    for (const u of user) {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.name + ' ★';
      locatorSel.appendChild(opt);
    }
  }
  if (preserveId) locatorSel.value = preserveId;
}
rebuildLocatorOptions();

function setStatus(s: string) { statusEl.textContent = s; }

async function resolveLocator(id: string): Promise<Locator> {
  const b = BUILTIN_LOCATORS.find(x => x.id === id);
  if (b) {
    const res = await fetch(b.file);
    if (!res.ok) throw new Error(`Failed to load ${b.file}: ${res.status}`);
    const loc = await res.json() as Locator;
    loc.keyframes = unwrapBearings(loc.keyframes);
    return loc;
  }
  const u = loadUserLocators().find(x => x.id === id);
  if (u) {
    const clone = JSON.parse(JSON.stringify(u)) as Locator;
    clone.keyframes = unwrapBearings(clone.keyframes);
    return clone;
  }
  throw new Error('Locator not found: ' + id);
}

let map: mapboxgl.Map | null = null;
let currentLocator: Locator | null = null;
let markerLayer: MarkerLayer | null = null;
let markerVisible = true;
let cancelPlayback = false;

function applyLight(m: mapboxgl.Map, preset: LightPreset) {
  try { m.setConfigProperty('basemap', 'lightPreset', preset); } catch {}
}

function jumpCameraToStart(m: mapboxgl.Map, loc: Locator) {
  const k = loc.keyframes[0];
  m.jumpTo({ center: [k.lng, k.lat], zoom: k.zoom, bearing: k.bearing, pitch: k.pitch });
}

async function buildMap(loc: Locator) {
  if (map) { map.remove(); map = null; }

  const first = loc.keyframes[0];
  map = new mapboxgl.Map({
    container: 'map',
    style: styleSel.value,
    center: [first.lng, first.lat],
    zoom: first.zoom,
    bearing: first.bearing,
    pitch: first.pitch,
    antialias: true,
    preserveDrawingBuffer: true,
    transformRequest: (url) => {
      const cached = lookupBlobUrl(url);
      return cached ? { url: cached } : { url };
    },
  });

  const m = map;
  await new Promise<void>(resolve => m.once('style.load', () => resolve()));

  applyLight(m, (lightSel.value as LightPreset) || loc.lightPreset || 'day');
  try { m.setConfigProperty('basemap', 'show3dObjects', true); } catch {}

  if (!m.getSource('mapbox-dem')) {
    m.addSource('mapbox-dem', {
      type: 'raster-dem',
      url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
      tileSize: 512,
      maxzoom: 14,
    });
  }
  m.setTerrain({ source: 'mapbox-dem', exaggeration: 1.2 });

  if (loc.target) {
    markerLayer = createThreeLayer(loc.target);
    m.addLayer(markerLayer.layer);
    markerLayer.setVisible(markerVisible);
  } else {
    markerLayer = null;
  }

  await new Promise<void>(resolve => {
    if (m.loaded()) resolve();
    else m.once('idle', () => resolve());
  });
}

async function selectLocator(id: string) {
  setStatus('loading…');
  const raw = await resolveLocator(id);
  const minPass = enforceMinAltAboveTarget(raw, { minAltAboveTargetM: 100 });
  currentLocator = minPass.locator;
  lightSel.value = currentLocator.lightPreset ?? 'day';
  await buildMap(currentLocator);
  const liftMsg = minPass.lifted > 0 ? ` (min-alt: lifted ${minPass.lifted} kf, +${minPass.maxLiftMeters}m)` : '';
  setStatus(`ready: ${currentLocator.name}${liftMsg}`);
}

async function playTimeline(record: boolean) {
  if (!map || !currentLocator) return;
  const m = map;
  const loc = currentLocator;

  cancelPlayback = false;
  playBtn.disabled = true;
  recordBtn.disabled = true;
  stopBtn.disabled = false;

  jumpCameraToStart(m, loc);
  await new Promise<void>(resolve => m.once('idle', () => resolve()));

  const rec = record ? createRecorder(m.getCanvas(), loc.fps) : null;
  rec?.start();
  setStatus(record ? 'recording…' : 'playing…');

  const totalMs = totalDurationSec(loc) * 1000;
  const t0 = performance.now();

  await new Promise<void>(resolve => {
    function frame(now: number) {
      if (cancelPlayback) { resolve(); return; }
      const t = Math.min((now - t0) / totalMs, 1);
      const kf = frameAtT(loc, t);
      m.jumpTo({
        center: [kf.lng, kf.lat],
        zoom: kf.zoom,
        bearing: kf.bearing,
        pitch: kf.pitch,
      });
      if (t >= 1) { resolve(); return; }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });

  if (rec) {
    await new Promise(r => setTimeout(r, 250));
    const blob = await rec.stop();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob(blob, `${loc.id}-${lightSel.value}-${stamp}.webm`);
    setStatus(`saved ${loc.id}-${lightSel.value}.webm`);
  } else {
    setStatus('idle');
  }

  playBtn.disabled = false;
  recordBtn.disabled = false;
  stopBtn.disabled = true;
}

const prerenderBtn = document.getElementById('prerender') as HTMLButtonElement | null;

async function waitForMapIdle(
  m: mapboxgl.Map,
  stableFrames = 6,
  maxMs = 30000,
): Promise<void> {
  await new Promise<void>(resolve => {
    const check = () => {
      if (m.areTilesLoaded() && !m.isMoving() && !m.isZooming() && !m.isRotating()) {
        resolve();
      } else {
        m.once('idle', check);
      }
    };
    check();
  });
  const t0 = performance.now();
  let stable = 0;
  while (performance.now() - t0 < maxMs) {
    await new Promise(r => requestAnimationFrame(r));
    const ok =
      m.areTilesLoaded() &&
      m.loaded() &&
      !m.isMoving() && !m.isZooming() && !m.isRotating() && !m.isEasing();
    if (ok) {
      stable++;
      if (stable >= stableFrames) return;
    } else {
      stable = 0;
    }
  }
}

async function runPrerender() {
  if (!map || !currentLocator) return;
  const m = map;
  const loc = currentLocator;
  const totalFrames = Math.max(1, Math.round(totalDurationSec(loc) * loc.fps));

  const cancel = { cancelled: false };
  const prevStop = stopBtn.onclick;
  stopBtn.onclick = () => { cancel.cancelled = true; };

  playBtn.disabled = true;
  recordBtn.disabled = true;
  if (prerenderBtn) prerenderBtn.disabled = true;
  stopBtn.disabled = false;

  try {
    await prerender({
      canvas: m.getCanvas(),
      totalFrames,
      fps: loc.fps,
      locatorId: loc.id,
      signal: cancel,
      settleMs: 150,
      applyFrame: async (t) => {
        const kf = frameAtT(loc, t);
        m.jumpTo({
          center: [kf.lng, kf.lat],
          zoom: kf.zoom,
          bearing: kf.bearing,
          pitch: kf.pitch,
        });
        await waitForMapIdle(m);
      },
      onProgress: (i, total) => setStatus(`prerender ${i}/${total}`),
    });
    setStatus('prerender complete — see render.json + encode.sh');
  } catch (e: any) {
    setStatus('prerender error: ' + e.message);
    console.error(e);
  } finally {
    playBtn.disabled = false;
    recordBtn.disabled = false;
    if (prerenderBtn) prerenderBtn.disabled = false;
    stopBtn.disabled = true;
    stopBtn.onclick = prevStop;
  }
}

playBtn.addEventListener('click', () => { playTimeline(false); });
recordBtn.addEventListener('click', () => { playTimeline(true); });
stopBtn.addEventListener('click', () => { cancelPlayback = true; });
locatorSel.addEventListener('change', () => { selectLocator(locatorSel.value); });
lightSel.addEventListener('change', () => {
  if (map) applyLight(map, lightSel.value as LightPreset);
});
styleSel.addEventListener('change', () => {
  if (currentLocator) buildMap(currentLocator);
});
prerenderBtn?.addEventListener('click', () => { runPrerender(); });

markerBtn?.addEventListener('click', () => {
  markerVisible = !markerVisible;
  markerLayer?.setVisible(markerVisible);
  refreshMarkerBtn();
});

mapPacksBtn?.addEventListener('click', async () => {
  await openMapPacksModal({ engine: 'mapbox', token: TOKEN });
});

addBtn?.addEventListener('click', async () => {
  const loc = await openAddLocationModal();
  if (!loc) return;
  let safeLoc = loc;
  if (GOOGLE_KEY) {
    setStatus('checking terrain clearance…');
    try {
      const result = await adjustKeyframesForTerrain(loc, GOOGLE_KEY, { clearanceM: 100, minAltAboveTargetM: 100 });
      safeLoc = result.locator;
      const r = result.report;
      if (r.liftedKeyframes > 0) {
        setStatus(`lifted ${r.liftedKeyframes} keyframe(s) up to ${r.maxLiftMeters}m for terrain`);
      }
    } catch (e: any) {
      console.warn('terrain check failed:', e);
      setStatus('terrain check skipped: ' + e.message);
    }
  }
  upsertUserLocator(safeLoc);
  rebuildLocatorOptions(safeLoc.id);
  await selectLocator(safeLoc.id);
});

(async () => {
  try {
    const cachedCount = await loadAllBlobUrls();
    if (cachedCount > 0) console.info(`tile cache: ${cachedCount} entries`);
  } catch (e) {
    console.warn('tile cache init failed:', e);
  }
  await selectLocator(BUILTIN_LOCATORS[0].id);
})().catch(err => {
  console.error(err);
  setStatus('error: ' + err.message);
});
