// SANDLINE: STORM PROTOCOL — a three.js tactical FPS entry (Node 22, standard
// library only). The game is this directory's game/ folder: plain static files
// the browser loads as ES modules with three.js 0.187.0 from an import map.
// What makes it Storm Protocol: rolling sandstorms that collapse the sightlines
// mid-round, a FALCON pulse drone that reveals enemies through walls, and a
// live tactical minimap. main.ts hands it in: it copies game/ and screenshots/
// from beside this file to /output and writes /output/dossier.json, the summary
// the judge reads, with the vendored make.fun library. Serve it locally with
// `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const gameDir = join(here, 'game');
const shotsDir = join(here, 'screenshots');
if (!existsSync(join(gameDir, 'index.html'))) throw new Error('game/index.html is missing');
const shots = existsSync(shotsDir)
  ? readdirSync(shotsDir).filter((name) => !name.startsWith('.'))
  : [];
if (shots.length < 3 || shots.length > 4) {
  throw new Error(`screenshots/ must hold 3 or 4 images, found ${shots.length}`);
}
// The gate refuses a screenshot over 256 KiB and an index.html over 1 MiB, so refuse
// loudly here instead of handing in an entry the scorer would refuse.
for (const name of shots) {
  if (statSync(join(shotsDir, name)).size > 262144) throw new Error(`screenshots/${name} is over 256 KiB`);
}
if (statSync(join(gameDir, 'index.html')).size > 1048576) throw new Error('game/index.html is over 1 MiB');

mkdirSync(out, { recursive: true });
cpSync(gameDir, join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
cpSync(shotsDir, join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all: game/ counts beside /output's own 1000-entry cap, its screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, game_max_files: 993, game_max_bytes: 50331648 }),
);
