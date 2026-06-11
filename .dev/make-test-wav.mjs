// Generates .dev/test.wav: 6s mono 44.1kHz — first 3s a 60Hz bass tone,
// last 3s an 8kHz treble tone. Used by playback.mjs to verify band separation.
import fs from 'node:fs';

const SR = 44100;
const SECONDS = 6;
const n = SR * SECONDS;
const data = new Int16Array(n);

for (let i = 0; i < n; i++) {
  const t = i / SR;
  const freq = t < 3 ? 60 : 8000;
  data[i] = Math.round(Math.sin(2 * Math.PI * freq * t) * 0.8 * 32767);
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
