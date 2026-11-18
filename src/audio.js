// All sound is synthesised: no audio files to download.

export function createAudio() {
  const A = { muted: false, ready: false, mode: "ev" };
  let ctx, master, eng, others = [], skid, wind, noiseBuf;

  function engineVoice(pan) {
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(), p = ctx.createStereoPanner();
    o1.type = "triangle"; o2.type = "sine"; f.type = "lowpass"; f.Q.value = 1; g.gain.value = 0;
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    o1.connect(f); o2.connect(g2); g2.connect(f); f.connect(g); g.connect(p); p.connect(master); p.pan.value = pan || 0;
    o1.start(); o2.start();
    return { o1, o2, g, f, p };
  }
  // GT: electric motor whine rising with speed. Formula: turbo V6, pitch follows rpm through the gears.
  function setVoice(v, speed, thr, vol, rpm) {
    const t = ctx.currentTime;
    if (A.mode === "v6") {
      const f = 95 + (rpm ?? Math.min(1, speed / 92)) * 330;
      v.o1.type = "sawtooth"; v.o2.type = "square";
      v.o1.frequency.setTargetAtTime(f, t, 0.012); v.o2.frequency.setTargetAtTime(f * 0.5, t, 0.012);
      v.f.frequency.setTargetAtTime(700 + (rpm ?? 0.5) * 3200 * (0.45 + 0.55 * thr), t, 0.03);
      v.g.gain.setTargetAtTime(vol * 1.15 * (0.3 + 0.7 * thr), t, 0.03);
    } else {
      const base = 140 + speed * 21;
      v.o1.type = "triangle"; v.o2.type = "sine";
      v.o1.frequency.setTargetAtTime(base, t, 0.04); v.o2.frequency.setTargetAtTime(base * 2.01, t, 0.04);
      v.f.frequency.setTargetAtTime(900 + speed * 40, t, 0.05);
      v.g.gain.setTargetAtTime(vol * (0.25 + 0.75 * thr) * (0.5 + Math.min(1, speed / 60) * 0.5), t, 0.06);
    }
  }
  function noiseLoop(type, freq, q) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(master); s.start();
    return { g, f };
  }

  A.init = function () {
    if (A.ready) { ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC(); master = ctx.createGain(); master.gain.value = A.muted ? 0 : 0.5;
    const comp = ctx.createDynamicsCompressor(); master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    eng = engineVoice(0); others = [engineVoice(-0.5), engineVoice(0.5), engineVoice(0)];
    skid = noiseLoop("bandpass", 1900, 6); wind = noiseLoop("lowpass", 500, 0.5);
    A.ready = true;
  };
  A.setMuted = function (m) { A.muted = m; if (A.ready) master.gain.setTargetAtTime(m ? 0 : 0.5, ctx.currentTime, 0.02); };

  // me: {speed, thr, slip, boosting} | null ; near: [{d, speed, thr, pan}]
  A.frame = function (me, near) {
    if (!A.ready) return;
    const t = ctx.currentTime;
    if (me) {
      setVoice(eng, me.speed, me.thr, 0.09, me.rpm);
      skid.g.gain.setTargetAtTime(Math.min(0.16, Math.max(0, me.slip - 0.25) * 0.2), t, 0.04);
      wind.g.gain.setTargetAtTime(Math.min(0.3, me.speed / 95 * 0.26), t, 0.1); wind.f.frequency.setTargetAtTime(300 + me.speed * 14, t, 0.1);
    } else { eng.g.gain.setTargetAtTime(0, t, 0.1); skid.g.gain.setTargetAtTime(0, t, 0.1); wind.g.gain.setTargetAtTime(0, t, 0.1); }
    for (let i = 0; i < others.length; i++) {
      const o = near && near[i];
      if (o) { setVoice(others[i], o.speed * (1 + o.dop * 0.05), o.thr, 0.075 / (1 + o.d * o.d / 500)); others[i].p.pan.setTargetAtTime(o.pan, t, 0.05); }
      else others[i].g.gain.setTargetAtTime(0, t, 0.1);
    }
  };

  function tone(freq, dur, type = "sine", vol = 0.2, when = 0, slide = 0) {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + when;
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function burst(dur, freq, vol, slide = 1) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; const f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime;
    f.type = "bandpass"; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(freq * slide, t + dur); f.Q.value = 1.2;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  const FX = {
    light: () => tone(440, 0.16, "square", 0.12),
    go: () => { tone(880, 0.55, "square", 0.16); tone(1320, 0.5, "sine", 0.1); },
    click: () => tone(660, 0.05, "triangle", 0.1),
    boost: () => burst(0.7, 500, 0.3, 6),
    pad: () => { burst(0.4, 900, 0.25, 4); tone(520, 0.25, "sawtooth", 0.08, 0, 2.2); },
    bump: (a = 1) => { burst(0.14, 160, 0.5 * a, 0.5); tone(90, 0.12, "sine", 0.3 * a, 0, 0.5); },
    lap: () => [660, 880, 1100].forEach((f, i) => tone(f, 0.16, "triangle", 0.13, i * 0.08)),
    best: () => [660, 880, 1100, 1320, 1760].forEach((f, i) => tone(f, 0.2, "triangle", 0.15, i * 0.07)),
    pass: () => { tone(740, 0.08, "triangle", 0.13); tone(1110, 0.14, "triangle", 0.13, 0.07); },
    lost: () => tone(300, 0.18, "triangle", 0.1, 0, 0.7),
    win: () => [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, 0.28, "triangle", 0.16, i * 0.12)),
    finish: () => [523, 659, 784].forEach((f, i) => tone(f, 0.3, "triangle", 0.14, i * 0.12)),
    fall: () => tone(700, 0.9, "sine", 0.14, 0, 0.15),
    emote: () => tone(990, 0.07, "sine", 0.1),
    splash: () => burst(0.35, 1400, 0.2, 0.4),
    crash: (a = 1) => { burst(0.5, 260, 0.7 * a, 0.3); burst(0.25, 2600, 0.35 * a, 0.5); tone(70, 0.3, "sine", 0.45 * a, 0, 0.4); },
    part: () => { burst(0.18, 3200, 0.3, 0.6); tone(1400, 0.12, "triangle", 0.08, 0.02, 0.5); },
    rc: () => { tone(1046, 0.09, "square", 0.08); tone(1318, 0.12, "square", 0.08, 0.1); },
    shift: () => burst(0.06, 1800, 0.18, 0.4),
    drs: () => burst(0.12, 2400, 0.12, 1.8),
    flap: () => { burst(0.16, 3200, 0.14, 0.45); tone(220, 0.08, "square", 0.04, 0.03, 1.6); },
  };
  A.fx = function (name, a) { if (!A.ready || A.muted) return; try { FX[name]?.(a); } catch {} };
  return A;
}
