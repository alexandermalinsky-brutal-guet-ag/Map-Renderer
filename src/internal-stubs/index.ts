import type { CameraKeyframe } from '../types';

export const MAP_PACKS_ENABLED = false;

export async function loadAllBlobUrls(): Promise<number> {
  return 0;
}

export function lookupBlobUrl(_url: string): string | undefined {
  return undefined;
}

export function installCesiumFetchInterceptor(): void {
  /* no-op in public build */
}

export type PacksContext =
  | { engine: 'mapbox'; token: string }
  | {
      engine: 'cesium';
      applyKeyframe: (kf: CameraKeyframe) => void;
      waitStable: () => Promise<void>;
    };

export async function openMapPacksModal(_ctx: PacksContext): Promise<void> {
  /* no-op in public build */
}
