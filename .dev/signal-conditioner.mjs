// Pure unit test for SignalConditioner + migrateCleanup (no browser/server).
// Usage: node .dev/signal-conditioner.mjs
import { SignalConditioner, DEFAULT_CLEANUP } from '../src/core/SignalConditioner.js';
import { migrateCleanup } from '../src/components/SceneMigrate.js';

const failures = [];
const approx = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

// Build a fake decoded analysis. A ramp 1..200 makes the median predictable:
// non-silent samples are 6..200 (195 of them); the 50th percentile lands ~103.
const ramp = Uint8Array.from({ length: 200 }, (_, i) => i + 1);
const analysis = {
  onset: ramp, harmonic: ramp, percussive: ramp, rms: ramp,
  bands: { bass: ramp, mid: ramp, treble: ramp },
  stems: { vocals: ramp, drums: ramp, bass: ramp, other: ramp },
};

const cond = new SignalConditioner(analysis);

// --- adaptive floor ---
cond.setConfig({ enabled: true, strength: 1, mode: 'adaptive', fixedFloor: 0.1 });
const floor = cond.floorFor('stem.vocals');
check('adaptive floor in sane range', floor > 0.3 && floor < 0.5, `${floor}`);
check('adaptive floor ≈ median 103/255', approx(floor, 103 / 255, 0.02), `${floor}`);
check('apply(floor) ≈ 0', approx(cond.apply('stem.vocals', floor), 0));
check('apply(1) === 1', cond.apply('stem.vocals', 1) === 1);
check('apply below floor → 0', cond.apply('stem.vocals', floor - 0.1) === 0);
// downward-expansion math: out = (v - floor) / (1 - floor)
const v = 0.75;
check('apply expansion math', approx(cond.apply('stem.vocals', v), (v - floor) / (1 - floor)));

// --- strength scales the floor ---
cond.setConfig({ enabled: true, strength: 0.5, mode: 'adaptive', fixedFloor: 0.1 });
check('strength 0.5 halves floor', approx(cond.floorFor('stem.vocals'), floor * 0.5));

// --- strength 0 → no-op ---
cond.setConfig({ enabled: true, strength: 0, mode: 'adaptive', fixedFloor: 0.1 });
check('strength 0 → floor 0', cond.floorFor('stem.vocals') === 0);
check('strength 0 → identity', cond.apply('stem.vocals', 0.42) === 0.42);

// --- fixed mode ignores adaptive floor ---
cond.setConfig({ enabled: true, strength: 1, mode: 'fixed', fixedFloor: 0.25 });
check('fixed floor used directly', approx(cond.floorFor('stem.vocals'), 0.25));
check('fixed apply math', approx(cond.apply('band.bass', 0.5), (0.5 - 0.25) / (1 - 0.25)));

// --- disabled → identity even with a floor ---
cond.setConfig({ enabled: false, strength: 1, mode: 'adaptive', fixedFloor: 0.1 });
check('disabled → identity', cond.apply('stem.vocals', 0.3) === 0.3);

// --- no stems present → those channels absent, others still work ---
const condNoStems = new SignalConditioner({ rms: ramp, bands: { bass: ramp, mid: ramp, treble: ramp },
  onset: ramp, harmonic: ramp, percussive: ramp });
condNoStems.setConfig({ enabled: true, strength: 1, mode: 'adaptive', fixedFloor: 0.1 });
check('absent stem channel → floor 0 (identity)', condNoStems.apply('stem.vocals', 0.5) === 0.5);
check('present band channel → gated', condNoStems.apply('band.bass', condNoStems.floorFor('band.bass')) < 0.01);

// --- silence excluded from percentile ---
const sparse = new Uint8Array(100); // mostly zeros
sparse[0] = 200; sparse[1] = 220; sparse[2] = 240;
const condSparse = new SignalConditioner({ rms: sparse, bands: {}, onset: sparse, harmonic: sparse, percussive: sparse });
condSparse.setConfig({ enabled: true, strength: 1, mode: 'adaptive', fixedFloor: 0.1 });
check('silence excluded → floor from non-zero only', condSparse.floorFor('volume') > 0.6, `${condSparse.floorFor('volume')}`);

// --- migrateCleanup ---
check('migrateCleanup absent → no-op default',
  JSON.stringify(migrateCleanup(undefined)) === JSON.stringify({ enabled: true, strength: 0, mode: 'adaptive', fixedFloor: 0.1 }));
check('migrateCleanup default matches DEFAULT_CLEANUP',
  JSON.stringify(migrateCleanup(undefined)) === JSON.stringify(DEFAULT_CLEANUP));
const mc = migrateCleanup({ enabled: false, strength: 0.7, mode: 'fixed', fixedFloor: 0.3 });
check('migrateCleanup passthrough', mc.enabled === false && mc.strength === 0.7 && mc.mode === 'fixed' && mc.fixedFloor === 0.3);
check('migrateCleanup idempotent', JSON.stringify(migrateCleanup(mc)) === JSON.stringify(mc));
check('migrateCleanup coerces bad mode', migrateCleanup({ mode: 'weird' }).mode === 'adaptive');

if (failures.length) {
  console.log(`\n${failures.length} failures`);
  process.exit(1);
}
console.log('\nALL SIGNAL-CONDITIONER CHECKS PASSED');
