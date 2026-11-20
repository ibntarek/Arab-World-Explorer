/* =====================================================================
   audio.js — Sound effects generated with the Web Audio API.
   • No audio files needed (works offline).
   • The AudioContext is only created after the first user gesture.
   • Sound on/off + volume are remembered in localStorage.
   ===================================================================== */
'use strict';

const Sound = (() => {
  let ctx = null, master = null, noiseBuf = null;
  const st = { on: true, vol: 0.7 };

  // --- persistent settings (safe: localStorage may be blocked) ---
  try {
    const s = JSON.parse(localStorage.getItem('awe.sound') || 'null');
    if (s) { st.on = s.on !== false; st.vol = typeof s.vol === 'number' ? s.vol : 0.7; }
  } catch (e) { /* ignore */ }
  const save = () => { try { localStorage.setItem('awe.sound', JSON.stringify(st)); } catch (e) { /* ignore */ } };

  /** Must be called from a user gesture (click/touch) */
  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = st.on ? st.vol : 0;
      master.connect(ctx.destination);
      // short white-noise buffer for "whoosh"
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }
  const applyGain = () => { if (master) master.gain.setTargetAtTime(st.on ? st.vol : 0, ctx.currentTime, 0.02); };

  /** one note */
  function tone(freq, dur, { type = 'sine', vol = 0.3, delay = 0, slide = 0, attack = 0.01 } = {}) {
    if (!ctx || !st.on) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(dur, f0, f1, vol = 0.18, delay = 0) {
    if (!ctx || !st.on) return;
    const t0 = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t0); s.stop(t0 + dur + 0.05);
  }
  const N = { C4: 262, D4: 294, E4: 330, F4: 349, G4: 392, A4: 440, B4: 494, C5: 523, D5: 587, E5: 659, F5: 698, G5: 784, A5: 880, B5: 988, C6: 1047, E6: 1319, G6: 1568 };

  const fx = {
    click()   { tone(880, 0.07, { type: 'triangle', vol: 0.22 }); },
    select()  { tone(N.E5, 0.08, { vol: 0.2 }); tone(N.A5, 0.12, { vol: 0.2, delay: 0.06 }); },
    pick()    { tone(520, 0.06, { type: 'triangle', vol: 0.16 }); },
    drop()    { tone(300, 0.08, { type: 'sine', vol: 0.18, slide: -80 }); },
    correct() { [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone(f, 0.16, { type: 'triangle', vol: 0.26, delay: i * 0.075 })); tone(N.E6, 0.3, { vol: 0.12, delay: 0.3 }); },
    wrong()   { tone(330, 0.16, { type: 'sine', vol: 0.2, slide: -50 }); tone(262, 0.28, { type: 'sine', vol: 0.18, delay: 0.14, slide: -40 }); },
    hint()    { tone(N.G5, 0.1, { vol: 0.16 }); tone(N.G5, 0.14, { vol: 0.16, delay: 0.14 }); },
    whoosh()  { noise(0.35, 300, 2600, 0.16); },
    welcome() { [N.A4, N.C5, N.E5, N.A5].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.26, delay: i * 0.1 })); tone(N.E6, 0.5, { vol: 0.14, delay: 0.42 }); },
    complete(){ [N.C5, N.E5, N.G5, N.C6, N.E6].forEach((f, i) => tone(f, i === 4 ? 0.5 : 0.17, { type: 'triangle', vol: 0.28, delay: i * 0.11 })); },
    win()     {
      const mel = [N.G4, N.C5, N.E5, N.G5, N.E5, N.G5, N.C6, N.E6];
      mel.forEach((f, i) => { tone(f, 0.2, { type: 'triangle', vol: 0.28, delay: i * 0.13 }); tone(f / 2, 0.2, { type: 'sine', vol: 0.1, delay: i * 0.13 }); });
      tone(N.G6, 0.7, { vol: 0.16, delay: mel.length * 0.13 }); noise(0.5, 2000, 6000, 0.05, mel.length * 0.13);
    }
  };

  return {
    state: st,
    unlock,
    play(name) { if (!unlock()) return; if (fx[name]) fx[name](); },
    setOn(v) { st.on = !!v; save(); if (v) unlock(); applyGain(); },
    toggle() { this.setOn(!st.on); return st.on; },
    setVol(v) { st.vol = Math.max(0, Math.min(1, v)); save(); applyGain(); }
  };
})();
