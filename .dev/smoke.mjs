// Dev-only browser smoke test (not part of the app).
// Usage: node .dev/smoke.mjs  — requires playwright-core in %TEMP%/av-driver.
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(path.join(os.tmpdir(), 'av-driver', 'package.json'));
const { chromium } = require('playwright-core');

const OUT = path.resolve('.dev');
const errors = [];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', (err) => errors.push(String(err)));

await page.goto('http://localhost:8123/', { waitUntil: 'networkidle' });
await page.waitForSelector('.av-transport');
await page.screenshot({ path: path.join(OUT, '1-idle.png') });

// Idle hint visible?
const hint = await page.textContent('.av-idle .hint');
console.log('idle hint:', JSON.stringify(hint));

// Transport controls present?
for (const sel of ['[data-action="play"]', '.av-seek', '.av-volume', '[data-action="gallery"]', '[data-action="fullscreen"]', '[data-action="openFile"]']) {
  const found = !!(await page.$(sel));
  console.log(`control ${sel}: ${found ? 'OK' : 'MISSING'}`);
}

// Open the template gallery.
await page.click('[data-action="gallery"]');
await page.waitForTimeout(450); // slide-up transition
const cards = await page.$$eval('.av-card .av-card-name', (els) => els.map((e) => e.textContent));
console.log('gallery cards:', JSON.stringify(cards));
const previews = await page.$$eval('.av-card canvas', (els) => els.length);
console.log('preview canvases:', previews);
await page.screenshot({ path: path.join(OUT, '2-gallery.png') });

// Select Waveform, confirm active card + localStorage persistence.
await page.click('.av-card[data-id="waveform"]');
await page.waitForTimeout(400);
const stored = await page.evaluate(() => localStorage.getItem('audio-vis:visualizer'));
console.log('stored visualizer:', stored);
await page.screenshot({ path: path.join(OUT, '3-after-select.png') });

console.log('console errors:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
