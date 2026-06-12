// Light smoothing over the lerped 43fps timeline kills residual flicker
// at 60fps rendering without softening transients much.
const BAND_ATTACK = 0.65;
const BAND_RELEASE = 0.25;
// Stems get a slower release: drum hits are sparse spikes and the shapes
// look better holding for a beat than strobing to zero between hits.
const STEM_ATTACK = 0.65;
const STEM_RELEASE = 0.1;

/**
 * AnalysisSource backed by a precomputed server timeline. Every rAF tick it
 * interpolates the analysis frames at the audio element's currentTime, so
 * visuals stay sample-locked to playback (including seeks and pauses).
 *
 * The live AnalyserNode is still used for `waveform` — playback always
 * happens in the browser; only the spectral analysis is precomputed.
 */
export class PrecomputedAnalysisSource {
  #analysis;
  #getTime;
  #analyser;
  #beatCursor = 0;
  #lastTime = 0;

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

  /**
   * @param {object} analysis - decoded AnalysisClient.analyze() result
   * @param {{getTime: () => number, analyser?: AnalyserNode}} opts
   */
  constructor(analysis, { getTime, analyser = null }) {
    this.#analysis = analysis;
    this.#getTime = getTime;
    this.#analyser = analyser;
    this.frame.bars = new Float32Array(analysis.numBars);
    this.frame.waveform = new Uint8Array(analyser ? analyser.fftSize : 2048);
    if (!analyser) this.frame.waveform.fill(128); // silence midline
    this.frame.tempo = analysis.tempo;
  }

  get numBars() { return this.#analysis.numBars; }

  /** Lerp a 1-D uint8 track at fractional frame f. */
  #track(data, i, frac) {
    const next = Math.min(i + 1, this.#analysis.frames - 1);
    return (data[i] + (data[next] - data[i]) * frac) / 255;
  }

  update() {
    const { fps, frames, numBars, bars, bands, beats } = this.#analysis;
    const t = this.#getTime();

    // Audio duration can exceed analysis length by a partial hop — clamp.
    const f = Math.min(Math.max(t * fps, 0), frames - 1.001);
    const i = Math.floor(f);
    const frac = f - i;

    const next = Math.min(i + 1, frames - 1);
    const rowA = i * numBars;
    const rowB = next * numBars;
    const out = this.frame.bars;
    for (let k = 0; k < numBars; k++) {
      out[k] = (bars[rowA + k] + (bars[rowB + k] - bars[rowA + k]) * frac) / 255;
    }

    for (const name of ['bass', 'mid', 'treble']) {
      const raw = this.#track(bands[name], i, frac);
      this.frame.bandsRaw[name] = raw;
      const current = this.frame.bands[name];
      const rate = raw > current ? BAND_ATTACK : BAND_RELEASE;
      this.frame.bands[name] = current + (raw - current) * rate;
    }

    this.frame.onset = this.#track(this.#analysis.onset, i, frac);
    this.frame.harmonic = this.#track(this.#analysis.harmonic, i, frac);
    this.frame.percussive = this.#track(this.#analysis.percussive, i, frac);
    this.frame.volume = this.#track(this.#analysis.rms, i, frac);

    // Real ML stem energies when present; otherwise the best DSP proxies.
    const stemTracks = this.#analysis.stems;
    for (const name of ['vocals', 'drums', 'bass', 'other']) {
      let raw;
      if (stemTracks) {
        raw = this.#track(stemTracks[name], i, frac);
      } else {
        raw = name === 'vocals' ? this.frame.harmonic
          : name === 'drums' ? this.frame.percussive
          : name === 'bass' ? this.frame.bandsRaw.bass
          : this.frame.bandsRaw.mid;
      }
      const current = this.frame.stems[name];
      const rate = raw > current ? STEM_ATTACK : STEM_RELEASE;
      this.frame.stems[name] = current + (raw - current) * rate;
    }

    // Beat: fired iff a beat timestamp was crossed in (lastTime, t].
    if (t < this.#lastTime - 0.05) {
      // Backward seek — re-sync the cursor to the first beat after t.
      let lo = 0;
      let hi = beats.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (beats[mid] <= t) lo = mid + 1;
        else hi = mid;
      }
      this.#beatCursor = lo;
    }
    let beat = false;
    while (this.#beatCursor < beats.length && beats[this.#beatCursor] <= t) {
      if (beats[this.#beatCursor] > this.#lastTime) beat = true;
      this.#beatCursor++;
    }
    this.frame.beat = beat;
    this.#lastTime = t;

    this.#analyser?.getByteTimeDomainData(this.frame.waveform);
  }
}
