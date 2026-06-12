// Library endpoint tests (Node fetch). Requires uvicorn running on 8765.
// Usage: node .dev/make-test-wav.mjs && node .dev/library-endpoint.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE = 'http://127.0.0.1:8765';
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

const wav = fs.readFileSync(path.resolve('.dev/test.wav'));
const b64ToU8 = (b64) => Uint8Array.from(Buffer.from(b64, 'base64'));

// Delete any pre-existing entry for this audio (trackId = sha256(original)[:16])
// so the idempotent save doesn't preserve a name from an earlier test run.
const preId = crypto.createHash('sha256').update(wav).digest('hex').slice(0, 16);
await fetch(`${BASE}/library/${preId}`, { method: 'DELETE' }).catch(() => {});

// Process a track (DSP-only for speed) sending BOTH the wav and the "original".
const form = new FormData();
form.append('file', new Blob([wav], { type: 'audio/wav' }), 'upload.wav');
form.append('original', new Blob([wav], { type: 'audio/wav' }), 'library-test.wav');
const analyzeRes = await fetch(`${BASE}/analyze?ml=0`, { method: 'POST', body: form });
check('analyze 200', analyzeRes.ok, `status ${analyzeRes.status}`);
const analysis = await analyzeRes.json();
const id = analysis.trackId;
check('trackId returned', /^[0-9a-f]{16}$/.test(id ?? ''), String(id));

// Listing includes the entry with metadata.
const list = (await fetch(`${BASE}/library`).then((r) => r.json())).tracks;
const entry = list.find((t) => t.id === id);
check('library lists the track', !!entry);
check('meta fields present', entry &&
  entry.name === 'library-test' && entry.durationSec > 9 &&
  entry.ml === false && typeof entry.createdAt === 'string',
  entry && JSON.stringify({ name: entry.name, dur: entry.durationSec, ml: entry.ml }));

// Audio: plain GET 200 + Accept-Ranges; ranged GET 206 + Content-Range.
const audioRes = await fetch(`${BASE}/library/${id}/audio`);
check('audio 200', audioRes.ok && audioRes.headers.get('accept-ranges') === 'bytes',
  `status ${audioRes.status} accept-ranges=${audioRes.headers.get('accept-ranges')}`);
const rangeRes = await fetch(`${BASE}/library/${id}/audio`, { headers: { Range: 'bytes=0-1023' } });
const cr = rangeRes.headers.get('content-range');
const rangeBody = new Uint8Array(await rangeRes.arrayBuffer());
check('audio range 206', rangeRes.status === 206 && /^bytes 0-1023\/\d+$/.test(cr ?? '') &&
  rangeBody.length === 1024, `status ${rangeRes.status} content-range=${cr} len=${rangeBody.length}`);

// Analysis fetch decodes to identical frame count + correct bar byte length.
const libAnalysis = await fetch(`${BASE}/library/${id}/analysis`).then((r) => r.json());
check('analysis frames match', libAnalysis.frames === analysis.frames, `${libAnalysis.frames}`);
check('bars byte length', b64ToU8(libAnalysis.bars).length === libAnalysis.frames * 64);

// Rename.
const renamed = await fetch(`${BASE}/library/${id}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Renamed Track' }),
}).then((r) => r.json());
check('rename reflected', renamed.name === 'Renamed Track');
const afterRename = (await fetch(`${BASE}/library`).then((r) => r.json())).tracks.find((t) => t.id === id);
check('rename persisted in list', afterRename?.name === 'Renamed Track');

// Scenes: valid envelope accepted, garbage rejected.
const sceneOk = await fetch(`${BASE}/library/${id}/scenes`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ schemaVersion: 1, scenes: [{ id: 's1', name: 'A', components: [] }] }),
});
check('PUT valid scenes 200', sceneOk.ok, `status ${sceneOk.status}`);
const sceneBad = await fetch(`${BASE}/library/${id}/scenes`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ nope: true }),
});
check('PUT invalid scenes 422', sceneBad.status === 422, `status ${sceneBad.status}`);

// CORS preflight must allow DELETE (the new method).
const preflight = await fetch(`${BASE}/library/${id}`, {
  method: 'OPTIONS',
  headers: {
    Origin: 'http://localhost:5500',
    'Access-Control-Request-Method': 'DELETE',
  },
});
const allowMethods = preflight.headers.get('access-control-allow-methods') ?? '';
check('preflight allows DELETE', preflight.ok && /DELETE/i.test(allowMethods), allowMethods);

// Delete removes it.
const del = await fetch(`${BASE}/library/${id}`, { method: 'DELETE' });
check('delete 200', del.ok);
const goneList = (await fetch(`${BASE}/library`).then((r) => r.json())).tracks;
check('track gone from list', !goneList.find((t) => t.id === id));
const goneAudio = await fetch(`${BASE}/library/${id}/audio`);
check('audio 404 after delete', goneAudio.status === 404, `status ${goneAudio.status}`);

if (failures.length) {
  console.log(`\n${failures.length} failures`);
  process.exit(1);
}
console.log('\nALL LIBRARY ENDPOINT CHECKS PASSED');
