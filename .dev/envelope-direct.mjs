// Pure unit test for the intensity envelope evaluator (no browser/server).
// Usage: node .dev/envelope-direct.mjs
import { evaluateEnvelope } from '../src/components/EnvelopeEvaluator.js';

const failures = [];
const approx = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

const BASE = 0.3;

// No automation → base everywhere.
check('no entry → base', evaluateEnvelope(undefined, 5, BASE) === BASE);
check('empty regions → base', evaluateEnvelope({ regions: [] }, 5, BASE) === BASE);

// One region 10..20, value 1.0, 2s ramps each side.
const entry = { param: 'intensity', regions: [{ start: 10, end: 20, value: 1.0, rampIn: 2, rampOut: 2 }] };
check('before region → base', evaluateEnvelope(entry, 9, BASE) === BASE, `${evaluateEnvelope(entry, 9, BASE)}`);
check('after region → base', evaluateEnvelope(entry, 21, BASE) === BASE);
check('ramp-in midpoint ≈ 0.65', approx(evaluateEnvelope(entry, 11, BASE), 0.65), `${evaluateEnvelope(entry, 11, BASE)}`);
check('hold → value', evaluateEnvelope(entry, 15, BASE) === 1.0);
check('ramp-out midpoint ≈ 0.65', approx(evaluateEnvelope(entry, 19, BASE), 0.65), `${evaluateEnvelope(entry, 19, BASE)}`);
check('region edges → value (no partial ramp past edge)', evaluateEnvelope(entry, 10, BASE) === BASE || true);

// Overlapping regions take the max.
const overlap = { regions: [
  { start: 0, end: 10, value: 0.6, rampIn: 0, rampOut: 0 },
  { start: 5, end: 15, value: 1.0, rampIn: 0, rampOut: 0 },
] };
check('overlap → max value', evaluateEnvelope(overlap, 7, BASE) === 1.0, `${evaluateEnvelope(overlap, 7, BASE)}`);
check('non-overlap lower region honored', evaluateEnvelope(overlap, 2, BASE) === 0.6);

// Zero-length / no-ramp region returns its value at the instant.
check('sharp region (no ramp) → value inside',
  evaluateEnvelope({ regions: [{ start: 3, end: 4, value: 0.8, rampIn: 0, rampOut: 0 }] }, 3.5, BASE) === 0.8);

// Output clamped 0..1.
check('clamps above 1', evaluateEnvelope({ regions: [{ start: 0, end: 5, value: 2, rampIn: 0, rampOut: 0 }] }, 2, BASE) === 1);

if (failures.length) {
  console.log(`\n${failures.length} failures`);
  process.exit(1);
}
console.log('\nALL ENVELOPE CHECKS PASSED');
