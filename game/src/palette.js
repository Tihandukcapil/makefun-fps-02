// SANDLINE palette: a desert yard at dusk. Six UI colours plus the team colours;
// every material and every HUD element takes its colour from here, so the map and
// the interface read as one place.
export const PALETTE = {
  canvas: '#2e3550', // dusk sky, also the fog colour
  sky: '#2e3550', // scene background and fog colour (same dusk blue as canvas)
  surface: '#232838', // panels and shaded faces
  hairline: '#3a4152', // thin borders, dark metal
  ink: '#efe8d8', // warm off-white text and tracers
  muted: '#9aa0a8', // secondary text
  accent: '#f0a830', // amber: sun, muzzle flash, buy highlights
  sand: '#c9a06b', // ground
  sandDark: '#a8814f', // ground variation
  wall: '#a8663f', // terracotta walls
  wallDark: '#8a5232', // shaded terracotta
  crate: '#7a5a38', // wooden crates
  crateDark: '#5f4529',
  metal: '#4a4f58', // barrels, doors
  teal: '#35c4b5', // friendly team, site B markers
  amber: '#f0a830', // site A markers
  enemy: '#e5484d', // enemy team, damage
  smoke: '#b9b3a4', // smoke grenade
};

export const TEAMS = {
  vipers: { name: 'VIPERS', color: 0x35c4b5, css: '#35c4b5', spawn: 'west' },
  jackals: { name: 'JACKALS', color: 0xe5484d, css: '#e5484d', spawn: 'east' },
};
