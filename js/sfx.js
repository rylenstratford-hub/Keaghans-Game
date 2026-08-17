/**
 * Game / menu SFX — synthesized with Web Audio (no copyrighted samples).
 */
window.KeaghanSfx = (() => {
  let ctx = null;
  let forbiddenSiren = null;

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

  function playForbiddenSteam() {
    const audio = ensureCtx();
    if (!audio) return;
    const out = makeOut(audio, 0.42);
    if (!out) return;
    playNoise(audio, out, { seconds: 1.4, freq: 3200, q: 0.55, gain: 0.34, type: "bandpass" });
    playNoise(audio, out, { seconds: 1.55, freq: 780, q: 0.4, gain: 0.16, type: "highpass", delay: 0.04 });
  }

  function playForbiddenSteamTail() {
    const audio = ensureCtx();
    if (!audio) return;
    const out = makeOut(audio, 0.26);
    if (!out) return;
    playNoise(audio, out, { seconds: 1.65, freq: 1700, q: 0.42, gain: 0.14, type: "bandpass" });
  }

  function playForbiddenDoors() {
    const audio = ensureCtx();
    if (!audio) return;
    const out = makeOut(audio, 0.5);
    if (!out) return;
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const grind = audio.createGain();
    const filter = audio.createBiquadFilter();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(72, now);
    osc.frequency.exponentialRampToValueAtTime(36, now + 2.15);
    filter.type = "lowpass";
    filter.frequency.value = 210;
    grind.gain.setValueAtTime(0.0001, now);
    grind.gain.exponentialRampToValueAtTime(0.2, now + 0.08);
    grind.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
    osc.connect(filter);
    filter.connect(grind);
    grind.connect(out);
    osc.start(now);
    osc.stop(now + 2.25);
    playNoise(audio, out, { seconds: 2.15, freq: 170, q: 0.75, gain: 0.15, type: "lowpass" });
  }

  function startForbiddenSiren() {
    stopForbiddenSiren();
    const audio = ensureCtx();
    if (!audio) return;
    const out = makeOut(audio, 0.4);
    if (!out) return;
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const filter = audio.createBiquadFilter();
    const lfo = audio.createOscillator();
    const lfoGain = audio.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = 540;
    filter.type = "lowpass";
    filter.frequency.value = 1400;
    lfo.type = "triangle";
    lfo.frequency.value = 1.7;
    lfoGain.gain.value = 190;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.17, now + 0.08);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    osc.start(now);
    lfo.start(now);
    forbiddenSiren = { audio, osc, lfo, gain, out };
  }

  function fadeForbiddenSiren() {
    if (!forbiddenSiren) return;
    const now = forbiddenSiren.audio.currentTime;
    try {
      forbiddenSiren.gain.gain.cancelScheduledValues(now);
      forbiddenSiren.gain.gain.setValueAtTime(Math.max(0.0001, forbiddenSiren.gain.gain.value), now);
      forbiddenSiren.gain.gain.exponentialRampToValueAtTime(0.0001, now + 4.4);
    } catch {
      /* ignore */
    }
    const handle = forbiddenSiren;
    window.setTimeout(() => {
      if (forbiddenSiren !== handle) return;
      stopForbiddenSiren();
    }, 4500);
  }

  function stopForbiddenSiren() {
    if (!forbiddenSiren) return;
    const handle = forbiddenSiren;
    forbiddenSiren = null;
    const now = handle.audio.currentTime;
    try {
      handle.gain.gain.cancelScheduledValues(now);
      handle.gain.gain.setValueAtTime(Math.max(0.0001, handle.gain.gain.value), now);
      handle.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    } catch {
      /* ignore */
    }
    window.setTimeout(() => {
      try {
        handle.osc.stop();
        handle.lfo.stop();
      } catch {
        /* ignore */
      }
    }, 120);
  }

  function playForbiddenTwerk() {
    const audio = ensureCtx();
    if (!audio) return;
    const out = makeOut(audio, 0.48);
    if (!out) return;
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const filter = audio.createBiquadFilter();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(70, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.16);
    filter.type = "lowpass";
    filter.frequency.value = 240;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.24);
    playNoise(audio, out, { seconds: 0.2, freq: 130, q: 0.8, gain: 0.14, type: "lowpass" });
  }

  function playForbiddenSlam() {
    const audio = ensureCtx();
    if (!audio) return;
    const out = makeOut(audio, 0.55);
    if (!out) return;
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const filter = audio.createBiquadFilter();
    osc.type = "square";
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.14);
    filter.type = "lowpass";
    filter.frequency.value = 320;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.28, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.2);
    playNoise(audio, out, { seconds: 0.16, freq: 220, q: 0.7, gain: 0.2, type: "lowpass" });
  }

  function playForbiddenSparks() {
    const audio = ensureCtx();
    if (!audio) return;
    const out = makeOut(audio, 0.36);
    if (!out) return;
    playNoise(audio, out, { seconds: 0.12, freq: 4200, q: 1.2, gain: 0.22, type: "bandpass", crackle: true });
    playNoise(audio, out, { seconds: 0.1, freq: 2800, q: 1.4, gain: 0.16, type: "bandpass", delay: 0.08, crackle: true });
    playNoise(audio, out, { seconds: 0.14, freq: 3600, q: 1.1, gain: 0.18, type: "highpass", delay: 0.16, crackle: true });
    playNoise(audio, out, { seconds: 0.11, freq: 2400, q: 1.3, gain: 0.14, type: "bandpass", delay: 0.28, crackle: true });
    playNoise(audio, out, { seconds: 0.18, freq: 1800, q: 0.8, gain: 0.1, type: "highpass", delay: 0.4, crackle: true });
  }

  function playForbiddenRise() {
    const audio = ensureCtx();
    if (!audio) return;
    const out = makeOut(audio, 0.46);
    if (!out) return;
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const lift = audio.createGain();
    const filter = audio.createBiquadFilter();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(48, now);
    osc.frequency.exponentialRampToValueAtTime(86, now + 1.05);
    filter.type = "lowpass";
    filter.frequency.value = 260;
    lift.gain.setValueAtTime(0.0001, now);
    lift.gain.exponentialRampToValueAtTime(0.18, now + 0.1);
    lift.gain.exponentialRampToValueAtTime(0.0001, now + 1.15);
    osc.connect(filter);
    filter.connect(lift);
    lift.connect(out);
    osc.start(now);
    osc.stop(now + 1.2);
    playNoise(audio, out, { seconds: 1.15, freq: 140, q: 0.7, gain: 0.12, type: "lowpass" });
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

  /** Short chew / crunch burst when eating food. */
  function playFoodMunch() {
    const audio = ensureCtx();
    if (!audio) return;
    const out = makeOut(audio, 0.64);
    if (!out) return;

    const bites = 3 + Math.floor(Math.random() * 2); // 3–4 munches
    let t = 0;
    for (let i = 0; i < bites; i++) {
      const when = audio.currentTime + t;
      const crunchFreq = 900 + Math.random() * 700;
      const jawFreq = 120 + Math.random() * 40;

      // Crispy mid chew
      playNoise(audio, out, {
        seconds: 0.055 + Math.random() * 0.025,
        freq: crunchFreq,
        q: 1.35,
        gain: 0.42,
        type: "bandpass",
        delay: t,
        crackle: true,
      });
      // Softer wet body
      playNoise(audio, out, {
        seconds: 0.07,
        freq: 320 + Math.random() * 120,
        q: 0.7,
        gain: 0.28,
        type: "lowpass",
        delay: t + 0.008,
      });

      // Tiny jaw thud
      const jaw = audio.createOscillator();
      const jawGain = audio.createGain();
      const jawFilter = audio.createBiquadFilter();
      jaw.type = "triangle";
      jaw.frequency.setValueAtTime(jawFreq, when);
      jaw.frequency.exponentialRampToValueAtTime(Math.max(55, jawFreq * 0.55), when + 0.05);
      jawFilter.type = "lowpass";
      jawFilter.frequency.value = 420;
      jawGain.gain.setValueAtTime(0.0001, when);
      jawGain.gain.exponentialRampToValueAtTime(0.38, when + 0.005);
      jawGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.07);
      jaw.connect(jawFilter);
      jawFilter.connect(jawGain);
      jawGain.connect(out);
      jaw.start(when);
      jaw.stop(when + 0.08);

      t += 0.1 + Math.random() * 0.045;
    }
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
  let etherealMusic = {
    playing: false,
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
    if (etherealMusic.bus) {
      const target = etherealMusic.playing ? musicTargetGain() * 0.92 : 0.0001;
      etherealMusic.bus.gain.cancelScheduledValues(now);
      etherealMusic.bus.gain.setTargetAtTime(target, now, 0.1);
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
  // How often a full lightning wave can roll during thunder.
  const THUNDER_CYCLE_MS = 7000;
  /** Warning glow on the 3×3 strike zone before impact (time to walk out). */
  const LIGHTNING_WARN_MS = 2200;
  const LIGHTNING_HIT_MS = 420;

  /** Zigzag bolt silhouettes (viewBox 100×340). */
  const LIGHTNING_BOLT_PATHS = [
    "M52 0 L46 48 L68 62 L42 118 L70 142 L38 198 L58 230 L34 340",
    "M50 0 L62 40 L40 78 L72 120 L44 168 L78 210 L36 268 L55 340",
    "M48 0 L38 55 L66 72 L30 130 L80 155 L42 215 L64 255 L28 340",
    "M55 0 L70 35 L45 90 L75 125 L40 175 L68 220 L48 275 L60 340",
    "M50 0 L44 60 L58 95 L35 150 L62 185 L40 250 L52 300 L46 340",
  ];

  /** Fork branches drawn as secondary strokes on some bolts. */
  const LIGHTNING_FORK_PATHS = [
    "M46 118 L18 165 L28 210",
    "M72 120 L92 168 L84 220",
    "M66 72 L90 110 L78 155",
    "M40 175 L12 220 L22 270",
    "M62 185 L88 230 L70 280",
  ];

  /**
   * Wave patterns: staggered bolts across the sky + cracks timed with hits.
   * x = horizontal %; path/fork = shape indices; linger = longer glow.
   */
  const LIGHTNING_WAVE_PATTERNS = [
    {
      name: "cascade-left",
      softFlash: false,
      strikes: [
        { x: 12, path: 0, fork: 0, delay: 0, crack: true, linger: false, scale: 1.05 },
        { x: 34, path: 1, fork: 1, delay: 130, crack: true, linger: false, scale: 0.95 },
        { x: 58, path: 2, fork: 2, delay: 260, crack: false, linger: true, scale: 1.1 },
        { x: 82, path: 3, fork: 3, delay: 400, crack: true, linger: false, scale: 0.9 },
      ],
    },
    {
      name: "cascade-right",
      softFlash: false,
      strikes: [
        { x: 88, path: 3, fork: 1, delay: 0, crack: true, linger: false, scale: 1 },
        { x: 64, path: 4, fork: 4, delay: 110, crack: false, linger: false, scale: 1.08 },
        { x: 40, path: 0, fork: 0, delay: 240, crack: true, linger: true, scale: 0.92 },
        { x: 16, path: 2, fork: 2, delay: 380, crack: true, linger: false, scale: 1.05 },
      ],
    },
    {
      name: "fork-center",
      softFlash: false,
      strikes: [
        { x: 50, path: 1, fork: 1, delay: 0, crack: true, linger: true, scale: 1.2 },
        { x: 32, path: 0, fork: 0, delay: 90, crack: false, linger: false, scale: 0.85 },
        { x: 68, path: 3, fork: 3, delay: 105, crack: true, linger: false, scale: 0.88 },
        { x: 18, path: 4, fork: 4, delay: 300, crack: true, linger: false, scale: 0.95 },
        { x: 84, path: 2, fork: 2, delay: 340, crack: false, linger: false, scale: 0.9 },
      ],
    },
    {
      name: "scatter",
      softFlash: true,
      strikes: [
        { x: 22, path: 2, fork: -1, delay: 0, crack: true, linger: false, scale: 0.8 },
        { x: 71, path: 0, fork: 0, delay: 70, crack: true, linger: false, scale: 1.05 },
        { x: 45, path: 4, fork: 4, delay: 190, crack: false, linger: true, scale: 1.15 },
        { x: 90, path: 1, fork: -1, delay: 310, crack: true, linger: false, scale: 0.75 },
        { x: 8, path: 3, fork: 3, delay: 430, crack: false, linger: false, scale: 0.95 },
      ],
    },
    {
      name: "double-front",
      softFlash: false,
      strikes: [
        { x: 28, path: 0, fork: 0, delay: 0, crack: true, linger: false, scale: 1.1 },
        { x: 36, path: 1, fork: 1, delay: 55, crack: true, linger: false, scale: 0.95 },
        { x: 74, path: 3, fork: 3, delay: 280, crack: true, linger: true, scale: 1.05 },
        { x: 55, path: 2, fork: 2, delay: 450, crack: false, linger: false, scale: 0.85 },
      ],
    },
    {
      name: "ridge-hop",
      softFlash: false,
      strikes: [
        { x: 15, path: 4, fork: -1, delay: 0, crack: true, linger: false, scale: 0.9 },
        { x: 48, path: 1, fork: 1, delay: 160, crack: true, linger: true, scale: 1.18 },
        { x: 78, path: 0, fork: 0, delay: 300, crack: true, linger: false, scale: 1 },
        { x: 60, path: 3, fork: 3, delay: 420, crack: false, linger: false, scale: 0.8 },
      ],
    },
  ];

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
    waveIndex: 0,
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

  function clearLightningVisuals() {
    const flash = document.getElementById("sky-lightning-flash");
    const bolts = document.getElementById("sky-lightning-bolts");
    const mapFlash = document.getElementById("world-lightning-flash");
    const mapBolts = document.getElementById("world-lightning-bolts");
    if (flash) {
      flash.classList.remove("is-flash", "is-flash-soft");
    }
    if (bolts) bolts.replaceChildren();
    if (mapFlash) {
      mapFlash.classList.remove("is-flash", "is-flash-soft");
    }
    if (mapBolts) mapBolts.replaceChildren();
    document
      .querySelectorAll(".tile--lightning-hit")
      .forEach((tile) => tile.classList.remove("tile--lightning-hit"));
    window.IslandFoundry?.clearLightningPreview?.();
  }

  function mapGridSize(grid) {
    const cols =
      Number.parseInt(getComputedStyle(grid).getPropertyValue("--cols"), 10) || 10;
    const tiles = grid.querySelectorAll(".tile");
    const rows = Math.max(1, Math.ceil(tiles.length / cols));
    return { cols, rows, tiles };
  }

  /** Random outdoor tile center for a 3×3 strike. */
  function pickMapStrikeCell(grid) {
    const { cols, rows } = mapGridSize(grid);
    return {
      col: Math.floor(Math.random() * cols),
      row: Math.floor(Math.random() * rows),
    };
  }

  function tilesInStrikeRadius(grid, col, row) {
    const { cols, rows, tiles } = mapGridSize(grid);
    const hit = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = col + dx;
        const y = row + dy;
        if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
        const tile = tiles[y * cols + x];
        if (tile) hit.push(tile);
      }
    }
    return hit;
  }

  /** Outdoor island map only — no bolts while inside the base. */
  function mapLightningTarget() {
    const grid = document.getElementById("world-grid");
    if (!grid || grid.classList.contains("is-inside-base")) return null;
    const bolts = document.getElementById("world-lightning-bolts");
    const flash = document.getElementById("world-lightning-flash");
    if (!bolts || !flash) return null;
    return { grid, bolts, flash };
  }

  function clearThunderSchedule() {
    if (weatherFx.thunderTimer) {
      window.clearInterval(weatherFx.thunderTimer);
      weatherFx.thunderTimer = 0;
    }
    for (const id of weatherFx.thunderTimeouts) window.clearTimeout(id);
    weatherFx.thunderTimeouts = [];
    clearLightningVisuals();
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

  function prefersReducedLightning() {
    try {
      return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
    } catch {
      return false;
    }
  }

  function buildBoltSvg(pathD, forkD, glowClass) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 340");
    svg.setAttribute("aria-hidden", "true");

    const glow = document.createElementNS("http://www.w3.org/2000/svg", "path");
    glow.setAttribute("d", pathD);
    glow.setAttribute("class", glowClass);
    svg.appendChild(glow);

    const core = document.createElementNS("http://www.w3.org/2000/svg", "path");
    core.setAttribute("d", pathD);
    svg.appendChild(core);

    if (forkD) {
      const forkGlow = document.createElementNS("http://www.w3.org/2000/svg", "path");
      forkGlow.setAttribute("d", forkD);
      forkGlow.setAttribute("class", glowClass);
      svg.appendChild(forkGlow);
      const fork = document.createElementNS("http://www.w3.org/2000/svg", "path");
      fork.setAttribute("d", forkD);
      svg.appendChild(fork);
    }
    return svg;
  }

  function boltGeometry(strike) {
    const pathD =
      LIGHTNING_BOLT_PATHS[strike.path % LIGHTNING_BOLT_PATHS.length] ||
      LIGHTNING_BOLT_PATHS[0];
    const forkD =
      strike.fork >= 0
        ? LIGHTNING_FORK_PATHS[strike.fork % LIGHTNING_FORK_PATHS.length]
        : null;
    return { pathD, forkD };
  }

  function spawnLightningBolt(boltsRoot, strike) {
    const { pathD, forkD } = boltGeometry(strike);

    const wrap = document.createElement("div");
    wrap.className = "sky__bolt";
    wrap.style.left = `calc(${strike.x}% - 2.5vw)`;
    wrap.style.setProperty("--bolt-scale", String(strike.scale || 1));
    wrap.style.setProperty("--bolt-tilt", `${strike.tilt || 0}deg`);

    const anim = document.createElement("div");
    anim.className = "sky__bolt-anim";
    anim.appendChild(buildBoltSvg(pathD, forkD, "sky__bolt-glow"));
    wrap.appendChild(anim);
    boltsRoot.appendChild(wrap);

    requestAnimationFrame(() => {
      anim.classList.add(strike.linger ? "is-strike-linger" : "is-strike");
    });

    const life = strike.linger ? 750 : 480;
    const clearId = window.setTimeout(() => {
      wrap.remove();
    }, life);
    weatherFx.thunderTimeouts.push(clearId);
  }

  function spawnMapLightningBolt(boltsRoot, strike) {
    const { pathD, forkD } = boltGeometry(strike);

    const wrap = document.createElement("div");
    wrap.className = "map-bolt";
    // Anchor near the top of the island grid so bolts stab down into tiles.
    wrap.style.left = `calc(${strike.x}% - 2vw)`;
    wrap.style.top = `${Math.max(0, Math.min(22, (strike.mapTop ?? 4) + Math.random() * 8))}%`;
    wrap.style.height = `${44 + Math.random() * 18}%`;
    wrap.style.setProperty("--bolt-scale", String((strike.scale || 1) * 0.85));
    wrap.style.setProperty("--bolt-tilt", `${strike.tilt || 0}deg`);

    const anim = document.createElement("div");
    anim.className = "map-bolt__anim";
    anim.appendChild(buildBoltSvg(pathD, forkD, "map-bolt__glow"));
    wrap.appendChild(anim);
    boltsRoot.appendChild(wrap);

    requestAnimationFrame(() => {
      anim.classList.add(strike.linger ? "is-strike-linger" : "is-strike");
    });

    const life = strike.linger ? 750 : 480;
    const clearId = window.setTimeout(() => {
      wrap.remove();
    }, life);
    weatherFx.thunderTimeouts.push(clearId);
  }

  /** Briefly light up the 3×3 under a map strike. */
  function flashMapStrikeTiles(grid, col, row) {
    const hit = tilesInStrikeRadius(grid, col, row);
    for (const tile of hit) tile.classList.add("tile--lightning-hit");
    const clearId = window.setTimeout(() => {
      for (const tile of hit) tile.classList.remove("tile--lightning-hit");
    }, LIGHTNING_HIT_MS);
    weatherFx.thunderTimeouts.push(clearId);
  }

  function pulseFlashElement(flash, soft) {
    if (!flash) return;
    flash.classList.remove("is-flash", "is-flash-soft");
    void flash.offsetWidth;
    flash.classList.add(soft ? "is-flash-soft" : "is-flash");
    const clearId = window.setTimeout(() => {
      flash.classList.remove("is-flash", "is-flash-soft");
    }, soft ? 450 : 600);
    weatherFx.thunderTimeouts.push(clearId);
  }

  function pulseSheetFlash(soft) {
    pulseFlashElement(document.getElementById("sky-lightning-flash"), soft);
    const map = mapLightningTarget();
    if (map) pulseFlashElement(map.flash, soft);
  }

  /** Pick a wave pattern and fire staggered bolts + thunder cracks. */
  function runLightningWave() {
    if (weatherFx.paused || weatherFx.kind !== "thunder") return;

    const boltsRoot = document.getElementById("sky-lightning-bolts");
    if (!boltsRoot) {
      playThunderCrack();
      return;
    }

    const map = mapLightningTarget();
    let target = null;
    if (map) {
      target = pickMapStrikeCell(map.grid);
      // 3×3 glow first so the pioneer can step out before impact.
      window.IslandFoundry?.previewLightningStrike?.(target.col, target.row);
    }

    if (prefersReducedLightning()) {
      const warnId = window.setTimeout(() => {
        if (weatherFx.paused || weatherFx.kind !== "thunder") {
          window.IslandFoundry?.clearLightningPreview?.();
          return;
        }
        pulseSheetFlash(true);
        playThunderCrack();
        if (target) {
          const mapNow = mapLightningTarget();
          if (mapNow) flashMapStrikeTiles(mapNow.grid, target.col, target.row);
          window.IslandFoundry?.onLightningStrike?.(target.col, target.row);
        } else {
          window.IslandFoundry?.clearLightningPreview?.();
        }
      }, map && target ? LIGHTNING_WARN_MS : 0);
      weatherFx.thunderTimeouts.push(warnId);
      return;
    }

    const pattern =
      LIGHTNING_WAVE_PATTERNS[weatherFx.waveIndex % LIGHTNING_WAVE_PATTERNS.length];
    weatherFx.waveIndex += 1;

    const { cols } = map ? mapGridSize(map.grid) : { cols: 10 };
    const targetX =
      target != null ? ((target.col + 0.5) / cols) * 100 : 50;

    // Impact after the telegraph — bolts + crack + electrify check.
    const impactId = window.setTimeout(() => {
      if (weatherFx.paused || weatherFx.kind !== "thunder") {
        window.IslandFoundry?.clearLightningPreview?.();
        return;
      }

      boltsRoot.replaceChildren();
      const mapNow = mapLightningTarget();
      if (mapNow) mapNow.bolts.replaceChildren();
      pulseSheetFlash(Boolean(pattern.softFlash));

      for (const base of pattern.strikes) {
        const isMain = Boolean(base.linger) || base === pattern.strikes[0];
        const strike = {
          ...base,
          x: isMain && target
            ? Math.max(4, Math.min(94, targetX + (Math.random() * 4 - 2)))
            : Math.max(4, Math.min(94, base.x + (Math.random() * 6 - 3))),
          tilt: (Math.random() * 10 - 5).toFixed(1),
          scale: (base.scale || 1) * (0.92 + Math.random() * 0.16),
          mapTop: Math.random() * 10,
        };
        const id = window.setTimeout(() => {
          if (weatherFx.paused || weatherFx.kind !== "thunder") return;
          spawnLightningBolt(boltsRoot, strike);
          const mapHit = mapLightningTarget();
          if (mapHit && isMain && target) {
            spawnMapLightningBolt(mapHit.bolts, strike);
            flashMapStrikeTiles(mapHit.grid, target.col, target.row);
            window.IslandFoundry?.onLightningStrike?.(target.col, target.row);
            target = null; // only electrify once per wave
          } else if (mapHit && !target) {
            spawnMapLightningBolt(mapHit.bolts, strike);
          }
          if (strike.crack) playThunderCrack();
          if (strike.linger) pulseSheetFlash(true);
        }, strike.delay);
        weatherFx.thunderTimeouts.push(id);
      }

      // If no strike marked itself main somehow, still resolve the warn.
      const fallbackId = window.setTimeout(() => {
        if (target) {
          window.IslandFoundry?.onLightningStrike?.(target.col, target.row);
          target = null;
        }
      }, 900);
      weatherFx.thunderTimeouts.push(fallbackId);
    }, map && target ? LIGHTNING_WARN_MS : 0);
    weatherFx.thunderTimeouts.push(impactId);
  }

  function scheduleThunderStrike() {
    // Stagger wave start a bit so storms don't feel metronomic.
    const delay = 220 + Math.random() * 520;
    const id = window.setTimeout(() => {
      runLightningWave();
    }, delay);
    weatherFx.thunderTimeouts.push(id);
  }

  function startThunderSchedule() {
    clearThunderSchedule();
    weatherFx.waveIndex = Math.floor(Math.random() * LIGHTNING_WAVE_PATTERNS.length);
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

  function playCrystal(audio, bus, freq, when, dur = 2.6, peak = 0.055) {
    const ratios = [1, 2.01, 2.76, 4.07];
    ratios.forEach((ratio, i) => {
      playTone(audio, bus, {
        freq: freq * ratio,
        when: when + i * 0.012,
        dur: dur * (1 - i * 0.08),
        peak: peak * (i === 0 ? 0.7 : 0.28 / ratio),
        type: i % 2 === 0 ? "sine" : "triangle",
        filterFreq: 5200 - i * 400,
      });
    });
    const delay = Math.max(0, when - audio.currentTime);
    playNoise(audio, bus, {
      seconds: 0.16,
      freq: 6200,
      q: 0.7,
      gain: peak * 0.22,
      type: "highpass",
      delay,
    });
  }

  function playChime(audio, bus, freq, when, peak = 0.07) {
    playTone(audio, bus, {
      freq,
      when,
      dur: 2.8,
      peak,
      type: "sine",
      filterFreq: 6400,
    });
    playTone(audio, bus, {
      freq: freq * 2,
      when: when + 0.008,
      dur: 1.8,
      peak: peak * 0.35,
      type: "triangle",
      filterFreq: 7200,
    });
    playTone(audio, bus, {
      freq: freq * 3.01,
      when: when + 0.016,
      dur: 1.1,
      peak: peak * 0.12,
      type: "sine",
      filterFreq: 8000,
    });
  }

  function scheduleEtherealBar() {
    if (!etherealMusic.playing || !ctx || !etherealMusic.bus) return;
    const audio = ctx;
    const now = audio.currentTime + 0.04;
    const bar = etherealMusic.beat % 8;
    etherealMusic.beat += 1;
    const bus = etherealMusic.bus;

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
    playChord(audio, bus, chord, now, 4.1, 0.048);

    const arp = [chord[0], chord[1], chord[2], chord[1] + 7, chord[2], chord[0] + 7];
    arp.forEach((deg, i) => {
      playTone(audio, bus, {
        freq: musicFreq(deg, 1),
        when: now + 0.2 + i * 0.52,
        dur: 0.7,
        peak: 0.055,
        type: "triangle",
        filterFreq: 3000,
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
      const t = now + 0.28 + i * 0.46;
      playTone(audio, bus, {
        freq: musicFreq(deg, 2),
        when: t,
        dur: 0.62,
        peak: 0.07,
        type: "sine",
        filterFreq: 3600,
      });
      playTone(audio, bus, {
        freq: musicFreq(deg, 3),
        when: t + 0.02,
        dur: 0.34,
        peak: 0.024,
        type: "triangle",
        filterFreq: 4800,
      });
    });

    const bassDeg = [0, 0, 3, 3, 4, 4, 0, 7][bar];
    playPianoNote(audio, bus, musicFreq(bassDeg, 0), now, 2.6, 0.045);
    playPianoNote(audio, bus, musicFreq(bassDeg, 1), now + 0.03, 2.3, 0.026);
    const pianoPhrase = [0, 2, 4, 7, 4, 2, 0, 2];
    pianoPhrase.forEach((deg, i) => {
      playPianoNote(audio, bus, musicFreq(deg, 2), now + 0.22 + i * 0.48, 1.15, 0.06);
    });

    if (bar % 2 === 0) {
      playCymbalCrash(audio, bus, now, bar % 4 === 0 ? 0.07 : 0.045);
    }

    chord.forEach((deg, i) => {
      playCrystal(audio, bus, musicFreq(deg, 3), now + 0.35 + i * 0.85, 2.8, 0.045);
    });

    const chimeDegs = [4, 7, 9, 12, 9, 7];
    chimeDegs.forEach((deg, i) => {
      if ((bar + i) % 2 !== 0) return;
      playChime(audio, bus, musicFreq(deg, 3), now + 0.4 + i * 0.62, 0.055);
    });
  }

  function startEtherealMusic() {
    const audio = ensureCtx();
    if (!audio) return;
    if (etherealMusic.playing) return;

    etherealMusic.playing = true;
    etherealMusic.beat = 0;
    etherealMusic.bus = audio.createGain();
    etherealMusic.bus.gain.value = 0.0001;
    etherealMusic.bus.connect(audio.destination);
    etherealMusic.bus.gain.linearRampToValueAtTime(musicTargetGain() * 0.92, audio.currentTime + 1.6);

    const air = audio.createOscillator();
    const airGain = audio.createGain();
    const airFilter = audio.createBiquadFilter();
    air.type = "sine";
    air.frequency.value = 990;
    airFilter.type = "bandpass";
    airFilter.frequency.value = 2800;
    airFilter.Q.value = 0.45;
    airGain.gain.value = 0.02;
    air.connect(airFilter);
    airFilter.connect(airGain);
    airGain.connect(etherealMusic.bus);
    air.start();
    etherealMusic.oscillators.push(air);
    etherealMusic.nodes.push(airGain, airFilter);

    const pad = audio.createOscillator();
    const padB = audio.createOscillator();
    const padGain = audio.createGain();
    const padFilter = audio.createBiquadFilter();
    pad.type = "sine";
    padB.type = "triangle";
    pad.frequency.value = MUSIC_ROOT;
    padB.frequency.value = MUSIC_ROOT * 1.005;
    padFilter.type = "lowpass";
    padFilter.frequency.value = 1400;
    padGain.gain.value = 0.04;
    pad.connect(padFilter);
    padB.connect(padFilter);
    padFilter.connect(padGain);
    padGain.connect(etherealMusic.bus);
    pad.start();
    padB.start();
    etherealMusic.oscillators.push(pad, padB);
    etherealMusic.nodes.push(padGain, padFilter);

    scheduleEtherealBar();
    if (etherealMusic.timer) window.clearInterval(etherealMusic.timer);
    etherealMusic.timer = window.setInterval(() => {
      if (!etherealMusic.playing) return;
      scheduleEtherealBar();
    }, 4200);
  }

  function stopEtherealMusic() {
    if (etherealMusic.timer) {
      window.clearInterval(etherealMusic.timer);
      etherealMusic.timer = 0;
    }
    if (ctx && etherealMusic.bus) {
      const now = ctx.currentTime;
      try {
        etherealMusic.bus.gain.cancelScheduledValues(now);
        etherealMusic.bus.gain.setTargetAtTime(0.0001, now, 0.18);
      } catch {
        /* ignore */
      }
    }
    const bus = etherealMusic.bus;
    const oscs = etherealMusic.oscillators.slice();
    const extras = etherealMusic.nodes.slice();
    etherealMusic.playing = false;
    etherealMusic.bus = null;
    etherealMusic.oscillators = [];
    etherealMusic.nodes = [];
    etherealMusic.beat = 0;
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
    }, 700);
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

  /** ADA voice — Web Speech API (browser TTS). Enter skips via stopAdaSpeech. */
  let adaVoice = null;
  let adaSpeakTimer = 0;
  let adaSpeaking = false;

  function pickAdaVoice() {
    if (!window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return null;
    const scored = voices.map((v) => {
      const name = `${v.name} ${v.lang}`.toLowerCase();
      let score = 0;
      if (/en(-|_)?(us|gb|au)?/.test(v.lang.toLowerCase())) score += 5;
      if (/female|woman|zira|samantha|susan|karen|moira|victoria|linda|hazel/.test(name)) {
        score += 4;
      }
      if (/google|microsoft|natural|neural|premium/.test(name)) score += 2;
      if (/male|david|mark|george|daniel/.test(name)) score -= 2;
      return { v, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.v || voices[0] || null;
  }

  function refreshAdaVoice() {
    adaVoice = pickAdaVoice();
  }

  if (window.speechSynthesis) {
    refreshAdaVoice();
    window.speechSynthesis.onvoiceschanged = () => {
      refreshAdaVoice();
    };
  }

  function stopAdaSpeech() {
    if (adaSpeakTimer) {
      window.clearTimeout(adaSpeakTimer);
      adaSpeakTimer = 0;
    }
    adaSpeaking = false;
    try {
      window.speechSynthesis?.cancel?.();
    } catch {
      /* ignore */
    }
  }

  function isAdaSpeaking() {
    if (adaSpeaking) return true;
    try {
      return Boolean(window.speechSynthesis?.speaking || window.speechSynthesis?.pending);
    } catch {
      return false;
    }
  }

  /**
   * Speak an ADA line aloud. Soft, slightly quick delivery.
   * Press Enter in-game to skip (stopAdaSpeech).
   */
  function speakAdaLine(text) {
    if (!text || !window.speechSynthesis) return false;
    const vol = masterGain();
    if (vol <= 0.01) return false;

    stopAdaSpeech();
    if (!adaVoice) refreshAdaVoice();

    const utter = new SpeechSynthesisUtterance(String(text));
    utter.rate = 1.05;
    utter.pitch = 1.15;
    utter.volume = Math.max(0, Math.min(1, vol));
    if (adaVoice) utter.voice = adaVoice;
    utter.lang = adaVoice?.lang || "en-US";
    utter.onstart = () => {
      adaSpeaking = true;
    };
    utter.onend = () => {
      adaSpeaking = false;
    };
    utter.onerror = () => {
      adaSpeaking = false;
    };

    // Some browsers need a tick after cancel before speak.
    adaSpeaking = true;
    adaSpeakTimer = window.setTimeout(() => {
      adaSpeakTimer = 0;
      try {
        window.speechSynthesis.speak(utter);
      } catch {
        adaSpeaking = false;
      }
    }, 40);
    return true;
  }

  /**
   * 6-7 audio:
   * - setup/pre-load → crazy glitch stabs
   * - watch → zoomies whooshes
   * - setup + max loops → original fast chiptune frenzy (+ pipe-ish / kick-ish hits)
   * Intensity 0–20 scales density/wildness with the loop counter.
   *
   * Note: cannot use Super Mario Bros. music/SFX (copyright). This is an original
   * hyper platformer-style bed in the same chaotic spirit.
   */
  let sixSevenAudio = {
    mode: "off", // off | setup | watch
    timer: 0,
    intensity: 0,
  };

  let sixSevenFrenzy = {
    playing: false,
    bus: null,
    nodes: [],
    oscillators: [],
    timer: 0,
    step: 0,
    fxTimer: 0,
  };

  function stopSixSevenFrenzy() {
    if (sixSevenFrenzy.timer) {
      window.clearInterval(sixSevenFrenzy.timer);
      sixSevenFrenzy.timer = 0;
    }
    if (sixSevenFrenzy.fxTimer) {
      window.clearInterval(sixSevenFrenzy.fxTimer);
      sixSevenFrenzy.fxTimer = 0;
    }
    stopOscList(sixSevenFrenzy.oscillators);
    for (const node of sixSevenFrenzy.nodes) {
      try {
        node.disconnect();
      } catch {
        /* ignore */
      }
    }
    sixSevenFrenzy.nodes.length = 0;
    if (sixSevenFrenzy.bus) {
      try {
        sixSevenFrenzy.bus.disconnect();
      } catch {
        /* ignore */
      }
    }
    sixSevenFrenzy.bus = null;
    sixSevenFrenzy.playing = false;
    sixSevenFrenzy.step = 0;
  }

  function stopSixSevenZoomies() {
    if (sixSevenAudio.timer) {
      window.clearInterval(sixSevenAudio.timer);
      sixSevenAudio.timer = 0;
    }
    sixSevenAudio.mode = "off";
    sixSevenAudio.intensity = 0;
  }

  function stopSixSevenAudio() {
    stopSixSevenZoomies();
    stopSixSevenFrenzy();
  }

  /**
   * Creepy / ominous drone bed for the 6–7 blackout sting.
   * Original Web Audio — low detuned drones + distant heartbeat, no samples.
   */
  let ominousMusic = {
    playing: false,
    bus: null,
    nodes: [],
    oscillators: [],
    timer: 0,
    step: 0,
  };

  function stopOminousMusic() {
    if (ominousMusic.timer) {
      window.clearInterval(ominousMusic.timer);
      ominousMusic.timer = 0;
    }
    if (ctx && ominousMusic.bus) {
      const now = ctx.currentTime;
      try {
        ominousMusic.bus.gain.cancelScheduledValues(now);
        ominousMusic.bus.gain.setTargetAtTime(0.0001, now, 0.2);
      } catch {
        /* ignore */
      }
    }
    const bus = ominousMusic.bus;
    const oscs = ominousMusic.oscillators.slice();
    const extras = ominousMusic.nodes.slice();
    ominousMusic.playing = false;
    ominousMusic.bus = null;
    ominousMusic.oscillators = [];
    ominousMusic.nodes = [];
    ominousMusic.step = 0;

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
    }, 500);
  }

  function scheduleOminousPulse(audio, bus, when) {
    // Distant slow "heartbeat" thud.
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const filter = audio.createBiquadFilter();
    osc.type = "sine";
    osc.frequency.setValueAtTime(48, when);
    osc.frequency.exponentialRampToValueAtTime(28, when + 0.35);
    filter.type = "lowpass";
    filter.frequency.value = 140;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.55, when + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.55);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    osc.start(when);
    osc.stop(when + 0.6);

    // Thin dissonant glass above it.
    const hi = audio.createOscillator();
    const hiGain = audio.createGain();
    hi.type = "triangle";
    hi.frequency.setValueAtTime(622.25, when); // Eb5
    hi.frequency.setValueAtTime(659.25, when + 0.18); // E5 — uneasy slide
    hiGain.gain.setValueAtTime(0.0001, when);
    hiGain.gain.exponentialRampToValueAtTime(0.07, when + 0.04);
    hiGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.7);
    hi.connect(hiGain);
    hiGain.connect(bus);
    hi.start(when);
    hi.stop(when + 0.72);
  }

  function startOminousMusic() {
    const audio = ensureCtx();
    if (!audio) return;
    if (ominousMusic.playing) return;

    ominousMusic.playing = true;
    ominousMusic.step = 0;

    const bus = audio.createGain();
    bus.gain.value = 0.0001;
    bus.connect(audio.destination);
    const target = masterGain() * 0.42;
    bus.gain.linearRampToValueAtTime(Math.max(0.0001, target), audio.currentTime + 1.4);
    ominousMusic.bus = bus;
    ominousMusic.nodes.push(bus);

    // Detuned low drones (minor second grind).
    const droneSpecs = [
      { freq: 55, type: "sine", gain: 0.22 }, // A1
      { freq: 58.27, type: "sine", gain: 0.16 }, // A#1 — clash
      { freq: 82.41, type: "triangle", gain: 0.1 }, // E2
      { freq: 110.5, type: "sawtooth", gain: 0.035 }, // slightly sharp A2
    ];
    for (const spec of droneSpecs) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const filter = audio.createBiquadFilter();
      osc.type = spec.type;
      osc.frequency.value = spec.freq;
      filter.type = "lowpass";
      filter.frequency.value = 420;
      filter.Q.value = 0.7;
      gain.gain.value = spec.gain;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(bus);
      osc.start();
      ominousMusic.oscillators.push(osc);
      ominousMusic.nodes.push(gain, filter);
    }

    // Slow swirling noise bed.
    const noise = audio.createBufferSource();
    const noiseBuf = noiseBuffer(audio, 4, { crackle: true });
    noise.buffer = noiseBuf;
    noise.loop = true;
    const noiseFilter = audio.createBiquadFilter();
    const noiseGain = audio.createGain();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 180;
    noiseFilter.Q.value = 0.8;
    noiseGain.gain.value = 0.045;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(bus);
    noise.start();
    ominousMusic.oscillators.push(noise);
    ominousMusic.nodes.push(noiseFilter, noiseGain);

    scheduleOminousPulse(audio, bus, audio.currentTime + 0.2);
    ominousMusic.timer = window.setInterval(() => {
      if (!ominousMusic.playing || !ominousMusic.bus || !ctx) return;
      scheduleOminousPulse(ctx, ominousMusic.bus, ctx.currentTime);
      // Occasional deeper swell every other pulse.
      if (ominousMusic.step % 2 === 1) {
        const t = ctx.currentTime;
        const swell = ctx.createOscillator();
        const swellGain = ctx.createGain();
        swell.type = "sine";
        swell.frequency.setValueAtTime(36, t);
        swell.frequency.linearRampToValueAtTime(44, t + 1.2);
        swellGain.gain.setValueAtTime(0.0001, t);
        swellGain.gain.linearRampToValueAtTime(0.2, t + 0.6);
        swellGain.gain.linearRampToValueAtTime(0.0001, t + 1.6);
        swell.connect(swellGain);
        swellGain.connect(ominousMusic.bus);
        swell.start(t);
        swell.stop(t + 1.7);
      }
      ominousMusic.step += 1;
    }, 1400);
  }

  /** Original descending "warp tube" blip — not Nintendo's pipe. */
  function playSixSevenPipePop() {
    const audio = ensureCtx();
    if (!audio) return;
    const now = audio.currentTime;
    const out = makeOut(audio, 0.48);
    if (!out) return;

    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const filter = audio.createBiquadFilter();
    osc.type = "square";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.22);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2400, now);
    filter.frequency.exponentialRampToValueAtTime(420, now + 0.22);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.45, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.26);

    playNoise(audio, out, {
      seconds: 0.08,
      freq: 900,
      q: 0.8,
      gain: 0.16,
      type: "bandpass",
    });
  }

  /** Original short stomp/kick thump — not Nintendo's kick. */
  function playSixSevenKickPop() {
    const audio = ensureCtx();
    if (!audio) return;
    const now = audio.currentTime;
    const out = makeOut(audio, 0.5);
    if (!out) return;

    const body = audio.createOscillator();
    const bodyGain = audio.createGain();
    body.type = "sine";
    body.frequency.setValueAtTime(180, now);
    body.frequency.exponentialRampToValueAtTime(48, now + 0.09);
    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.85, now + 0.005);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    body.connect(bodyGain);
    bodyGain.connect(out);
    body.start(now);
    body.stop(now + 0.12);

    playNoise(audio, out, {
      seconds: 0.045,
      freq: 1200,
      q: 1.1,
      gain: 0.28,
      type: "bandpass",
      crackle: true,
    });
  }

  /**
   * Original fast chiptune frenzy for max-loop 6-7 pre-load.
   * Bright major motif — intentionally different from any Mario tune.
   */
  function startSixSevenFrenzy() {
    const audio = ensureCtx();
    if (!audio) return;
    if (sixSevenFrenzy.playing) return;

    stopSixSevenFrenzy();
    sixSevenFrenzy.playing = true;
    sixSevenFrenzy.step = 0;

    const bus = audio.createGain();
    bus.gain.value = Math.max(0.0001, masterGain() * 0.34);
    bus.connect(audio.destination);
    sixSevenFrenzy.bus = bus;
    sixSevenFrenzy.nodes.push(bus);

    // Semitone steps from A4 — original "factory dash" riff (not Mario).
    const melody = [
      0, 3, 7, 10, 12, 10, 7, 3,
      5, 8, 12, 15, 12, 8, 5, 0,
      7, 10, 14, 17, 14, 10, 7, 3,
      12, 15, 19, 15, 12, 8, 5, 0,
    ];
    const bass = [0, 0, 7, 7, 5, 5, 3, 3, 0, 0, 8, 8, 7, 7, 5, 3];

    const root = 440;
    const stepMs = 85; // fast + crazy

    const beep = (semi, dur, gainVal, type = "square", octave = 0) => {
      const now = audio.currentTime;
      const osc = audio.createOscillator();
      const g = audio.createGain();
      const f = root * Math.pow(2, (semi + octave * 12) / 12);
      osc.type = type;
      osc.frequency.setValueAtTime(f, now);
      // Tiny wild detune for chaos.
      osc.detune.setValueAtTime((Math.random() - 0.5) * 40, now);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(gainVal, now + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(g);
      g.connect(bus);
      osc.start(now);
      osc.stop(now + dur + 0.02);
      sixSevenFrenzy.oscillators.push(osc);
      // Prune finished refs occasionally.
      if (sixSevenFrenzy.oscillators.length > 40) {
        sixSevenFrenzy.oscillators.splice(0, 20);
      }
    };

    sixSevenFrenzy.timer = window.setInterval(() => {
      if (!sixSevenFrenzy.playing || !sixSevenFrenzy.bus) return;
      const i = sixSevenFrenzy.step;
      const m = melody[i % melody.length];
      const b = bass[i % bass.length];
      // Occasional octave jump / double-hit for "sped up crazy" feel.
      const crazy = Math.random() < 0.22;
      beep(m, crazy ? 0.07 : 0.1, crazy ? 0.22 : 0.16, "square", crazy ? 1 : 0);
      if (i % 2 === 0) beep(b, 0.12, 0.11, "triangle", -1);
      if (crazy) beep(m + 7, 0.05, 0.1, "square", 1);
      sixSevenFrenzy.step += 1;
    }, stepMs);

    // Pipe-ish / kick-ish accents over the frenzy bed.
    playSixSevenPipePop();
    sixSevenFrenzy.fxTimer = window.setInterval(() => {
      if (!sixSevenFrenzy.playing) return;
      if (Math.random() < 0.55) playSixSevenKickPop();
      else playSixSevenPipePop();
      if (Math.random() < 0.35) {
        window.setTimeout(() => playSixSevenKickPop(), 60 + Math.random() * 90);
      }
    }, 280);
  }

  /**
   * Arena boss theme — faster, denser, and more unhinged than setup frenzy.
   * Reuses the frenzy bus so only one crazy bed can run.
   */
  function startSixSevenBossMusic() {
    const audio = ensureCtx();
    if (!audio) return;

    stopOminousMusic();
    stopSixSevenFrenzy();
    sixSevenFrenzy.playing = true;
    sixSevenFrenzy.step = 0;

    const bus = audio.createGain();
    bus.gain.value = Math.max(0.0001, masterGain() * 0.4);
    bus.connect(audio.destination);
    sixSevenFrenzy.bus = bus;
    sixSevenFrenzy.nodes.push(bus);

    // Discordant climb — intentionally nastier than the pre-load riff.
    const melody = [
      0, 1, 4, 7, 11, 12, 11, 7, 4, 1, 0, 6, 10, 13, 16, 13, 10, 6, 3, 0, 8, 12, 15, 19, 15, 12, 8, 5, 2, 0, 14,
      17,
    ];
    const bass = [0, 1, 0, 7, 6, 7, 5, 4, 3, 2, 1, 0, 8, 7, 5, 3];
    const root = 466.16; // slightly sharp A♯ — unsettled
    const stepMs = 55;

    const beep = (semi, dur, gainVal, type = "square", octave = 0) => {
      const now = audio.currentTime;
      const osc = audio.createOscillator();
      const g = audio.createGain();
      const f = root * Math.pow(2, (semi + octave * 12) / 12);
      osc.type = type;
      osc.frequency.setValueAtTime(f, now);
      osc.detune.setValueAtTime((Math.random() - 0.5) * 80, now);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(gainVal, now + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(g);
      g.connect(bus);
      osc.start(now);
      osc.stop(now + dur + 0.02);
      sixSevenFrenzy.oscillators.push(osc);
      if (sixSevenFrenzy.oscillators.length > 50) {
        sixSevenFrenzy.oscillators.splice(0, 25);
      }
    };

    sixSevenFrenzy.timer = window.setInterval(() => {
      if (!sixSevenFrenzy.playing || !sixSevenFrenzy.bus) return;
      const i = sixSevenFrenzy.step;
      const m = melody[i % melody.length];
      const b = bass[i % bass.length];
      const crazy = Math.random() < 0.45;
      beep(m, crazy ? 0.05 : 0.08, crazy ? 0.26 : 0.18, "square", crazy ? 1 : 0);
      beep(b, 0.1, 0.13, "sawtooth", -1);
      if (crazy) {
        beep(m + 6, 0.04, 0.12, "square", 1);
        beep(m - 1, 0.035, 0.08, "triangle", 0);
      }
      if (i % 3 === 0) beep(m + 12, 0.04, 0.09, "square", 0);
      sixSevenFrenzy.step += 1;
    }, stepMs);

    playSixSevenKickPop();
    playSixSevenPipePop();
    sixSevenFrenzy.fxTimer = window.setInterval(() => {
      if (!sixSevenFrenzy.playing) return;
      playSixSevenKickPop();
      if (Math.random() < 0.65) playSixSevenPipePop();
      if (Math.random() < 0.5) {
        window.setTimeout(() => playSixSevenKickPop(), 40 + Math.random() * 70);
      }
    }, 200);
  }

  function stopSixSevenBossMusic() {
    stopSixSevenFrenzy();
  }

  /** Watching: hyper whooshes + chirpy zips. */
  function playSixSevenZoomBurst(intensity = 0) {
    const audio = ensureCtx();
    if (!audio) return;
    const now = audio.currentTime;
    const level = 0.42 + Math.min(20, intensity) * 0.012;
    const out = makeOut(audio, level);
    if (!out) return;

    const zipCount = 2 + Math.min(6, Math.floor(intensity / 3));
    for (let i = 0; i < zipCount; i++) {
      const t0 = now + i * (0.045 - Math.min(0.02, intensity * 0.0008));
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const filter = audio.createBiquadFilter();
      osc.type = i % 2 === 0 ? "sawtooth" : "square";
      const startF = 420 + Math.random() * 280 + intensity * 18;
      const endF = startF * (2.4 + Math.random() * 1.6 + intensity * 0.04);
      osc.frequency.setValueAtTime(startF, t0);
      osc.frequency.exponentialRampToValueAtTime(endF, t0 + 0.09);
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(900 + intensity * 40, t0);
      filter.frequency.exponentialRampToValueAtTime(2800 + intensity * 80, t0 + 0.08);
      filter.Q.value = 2.2;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.28 + Math.random() * 0.12, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(out);
      osc.start(t0);
      osc.stop(t0 + 0.13);
    }

    playNoise(audio, out, {
      seconds: 0.16 + Math.min(0.12, intensity * 0.004),
      freq: 1400 + intensity * 55,
      q: 0.7,
      gain: 0.18 + intensity * 0.006,
      type: "bandpass",
    });

    const skid = audio.createOscillator();
    const skidGain = audio.createGain();
    const skidFilter = audio.createBiquadFilter();
    const skidAt = now + 0.02;
    skid.type = "triangle";
    skid.frequency.setValueAtTime(1600 + intensity * 30, skidAt);
    skid.frequency.exponentialRampToValueAtTime(280 + Math.random() * 80, skidAt + 0.14);
    skidFilter.type = "lowpass";
    skidFilter.frequency.value = 3200;
    skidGain.gain.setValueAtTime(0.0001, skidAt);
    skidGain.gain.exponentialRampToValueAtTime(0.22, skidAt + 0.012);
    skidGain.gain.exponentialRampToValueAtTime(0.0001, skidAt + 0.16);
    skid.connect(skidFilter);
    skidFilter.connect(skidGain);
    skidGain.connect(out);
    skid.start(skidAt);
    skid.stop(skidAt + 0.18);
  }

  /** Pre-load: dissonant glitch chaos — wilder with more loops. */
  function playSixSevenCrazyBurst(intensity = 0) {
    const audio = ensureCtx();
    if (!audio) return;
    const now = audio.currentTime;
    const level = 0.5 + Math.min(20, intensity) * 0.014;
    const out = makeOut(audio, level);
    if (!out) return;

    const hits = 3 + Math.min(8, Math.floor(intensity / 2.5));
    for (let i = 0; i < hits; i++) {
      const t0 = now + i * (0.03 + Math.random() * 0.04);
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const filter = audio.createBiquadFilter();
      const kinds = ["sawtooth", "square", "triangle"];
      osc.type = kinds[i % kinds.length];
      const base = 90 + Math.random() * 1400 + intensity * 25;
      osc.frequency.setValueAtTime(base, t0);
      if (Math.random() < 0.55) {
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(60, base * (0.35 + Math.random() * 2.8)),
          t0 + 0.07 + Math.random() * 0.06
        );
      } else {
        osc.frequency.setValueAtTime(base * (1.5 + Math.random()), t0 + 0.02);
        osc.frequency.setValueAtTime(base * (0.4 + Math.random() * 0.5), t0 + 0.05);
      }
      filter.type = Math.random() < 0.5 ? "bandpass" : "highpass";
      filter.frequency.value = 400 + Math.random() * 4200;
      filter.Q.value = 0.8 + Math.random() * 6;
      const peak = 0.2 + Math.random() * 0.22 + intensity * 0.004;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08 + Math.random() * 0.08);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(out);
      osc.start(t0);
      osc.stop(t0 + 0.2);
    }

    playNoise(audio, out, {
      seconds: 0.08 + Math.random() * 0.1 + intensity * 0.003,
      freq: 800 + Math.random() * 5000,
      q: 0.5 + Math.random() * 2,
      gain: 0.2 + intensity * 0.008,
      type: Math.random() < 0.5 ? "bandpass" : "highpass",
      crackle: true,
    });

    // Random "static slap".
    if (intensity > 0 || Math.random() < 0.7) {
      playNoise(audio, out, {
        seconds: 0.04 + Math.random() * 0.05,
        freq: 2400 + Math.random() * 6000,
        q: 0.4,
        gain: 0.16 + intensity * 0.005,
        type: "highpass",
        delay: Math.random() * 0.08,
        crackle: true,
      });
    }
  }

  function sixSevenBurstForMode(mode, intensity) {
    if (mode === "setup") playSixSevenCrazyBurst(intensity);
    else if (mode === "watch") playSixSevenZoomBurst(intensity);
  }

  /**
   * @param {"off"|"setup"|"watch"} mode
   * @param {number} intensity loop counter 0–20
   */
  function setSixSevenAudio(mode, intensity = 0) {
    const nextMode = mode === "setup" || mode === "watch" ? mode : "off";
    const next = Math.max(0, Math.min(20, Math.round(Number(intensity) || 0)));

    if (nextMode === "off") {
      stopSixSevenAudio();
      return;
    }

    const wantFrenzy = nextMode === "setup" && next >= 20;
    if (wantFrenzy) startSixSevenFrenzy();
    else stopSixSevenFrenzy();

    if (
      sixSevenAudio.mode === nextMode &&
      sixSevenAudio.intensity === next &&
      sixSevenAudio.timer
    ) {
      return;
    }

    const modeChanged = sixSevenAudio.mode !== nextMode;
    if (sixSevenAudio.timer) {
      window.clearInterval(sixSevenAudio.timer);
      sixSevenAudio.timer = 0;
    }

    sixSevenAudio.mode = nextMode;
    sixSevenAudio.intensity = next;
    if (modeChanged) sixSevenBurstForMode(nextMode, next);

    // Pre-load crazy hits come faster; watch zoomies a bit roomier.
    const gap =
      nextMode === "setup"
        ? Math.max(120, 640 - next * 26)
        : Math.max(180, 860 - next * 30);

    sixSevenAudio.timer = window.setInterval(() => {
      sixSevenBurstForMode(sixSevenAudio.mode, sixSevenAudio.intensity);
    }, gap);
  }

  /** @deprecated prefer setSixSevenAudio("watch"|"off", intensity) */
  function setSixSevenZoomies(on, intensity = 0) {
    setSixSevenAudio(on ? "watch" : "off", intensity);
  }

  /**
   * Crowd chanting "6-7!" — intensity 0–1 controls how many people + how often.
   * Used while approaching CH 8's finale message, then full blast on the kill sting.
   */
  let sixSevenCrowd = {
    active: false,
    timer: 0,
    intensity: 0,
    gapMs: 0,
  };

  function stopSixSevenCrowdChant() {
    sixSevenCrowd.active = false;
    sixSevenCrowd.intensity = 0;
    sixSevenCrowd.gapMs = 0;
    if (sixSevenCrowd.timer) {
      window.clearInterval(sixSevenCrowd.timer);
      sixSevenCrowd.timer = 0;
    }
    try {
      window.speechSynthesis?.cancel?.();
    } catch {
      /* ignore */
    }
  }

  /** One person talking — two-syllable "six / seven" bed that can stack. */
  function playCrowdTalker(audio, out, t, delay) {
    const now = audio.currentTime + delay;
    const dur = 0.2 + Math.random() * 0.34;
    const f0 = 85 + Math.random() * 240;
    const osc = audio.createOscillator();
    osc.type = Math.random() < 0.5 ? "sawtooth" : "square";
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.setValueAtTime(f0 * (0.92 + Math.random() * 0.08), now + dur * 0.28);
    osc.frequency.setValueAtTime(f0 * (1.08 + Math.random() * 0.22), now + dur * 0.52);

    const formant = audio.createBiquadFilter();
    formant.type = "bandpass";
    formant.Q.value = 2.4 + Math.random() * 3.2;
    formant.frequency.setValueAtTime(420 + Math.random() * 380, now);
    formant.frequency.setValueAtTime(780 + Math.random() * 640, now + dur * 0.45);

    const air = audio.createBiquadFilter();
    air.type = "highpass";
    air.frequency.value = 180 + Math.random() * 90;

    const g = audio.createGain();
    const amp = 0.035 + t * 0.11 + Math.random() * 0.04 * t;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(amp, now + 0.018);
    g.gain.exponentialRampToValueAtTime(amp * 0.7, now + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(formant);
    formant.connect(air);
    air.connect(g);
    g.connect(out);
    osc.start(now);
    osc.stop(now + dur + 0.03);
  }

  function playSixSevenCrowdBurst() {
    if (!sixSevenCrowd.active) return;
    const t = Math.max(0, Math.min(1, sixSevenCrowd.intensity || 0));
    if (t <= 0.02) return;

    const audio = ensureCtx();
    const out = audio ? makeOut(audio, 0.38 + t * 0.42) : null;
    if (out) {
      // SpeechSynthesis queues — these talkers actually overlap.
      const talkers = Math.max(1, Math.round(1 + t * 16 + Math.random() * (1 + t * 6)));
      const windowSec = Math.max(0.04, 0.42 - t * 0.34);
      for (let i = 0; i < talkers; i++) {
        playCrowdTalker(audio, out, t, Math.random() * windowSec);
      }
    }

    if (!window.speechSynthesis) return;
    const phrases = ["6-7!", "six seven!", "6 7!", "SIX SEVEN!", "six! seven!", "6-7!"];
    const voices = window.speechSynthesis.getVoices?.() || [];
    const spoken = Math.max(0, Math.round(t * 4 + Math.random() * t * 2));
    for (let i = 0; i < spoken; i++) {
      const utter = new SpeechSynthesisUtterance(phrases[i % phrases.length]);
      utter.rate = 0.9 + Math.random() * 0.7;
      utter.pitch = 0.35 + Math.random() * 1.55;
      utter.volume = Math.max(
        0.06,
        Math.min(1, masterGain() * (0.1 + t * 0.45 + Math.random() * 0.22 * t))
      );
      if (voices.length) {
        utter.voice = voices[Math.floor(Math.random() * voices.length)];
      }
      const delay = i * (6 + (1 - t) * 28);
      window.setTimeout(() => {
        if (!sixSevenCrowd.active) return;
        try {
          window.speechSynthesis.speak(utter);
        } catch {
          /* ignore */
        }
      }, delay);
    }
  }

  /**
   * @param {number} intensity 0 = off, 1 = full stadium chant
   */
  function setSixSevenCrowdChant(intensity = 0) {
    const next = Math.max(0, Math.min(1, Number(intensity) || 0));
    if (next <= 0.02) {
      stopSixSevenCrowdChant();
      return;
    }

    const wasActive = sixSevenCrowd.active;
    sixSevenCrowd.intensity = next;
    sixSevenCrowd.active = true;

    // Warm voices list on some browsers.
    try {
      window.speechSynthesis?.getVoices?.();
    } catch {
      /* ignore */
    }

    if (!wasActive) playSixSevenCrowdBurst();

    // Closer to 6-7 → bursts stack on top of each other.
    const gap = Math.round(1500 - next * 1180); // ~1500ms → ~320ms
    if (!sixSevenCrowd.timer || Math.abs(gap - sixSevenCrowd.gapMs) > 60) {
      if (sixSevenCrowd.timer) {
        window.clearInterval(sixSevenCrowd.timer);
        sixSevenCrowd.timer = 0;
      }
      sixSevenCrowd.gapMs = gap;
      sixSevenCrowd.timer = window.setInterval(() => {
        if (!sixSevenCrowd.active) return;
        playSixSevenCrowdBurst();
      }, gap);
    }
  }

  function startSixSevenCrowdChant() {
    setSixSevenCrowdChant(1);
  }

  return {
    playMenuClick,
    playForbiddenSteam,
    playForbiddenSteamTail,
    playForbiddenDoors,
    playForbiddenRise,
    startForbiddenSiren,
    fadeForbiddenSiren,
    stopForbiddenSiren,
    playForbiddenTwerk,
    playForbiddenSlam,
    playForbiddenSparks,
    playTreeRustle,
    playTreeCrash,
    playRockCrack,
    playRockBreak,
    playOreDetune,
    playFoodPop,
    playFoodMunch,
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
    speakAdaLine,
    stopAdaSpeech,
    isAdaSpeaking,
    playSixSevenZoomBurst,
    playSixSevenCrazyBurst,
    setSixSevenAudio,
    setSixSevenZoomies,
    stopSixSevenZoomies,
    stopSixSevenAudio,
    startOminousMusic,
    stopOminousMusic,
    startEtherealMusic,
    stopEtherealMusic,
    startSixSevenBossMusic,
    stopSixSevenBossMusic,
    setSixSevenCrowdChant,
    startSixSevenCrowdChant,
    stopSixSevenCrowdChant,
  };
})();
