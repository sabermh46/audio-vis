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

  // Intensity is the default active param. Click the graph twice (no drag)
  // to add two keyframes at different times + values.
  const box = await page.$('.av-tl-track');
  const bb = await box.boundingBox();
  await page.mouse.click(bb.x + bb.width * 0.3, bb.y + bb.height * 0.7); // low value
  await page.waitForTimeout(80);
  await page.mouse.click(bb.x + bb.width * 0.6, bb.y + bb.height * 0.2); // high value
  await page.waitForTimeout(150);

  const kfs = await page.evaluate(() =>
    window.__app.compositor.getScene().components[0].automation.intensity ?? []);
  check('two sorted intensity keyframes', kfs.length === 2 && kfs[0].t <= kfs[1].t, JSON.stringify(kfs));
  check('keyframe values differ by Y', Math.abs(kfs[0].v - kfs[1].v) > 0.1, JSON.stringify(kfs.map((k) => k.v)));

  // Drag the first dot to a new time; still 2, still sorted.
  const dot0 = await page.$('.av-tl-dot');
  const db = await dot0.boundingBox();
  await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width * 0.45, bb.y + bb.height * 0.5, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const kfs2 = await page.evaluate(() =>
    window.__app.compositor.getScene().components[0].automation.intensity ?? []);
  check('drag keeps 2 sorted keyframes', kfs2.length === 2 && kfs2[0].t <= kfs2[1].t, JSON.stringify(kfs2));

  // Add a color keyframe via the Color param + the kf-edit color picker.
  await page.click('.av-tl-param[data-param="color"]');
  await page.waitForTimeout(80);
  await page.mouse.click(bb.x + bb.width * 0.5, bb.y + bb.height * 0.5);
  await page.waitForTimeout(100);
  await page.$eval('.av-tl-kf-edit input[type="color"]', (el) => {
    el.value = '#ff0000'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(120);
  const colorKf = await page.evaluate(() =>
    window.__app.compositor.getScene().components[0].automation.color?.[0] ?? null);
  check('color keyframe stored as hex', colorKf && /^#[0-9a-f]{6}$/i.test(colorKf.v), JSON.stringify(colorKf));

  // Save.
  await page.click('.av-editor-save');
  await page.waitForTimeout(500);

  const saved = await fetch(`http://127.0.0.1:8765/library/${tid}/scenes`).then(r => r.json());
  const savedAuto = saved.scenes?.[0]?.components?.[0]?.automation ?? {};
  check('scene persisted on server', saved.scenes?.[0]?.components?.length === 1);
  check('keyframes persisted (object shape)',
    Array.isArray(savedAuto.intensity) && savedAuto.intensity.length === 2 && Array.isArray(savedAuto.color),
    JSON.stringify(Object.keys(savedAuto)));

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

  // --- Explicit Load saved / Clear controls ---
  await p2.click('[data-action="editor"]');
  await p2.waitForSelector('.av-editor.open', { timeout: 4000 });
  const status = await p2.textContent('.av-editor-scenestatus');
  check('editor shows saved-scene status', /saved scene is loaded/i.test(status), status);
  check('Load saved button enabled', !(await p2.$eval('.av-editor-load', (b) => b.disabled)));

  await p2.click('.av-editor-clear');
  await p2.waitForTimeout(150);
  check('Clear empties the scene',
    (await p2.evaluate(() => window.__app.compositor.getScene().components.length)) === 0);

  await p2.click('.av-editor-load');
  await p2.waitForTimeout(400);
  check('Load saved restores the scene',
    (await p2.evaluate(() => window.__app.compositor.getScene().components.length)) === 1);

  // --- Legacy migration: a region-shape scene must upgrade to keyframes on load ---
  await fetch(`http://127.0.0.1:8765/library/${tid}/scenes`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schemaVersion: 2, scenes: [{
      id: 'legacy', name: 'legacy', base: 'bars', canvas: { bg: '#05060c' },
      components: [{
        id: 'lc1', type: 'bouncingStar', enabled: true, z: 0, bind: { signal: 'stem.bass' },
        params: { x: 0.5, y: 0.5, size: 0.2, color: '#6c5ce7', baseIntensity: 0.3, sensitivity: 1 },
        automation: [{ param: 'intensity', regions: [{ start: 2, end: 6, value: 1, rampIn: 0.5, rampOut: 0.5 }] }],
      }],
    }] }),
  });
  const p3 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  p3.on('pageerror', (e) => errors.push(String(e)));
  await loadTrack(p3);
  await p3.click(`.av-lib-card[data-id="${tid}"] .av-lib-main`);
  await p3.waitForSelector('[data-action="play"]:not([disabled])', { timeout: 15000 });
  await p3.waitForTimeout(600);
  const migrated = await p3.evaluate(() => {
    const a = window.__app.compositor?.getScene().components[0]?.automation;
    return { isObject: a && !Array.isArray(a), kfs: a?.intensity ?? null };
  });
  check('legacy region migrated to keyframe object on load',
    migrated.isObject && Array.isArray(migrated.kfs) && migrated.kfs.length === 4,
    JSON.stringify(migrated.kfs));

  console.log('console errors:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
} finally {
  await browser?.close();
  uvicorn.kill();
}
if (failures.length || errors.length) { console.log(`\n${failures.length} failures`); process.exit(1); }
console.log('\nALL EDITOR FLOW CHECKS PASSED');
