// Full editor flow: load track, open editor, add an element, drag-paint an
// intensity region, save; reload track → scene reapplies as a hybrid.
// Usage: node .dev/make-test-wav.mjs && node .dev/editor-flow.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(path.join(os.tmpdir(), 'av-driver', 'package.json'));
const { chromium } = require('playwright-core');

const OUT = path.resolve('.dev');
const URL = 'http://localhost:8123/';
const failures = [];
const errors = [];
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${n}${d ? ` (${d})` : ''}`); if (!ok) failures.push(n); };

const uvicorn = spawn(path.resolve('server/.venv/Scripts/python.exe'),
  ['-m', 'uvicorn', 'app:app', '--app-dir', 'server', '--port', '8765'], { stdio: 'ignore' });
const ready = async () => { for (let i = 0; i < 80; i++) { try { if ((await fetch('http://127.0.0.1:8765/health')).ok) return true; } catch {} await new Promise(r => setTimeout(r, 500)); } return false; };

const loadTrack = async (page) => {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('.av-transport');
};

let browser;
try {
  check('uvicorn up', await ready());
  const health = await fetch('http://127.0.0.1:8765/health').then(r => r.json());
  console.log('scenesBackend:', health.scenesBackend);

  // Reset this track's saved scene so the run starts from a clean slate
  // (test.wav hashes to a fixed trackId shared with scenes-endpoint.mjs).
  const wav = fs.readFileSync(path.join(OUT, 'test.wav'));
  const presetId = crypto.createHash('sha256').update(wav).digest('hex').slice(0, 16);
  await fetch(`http://127.0.0.1:8765/library/${presetId}/scenes`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schemaVersion: 2, scenes: [] }),
  }).catch(() => {});

  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  // --- Author a scene ---
  await loadTrack(page);
  await page.setInputFiles('.av-modal input[type="file"]', path.join(OUT, 'test.wav'));
  await page.waitForSelector('[data-action="play"]:not([disabled])', { timeout: 600000 });
  const tid = await page.evaluate(() => window.__app.lastAnalysis?.trackId);
  check('precomputed track w/ id', /^[0-9a-f]{16}$/.test(tid ?? ''), String(tid));

  await page.click('[data-action="editor"]');
  await page.waitForSelector('.av-editor.open', { timeout: 4000 });
  check('editor opened', true);
  check('compositor active on edit', await page.evaluate(() => !!window.__app.compositor));

  // Add the first palette element.
  await page.click('.av-editor-add');
  await page.waitForTimeout(200);
  const count = await page.evaluate(() => window.__app.compositor.getScene().components.length);
  check('element added', count === 1, `${count}`);

  // Drag-paint a region on the timeline (~20%..60% of the width).
  const box = await page.$('.av-tl-track');
  const bb = await box.boundingBox();
  await page.mouse.move(bb.x + bb.width * 0.2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width * 0.4, bb.y + bb.height / 2, { steps: 6 });
  await page.mouse.move(bb.x + bb.width * 0.6, bb.y + bb.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const region = await page.evaluate(() => {
    const c = window.__app.compositor.getScene().components[0];
    return c.automation?.[0]?.regions?.[0] ?? null;
  });
  check('region painted', region && region.end > region.start, JSON.stringify(region));

  // Save.
  await page.click('.av-editor-save');
  await page.waitForTimeout(500);

  const saved = await fetch(`http://127.0.0.1:8765/library/${tid}/scenes`).then(r => r.json());
  check('scene persisted on server', saved.scenes?.[0]?.components?.length === 1, JSON.stringify(saved.scenes?.[0]?.components?.length));

  // --- Fresh page: scene must reapply on reopen ---
  const p2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  p2.on('pageerror', (e) => errors.push(String(e)));
  await loadTrack(p2);
  await p2.waitForSelector(`.av-lib-card[data-id="${tid}"]`, { timeout: 5000 });
  await p2.click(`.av-lib-card[data-id="${tid}"] .av-lib-main`);
  await p2.waitForSelector('[data-action="play"]:not([disabled])', { timeout: 15000 });
  await p2.waitForTimeout(800);
  const reapplied = await p2.evaluate(() => ({
    hasComp: !!window.__app.compositor,
    n: window.__app.compositor?.getScene().components.length ?? 0,
  }));
  check('hybrid scene reapplied on reopen', reapplied.hasComp && reapplied.n === 1, JSON.stringify(reapplied));

  const lit = await p2.evaluate(() => {
    const c = document.querySelector('.av-stage > canvas');
    const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) n++;
    return n;
  });
  check('hybrid renders (base + element)', lit > 5000, `${lit} px`);
  await p2.screenshot({ path: path.join(OUT, '16-editor-hybrid.png') });

  console.log('console errors:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
} finally {
  await browser?.close();
  uvicorn.kill();
}
if (failures.length || errors.length) { console.log(`\n${failures.length} failures`); process.exit(1); }
console.log('\nALL EDITOR FLOW CHECKS PASSED');
