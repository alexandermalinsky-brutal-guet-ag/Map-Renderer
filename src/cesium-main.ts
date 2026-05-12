import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { frameAtT, totalDurationSec, unwrapBearings } from './path';
import { createRecorder, downloadBlob } from './recorder';
import { prerender } from './prerender';
import { openAddLocationModal } from './addLocationModal';
import { loadUserLocators, upsertUserLocator } from './locatorStore';
import { adjustKeyframesForTerrain, enforceMinAltAboveTarget } from './terrainSafety';
import { MAP_PACKS_ENABLED, installCesiumFetchInterceptor, openMapPacksModal } from '@internal';
import type { CameraKeyframe, LightPreset, Locator } from './types';

installCesiumFetchInterceptor();

const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
if (!GOOGLE_KEY) {
  document.body.innerHTML =
    '<div style="padding:32px;font:16px system-ui;color:#fff;background:#111;height:100vh">' +
    '<h2>Missing <code>VITE_GOOGLE_MAPS_API_KEY</code></h2>' +
    '<p>Add to <code>.env</code>:</p><pre>VITE_GOOGLE_MAPS_API_KEY=...</pre>' +
    '<p>Also ensure <b>Map Tiles API</b> is enabled in Google Cloud Console.</p>' +
    '</div>';
  throw new Error('VITE_GOOGLE_MAPS_API_KEY not set');
}

Cesium.Ion.defaultAccessToken = '';

const BUILTIN_LOCATORS: Array<{ id: string; name: string; file: string }> = [
  { id: 'emirates', name: 'Emirates Stadium', file: '/locators/emirates.json' },
  { id: 'anfield',  name: 'Anfield',           file: '/locators/anfield.json'  },
];

const statusEl = document.getElementById('status')!;
const playBtn = document.getElementById('play') as HTMLButtonElement;
const recordBtn = document.getElementById('record') as HTMLButtonElement;
const stopBtn = document.getElementById('stop') as HTMLButtonElement;
const locatorSel = document.getElementById('locator-select') as HTMLSelectElement;
const addBtn = document.getElementById('add-location') as HTMLButtonElement | null;
const lightSel = document.getElementById('light-select') as HTMLSelectElement | null;
const markerBtn = document.getElementById('marker-toggle') as HTMLButtonElement | null;
const mapPacksBtn = document.getElementById('map-packs') as HTMLButtonElement | null;
if (!MAP_PACKS_ENABLED) mapPacksBtn?.remove();

function refreshMarkerBtn() {
  if (!markerBtn) return;
  markerBtn.textContent = markerVisible ? '● Marker on' : '○ Marker off';
  markerBtn.style.borderColor = markerVisible ? '#e11d2a' : '#333';
  markerBtn.style.color = markerVisible ? '#ff5c6c' : '#fff';
}

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
    if (!res.ok) throw new Error(`Failed to load ${b.file}`);
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

function applyCesiumLight(preset: LightPreset) {
  const hoursByPreset: Record<LightPreset, number> = { day: 12, dusk: 19, dawn: 6, night: 23 };
  const d = new Date();
  d.setUTCHours(hoursByPreset[preset], 0, 0, 0);
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(d);
  viewer.scene.globe.enableLighting = preset !== 'day';
  viewer.scene.skyAtmosphere.show = true;
}

const viewer = new Cesium.Viewer('map', {
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  timeline: false,
  animation: false,
  navigationHelpButton: false,
  fullscreenButton: false,
  infoBox: false,
  selectionIndicator: false,
  contextOptions: { webgl: { preserveDrawingBuffer: true } },
});
try { viewer.imageryLayers.removeAll(); } catch {}
viewer.scene.globe.show = false;
viewer.scene.skyAtmosphere.show = true;

viewer.useBrowserRecommendedResolution = false;
viewer.resolutionScale = window.devicePixelRatio || 1;
try { (viewer.scene as any).msaaSamples = 4; } catch {}
try { (viewer.scene as any).postProcessStages.fxaa.enabled = true; } catch {}

let googleTileset: Cesium.Cesium3DTileset | null = null;
(async () => {
  try {
    const tileset = await Cesium.createGooglePhotorealistic3DTileset({ key: GOOGLE_KEY });
    viewer.scene.primitives.add(tileset);
    tileset.maximumScreenSpaceError = 8;
    tileset.preferLeaves = true;
    tileset.preloadWhenHidden = true;
    (tileset as any).preloadFlightDestinations = true;
    googleTileset = tileset;
    setStatus('tileset loaded');
  } catch (e: any) {
    setStatus('tileset error: ' + e.message);
    console.error(e);
  }
})();

async function waitForTilesetStable(
  tileset: Cesium.Cesium3DTileset,
  stableFrames = 10,
  maxMs = 30000,
): Promise<void> {
  let lastLoadAt = performance.now();
  const unsub = tileset.tileLoad.addEventListener(() => {
    lastLoadAt = performance.now();
  });
  try {
    for (let i = 0; i < 3; i++) {
      await new Promise(r => requestAnimationFrame(r));
    }
    const t0 = performance.now();
    let stable = 0;
    while (performance.now() - t0 < maxMs) {
      await new Promise(r => requestAnimationFrame(r));
      const s = tileset.statistics as unknown as {
        numberOfPendingRequests?: number;
        numberOfTilesProcessing?: number;
      };
      const pending = (s.numberOfPendingRequests ?? 0) + (s.numberOfTilesProcessing ?? 0);
      const quiet = performance.now() - lastLoadAt > 120;
      if (pending === 0 && tileset.tilesLoaded && quiet) {
        stable++;
        if (stable >= stableFrames) return;
      } else {
        stable = 0;
      }
    }
  } finally {
    unsub();
  }
}

let currentLocator: Locator | null = null;
let cancelPlayback = false;
let markerEntity: Cesium.Entity | null = null;
let markerVisible = true;

function setMarkerForTarget(target: { lng: number; lat: number } | undefined) {
  if (markerEntity) {
    viewer.entities.remove(markerEntity);
    markerEntity = null;
  }
  if (!target) return;
  const POLE_HEIGHT = 80;
  markerEntity = viewer.entities.add({
    name: 'target-marker',
    show: markerVisible,
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArrayHeights([
        target.lng, target.lat, 0,
        target.lng, target.lat, POLE_HEIGHT,
      ]),
      width: 4,
      material: Cesium.Color.fromCssColorString('#e11d2a'),
      clampToGround: false,
    },
    position: Cesium.Cartesian3.fromDegrees(target.lng, target.lat, POLE_HEIGHT + 8),
    point: {
      pixelSize: 18,
      color: Cesium.Color.fromCssColorString('#e11d2a'),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
}

function zoomToAltitudeMeters(zoom: number, lat: number): number {
  const mpp = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
  const vpH = viewer.canvas.clientHeight || 1000;
  const fovY = Cesium.Math.toRadians(60);
  return (mpp * vpH / 2) / Math.tan(fovY / 2);
}

function applyKeyframe(kf: CameraKeyframe) {
  const altitude = zoomToAltitudeMeters(kf.zoom, kf.lat);
  const target = Cesium.Cartesian3.fromDegrees(kf.lng, kf.lat, 0);
  const pitchFromHorizonDeg = Math.max(90 - kf.pitch, 0.5);
  const horiz = altitude / Math.tan(Cesium.Math.toRadians(pitchFromHorizonDeg));
  const bearingRad = Cesium.Math.toRadians(kf.bearing);

  const east = -Math.sin(bearingRad) * horiz;
  const north = -Math.cos(bearingRad) * horiz;
  const up = altitude;

  const enuToFixed = Cesium.Transforms.eastNorthUpToFixedFrame(target);
  const local = new Cesium.Cartesian3(east, north, up);
  const camPos = Cesium.Matrix4.multiplyByPoint(enuToFixed, local, new Cesium.Cartesian3());

  viewer.camera.setView({
    destination: camPos,
    orientation: {
      heading: bearingRad,
      pitch: Cesium.Math.toRadians(kf.pitch - 90),
      roll: 0,
    },
  });
}

async function selectLocator(id: string) {
  setStatus('loading locator…');
  const raw = await resolveLocator(id);
  const minPass = enforceMinAltAboveTarget(raw, { minAltAboveTargetM: 100 });
  currentLocator = minPass.locator;
  if (lightSel) lightSel.value = currentLocator.lightPreset ?? 'day';
  applyCesiumLight((currentLocator.lightPreset ?? 'day') as LightPreset);
  setMarkerForTarget(currentLocator.target);
  applyKeyframe(currentLocator.keyframes[0]);
  const liftMsg = minPass.lifted > 0 ? ` (min-alt: lifted ${minPass.lifted} kf, +${minPass.maxLiftMeters}m)` : '';
  setStatus(`ready: ${currentLocator.name}${liftMsg}`);
}

async function playTimeline(record: boolean) {
  if (!currentLocator) return;
  const loc = currentLocator;

  cancelPlayback = false;
  playBtn.disabled = true; recordBtn.disabled = true; stopBtn.disabled = false;

  applyKeyframe(loc.keyframes[0]);
  await new Promise(r => setTimeout(r, 600));

  const rec = record ? createRecorder(viewer.canvas, loc.fps) : null;
  rec?.start();
  setStatus(record ? 'recording…' : 'playing…');

  const totalMs = totalDurationSec(loc) * 1000;
  const t0 = performance.now();

  await new Promise<void>(resolve => {
    function frame(now: number) {
      if (cancelPlayback) { resolve(); return; }
      const t = Math.min((now - t0) / totalMs, 1);
      applyKeyframe(frameAtT(loc, t));
      if (t >= 1) { resolve(); return; }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });

  if (rec) {
    await new Promise(r => setTimeout(r, 250));
    const blob = await rec.stop();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob(blob, `${loc.id}-cesium-${stamp}.webm`);
    setStatus(`saved ${loc.id}-cesium.webm`);
  } else {
    setStatus('idle');
  }

  playBtn.disabled = false; recordBtn.disabled = false; stopBtn.disabled = true;
}

const prerenderBtn = document.getElementById('prerender') as HTMLButtonElement | null;

async function runPrerender() {
  if (!currentLocator) return;
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
      canvas: viewer.canvas,
      totalFrames,
      fps: loc.fps,
      locatorId: loc.id,
      signal: cancel,
      settleMs: 150,
      applyFrame: async (t) => {
        applyKeyframe(frameAtT(loc, t));
        if (googleTileset) {
          await waitForTilesetStable(googleTileset, 10, 30000);
        } else {
          await new Promise(r => setTimeout(r, 200));
        }
      },
      onProgress: (i, total) => setStatus(`prerender ${i}/${total}`),
    });
    setStatus(`prerender complete — see render.json + encode.sh`);
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
prerenderBtn?.addEventListener('click', () => { runPrerender(); });

markerBtn?.addEventListener('click', () => {
  markerVisible = !markerVisible;
  if (markerEntity) markerEntity.show = markerVisible;
  refreshMarkerBtn();
});
refreshMarkerBtn();

mapPacksBtn?.addEventListener('click', async () => {
  await openMapPacksModal({
    engine: 'cesium',
    applyKeyframe: (kf) => applyKeyframe(kf),
    waitStable: async () => {
      if (googleTileset) {
        await waitForTilesetStable(googleTileset, 6, 8000);
      } else {
        await new Promise(r => setTimeout(r, 200));
      }
    },
  });
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

lightSel?.addEventListener('change', () => {
  applyCesiumLight(lightSel.value as LightPreset);
});

selectLocator(BUILTIN_LOCATORS[0].id).catch(err => {
  console.error(err);
  setStatus('error: ' + err.message);
});
