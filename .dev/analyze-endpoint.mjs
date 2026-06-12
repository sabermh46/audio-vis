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
check('health reports ml status', ['ready', 'cold', 'unavailable'].includes(health.ml), health.ml);

const wav = fs.readFileSync(path.resolve('.dev/test.wav'));
const post = async (query = '') => {
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'test.wav');
  return fetch(`${BASE}/analyze${query}`, { method: 'POST', body: form });
};

// --- Fast DSP-only path ---
const res = await post('?ml=0');
check('analyze?ml=0 200', res.ok, `status ${res.status}`);
const json = await res.json();
check('ml=0 returns ml:false without stems', json.ml === false && !('stems' in json));

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

// --- ML path (model may load on first call — generous budget) ---
console.log('\nrunning ML analysis (first call loads the model, can take minutes)…');
let t0 = Date.now();
const mlRes = await post();
console.log(`ml analyze took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
check('analyze (ml) 200', mlRes.ok, `status ${mlRes.status}`);
const ml = await mlRes.json();
check('ml:true with model name', ml.ml === true && ml.mlModel === 'htdemucs',
  `ml=${ml.ml} model=${ml.mlModel}`);
check('beats from drums stem', ml.beatsSource === 'drums', ml.beatsSource);

const stemNames = ['vocals', 'drums', 'bass', 'other'];
check('4 stems present', stemNames.every((s) => s in (ml.stems ?? {})));
const stems = Object.fromEntries(stemNames.map((s) => [s, b64ToU8(ml.stems[s])]));
check('stem track lengths == frames', stemNames.every((s) => stems[s].length === ml.frames));
check('drums onset present', !!ml.stemsOnset?.drums);

const segMl = (track, a, b) => {
  const lo = Math.floor(a * ml.fps);
  const hi = Math.floor(b * ml.fps);
  let sum = 0;
  for (let i = lo; i < hi; i++) sum += track[i];
  return sum / (hi - lo) / 255;
};
check('bass stem hot during 60Hz tone', segMl(stems.bass, 0.2, 2.8) > 0.5,
  segMl(stems.bass, 0.2, 2.8).toFixed(2));
check('drums stem: clicks > 60Hz leak',
  segMl(stems.drums, 6.2, 9.8) > segMl(stems.drums, 0.2, 2.8),
  `clicks=${segMl(stems.drums, 6.2, 9.8).toFixed(2)} 60Hz=${segMl(stems.drums, 0.2, 2.8).toFixed(2)}`);
const mlClickBeats = ml.beats.filter((t) => t >= 6 && t <= 10);
check('≥4 drums-derived beats in click segment', mlClickBeats.length >= 4, `${mlClickBeats.length}`);

// --- Cache: identical bytes must return fast ---
t0 = Date.now();
const cachedRes = await post();
const cachedMs = Date.now() - t0;
const cached = await cachedRes.json();
check('cached re-POST is fast (<2s)', cachedMs < 2000, `${cachedMs}ms`);
check('cached result identical ml flag', cached.ml === true && cached.frames === ml.frames);

if (failures.length) {
  console.log(`\n${failures.length} failures`);
  process.exit(1);
}
console.log('\nALL ENDPOINT CHECKS PASSED');
