import type { CameraKeyframe, Locator } from './types';

export function unwrapBearings(kfs: CameraKeyframe[]): CameraKeyframe[] {
  const out = kfs.map(k => ({ ...k }));
  for (let i = 1; i < out.length; i++) {
    let d = out[i].bearing - out[i - 1].bearing;
    while (d > 180) { out[i].bearing -= 360; d = out[i].bearing - out[i - 1].bearing; }
    while (d < -180) { out[i].bearing += 360; d = out[i].bearing - out[i - 1].bearing; }
  }
  return out;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

const CHANNELS = ['lng', 'lat', 'zoom', 'bearing', 'pitch'] as const;

export function interpolateKeyframes(kfs: CameraKeyframe[], t: number): CameraKeyframe {
  if (kfs.length === 0) throw new Error('No keyframes');
  if (kfs.length === 1) return { ...kfs[0] };
  if (t <= 0) return { ...kfs[0] };
  if (t >= 1) return { ...kfs[kfs.length - 1] };

  const eased = smoothstep(t);
  const segCount = kfs.length - 1;
  const segF = eased * segCount;
  const i = Math.min(Math.floor(segF), segCount - 1);
  const localT = segF - i;

  const p0 = kfs[Math.max(i - 1, 0)];
  const p1 = kfs[i];
  const p2 = kfs[i + 1];
  const p3 = kfs[Math.min(i + 2, kfs.length - 1)];

  const out = {} as CameraKeyframe;
  for (const ch of CHANNELS) {
    out[ch] = catmullRom(p0[ch], p1[ch], p2[ch], p3[ch], localT);
  }
  return out;
}

const DEFAULT_ORBIT_DURATION = 14;
const DEFAULT_ORBIT_DEGREES = 360;

export function isOrbitEnabled(loc: Locator): boolean {
  return loc.orbit?.enabled !== false;
}

export function getOrbitDuration(loc: Locator): number {
  if (!isOrbitEnabled(loc)) return 0;
  return loc.orbit?.durationSec ?? DEFAULT_ORBIT_DURATION;
}

export function totalDurationSec(loc: Locator): number {
  return loc.duration + getOrbitDuration(loc);
}

export function frameAtT(loc: Locator, t: number): CameraKeyframe {
  const orbitDur = getOrbitDuration(loc);
  if (orbitDur <= 0) {
    return interpolateKeyframes(loc.keyframes, t);
  }
  const total = loc.duration + orbitDur;
  const flyoverFrac = loc.duration / total;
  if (t <= flyoverFrac) {
    const fT = flyoverFrac > 0 ? t / flyoverFrac : 1;
    return interpolateKeyframes(loc.keyframes, fT);
  }
  const oT = (t - flyoverFrac) / Math.max(1 - flyoverFrac, 1e-6);
  const finalKf = loc.keyframes[loc.keyframes.length - 1];
  const degrees = loc.orbit?.degrees ?? DEFAULT_ORBIT_DEGREES;
  const eased = orbitEase(oT);
  return { ...finalKf, bearing: finalKf.bearing + eased * degrees };
}

function orbitEase(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const RAMP = 0.18;
  const V = 1 / (1 - RAMP);
  if (t < RAMP) {
    return V * t * t / (2 * RAMP);
  }
  if (t > 1 - RAMP) {
    const u = 1 - t;
    return 1 - V * u * u / (2 * RAMP);
  }
  return V * (t - RAMP / 2);
}
