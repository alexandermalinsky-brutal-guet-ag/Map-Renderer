import { fetchElevations } from './elevation';
import type { CameraKeyframe, Locator } from './types';

const FOV_DEG = 60;
const MERC_C = 156543.03392;
const MAX_ITER = 3;
const MAX_TOTAL_LIFT_M = 8000;

function cameraGeo(
  kf: CameraKeyframe,
  canvasHeightPx: number,
): { lng: number; lat: number; altAboveTarget: number } {
  const lat = kf.lat;
  const mpp = MERC_C * Math.cos(lat * Math.PI / 180) / Math.pow(2, kf.zoom);
  const viewportH = mpp * canvasHeightPx;
  const halfFov = (FOV_DEG / 2) * Math.PI / 180;
  const distance = (viewportH / 2) / Math.tan(halfFov);
  const pitchRad = kf.pitch * Math.PI / 180;
  const altAboveTarget = distance * Math.cos(pitchRad);
  const horizOffset = distance * Math.sin(pitchRad);
  const bearingRad = kf.bearing * Math.PI / 180;
  const east = -Math.sin(bearingRad) * horizOffset;
  const north = -Math.cos(bearingRad) * horizOffset;
  const dlat = north / 111000;
  const dlng = east / (111000 * Math.max(Math.cos(lat * Math.PI / 180), 0.1));
  return { lng: kf.lng + dlng, lat: kf.lat + dlat, altAboveTarget };
}

function liftKeyframeByAltitude(kf: CameraKeyframe, currentAlt: number, requiredAlt: number, canvasHeightPx: number): CameraKeyframe {
  const factor = requiredAlt / Math.max(currentAlt, 1);
  const dz = Math.log2(factor);
  return { ...kf, zoom: Math.max(2, kf.zoom - dz) };
}

export type TerrainSafetyOptions = {
  canvasHeightPx?: number;
  clearanceM?: number;
  minAltAboveTargetM?: number;
  samplesBetween?: number;
  onProbeCount?: (n: number) => void;
};

export type TerrainSafetyReport = {
  liftedKeyframes: number;
  maxLiftMeters: number;
  probesSampled: number;
  minAltLifts: number;
};

export function enforceMinAltAboveTarget(
  locator: Locator,
  opts: { canvasHeightPx?: number; minAltAboveTargetM?: number } = {},
): { locator: Locator; lifted: number; maxLiftMeters: number } {
  const canvasH = opts.canvasHeightPx ?? Math.max(window.innerHeight, 720);
  const minAlt = opts.minAltAboveTargetM ?? 100;
  const kfs = locator.keyframes.map(k => ({ ...k }));
  let lifted = 0;
  let maxLift = 0;
  for (let i = 0; i < kfs.length; i++) {
    const cg = cameraGeo(kfs[i], canvasH);
    if (cg.altAboveTarget < minAlt) {
      const need = minAlt - cg.altAboveTarget;
      maxLift = Math.max(maxLift, need);
      kfs[i] = liftKeyframeByAltitude(kfs[i], cg.altAboveTarget, minAlt, canvasH);
      lifted++;
    }
  }
  return { locator: { ...locator, keyframes: kfs }, lifted, maxLiftMeters: Math.round(maxLift) };
}

export async function adjustKeyframesForTerrain(
  locator: Locator,
  apiKey: string,
  opts: TerrainSafetyOptions = {},
): Promise<{ locator: Locator; report: TerrainSafetyReport }> {
  const canvasH = opts.canvasHeightPx ?? Math.max(window.innerHeight, 720);
  const clearance = opts.clearanceM ?? 100;
  const minAltAboveTarget = opts.minAltAboveTargetM ?? 100;
  const samplesBetween = opts.samplesBetween ?? 4;

  const minPass = enforceMinAltAboveTarget(locator, { canvasHeightPx: canvasH, minAltAboveTargetM: minAltAboveTarget });
  let kfs = minPass.locator.keyframes.map(k => ({ ...k }));
  const target = locator.target ?? { lng: kfs[kfs.length - 1].lng, lat: kfs[kfs.length - 1].lat };

  let liftedCount = 0;
  let maxLift = minPass.maxLiftMeters;
  let probesSampled = 0;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    type Probe = { kfIndex: number; lng: number; lat: number; altAboveTarget: number };
    const probes: Probe[] = [];

    for (let i = 0; i < kfs.length; i++) {
      const cg = cameraGeo(kfs[i], canvasH);
      probes.push({ kfIndex: i, ...cg });
      if (i < kfs.length - 1) {
        for (let s = 1; s <= samplesBetween; s++) {
          const t = s / (samplesBetween + 1);
          const lerpKf: CameraKeyframe = {
            lng: kfs[i].lng + t * (kfs[i + 1].lng - kfs[i].lng),
            lat: kfs[i].lat + t * (kfs[i + 1].lat - kfs[i].lat),
            zoom: kfs[i].zoom + t * (kfs[i + 1].zoom - kfs[i].zoom),
            bearing: kfs[i].bearing + t * (kfs[i + 1].bearing - kfs[i].bearing),
            pitch: kfs[i].pitch + t * (kfs[i + 1].pitch - kfs[i].pitch),
          };
          const cg2 = cameraGeo(lerpKf, canvasH);
          const ki = t < 0.5 ? i : i + 1;
          probes.push({ kfIndex: ki, ...cg2 });
        }
      }
    }

    const points = [
      { lat: target.lat, lng: target.lng },
      ...probes.map(p => ({ lat: p.lat, lng: p.lng })),
    ];
    probesSampled += points.length;
    opts.onProbeCount?.(points.length);

    const elevations = await fetchElevations(apiKey, points);
    const targetElev = elevations[0];
    const probeElevs = elevations.slice(1);

    const liftPerKf = new Array(kfs.length).fill(0);
    let anyLifts = false;
    for (let p = 0; p < probes.length; p++) {
      const probe = probes[p];
      const camAbsAlt = targetElev + probe.altAboveTarget;
      const required = probeElevs[p] + clearance;
      if (camAbsAlt < required) {
        const need = required - camAbsAlt;
        if (need > liftPerKf[probe.kfIndex]) liftPerKf[probe.kfIndex] = need;
        anyLifts = true;
      }
    }

    if (!anyLifts) break;

    kfs = kfs.map((kf, i) => {
      if (liftPerKf[i] <= 0) return kf;
      const cg = cameraGeo(kf, canvasH);
      const currentAlt = cg.altAboveTarget;
      const cappedLift = Math.min(liftPerKf[i], MAX_TOTAL_LIFT_M);
      maxLift = Math.max(maxLift, cappedLift);
      if (iter === 0) liftedCount++;
      return liftKeyframeByAltitude(kf, currentAlt, currentAlt + cappedLift, canvasH);
    });
  }

  return {
    locator: { ...locator, keyframes: kfs },
    report: {
      liftedKeyframes: liftedCount,
      maxLiftMeters: Math.round(maxLift),
      probesSampled,
      minAltLifts: minPass.lifted,
    },
  };
}
