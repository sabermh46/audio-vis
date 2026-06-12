// Dev-only check for ShapesVisualizer (realtime mode, no server needed):
// each shape must scale with its own stem proxy.
// Usage: node .dev/make-test-wav.mjs && node .dev/shapes-check.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(path.join(os.tmpdir(), 'av-driver', 'package.json'));
const { chromium } = require('playwright-core');

const OUT = path.resolve('.dev');
const errors = [];
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', (err) => errors.push(String(err)));

// Preselect the shapes template via the persisted setting.
await page.addInitScript(() => localStorage.setItem('audio-vis:visualizer', 'shapes'));
await page.goto('http://localhost:8123/', { waitUntil: 'networkidle' });
await page.waitForSelector('.av-transport');

// Load through the startup modal first — that dismisses it so the
// transport-bar gallery button becomes clickable.
await page.setInputFiles('.av-modal input[type="file"]', path.join(OUT, 'test.wav'));
await page.waitForSelector('[data-action="play"]:not([disabled])', { timeout: 600000 });

// Gallery should list 3 cards now, with shapes active.
await page.click('[data-action="gallery"]');
await page.waitForTimeout(400);
const cards = await page.$$eval('.av-card', (els) =>
  els.map((e) => ({ id: e.dataset.id, active: e.classList.contains('active') })));
check('gallery has 3 templates', cards.length === 3, JSON.stringify(cards.map((c) => c.id)));
check('shapes card active', cards.find((c) => c.id === 'shapes')?.active === true);
await page.screenshot({ path: path.join(OUT, '7-gallery-3cards.png') });
await page.click('[data-action="gallery"]');

// Brightness of each shape region: lit pixels around each shape center.
// Shapes sit at x = 0.2 (bass oval), 0.4 (vocals diamond), 0.6 (drums
// triangle), 0.8 (other ring).
const regionEnergy = () => {
  const canvas = document.querySelector('.av-stage > canvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const boxW = Math.floor(w * 0.17);
  const boxH = Math.floor(h * 0.5);
  const y0 = Math.floor(h * 0.23);
  const sample = (cx) => {
    const px = ctx.getImageData(Math.floor(cx * w - boxW / 2), y0, boxW, boxH).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += px[i + 3]; // alpha
    return sum / (px.length / 4) / 255;
  };
  return { bass: sample(0.2), vocals: sample(0.4), drums: sample(0.6), other: sample(0.8) };
};

check('4 stem shapes in frame', await page.evaluate(() => {
  const s = window.__app.extractor.frame.stems;
  return s && ['vocals', 'drums', 'bass', 'other'].every((k) => typeof s[k] === 'number');
}));

// Drum hits are spikes — sample repeatedly over a window and keep the max
// per region, so the reading doesn't depend on landing exactly on a hit.
const sampleWindow = async (ms = 1400, step = 120) => {
  const best = { bass: 0, vocals: 0, drums: 0, other: 0 };
  for (let t = 0; t < ms; t += step) {
    const s = await page.evaluate(regionEnergy);
    for (const k of Object.keys(best)) best[k] = Math.max(best[k], s[k]);
    await page.waitForTimeout(step);
  }
  return best;
};

await page.waitForTimeout(1200); // inside the 60Hz half
const bassPhase = await sampleWindow();
await page.screenshot({ path: path.join(OUT, '8-shapes-bass.png') });
check('bass oval dominates during 60Hz tone',
  bassPhase.bass > bassPhase.drums * 1.5 && bassPhase.bass > bassPhase.other * 1.5,
  JSON.stringify(bassPhase));

await page.evaluate(() => window.__app.audioEngine.seek(6.4));
await page.waitForTimeout(400); // let the seek land in the click segment
const clickPhase = await sampleWindow();
await page.screenshot({ path: path.join(OUT, '9-shapes-clicks.png') });
// Note: the clicks are broadband noise bursts, so in REALTIME mode every
// frequency-proxy shape legitimately fires — true per-instrument isolation
// is the ML path's job (asserted in precomputed.mjs). Here we only require
// that the drums proxy responds strongly to percussive content.
// 1.5x growth holds in both modes (realtime drums baseline is near-zero;
// precomputed htdemucs leaks a little tone energy into drums).
check('drums triangle lights up on clicks', clickPhase.drums > bassPhase.drums * 1.5,
  `${bassPhase.drums.toFixed(3)} -> ${clickPhase.drums.toFixed(3)}`);
check('drums no longer dwarfed by bass', clickPhase.drums > clickPhase.bass * 0.4,
  JSON.stringify(clickPhase));

console.log('console errors:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
await browser.close();

if (failures.length || errors.length) {
  console.log(`\n${failures.length} failures`);
  process.exit(1);
}
console.log('\nALL SHAPES CHECKS PASSED');
