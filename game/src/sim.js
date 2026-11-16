// The simulation: one state object, one fixed-step update. Rounds, money, the bomb,
// kills, the score, the sandstorm schedule and the FALCON drone charges live here;
// rendering only reads this state. Nothing here touches the DOM or the renderer
// except through the callbacks main.js wires in.
export const ROUND_TIME = 100;
export const BUY_TIME = 12;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;
export const BOMB_TIME = 35;
export const WIN_ROUNDS = 5;
export const DRONE_PRICE = 400;

// Storm windows, in seconds left on the round timer. Each round gets up to two
// storms: a 5-second warning, then the blow itself. The yard is a different
// game while one is up — sightlines collapse and fights go close-quarters.
const STORM_SCHEDULE = [
  { warnAt: 60, startAt: 55, endAt: 37 },
  { warnAt: 28, startAt: 23, endAt: 8 },
];

export function createSim(deps) {
  const { world, bots, grenades, hud, audio } = deps;

  const state = {
    phase: 'buy', // buy | live | planted | roundEnd | matchEnd
    round: 1,
    score: { vipers: 0, jackals: 0 },
    timer: BUY_TIME,
    money: 800,
    lossStreak: 0,
    bomb: { state: 'held', site: null, pos: null, carrier: null, plantProgress: 0, defuseProgress: 0, timer: 0 },
    kills: { vipers: 0, jackals: 0 },
    time: 0,
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
    bombSiteChoice: 'A',
    storm: { phase: 'calm', intensity: 0, slot: 0, nextAt: STORM_SCHEDULE[0].warnAt },
    droneCharges: 1,
    droneBought: false,
  };

  const noise = []; // { pos, team, time } — gunshots bots can hear.

  function otherTeam(team) {
    return team === 'vipers' ? 'jackals' : 'vipers';
  }

  function startMatch() {
    state.phase = 'buy';
    state.round = 1;
    state.score = { vipers: 0, jackals: 0 };
    state.timer = BUY_TIME;
    state.money = 800;
    state.lossStreak = 0;
    state.bomb = { state: 'held', site: null, pos: null, carrier: null, plantProgress: 0, defuseProgress: 0, timer: 0 };
    state.kills = { vipers: 0, jackals: 0 };
    state.matchWinner = null;
    state.droneBought = false;
    startRound();
  }

  function startRound() {
    state.bombSiteChoice = Math.random() < 0.6 ? 'A' : 'B';
    state.phase = 'buy';
    state.timer = BUY_TIME;
    state.bomb = { state: 'held', site: state.bombSiteChoice, pos: null, carrier: 'player', plantProgress: 0, defuseProgress: 0, timer: 0 };
    state.roundWinner = null;
    state.roundReason = '';
    state.storm = { phase: 'calm', intensity: 0, slot: 0, nextAt: STORM_SCHEDULE[0].warnAt };
    state.droneCharges = 1 + (state.droneBought ? 1 : 0);
    noise.length = 0;
    grenades.reset();
    deps.resetRound(state.bombSiteChoice);
    hud.setRound(state.round, state.score);
    hud.setMoney(state.money);
    hud.setBomb('held');
    hud.setTimer(Math.ceil(state.timer));
    hud.setStorm('calm', 0);
    hud.setDrone(state.droneCharges);
    hud.banner(`ROUND ${state.round}`, 'Buy phase — press B to shop, the round starts soon.');
    audio.buy();
  }

  function aliveCount(team, playerAlive) {
    return bots.aliveCount(team) + (team === 'vipers' && playerAlive ? 1 : 0);
  }

  function endRound(winner, reason) {
    if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
    state.roundWinner = winner;
    state.roundReason = reason;
    state.score[winner] += 1;
    const playerWon = winner === 'vipers';
    if (playerWon) {
      state.money += 3250;
      state.lossStreak = 0;
      audio.roundWin();
    } else {
      state.money += state.lossStreak >= 1 ? 2400 : 1900;
      state.lossStreak += 1;
      audio.roundLose();
    }
    hud.setMoney(state.money);
    hud.setRound(state.round, state.score);
    hud.banner(playerWon ? 'ROUND WON' : 'ROUND LOST', reason);
    hud.killfeedSystem(`${winner === 'vipers' ? 'VIPERS' : 'JACKALS'} take round ${state.round} — ${reason}`);
    if (state.score[winner] >= WIN_ROUNDS) {
      state.phase = 'matchEnd';
      state.matchWinner = winner;
      hud.showOverlay('match', state.matchWinner === 'vipers' ? 'win' : 'lose', state.score);
      return;
    }
    state.phase = 'roundEnd';
    state.timer = 4;
  }

  function checkElimination(playerAlive) {
    const vipersAlive = aliveCount('vipers', playerAlive);
    const jackalsAlive = aliveCount('jackals', playerAlive);
    if (vipersAlive === 0) endRound('jackals', 'VIPERS eliminated');
    else if (jackalsAlive === 0) endRound('vipers', 'JACKALS eliminated');
  }

  function damageBot(bot, amount, attackerName, part) {
    const died = bots.hurt(bot, amount);
    if (died) {
      state.kills[otherTeam(bot.team)] += 1;
      hud.killfeed(attackerName, bot.name, part === 'head');
      if (attackerName === 'YOU') {
        state.money += 300;
        hud.setMoney(state.money);
      }
      if (bot.isCarrier) {
        state.bomb.state = 'dropped';
        state.bomb.pos = bot.pos.clone();
        state.bomb.carrier = null;
        hud.killfeedSystem('The bomb was dropped.');
      }
      checkElimination(deps.playerAlive());
    }
    return died;
  }

  function damagePlayer(amount, attackerName, part) {
    const dealt = deps.playerHurt(amount);
    if (dealt > 0) hud.damageFlash(attackerName);
    if (!deps.playerAlive()) {
      hud.killfeed(attackerName, 'YOU', part === 'head');
      if (state.bomb.carrier === 'player') {
        state.bomb.state = 'dropped';
        state.bomb.pos = deps.playerPos().clone();
        state.bomb.carrier = null;
        hud.killfeedSystem('The bomb was dropped.');
      }
      checkElimination(false);
    }
    return dealt;
  }

  // A bot channels a plant or a defuse. Returns true when the channel completes.
  function channel(bot, dt) {
    if (bot.channelKind === 'plant') {
      state.bomb.plantProgress += dt / PLANT_TIME;
      audio.plantBeep();
      if (state.bomb.plantProgress >= 1) {
        state.bomb.state = 'planted';
        state.bomb.pos = bot.pos.clone();
        state.bomb.timer = BOMB_TIME;
        state.phase = 'planted';
        state.timer = BOMB_TIME;
        state.bomb.plantProgress = 0;
        hud.setBomb('planted', BOMB_TIME);
        hud.banner('BOMB PLANTED', 'Defend the site — 35 seconds.');
        return true;
      }
      return false;
    }
    if (bot.channelKind === 'defuse') {
      state.bomb.defuseProgress += dt / DEFUSE_TIME;
      audio.defuseBeep();
      if (state.bomb.defuseProgress >= 1) {
        endRound('jackals', 'Bomb defused');
        return true;
      }
      return false;
    }
    return true;
  }

  function playerPlant(dt) {
    if (state.bomb.state !== 'held' || state.bomb.carrier !== 'player') return;
    const zone = world.sites[state.bomb.site].zone;
    const pos = deps.playerPos();
    if (pos.x < zone.x0 || pos.x > zone.x1 || pos.z < zone.z0 || pos.z > zone.z1) {
      state.bomb.plantProgress = 0;
      return;
    }
    state.bomb.plantProgress += dt / PLANT_TIME;
    if (Math.floor(state.bomb.plantProgress * 10) !== Math.floor((state.bomb.plantProgress - dt / PLANT_TIME) * 10)) audio.plantBeep();
    if (state.bomb.plantProgress >= 1) {
      state.bomb.state = 'planted';
      state.bomb.pos = pos.clone();
      state.bomb.timer = BOMB_TIME;
      state.phase = 'planted';
      state.timer = BOMB_TIME;
      state.bomb.plantProgress = 0;
      hud.setBomb('planted', BOMB_TIME);
      hud.banner('BOMB PLANTED', 'Defend the site — 35 seconds.');
    }
  }

  function playerDefuse(dt) {
    if (state.bomb.state !== 'planted') return;
    const pos = deps.playerPos();
    const distance = Math.hypot(pos.x - state.bomb.pos.x, pos.z - state.bomb.pos.z);
    if (distance > 1.8) {
      state.bomb.defuseProgress = 0;
      return;
    }
    state.bomb.defuseProgress += dt / DEFUSE_TIME;
    if (Math.floor(state.bomb.defuseProgress * 10) !== Math.floor((state.bomb.defuseProgress - dt / DEFUSE_TIME) * 10)) audio.defuseBeep();
    if (state.bomb.defuseProgress >= 1) endRound('jackals', 'Bomb defused');
  }

  function bombPickup(bot) {
    bot.isCarrier = true;
    state.bomb.state = 'held';
    state.bomb.carrier = bot.name;
    state.bomb.pos = null;
    hud.killfeedSystem(`${bot.name} picked up the bomb.`);
  }

  function playerPickupBomb() {
    if (!deps.playerAlive()) return; // a dead player cannot pick the bomb back up
    if (state.bomb.state === 'dropped' && state.bomb.pos) {
      const pos = deps.playerPos();
      if (Math.hypot(pos.x - state.bomb.pos.x, pos.z - state.bomb.pos.z) < 1.2) {
        state.bomb.state = 'held';
        state.bomb.carrier = 'player';
        state.bomb.pos = null;
        hud.killfeedSystem('You picked up the bomb.');
      }
    }
  }

  function buy(itemId, price) {
    if (state.phase !== 'buy') return false;
    if (state.money < price) {
      audio.denied();
      return false;
    }
    state.money -= price;
    hud.setMoney(state.money);
    audio.buy();
    return true;
  }

  // A second FALCON charge for the match ($400, buy phase only, once per match).
  function buyDrone() {
    if (state.phase !== 'buy' || state.droneBought) return false;
    if (state.money < DRONE_PRICE) {
      audio.denied();
      return false;
    }
    state.money -= DRONE_PRICE;
    state.droneBought = true;
    state.droneCharges += 1;
    hud.setMoney(state.money);
    hud.setDrone(state.droneCharges);
    audio.buy();
    return true;
  }

  function useDroneCharge() {
    if (state.droneCharges <= 0) return false;
    state.droneCharges -= 1;
    hud.setDrone(state.droneCharges);
    return true;
  }

  // The storm clock: warnings and blows are driven by the round timer, and the
  // intensity eases toward its target so the yard never snaps between states.
  function stepStorm(dt) {
    const storm = state.storm;
    const slot = STORM_SCHEDULE[storm.slot];
    if (slot && (state.phase === 'live' || state.phase === 'planted')) {
      if (storm.phase === 'calm' && state.timer <= slot.warnAt) {
        storm.phase = 'warning';
        storm.nextAt = slot.startAt;
        hud.setStorm('warning', 0);
        hud.banner('SANDSTORM INCOMING', 'Visibility is about to collapse — get close or get cover.');
        hud.killfeedSystem('A sandstorm is rolling in.');
      } else if (storm.phase === 'warning' && state.timer <= slot.startAt) {
        storm.phase = 'storm';
        storm.nextAt = slot.endAt;
        hud.setStorm('storm', 0);
        hud.banner('SANDSTORM', 'Sightlines are gone. Fight close, fight loud.');
      } else if (storm.phase === 'storm' && state.timer <= slot.endAt) {
        storm.phase = 'calm';
        storm.slot += 1;
        const next = STORM_SCHEDULE[storm.slot];
        storm.nextAt = next ? next.warnAt : -1;
        hud.setStorm('calm', 0);
        hud.killfeedSystem('The storm has passed.');
      }
    }
    const target = storm.phase === 'storm' ? 1 : 0;
    const rate = target > storm.intensity ? 0.55 : 0.3;
    storm.intensity += (target - storm.intensity) * Math.min(1, dt * rate * 3);
    if (Math.abs(target - storm.intensity) < 0.004) storm.intensity = target;
  }

  function step(dt, env) {
    state.time += dt;
    if (state.phase === 'buy') {
      state.timer -= dt;
      hud.setTimer(Math.max(0, Math.ceil(state.timer)));
      if (state.timer <= 0) {
        state.phase = 'live';
        state.timer = ROUND_TIME;
        hud.setTimer(ROUND_TIME);
        hud.banner('GO GO GO', `Plant the bomb at site ${state.bomb.site}.`);
      }
      return;
    }
    if (state.phase === 'roundEnd') {
      state.timer -= dt;
      if (state.timer <= 0) {
        state.round += 1;
        startRound();
      }
      return;
    }
    if (state.phase === 'matchEnd') return;

    // Live or planted.
    state.timer -= dt;
    hud.setTimer(Math.max(0, Math.ceil(state.timer)));
    stepStorm(dt);
    if (state.bomb.state === 'planted') {
      state.bomb.timer -= dt;
      hud.setBomb('planted', Math.max(0, state.bomb.timer));
      const secondsLeft = Math.ceil(state.bomb.timer);
      if (secondsLeft <= 10 && secondsLeft !== state.lastBeepSecond) {
        state.lastBeepSecond = secondsLeft;
        audio.bombBeep(secondsLeft <= 5);
      }
      if (state.bomb.timer <= 0) {
        audio.explosion();
        endRound('vipers', 'Bomb detonated');
        return;
      }
    }
    if (state.phase === 'live' && state.timer <= 0) {
      endRound(state.bomb.state === 'planted' ? 'vipers' : 'jackals', state.bomb.state === 'planted' ? 'Time expired after the plant' : 'Time expired — bomb never planted');
      return;
    }

    // The player planting / defusing is driven by the E key, polled by main.js.
    // A bot channels through sim.channel instead — and its progress must NOT be
    // zeroed by the player's inactivity (that bug froze every bot plant at 0).
    const botPlanting = bots.list.some((b) => b.alive && b.channelKind === 'plant');
    const botDefusing = bots.list.some((b) => b.alive && b.channelKind === 'defuse');
    if (env.playerPlanting) playerPlant(dt);
    else if (!botPlanting) state.bomb.plantProgress = 0;
    if (env.playerDefusing) playerDefuse(dt);
    else if (!botDefusing && state.bomb.state === 'planted') state.bomb.defuseProgress = 0;
    playerPickupBomb();

    // Expire old noises.
    for (let i = noise.length - 1; i >= 0; i -= 1) {
      if (state.time - noise[i].time > 6) noise.splice(i, 1);
    }
  }

  return {
    state,
    noise,
    startMatch,
    startRound,
    step,
    damageBot,
    damagePlayer,
    channel,
    bombPickup,
    buy,
    buyDrone,
    useDroneCharge,
    aliveCount,
    addNoise(pos, team) {
      noise.push({ pos: pos.clone(), team, time: state.time });
    },
  };
}
