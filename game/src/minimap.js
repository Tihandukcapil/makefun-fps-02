// The tactical minimap: a live top-down view of the yard in the HUD corner.
// Walls, both bomb sites, teammates, the bomb and — only while a FALCON pulse
// has them revealed — enemies. It is drawn on a 2D canvas every HUD tick, so
// it costs one small canvas redraw, never a second WebGL pass.
import { PALETTE } from './palette.js';

const BOUNDS = { x0: -23, x1: 23, z0: -19, z1: 19 };

export function createMinimap(canvas, world) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;

  function toMap(x, z) {
    return [
      ((x - BOUNDS.x0) / (BOUNDS.x1 - BOUNDS.x0)) * width,
      ((z - BOUNDS.z0) / (BOUNDS.z1 - BOUNDS.z0)) * height,
    ];
  }

  function dot(x, z, radius, color) {
    const [mx, my] = toMap(x, z);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(mx, my, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  return {
    // data: { player, mates, pings, bomb, sites, storm, now }
    draw(data) {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(28, 33, 51, 0.92)';
      ctx.fillRect(0, 0, width, height);
      // Walls and crates as blocks.
      ctx.fillStyle = '#3a4152';
      for (const c of world.colliders) {
        const [x0, y0] = toMap(c.x0, c.z0);
        const [x1, y1] = toMap(c.x1, c.z1);
        ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
      }
      // Bomb sites.
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const [key, site] of Object.entries(data.sites)) {
        const [mx, my] = toMap(site.center.x, site.center.z);
        ctx.fillStyle = key === 'A' ? 'rgba(240, 168, 48, 0.25)' : 'rgba(53, 196, 181, 0.25)';
        ctx.beginPath();
        ctx.arc(mx, my, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = key === 'A' ? PALETTE.amber : PALETTE.teal;
        ctx.fillText(key, mx, my);
      }
      // The bomb: planted or dropped it sits on the map; carried it rides its carrier.
      if (data.bomb.state === 'planted' || data.bomb.state === 'dropped') {
        const [mx, my] = toMap(data.bomb.pos.x, data.bomb.pos.z);
        const pulse = 3 + Math.sin(data.now * 5) * 1.2;
        ctx.fillStyle = '#ffd27a';
        ctx.beginPath();
        ctx.arc(mx, my, pulse, 0, Math.PI * 2);
        ctx.fill();
      }
      // Teammates.
      for (const mate of data.mates) {
        if (!mate.alive) continue;
        dot(mate.pos.x, mate.pos.z, 2.6, PALETTE.teal);
      }
      // Pulse-revealed enemies: red dots with a ring, only while the ping lives.
      for (const ping of data.pings) {
        if (ping.until <= data.now) continue;
        const [mx, my] = toMap(ping.x, ping.z);
        ctx.strokeStyle = 'rgba(229, 72, 77, 0.9)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(mx, my, 5, 0, Math.PI * 2);
        ctx.stroke();
        dot(ping.x, ping.z, 2.6, PALETTE.enemy);
      }
      // The player: a white arrow that turns with the view.
      if (data.player.alive) {
        const [mx, my] = toMap(data.player.pos.x, data.player.pos.z);
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(Math.atan2(-Math.sin(data.player.yaw), -Math.cos(data.player.yaw)) + Math.PI / 2);
        ctx.fillStyle = '#efe8d8';
        ctx.beginPath();
        ctx.moveTo(0, -5);
        ctx.lineTo(3.6, 4);
        ctx.lineTo(-3.6, 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      // A storm washes the whole map orange while it blows.
      if (data.storm > 0.02) {
        ctx.fillStyle = `rgba(168, 111, 60, ${0.28 * data.storm})`;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.strokeStyle = 'rgba(154, 160, 168, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
    },
  };
}
