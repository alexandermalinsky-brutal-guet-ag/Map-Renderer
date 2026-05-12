import * as THREE from 'three';
import mapboxgl from 'mapbox-gl';

type TargetSpec = {
  lng: number;
  lat: number;
  altitude?: number;
  label?: string;
};

export type MarkerLayer = {
  layer: mapboxgl.CustomLayerInterface;
  setVisible: (visible: boolean) => void;
  isVisible: () => boolean;
};

export function createThreeLayer(target: TargetSpec): MarkerLayer {
  const altitude = target.altitude ?? 0;
  const originMerc = mapboxgl.MercatorCoordinate.fromLngLat(
    [target.lng, target.lat],
    altitude,
  );
  const metersToMerc = originMerc.meterInMercatorCoordinateUnits();

  let map: mapboxgl.Map;
  let camera: THREE.Camera;
  let scene: THREE.Scene;
  let renderer: THREE.WebGLRenderer;
  let group: THREE.Group | null = null;
  let visible = true;

  const layer: mapboxgl.CustomLayerInterface = {
    id: 'three-target',
    type: 'custom' as const,
    renderingMode: '3d' as const,

    onAdd(m, gl) {
      map = m;
      camera = new THREE.Camera();
      scene = new THREE.Scene();

      const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
      keyLight.position.set(0.6, 0.8, 1).normalize();
      scene.add(keyLight);

      const fillLight = new THREE.DirectionalLight(0xaabbff, 0.5);
      fillLight.position.set(-1, -0.4, 0.6).normalize();
      scene.add(fillLight);

      scene.add(new THREE.AmbientLight(0xffffff, 0.35));

      group = new THREE.Group();

      const redMat = new THREE.MeshStandardMaterial({
        color: 0xe11d2a,
        emissive: 0x550008,
        emissiveIntensity: 0.6,
        metalness: 0.2,
        roughness: 0.4,
      });

      const poleHeight = 80;
      const poleGeo = new THREE.CylinderGeometry(2.5, 2.5, poleHeight, 16);
      const pole = new THREE.Mesh(poleGeo, redMat);
      pole.position.set(0, 0, poleHeight / 2);
      pole.rotation.x = Math.PI / 2;
      group.add(pole);

      const sphereGeo = new THREE.SphereGeometry(10, 32, 24);
      const sphere = new THREE.Mesh(sphereGeo, redMat);
      sphere.position.set(0, 0, poleHeight + 8);
      group.add(sphere);

      const ringGeo = new THREE.TorusGeometry(14, 1.5, 12, 48);
      const ringMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 0.7,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(0, 0, poleHeight + 8);
      group.add(ring);

      group.visible = visible;
      scene.add(group);

      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
      });
      renderer.autoClear = false;
    },

    render(_gl, matrix) {
      const rotX = new THREE.Matrix4().makeRotationAxis(
        new THREE.Vector3(1, 0, 0),
        Math.PI / 2,
      );

      const model = new THREE.Matrix4()
        .makeTranslation(originMerc.x, originMerc.y, originMerc.z ?? 0)
        .scale(new THREE.Vector3(metersToMerc, -metersToMerc, metersToMerc))
        .multiply(rotX);

      const proj = new THREE.Matrix4().fromArray(matrix as unknown as number[]);
      camera.projectionMatrix = proj.multiply(model);

      renderer.resetState();
      renderer.render(scene, camera);
      map.triggerRepaint();
    },
  };

  return {
    layer,
    setVisible(v: boolean) {
      visible = v;
      if (group) group.visible = v;
      try { map?.triggerRepaint(); } catch {}
    },
    isVisible() { return visible; },
  };
}
