// Pure unit test for keyframe evaluation + legacy migration (no browser/server).
// Usage: node .dev/keyframe-direct.mjs
import {
  evaluateKeyframes, evaluateColorKeyframes, hexToRgb, rgbToHex, paramAt,
} from '../src/components/KeyframeEvaluator.js';
import { migrateAutomation, normalizeKeyframes } from '../src/components/SceneMigrate.js';

const failures = [];
const approx = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

// --- numeric evaluation ---
check('empty → fallback', evaluateKeyframes([], 5, 0.3) === 0.3);
check('undefined → fallback', evaluateKeyframes(undefined, 5, 0.3) === 0.3);
const kfs = [{ t: 0, v: 0 }, { t: 10, v: 1 }];
check('before first → first.v', evaluateKeyframes(kfs, -3, 0.3) === 0);
check('after last → last.v', evaluateKeyframes(kfs, 99, 0.3) === 1);
check('midpoint lerp', evaluateKeyframes(kfs, 5, 0.3) === 0.5);
check('non-uniform lerp', approx(evaluateKeyframes([{ t: 0, v: 0 }, { t: 4, v: 1 }], 1, 0), 0.25));

// --- color evaluation ---
check('color empty → fallback', evaluateColorKeyframes([], 1, '#abcdef') === '#abcdef');
const cmid = evaluateColorKeyframes([{ t: 0, v: '#000000' }, { t: 10, v: '#ffffff' }], 5, '#000');
const { r } = hexToRgb(cmid);
check('color RGB midpoint ≈ #808080', Math.abs(r - 128) <= 1, cmid);
check('hex 3-digit expand', hexToRgb('#f00').r === 255 && hexToRgb('#f00').g === 0);
check('hex round-trip', rgbToHex(hexToRgb('#6c5ce7')) === '#6c5ce7');

// --- paramAt dispatch ---
const auto = { intensity: [{ t: 0, v: 0 }, { t: 2, v: 1 }], color: [{ t: 0, v: '#000000' }, { t: 2, v: '#ffffff' }] };
check('paramAt numeric', paramAt(auto, 'intensity', 1, 0.3) === 0.5);
check('paramAt color', Math.abs(hexToRgb(paramAt(auto, 'color', 1, '#000')).r - 128) <= 1);
check('paramAt missing param → fallback', paramAt(auto, 'size', 1, 0.25) === 0.25);

// --- migration parity (legacy intensity region → keyframes) ---
const legacy = [{ param: 'intensity', regions: [{ start: 10, end: 20, value: 1, rampIn: 2, rampOut: 2 }] }];
const migrated = migrateAutomation(legacy, 0.3);
check('migrated to object', !Array.isArray(migrated) && Array.isArray(migrated.intensity));
check('migrated 4 keyframes sorted', migrated.intensity.length === 4 &&
  migrated.intensity.every((k, i, a) => i === 0 || a[i - 1].t <= k.t),
  JSON.stringify(migrated.intensity));
check('migrated ramp midpoint ≈ 0.65', approx(evaluateKeyframes(migrated.intensity, 11, 0.3), 0.65),
  `${evaluateKeyframes(migrated.intensity, 11, 0.3)}`);
check('migrated holds value', evaluateKeyframes(migrated.intensity, 15, 0.3) === 1);

// --- idempotency ---
check('double-migrate equal', JSON.stringify(migrateAutomation(migrated, 0.3)) === JSON.stringify(migrated));
check('migrate empty array → {}', JSON.stringify(migrateAutomation([], 0.3)) === '{}');
check('migrate object passthrough', migrateAutomation({ intensity: [{ t: 1, v: 1 }] }, 0.3).intensity.length === 1);

// --- normalizeKeyframes ---
const norm = normalizeKeyframes([{ t: 5, v: 0.5 }, { t: 1, v: 0.1 }, { t: 5.0005, v: 0.9 }]);
check('normalize sorts', norm[0].t === 1);
check('normalize dedupes near-equal t (later wins)', norm.length === 2 && norm[1].v === 0.9, JSON.stringify(norm));

if (failures.length) {
  console.log(`\n${failures.length} failures`);
  process.exit(1);
}
console.log('\nALL KEYFRAME CHECKS PASSED');
