// Dev-only check for ShapesVisualizer: each shape must scale with its own
// band only. Usage: node .dev/make-test-wav.mjs && node .dev/shapes-check.mjs
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

// Gallery should list 3 cards now, with shapes active.
await page.click('[data-action="gallery"]');
await page.waitForTimeout(400);
const cards = await page.$$eval('.av-card', (els) =>
  els.map((e) => ({ id: e.dataset.id, active: e.classList.contains('active') })));
check('gallery has 3 templates', cards.length === 3, JSON.stringify(cards.map((c) => c.id)));
check('shapes card active', cards.find((c) => c.id === 'shapes')?.active === true);
await page.screenshot({ path: path.join(OUT, '7-gallery-3cards.png') });
await page.click('[data-action="gallery"]');

await page.setInputFiles('.av-dropzone input[type="file"]', path.join(OUT, 'test.wav'));
await page.waitForSelector('[data-action="play"]:not([disabled])');

// Brightness of each shape region: lit pixels around each shape center.
const regionEnergy = () => {
  const canvas = document.querySelector('.av-stage > canvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const boxW = Math.floor(w * 0.22);
  const boxH = Math.floor(h * 0.5);
  const y0 = Math.floor(h * 0.23);
  const sample = (cx) => {
    const px = ctx.getImageData(Math.floor(cx * w - boxW / 2), y0, boxW, boxH).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += px[i + 3]; // alpha
    return sum / (px.length / 4) / 255;
  };
  return { bass: sample(0.25), mid: sample(0.5), treble: sample(0.75) };
};

await page.waitForTimeout(1800); // inside the 60Hz half
const bassPhase = await page.evaluate(regionEnergy);
await page.screenshot({ path: path.join(OUT, '8-shapes-bass.png') });
check('oval lights up on bass', bassPhase.bass > bassPhase.treble * 1.5,
  `bass=${bassPhase.bass.toFixed(3)} mid=${bassPhase.mid.toFixed(3)} treble=${bassPhase.treble.toFixed(3)}`);

await page.evaluate(() => window.__app.audioEngine.seek(4.2));
await page.waitForTimeout(1500); // inside the 8kHz half
const treblePhase = await page.evaluate(regionEnergy);
await page.screenshot({ path: path.join(OUT, '9-shapes-treble.png') });
check('triangle lights up on treble', treblePhase.treble > treblePhase.bass * 1.5,
  `bass=${treblePhase.bass.toFixed(3)} mid=${treblePhase.mid.toFixed(3)} treble=${treblePhase.treble.toFixed(3)}`);
check('triangle grew vs bass phase', treblePhase.treble > bassPhase.treble * 1.5,
  `${bassPhase.treble.toFixed(3)} -> ${treblePhase.treble.toFixed(3)}`);
check('oval shrank vs bass phase', treblePhase.bass < bassPhase.bass * 0.7,
  `${bassPhase.bass.toFixed(3)} -> ${treblePhase.bass.toFixed(3)}`);

console.log('console errors:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
await browser.close();

if (failures.length || errors.length) {
  console.log(`\n${failures.length} failures`);
  process.exit(1);
}
console.log('\nALL SHAPES CHECKS PASSED');
