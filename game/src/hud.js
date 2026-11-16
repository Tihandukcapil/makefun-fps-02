// The HUD: every DOM element the player reads, and nothing else. It never decides
// game state — it only shows what the sim tells it. All ids live in index.html.
// New in Storm Protocol: the storm meter, the FALCON charge readout, and the red
// diamonds that mark pulse-revealed enemies on screen.
export function createHud() {
  const el = (id) => document.getElementById(id);
  const healthValue = el('health-value');
  const healthBar = el('health-bar');
  const armorValue = el('armor-value');
  const ammoMag = el('ammo-mag');
  const ammoReserve = el('ammo-reserve');
  const ammoBox = el('ammo');
  const moneyValue = el('money-value');
  const timerValue = el('timer-value');
  const scoreVipers = el('score-vipers');
  const scoreJackals = el('score-jackals');
  const roundValue = el('round-value');
  const crosshair = el('crosshair');
  const hitmarker = el('hitmarker');
  const killfeed = el('killfeed');
  const banner = el('banner');
  const bannerTitle = el('banner-title');
  const bannerSub = el('banner-sub');
  const overlay = el('overlay');
  const overlayTitle = el('overlay-title');
  const overlayCopy = el('overlay-copy');
  const playButton = el('play');
  const buyMenu = el('buy-menu');
  const buyMoney = el('buy-money');
  const teammates = el('teammates');
  const bombStatus = el('bomb-status');
  const damageVignette = el('damage-vignette');
  const flashOverlay = el('flash-overlay');
  const grenadeCounts = el('grenades');
  const stormLabel = el('storm-label');
  const stormBar = el('storm-bar');
  const stormMeter = el('storm-meter');
  const droneStatus = el('drone-status');
  const pingLayer = el('ping-layer');

  let bannerTimer = 0;
  let playCallback = null;
  let buyCallback = null;
  const pingDots = [];
  for (let i = 0; i < 5; i += 1) {
    const dot = document.createElement('div');
    dot.className = 'ping-dot';
    dot.hidden = true;
    pingLayer.appendChild(dot);
    pingDots.push(dot);
  }

  function showOverlay(kind, detail, score) {
    overlay.hidden = false;
    if (kind === 'start') {
      overlayTitle.textContent = 'SANDLINE';
      overlayCopy.textContent = 'A desert yard at dusk, with sandstorms that swallow the sightlines and a FALCON drone that sees through them. Plant the bomb or wipe the Jackals — first to 5 rounds takes the match.';
      playButton.textContent = 'Click to play';
    } else if (kind === 'paused') {
      overlayTitle.textContent = 'Paused';
      overlayCopy.textContent = 'Click to resume. Your team is waiting.';
      playButton.textContent = 'Resume';
    } else if (kind === 'end') {
      overlayTitle.textContent = 'Round over';
      overlayCopy.textContent = `Score ${score}. Click to play the next round.`;
      playButton.textContent = 'Next round';
    } else if (kind === 'match') {
      overlayTitle.textContent = detail === 'win' ? 'MATCH WON' : 'MATCH LOST';
      overlayCopy.textContent = `Final score VIPERS ${score.vipers} — ${score.jackals} JACKALS. Click to play again.`;
      playButton.textContent = 'Play again';
    }
  }

  function hideOverlay() {
    overlay.hidden = true;
  }

  playButton.addEventListener('click', () => {
    if (playCallback) playCallback();
  });

  return {
    onPlay(callback) {
      playCallback = callback;
    },
    onBuy(callback) {
      buyCallback = callback;
    },
    showOverlay,
    hideOverlay,
    setHealth(health, armor) {
      healthValue.textContent = Math.ceil(health);
      healthBar.style.width = `${Math.max(0, health)}%`;
      healthBar.classList.toggle('low', health < 35);
      armorValue.textContent = armor > 0 ? `+${Math.ceil(armor)}` : '';
    },
    setAmmo(mag, reserve, weaponName) {
      ammoMag.textContent = mag;
      ammoReserve.textContent = `/ ${reserve}`;
      ammoBox.classList.toggle('empty', mag === 0);
      const label = el('weapon-name');
      if (label && weaponName) label.textContent = weaponName;
    },
    setMoney(money) {
      moneyValue.textContent = `$${money}`;
      buyMoney.textContent = `$${money}`;
    },
    setTimer(seconds) {
      const value = Math.max(0, Math.ceil(seconds));
      timerValue.textContent = `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
      timerValue.classList.toggle('urgent', value <= 10);
    },
    setRound(round, score) {
      roundValue.textContent = `ROUND ${round}`;
      scoreVipers.textContent = score.vipers;
      scoreJackals.textContent = score.jackals;
    },
    setBomb(status, seconds) {
      if (status === 'planted') {
        bombStatus.hidden = false;
        bombStatus.textContent = `BOMB ${Math.ceil(seconds)}s`;
        bombStatus.classList.toggle('urgent', seconds <= 10);
      } else if (status === 'held') {
        bombStatus.hidden = false;
        bombStatus.textContent = 'BOMB CARRIED';
        bombStatus.classList.remove('urgent');
      } else {
        bombStatus.hidden = true;
      }
    },
    setGrenades(smoke, flash) {
      grenadeCounts.textContent = `SMOKE ${smoke} · FLASH ${flash}`;
    },
    // Storm meter: CLEAR, then a warning, then the blow itself, bar = intensity.
    setStorm(phase, intensity) {
      if (phase === 'storm') {
        stormLabel.textContent = 'SANDSTORM';
        stormMeter.classList.add('storm');
        stormMeter.classList.remove('warning');
      } else if (phase === 'warning') {
        stormLabel.textContent = 'STORM INCOMING';
        stormMeter.classList.add('warning');
        stormMeter.classList.remove('storm');
      } else {
        stormLabel.textContent = 'CLEAR';
        stormMeter.classList.remove('storm', 'warning');
      }
      stormBar.style.width = `${Math.round(Math.max(0, Math.min(1, intensity)) * 100)}%`;
    },
    setDrone(charges) {
      droneStatus.textContent = `FALCON ×${charges}`;
      droneStatus.classList.toggle('empty', charges <= 0);
    },
    // Red diamonds over pulse-revealed enemies. points: [{ x, y }] in CSS pixels.
    showPings(points) {
      for (let i = 0; i < pingDots.length; i += 1) {
        const dot = pingDots[i];
        const point = points[i];
        if (!point) {
          dot.hidden = true;
          continue;
        }
        dot.hidden = false;
        dot.style.left = `${point.x}px`;
        dot.style.top = `${point.y}px`;
      }
    },
    setTeammates(entries) {
      // entries: [{ name, hp, alive, carrier }]
      teammates.innerHTML = entries.map((entry) => {
        const cls = entry.alive ? '' : ' dead';
        const bomb = entry.carrier ? ' 💣' : '';
        return `<div class="mate${cls}">${entry.name}${bomb} <span>${entry.alive ? Math.ceil(entry.hp) : '✕'}</span></div>`;
      }).join('');
    },
    setCrosshairSpread(pixels) {
      crosshair.style.setProperty('--gap', `${pixels}px`);
    },
    hitMarker(kill, holdMs) {
      hitmarker.classList.add('on');
      if (kill) hitmarker.classList.add('kill');
      else hitmarker.classList.remove('kill');
      window.clearTimeout(hitmarker._timer);
      hitmarker._timer = window.setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    killfeed(killer, victim, headshot) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.innerHTML = `<b>${killer}</b> ${headshot ? '◉' : '✕'} <b>${victim}</b>`;
      killfeed.prepend(line);
      while (killfeed.children.length > 5) killfeed.lastChild.remove();
      window.setTimeout(() => line.remove(), 6000);
    },
    killfeedSystem(text) {
      const line = document.createElement('div');
      line.className = 'feed-line system';
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 5) killfeed.lastChild.remove();
      window.setTimeout(() => line.remove(), 6000);
    },
    banner(title, sub) {
      bannerTitle.textContent = title;
      bannerSub.textContent = sub || '';
      banner.classList.remove('show');
      void banner.offsetWidth;
      banner.classList.add('show');
      window.clearTimeout(bannerTimer);
      bannerTimer = window.setTimeout(() => banner.classList.remove('show'), 3200);
    },
    damageFlash() {
      damageVignette.classList.add('on');
      window.setTimeout(() => damageVignette.classList.remove('on'), 180);
    },
    flashWhite(strength) {
      flashOverlay.style.opacity = String(Math.max(0, Math.min(1, strength)));
    },
    showBuy(show) {
      buyMenu.hidden = !show;
      if (show) buyMenu.querySelectorAll('[data-buy]').forEach((button) => {
        button.disabled = false;
      });
    },
    markBought(id) {
      const button = buyMenu.querySelector(`[data-buy="${id}"]`);
      if (button) button.disabled = true;
    },
    bindBuyButtons() {
      buyMenu.querySelectorAll('[data-buy]').forEach((button) => {
        button.addEventListener('click', () => {
          if (buyCallback) buyCallback(button.dataset.buy);
        });
      });
    },
  };
}
