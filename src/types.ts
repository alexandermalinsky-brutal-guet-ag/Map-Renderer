export type CameraKeyframe = {
  lng: number;
  lat: number;
  zoom: number;
  bearing: number;
  pitch: number;
};

export type LightPreset = 'day' | 'dusk' | 'dawn' | 'night';

export type OrbitConfig = {
  enabled?: boolean;
  durationSec?: number;
  degrees?: number;
};

export type Locator = {
  id: string;
  name: string;
  duration: number;
  fps: number;
  lightPreset?: LightPreset;
  target?: {
    lng: number;
    lat: number;
    altitude?: number;
    label?: string;
  };
  keyframes: CameraKeyframe[];
  orbit?: OrbitConfig;
};
