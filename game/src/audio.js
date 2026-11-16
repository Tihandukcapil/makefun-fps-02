// Procedural sound: every effect is synthesized with WebAudio, so the game ships
// no audio files and makes no network request. All sounds are short and quiet
// enough to sit under gunfire; the context starts on the first user gesture.
// New in Storm Protocol: a looping wind bed that rises with the sandstorm, and
// the FALCON drone's launch chirp and pulse ping.
export function createAudio() {
  let context = null;
  let master = null;
  let enabled = true;
  let wind = null; // { gain } — one looping noise node, gain-ridden

  function ensure() {
    if (context) {
      if (context.state === 'suspended') context.resume().catch(() => {});
      return context;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      context = new AC();
      master = context.createGain();
      master.gain.value = 0.35;
      master.connect(context.destination);
    } catch {
      context = null;
    }
    return context;
  }

  function noiseBuffer(duration) {
    const ctx = ensure();
    if (!ctx) return null;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst({ duration = 0.12, frequency = 1200, type = 'lowpass', gain = 0.5, slideTo = null }) {
    const ctx = ensure();
    if (!ctx || !enabled) return;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(duration);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, ctx.currentTime);
    if (slideTo !== null) filter.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), ctx.currentTime + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, ctx.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    source.connect(filter);
    filter.connect(amp);
    amp.connect(master);
    source.start();
    source.stop(ctx.currentTime + duration);
  }

  function tone({ frequency = 440, duration = 0.08, type = 'sine', gain = 0.2, slideTo = null }) {
    const ctx = ensure();
    if (!ctx || !enabled) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), ctx.currentTime + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, ctx.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(amp);
    amp.connect(master);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  return {
    ensure,
    setEnabled(value) {
      enabled = value;
    },
    // Wind bed for the sandstorm: one looping filtered-noise node, created once
    // and ridden by gain so starting and stopping it never clicks or leaks.
    setWind(intensity) {
      const ctx = ensure();
      if (!ctx || !enabled) return;
      if (!wind) {
        const source = ctx.createBufferSource();
        source.buffer = noiseBuffer(2);
        source.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 420;
        filter.Q.value = 0.6;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        source.connect(filter);
        filter.connect(gain);
        gain.connect(master);
        source.start();
        wind = { gain };
      }
      const target = 0.16 * Math.max(0, Math.min(1, intensity));
      wind.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.4);
    },
    droneLaunch() {
      tone({ frequency: 700, duration: 0.09, type: 'sine', gain: 0.14, slideTo: 1400 });
      setTimeout(() => tone({ frequency: 1400, duration: 0.07, type: 'sine', gain: 0.1 }), 90);
    },
    dronePing() {
      tone({ frequency: 1560, duration: 0.12, type: 'sine', gain: 0.12 });
      setTimeout(() => tone({ frequency: 1560, duration: 0.1, type: 'sine', gain: 0.08 }), 160);
    },
    // kind: 'rifle' | 'smg' | 'sniper' | 'pistol'. distance 0..1 scales the volume.
    shot(kind, distance = 0) {
      const volume = Math.max(0.08, 0.55 - distance * 0.4);
      if (kind === 'sniper') burst({ duration: 0.28, frequency: 900, gain: volume, slideTo: 120 });
      else if (kind === 'smg') burst({ duration: 0.07, frequency: 2200, gain: volume * 0.8, slideTo: 500 });
      else if (kind === 'pistol') burst({ duration: 0.09, frequency: 1600, gain: volume * 0.85, slideTo: 300 });
      else burst({ duration: 0.11, frequency: 1400, gain: volume, slideTo: 220 });
    },
    dryFire() {
      tone({ frequency: 1800, duration: 0.03, type: 'square', gain: 0.08 });
    },
    hit(head) {
      tone({ frequency: head ? 1320 : 880, duration: 0.05, type: 'sine', gain: 0.16 });
    },
    reload() {
      tone({ frequency: 500, duration: 0.04, type: 'square', gain: 0.07 });
      setTimeout(() => tone({ frequency: 700, duration: 0.04, type: 'square', gain: 0.07 }), 350);
    },
    footstep() {
      burst({ duration: 0.05, frequency: 400, gain: 0.05, slideTo: 150 });
    },
    plantBeep() {
      tone({ frequency: 990, duration: 0.07, gain: 0.14 });
    },
    defuseBeep() {
      tone({ frequency: 660, duration: 0.07, gain: 0.14 });
    },
    bombBeep(fast) {
      tone({ frequency: fast ? 1180 : 880, duration: 0.06, gain: 0.12 });
    },
    explosion() {
      burst({ duration: 0.9, frequency: 300, gain: 0.7, slideTo: 50 });
      tone({ frequency: 90, duration: 0.7, gain: 0.4, slideTo: 30 });
    },
    roundWin() {
      tone({ frequency: 523, duration: 0.14, gain: 0.16 });
      setTimeout(() => tone({ frequency: 659, duration: 0.14, gain: 0.16 }), 140);
      setTimeout(() => tone({ frequency: 784, duration: 0.22, gain: 0.16 }), 280);
    },
    roundLose() {
      tone({ frequency: 392, duration: 0.16, gain: 0.15 });
      setTimeout(() => tone({ frequency: 311, duration: 0.24, gain: 0.15 }), 160);
    },
    buy() {
      tone({ frequency: 1046, duration: 0.06, gain: 0.12 });
    },
    denied() {
      tone({ frequency: 220, duration: 0.09, type: 'square', gain: 0.1 });
    },
  };
}
