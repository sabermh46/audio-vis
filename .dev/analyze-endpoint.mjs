// Direct test of POST /analyze with Node fetch. Requires uvicorn running
// (or run via precomputed.mjs which spawns it).
// Usage: node .dev/analyze-endpoint.mjs
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://127.0.0.1:8765';
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

const health = await fetch(`${BASE}/health`).then((r) => r.json());
check('health ok', health.status === 'ok');

const wav = fs.readFileSync(path.resolve('.dev/test.wav'));
const form = new FormData();
form.append('file', new Blob([wav], { type: 'audio/wav' }), 'test.wav');
const res = await fetch(`${BASE}/analyze`, { method: 'POST', body: form });
check('analyze 200', res.ok, `status ${res.status}`);
const json = await res.json();

check('schema fields', ['version', 'duration', 'fps', 'frames', 'numBars', 'bars', 'bands',
  'harmonic', 'percussive', 'onset', 'rms', 'beats', 'tempo']
  .every((k) => k in json));
check('fps exact', Math.abs(json.fps - 44100 / 1024) < 1e-9, String(json.fps));
check('frames ≈ duration*fps', Math.abs(json.frames - json.duration * json.fps) < 3,
  `${json.frames} vs ${(json.duration * json.fps).toFixed(1)}`);
check('numBars 64', json.numBars === 64);

const b64ToU8 = (b64) => Uint8Array.from(Buffer.from(b64, 'base64'));
const bands = {
  bass: b64ToU8(json.bands.bass),
  treble: b64ToU8(json.bands.treble),
};
check('bars byte length', b64ToU8(json.bars).length === json.frames * 64);

const seg = (track, a, b) => {
  const lo = Math.floor(a * json.fps);
  const hi = Math.floor(b * json.fps);
  let sum = 0;
  for (let i = lo; i < hi; i++) sum += track[i];
  return sum / (hi - lo) / 255;
};
check('bass hot only in 60Hz segment',
  seg(bands.bass, 0.2, 2.8) > 0.6 && seg(bands.bass, 3.2, 5.8) < 0.1,
  `60Hz=${seg(bands.bass, 0.2, 2.8).toFixed(2)} 8kHz=${seg(bands.bass, 3.2, 5.8).toFixed(2)}`);
check('treble hot only in 8kHz segment',
  seg(bands.treble, 3.2, 5.8) > 0.6 && seg(bands.treble, 0.2, 2.8) < 0.1,
  `60Hz=${seg(bands.treble, 0.2, 2.8).toFixed(2)} 8kHz=${seg(bands.treble, 3.2, 5.8).toFixed(2)}`);

const clickBeats = json.beats.filter((t) => t >= 6 && t <= 10);
check('≥4 beats in click segment', clickBeats.length >= 4, `${clickBeats.length} beats`);
check('tempo near 120', json.tempo > 100 && json.tempo < 140, String(json.tempo));

if (failures.length) {
  console.log(`\n${failures.length} failures`);
  process.exit(1);
}
console.log('\nALL ENDPOINT CHECKS PASSED');
