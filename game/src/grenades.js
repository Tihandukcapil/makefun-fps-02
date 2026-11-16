// Grenades: smoke that blocks sight and flash that blinds. Both are thrown as
// simple projectiles with gravity and one wall bounce, then resolve. Bots read
// the smoke volumes through blocksSight() and the flash through blindUntil.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const GRAVITY = 12;
const SMOKE_RADIUS = 3.4;
const SMOKE_LIFE = 14;

export function createGrenades(scene, world) {
  const smokes = []; // { center: Vector3, radius, life, mesh }
  const thrown = []; // { pos, vel, kind, life, mesh, bounced }
  const counts = { smoke: 0, flash: 0 };
  const blinded = new Map(); // entity -> blindUntil (seconds of game time)

  const smokeMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.smoke), transparent: true, opacity: 0.42,
    roughness: 1, metalness: 0, depthWrite: false,
  });
  const smokeGeo = new THREE.SphereGeometry(1, 12, 10);
  const flashGeo = new THREE.SphereGeometry(0.09, 8, 6);
  const flashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff') });

  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpClosest = new THREE.Vector3();

  function reset() {
    for (const smoke of smokes) scene.remove(smoke.mesh);
    for (const item of thrown) scene.remove(item.mesh);
    smokes.length = 0;
    thrown.length = 0;
    counts.smoke = 0;
    counts.flash = 0;
    blinded.clear();
  }

  function give(kind, amount) {
    counts[kind] = Math.min(2, counts[kind] + amount);
  }

  function throwGrenade(kind, from, direction) {
    if (counts[kind] <= 0) return false;
    counts[kind] -= 1;
    const mesh = kind === 'smoke'
      ? new THREE.Mesh(smokeGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.smoke), roughness: 1 }))
      : new THREE.Mesh(flashGeo, flashMat);
    mesh.scale.setScalar(kind === 'smoke' ? 0.16 : 1);
    mesh.position.copy(from);
    scene.add(mesh);
    thrown.push({
      pos: from.clone(),
      vel: direction.clone().multiplyScalar(11).add(new THREE.Vector3(0, 3.2, 0)),
      kind,
      life: 2.2,
      mesh,
      bounced: false,
    });
    return true;
  }

  function detonate(item, now) {
    scene.remove(item.mesh);
    if (item.kind === 'smoke') {
      const mesh = new THREE.Mesh(smokeGeo, smokeMat);
      mesh.position.copy(item.pos);
      mesh.position.y = Math.max(1.2, item.pos.y);
      mesh.scale.setScalar(SMOKE_RADIUS);
      scene.add(mesh);
      smokes.push({ center: mesh.position.clone(), radius: SMOKE_RADIUS, life: SMOKE_LIFE, mesh });
    } else {
      // Flash: anyone with line of sight to the burst and looking toward it is blinded.
      blinded.set('__flash__', { at: item.pos.clone(), until: now + 2.2, from: now });
    }
  }

  // A flash event the sim hands to bots and the player: { at, until }.
  function lastFlash() {
    return blinded.get('__flash__') || null;
  }

  function step(dt, now) {
    for (let i = thrown.length - 1; i >= 0; i -= 1) {
      const item = thrown[i];
      item.vel.y -= GRAVITY * dt;
      let nextY = item.pos.y + item.vel.y * dt;
      if (nextY <= 0.08) {
        nextY = 0.08;
        if (!item.bounced && Math.abs(item.vel.y) > 2) {
          item.vel.y *= -0.35;
          item.vel.x *= 0.7;
          item.vel.z *= 0.7;
          item.bounced = true;
        } else {
          item.vel.set(0, 0, 0);
        }
      }
      // Walls: moveCollide slides along them; if it could not move as far as
      // the velocity asked, the grenade hit a wall and bounces back.
      const beforeX = item.pos.x;
      const beforeZ = item.pos.z;
      world.moveCollide(item.pos, 0.1, item.vel.x * dt, item.vel.z * dt);
      if (Math.abs(item.pos.x - beforeX) < Math.abs(item.vel.x * dt) * 0.5) item.vel.x *= -0.3;
      if (Math.abs(item.pos.z - beforeZ) < Math.abs(item.vel.z * dt) * 0.5) item.vel.z *= -0.3;
      item.pos.y = nextY;
      item.mesh.position.copy(item.pos);
      item.life -= dt;
      if (item.life <= 0) {
        detonate(item, now);
        thrown.splice(i, 1);
      }
    }
    for (let i = smokes.length - 1; i >= 0; i -= 1) {
      const smoke = smokes[i];
      smoke.life -= dt;
      smoke.mesh.material.opacity = Math.min(0.42, smoke.life * 0.1);
      if (smoke.life <= 0) {
        scene.remove(smoke.mesh);
        smokes.splice(i, 1);
      }
    }
  }

  function blocksSight(a, b) {
    for (const smoke of smokes) {
      // Segment-sphere test: does the sight line pass through the smoke ball?
      tmpA.copy(b).sub(a);
      const length = tmpA.length();
      if (length < 0.01) return false;
      tmpA.multiplyScalar(1 / length);
      tmpB.copy(smoke.center).sub(a);
      const along = Math.max(0, Math.min(length, tmpB.dot(tmpA)));
      tmpClosest.copy(a).addScaledVector(tmpA, along);
      if (tmpClosest.distanceTo(smoke.center) < smoke.radius * 0.85) return true;
    }
    return false;
  }

  return { counts, reset, give, throwGrenade, step, blocksSight, lastFlash, smokes };
}
