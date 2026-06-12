// E2E of the offline-fallback path: NO analysis server running — the app
// must fall back to realtime mode quickly and show the badge.
// Usage: node .dev/fallback.mjs   (make sure uvicorn is NOT running)
import { createRequire } from 'node:module';
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

// Guard: the server must actually be down for this test to mean anything.
const up = await fetch('http://127.0.0.1:8765/health').then((r) => r.ok).catch(() => false);
if (up) {
  console.error('Analysis server is running — stop it before the fallback test.');
  process.exit(2);
}

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (err) => errors.push(String(err)));

await page.goto('http://localhost:8123/', { waitUntil: 'networkidle' });
await page.waitForSelector('.av-transport');

const t0 = Date.now();
await page.setInputFiles('.av-modal input[type="file"]', path.join(OUT, 'test.wav'));
await page.waitForSelector('[data-action="play"]:not([disabled])', { timeout: 10000 });
const elapsed = Date.now() - t0;

check('fallback resolves quickly', elapsed < 4000, `${elapsed}ms`);
check('mode is realtime', await page.evaluate(() => window.__app.mode) === 'realtime');

const badge = await page.evaluate(() => {
  const el = document.querySelector('.av-mode-badge');
  return {
    visible: el.classList.contains('visible'),
    realtime: el.classList.contains('realtime'),
    text: el.textContent,
  };
});
check('realtime badge shown', badge.visible && badge.realtime, badge.text);

await page.waitForTimeout(1200);
const playing = await page.evaluate(() => ({
  playing: window.__app.audioEngine.isPlaying,
  time: window.__app.audioEngine.currentTime,
  bass: window.__app.extractor.frame.bands.bass,
}));
check('audio playing in fallback', playing.playing && playing.time > 0.5, `t=${playing.time.toFixed(2)}`);
check('realtime analysis active', playing.bass > 0.5, `bass=${playing.bass.toFixed(2)}`);
const stems = await page.evaluate(() => ({ ...window.__app.extractor.frame.stems }));
check('frame.stems present in realtime mode (proxies)',
  ['vocals', 'drums', 'bass', 'other'].every((k) => typeof stems[k] === 'number') && stems.bass > 0.5,
  JSON.stringify(Object.fromEntries(Object.entries(stems).map(([k, v]) => [k, +v.toFixed(2)]))));
await page.screenshot({ path: path.join(OUT, '11-fallback.png') });

await browser.close();

if (failures.length || errors.length) {
  console.log('errors:', JSON.stringify(errors, null, 2));
  console.log(`\n${failures.length} failures`);
  process.exit(1);
}
console.log('\nALL FALLBACK CHECKS PASSED');
