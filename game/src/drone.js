// FALCON, the pulse drone: the player's recon gadget. Press T to launch it
// (one charge per round, a second costs $400 in the buy menu). The drone climbs
// above the launch point, hovers for 12 seconds and fires a pulse every 4
// seconds: every living enemy inside 48 metres is revealed through walls for
// 4 seconds — red diamonds on screen and red dots on the minimap. The drone is
// a real object in the world with a blinking beacon, so the enemy team sees it
// coming; the pulses are the only thing it does, and it never shoots.
import * as THREE from 'three';

const HOVER_HEIGHT = 9;
const PULSE_RANGE = 48;
const PULSE_REVEAL = 4;
const PULSE_EVERY = 4;
const LIFE = 12;

export function createDrone(scene) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x2c313e), roughness: 0.5, metalness: 0.5 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x35c4b5), roughness: 0.4, metalness: 0.3, emissive: new THREE.Color(0x35c4b5), emissiveIntensity: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.42), bodyMat);
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.06), accentMat);
  eye.position.set(0, 0, -0.22);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 8, 6),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5040) }),
  );
  beacon.position.set(0, 0.12, 0);
  group.add(body, eye, beacon);
  const rotors = [];
  const rotorGeo = new THREE.CircleGeometry(0.22, 10);
  const rotorMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9aa0a8), transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  for (const [rx, rz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
    const rotor = new THREE.Mesh(rotorGeo, rotorMat);
    rotor.rotation.x = -Math.PI / 2;
    rotor.position.set(rx, 0.1, rz);
    group.add(rotor);
    rotors.push(rotor);
  }
  group.visible = false;
  scene.add(group);

  const state = {
    mode: 'idle', // idle | flying
    pos: new THREE.Vector3(),
    launchedAt: 0,
    nextPulse: 0,
    pulses: 0,
  };
  let pings = []; // { x, z, until } — enemies revealed by the last pulse

  function deploy(from, now) {
    if (state.mode === 'flying') return false;
    state.mode = 'flying';
    state.pos.set(from.x, 0.5, from.z);
    state.launchedAt = now;
    state.nextPulse = now;
    state.pulses = 0;
    pings = [];
    group.position.copy(state.pos);
    group.visible = true;
    return true;
  }

  function pulse(now, enemies) {
    pings = [];
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const dx = enemy.pos.x - state.pos.x;
      const dz = enemy.pos.z - state.pos.z;
      if (dx * dx + dz * dz > PULSE_RANGE * PULSE_RANGE) continue;
      pings.push({ x: enemy.pos.x, z: enemy.pos.z, until: now + PULSE_REVEAL });
    }
    state.pulses += 1;
    state.nextPulse = now + PULSE_EVERY;
  }

  return {
    state,
    get active() {
      return state.mode === 'flying';
    },
    get pings() {
      return pings;
    },
    deploy,
    reset() {
      state.mode = 'idle';
      pings = [];
      group.visible = false;
    },
    step(dt, now, enemies) {
      if (state.mode !== 'flying') return;
      // Rise to hover height, bob gently, spin the rotors, blink the beacon.
      const targetY = HOVER_HEIGHT + Math.sin(now * 1.4) * 0.25;
      state.pos.y += (targetY - state.pos.y) * Math.min(1, dt * 2.2);
      group.position.copy(state.pos);
      group.rotation.y += dt * 0.6;
      for (const rotor of rotors) rotor.rotation.z += dt * 28;
      beacon.visible = Math.floor(now * 2.4) % 2 === 0;
      // Expire old pings.
      for (let i = pings.length - 1; i >= 0; i -= 1) {
        if (pings[i].until <= now) pings.splice(i, 1);
      }
      if (now >= state.nextPulse && state.pulses < 3) pulse(now, enemies);
      if (now - state.launchedAt >= LIFE || state.pulses >= 3) {
        state.mode = 'idle';
        group.visible = false;
      }
    },
  };
}
