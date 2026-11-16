// Bots: five per team, one of them you. Each bot runs a small state machine —
// route along the waypoint graph, hold an angle, engage what it sees, investigate
// gunfire it hears, plant or defuse the bomb. Bots shoot real rays at real hit
// boxes, so a wall between a bot and its target really does save the target.
import * as THREE from 'three';
import { WEAPONS } from './weapons.js';

const BOT_SPEED = 3.6;
const BOT_RADIUS = 0.38;
const REACTION_MIN = 0.32;
const REACTION_MAX = 0.62;
const THINK_EVERY = 0.22;
const HEAR_RADIUS = 30;

const ROSTER = {
  vipers: [
    { name: 'Rook', weapon: 'rifle', site: 'A', carrier: false },
    { name: 'Dune', weapon: 'smg', site: 'A', carrier: false },
    { name: 'Sable', weapon: 'rifle', site: 'B', carrier: false },
    { name: 'Wren', weapon: 'rifle', site: 'mid', carrier: false },
  ],
  jackals: [
    { name: 'Ash', weapon: 'rifle', site: 'A', carrier: false },
    { name: 'Onyx', weapon: 'sniper', site: 'A', carrier: false },
    { name: 'Bramble', weapon: 'rifle', site: 'B', carrier: false },
    { name: 'Flint', weapon: 'rifle', site: 'B', carrier: false },
    { name: 'Cinder', weapon: 'smg', site: 'mid', carrier: false },
  ],
};

function bfsPath(nodes, adjacency, from, to) {
  const prev = new Array(nodes.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === to) break;
    for (const next of adjacency[current]) {
      if (prev[next] === -1) {
        prev[next] = current;
        queue.push(next);
      }
    }
  }
  if (prev[to] === -1) return [];
  const path = [];
  let node = to;
  while (node !== from) {
    path.unshift(node);
    node = prev[node];
  }
  return path;
}

function nearestNode(nodes, position) {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const dx = nodes[i].x - position.x;
    const dz = nodes[i].z - position.z;
    const distance = dx * dx + dz * dz;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

export function createBots(scene, world, ctx) {
  const list = [];
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpC = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();
  const tmpEye = new THREE.Vector3();
  const tmpTarget = new THREE.Vector3();

  function makeMesh(teamColor) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.8, metalness: 0.1 });
    const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x232838), roughness: 0.8, metalness: 0.2 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.85, 4, 10), bodyMat);
    body.position.y = 0.95;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.34), darkMat);
    head.position.y = 1.66;
    head.castShadow = true;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(teamColor) }));
    visor.position.set(0, 1.66, 0.18);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.62), darkMat);
    gun.position.set(0.22, 1.15, -0.2);
    group.add(body, head, visor, gun);
    group.traverse((child) => {
      if (child.isMesh) child.userData.botPart = child === head ? 'head' : 'body';
    });
    scene.add(group);
    return { group, body, head };
  }

  function spawnRound(attackSite) {
    for (const bot of list) scene.remove(bot.mesh.group);
    list.length = 0;
    const teamColor = { vipers: 0x35c4b5, jackals: 0xe5484d };
    for (const team of ['vipers', 'jackals']) {
      const spawns = world.spawns[team];
      ROSTER[team].forEach((spec, index) => {
        const site = team === 'vipers' && attackSite ? attackSite : spec.site;
        const mesh = makeMesh(teamColor[team]);
        const spawn = spawns[index % spawns.length];
        const bot = {
          name: spec.name,
          team,
          weapon: WEAPONS[spec.weapon],
          pos: new THREE.Vector3(spawn.x, 0, spawn.z),
          yaw: team === 'vipers' ? -Math.PI / 2 : Math.PI / 2,
          pitch: 0,
          hp: 100,
          armor: 0,
          alive: true,
          state: 'route',
          path: [],
          pathIndex: 0,
          site,
          isCarrier: spec.carrier,
          target: null,
          reaction: 0,
          burstLeft: 0,
          burstTimer: 0,
          cooldown: 0,
          mag: WEAPONS[spec.weapon].magSize,
          reserve: WEAPONS[spec.weapon].reserveMax,
          reloadLeft: 0,
          thinkTimer: Math.random() * THINK_EVERY,
          strafeDir: 1,
          strafeTimer: 0,
          holdYaw: 0,
          holdPoint: null,
          channel: 0, // plant/defuse progress 0..1
          channelKind: null,
          flashBlindUntil: 0,
          skill: 0.55 + Math.random() * 0.25,
          mesh,
          speed: BOT_SPEED,
        };
        bot.mesh.group.position.copy(bot.pos);
        list.push(bot);
      });
    }
    return list;
  }

  function setPath(bot, targetPos) {
    const nodes = world.waypoints.nodes;
    const from = nearestNode(nodes, bot.pos);
    const to = nearestNode(nodes, targetPos);
    bot.path = bfsPath(nodes, world.waypoints.adjacency, from, to).map((i) => nodes[i]);
    bot.pathIndex = 0;
    // The final leg is the target itself, not the nearest node.
    bot.path.push(targetPos.clone());
  }

  function routeTarget(bot) {
    if (bot.team === 'jackals') {
      if (bot.site === 'A') return world.sites.A.center;
      if (bot.site === 'B') return world.sites.B.center;
      return world.holdPoints.mid[bot.name === 'Cinder' ? 1 : 0];
    }
    if (bot.site === 'A') return world.sites.A.center;
    if (bot.site === 'B') return world.sites.B.center;
    return world.holdPoints.mid[0];
  }

  function pickHoldPoint(bot) {
    const points = bot.site === 'A' ? world.holdPoints.A : bot.site === 'B' ? world.holdPoints.B : world.holdPoints.mid;
    const point = points[Math.floor(Math.random() * points.length)];
    bot.holdPoint = point;
    bot.holdYaw = Math.atan2(-(point.x - bot.pos.x), -(point.z - bot.pos.z));
    return point;
  }

  function visibleEnemy(bot, env) {
    // Returns { kind: 'player' | 'bot', ref, distance, chest: Vector3 } or null.
    // A sandstorm collapses sight: at full blow a bot only sees half as far, so
    // fights go close-quarters and the FALCON drone's pings decide the round.
    const sight = 58 * (1 - 0.55 * (env.stormIntensity || 0));
    let best = null;
    let bestDistance = sight;
    const eye = tmpEye.set(bot.pos.x, bot.pos.y + 1.55, bot.pos.z);
    // The player.
    if (env.player.alive) {
      tmpA.set(env.player.pos.x, env.player.pos.y + 1.3, env.player.pos.z);
      const distance = eye.distanceTo(tmpA);
      if (distance < bestDistance && !world.losBlocked(eye, tmpA) && !ctx.smokeBlocks(eye, tmpA)) {
        tmpDir.copy(tmpA).sub(eye).normalize();
        const forward = tmpB.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
        if (tmpDir.dot(forward) > 0.2 || distance < 4) {
          best = { kind: 'player', ref: env.player, distance, chest: tmpA.clone() };
          bestDistance = distance;
        }
      }
    }
    for (const other of list) {
      if (other === bot || !other.alive || other.team === bot.team) continue;
      tmpA.set(other.pos.x, other.pos.y + 1.3, other.pos.z);
      const distance = eye.distanceTo(tmpA);
      if (distance >= bestDistance) continue;
      if (world.losBlocked(eye, tmpA) || ctx.smokeBlocks(eye, tmpA)) continue;
      tmpDir.copy(tmpA).sub(eye).normalize();
      const forward = tmpB.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
      if (tmpDir.dot(forward) > 0.2 || distance < 4) {
        best = { kind: 'bot', ref: other, distance, chest: tmpA.clone() };
        bestDistance = distance;
      }
    }
    return best;
  }

  function think(bot, env, now) {
    if (!bot.alive) return;
    if (now < bot.flashBlindUntil) {
      bot.target = null;
      return;
    }
    const bomb = env.bomb;
    // Bomb planted: attackers hold the site, defenders rotate to it.
    if (bomb.state === 'planted') {
      if (bot.team === 'jackals') {
        if (bot.state !== 'defuse' && bot.state !== 'rotate') {
          bot.state = 'rotate';
          setPath(bot, bomb.pos);
        }
        const distance = Math.hypot(bot.pos.x - bomb.pos.x, bot.pos.z - bomb.pos.z);
        if (distance < 1.6) {
          bot.state = 'defuse';
          bot.channelKind = 'defuse';
        }
        return;
      }
      if (bot.state !== 'hold') {
        bot.state = 'hold';
        pickHoldPoint(bot);
      }
      return;
    }
    // Carrier at the site plants; otherwise the carrier pushes to the round's
    // bomb site (not its own assigned site — the two can differ).
    if (bot.isCarrier && bot.team === 'vipers') {
      const zone = world.sites[bomb.site].zone;
      if (bot.pos.x > zone.x0 && bot.pos.x < zone.x1 && bot.pos.z > zone.z0 && bot.pos.z < zone.z1) {
        bot.state = 'plant';
        bot.channelKind = 'plant';
        return;
      }
      if (bot.state !== 'route') {
        bot.state = 'route';
        setPath(bot, world.sites[bomb.site].center);
      }
      return;
    }
    // Dropped bomb: nearest living Viper fetches it.
    if (bomb.state === 'dropped' && bot.team === 'vipers') {
      if (bot.state === 'fetch' && bomb.pos && Math.hypot(bot.pos.x - bomb.pos.x, bot.pos.z - bomb.pos.z) < 1.3) {
        ctx.bombPickup(bot);
        bot.state = 'route';
        setPath(bot, world.sites[bomb.site].center);
        return;
      }
      let nearest = null;
      let nearestDistance = Infinity;
      for (const other of list) {
        if (other.team !== 'vipers' || !other.alive) continue;
        const d = Math.hypot(other.pos.x - bomb.pos.x, other.pos.z - bomb.pos.z);
        if (d < nearestDistance) {
          nearestDistance = d;
          nearest = other;
        }
      }
      if (nearest === bot && bot.state !== 'fetch') {
        bot.state = 'fetch';
        setPath(bot, bomb.pos);
        return;
      }
      if (nearest === bot) {
        // A fetcher whose path ran out (waypoints skipped past a wall) must
        // re-path from its current spot instead of freezing on a spent path.
        if (bot.pathIndex >= bot.path.length) setPath(bot, bomb.pos);
        return;
      }
    }
    const enemy = visibleEnemy(bot, env);
    if (enemy) {
      if (bot.target !== enemy.ref) {
        bot.target = enemy.ref;
        bot.reaction = REACTION_MIN + Math.random() * (REACTION_MAX - REACTION_MIN) * (1.2 - bot.skill);
        bot.burstLeft = 0;
      }
      bot.state = 'engage';
      return;
    }
    bot.target = null;
    // Late round, bomb still in hand: attackers stop holding angles and hunt the
    // remaining defenders, so a round cannot stall into a timeout with both teams
    // alive on opposite sites.
    if (env.phase === 'live' && bomb.state === 'held' && env.timeLeft < 30 && bot.team === 'vipers' && !bot.isCarrier) {
      if (now > (bot.huntUntil || 0)) {
        bot.huntUntil = now + 6;
        let target = null;
        let bestDistance = Infinity;
        for (const other of list) {
          if (other.team !== 'jackals' || !other.alive) continue;
          const d = Math.hypot(other.pos.x - bot.pos.x, other.pos.z - bot.pos.z);
          if (d < bestDistance) {
            bestDistance = d;
            target = other.pos;
          }
        }
        if (!target) target = world.sites[bomb.site].center;
        bot.state = 'route';
        setPath(bot, target);
      }
      return;
    }
    // Heard an enemy gunshot recently: go look.
    for (let i = env.noise.length - 1; i >= 0; i -= 1) {
      const sound = env.noise[i];
      if (sound.team === bot.team) continue;
      const distance = Math.hypot(bot.pos.x - sound.pos.x, bot.pos.z - sound.pos.z);
      if (distance < HEAR_RADIUS && now - sound.time < 4) {
        if (bot.state !== 'investigate') {
          bot.state = 'investigate';
          setPath(bot, sound.pos);
        }
        return;
      }
    }
    // Otherwise follow the route, then hold.
    if (bot.state === 'route' || bot.state === 'investigate' || bot.state === 'fetch') {
      if (bot.pathIndex >= bot.path.length) {
        bot.state = 'hold';
        pickHoldPoint(bot);
      }
      return;
    }
    if (bot.state === 'engage') {
      bot.state = 'route';
      setPath(bot, routeTarget(bot));
    }
    if (bot.state === 'hold' && bot.holdPoint) {
      // Drift between hold angles so the bot does not stare at one pixel forever.
      bot.holdYaw += Math.sin(now * 0.35 + bot.pos.x) * 0.0012;
    }
  }

  function moveAlongPath(bot, dt, speed) {
    if (bot.pathIndex >= bot.path.length) return true;
    const target = bot.path[bot.pathIndex];
    const dx = target.x - bot.pos.x;
    const dz = target.z - bot.pos.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.5) {
      bot.pathIndex += 1;
      return bot.pathIndex >= bot.path.length;
    }
    const step = Math.min(distance, speed * dt);
    const nx = (dx / distance) * step;
    const nz = (dz / distance) * step;
    const beforeX = bot.pos.x;
    const beforeZ = bot.pos.z;
    world.moveCollide(bot.pos, BOT_RADIUS, nx, nz);
    bot.yaw = Math.atan2(-dx, -dz);
    // Stuck safety net: a waypoint no wall lets the bot reach (a missed collider
    // overlap, a crate corner) must not soft-lock the round — skip it after 1.5s
    // of no progress instead of pushing at the wall forever.
    const moved = Math.hypot(bot.pos.x - beforeX, bot.pos.z - beforeZ);
    if (moved < 0.02) {
      bot.stuckTime = (bot.stuckTime || 0) + dt;
      if (bot.stuckTime > 1.5) {
        bot.stuckTime = 0;
        bot.pathIndex += 1;
      }
    } else {
      bot.stuckTime = 0;
    }
    return false;
  }

  function shootAt(bot, env, dt, now) {
    if (!bot.target) return;
    if (bot.reloadLeft > 0) {
      bot.reloadLeft = Math.max(0, bot.reloadLeft - dt);
      if (bot.reloadLeft === 0) {
        const need = bot.weapon.magSize - bot.mag;
        const take = Math.min(need, bot.reserve);
        bot.mag += take;
        bot.reserve -= take;
      }
      return;
    }
    if (bot.reaction > 0) {
      bot.reaction -= dt;
      return;
    }
    bot.cooldown = Math.max(0, bot.cooldown - dt);
    if (bot.burstLeft > 0) {
      bot.burstTimer -= dt;
      if (bot.burstTimer <= 0 && bot.cooldown === 0) {
        fireOnce(bot, env, now);
        bot.burstLeft -= 1;
        bot.burstTimer = 0.11;
        if (bot.burstLeft === 0) bot.cooldown = 0.45 + Math.random() * 0.5;
      }
      return;
    }
    if (bot.cooldown === 0) {
      bot.burstLeft = bot.weapon.kind === 'sniper' ? 1 : 3 + Math.floor(Math.random() * 3);
      bot.burstTimer = 0;
    }
  }

  function fireOnce(bot, env, now) {
    if (bot.mag <= 0) {
      if (bot.reserve > 0) bot.reloadLeft = bot.weapon.reloadTime;
      return;
    }
    bot.mag -= 1;
    bot.cooldown = bot.weapon.fireGap;
    const eye = tmpEye.set(bot.pos.x, bot.pos.y + 1.55, bot.pos.z);
    // Aim at the target chest with a skill-scaled error; a headshot is a lucky high hit.
    const target = bot.target;
    const targetPos = target.pos ? target.pos : target.state.position;
    tmpTarget.set(targetPos.x, targetPos.y + 1.25, targetPos.z);
    const distance = eye.distanceTo(tmpTarget);
    const error = (1 - bot.skill) * 0.55 + distance * 0.006;
    tmpDir.copy(tmpTarget).sub(eye).normalize();
    tmpDir.x += (Math.random() * 2 - 1) * error;
    tmpDir.y += (Math.random() * 2 - 1) * error * 0.7;
    tmpDir.z += (Math.random() * 2 - 1) * error;
    tmpDir.normalize();
    const headChance = bot.weapon.kind === 'sniper' ? 0.22 : 0.1;
    const aimHead = Math.random() < headChance;
    if (aimHead) tmpDir.y += 0.45 / Math.max(1, distance);
    tmpDir.normalize();
    ctx.raycaster.set(eye, tmpDir);
    ctx.raycaster.far = bot.weapon.range;
    const hits = ctx.raycaster.intersectObjects(env.hitMeshes, false);
    const hit = hits[0];
    if (hit) {
      ctx.tracer(eye, hit.point);
      const part = hit.object.userData.botPart || hit.object.userData.part || 'body';
      const damage = bot.weapon.damage * (part === 'head' ? bot.weapon.headMult : 1);
      ctx.damageHit(hit.object, damage, bot.name, part);
    } else {
      tmpC.copy(eye).addScaledVector(tmpDir, 40);
      ctx.tracer(eye, tmpC);
    }
    ctx.audioShot(bot.weapon.kind, Math.min(1, distance / 50));
    ctx.noise(bot.pos, bot.team, now);
  }

  function step(dt, now, env) {
    for (const bot of list) {
      if (!bot.alive) continue;
      bot.thinkTimer -= dt;
      if (bot.thinkTimer <= 0) {
        bot.thinkTimer = THINK_EVERY;
        think(bot, env, now);
      }
      // Channeling plant/defuse: stand still, progress, finish through ctx.
      if (bot.channelKind) {
        const done = ctx.channel(bot, dt);
        if (done) bot.channelKind = null;
        bot.mesh.group.position.copy(bot.pos);
        continue;
      }
      if (bot.state === 'engage' && bot.target) {
        const targetPos = bot.target.pos ? bot.target.pos : bot.target.state.position;
        const dx = targetPos.x - bot.pos.x;
        const dz = targetPos.z - bot.pos.z;
        bot.yaw = Math.atan2(-dx, -dz);
        // Strafe sideways while fighting.
        bot.strafeTimer -= dt;
        if (bot.strafeTimer <= 0) {
          bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
          bot.strafeTimer = 0.7 + Math.random() * 0.7;
        }
        const strafeX = Math.cos(bot.yaw) * bot.strafeDir;
        const strafeZ = -Math.sin(bot.yaw) * bot.strafeDir;
        world.moveCollide(bot.pos, BOT_RADIUS, strafeX * 1.6 * dt, strafeZ * 1.6 * dt);
        shootAt(bot, env, dt, now);
      } else if (bot.state === 'hold') {
        bot.yaw += (bot.holdYaw - bot.yaw) * Math.min(1, dt * 2);
        // Occasionally crouch at a hold to shrink the target.
        bot.mesh.group.scale.y = 0.88;
      } else {
        bot.mesh.group.scale.y = 1;
        const arrived = moveAlongPath(bot, dt, bot.speed);
        if (arrived && bot.state === 'route') {
          bot.state = 'hold';
          pickHoldPoint(bot);
        } else if (arrived && (bot.state === 'fetch' || bot.state === 'investigate')) {
          // Path spent (waypoints skipped past a wall): drop to hold so the
          // next think() re-paths instead of idling on a finished path.
          bot.state = 'hold';
        }
      }
      bot.mesh.group.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
      bot.mesh.group.rotation.y = bot.yaw;
    }
  }

  function hurt(bot, amount) {
    if (!bot.alive) return false;
    let remaining = amount;
    if (bot.armor > 0) {
      const absorbed = Math.min(bot.armor, remaining * 0.5);
      bot.armor -= absorbed;
      remaining -= absorbed;
    }
    bot.hp -= remaining;
    if (bot.hp <= 0) {
      bot.hp = 0;
      bot.alive = false;
      bot.mesh.group.visible = false;
      bot.mesh.group.position.y = -10;
      return true;
    }
    return false;
  }

  function aliveCount(team) {
    let count = 0;
    for (const bot of list) if (bot.alive && bot.team === team) count += 1;
    return count;
  }

  function carrier() {
    for (const bot of list) if (bot.alive && bot.isCarrier) return bot;
    return null;
  }

  return { list, spawnRound, step, hurt, aliveCount, carrier };
}
