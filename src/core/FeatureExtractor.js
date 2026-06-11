import { lerp } from '../utils/format.js';

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

const BEAT_HISTORY = 43;          // ~0.7s of frames at 60fps
const BEAT_THRESHOLD = 1.35;      // bass must exceed 1.35x its recent average
const BEAT_MIN_LEVEL = 0.3;
const BEAT_REFRACTORY_MS = 200;

/**
 * Polls an AnalyserNode once per frame and derives visualization features:
 * logarithmically-binned bars, per-band energies (bass / mid-vocal / treble),
 * and simple bass-flux beat detection.
 *
 * The `frame` object and all arrays are preallocated and reused — zero
 * allocation inside the rAF loop.
 */
export class FeatureExtractor {
  #analyser;
  #freqData;
  #timeData;
  #numBars;
  #fMin;
  #fMax;
  #barRanges = [];   // per bar: [binLow, binHigh] fractional indices
  #bandRanges = {};  // per band: [intLow, intHigh] integer indices
  #bassHistory = new Float32Array(BEAT_HISTORY);
  #bassHistoryIdx = 0;
  #bassHistoryCount = 0;
  #lastBeatAt = -Infinity;

  frame = {
    bars: null,
    bands: { bass: 0, mid: 0, treble: 0 },
    bandsRaw: { bass: 0, mid: 0, treble: 0 },
    waveform: null,
    beat: false,
    volume: 0,
  };

  constructor(analyser, { numBars = 64, fMin = 20, fMax = 20000 } = {}) {
    this.#analyser = analyser;
    this.#freqData = new Uint8Array(analyser.frequencyBinCount);
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

  update(nowMs) {
    this.#analyser.getByteFrequencyData(this.#freqData);
    this.#analyser.getByteTimeDomainData(this.#timeData);

    const { bars, bands, bandsRaw } = this.frame;

    for (let k = 0; k < this.#numBars; k++) {
      const [bLow, bHigh] = this.#barRanges[k];
      let target;
      if (bHigh - bLow < 1) {
        // Several bottom bars can share one FFT bin — interpolate at the
        // range midpoint so adjacent bars aren't identical.
        target = this.#sampleSpectrum((bLow + bHigh) / 2) / 255;
      } else {
        // Max (not mean) across the range: mean dilutes transients.
        let max = 0;
        const end = Math.min(Math.ceil(bHigh), this.#freqData.length - 1);
        for (let i = Math.floor(bLow); i <= end; i++) {
          if (this.#freqData[i] > max) max = this.#freqData[i];
        }
        target = max / 255;
      }
      const rate = target > bars[k] ? BAR_ATTACK : BAR_RELEASE;
      bars[k] += (target - bars[k]) * rate;
    }

    let totalSum = 0;
    for (const name of Object.keys(BANDS)) {
      const [lo, hi] = this.#bandRanges[name];
      let sum = 0;
      for (let i = lo; i <= hi; i++) sum += this.#freqData[i];
      const raw = sum / ((hi - lo + 1) * 255);
      bandsRaw[name] = raw;
      const rate = raw > bands[name] ? BAND_ATTACK : BAND_RELEASE;
      bands[name] += (raw - bands[name]) * rate;
      totalSum += raw;
    }
    this.frame.volume = totalSum / 3;

    this.frame.beat = this.#detectBeat(bandsRaw.bass, nowMs);
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
