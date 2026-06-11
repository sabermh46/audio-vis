// Dev-only end-to-end playback test: loads test.wav through the real file
// input, verifies playback, band separation (bass vs treble), seek, pause,
// and second-file load. Usage: node .dev/playback.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(path.join(os.tmpdir(), 'av-driver', 'package.json'));
const { chromium } = require('playwright-core');

const OUT = path.resolve('.dev');
const WAV = path.join(OUT, 'test.wav');
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

await page.goto('http://localhost:8123/', { waitUntil: 'networkidle' });
await page.waitForSelector('.av-transport');

// Load the file through the real hidden input.
await page.setInputFiles('.av-dropzone input[type="file"]', WAV);
await page.waitForSelector('[data-action="play"]:not([disabled])', { timeout: 5000 });
check('track loaded (play enabled)', true);

const trackName = await page.textContent('[data-el="name"]');
check('track name shown', trackName === 'test.wav', trackName);

// Should be auto-playing; give the bass section a moment.
await page.waitForTimeout(1500);
const snapshot = () => ({
  playing: window.__app.audioEngine.isPlaying,
  time: window.__app.audioEngine.currentTime,
  bands: { ...window.__app.extractor.frame.bands },
  peakBar: (() => {
    const bars = window.__app.extractor.frame.bars;
    let idx = 0;
    for (let i = 1; i < bars.length; i++) if (bars[i] > bars[idx]) idx = i;
    return { idx, value: bars[idx], count: bars.length };
  })(),
});
const state1 = await page.evaluate(snapshot);
check('audio is playing', state1.playing);
check('time advancing', state1.time > 0.5, `t=${state1.time.toFixed(2)}`);
// A pure 60Hz tone lights only ~2 FFT bins, so band MEANS stay small —
// verify separation via relative band energy and the log-bar peak position.
// Expected bar for 60Hz: 64 * ln(60/20)/ln(20000/20) ≈ bar 10.
check('bass band dominates during 60Hz tone',
  state1.bands.bass > 0.1 && state1.bands.bass > state1.bands.treble * 5,
  `bass=${state1.bands.bass.toFixed(3)} mid=${state1.bands.mid.toFixed(3)} treble=${state1.bands.treble.toFixed(3)}`);
check('peak bar in bass region with strong level',
  state1.peakBar.idx >= 5 && state1.peakBar.idx <= 16 && state1.peakBar.value > 0.5,
  `bar ${state1.peakBar.idx}/${state1.peakBar.count} v=${state1.peakBar.value.toFixed(2)}`);

// Canvas actually has pixels drawn?
await page.screenshot({ path: path.join(OUT, '4-playing-bass.png') });
const drawn = await page.evaluate(() => {
  const canvas = document.querySelector('.av-stage > canvas');
  const ctx = canvas.getContext('2d');
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let lit = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] > 0) lit++;
  return lit;
});
check('canvas has drawn pixels', drawn > 1000, `${drawn} px`);

// Seek into the treble half.
await page.evaluate(() => window.__app.audioEngine.seek(4.2));
await page.waitForTimeout(1200);
const state2 = await page.evaluate(snapshot);
check('seek worked', state2.time > 4 && state2.time < 6, `t=${state2.time.toFixed(2)}`);
// Expected bar for 8kHz: 64 * ln(8000/20)/ln(1000) ≈ bar 55.
check('peak bar in treble region during 8kHz tone',
  state2.peakBar.idx >= 50 && state2.peakBar.idx <= 60 && state2.peakBar.value > 0.5,
  `bar ${state2.peakBar.idx}/${state2.peakBar.count} v=${state2.peakBar.value.toFixed(2)}`);
check('bass band quiet during 8kHz tone', state2.bands.bass < 0.05,
  `bass=${state2.bands.bass.toFixed(3)} treble=${state2.bands.treble.toFixed(3)}`);
await page.screenshot({ path: path.join(OUT, '5-playing-treble.png') });

// Pause via the transport button.
await page.click('[data-action="play"]');
await page.waitForTimeout(300);
const paused = await page.evaluate(() => !window.__app.audioEngine.isPlaying);
check('pause via button', paused);
const playIcon = await page.textContent('[data-action="play"]');
check('button shows play icon when paused', playIcon.trim() === '▶', playIcon.trim());

// Load a second file — proves the once-per-element MediaElementSource holds.
await page.setInputFiles('.av-dropzone input[type="file"]', WAV);
await page.waitForTimeout(800);
const reloaded = await page.evaluate(() => ({
  time: window.__app.audioEngine.currentTime,
  playing: window.__app.audioEngine.isPlaying,
}));
check('second file loads and auto-plays', reloaded.playing && reloaded.time < 3, `t=${reloaded.time.toFixed(2)}`);

// Switch visualizer mid-playback.
await page.click('[data-action="gallery"]');
await page.waitForTimeout(400);
await page.click('.av-card[data-id="waveform"]');
await page.waitForTimeout(600);
const stillPlaying = await page.evaluate(() => window.__app.audioEngine.isPlaying);
check('playback survives visualizer switch', stillPlaying);
await page.screenshot({ path: path.join(OUT, '6-waveform-playing.png') });

// Full teardown — proves destroy() releases everything without throwing.
const destroyed = await page.evaluate(() => {
  try { window.__app.destroy(); return document.querySelector('.av-app') === null; }
  catch (e) { return String(e); }
});
check('App.destroy() clean teardown', destroyed === true, String(destroyed));

console.log('console errors:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
await browser.close();

if (failures.length || errors.length) {
  console.log(`\n${failures.length} failures`);
  process.exit(1);
}
console.log('\nALL PLAYBACK CHECKS PASSED');
