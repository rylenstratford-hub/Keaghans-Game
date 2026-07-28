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

    // Coal, iron, copper: stone cracks while mining; break + detuned ore on destroy
    if (nodeType === "coal" || nodeType === "iron" || nodeType === "copper") {
      if (destroyed) playRockBreakWithOre();
      else playRockCrack();
    }
  }

  return {
    playMenuClick,
    playTreeRustle,
    playTreeCrash,
    playRockCrack,
    playRockBreak,
    playOreDetune,
    playHarvest,
    ensureCtx,
  };
})();
