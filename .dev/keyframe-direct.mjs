// Pure unit test for keyframe evaluation + legacy migration (no browser/server).
// Usage: node .dev/keyframe-direct.mjs
import {
  evaluateKeyframes, evaluateColorKeyframes, hexToRgb, rgbToHex, paramAt, paramAtDesc,
  compileComponent, compileParams,
} from '../src/components/KeyframeEvaluator.js';
import { migrateAutomation, normalizeKeyframes, migrateBase } from '../src/components/SceneMigrate.js';

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

// --- compileComponent parity (play-mode precompute) ---
const FPS = 60;
const comp = {
  params: { baseIntensity: 0.3, sensitivity: 1, size: 0.25, opacity: 1, color: '#000000' },
  automation: {
    intensity: [{ t: 0, v: 0.2 }, { t: 2, v: 1 }],
    color: [{ t: 0, v: '#000000' }, { t: 2, v: '#ffffff' }],
  },
};
const frameCount = Math.ceil(3 * FPS) + 1;
const tbl = compileComponent(comp, FPS, frameCount);
check('compiled intensity is a typed array', tbl.intensity instanceof Float32Array && tbl.intensity.length === frameCount);
check('compiled color is a string array', Array.isArray(tbl.color) && tbl.color.length === frameCount);
check('params without keyframes → null + static', tbl.sensitivity === null && tbl.size === null
  && tbl.static.sensitivity === 1 && tbl.static.size === 0.25);
// Parity at sample times: table[round(t*fps)] ≈ paramAt(...) at that t.
let parityOk = true;
for (const t of [0, 0.5, 1, 1.5, 2, 2.5]) {
  const idx = Math.round(t * FPS);
  if (Math.abs(tbl.intensity[idx] - paramAt(comp.automation, 'intensity', idx / FPS, 0.3)) > 1e-4) parityOk = false;
}
check('compiled numeric parity with paramAt', parityOk);
check('compiled clamps before-first/after-last',
  approx(tbl.intensity[0], 0.2) && approx(tbl.intensity[frameCount - 1], 1),
  `${tbl.intensity[0]} ${tbl.intensity[frameCount - 1]}`);
const cmidIdx = Math.round(1 * FPS);
check('compiled color parity (midpoint ≈ #808080)', Math.abs(hexToRgb(tbl.color[cmidIdx]).r - 128) <= 1, tbl.color[cmidIdx]);

// --- descriptor-driven compileParams (base-layer params) ---
const baseDescriptors = [
  { key: 'starIntensity', min: 0, max: 1, default: 0.7 },
  { key: 'starHue', min: 0, max: 360, default: 250 },        // numeric despite "hue"
  { key: 'warpSpeed', min: 0, max: 2, default: 1 },
  { key: 'starDensity', min: 0, max: 1, default: 0.8 },       // no keyframes → null table
];
const baseAuto = {
  starHue: [{ t: 0, v: 0 }, { t: 2, v: 360 }],
  warpSpeed: [{ t: 0, v: 0.5 }, { t: 2, v: 1.5 }],
};
const bp = compileParams(baseAuto, {}, baseDescriptors, FPS, frameCount);
check('base starHue is numeric Float32Array (not color)', bp.tables.starHue instanceof Float32Array);
check('base starHue numeric parity', approx(bp.tables.starHue[Math.round(1 * FPS)],
  evaluateKeyframes(baseAuto.starHue, 1, 250), 1), `${bp.tables.starHue[Math.round(1 * FPS)]}`);
check('base starHue clamps ends', approx(bp.tables.starHue[0], 0, 1) && approx(bp.tables.starHue[frameCount - 1], 360, 1));
check('base warpSpeed parity', approx(bp.tables.warpSpeed[Math.round(1 * FPS)], 1));
check('base non-keyframed → null + static', bp.tables.starDensity === null && bp.static.starDensity === 0.8);
check('paramAtDesc numeric for hue', approx(paramAtDesc(baseAuto, baseDescriptors[1], 1, 250), 180, 1));

// --- migrateBase (scene.base string → object) ---
check('migrateBase null', JSON.stringify(migrateBase(null)) === JSON.stringify({ id: null, params: {}, automation: {} }));
check('migrateBase string', JSON.stringify(migrateBase('river-night')) === JSON.stringify({ id: 'river-night', params: {}, automation: {} }));
const mb = migrateBase({ id: 'x', params: { a: 1 }, automation: { k: [{ t: 0, v: 1 }] } });
check('migrateBase object passthrough', mb.id === 'x' && mb.params.a === 1 && mb.automation.k.length === 1);
check('migrateBase idempotent', JSON.stringify(migrateBase(mb)) === JSON.stringify(mb));

if (failures.length) {
  console.log(`\n${failures.length} failures`);
  process.exit(1);
}
console.log('\nALL KEYFRAME CHECKS PASSED');
