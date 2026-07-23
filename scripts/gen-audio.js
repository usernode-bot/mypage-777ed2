// Generates the MyPage royalty-free music library: original synthesized
// loops (lofi / chiptune / ambient), written as 16-bit mono WAV files into
// public/audio/library/. Run once (node scripts/gen-audio.js) and commit
// the output — the app serves the committed files, it never runs this.
// All material is generated here from scratch: original, CC0.
'use strict';
const fs = require('fs');
const path = require('path');

const SR = 22050;
const OUT = path.join(__dirname, '..', 'public', 'audio', 'library');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

function addNote(buf, tSec, durSec, freq, o = {}) {
  const wave = o.wave || 'sine';
  const gain = o.gain ?? 0.18;
  const attack = o.attack ?? 0.012;
  const release = o.release ?? 0.12;
  const detune = o.detune ?? 0;
  const start = Math.floor(tSec * SR);
  const n = Math.floor((durSec + release) * SR);
  const f0 = freq * (1 + detune);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let env;
    if (t < attack) env = t / attack;
    else if (t < durSec) env = 1 - 0.35 * ((t - attack) / Math.max(durSec - attack, 1e-6));
    else env = Math.max(0, 1 - (t - durSec) / release) * 0.65;
    const f = f0 + (o.vibrato ? Math.sin(2 * Math.PI * 5 * t) * o.vibrato : 0);
    const ph = 2 * Math.PI * f * t;
    let s;
    if (wave === 'square') s = Math.sign(Math.sin(ph)) * 0.45;
    else if (wave === 'tri') s = (2 / Math.PI) * Math.asin(Math.sin(ph));
    else if (wave === 'saw') s = (2 * ((f * t) % 1) - 1) * 0.5;
    else s = Math.sin(ph);
    const idx = start + i;
    if (idx < buf.length) buf[idx] += s * gain * env;
  }
}

function addChord(buf, t, dur, midis, o) {
  for (const m of midis) addNote(buf, t, dur, midi(m), o);
}

function addKick(buf, tSec, gain = 0.5) {
  const start = Math.floor(tSec * SR);
  const n = Math.floor(0.16 * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 110 * Math.exp(-t * 22) + 38;
    const env = Math.exp(-t * 20);
    const idx = start + i;
    if (idx < buf.length) buf[idx] += Math.sin(2 * Math.PI * f * t) * gain * env;
  }
}

function addHat(buf, tSec, rng, gain = 0.08, dur = 0.03) {
  const start = Math.floor(tSec * SR);
  const n = Math.floor(dur * SR);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const env = Math.exp(-(i / SR) * 90);
    const white = rng() * 2 - 1;
    const hp = white - last; last = white; // crude highpass
    const idx = start + i;
    if (idx < buf.length) buf[idx] += hp * gain * env;
  }
}

function addVinyl(buf, rng, gain = 0.012) {
  let lp = 0;
  for (let i = 0; i < buf.length; i++) {
    const white = rng() * 2 - 1;
    lp = lp * 0.94 + white * 0.06;
    buf[i] += lp * gain;
    if (rng() < 0.00012) buf[i] += (rng() * 2 - 1) * 0.06; // dust crackle
  }
}

function lowpass(buf, alpha) {
  let y = 0;
  for (let i = 0; i < buf.length; i++) { y += alpha * (buf[i] - y); buf[i] = y; }
}

function normalize(buf, peak = 0.82) {
  let max = 0;
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]));
  if (!max) return;
  const k = peak / max;
  for (let i = 0; i < buf.length; i++) buf[i] *= k;
}

function writeWav(file, buf) {
  const n = buf.length;
  const data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22); data.writeUInt32LE(SR, 24); data.writeUInt32LE(SR * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let v = Math.max(-1, Math.min(1, buf[i]));
    data.writeInt16LE((v * 32767) | 0, 44 + i * 2);
  }
  fs.writeFileSync(file, data);
}

// ---------------------------------------------------------------- tracks

function dustAndSundays() { // lofi — 72bpm, Fmaj7 Am7 Dm7 G7, brushed
  const bpm = 72, beat = 60 / bpm, bar = beat * 4, bars = 8;
  const buf = new Float64Array(Math.round(bar * bars * SR));
  const rng = mulberry32(11);
  const chords = [[53, 57, 60, 64], [45, 52, 57, 60], [50, 53, 57, 62], [43, 50, 55, 59]];
  for (let b = 0; b < bars; b++) {
    const c = chords[b % 4];
    addChord(buf, b * bar, bar * 0.96, c, { wave: 'tri', gain: 0.075, attack: 0.25, release: 0.5 });
    addNote(buf, b * bar, bar * 0.9, midi(c[0] - 12), { wave: 'sine', gain: 0.2, attack: 0.05, release: 0.3 });
    addKick(buf, b * bar, 0.4);
    addKick(buf, b * bar + beat * 2.5, 0.3);
    for (let h = 0; h < 4; h++) addHat(buf, b * bar + beat * h + beat / 2, rng, 0.05);
    // sparse melody
    const scale = [60, 62, 64, 65, 67, 69, 72];
    if (b % 2 === 1) {
      addNote(buf, b * bar + beat, beat * 0.8, midi(scale[Math.floor(rng() * 7)]), { wave: 'sine', gain: 0.12, attack: 0.03, release: 0.25, vibrato: 2 });
      addNote(buf, b * bar + beat * 2.5, beat * 0.6, midi(scale[Math.floor(rng() * 7)]), { wave: 'sine', gain: 0.1, attack: 0.03, release: 0.25 });
    }
  }
  addVinyl(buf, mulberry32(7));
  lowpass(buf, 0.35);
  return buf;
}

function starlightArcade() { // chiptune — 126bpm, Am F C G arps
  const bpm = 126, beat = 60 / bpm, bar = beat * 4, bars = 8;
  const buf = new Float64Array(Math.round(bar * bars * SR));
  const rng = mulberry32(23);
  const roots = [57, 53, 48, 55];
  const arps = [[57, 60, 64, 67], [53, 57, 60, 65], [48, 52, 55, 60], [55, 59, 62, 67]];
  for (let b = 0; b < bars; b++) {
    const arp = arps[b % 4];
    for (let s = 0; s < 8; s++) { // 8th-note arpeggio
      const m = arp[s % 4] + (s >= 4 ? 12 : 0);
      addNote(buf, b * bar + s * beat / 2, beat * 0.42, midi(m), { wave: 'square', gain: 0.075, attack: 0.004, release: 0.03 });
    }
    for (let s = 0; s < 4; s++) {
      addNote(buf, b * bar + s * beat, beat * 0.46, midi(roots[b % 4] - 12), { wave: 'tri', gain: 0.2, attack: 0.004, release: 0.03 });
      addHat(buf, b * bar + s * beat + beat / 2, rng, 0.06, 0.02);
    }
    addKick(buf, b * bar, 0.42);
    addKick(buf, b * bar + beat * 2, 0.42);
  }
  return buf;
}

function cloudGarden() { // ambient pads — Cmaj9 Fmaj9 drift
  const seg = 5, segs = 4;
  const buf = new Float64Array(Math.round(seg * segs * SR));
  const chords = [[48, 55, 62, 64], [41, 48, 57, 64], [45, 52, 60, 64], [43, 50, 59, 65]];
  for (let s = 0; s < segs; s++) {
    const c = chords[s % 4];
    for (const m of c) {
      addNote(buf, s * seg, seg * 1.05, midi(m), { wave: 'sine', gain: 0.09, attack: 1.8, release: 2.2 });
      addNote(buf, s * seg, seg * 1.05, midi(m), { wave: 'sine', gain: 0.05, attack: 2.0, release: 2.2, detune: 0.004 });
      addNote(buf, s * seg, seg * 1.05, midi(m + 12), { wave: 'sine', gain: 0.025, attack: 2.4, release: 2.0, detune: -0.003 });
    }
  }
  lowpass(buf, 0.3);
  return buf;
}

function pawPrints() { // cozy plucks — 100bpm pentatonic
  const bpm = 100, beat = 60 / bpm, bar = beat * 4, bars = 8;
  const buf = new Float64Array(Math.round(bar * bars * SR));
  const rng = mulberry32(41);
  const penta = [60, 62, 64, 67, 69, 72, 74];
  const roots = [48, 45, 50, 43];
  for (let b = 0; b < bars; b++) {
    addNote(buf, b * bar, bar * 0.9, midi(roots[b % 4]), { wave: 'tri', gain: 0.16, attack: 0.02, release: 0.3 });
    for (let s = 0; s < 8; s++) {
      if (rng() < 0.62) {
        addNote(buf, b * bar + s * beat / 2, beat * 0.32, midi(penta[Math.floor(rng() * penta.length)]),
          { wave: 'tri', gain: 0.11, attack: 0.003, release: 0.14 });
      }
    }
    addHat(buf, b * bar + beat, rng, 0.045);
    addHat(buf, b * bar + beat * 3, rng, 0.045);
    addKick(buf, b * bar, 0.3);
  }
  lowpass(buf, 0.5);
  return buf;
}

function neonRain() { // vaporwave — 64bpm slow detuned chords
  const bpm = 64, beat = 60 / bpm, bar = beat * 4, bars = 6;
  const buf = new Float64Array(Math.round(bar * bars * SR));
  const rng = mulberry32(87);
  const chords = [[45, 52, 57, 61], [41, 48, 53, 57], [43, 50, 55, 59], [45, 52, 57, 61], [50, 53, 57, 60], [43, 50, 55, 59]];
  for (let b = 0; b < bars; b++) {
    const c = chords[b % chords.length];
    addChord(buf, b * bar, bar * 0.98, c, { wave: 'saw', gain: 0.055, attack: 0.4, release: 0.8, detune: 0.005 });
    addChord(buf, b * bar, bar * 0.98, c, { wave: 'saw', gain: 0.055, attack: 0.45, release: 0.8, detune: -0.005 });
    addNote(buf, b * bar, bar * 0.9, midi(c[0] - 12), { wave: 'sine', gain: 0.22, attack: 0.08, release: 0.5 });
    addKick(buf, b * bar, 0.42);
    addKick(buf, b * bar + beat * 2, 0.34);
    addHat(buf, b * bar + beat * 3 + beat / 2, rng, 0.04);
  }
  lowpass(buf, 0.32);
  return buf;
}

function underConstructionFm() { // bouncy chip — 140bpm
  const bpm = 140, beat = 60 / bpm, bar = beat * 4, bars = 8;
  const buf = new Float64Array(Math.round(bar * bars * SR));
  const rng = mulberry32(5);
  const bass = [48, 48, 53, 55];
  const riff = [72, 76, 79, 76, 72, 79, 76, 72];
  for (let b = 0; b < bars; b++) {
    for (let s = 0; s < 8; s++) {
      addNote(buf, b * bar + s * beat / 2, beat * 0.4, midi(bass[b % 4] - 12 + (s % 2 ? 12 : 0)), { wave: 'tri', gain: 0.17, attack: 0.004, release: 0.03 });
      if (b % 2 === 1 || s % 2 === 0) {
        addNote(buf, b * bar + s * beat / 2, beat * 0.34, midi(riff[(s + b) % 8] + (bass[b % 4] - 48)), { wave: 'square', gain: 0.06, attack: 0.004, release: 0.04 });
      }
      addHat(buf, b * bar + s * beat / 2, rng, s % 2 ? 0.05 : 0.028, 0.018);
    }
    addKick(buf, b * bar, 0.4);
    addKick(buf, b * bar + beat * 1.5, 0.28);
    addKick(buf, b * bar + beat * 2.5, 0.36);
  }
  return buf;
}

const TRACKS = [
  ['dust-and-sundays', dustAndSundays],
  ['starlight-arcade', starlightArcade],
  ['cloud-garden', cloudGarden],
  ['paw-prints', pawPrints],
  ['neon-rain', neonRain],
  ['under-construction', underConstructionFm],
];

fs.mkdirSync(OUT, { recursive: true });
for (const [name, fn] of TRACKS) {
  const buf = fn();
  normalize(buf);
  const file = path.join(OUT, name + '.wav');
  writeWav(file, buf);
  console.log(name, (fs.statSync(file).size / 1024 / 1024).toFixed(2) + 'MB', (buf.length / SR).toFixed(1) + 's');
}
