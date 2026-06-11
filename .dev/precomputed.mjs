// Full E2E of the precomputed path: spawns uvicorn, uploads test.wav
// through the UI, asserts precomputed mode with balanced bands and beats.
// Usage: node .dev/make-test-wav.mjs && node .dev/precomputed.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(path.join(os.tmpdir(), 'av-driver', 'package.json'));
const { chromium } = require('playwright-core');

const OUT = path.resolve('.dev');
const failures = [];
const errors = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

// --- Spawn the analysis server ---
const uvicorn = spawn(
  path.resolve('server/.venv/Scripts/python.exe'),
  ['-m', 'uvicorn', 'app:app', '--app-dir', 'server', '--port', '8765'],
  { stdio: 'ignore' },
);

const serverReady = async (budgetMs = 40000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < budgetMs) {
    try {
      const res = await fetch('http://127.0.0.1:8765/health');
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

let browser;
try {
  // Generous budget: librosa import + numba JIT warm-up runs at startup.
  check('uvicorn up', await serverReady(), 'health responded');

  browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('http://localhost:8123/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.av-transport');

  await page.setInputFiles('.av-dropzone input[type="file"]', path.join(OUT, 'test.wav'));
  await page.waitForSelector('[data-action="play"]:not([disabled])', { timeout: 30000 });

  const mode = await page.evaluate(() => window.__app.mode);
  check('mode is precomputed', mode === 'precomputed', mode);

  const tempo = await page.evaluate(() => window.__app.precomputedSource?.frame.tempo);
  check('tempo present in frame', tempo > 100 && tempo < 140, String(tempo));

  // Seek into the 8kHz segment: treble band should read strong & balanced.
  await page.evaluate(() => window.__app.audioEngine.seek(4.0));
  await page.waitForTimeout(800);
  const s1 = await page.evaluate(() => ({
    bands: { ...window.__app.precomputedSource.frame.bands },
    time: window.__app.audioEngine.currentTime,
  }));
  check('treble strong in 8kHz segment', s1.bands.treble > 0.5 && s1.bands.bass < 0.1,
    `bass=${s1.bands.bass.toFixed(2)} treble=${s1.bands.treble.toFixed(2)} t=${s1.time.toFixed(1)}`);

  // Click segment: beats must fire (sample frame.beat across ~1.6s).
  await page.evaluate(() => {
    window.__beatCount = 0;
    const src = window.__app.precomputedSource;
    const origUpdate = src.update.bind(src);
    src.update = (...a) => { origUpdate(...a); if (src.frame.beat) window.__beatCount++; };
    window.__app.audioEngine.seek(6.1);
  });
  await page.waitForTimeout(1600);
  const beatCount = await page.evaluate(() => window.__beatCount);
  check('beats fire in click segment', beatCount >= 2, `${beatCount} beats in ~1.6s`);

  // Badge: precomputed confirmation auto-hides; realtime badge absent.
  const badge = await page.evaluate(() => {
    const el = document.querySelector('.av-mode-badge');
    return { realtime: el.classList.contains('realtime') };
  });
  check('no realtime badge', badge.realtime === false);

  const drawn = await page.evaluate(() => {
    const canvas = document.querySelector('.av-stage > canvas');
    const px = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 0) lit++;
    return lit;
  });
  check('canvas drawing', drawn > 1000, `${drawn} px`);
  await page.screenshot({ path: path.join(OUT, '10-precomputed.png') });

  console.log('console errors:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
} finally {
  await browser?.close();
  uvicorn.kill();
}

if (failures.length || errors.length) {
  console.log(`\n${failures.length} failures`);
  process.exit(1);
}
console.log('\nALL PRECOMPUTED CHECKS PASSED');
