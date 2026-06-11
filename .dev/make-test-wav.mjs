// Generates .dev/test.wav: 10s mono 44.1kHz — 3s of 60Hz bass tone,
// 3s of 8kHz treble tone, then 4s of 120 BPM click bursts (for beat/tempo
// assertions). Used by playback.mjs / analyze-endpoint.mjs / precomputed.mjs.
import fs from 'node:fs';

const SR = 44100;
const SECONDS = 10;
const n = SR * SECONDS;
const data = new Int16Array(n);

let noiseSeed = 1;
const noise = () => {
  // Deterministic LCG noise so the file is identical across runs.
  noiseSeed = (noiseSeed * 48271) % 2147483647;
  return noiseSeed / 2147483647 - 0.5;
};

for (let i = 0; i < n; i++) {
  const t = i / SR;
  let sample;
  if (t < 3) {
    sample = Math.sin(2 * Math.PI * 60 * t) * 0.8;
  } else if (t < 6) {
    sample = Math.sin(2 * Math.PI * 8000 * t) * 0.8;
  } else {
    // 120 BPM = a click every 0.5s: 30ms decaying noise bursts.
    const sinceClick = (t - 6) % 0.5;
    sample = sinceClick < 0.03 ? noise() * (1 - sinceClick / 0.03) * 1.6 : 0;
  }
  data[i] = Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + n * 2, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);        // PCM
header.writeUInt16LE(1, 22);        // mono
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 2, 28);   // byte rate
header.writeUInt16LE(2, 32);        // block align
header.writeUInt16LE(16, 34);       // bits per sample
header.write('data', 36);
header.writeUInt32LE(n * 2, 40);

fs.writeFileSync(new URL('./test.wav', import.meta.url), Buffer.concat([header, Buffer.from(data.buffer)]));
console.log('wrote test.wav');
