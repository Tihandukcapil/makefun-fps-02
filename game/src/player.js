// The human player: acceleration-based movement with crouch and jump, AABB wall
// collision through the world, and a recoil model that kicks the view. Health and
// armour live here; damage comes in through hurt().
import * as THREE from 'three';

const WALK_SPEED = 5.2;
const CROUCH_SPEED = 3.1;
const AIR_SPEED = 4.4;
const ACCEL = 55;
const FRICTION = 11;
const GRAVITY = 22;
const JUMP_SPEED = 7.2;
const RADIUS = 0.38;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.08;

export function createPlayer(world) {
  const state = {
    position: new THREE.Vector3(-19, 0, 0),
    velocity: new THREE.Vector3(),
    yaw: -Math.PI / 2,
    pitch: 0,
    eye: EYE_STAND,
    crouched: false,
    onGround: true,
    health: 100,
    armor: 0,
    alive: true,
    recoilPitch: 0,
    recoilYaw: 0,
    speed2d: 0,
  };

  const wish = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();

  function reset(spawn) {
    state.position.copy(spawn);
    state.velocity.set(0, 0, 0);
    state.yaw = -Math.PI / 2;
    state.pitch = 0;
    state.health = 100;
    state.armor = 0;
    state.alive = true;
    state.recoilPitch = 0;
    state.recoilYaw = 0;
  }

  function step(dt, keys) {
    if (!state.alive) return;
    const crouchKey = keys.has('ControlLeft') || keys.has('KeyC');
    state.crouched = crouchKey;
    const targetEye = crouchKey ? EYE_CROUCH : EYE_STAND;
    state.eye += (targetEye - state.eye) * Math.min(1, dt * 12);

    forward.set(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
    right.set(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
    wish.set(0, 0, 0);
    if (keys.has('KeyW')) wish.add(forward);
    if (keys.has('KeyS')) wish.sub(forward);
    if (keys.has('KeyD')) wish.add(right);
    if (keys.has('KeyA')) wish.sub(right);
    if (wish.lengthSq() > 0) wish.normalize();

    const maxSpeed = state.onGround ? (crouchKey ? CROUCH_SPEED : WALK_SPEED) : AIR_SPEED;
    state.velocity.x += wish.x * ACCEL * dt;
    state.velocity.z += wish.z * ACCEL * dt;
    // Friction only on the ground; air keeps momentum.
    if (state.onGround) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      if (wish.lengthSq() === 0) {
        state.velocity.x *= damp;
        state.velocity.z *= damp;
      }
    }
    const horizontal = Math.hypot(state.velocity.x, state.velocity.z);
    if (horizontal > maxSpeed) {
      const scale = maxSpeed / horizontal;
      state.velocity.x *= scale;
      state.velocity.z *= scale;
    }
    state.speed2d = Math.hypot(state.velocity.x, state.velocity.z);

    if (keys.has('Space') && state.onGround) {
      state.velocity.y = JUMP_SPEED;
      state.onGround = false;
    }
    state.velocity.y -= GRAVITY * dt;
    world.moveCollide(state.position, RADIUS, state.velocity.x * dt, state.velocity.z * dt);
    state.position.y += state.velocity.y * dt;
    if (state.position.y <= 0) {
      state.position.y = 0;
      state.velocity.y = 0;
      state.onGround = true;
    }

    // Recoil decays back toward zero; the view reads it in main.js.
    state.recoilPitch *= Math.max(0, 1 - dt * 9);
    state.recoilYaw *= Math.max(0, 1 - dt * 9);
  }

  function look(dx, dy) {
    if (!state.alive) return;
    state.yaw -= dx * 0.0021;
    state.pitch -= dy * 0.0021;
    state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch));
  }

  function recoil(pitch, yaw) {
    state.recoilPitch += pitch;
    state.recoilYaw += yaw;
    state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch + pitch * 0.4));
  }

  function hurt(amount) {
    if (!state.alive) return 0;
    let remaining = amount;
    if (state.armor > 0) {
      const absorbed = Math.min(state.armor, remaining * 0.5);
      state.armor -= absorbed;
      remaining -= absorbed;
    }
    state.health -= remaining;
    if (state.health <= 0) {
      state.health = 0;
      state.alive = false;
    }
    return remaining;
  }

  function eyePosition(out) {
    out.set(state.position.x, state.position.y + state.eye, state.position.z);
    return out;
  }

  return {
    state,
    reset,
    step,
    look,
    recoil,
    hurt,
    eyePosition,
    groundSpeed() {
      return state.onGround ? state.speed2d : state.speed2d * 0.6;
    },
  };
}
