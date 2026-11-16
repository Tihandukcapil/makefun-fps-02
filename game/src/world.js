// SANDLINE YARD — STORM PROTOCOL: an original desert map at dusk. One flat
// arena, two bombsites, a mid wall with a double-door gap, and two long
// corridors. Everything the game collides with or shoots at is built here; bots
// navigate on the waypoint graph. New in Storm Protocol: storm-shelter crates
// at mid and the map's lights are exposed so the sandstorm can dim the sun and
// hide the sun disc while it blows.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

function canvasTexture(size, draw, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function sandTexture() {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = PALETTE.sand;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i += 1) {
      const shade = Math.random();
      ctx.fillStyle = shade < 0.5 ? PALETTE.sandDark : '#d9b47e';
      ctx.globalAlpha = 0.12 + Math.random() * 0.2;
      const r = 1 + Math.random() * 3;
      ctx.beginPath();
      ctx.arc(Math.random() * s, Math.random() * s, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, 6, 5);
}

function wallTexture() {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = PALETTE.wall;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = PALETTE.wallDark;
    ctx.fillRect(0, s - 18, s, 18);
    ctx.fillRect(0, 0, s, 6);
    for (let i = 0; i < 260; i += 1) {
      ctx.fillStyle = Math.random() < 0.5 ? PALETTE.wallDark : '#b5764a';
      ctx.globalAlpha = 0.08 + Math.random() * 0.14;
      ctx.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 8, 2 + Math.random() * 4);
    }
    ctx.globalAlpha = 1;
  }, 4, 1);
}

function crateTexture() {
  return canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = PALETTE.crate;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = PALETTE.crateDark;
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, s - 8, s - 8);
    ctx.beginPath();
    ctx.moveTo(4, 4);
    ctx.lineTo(s - 4, s - 4);
    ctx.moveTo(s - 4, 4);
    ctx.lineTo(4, s - 4);
    ctx.stroke();
  });
}

function letterTexture(letter, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = color;
  ctx.font = 'bold 96px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// A waypoint graph: nodes with positions, adjacency by index. Bots run BFS over it.
// Every node sits in open floor: the mid wall runs along z=0, so the nodes that
// flank it sit at z=-2 (the wall's own z range is -0.5..0.5 and its door gap is
// x -3..3, where node 10 sits). A node inside a collider is unreachable — the bot
// would push against the wall forever — so no node touches a collider.
const WAYPOINTS = [
  [-19, -2], [-14, -2], [-14, -8], [-14, -16], [-8, -16], [0, -17], [8, -16], [12, -16],
  [13, -13], [16, -12], [0, -2], [6, -2], [12, -8], [12, 4], [8, 12], [4, 14],
  [-14, 8], [-14, 16], [-8, 16], [-2, 16], [-13, 14], [-16, 12],
  [19, -2], [14, -8], [13, -9], [18, -16], [14, 8], [8, 12], [-13, 10], [-18, 15],
  [6, -8], [-6, 8], [-10, 5],
];
const EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9],
  [1, 10], [10, 11], [11, 12], [12, 8], [13, 14], [14, 15],
  [16, 17], [18, 19], [20, 21], [21, 17], [28, 16],
  [22, 23], [23, 24], [23, 25], [23, 12], [26, 27], [27, 14], [28, 29],
  [10, 30], [30, 12], [10, 31], [31, 15], [30, 5], [32, 16], [32, 31], [18, 15],
];
// NOTE: no edge crosses the mid wall (z=0) except through the double-door gap at
// x -3..3. Node 10 sits NORTH of the gap at (0,-2), not in its centre: a bot
// walking straight at (0,0) wedges on the door frame's corner (both slide axes
// blocked at once) and ping-pongs there forever. From (0,-2) the crossing legs
// (10-31, 10-11) pass the gap's centreline, clear of both frames.
// The old edges [1,16], [11,13] and [22,26] cut straight through the wall and
// trapped every bot that used them: the bot slid along the wall face forever
// while its path kept resetting. Crossings go through the gap now
// (1-10-31-17-16 west, 11-10-31-15-14-13 east, and the north-east cluster
// reaches the gap via the new edge 23-12).

export function createWorld(scene) {
  const colliders = [];
  const shootables = [];
  const group = new THREE.Group();
  scene.add(group);

  // Light: a low warm sun from the west (where the sun disc sits) with shadows
  // across the whole arena, plus a cool hemisphere fill so shaded faces stay readable.
  const sunLight = new THREE.DirectionalLight(new THREE.Color('#ffd9a0'), 2.4);
  sunLight.position.set(-30, 24, -40);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -32;
  sunLight.shadow.camera.right = 32;
  sunLight.shadow.camera.top = 28;
  sunLight.shadow.camera.bottom = -28;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 130;
  sunLight.shadow.bias = -0.0004;
  scene.add(sunLight);
  scene.add(sunLight.target);
  const skyLight = new THREE.HemisphereLight(new THREE.Color('#6a7ba8'), new THREE.Color('#8a6a48'), 0.75);
  scene.add(skyLight);

  const sand = new THREE.MeshStandardMaterial({ map: sandTexture(), roughness: 1, metalness: 0 });
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.9, metalness: 0 });
  const crateMat = new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.85, metalness: 0 });
  const metalMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.metal), roughness: 0.5, metalness: 0.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.9, metalness: 0.1 });
  const tealMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.teal), roughness: 0.6, metalness: 0.1, emissive: new THREE.Color(PALETTE.teal), emissiveIntensity: 0.35 });
  const amberMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.amber), roughness: 0.6, metalness: 0.1, emissive: new THREE.Color(PALETTE.amber), emissiveIntensity: 0.35 });

  const tmpBox = new THREE.BoxGeometry(1, 1, 1);
  function box(x, z, w, h, d, material, collide = true, shootable = true) {
    const mesh = new THREE.Mesh(tmpBox, material);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 });
    if (shootable) shootables.push(mesh);
    return mesh;
  }

  // Ground.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(46, 38), sand);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  shootables.push(ground);

  // Perimeter walls.
  box(0, -18.5, 46, 4, 1, wallMat);
  box(0, 18.5, 46, 4, 1, wallMat);
  box(-22.5, 0, 1, 4, 38, wallMat);
  box(22.5, 0, 1, 4, 38, wallMat);

  // Mid wall with the double-door gap at x in [-3, 3].
  box(-12.5, 0, 19, 3.2, 1, wallMat);
  box(12.5, 0, 19, 3.2, 1, wallMat);
  // Door frames.
  box(-3.2, 0, 0.6, 3.2, 1.0, metalMat);
  box(3.2, 0, 0.6, 3.2, 1.0, metalMat);

  // Site A crates yard (north-east).
  box(15, -15, 2, 1.2, 2, crateMat);
  box(18, -10, 1.2, 1, 1.2, crateMat);
  box(13, -11, 1, 2.2, 1, crateMat);
  box(17.5, -14.5, 2.4, 1, 1, crateMat);
  box(14, -16.5, 1, 1, 1, crateMat);
  // Site B warehouse shell (south-west): three walls, open to the north.
  box(-16, 17.5, 9, 3.4, 1, wallMat);
  box(-20.5, 12.5, 1, 3.4, 10, wallMat);
  box(-11.5, 12.5, 1, 3.4, 10, wallMat);
  box(-18, 10, 2, 1.2, 2, crateMat);
  box(-14, 14.5, 1.2, 1, 1.2, crateMat);
  box(-15, 10.5, 1, 2.2, 1, crateMat);

  // Mid cover: truck, sandbags, barrels, watchtower base.
  box(-2, 8, 4, 2, 2, metalMat); // truck body
  box(-2, 8, 4.6, 0.9, 2.2, darkMat); // truck bed rim
  box(6, -6, 3, 0.9, 1, crateMat); // sandbag line
  box(-8, -6, 1.2, 1.2, 1.2, crateMat);
  box(10, 6, 1.2, 1.2, 1.2, crateMat);
  box(-6, 13, 2, 1, 2, crateMat);
  box(4, -13, 1.2, 1.2, 1.2, crateMat);
  box(0, -14, 3, 2.6, 3, crateMat); // watchtower base
  box(0, -14, 3.4, 0.4, 3.4, darkMat); // tower platform rim

  // Storm shelters: new close-quarters cover for when the sandstorm closes the
  // sightlines. Both sit clear of every waypoint leg (checked against the graph:
  // the west stack is 3 m off the x=-14 lane, the east crate 3 m off the
  // (14,8)-(8,12) leg, the south sandbags 6 m off the (-6,8)-(4,14) leg).
  box(-11, -11, 1.6, 1.2, 1.6, crateMat);
  box(-11, -11, 1.2, 2.4, 1.2, crateMat);
  box(11.5, 13.5, 1.2, 1.2, 1.2, crateMat);
  box(3, 6, 2.4, 0.9, 1, crateMat); // south sandbag line

  // Site markers: big letters on the perimeter walls + a glowing beacon at each plant zone.
  function siteMarker(x, z, letter, color, material) {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 3),
      new THREE.MeshBasicMaterial({ map: letterTexture(letter, color), transparent: true, depthWrite: false }),
    );
    plane.position.set(x, 2.2, z);
    plane.rotation.y = z < 0 ? 0 : Math.PI;
    group.add(plane);
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.2, 8), material);
    beacon.position.set(x, 1.6, z);
    group.add(beacon);
  }
  siteMarker(16, -17.9, 'A', PALETTE.amber, amberMat);
  siteMarker(-16, 17.9, 'B', PALETTE.teal, tealMat);

  // Distant skyline silhouettes outside the arena, for depth.
  const skyline = new THREE.Group();
  for (let i = 0; i < 14; i += 1) {
    const angle = (i / 14) * Math.PI * 2;
    const r = 60 + (i % 3) * 14;
    const h = 8 + ((i * 7) % 14);
    const slab = new THREE.Mesh(tmpBox, darkMat);
    slab.scale.set(10 + (i % 4) * 4, h, 4);
    slab.position.set(Math.cos(angle) * r, h / 2 - 1, Math.sin(angle) * r);
    skyline.add(slab);
  }
  scene.add(skyline);

  // Drifting dust motes.
  const dustCount = 220;
  const dustPositions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i += 1) {
    dustPositions[i * 3] = (Math.random() - 0.5) * 44;
    dustPositions[i * 3 + 1] = 0.3 + Math.random() * 4;
    dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 36;
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: new THREE.Color('#e8c890'), size: 0.06, transparent: true, opacity: 0.55 }));
  scene.add(dust);

  // Sun disc low on the horizon. The storm hides it while it blows.
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(3.4, 32),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb347'), fog: false }),
  );
  sun.position.set(-38, 9, -52);
  sun.lookAt(0, 2, 0);
  scene.add(sun);

  const adjacency = WAYPOINTS.map(() => []);
  for (const [a, b] of EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  const raycaster = new THREE.Raycaster();
  const rayFrom = new THREE.Vector3();
  const rayDir = new THREE.Vector3();

  function hitsCollider(x, z, radius) {
    for (let i = 0; i < colliders.length; i += 1) {
      const c = colliders[i];
      if (x + radius > c.x0 && x - radius < c.x1 && z + radius > c.z0 && z - radius < c.z1) return true;
    }
    return false;
  }

  return {
    colliders,
    shootables,
    lights: { sun: sunLight, sky: skyLight, sunDisc: sun },
    sites: {
      A: { center: new THREE.Vector3(16, 0, -12), zone: { x0: 13.5, z0: -14.5, x1: 18.5, z1: -9.5 } },
      B: { center: new THREE.Vector3(-16, 0, 12), zone: { x0: -18.5, z0: 9.5, x1: -13.5, z1: 14.5 } },
    },
    spawns: {
      vipers: [
        new THREE.Vector3(-19, 0, -2), new THREE.Vector3(-19, 0, -4), new THREE.Vector3(-19, 0, 2),
        new THREE.Vector3(-17.5, 0, -3), new THREE.Vector3(-17.5, 0, 3),
      ],
      jackals: [
        new THREE.Vector3(19, 0, -2), new THREE.Vector3(19, 0, -4), new THREE.Vector3(19, 0, 2),
        new THREE.Vector3(17.5, 0, -3), new THREE.Vector3(17.5, 0, 3),
      ],
    },
    waypoints: { nodes: WAYPOINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)), adjacency },
    holdPoints: {
      A: [new THREE.Vector3(13, 0, -9), new THREE.Vector3(18, 0, -15)],
      B: [new THREE.Vector3(-13, 0, 10), new THREE.Vector3(-18, 0, 15)],
      mid: [new THREE.Vector3(6, 0, 0), new THREE.Vector3(-6, 0, 0)],
    },
    // Axis-separated slide: try x, then z, so a bot hugging a wall keeps moving along it.
    moveCollide(position, radius, dx, dz) {
      const nx = position.x + dx;
      if (!hitsCollider(nx, position.z, radius)) position.x = nx;
      const nz = position.z + dz;
      if (!hitsCollider(position.x, nz, radius)) position.z = nz;
      position.x = Math.max(-21.5, Math.min(21.5, position.x));
      position.z = Math.max(-17.5, Math.min(17.5, position.z));
    },
    // True when a wall or crate sits between two points (bot sight, flash checks).
    losBlocked(a, b) {
      rayFrom.copy(a);
      rayDir.copy(b).sub(a);
      const distance = rayDir.length();
      if (distance < 0.01) return false;
      rayDir.multiplyScalar(1 / distance);
      raycaster.set(rayFrom, rayDir);
      raycaster.far = distance;
      return raycaster.intersectObjects(shootables, false).length > 0;
    },
    update(dt, time) {
      dust.rotation.y = time * 0.004;
      const positions = dustGeometry.attributes.position;
      for (let i = 0; i < dustCount; i += 1) {
        const y = positions.array[i * 3 + 1] + Math.sin(time * 0.4 + i) * 0.0006;
        positions.array[i * 3 + 1] = y;
      }
      positions.needsUpdate = true;
    },
  };
}
