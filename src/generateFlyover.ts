import type { CameraKeyframe, LightPreset, Locator } from './types';

const FOV_DEG_FOR_GEN = 60;
const REFERENCE_CANVAS_HEIGHT = 1080;

export function zoomForAltAndPitch(args: {
  lat: number;
  altAboveTarget: number;
  pitchDeg: number;
  canvasHeightPx?: number;
}): number {
  const canvasH = args.canvasHeightPx ?? REFERENCE_CANVAS_HEIGHT;
  const halfFov = (FOV_DEG_FOR_GEN / 2) * Math.PI / 180;
  const pitchRad = args.pitchDeg * Math.PI / 180;
  const latRad = args.lat * Math.PI / 180;
  const cosPitch = Math.max(Math.cos(pitchRad), 0.05);
  const distance = args.altAboveTarget / cosPitch;
  const mppNeeded = (distance * Math.tan(halfFov) * 2) / canvasH;
  return Math.log2(156543.03392 * Math.cos(latRad) / mppNeeded);
}

export function generateFlyoverKeyframes(target: { lng: number; lat: number }): CameraKeyframe[] {
  const lngScale = 1 / Math.max(Math.cos(target.lat * Math.PI / 180), 0.2);
  const SQRT2_INV = Math.SQRT1_2;

  const offsetsKm = [200, 110, 40, 8];
  const zooms    = [5.2,  8.5, 12.0, 15.0];
  const pitches  = [0,    40,  60,   65];
  const bearings = [0,    20,  40,   55];

  const farKfs = offsetsKm.map((km, i) => {
    const dlat = (km / 111) * SQRT2_INV;
    const dlng = (km / 111) * -SQRT2_INV * lngScale;
    return {
      lng: target.lng + dlng,
      lat: target.lat + dlat,
      zoom: zooms[i],
      bearing: bearings[i],
      pitch: pitches[i],
    };
  });

  const finalPitch = 45;
  const finalKf: CameraKeyframe = {
    lng: target.lng,
    lat: target.lat,
    zoom: zoomForAltAndPitch({ lat: target.lat, altAboveTarget: 100, pitchDeg: finalPitch }),
    bearing: 75,
    pitch: finalPitch,
  };

  return [...farKfs, finalKf];
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `loc-${Date.now()}`;
}

export function makeLocator(args: {
  id?: string;
  name: string;
  lng: number;
  lat: number;
  duration?: number;
  fps?: number;
  lightPreset?: LightPreset;
}): Locator {
  return {
    id: args.id ?? slugify(args.name),
    name: args.name,
    duration: args.duration ?? 9,
    fps: args.fps ?? 30,
    lightPreset: args.lightPreset ?? 'day',
    target: { lng: args.lng, lat: args.lat, altitude: 0, label: args.name },
    keyframes: generateFlyoverKeyframes({ lng: args.lng, lat: args.lat }),
    orbit: { enabled: true, durationSec: 14, degrees: 360 },
  };
}
