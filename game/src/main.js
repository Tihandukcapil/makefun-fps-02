// SANDLINE: STORM PROTOCOL — boot, render loop, fixed-step simulation driver,
// player shooting, buy menu wiring, flash handling and the ?shot= staging used
// for screenshots. The game logic lives in sim.js (state), bots.js (AI),
// world.js (map), weapons.js (guns), grenades.js, player.js (movement),
// hud.js (DOM), storm.js (sandstorm), drone.js (FALCON pulse drone) and
// minimap.js (tactical map). The storm, drone and minimap are imported first
// so the dossier reads them before any other module.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createStorm } from './storm.js';
import { createDrone } from './drone.js';
import { createMinimap } from './minimap.js';
import { createWorld } from './world.js';
import { createPlayer } from './player.js';
import { createWeapons, WEAPONS } from './weapons.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createGrenades } from './grenades.js';
import { createBots } from './bots.js';
import { createSim } from './sim.js';
import { createHud } from './hud.js';

const params = new URLSearchParams(location.search);
const shotMode = params.get('shot'); // start | play | storm | end | null
const autoMode = shotMode !== null;

window.addEventListener('error', (event) => {
  window.__error = String(event.message || event.error || 'unknown error');
});

// ---------- Renderer / scene ----------

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.sky), 42, 115);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const player = createPlayer(world);
const weapons = createWeapons(camera, audio);
const grenades = createGrenades(scene, world);
const storm = createStorm(scene, world.lights);
const drone = createDrone(scene);
const minimap = createMinimap(document.getElementById('minimap'), world);
const hud = createHud();
const raycaster = new THREE.Raycaster();

// ---------- Player hit boxes (invisible, raycastable) ----------

const hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
const playerBody = new THREE.Mesh(new THREE.BoxGeometry(0.76, 1.15, 0.76), hitMaterial);
playerBody.position.y = 0.85;
playerBody.userData = { owner: 'player', part: 'body' };
const playerHead = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.42), hitMaterial);
playerHead.position.y = 1.55;
playerHead.userData = { owner: 'player', part: 'head' };
scene.add(playerBody, playerHead);

// ---------- Shared temps (no per-frame allocation) ----------

const eye = new THREE.Vector3();
const dir = new THREE.Vector3();
const farPoint = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpW = new THREE.Vector3();
const tmpU = new THREE.Vector3();
const pingV = new THREE.Vector3();

// ---------- Damage routing ----------

let sim; // assigned below; bot callbacks close over the binding, not the value.
let hitMeshes = [];

function damageHit(object, amount, attackerName, part) {
  if (object.userData.owner === 'player') {
    sim.damagePlayer(amount, attackerName, part);
    return false;
  }
  if (object.userData.bot) {
    return sim.damageBot(object.userData.bot, amount, attackerName, part);
  }
  return false;
}

const botCtx = {
  smokeBlocks: (a, b) => grenades.blocksSight(a, b),
  raycaster,
  tracer: (from, to) => weapons.spawnTracer(from, to),
  damageHit,
  audioShot: (kind, distance) => audio.shot(kind, distance),
  noise: (pos, team) => sim.addNoise(pos, team),
  channel: (bot, dt) => sim.channel(bot, dt),
  bombPickup: (bot) => sim.bombPickup(bot),
};

const bots = createBots(scene, world, botCtx);

function rebuildHitMeshes() {
  hitMeshes = [...world.shootables];
  for (const bot of bots.list) {
    bot.mesh.group.traverse((child) => {
      if (child.isMesh) {
        child.userData.bot = bot;
        hitMeshes.push(child);
      }
    });
  }
  hitMeshes.push(playerBody, playerHead);
}

// ---------- Round reset (called by the sim) ----------

function resetRound() {
  const armor = player.state.armor;
  bots.spawnRound(sim.state.bombSiteChoice);
  rebuildHitMeshes();
  player.reset(world.spawns.vipers[0]);
  player.state.armor = armor; // kevlar survives the round, like the real thing
  weapons.refillReserve();
  drone.reset();
  storm.reset();
  hud.setHealth(100, armor);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name);
  hud.setGrenades(grenades.counts.smoke, grenades.counts.flash);
  hud.setBomb('held');
  hud.setDrone(sim.state.droneCharges);
  updateTeammates();
}

sim = createSim({
  world,
  bots,
  grenades,
  hud,
  audio,
  resetRound,
  playerAlive: () => player.state.alive,
  playerHurt: (amount) => player.hurt(amount),
  playerPos: () => player.state.position,
});

// Bots read the player through this reference; the sim state is swapped in per tick.
const playerRef = {
  pos: player.state.position,
  get alive() {
    return player.state.alive;
  },
};
const botEnv = {
  player: playerRef,
  noise: sim.noise,
  bomb: sim.state.bomb,
  phase: sim.state.phase,
  raycaster,
  hitMeshes,
  stormIntensity: 0,
};

// ---------- Input ----------

let started = false;
let paused = false;
let buyOpen = false;

const input = createInput(renderer.domElement, (locked) => {
  if (autoMode) return;
  if (!locked && started && !buyOpen && sim.state.phase !== 'matchEnd'
    && (sim.state.phase === 'live' || sim.state.phase === 'planted')) {
    paused = true;
    hud.showOverlay('paused');
  } else if (locked) {
    paused = false;
  }
});

hud.onPlay(() => {
  audio.ensure();
  if (!started || sim.state.phase === 'matchEnd') {
    started = true;
    weapons.resetLoadout();
    sim.startMatch();
  }
  hud.hideOverlay();
  if (!autoMode) input.requestLock();
});

// ---------- Buy menu ----------

const SHOP = {
  rifle: WEAPONS.rifle.price,
  smg: WEAPONS.smg.price,
  sniper: WEAPONS.sniper.price,
  armor: 650,
  smoke: 300,
  flash: 200,
};

function setBuyOpen(open) {
  if (open && sim.state.phase !== 'buy') return;
  buyOpen = open;
  hud.showBuy(open);
  if (open) input.releaseLock();
  else if (!autoMode) input.requestLock();
}

function tryBuy(id) {
  if (sim.state.phase !== 'buy') return;
  if (id === 'drone') {
    if (sim.buyDrone()) hud.markBought('drone');
    return;
  }
  const price = SHOP[id];
  if (price === undefined) return;
  if (!sim.buy(id, price)) return;
  if (id === 'armor') {
    player.state.armor = 100;
    hud.setHealth(player.state.health, 100);
  } else if (id === 'smoke' || id === 'flash') {
    grenades.give(id, 1);
    hud.setGrenades(grenades.counts.smoke, grenades.counts.flash);
  } else {
    weapons.buy(id);
    weapons.equip(id);
    hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name);
  }
  hud.markBought(id);
}

hud.onBuy(tryBuy);
hud.bindBuyButtons();

// ---------- FALCON drone ----------

let lastDronePulses = 0;

function launchDrone() {
  if (!player.state.alive) return;
  if (sim.state.phase !== 'live' && sim.state.phase !== 'planted') return;
  if (drone.active) return;
  if (!sim.useDroneCharge()) {
    audio.denied();
    return;
  }
  if (drone.deploy(player.state.position, sim.state.time)) {
    audio.droneLaunch();
    hud.killfeedSystem('FALCON drone away — pulsing enemy positions.');
  }
}

// ---------- Player shooting ----------

function fireShot() {
  const def = weapons.def();
  if (!weapons.canFire()) {
    if (weapons.state.mag === 0 && weapons.state.reserve > 0) weapons.reload();
    else if (weapons.state.mag === 0) audio.dryFire();
    return;
  }
  weapons.takeRound();
  weapons.pullTrigger();
  player.eyePosition(eye);
  camera.getWorldDirection(dir);
  const spread = weapons.spread(player.groundSpeed(), input.state.aiming);
  dir.x += (Math.random() * 2 - 1) * spread;
  dir.y += (Math.random() * 2 - 1) * spread;
  dir.z += (Math.random() * 2 - 1) * spread;
  dir.normalize();
  raycaster.set(eye, dir);
  raycaster.far = def.range;
  const hits = raycaster.intersectObjects(hitMeshes, false);
  const muzzle = tmpV.copy(eye).addScaledVector(dir, 0.5);
  const hit = hits[0];
  if (hit) {
    weapons.spawnTracer(muzzle, hit.point);
    const part = hit.object.userData.botPart || hit.object.userData.part || 'body';
    const damage = def.damage * (part === 'head' ? def.headMult : 1);
    const died = damageHit(hit.object, damage, 'YOU', part);
    if (hit.object.userData.bot || hit.object.userData.owner === 'player') {
      hud.hitMarker(died, died ? 350 : 120);
      audio.hit(part === 'head');
    }
  } else {
    farPoint.copy(eye).addScaledVector(dir, 40);
    weapons.spawnTracer(muzzle, farPoint);
  }
  player.recoil(def.kind === 'sniper' ? 0.055 : 0.02, (Math.random() * 2 - 1) * 0.006);
  audio.shot(def.kind, 0);
  sim.addNoise(player.state.position, 'vipers');
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, def.name);
}

function throwGrenade(kind) {
  if (!player.state.alive) return;
  player.eyePosition(eye);
  camera.getWorldDirection(dir);
  if (grenades.throwGrenade(kind, eye, dir)) {
    hud.setGrenades(grenades.counts.smoke, grenades.counts.flash);
  }
}

// ---------- Flash blindness ----------

let lastFlashFrom = -1;

function updateFlash(now) {
  const flash = grenades.lastFlash();
  if (!flash) {
    hud.flashWhite(0);
    return;
  }
  if (flash.from !== lastFlashFrom) {
    lastFlashFrom = flash.from;
    for (const bot of bots.list) {
      if (!bot.alive) continue;
      tmpV.set(bot.pos.x, bot.pos.y + 1.55, bot.pos.z);
      tmpW.copy(flash.at).sub(tmpV);
      const distance = tmpW.length();
      if (distance > 45) continue;
      tmpW.normalize();
      tmpU.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
      if (tmpW.dot(tmpU) > 0.1 && !world.losBlocked(tmpV, flash.at) && !grenades.blocksSight(tmpV, flash.at)) {
        bot.flashBlindUntil = flash.until;
      }
    }
  }
  if (now < flash.until && player.state.alive) {
    player.eyePosition(eye);
    tmpW.copy(flash.at).sub(eye);
    const distance = tmpW.length();
    camera.getWorldDirection(dir);
    const facing = tmpW.normalize().dot(dir);
    if (distance < 45 && facing > 0.1 && !world.losBlocked(eye, flash.at)) {
      const strength = Math.max(0, (flash.until - now) / 2.2);
      hud.flashWhite(strength * (distance < 10 ? 1 : 0.7));
      if (strength > 0.5) input.state.firing = false;
      return;
    }
  }
  hud.flashWhite(0);
}

// ---------- HUD helpers ----------

function updateTeammates() {
  const entries = [{
    name: 'YOU', hp: player.state.health, alive: player.state.alive,
    carrier: sim.state.bomb.carrier === 'player',
  }];
  for (const bot of bots.list) {
    if (bot.team !== 'vipers') continue;
    entries.push({ name: bot.name, hp: bot.hp, alive: bot.alive, carrier: bot.isCarrier });
  }
  hud.setTeammates(entries);
}

function updateHud() {
  hud.setHealth(player.state.health, player.state.armor);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name);
  hud.setCrosshairSpread(4 + weapons.spread(player.groundSpeed(), input.state.aiming) * 900);
  hud.setMoney(sim.state.money);
  hud.setStorm(sim.state.storm.phase, sim.state.storm.intensity);
  hud.setDrone(sim.state.droneCharges);
  minimap.draw({
    player: { pos: player.state.position, yaw: player.state.yaw, alive: player.state.alive },
    mates: bots.list.filter((bot) => bot.team === 'vipers').map((bot) => ({ pos: bot.pos, alive: bot.alive })),
    pings: drone.pings,
    bomb: sim.state.bomb,
    sites: world.sites,
    storm: sim.state.storm.intensity,
    now: sim.state.time,
  });
  updateTeammates();
}

// Red diamonds over pulse-revealed enemies, projected to screen space.
function updatePings() {
  const points = [];
  for (const ping of drone.pings) {
    if (ping.until <= sim.state.time) continue;
    pingV.set(ping.x, 1.4, ping.z).project(camera);
    if (pingV.z > 1) continue;
    const x = (pingV.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-pingV.y * 0.5 + 0.5) * window.innerHeight;
    if (x < -20 || x > window.innerWidth + 20 || y < -20 || y > window.innerHeight + 20) continue;
    points.push({ x, y });
  }
  hud.showPings(points);
}

// ---------- Fixed-step tick ----------

const STEP = 1 / 60;
let prevKeys = new Set();
let prevFiring = false;
let hudTimer = 0;
let stepTimer = 0;

function justPressed(code) {
  return input.state.keys.has(code) && !prevKeys.has(code);
}

function tick(dt) {
  const keys = input.state.keys;
  const look = input.takeLook();
  if (player.state.alive) player.look(look.x, look.y);
  player.step(dt, keys);
  weapons.step(dt, player.groundSpeed() > 0.5);

  // Footsteps.
  if (player.state.alive && player.state.onGround && player.groundSpeed() > 1.5) {
    stepTimer -= dt;
    if (stepTimer <= 0) {
      stepTimer = 0.36;
      audio.footstep();
    }
  }

  // Firing: automatic weapons fire while held, semi-automatic on the rising edge.
  const def = weapons.def();
  const firingEdge = input.state.firing && !prevFiring;
  prevFiring = input.state.firing;
  if (player.state.alive && !buyOpen && (def.auto ? input.state.firing : firingEdge)) {
    fireShot();
  }

  // Edge-triggered keys.
  if (justPressed('KeyB')) setBuyOpen(!buyOpen);
  if (justPressed('KeyR')) weapons.reload();
  if (justPressed('KeyQ')) throwGrenade('smoke');
  if (justPressed('KeyF')) throwGrenade('flash');
  if (justPressed('KeyT')) launchDrone();
  if (buyOpen) {
    if (justPressed('Digit1')) tryBuy('rifle');
    if (justPressed('Digit2')) tryBuy('smg');
    if (justPressed('Digit3')) tryBuy('sniper');
    if (justPressed('Digit5')) tryBuy('smoke');
    if (justPressed('Digit6')) tryBuy('flash');
    if (justPressed('Digit7')) tryBuy('armor');
    if (justPressed('Digit8')) tryBuy('drone');
  } else {
    if (justPressed('Digit1')) weapons.equip('pistol');
    if (justPressed('Digit2')) weapons.equip('rifle');
    if (justPressed('Digit3')) weapons.equip('smg');
    if (justPressed('Digit4')) weapons.equip('sniper');
  }
  prevKeys = new Set(keys);

  const planting = player.state.alive && keys.has('KeyE') && sim.state.bomb.carrier === 'player' && sim.state.phase !== 'buy';
  const defusing = player.state.alive && keys.has('KeyE') && sim.state.bomb.state === 'planted';
  sim.step(dt, { playerPlanting: planting, playerDefusing: defusing });

  if (sim.state.phase === 'live' || sim.state.phase === 'planted') {
    botEnv.noise = sim.noise;
    botEnv.bomb = sim.state.bomb;
    botEnv.phase = sim.state.phase;
    botEnv.timeLeft = sim.state.timer;
    botEnv.hitMeshes = hitMeshes;
    botEnv.stormIntensity = sim.state.storm.intensity;
    bots.step(dt, sim.state.time, botEnv);
  }
  grenades.step(dt, sim.state.time);
  // The drone pulses Jackals only — the player's enemies.
  drone.step(dt, sim.state.time, bots.list.filter((bot) => bot.team === 'jackals'));
  if (drone.state.pulses > lastDronePulses) {
    lastDronePulses = drone.state.pulses;
    audio.dronePing();
  }
  if (!drone.active) lastDronePulses = 0;
  storm.setIntensity(sim.state.storm.intensity);
  world.update(dt, sim.state.time);

  // Player hit boxes follow the player.
  playerBody.position.set(player.state.position.x, player.state.position.y, player.state.position.z);
  playerHead.position.set(player.state.position.x, player.state.position.y, player.state.position.z);

  hudTimer += dt;
  if (hudTimer > 0.25) {
    hudTimer = 0;
    updateHud();
  }
}

// ---------- Camera (render rate) ----------

function updateCamera() {
  if (!player.state.alive) {
    const mate = bots.list.find((bot) => bot.team === 'vipers' && bot.alive);
    if (mate) {
      camera.position.set(mate.pos.x, mate.pos.y + 1.6, mate.pos.z);
      camera.rotation.y = mate.yaw;
      camera.rotation.x = 0;
      camera.rotation.z = 0;
      return;
    }
  }
  camera.position.set(player.state.position.x, player.state.position.y + player.state.eye, player.state.position.z);
  camera.rotation.y = player.state.yaw + player.state.recoilYaw;
  camera.rotation.x = player.state.pitch + player.state.recoilPitch;
  camera.rotation.z = 0;
  const targetFov = input.state.aiming ? (weapons.def().kind === 'sniper' ? 28 : 55) : 75;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * 0.35;
    camera.updateProjectionMatrix();
  }
}

// ---------- Main loop ----------

let accumulator = 0;
let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (paused || !started) {
    renderer.render(scene, camera);
    return;
  }
  accumulator += dt;
  let steps = 0;
  while (accumulator >= STEP && steps < 5) {
    tick(STEP);
    accumulator -= STEP;
    steps += 1;
  }
  if (steps === 5) accumulator = 0;
  updateCamera();
  updateFlash(sim.state.time);
  storm.update(dt);
  audio.setWind(sim.state.storm.intensity);
  updatePings();
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Screenshot staging (?shot=) ----------

function aimAtNearestEnemy() {
  let best = null;
  let bestDistance = Infinity;
  for (const bot of bots.list) {
    if (bot.team !== 'jackals' || !bot.alive) continue;
    const distance = player.state.position.distanceTo(bot.pos);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = bot;
    }
  }
  if (!best) return;
  const dx = best.pos.x - player.state.position.x;
  const dz = best.pos.z - player.state.position.z;
  player.state.yaw = Math.atan2(-dx, -dz);
  player.state.pitch = 0.02;
}

function stageShot(mode) {
  if (mode === 'start') {
    hud.showBuy(true);
    window.setTimeout(() => { window.__shotReady = true; }, 1200);
    return;
  }
  if (mode === 'play') {
    // Screenshot loadout: the VK-47 reads better than the pistol in a firefight frame.
    weapons.buy('rifle');
    weapons.equip('rifle');
    sim.state.timer = 0.05; // skip the buy phase almost immediately
    // Wait for the round to actually go live (slow software renderers tick rarely),
    // then drop the player into mid-map and keep firing at the nearest enemy.
    const waitLive = window.setInterval(() => {
      if (sim.state.phase !== 'live') return;
      window.clearInterval(waitLive);
      player.state.position.set(-2, 0, -4);
      aimAtNearestEnemy();
      window.setInterval(() => {
        if (!player.state.alive) return;
        aimAtNearestEnemy();
        if (weapons.canFire()) fireShot();
      }, 110);
      window.setTimeout(() => { window.__shotReady = true; }, 1200);
    }, 200);
    return;
  }
  if (mode === 'storm') {
    // The signature frame: a sandstorm at full blow, the FALCON drone pulsing
    // enemies through the haze, the player firing down mid.
    weapons.buy('rifle');
    weapons.equip('rifle');
    sim.state.timer = 0.05; // skip the buy phase almost immediately
    const waitLive = window.setInterval(() => {
      if (sim.state.phase !== 'live') return;
      window.clearInterval(waitLive);
      player.state.position.set(-4, 0, 6);
      sim.state.storm.phase = 'storm';
      launchDrone();
      window.setInterval(() => {
        if (!player.state.alive) return;
        aimAtNearestEnemy();
        if (weapons.canFire()) fireShot();
      }, 110);
      // Let the storm ease in and the first pulse land before the shot.
      window.setTimeout(() => { window.__shotReady = true; }, 4200);
    }, 200);
    return;
  }
  if (mode === 'end') {
    window.setTimeout(() => {
      sim.state.score = { vipers: 5, jackals: 4 };
      sim.state.round = 9;
      sim.state.phase = 'matchEnd';
      sim.state.matchWinner = 'vipers';
      hud.setRound(9, sim.state.score);
      hud.showOverlay('match', 'win', sim.state.score);
      window.__shotReady = true;
    }, 2500);
  }
}

if (autoMode) {
  audio.setEnabled(false);
  started = true;
  sim.startMatch();
  hud.hideOverlay();
  stageShot(shotMode);
} else {
  hud.showOverlay('start');
}

requestAnimationFrame(frame);

// Debug handle for the headless play-test.
window.__game = { sim, player, bots, weapons, grenades, world, storm, drone, minimap, tick, botEnv };
