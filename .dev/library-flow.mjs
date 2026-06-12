// Full library UX flow: spawn uvicorn, process a track via the modal, then
// in a fresh page reopen it from the library with NO re-analysis.
// Usage: node .dev/make-test-wav.mjs && node .dev/library-flow.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(path.join(os.tmpdir(), 'av-driver', 'package.json'));
const { chromium } = require('playwright-core');

const OUT = path.resolve('.dev');
const URL = 'http://localhost:8123/';
const failures = [];
const errors = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

const uvicorn = spawn(
  path.resolve('server/.venv/Scripts/python.exe'),
  ['-m', 'uvicorn', 'app:app', '--app-dir', 'server', '--port', '8765'],
  { stdio: 'ignore' },
);
const serverReady = async (budgetMs = 40000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < budgetMs) {
    try { if ((await fetch('http://127.0.0.1:8765/health')).ok) return true; } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

let browser;
try {
  check('uvicorn up', await serverReady());

  browser = await chromium.launch({
    channel: 'msedge', headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });

  // --- Page 1: process a new track through the modal ---
  const p1 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  p1.on('pageerror', (err) => errors.push(String(err)));
  await p1.goto(URL, { waitUntil: 'networkidle' });
  check('modal visible on load', await p1.$eval('.av-modal-backdrop', (el) => el.classList.contains('open')));

  await p1.setInputFiles('.av-modal input[type="file"]', path.join(OUT, 'test.wav'));
  await p1.waitForSelector('[data-action="play"]:not([disabled])', { timeout: 600000 });
  const proc = await p1.evaluate(() => ({ mode: window.__app.mode, tid: window.__app.lastAnalysis?.trackId }));
  check('processed in precomputed mode', proc.mode === 'precomputed', proc.mode);
  check('trackId set after processing', /^[0-9a-f]{16}$/.test(proc.tid ?? ''), String(proc.tid));
  await p1.waitForSelector('.av-modal-backdrop:not(.open)');
  await p1.close();

  // --- Page 2: fresh load → library lists the track → open it instantly ---
  const p2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  p2.on('pageerror', (err) => errors.push(String(err)));
  const analyzeCalls = [];
  p2.on('request', (req) => { if (req.url().includes('/analyze')) analyzeCalls.push(req.url()); });

  await p2.goto(URL, { waitUntil: 'networkidle' });
  await p2.waitForSelector('.av-lib-card', { timeout: 5000 });
  const card = await p2.$(`.av-lib-card[data-id="${proc.tid}"]`);
  check('library card present after reload', !!card);

  const t0 = Date.now();
  await p2.click(`.av-lib-card[data-id="${proc.tid}"] .av-lib-main`);
  await p2.waitForSelector('[data-action="play"]:not([disabled])', { timeout: 15000 });
  const openMs = Date.now() - t0;
  check('library open is fast (no re-analysis)', openMs < 8000, `${openMs}ms`);
  check('no /analyze request on library open', analyzeCalls.length === 0, JSON.stringify(analyzeCalls));

  const opened = await p2.evaluate(() => ({ mode: window.__app.mode, tid: window.__app.lastAnalysis?.trackId }));
  check('opened in precomputed mode', opened.mode === 'precomputed', opened.mode);
  check('opened trackId matches', opened.tid === proc.tid, `${opened.tid}`);

  // Audio plays and the analyser tap is CORS-clean (waveform not flat).
  await p2.waitForTimeout(1400);
  const play = await p2.evaluate(() => {
    const wf = window.__app.precomputedSource.frame.waveform;
    let min = 255, max = 0;
    for (let i = 0; i < wf.length; i++) { if (wf[i] < min) min = wf[i]; if (wf[i] > max) max = wf[i]; }
    return { playing: window.__app.audioEngine.isPlaying, time: window.__app.audioEngine.currentTime, spread: max - min };
  });
  check('audio playing from library URL', play.playing && play.time > 0.4, `t=${play.time.toFixed(2)}`);
  check('waveform tap CORS-clean (not flat)', play.spread > 5, `spread=${play.spread}`);
  await p2.screenshot({ path: path.join(OUT, '12-library-open.png') });

  console.log('console errors:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
} finally {
  await browser?.close();
  uvicorn.kill();
}

if (failures.length || errors.length) {
  console.log(`\n${failures.length} failures`);
  process.exit(1);
}
console.log('\nALL LIBRARY FLOW CHECKS PASSED');
