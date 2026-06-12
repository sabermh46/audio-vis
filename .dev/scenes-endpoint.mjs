// Scenes persistence endpoint test (Node fetch). Requires uvicorn on 8765.
// Works against whichever backend is active (MySQL or file fallback).
// Usage: node .dev/make-test-wav.mjs && node .dev/scenes-endpoint.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE = 'http://127.0.0.1:8765';
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

const health = await fetch(`${BASE}/health`).then((r) => r.json());
console.log('scenesBackend:', health.scenesBackend);
check('health reports scenes backend', ['mysql', 'file'].includes(health.scenesBackend));

// Get a real trackId by processing the test wav (DSP-only for speed).
const wav = fs.readFileSync(path.resolve('.dev/test.wav'));
const form = new FormData();
form.append('file', new Blob([wav], { type: 'audio/wav' }), 'upload.wav');
form.append('original', new Blob([wav], { type: 'audio/wav' }), 'scenes-test.wav');
const analysis = await fetch(`${BASE}/analyze?ml=0`, { method: 'POST', body: form }).then((r) => r.json());
const id = analysis.trackId;
check('trackId returned', /^[0-9a-f]{16}$/.test(id ?? ''), String(id));

// A track with no saved scene returns the empty default envelope.
const empty = await fetch(`${BASE}/library/${id}/scenes`).then((r) => r.json());
check('fresh track → empty envelope', Array.isArray(empty.scenes), JSON.stringify(empty));

// PUT a real scene, then GET it back identically.
const envelope = {
  schemaVersion: 2,
  scenes: [{
    id: 'scene-test', name: 'Test', base: 'hyperspace',
    canvas: { bg: '#000000', blendMode: 'source-over', fadeTrails: 0 },
    components: [{
      id: 'cmp-1', type: 'bouncingStar', enabled: true, z: 0,
      bind: { signal: 'stem.bass' },
      params: { x: 0.5, y: 0.5, size: 0.3, color: '#6c5ce7', baseIntensity: 0.3, sensitivity: 1 },
      automation: [{ param: 'intensity', regions: [{ start: 4, end: 8, value: 1, rampIn: 0.5, rampOut: 0.5 }] }],
    }],
  }],
};
const putRes = await fetch(`${BASE}/library/${id}/scenes`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envelope),
});
check('PUT scene 200', putRes.ok, `status ${putRes.status}`);

const got = await fetch(`${BASE}/library/${id}/scenes`).then((r) => r.json());
const cmp = got.scenes?.[0]?.components?.[0];
const region = cmp?.automation?.[0]?.regions?.[0];
check('scene round-trips', got.scenes.length === 1 && got.scenes[0].base === 'hyperspace');
check('component round-trips', cmp?.id === 'cmp-1' && cmp?.bind.signal === 'stem.bass');
check('region round-trips', region?.start === 4 && region?.end === 8 && region?.value === 1,
  JSON.stringify(region));

// Invalid envelope rejected.
const bad = await fetch(`${BASE}/library/${id}/scenes`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nope: true }),
});
check('invalid envelope → 422', bad.status === 422, `status ${bad.status}`);

// Unknown track → 404.
const fakeId = crypto.randomBytes(8).toString('hex');
const unknown = await fetch(`${BASE}/library/${fakeId}/scenes`);
check('unknown track → 404', unknown.status === 404, `status ${unknown.status}`);

if (failures.length) {
  console.log(`\n${failures.length} failures`);
  process.exit(1);
}
console.log('\nALL SCENES ENDPOINT CHECKS PASSED');
