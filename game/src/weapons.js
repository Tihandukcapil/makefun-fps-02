// Weapons: four guns with distinct roles, plus the view models, recoil, spread
// and a pooled tracer set. Hits are decided by the caller (main.js for the player,
// bots.js for bots) — a weapon only knows its own numbers and whether it can fire.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P2000', price: 0, kind: 'pistol', auto: false,
    damage: 26, headMult: 3, magSize: 12, reserveMax: 48, fireGap: 0.16,
    reloadTime: 1.5, spreadBase: 0.004, spreadMove: 0.02, range: 60,
  },
  rifle: {
    id: 'rifle', name: 'VK-47', price: 2700, kind: 'rifle', auto: true,
    damage: 34, headMult: 3, magSize: 30, reserveMax: 90, fireGap: 0.096,
    reloadTime: 1.9, spreadBase: 0.0022, spreadMove: 0.028, range: 90,
  },
  smg: {
    id: 'smg', name: 'MP-9', price: 1500, kind: 'smg', auto: true,
    damage: 22, headMult: 3, magSize: 32, reserveMax: 128, fireGap: 0.068,
    reloadTime: 1.7, spreadBase: 0.006, spreadMove: 0.03, range: 55,
  },
  sniper: {
    id: 'sniper', name: 'AWP-7', price: 4750, kind: 'sniper', auto: false,
    damage: 110, headMult: 2, magSize: 5, reserveMax: 15, fireGap: 1.1,
    reloadTime: 2.6, spreadBase: 0.0004, spreadMove: 0.05, range: 120,
  },
};

const TRACER_COUNT = 24;

function buildViewModel(kind) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });
  const group = new THREE.Group();
  if (kind === 'sniper') {
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.7), body);
    barrel.position.set(0, 0.02, -0.5);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 10), accent);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.09, -0.1);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.3), grip);
    stock.position.set(0, -0.02, 0.32);
    group.add(barrel, scope, stock);
  } else if (kind === 'smg') {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.34), body);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.07), grip);
    mag.position.set(0, -0.11, -0.05);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.18), grip);
    stock.position.set(0, -0.01, 0.26);
    group.add(receiver, mag, stock);
  } else if (kind === 'pistol') {
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.24), body);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.12, 0.06), grip);
    handle.position.set(0, -0.08, 0.08);
    handle.rotation.x = 0.25;
    group.add(slide, handle);
  } else {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), grip);
    barrel.position.set(0, 0.025, -0.38);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
    stock.position.set(0, -0.02, 0.3);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.08), accent);
    sight.position.set(0, 0.075, -0.05);
    group.add(receiver, barrel, stock, sight);
  }
  return group;
}

export function createWeapons(camera, audio) {
  const models = {};
  for (const def of Object.values(WEAPONS)) {
    const model = buildViewModel(def.kind);
    model.position.set(0.24, -0.2, -0.42);
    model.visible = false;
    camera.add(model);
    models[def.id] = model;
  }

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  // Pooled tracers: one thin stretched box per shot, reused, never allocated per frame.
  const tracerPool = [];
  const tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd27a'), transparent: true, opacity: 0.85 });
  const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat);
    mesh.visible = false;
    camera.parent.add(mesh);
    tracerPool.push({ mesh, life: 0 });
  }
  let tracerIndex = 0;
  const tracerMid = new THREE.Vector3();
  const tracerDir = new THREE.Vector3();

  const state = {
    current: 'pistol',
    mag: WEAPONS.pistol.magSize,
    reserve: WEAPONS.pistol.reserveMax,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    bloom: 0,
    owned: new Set(['pistol']),
    ammo: { pistol: { mag: 12, reserve: 48 } },
  };
  models.pistol.visible = true; // the starting weapon is in hand from the first frame

  function equip(id) {
    if (!state.owned.has(id)) return false;
    if (state.reloadLeft > 0) return false;
    if (state.current === id) return true;
    for (const key of Object.keys(models)) models[key].visible = key === id;
    state.current = id;
    const saved = state.ammo[id] || { mag: WEAPONS[id].magSize, reserve: WEAPONS[id].reserveMax };
    state.mag = saved.mag;
    state.reserve = saved.reserve;
    state.cooldown = 0.15;
    return true;
  }

  function saveAmmo() {
    state.ammo[state.current] = { mag: state.mag, reserve: state.reserve };
  }

  function buy(id) {
    if (state.owned.has(id)) return false;
    state.owned.add(id);
    state.ammo[id] = { mag: WEAPONS[id].magSize, reserve: WEAPONS[id].reserveMax };
    return true;
  }

  function resetLoadout() {
    state.owned = new Set(['pistol']);
    state.ammo = { pistol: { mag: 12, reserve: 48 } };
    state.current = 'pistol';
    state.mag = 12;
    state.reserve = 48;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.flash = 0;
    state.kick = 0;
    state.bloom = 0;
    for (const key of Object.keys(models)) models[key].visible = key === 'pistol';
  }

  function step(dt, moving) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.bloom = Math.max(0, state.bloom - dt * 0.09);
    const model = models[state.current];
    model.position.z = -0.42 + state.kick;
    model.position.y = -0.2 + Math.sin(performance.now() * 0.006) * (moving ? 0.008 : 0.002);
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 16 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (WEAPONS[state.current].reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const def = WEAPONS[state.current];
        const need = def.magSize - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
        saveAmmo();
      }
    }
    for (const tracer of tracerPool) {
      if (tracer.life > 0) {
        tracer.life -= dt;
        tracer.mesh.material.opacity = Math.max(0, tracer.life / 0.12) * 0.85;
        if (tracer.life <= 0) tracer.mesh.visible = false;
      }
    }
  }

  function spawnTracer(from, to) {
    const tracer = tracerPool[tracerIndex];
    tracerIndex = (tracerIndex + 1) % TRACER_COUNT;
    tracerMid.copy(from).add(to).multiplyScalar(0.5);
    tracerDir.copy(to).sub(from);
    const length = tracerDir.length();
    tracer.mesh.position.copy(tracerMid);
    tracer.mesh.lookAt(to);
    tracer.mesh.scale.set(1, 1, Math.max(0.5, length));
    tracer.mesh.visible = true;
    tracer.life = 0.12;
  }

  return {
    state,
    def() {
      return WEAPONS[state.current];
    },
    equip,
    buy,
    resetLoadout,
    step,
    spawnTracer,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    canFire() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    pullTrigger() {
      state.cooldown = WEAPONS[state.current].fireGap;
      state.flash = 0.06;
      state.kick = state.current === 'sniper' ? 0.12 : 0.055;
      state.bloom = Math.min(0.05, state.bloom + 0.006);
    },
    reload() {
      const def = WEAPONS[state.current];
      if (state.reloadLeft > 0 || state.mag === def.magSize || state.reserve === 0) return false;
      state.reloadLeft = def.reloadTime;
      audio.reload();
      return true;
    },
    // Spread grows with movement, bloom from firing, and shrinks while aiming.
    spread(speed, aiming) {
      const def = WEAPONS[state.current];
      const movePart = Math.min(1, speed / 5.2) * def.spreadMove;
      const aimPart = aiming ? 0.45 : 1;
      return (def.spreadBase + movePart + state.bloom) * aimPart;
    },
    refillReserve() {
      for (const id of state.owned) {
        const def = WEAPONS[id];
        state.ammo[id] = { mag: def.magSize, reserve: def.reserveMax };
      }
      const saved = state.ammo[state.current];
      state.mag = saved.mag;
      state.reserve = saved.reserve;
    },
  };
}
