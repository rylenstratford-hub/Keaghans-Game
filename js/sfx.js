/**
 * Game / menu SFX — synthesized with Web Audio (no copyrighted samples).
 */
window.KeaghanSfx = (() => {
  let ctx = null;

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function masterGain() {
    const volume = Number(window.KeaghanSettings?.getVolume?.() ?? 70);
    return Math.max(0, Math.min(1, volume / 100));
  }

  function makeOut(audio, scale = 0.55) {
    const vol = masterGain() * scale;
    if (vol <= 0) return null;
    const out = audio.createGain();
    out.gain.value = vol;
    out.connect(audio.destination);
    return out;
  }

  function noiseBuffer(audio, seconds, { crackle = false } = {}) {
    const len = Math.max(1, Math.floor(audio.sampleRate * seconds));
    const buffer = audio.createBuffer(1, len, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      let n = Math.random() * 2 - 1;
      if (crackle && Math.random() < 0.04) n *= 2.2;
      // Soft envelope bias toward the start for most bursts
      data[i] = n * (1 - t * 0.85);
    }
    return buffer;
  }

  function playNoise(audio, out, { seconds, freq, q = 1, gain = 0.3, type = "bandpass", delay = 0, crackle = false }) {
    const now = audio.currentTime + delay;
    const src = audio.createBufferSource();
    src.buffer = noiseBuffer(audio, seconds, { crackle });
    const filter = audio.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = audio.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    src.connect(filter);
    filter.connect(g);
    g.connect(out);
    src.start(now);
    src.stop(now + seconds + 0.02);
  }

  /** Soft mechanical UI confirm — low body + muted contact click. */
  function playMenuClick() {
    const audio = ensureCtx();
    if (!audio) return;
    const now = audio.currentTime;
    const out = makeOut(audio, 0.55);
    if (!out) return;

    const thud = audio.createOscillator();
    const thudGain = audio.createGain();
    const thudFilter = audio.createBiquadFilter();
    thud.type = "sine";
    thud.frequency.setValueAtTime(92, now);
    thud.frequency.exponentialRampToValueAtTime(48, now + 0.09);
    thudFilter.type = "lowpass";
    thudFilter.frequency.value = 280;
    thudGain.gain.setValueAtTime(0.0001, now);
    thudGain.gain.exponentialRampToValueAtTime(0.9, now + 0.008);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    thud.connect(thudFilter);
    thudFilter.connect(thudGain);
    thudGain.connect(out);
    thud.start(now);
    thud.stop(now + 0.12);

    const tick = audio.createOscillator();
    const tickGain = audio.createGain();
    const tickFilter = audio.createBiquadFilter();
    tick.type = "triangle";
    tick.frequency.setValueAtTime(620, now);
    tick.frequency.exponentialRampToValueAtTime(240, now + 0.05);
    tickFilter.type = "bandpass";
    tickFilter.frequency.value = 900;
    tickFilter.Q.value = 1.4;
    tickGain.gain.setValueAtTime(0.0001, now);
    tickGain.gain.exponentialRampToValueAtTime(0.35, now + 0.004);
    tickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    tick.connect(tickFilter);
    tickFilter.connect(tickGain);
    tickGain.connect(out);
    tick.start(now);
    tick.stop(now + 0.08);

    playNoise(audio, out, {
      seconds: 0.03,
      freq: 1800,
      q: 0.8,
      gain: 0.22,
    });
  }

  /** Leafy rustle + soft chop while mining a tree. */
  function playTreeRustle() {
    const audio = ensureCtx();
    if (!audio) return;
    const now = audio.currentTime;
    const out = makeOut(audio, 0.62);
    if (!out) return;

    // Soft wood tap
    const tap = audio.createOscillator();
    const tapGain = audio.createGain();
    tap.type = "triangle";
    tap.frequency.setValueAtTime(180 + Math.random() * 40, now);
    tap.frequency.exponentialRampToValueAtTime(90, now + 0.06);
    tapGain.gain.setValueAtTime(0.0001, now);
    tapGain.gain.exponentialRampToValueAtTime(0.28, now + 0.005);
    tapGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    tap.connect(tapGain);
    tapGain.connect(out);
    tap.start(now);
    tap.stop(now + 0.09);

    // High airy leaf rustle
    playNoise(audio, out, {
      seconds: 0.16,
      freq: 3200 + Math.random() * 800,
      q: 0.55,
      gain: 0.38,
      type: "bandpass",
    });
    // Mid foliage swish
    playNoise(audio, out, {
      seconds: 0.2,
      freq: 1400 + Math.random() * 400,
      q: 0.7,
      gain: 0.22,
      type: "bandpass",
      delay: 0.01,
    });
  }

  /** Heavier crash when a tree is fully chopped down. */
  function playTreeCrash() {
    const audio = ensureCtx();
    if (!audio) return;
    const now = audio.currentTime;
    const out = makeOut(audio, 0.72);
    if (!out) return;

    // Low woody impact / trunk fall
    const body = audio.createOscillator();
    const bodyGain = audio.createGain();
    const bodyFilter = audio.createBiquadFilter();
    body.type = "sine";
    body.frequency.setValueAtTime(110, now);
    body.frequency.exponentialRampToValueAtTime(38, now + 0.28);
    bodyFilter.type = "lowpass";
    bodyFilter.frequency.value = 220;
    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.exponentialRampToValueAtTime(1.1, now + 0.01);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    body.connect(bodyFilter);
    bodyFilter.connect(bodyGain);
    bodyGain.connect(out);
    body.start(now);
    body.stop(now + 0.34);

    // Mid wood crack
    const crack = audio.createOscillator();
    const crackGain = audio.createGain();
    crack.type = "sawtooth";
    crack.frequency.setValueAtTime(220, now);
    crack.frequency.exponentialRampToValueAtTime(70, now + 0.14);
    crackGain.gain.setValueAtTime(0.0001, now);
    crackGain.gain.exponentialRampToValueAtTime(0.2, now + 0.006);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    const crackFilter = audio.createBiquadFilter();
    crackFilter.type = "lowpass";
    crackFilter.frequency.value = 900;
    crack.connect(crackFilter);
    crackFilter.connect(crackGain);
    crackGain.connect(out);
    crack.start(now);
    crack.stop(now + 0.18);

    // Branch snap / debris
    playNoise(audio, out, {
      seconds: 0.18,
      freq: 900,
      q: 0.9,
      gain: 0.45,
      type: "bandpass",
      crackle: true,
    });
    // Leafy settle after the fall
    playNoise(audio, out, {
      seconds: 0.35,
      freq: 2400,
      q: 0.5,
      gain: 0.28,
      type: "bandpass",
      delay: 0.05,
    });
    playNoise(audio, out, {
      seconds: 0.25,
      freq: 180,
      q: 0.6,
      gain: 0.35,
      type: "lowpass",
      delay: 0.02,
    });
  }

  /** Sharp stone crack while mining rock / ore. */
  function playRockCrack() {
    const audio = ensureCtx();
    if (!audio) return;
    const now = audio.currentTime;
    const out = makeOut(audio, 0.64);
    if (!out) return;

    const pitch = 520 + Math.random() * 180;

    // Hard mineral crack
    const crack = audio.createOscillator();
    const crackGain = audio.createGain();
    const crackFilter = audio.createBiquadFilter();
    crack.type = "square";
    crack.frequency.setValueAtTime(pitch, now);
    crack.frequency.exponentialRampToValueAtTime(pitch * 0.35, now + 0.05);
    crackFilter.type = "bandpass";
    crackFilter.frequency.value = pitch * 1.1;
    crackFilter.Q.value = 2.2;
    crackGain.gain.setValueAtTime(0.0001, now);
    crackGain.gain.exponentialRampToValueAtTime(0.32, now + 0.003);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    crack.connect(crackFilter);
    crackFilter.connect(crackGain);
    crackGain.connect(out);
    crack.start(now);
    crack.stop(now + 0.08);

    // Brief stone chip noise
    playNoise(audio, out, {
      seconds: 0.07,
      freq: 1800 + Math.random() * 600,
      q: 1.4,
      gain: 0.34,
      type: "bandpass",
      crackle: true,
    });
  }

  /** Louder crack, then little rocks tumbling down. */
  function playRockBreak() {
    const audio = ensureCtx();
    if (!audio) return;
    const now = audio.currentTime;
    const out = makeOut(audio, 0.74);
    if (!out) return;

    // Initial break crack
    const crack = audio.createOscillator();
    const crackGain = audio.createGain();
    const crackFilter = audio.createBiquadFilter();
    crack.type = "sawtooth";
    crack.frequency.setValueAtTime(280, now);
    crack.frequency.exponentialRampToValueAtTime(70, now + 0.12);
    crackFilter.type = "bandpass";
    crackFilter.frequency.value = 700;
    crackFilter.Q.value = 1.2;
    crackGain.gain.setValueAtTime(0.0001, now);
    crackGain.gain.exponentialRampToValueAtTime(0.45, now + 0.005);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    crack.connect(crackFilter);
    crackFilter.connect(crackGain);
    crackGain.connect(out);
    crack.start(now);
    crack.stop(now + 0.15);

    // Impact body
    const body = audio.createOscillator();
    const bodyGain = audio.createGain();
    body.type = "sine";
    body.frequency.setValueAtTime(95, now);
    body.frequency.exponentialRampToValueAtTime(40, now + 0.18);
    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.7, now + 0.008);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    body.connect(bodyGain);
    bodyGain.connect(out);
    body.start(now);
    body.stop(now + 0.22);

    playNoise(audio, out, {
      seconds: 0.12,
      freq: 1400,
      q: 1.1,
      gain: 0.5,
      type: "bandpass",
      crackle: true,
    });

    // Falling little rocks / gravel cascade
    for (let i = 0; i < 5; i++) {
      const delay = 0.06 + i * 0.045 + Math.random() * 0.02;
      playNoise(audio, out, {
        seconds: 0.1 + Math.random() * 0.06,
        freq: 900 - i * 120 + Math.random() * 180,
        q: 1.3,
        gain: 0.22 - i * 0.03,
        type: "bandpass",
        delay,
        crackle: true,
      });

      const pebble = audio.createOscillator();
      const pebbleGain = audio.createGain();
      const t = now + delay;
      pebble.type = "triangle";
      pebble.frequency.setValueAtTime(340 - i * 40 + Math.random() * 50, t);
      pebble.frequency.exponentialRampToValueAtTime(80 + Math.random() * 30, t + 0.08);
      pebbleGain.gain.setValueAtTime(0.0001, t);
      pebbleGain.gain.exponentialRampToValueAtTime(0.12, t + 0.004);
      pebbleGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      pebble.connect(pebbleGain);
      pebbleGain.connect(out);
      pebble.start(t);
      pebble.stop(t + 0.1);
    }
  }

  /** Detuned ore cracks layered on top of a stone break (coal / iron / copper). */
  function playOreDetune() {
    const audio = ensureCtx();
    if (!audio) return;
    const now = audio.currentTime;
    const out = makeOut(audio, 0.58);
    if (!out) return;

    const intervals = [0.02, 0.055, 0.1, 0.15];
    const ratios = [0.87, 1.07, 0.78, 1.18];

    for (let i = 0; i < intervals.length; i++) {
      const t = now + intervals[i];
      const base = 480 * ratios[i] + Math.random() * 40;

      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const filter = audio.createBiquadFilter();
      osc.type = i % 2 === 0 ? "square" : "sawtooth";
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.exponentialRampToValueAtTime(base * 0.4, t + 0.08);
      // Slight detune wobble for that “ore” character
      osc.detune.setValueAtTime(-28 + i * 14, t);
      osc.detune.linearRampToValueAtTime(22 - i * 10, t + 0.07);
      filter.type = "bandpass";
      filter.frequency.value = base * 0.95;
      filter.Q.value = 2.8;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.2, t + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(out);
      osc.start(t);
      osc.stop(t + 0.1);

      playNoise(audio, out, {
        seconds: 0.08,
        freq: base * 1.6,
        q: 1.8,
        gain: 0.18,
        type: "bandpass",
        delay: intervals[i],
        crackle: true,
      });
    }
  }

  function playRockBreakWithOre() {
    playRockBreak();
    // Slight delay so the ore ring sits after the main crack
    const audio = ensureCtx();
    if (!audio) return;
    window.setTimeout(() => playOreDetune(), 40);
  }

  /** Soft pop when picking food (carrot / apple). */
  function playFoodPop() {
    const audio = ensureCtx();
    if (!audio) return;
    const now = audio.currentTime;
    const out = makeOut(audio, 0.58);
    if (!out) return;

    const pop = audio.createOscillator();
    const popGain = audio.createGain();
    const popFilter = audio.createBiquadFilter();
    const base = 520 + Math.random() * 80;
    pop.type = "sine";
    pop.frequency.setValueAtTime(base, now);
    pop.frequency.exponentialRampToValueAtTime(base * 0.45, now + 0.09);
    popFilter.type = "lowpass";
    popFilter.frequency.value = 2200;
    popGain.gain.setValueAtTime(0.0001, now);
    popGain.gain.exponentialRampToValueAtTime(0.85, now + 0.006);
    popGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    pop.connect(popFilter);
    popFilter.connect(popGain);
    popGain.connect(out);
    pop.start(now);
    pop.stop(now + 0.13);

    const click = audio.createOscillator();
    const clickGain = audio.createGain();
    click.type = "triangle";
    click.frequency.setValueAtTime(980 + Math.random() * 120, now);
    click.frequency.exponentialRampToValueAtTime(420, now + 0.05);
    clickGain.gain.setValueAtTime(0.0001, now);
    clickGain.gain.exponentialRampToValueAtTime(0.28, now + 0.004);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    click.connect(clickGain);
    clickGain.connect(out);
    click.start(now);
    click.stop(now + 0.07);

    playNoise(audio, out, {
      seconds: 0.035,
      freq: 2400,
      q: 0.9,
      gain: 0.18,
      type: "bandpass",
    });
  }

  function playHarvest(nodeType, destroyed) {
    if (nodeType === "tree") {
      if (destroyed) playTreeCrash();
      else playTreeRustle();
      return;
    }

    if (nodeType === "rock") {
      if (destroyed) playRockBreak();
      else playRockCrack();
      return;
    }

    if (nodeType === "carrot") {
      playFoodPop();
      return;
    }

    // Coal, iron, copper: stone cracks while mining; break + detuned ore on destroy
    if (nodeType === "coal" || nodeType === "iron" || nodeType === "copper") {
      if (destroyed) playRockBreakWithOre();
      else playRockCrack();
    }
  }

  /**
   * In-game music — melodic factory / exploration theme (original Web Audio).
   * Mid/high register melody + soft chords; avoids low rumble beds.
   */
  const MUSIC_LEVEL = 0.22;
  let music = {
    playing: false,
    paused: false,
    bus: null,
    oscillators: [],
    nodes: [],
    timer: 0,
    beat: 0,
  };

  // Soft drums / piano fade in after you keep playing (bars ≈ 3.4s each).
  const DRUMS_HATS_AFTER = 8; // ~27s
  const DRUMS_KICK_AFTER = 16; // ~54s
  const DRUMS_FULL_AFTER = 24; // ~82s
  const PIANO_AFTER = 30; // ~100s
  const CYMBAL_AFTER = 35; // ~120s

  const MUSIC_ROOT = 220;
  const MUSIC_SCALE = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19, 20, 22, 24];

  function musicTargetGain() {
    return Math.max(0.0001, masterGain() * MUSIC_LEVEL);
  }

  function musicFreq(degree, octave = 0) {
    const idx = ((degree % MUSIC_SCALE.length) + MUSIC_SCALE.length) % MUSIC_SCALE.length;
    return MUSIC_ROOT * Math.pow(2, (MUSIC_SCALE[idx] + octave * 12) / 12);
  }

  function stopOscList(list) {
    for (const osc of list) {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
      try {
        osc.disconnect();
      } catch {
        /* ignore */
      }
    }
    list.length = 0;
  }

  function clearMusicTimer() {
    if (music.timer) {
      window.clearInterval(music.timer);
      music.timer = 0;
    }
  }

  function refreshVolumes() {
    if (!ctx) return;
    const now = ctx.currentTime;
    if (music.bus) {
      const target = music.paused ? 0.0001 : musicTargetGain();
      music.bus.gain.cancelScheduledValues(now);
      music.bus.gain.setTargetAtTime(target, now, 0.08);
    }
    refreshWeatherVolumes();
  }

  /* --- Weather ambience (rain loop + thunder cracks) --- */
  const RAIN_LEVEL = 0.2;
  const THUNDER_LEVEL = 0.85;
  /** Quieter + low-passed while inside the base. */
  const WEATHER_MUFFLE_GAIN = 0.28;
  const WEATHER_MUFFLE_CUTOFF = 780;
  const WEATHER_OPEN_CUTOFF = 18000;
  // Matches .sky__lightning animation duration in styles.css
  const THUNDER_CYCLE_MS = 7000;

  let weatherFx = {
    kind: null, // null | "rain" | "thunder"
    paused: false,
    muffled: false,
    bus: null,
    muffle: null,
    sources: [],
    nodes: [],
    thunderTimer: 0,
    thunderTimeouts: [],
  };

  function rainTargetGain() {
    if (weatherFx.paused || music.paused) return 0.0001;
    const muff = weatherFx.muffled ? WEATHER_MUFFLE_GAIN : 1;
    return Math.max(0.0001, masterGain() * RAIN_LEVEL * muff);
  }

  function applyWeatherMuffleCutoff() {
    if (!weatherFx.muffle) return;
    const freq = weatherFx.muffled ? WEATHER_MUFFLE_CUTOFF : WEATHER_OPEN_CUTOFF;
    const now = ctx?.currentTime ?? 0;
    try {
      weatherFx.muffle.frequency.cancelScheduledValues(now);
      weatherFx.muffle.frequency.setTargetAtTime(freq, now, 0.18);
    } catch {
      weatherFx.muffle.frequency.value = freq;
    }
  }

  function loopNoiseBuffer(audio, seconds) {
    const len = Math.max(1, Math.floor(audio.sampleRate * seconds));
    const buffer = audio.createBuffer(1, len, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  function refreshWeatherVolumes() {
    if (!ctx || !weatherFx.bus) return;
    const now = ctx.currentTime;
    weatherFx.bus.gain.cancelScheduledValues(now);
    weatherFx.bus.gain.setTargetAtTime(rainTargetGain(), now, 0.25);
  }

  function clearThunderSchedule() {
    if (weatherFx.thunderTimer) {
      window.clearInterval(weatherFx.thunderTimer);
      weatherFx.thunderTimer = 0;
    }
    for (const id of weatherFx.thunderTimeouts) window.clearTimeout(id);
    weatherFx.thunderTimeouts = [];
  }

  function stopRainLoop() {
    clearThunderSchedule();
    const bus = weatherFx.bus;
    const muffle = weatherFx.muffle;
    const sources = weatherFx.sources.slice();
    const nodes = weatherFx.nodes.slice();
    weatherFx.bus = null;
    weatherFx.muffle = null;
    weatherFx.sources = [];
    weatherFx.nodes = [];
    weatherFx.kind = null;

    if (ctx && bus) {
      try {
        bus.gain.cancelScheduledValues(ctx.currentTime);
        bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.2);
      } catch {
        /* ignore */
      }
    }

    window.setTimeout(() => {
      for (const src of sources) {
        try {
          src.stop();
        } catch {
          /* ignore */
        }
        try {
          src.disconnect();
        } catch {
          /* ignore */
        }
      }
      for (const node of nodes) {
        try {
          node.disconnect();
        } catch {
          /* ignore */
        }
      }
      try {
        bus?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        muffle?.disconnect();
      } catch {
        /* ignore */
      }
    }, 500);
  }

  function startRainLoop() {
    const audio = ensureCtx();
    if (!audio) return;
    if (weatherFx.bus) {
      applyWeatherMuffleCutoff();
      refreshWeatherVolumes();
      return;
    }

    weatherFx.bus = audio.createGain();
    weatherFx.bus.gain.value = 0.0001;
    weatherFx.muffle = audio.createBiquadFilter();
    weatherFx.muffle.type = "lowpass";
    weatherFx.muffle.Q.value = 0.65;
    weatherFx.muffle.frequency.value = weatherFx.muffled
      ? WEATHER_MUFFLE_CUTOFF
      : WEATHER_OPEN_CUTOFF;
    weatherFx.bus.connect(weatherFx.muffle);
    weatherFx.muffle.connect(audio.destination);

    // Soft high drizzle
    const drizzle = audio.createBufferSource();
    drizzle.buffer = loopNoiseBuffer(audio, 2.5);
    drizzle.loop = true;
    const drizzleFilter = audio.createBiquadFilter();
    drizzleFilter.type = "bandpass";
    drizzleFilter.frequency.value = 1800;
    drizzleFilter.Q.value = 0.55;
    const drizzleGain = audio.createGain();
    drizzleGain.gain.value = 0.55;
    drizzle.connect(drizzleFilter);
    drizzleFilter.connect(drizzleGain);
    drizzleGain.connect(weatherFx.bus);
    drizzle.start();
    weatherFx.sources.push(drizzle);
    weatherFx.nodes.push(drizzleFilter, drizzleGain);

    // Lower wet bed
    const bed = audio.createBufferSource();
    bed.buffer = loopNoiseBuffer(audio, 3.2);
    bed.loop = true;
    const bedFilter = audio.createBiquadFilter();
    bedFilter.type = "lowpass";
    bedFilter.frequency.value = 700;
    bedFilter.Q.value = 0.4;
    const bedGain = audio.createGain();
    bedGain.gain.value = 0.4;
    bed.connect(bedFilter);
    bedFilter.connect(bedGain);
    bedGain.connect(weatherFx.bus);
    bed.start();
    weatherFx.sources.push(bed);
    weatherFx.nodes.push(bedFilter, bedGain);

    weatherFx.bus.gain.linearRampToValueAtTime(rainTargetGain(), audio.currentTime + 1.1);
  }

  /** Sharp crack + low rumble — fires with lightning flashes. */
  function playThunderCrack() {
    const audio = ensureCtx();
    if (!audio) return;
    if (weatherFx.paused || music.paused) return;
    const scale = weatherFx.muffled ? THUNDER_LEVEL * WEATHER_MUFFLE_GAIN : THUNDER_LEVEL;
    const vol = masterGain() * scale;
    if (vol <= 0) return;
    const out = audio.createGain();
    out.gain.value = vol;
    if (weatherFx.muffled) {
      const lp = audio.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 520;
      lp.Q.value = 0.6;
      out.connect(lp);
      lp.connect(audio.destination);
    } else {
      out.connect(audio.destination);
    }
    const now = audio.currentTime;

    // Initial crack
    playNoise(audio, out, {
      seconds: 0.18,
      freq: 2200,
      q: 0.7,
      gain: 0.7,
      type: "bandpass",
      crackle: true,
    });
    playNoise(audio, out, {
      seconds: 0.35,
      freq: 420,
      q: 0.5,
      gain: 0.55,
      type: "lowpass",
      crackle: true,
      delay: 0.02,
    });

    // Rolling boom
    const boom = audio.createOscillator();
    const boomGain = audio.createGain();
    const boomFilter = audio.createBiquadFilter();
    boom.type = "sine";
    boom.frequency.setValueAtTime(78, now);
    boom.frequency.exponentialRampToValueAtTime(32, now + 1.4);
    boomFilter.type = "lowpass";
    boomFilter.frequency.value = 180;
    boomGain.gain.setValueAtTime(0.0001, now);
    boomGain.gain.exponentialRampToValueAtTime(0.95, now + 0.03);
    boomGain.gain.exponentialRampToValueAtTime(0.25, now + 0.35);
    boomGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
    boom.connect(boomFilter);
    boomFilter.connect(boomGain);
    boomGain.connect(out);
    boom.start(now);
    boom.stop(now + 1.85);

    // Distant after-rumble
    playNoise(audio, out, {
      seconds: 1.1,
      freq: 140,
      q: 0.35,
      gain: 0.28,
      type: "lowpass",
      delay: 0.12,
    });
  }

  function scheduleThunderStrike() {
    // Align with sky-lightning-flash: first flash ~4% of 7s, then a little lag.
    const delay = 280 + Math.random() * 420;
    const id = window.setTimeout(() => {
      playThunderCrack();
      // Occasional double-strike like the visual double flash
      if (Math.random() < 0.45) {
        const id2 = window.setTimeout(() => playThunderCrack(), 120 + Math.random() * 180);
        weatherFx.thunderTimeouts.push(id2);
      }
    }, delay);
    weatherFx.thunderTimeouts.push(id);
  }

  function startThunderSchedule() {
    clearThunderSchedule();
    scheduleThunderStrike();
    weatherFx.thunderTimer = window.setInterval(scheduleThunderStrike, THUNDER_CYCLE_MS);
  }

  /**
   * Sync ambience to world weather.
   * @param {null|"rain"|"thunder"|""} kind
   */
  function setWeather(kind) {
    const next = kind === "rain" || kind === "thunder" ? kind : null;
    if (next === weatherFx.kind) {
      if (next) refreshWeatherVolumes();
      return;
    }

    const wantRain = Boolean(next);
    if (wantRain) startRainLoop();
    else stopRainLoop();

    if (next === "thunder") startThunderSchedule();
    else clearThunderSchedule();

    weatherFx.kind = next;
  }

  function setWeatherPaused(paused) {
    weatherFx.paused = Boolean(paused);
    if (weatherFx.paused) clearThunderSchedule();
    else if (weatherFx.kind === "thunder") startThunderSchedule();
    refreshWeatherVolumes();
  }

  /** Soften rain/thunder while the player is indoors. */
  function setWeatherMuffled(muffled) {
    const next = Boolean(muffled);
    if (weatherFx.muffled === next) return;
    weatherFx.muffled = next;
    applyWeatherMuffleCutoff();
    refreshWeatherVolumes();
  }

  function playTone(audio, bus, { freq, when, dur, peak, type = "triangle", filterFreq = 2400 }) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const filter = audio.createBiquadFilter();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    filter.type = "lowpass";
    filter.frequency.value = filterFreq;
    filter.Q.value = 0.8;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), when + Math.min(0.08, dur * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    osc.start(when);
    osc.stop(when + dur + 0.03);
  }

  function playChord(audio, bus, degrees, when, dur, peak = 0.04) {
    for (const deg of degrees) {
      playTone(audio, bus, {
        freq: musicFreq(deg, 0),
        when,
        dur,
        peak: peak * 0.7,
        type: "sine",
        filterFreq: 1600,
      });
      playTone(audio, bus, {
        freq: musicFreq(deg, 1),
        when: when + 0.01,
        dur: dur * 0.95,
        peak: peak * 0.35,
        type: "triangle",
        filterFreq: 2200,
      });
    }
  }

  function playKick(audio, bus, when, peak = 0.14) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const filter = audio.createBiquadFilter();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, when);
    osc.frequency.exponentialRampToValueAtTime(58, when + 0.14);
    filter.type = "lowpass";
    filter.frequency.value = 280;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.2);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    osc.start(when);
    osc.stop(when + 0.22);
  }

  function playSnare(audio, bus, when, peak = 0.1) {
    const delay = Math.max(0, when - audio.currentTime);
    playNoise(audio, bus, {
      seconds: 0.09,
      freq: 1600,
      q: 1.1,
      gain: peak,
      type: "bandpass",
      delay,
      crackle: true,
    });
    playTone(audio, bus, {
      freq: 220,
      when,
      dur: 0.1,
      peak: peak * 0.45,
      type: "triangle",
      filterFreq: 900,
    });
  }

  function playHat(audio, bus, when, peak = 0.045, open = false) {
    const delay = Math.max(0, when - audio.currentTime);
    playNoise(audio, bus, {
      seconds: open ? 0.14 : 0.045,
      freq: open ? 7000 : 9000,
      q: open ? 0.6 : 1.4,
      gain: peak,
      type: "highpass",
      delay,
    });
  }

  /** Soft piano-ish key: quick hammer attack + longer harmonic decay. */
  function playPianoNote(audio, bus, freq, when, dur = 1.4, peak = 0.08) {
    const partials = [
      { mul: 1, gain: 1, type: "sine" },
      { mul: 2, gain: 0.45, type: "triangle" },
      { mul: 3, gain: 0.18, type: "sine" },
      { mul: 4, gain: 0.08, type: "sine" },
    ];
    for (const partial of partials) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const filter = audio.createBiquadFilter();
      osc.type = partial.type;
      osc.frequency.setValueAtTime(freq * partial.mul, when);
      // Tiny hammer inharmonicity
      osc.detune.setValueAtTime(partial.mul > 1 ? partial.mul * 1.5 : 0, when);
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(4200, when);
      filter.frequency.exponentialRampToValueAtTime(900, when + dur);
      const level = peak * partial.gain;
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.001, level), when + 0.012);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.001, level * 0.35), when + 0.28);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(bus);
      osc.start(when);
      osc.stop(when + dur + 0.05);
    }
  }

  function schedulePiano(audio, bus, barStart, totalBars, bar) {
    if (totalBars < PIANO_AFTER) return;

    const phrases = [
      [0, 2, 4, 7, 4, 2, 0, 2],
      [4, 5, 7, 9, 7, 5, 4, 0],
      [2, 4, 5, 7, 5, 4, 2, 4],
      [7, 5, 4, 2, 0, 2, 4, 5],
      [0, 4, 7, 9, 7, 4, 2, 0],
      [5, 4, 2, 4, 5, 7, 5, 4],
      [4, 2, 0, 2, 4, 5, 7, 9],
      [2, 0, 2, 4, 5, 4, 2, 0],
    ];
    const phrase = phrases[bar % phrases.length];

    // Left-hand soft octaves on the downbeats
    const bassDeg = [0, 0, 3, 3, 4, 4, 0, 7][bar % 8];
    playPianoNote(audio, bus, musicFreq(bassDeg, 0), barStart, 2.2, 0.055);
    playPianoNote(audio, bus, musicFreq(bassDeg, 1), barStart + 0.02, 2.0, 0.03);

    // Right-hand melody
    phrase.forEach((deg, i) => {
      const t = barStart + 0.18 + i * 0.4;
      playPianoNote(audio, bus, musicFreq(deg, 2), t, 0.95, 0.085);
    });
  }

  /** Bright sustained cymbal crash (noise wash). */
  function playCymbalCrash(audio, bus, when, peak = 0.12) {
    const delay = Math.max(0, when - audio.currentTime);
    // Main shimmer wash
    playNoise(audio, bus, {
      seconds: 1.8,
      freq: 6500,
      q: 0.35,
      gain: peak,
      type: "highpass",
      delay,
      crackle: true,
    });
    // Mid metallic body
    playNoise(audio, bus, {
      seconds: 1.2,
      freq: 2800,
      q: 0.55,
      gain: peak * 0.55,
      type: "bandpass",
      delay: delay + 0.01,
      crackle: true,
    });
    // Soft low sizzle bed
    playNoise(audio, bus, {
      seconds: 2.2,
      freq: 4200,
      q: 0.4,
      gain: peak * 0.35,
      type: "bandpass",
      delay: delay + 0.03,
    });
  }

  function scheduleCymbals(audio, bus, barStart, totalBars, bar) {
    if (totalBars < CYMBAL_AFTER) return;

    // Crash on the downbeat of every other bar; bigger hit every 4 bars
    if (bar % 2 === 0) {
      const big = bar % 4 === 0;
      playCymbalCrash(audio, bus, barStart, big ? 0.14 : 0.09);
    }
    // Occasional splash on the “and” of beat 3 once the kit is fully rolling
    if (bar % 4 === 3) {
      playCymbalCrash(audio, bus, barStart + 0.425 * 5, 0.07);
    }
  }

  /** Drums layer in the longer you stay in-game. */
  function scheduleDrums(audio, bus, barStart, totalBars) {
    if (totalBars < DRUMS_HATS_AFTER) return;

    const step = 0.425; // 8th notes inside the ~3.4s bar
    const hatPeak = totalBars >= DRUMS_FULL_AFTER ? 0.055 : 0.035;

    // Closed hats
    for (let i = 0; i < 8; i++) {
      const open = totalBars >= DRUMS_FULL_AFTER && i === 7;
      playHat(audio, bus, barStart + i * step, open ? hatPeak * 1.15 : hatPeak, open);
    }

    if (totalBars < DRUMS_KICK_AFTER) return;

    // Kick on beats 1 & 3 (and later also the “and” of 2)
    playKick(audio, bus, barStart, 0.15);
    playKick(audio, bus, barStart + step * 4, 0.13);
    if (totalBars >= DRUMS_FULL_AFTER) {
      playKick(audio, bus, barStart + step * 6, 0.09);
    }

    if (totalBars < DRUMS_FULL_AFTER) return;

    // Snare on 2 & 4
    playSnare(audio, bus, barStart + step * 2, 0.11);
    playSnare(audio, bus, barStart + step * 6, 0.1);
  }

  /** One musical bar: chord + arpeggio + lead motif (+ drums after you continue). */
  function scheduleMusicBar() {
    if (!music.playing || music.paused || !ctx || !music.bus) return;
    const audio = ctx;
    const now = audio.currentTime + 0.04;
    const totalBars = music.beat;
    const bar = music.beat % 8;
    music.beat += 1;

    const chords = [
      [0, 2, 4],
      [0, 2, 4],
      [3, 5, 7],
      [3, 5, 7],
      [4, 6, 8],
      [4, 6, 8],
      [0, 2, 5],
      [7, 4, 2],
    ];
    const chord = chords[bar];
    playChord(audio, music.bus, chord, now, 3.4, 0.055);

    const arp = [chord[0], chord[1], chord[2], chord[1] + 7, chord[2], chord[0] + 7];
    arp.forEach((deg, i) => {
      playTone(audio, music.bus, {
        freq: musicFreq(deg, 1),
        when: now + 0.15 + i * 0.42,
        dur: 0.55,
        peak: 0.07,
        type: "triangle",
        filterFreq: 3200,
      });
    });

    const leads = [
      [4, 5, 7, 5, 4, 2, 0, 2],
      [7, 5, 4, 5, 7, 9, 7, 5],
      [5, 4, 2, 4, 5, 7, 8, 7],
      [2, 4, 5, 7, 5, 4, 2, 0],
      [7, 8, 7, 5, 4, 5, 2, 4],
      [4, 2, 0, 2, 4, 5, 7, 4],
      [5, 7, 9, 7, 5, 4, 2, 0],
      [0, 2, 4, 5, 4, 2, 4, 0],
    ];
    leads[bar].forEach((deg, i) => {
      const t = now + 0.2 + i * 0.38;
      playTone(audio, music.bus, {
        freq: musicFreq(deg, 2),
        when: t,
        dur: 0.5,
        peak: 0.09,
        type: "sine",
        filterFreq: 3800,
      });
      playTone(audio, music.bus, {
        freq: musicFreq(deg, 3),
        when: t + 0.02,
        dur: 0.28,
        peak: 0.03,
        type: "triangle",
        filterFreq: 5000,
      });
    });

    // Soft pulse only before the drum kit arrives
    if (totalBars < DRUMS_HATS_AFTER) {
      for (let i = 0; i < 4; i++) {
        playTone(audio, music.bus, {
          freq: 330,
          when: now + i * 0.85,
          dur: 0.12,
          peak: 0.025,
          type: "sine",
          filterFreq: 700,
        });
      }
    }

    scheduleDrums(audio, music.bus, now, totalBars);
    schedulePiano(audio, music.bus, now, totalBars, bar);
    scheduleCymbals(audio, music.bus, now, totalBars, bar);
  }

  function startMusic() {
    const audio = ensureCtx();
    if (!audio) return;
    if (music.playing) {
      music.paused = false;
      refreshVolumes();
      return;
    }

    music.playing = true;
    music.paused = false;
    music.beat = 0;
    music.bus = audio.createGain();
    music.bus.gain.value = 0.0001;
    music.bus.connect(audio.destination);
    music.bus.gain.linearRampToValueAtTime(musicTargetGain(), audio.currentTime + 1.2);

    const air = audio.createOscillator();
    const airGain = audio.createGain();
    const airFilter = audio.createBiquadFilter();
    air.type = "sine";
    air.frequency.value = 880;
    airFilter.type = "bandpass";
    airFilter.frequency.value = 2400;
    airFilter.Q.value = 0.5;
    airGain.gain.value = 0.015;
    air.connect(airFilter);
    airFilter.connect(airGain);
    airGain.connect(music.bus);
    air.start();
    music.oscillators.push(air);
    music.nodes.push(airGain, airFilter);

    scheduleMusicBar();
    clearMusicTimer();
    music.timer = window.setInterval(() => {
      if (!music.playing || music.paused) return;
      scheduleMusicBar();
    }, 3400);
  }

  function pauseMusic() {
    if (!music.playing) return;
    music.paused = true;
    setWeatherPaused(true);
    refreshVolumes();
  }

  function resumeMusic() {
    if (!music.playing) {
      startMusic();
      setWeatherPaused(false);
      return;
    }
    music.paused = false;
    setWeatherPaused(false);
    refreshVolumes();
  }

  function stopMusic() {
    clearMusicTimer();
    setWeather(null);
    if (ctx && music.bus) {
      const now = ctx.currentTime;
      try {
        music.bus.gain.cancelScheduledValues(now);
        music.bus.gain.setTargetAtTime(0.0001, now, 0.15);
      } catch {
        /* ignore */
      }
    }
    const bus = music.bus;
    const oscs = music.oscillators.slice();
    const extras = music.nodes.slice();
    music.playing = false;
    music.paused = false;
    music.bus = null;
    music.oscillators = [];
    music.nodes = [];
    music.beat = 0;

    window.setTimeout(() => {
      stopOscList(oscs);
      for (const node of extras) {
        try {
          node.disconnect();
        } catch {
          /* ignore */
        }
      }
      try {
        bus?.disconnect();
      } catch {
        /* ignore */
      }
    }, 600);
  }

  return {
    playMenuClick,
    playTreeRustle,
    playTreeCrash,
    playRockCrack,
    playRockBreak,
    playOreDetune,
    playFoodPop,
    playHarvest,
    playThunderCrack,
    setWeather,
    setWeatherPaused,
    setWeatherMuffled,
    startMusic,
    stopMusic,
    pauseMusic,
    resumeMusic,
    refreshVolumes,
    ensureCtx,
  };
})();
