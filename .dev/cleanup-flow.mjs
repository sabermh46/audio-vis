// Signal-cleanup flow: load a processed track, confirm the conditioner is
// wired, drive the cleanup UI, and verify it persists with the scene.
// Usage: node .dev/make-test-wav.mjs && node .dev/cleanup-flow.mjs
// (requires a static server on :8123; spawns uvicorn on :8765 itself)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(path.join(os.tmpdir(), 'av-driver', 'package.json'));
const { chromium } = require('playwright-core');

const URL = 'http://localhost:8123/';
const failures = [];
const errors = [];
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${n}${d ? ` (${d})` : ''}`); if (!ok) failures.push(n); };

const uvicorn = spawn(path.resolve('server/.venv/Scripts/python.exe'),
  ['-m', 'uvicorn', 'app:app', '--app-dir', 'server', '--port', '8765'], { stdio: 'ignore' });
const ready = async () => { for (let i = 0; i < 80; i++) { try { if ((await fetch('http://127.0.0.1:8765/health')).ok) return true; } catch {} await new Promise(r => setTimeout(r, 500)); } return false; };

let browser;
try {
  check('uvicorn up', await ready());
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(String(e)));

  // Load + analyze the test wav through the startup modal.
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('.av-transport');
  await page.setInputFiles('.av-modal input[type="file"]', path.resolve('.dev', 'test.wav'));
  await page.waitForSelector('[data-action="play"]:not([disabled])', { timeout: 600000 });
  const tid = await page.evaluate(() => window.__app.lastAnalysis?.trackId);
  check('precomputed track w/ id', /^[0-9a-f]{16}$/.test(tid ?? ''), String(tid));
  await page.waitForTimeout(400);

  check('conditioner wired to app', await page.evaluate(() => !!window.__app.conditioner));
  check('conditioner default strength 0 (no-op)',
    await page.evaluate(() => window.__app.conditioner.config.strength === 0));

  // Open editor → cleanup UI present.
  await page.click('[data-action="editor"]');
  await page.waitForSelector('.av-editor.open', { timeout: 4000 });
  await page.waitForSelector('.av-editor-cleanup', { timeout: 5000 });
  check('cleanup UI present', !!(await page.$('.av-editor-cleanup .av-clean-strength')));

  // Drive Strength to max via the UI and confirm the conditioner picks it up.
  await page.$eval('.av-clean-strength', (el) => {
    el.value = '1';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => ({
    strength: window.__app.conditioner.config.strength,
    floor: window.__app.conditioner.floorFor('stem.vocals'),
    sceneCleanup: window.__app.compositor?.getScene().signalCleanup,
  }));
  check('UI strength reaches conditioner', after.strength === 1, `${after.strength}`);
  check('adaptive floor now > 0', after.floor > 0, `${after.floor}`);
  check('cleanup stored on compositor scene', after.sceneCleanup?.strength === 1, JSON.stringify(after.sceneCleanup));

  // Save and reload → persisted.
  await page.click('.av-editor-save');
  await page.waitForTimeout(400);
  const saved = await fetch(`http://127.0.0.1:8765/library/${tid}/scenes`).then((r) => r.json());
  check('cleanup persisted on server', saved.scenes?.[0]?.signalCleanup?.strength === 1,
    JSON.stringify(saved.scenes?.[0]?.signalCleanup));

  console.log('console errors:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
} finally {
  await browser?.close();
  uvicorn.kill();
}
if (failures.length || errors.length) { console.log(`\n${failures.length} failures`); process.exit(1); }
console.log('\nALL CLEANUP FLOW CHECKS PASSED');
