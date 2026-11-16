// The sandstorm: SANDLINE's signature weather. A storm rolls across the yard
// mid-round, closes the fog to a few metres, dims the sun and fills the air
// with driven sand. Fights go close-quarters while it lasts, then the yard
// opens up again. The sim decides WHEN a storm comes; this module owns what
// it looks like. No objects are allocated per frame: the dust is one Points
// cloud whose positions are recycled in place.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const DUST_COUNT = 1400;
const CALM_FOG = { near: 42, far: 115 };
const STORM_FOG = { near: 7, far: 34 };

export function createStorm(scene, lights) {
  const { sun, sky, sunDisc } = lights;
  // The sim owns the storm clock and eases this number; this module only
  // applies it to the scene. 0 = clear dusk, 1 = full storm.
  let intensity = 0;

  const calmSky = new THREE.Color(PALETTE.sky);
  const stormSky = new THREE.Color('#a86f3c');
  const calmFog = new THREE.Color(PALETTE.sky);
  const stormFog = new THREE.Color('#b57a42');
  const workColor = new THREE.Color();

  // Driven sand: one Points cloud, particles streaming west to east.
  const positions = new Float32Array(DUST_COUNT * 3);
  const speeds = new Float32Array(DUST_COUNT);
  for (let i = 0; i < DUST_COUNT; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 48;
    positions[i * 3 + 1] = 0.2 + Math.random() * 7;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 40;
    speeds[i] = 9 + Math.random() * 14;
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const dustMaterial = new THREE.PointsMaterial({
    color: new THREE.Color('#d9a05e'), size: 0.32, transparent: true, opacity: 0, depthWrite: false,
  });
  const dust = new THREE.Points(dustGeometry, dustMaterial);
  dust.visible = false;
  scene.add(dust);

  function apply() {
    const fog = scene.fog;
    fog.near = CALM_FOG.near + (STORM_FOG.near - CALM_FOG.near) * intensity;
    fog.far = CALM_FOG.far + (STORM_FOG.far - CALM_FOG.far) * intensity;
    workColor.copy(calmFog).lerp(stormFog, intensity);
    fog.color.copy(workColor);
    if (scene.background && scene.background.isColor) {
      scene.background.copy(calmSky).lerp(stormSky, intensity);
    }
    sun.intensity = 2.4 - 1.6 * intensity;
    sky.intensity = 0.75 - 0.3 * intensity;
    if (sunDisc) sunDisc.visible = intensity < 0.55;
    dust.visible = intensity > 0.02;
    dustMaterial.opacity = 0.85 * intensity;
  }

  return {
    get intensity() {
      return intensity;
    },
    // Set the storm strength (0..1) and apply it to fog, light and dust at once.
    setIntensity(value) {
      intensity = Math.max(0, Math.min(1, value));
      apply();
    },
    // Stream the driven sand. Called every frame; cheap when the sky is clear.
    update(dt) {
      if (!dust.visible) return;
      const array = dustGeometry.attributes.position.array;
      const dx = dt * (6 + 26 * intensity);
      for (let i = 0; i < DUST_COUNT; i += 1) {
        let x = array[i * 3] + dx * (speeds[i] / 16);
        if (x > 24) x -= 48;
        array[i * 3] = x;
        array[i * 3 + 1] += Math.sin(i * 1.7 + performance.now() * 0.0004) * 0.002;
      }
      dustGeometry.attributes.position.needsUpdate = true;
    },
    reset() {
      intensity = 0;
      apply();
    },
  };
}
