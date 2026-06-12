import { lerp, clamp } from '../utils/format.js';

const BANDS = {
  bass: [20, 250],
  mid: [250, 4000],
  treble: [4000, 20000],
};

// Per-frame EMA coefficients: fast attack so transients snap, slow release
// so bars/bands fall gracefully.
const BAR_ATTACK = 0.5;
const BAR_RELEASE = 0.12;
const BAND_ATTACK = 0.4;
const BAND_RELEASE = 0.1;

// Adaptive normalization (rolling-max follower): instant attack, slow
// exponential decay. Counters the ~1/f spectral tilt of music — without
// this, bass reads near max while treble barely registers. Each band/bar
// is scaled against its own recent maximum.
const BAND_TAU = 5;      // seconds for envelope decay
const BAND_FLOOR = 0.10; // never normalize against less than this (no noise blow-up)
const BAND_GATE = 0.02;  // raw below this renders as silence
const BAR_TAU = 4;
const BAR_FLOOR = 0.25;  // higher floor: quiet bars must not amplify into a flat wall
const BAR_GATE = 0.04;
const FLUX_TAU = 3;
const FLUX_FLOOR = 0.05;

const BEAT_HISTORY = 43;          // ~0.7s of frames at 60fps
const BEAT_THRESHOLD = 1.35;      // bass must exceed 1.35x its recent average
const BEAT_MIN_LEVEL = 0.3;
const BEAT_REFRACTORY_MS = 200;

/**
 * Realtime AnalysisSource: polls an AnalyserNode once per frame and derives
 * visualization features — log-binned bars, per-band energies (each
 * adaptively normalized against its own rolling maximum), spectral-flux
 * onset, and bass-flux beat detection.
 *
 * Implements the AnalysisSource interface: `update(nowMs)`, `frame`,
 * `numBars`. Fields the offline (Python) source computes exactly are
 * approximated here: `onset` = normalized spectral flux, `percussive` =
 * onset, `harmonic` = smoothed mid band, `tempo` = 0 (unknown).
 *
 * The `frame` object and all arrays are preallocated and reused — zero
 * allocation inside the rAF loop.
 */
export class FeatureExtractor {
  #analyser;
  #freqData;
  #prevFreqData;
  #timeData;
  #numBars;
  #fMin;
  #fMax;
  #barRanges = [];   // per bar: [binLow, binHigh] fractional indices
  #bandRanges = {};  // per band: [intLow, intHigh] integer indices
  #barEnvMax = null;            // per-bar rolling max
  #bandEnvMax = { bass: BAND_FLOOR, mid: BAND_FLOOR, treble: BAND_FLOOR };
  #fluxEnvMax = FLUX_FLOOR;
  #bassRawUnnormalized = 0;     // beat detection works on pre-normalization energy
  #bassHistory = new Float32Array(BEAT_HISTORY);
  #bassHistoryIdx = 0;
  #bassHistoryCount = 0;
  #lastBeatAt = -Infinity;
  #lastNow = 0;

  frame = {
    bars: null,
    bands: { bass: 0, mid: 0, treble: 0 },
    bandsRaw: { bass: 0, mid: 0, treble: 0 },
    waveform: null,
    beat: false,
    volume: 0,
    onset: 0,
    harmonic: 0,
    percussive: 0,
    tempo: 0,
    stems: { vocals: 0, drums: 0, bass: 0, other: 0 },
  };

  constructor(analyser, { numBars = 64, fMin = 20, fMax = 20000 } = {}) {
    this.#analyser = analyser;
    this.#freqData = new Uint8Array(analyser.frequencyBinCount);
    this.#prevFreqData = new Uint8Array(analyser.frequencyBinCount);
    this.#timeData = new Uint8Array(analyser.fftSize);
    this.#fMin = fMin;
    this.#fMax = Math.min(fMax, analyser.context.sampleRate / 2);
    this.frame.waveform = this.#timeData;
    this.setBarCount(numBars);
    this.#computeBandRanges();
  }

  setBarCount(n) {
    this.#numBars = n;
    this.frame.bars = new Float32Array(n);
    this.#barEnvMax = new Float32Array(n).fill(BAR_FLOOR);
    this.#barRanges = [];
    // Bar k spans fMin * (fMax/fMin)^(k/N) .. ^((k+1)/N): equal width per
    // octave, matching how humans hear pitch.
    const ratio = this.#fMax / this.#fMin;
    for (let k = 0; k < n; k++) {
      const fLow = this.#fMin * Math.pow(ratio, k / n);
      const fHigh = this.#fMin * Math.pow(ratio, (k + 1) / n);
      this.#barRanges.push([this.#freqToBin(fLow), this.#freqToBin(fHigh)]);
    }
  }

  get numBars() { return this.#numBars; }

  #freqToBin(freq) {
    const { sampleRate } = this.#analyser.context;
    return (freq * this.#analyser.fftSize) / sampleRate;
  }

  #computeBandRanges() {
    const maxBin = this.#freqData.length - 1;
    for (const [name, [lo, hi]] of Object.entries(BANDS)) {
      const binLo = Math.max(0, Math.floor(this.#freqToBin(lo)));
      const binHi = Math.min(maxBin, Math.ceil(this.#freqToBin(hi)));
      this.#bandRanges[name] = [binLo, Math.max(binLo, binHi)];
    }
  }

  /** Reads spectrum at a fractional bin index with linear interpolation. */
  #sampleSpectrum(binIndex) {
    const i = Math.floor(binIndex);
    const next = Math.min(i + 1, this.#freqData.length - 1);
    return lerp(this.#freqData[i], this.#freqData[next], binIndex - i);
  }

  /** Rolling-max normalization: instant attack, exp decay over tau seconds. */
  #normalize(raw, envMax, dt, tau, floor, gate) {
    let env = envMax;
    if (raw > env) env = raw;
    else env += (raw - env) * (1 - Math.exp(-dt / tau));
    env = Math.max(env, floor);
    const value = raw < gate ? 0 : clamp(raw / env, 0, 1);
    return [value, env];
  }

  update(nowMs) {
    const dt = this.#lastNow ? Math.min((nowMs - this.#lastNow) / 1000, 0.1) : 1 / 60;
    this.#lastNow = nowMs;

    this.#prevFreqData.set(this.#freqData);
    this.#analyser.getByteFrequencyData(this.#freqData);
    this.#analyser.getByteTimeDomainData(this.#timeData);

    const { bars, bands, bandsRaw } = this.frame;

    for (let k = 0; k < this.#numBars; k++) {
      const [bLow, bHigh] = this.#barRanges[k];
      let raw;
      if (bHigh - bLow < 1) {
        // Several bottom bars can share one FFT bin — interpolate at the
        // range midpoint so adjacent bars aren't identical.
        raw = this.#sampleSpectrum((bLow + bHigh) / 2) / 255;
      } else {
        // Max (not mean) across the range: mean dilutes transients.
        let max = 0;
        const end = Math.min(Math.ceil(bHigh), this.#freqData.length - 1);
        for (let i = Math.floor(bLow); i <= end; i++) {
          if (this.#freqData[i] > max) max = this.#freqData[i];
        }
        raw = max / 255;
      }
      const [target, env] = this.#normalize(raw, this.#barEnvMax[k], dt, BAR_TAU, BAR_FLOOR, BAR_GATE);
      this.#barEnvMax[k] = env;
      const rate = target > bars[k] ? BAR_ATTACK : BAR_RELEASE;
      bars[k] += (target - bars[k]) * rate;
    }

    let totalSum = 0;
    for (const name of Object.keys(BANDS)) {
      const [lo, hi] = this.#bandRanges[name];
      let sum = 0;
      let peak = 0;
      for (let i = lo; i <= hi; i++) {
        const v = this.#freqData[i];
        sum += v;
        if (v > peak) peak = v;
      }
      // Blend mean with peak: bands differ hugely in bin count (bass ~24,
      // treble ~1500), so pure mean makes narrow content (a synth lead,
      // a tone) invisible in wide bands while mean alone reads broadband
      // energy. The blend keeps every band responsive to both.
      const raw = (sum / (hi - lo + 1) + peak) / (2 * 255);
      if (name === 'bass') this.#bassRawUnnormalized = raw;
      totalSum += raw;

      const [normalized, env] = this.#normalize(raw, this.#bandEnvMax[name], dt, BAND_TAU, BAND_FLOOR, BAND_GATE);
      this.#bandEnvMax[name] = env;
      bandsRaw[name] = normalized;
      const rate = normalized > bands[name] ? BAND_ATTACK : BAND_RELEASE;
      bands[name] += (normalized - bands[name]) * rate;
    }
    // Volume reflects real (pre-normalization) loudness.
    this.frame.volume = totalSum / 3;

    // Spectral flux: total positive bin-energy increase since last frame —
    // a percussive-onset proxy, normalized by its own rolling max.
    let flux = 0;
    for (let i = 0; i < this.#freqData.length; i++) {
      const d = this.#freqData[i] - this.#prevFreqData[i];
      if (d > 0) flux += d;
    }
    flux /= 255 * this.#freqData.length * 0.05; // ~5% of bins rising fully ≈ 1.0
    const [onset, fluxEnv] = this.#normalize(flux, this.#fluxEnvMax, dt, FLUX_TAU, FLUX_FLOOR, 0);
    this.#fluxEnvMax = fluxEnv;
    this.frame.onset = onset;
    // Percussive display value: flux spikes last a frame or two, so hold
    // hits with a fast-attack/slow-release envelope (drums shape shouldn't
    // strobe to zero between hits).
    const percRate = onset > this.frame.percussive ? 0.6 : 0.06;
    this.frame.percussive += (onset - this.frame.percussive) * percRate;
    this.frame.harmonic = bands.mid;
    this.frame.tempo = 0;
    // No ML here — fill stems with the closest realtime proxies so
    // visualizers can rely on frame.stems existing in every mode.
    const { stems } = this.frame;
    stems.vocals = this.frame.harmonic;
    stems.drums = this.frame.percussive;
    stems.bass = bands.bass;
    stems.other = bands.mid;

    this.frame.beat = this.#detectBeat(this.#bassRawUnnormalized, nowMs);
  }

  #detectBeat(bassRaw, nowMs) {
    let avg = 0;
    if (this.#bassHistoryCount > 0) {
      let sum = 0;
      for (let i = 0; i < this.#bassHistoryCount; i++) sum += this.#bassHistory[i];
      avg = sum / this.#bassHistoryCount;
    }

    this.#bassHistory[this.#bassHistoryIdx] = bassRaw;
    this.#bassHistoryIdx = (this.#bassHistoryIdx + 1) % BEAT_HISTORY;
    this.#bassHistoryCount = Math.min(this.#bassHistoryCount + 1, BEAT_HISTORY);

    const isBeat =
      bassRaw > BEAT_THRESHOLD * avg &&
      bassRaw > BEAT_MIN_LEVEL &&
      nowMs - this.#lastBeatAt > BEAT_REFRACTORY_MS;
    if (isBeat) this.#lastBeatAt = nowMs;
    return isBeat;
  }
}
