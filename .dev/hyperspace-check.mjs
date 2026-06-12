// Visual check for HyperspaceVisualizer: confirms it registers, renders lit
// pixels, keeps a bright pulsing center, and animates (spiral motion) over
// time. Captures screenshots for manual inspection of the warp feel.
// Usage: node .dev/make-test-wav.mjs && node .dev/hyperspace-check.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';

import { resetTestScene } from './_reset-scene.mjs';

const require = createRequire(path.join(os.tmpdir(), 'av-driver', 'package.json'));
const { chromium } = require('playwright-core');
await resetTestScene(); // ensure no saved hybrid scene hijacks the visualizer

const OUT = path.resolve('.dev');
const failures = [];
const errors = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch({
  channel: 'msedge', headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', (err) => errors.push(String(err)));

await page.addInitScript(() => localStorage.setItem('audio-vis:visualizer', 'hyperspace'));
await page.goto('http://localhost:8123/', { waitUntil: 'networkidle' });
await page.waitForSelector('.av-transport');

await page.setInputFiles('.av-modal input[type="file"]', path.join(OUT, 'test.wav'));
await page.waitForSelector('[data-action="play"]:not([disabled])', { timeout: 600000 });

// Active visualizer is hyperspace?
const active = await page.evaluate(() => localStorage.getItem('audio-vis:visualizer'));
check('hyperspace selected', active === 'hyperspace', active);

// Sample the canvas: lit pixels overall + brightness at the center vs an edge.
const sampleStats = () => {
  const canvas = document.querySelector('.av-stage > canvas');
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;
  let lit = 0, sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const b = data[i] + data[i + 1] + data[i + 2];
    if (b > 24) lit++;
    sum += b;
  }
  const box = (cx, cy, half) => {
    let s = 0, n = 0;
    for (let y = cy - half; y < cy + half; y++)
      for (let x = cx - half; x < cx + half; x++) {
        const idx = (y * w + x) * 4;
        s += data[idx] + data[idx + 1] + data[idx + 2];
        n++;
      }
    return s / n;
  };
  return {
    lit,
    avg: sum / (data.length / 4),
    center: box(Math.floor(w / 2), Math.floor(h / 2), 40),
    corner: box(Math.floor(w * 0.12), Math.floor(h * 0.12), 40),
  };
};

await page.waitForTimeout(1200);
const a = await page.evaluate(sampleStats);
await page.screenshot({ path: path.join(OUT, '13-hyperspace-a.png') });
await page.waitForTimeout(700);
const b = await page.evaluate(sampleStats);
await page.screenshot({ path: path.join(OUT, '14-hyperspace-b.png') });

check('canvas has many lit pixels', a.lit > 3000, `${a.lit}`);
check('center brighter than corner (tunnel source)', a.center > a.corner * 1.5,
  `center=${a.center.toFixed(0)} corner=${a.corner.toFixed(0)}`);
// Two samples 0.7s apart should differ — the field is animating, not static.
check('animation between frames', Math.abs(a.avg - b.avg) > 0.05 || a.lit !== b.lit,
  `avgA=${a.avg.toFixed(2)} avgB=${b.avg.toFixed(2)} litA=${a.lit} litB=${b.lit}`);

console.log('console errors:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
await browser.close();

if (failures.length || errors.length) {
  console.log(`\n${failures.length} failures`);
  process.exit(1);
}
console.log('\nALL HYPERSPACE CHECKS PASSED');
