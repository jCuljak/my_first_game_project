// Everything here is synthesised at runtime with the Web Audio API.
// There are no audio files in this project.

const GameAudio = (() => {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let sfxGain = null;
  let noiseBuffer = null;

  let muted = false;
  let playing = false;
  let timerId = null;
  let nextStepTime = 0;
  let step = 0;

  const BASE_BPM = 128;
  let bpm = BASE_BPM;
  let level = 0;
  let slowed = false;
  // Slow-mo drags the loop down with it, which sells the effect harder than
  // any visual tint does.
  const stepDuration = () => 60 / (slowed ? bpm * 0.7 : bpm) / 4;
  const LOOKAHEAD = 0.12; // seconds of audio scheduled ahead of the clock
  const TICK = 25; // ms between scheduler wake-ups

  // Two bars of sixteenths. Electro-hop feel: driving four-on-the-floor with a
  // syncopated kick pushing against an offbeat hat.
  const KICK = [0, 4, 7, 8, 12, 16, 20, 23, 24, 28];
  const CLAP = [4, 12, 20, 28];
  const EXTRA_KICK = [2, 10, 18, 26];

  const A1 = 55.0;
  const G1 = 48.99;
  const C2 = 65.41;
  const D2 = 73.42;
  const E2 = 82.41;

  const BASS = [
    A1, null, A1, null, null, A1, null, A1,
    C2, null, C2, null, null, C2, null, null,
    G1, null, G1, null, null, G1, null, G1,
    D2, null, D2, null, E2, null, E2, null,
  ];

  // Sparse stabs an octave up so the loop has an accent to lean on.
  const LEAD = {
    6: 659.25, 7: 523.25, 14: 440.0, 22: 659.25, 23: 587.33, 30: 523.25,
  };

  function init() {
    if (ctx) {
      // Browsers suspend the context until a user gesture; a keypress is one.
      if (ctx.state === "suspended") ctx.resume();
      return;
    }

    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;

    ctx = new Ctor();

    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);

    musicGain = ctx.createGain();
    musicGain.gain.value = 0.34;
    musicGain.connect(master);

    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.5;
    sfxGain.connect(master);

    const frames = ctx.sampleRate;
    noiseBuffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  }

  function noise() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    return src;
  }

  // Gain envelopes ramp to 0.0001 rather than 0 because exponential ramps
  // cannot reach zero, and a linear cut to zero clicks.
  function env(gain, t, peak, attack, decay) {
    gain.setValueAtTime(0.0001, t);
    gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.exponentialRampToValueAtTime(0.0001, t + decay);
  }

  function kick(t) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(155, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    env(g.gain, t, 0.9, 0.005, 0.3);
    o.connect(g);
    g.connect(musicGain);
    o.start(t);
    o.stop(t + 0.32);
  }

  function clap(t) {
    const n = noise();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    f.type = "bandpass";
    f.frequency.value = 1800;
    f.Q.value = 1.2;
    env(g.gain, t, 0.42, 0.004, 0.17);
    n.connect(f);
    f.connect(g);
    g.connect(musicGain);
    n.start(t);
    n.stop(t + 0.2);
  }

  function hat(t) {
    const n = noise();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    f.type = "highpass";
    f.frequency.value = 7600;
    env(g.gain, t, 0.16, 0.003, 0.045);
    n.connect(f);
    f.connect(g);
    g.connect(musicGain);
    n.start(t);
    n.stop(t + 0.06);
  }

  function bass(t, freq) {
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(260, t + 0.16);
    f.Q.value = 6;
    env(g.gain, t, 0.3, 0.008, 0.2);
    f.connect(g);
    g.connect(musicGain);

    // Two slightly detuned saws read as one fat synth bass.
    for (const cents of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq;
      o.detune.value = cents;
      o.connect(f);
      o.start(t);
      o.stop(t + 0.24);
    }
  }

  function lead(t, freq) {
    const o = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = freq;
    f.type = "lowpass";
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(900, t + 0.14);
    env(g.gain, t, 0.11, 0.006, 0.15);
    o.connect(f);
    f.connect(g);
    g.connect(musicGain);
    o.start(t);
    o.stop(t + 0.18);
  }

  function scheduleStep(i, t) {
    if (KICK.includes(i)) kick(t);
    if (CLAP.includes(i)) clap(t);
    if (i % 2 === 1) hat(t);

    // Extra layers stack with the level so later minutes read as denser, not
    // merely faster. Tempo alone stops being noticeable after a few steps.
    if (level >= 3 && i % 2 === 0) hat(t);
    if (level >= 6 && EXTRA_KICK.includes(i)) kick(t);

    if (BASS[i]) bass(t, BASS[i]);
    if (LEAD[i]) lead(t, LEAD[i]);
  }

  function scheduler() {
    while (nextStepTime < ctx.currentTime + LOOKAHEAD) {
      scheduleStep(step, nextStepTime);
      nextStepTime += stepDuration();
      step = (step + 1) % 32;
    }
  }

  function startMusic() {
    if (!ctx || playing) return;
    playing = true;
    step = 0;
    nextStepTime = ctx.currentTime + 0.08;
    timerId = setInterval(scheduler, TICK);
  }

  function stopMusic() {
    if (!playing) return;
    playing = false;
    clearInterval(timerId);
    timerId = null;
  }

  function warn() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.setValueAtTime(880, t);
    env(g.gain, t, 0.12, 0.005, 0.1);
    o.connect(g);
    g.connect(sfxGain);
    o.start(t);
    o.stop(t + 0.12);
  }

  function zap() {
    if (!ctx) return;
    const t = ctx.currentTime;

    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(2400, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.22);
    env(og.gain, t, 0.32, 0.006, 0.26);
    o.connect(og);
    og.connect(sfxGain);
    o.start(t);
    o.stop(t + 0.28);

    const n = noise();
    const f = ctx.createBiquadFilter();
    const ng = ctx.createGain();
    f.type = "highpass";
    f.frequency.value = 1200;
    env(ng.gain, t, 0.26, 0.004, 0.18);
    n.connect(f);
    f.connect(ng);
    ng.connect(sfxGain);
    n.start(t);
    n.stop(t + 0.2);
  }

  function gameOver() {
    if (!ctx) return;
    const t = ctx.currentTime;

    for (const cents of [0, 9]) {
      const o = ctx.createOscillator();
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      o.type = "sawtooth";
      o.detune.value = cents;
      o.frequency.setValueAtTime(330, t);
      o.frequency.exponentialRampToValueAtTime(46, t + 0.9);
      f.type = "lowpass";
      f.frequency.setValueAtTime(2400, t);
      f.frequency.exponentialRampToValueAtTime(300, t + 0.9);
      env(g.gain, t, 0.34, 0.02, 1.0);
      o.connect(f);
      f.connect(g);
      g.connect(sfxGain);
      o.start(t);
      o.stop(t + 1.05);
    }
  }

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 1;
    return muted;
  }

  function isMuted() {
    return muted;
  }


  // Each difficulty step raises the tempo. 4 BPM a step reaches 176 at the
  // final level: clearly faster, still danceable rather than a buzz. The
  // layers added in scheduleStep carry the rest of the intensity.
  function setLevel(next) {
    level = Math.min(Math.max(next, 0), 12);
    // 2 BPM/level tops out at 152 rather than the previous 176 — still a
    // clear climb, but it no longer runs away by the late levels.
    bpm = BASE_BPM + level * 2;
  }

  // Three rising notes, so a level-up is audible even with the flash missed.
  function levelUp() {
    if (!ctx) return;
    const t = ctx.currentTime;

    [523.25, 659.25, 880.0].forEach((freq, i) => {
      const at = t + i * 0.075;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = freq;
      env(g.gain, at, 0.2, 0.006, 0.13);
      o.connect(g);
      g.connect(sfxGain);
      o.start(at);
      o.stop(at + 0.16);
    });
  }

  function burst() {
    if (!ctx) return;
    const t = ctx.currentTime;

    const n = noise();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    f.type = "lowpass";
    f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(320, t + 0.3);
    env(g.gain, t, 0.32, 0.005, 0.34);
    n.connect(f);
    f.connect(g);
    g.connect(sfxGain);
    n.start(t);
    n.stop(t + 0.36);

    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.25);
    env(og.gain, t, 0.28, 0.005, 0.28);
    o.connect(og);
    og.connect(sfxGain);
    o.start(t);
    o.stop(t + 0.3);
  }

  function dash() {
    if (!ctx) return;
    const t = ctx.currentTime;

    const n = noise();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    f.type = "bandpass";
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(4200, t + 0.16);
    f.Q.value = 2;
    env(g.gain, t, 0.22, 0.006, 0.2);
    n.connect(f);
    f.connect(g);
    g.connect(sfxGain);
    n.start(t);
    n.stop(t + 0.22);
  }

  function setSlow(on) {
    slowed = on;
  }

  // Health rises through a major triad; slow-mo falls, which is the whole
  // point of it. Two cues you can tell apart without looking.
  function pickup(kind) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes = kind === "health" ? [523.25, 783.99, 1046.5] : [880.0, 587.33, 440.0];

    notes.forEach((freq, i) => {
      const at = t + i * 0.06;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = kind === "health" ? "triangle" : "sine";
      o.frequency.value = freq;
      env(g.gain, at, 0.24, 0.005, 0.16);
      o.connect(g);
      g.connect(sfxGain);
      o.start(at);
      o.stop(at + 0.2);
    });
  }

  // Losing a life, as distinct from losing the run: shorter, less final.
  function hurt() {
    if (!ctx) return;
    const t = ctx.currentTime;

    const o = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.28);
    f.type = "lowpass";
    f.frequency.value = 1400;
    env(g.gain, t, 0.3, 0.005, 0.3);
    o.connect(f);
    f.connect(g);
    g.connect(sfxGain);
    o.start(t);
    o.stop(t + 0.32);

    const n = noise();
    const ng = ctx.createGain();
    env(ng.gain, t, 0.2, 0.004, 0.14);
    n.connect(ng);
    ng.connect(sfxGain);
    n.start(t);
    n.stop(t + 0.16);
  }

  return {
    init, startMusic, stopMusic, setLevel, levelUp, setSlow,
    warn, zap, burst, dash, pickup, hurt, gameOver,
    toggleMute, isMuted,
  };
})();
