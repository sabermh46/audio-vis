import { clamp } from '../utils/format.js';

// Percentile of each channel's non-silent frames taken as its adaptive noise
// floor. 0.5 (median) is a robust "typical level" the Strength knob scales.
const FLOOR_PCT = 0.5;
// Frames at/below this (0..1) are treated as silence and excluded from the
// percentile, so quiet passages don't drag the floor toward zero.
const SILENCE_EPS = 0.02;

export const DEFAULT_CLEANUP = Object.freeze({
  enabled: true,
  strength: 0,        // 0 = no-op; scales how much of the adaptive floor to subtract
  mode: 'adaptive',   // 'adaptive' | 'fixed'
  fixedFloor: 0.1,    // used when mode === 'fixed'
});

/**
 * Per-signal "self codec": downward-expansion noise gate applied to the
 * already-extracted analysis envelopes. For each conditionable channel it
 * precomputes an adaptive noise floor (a low percentile of that channel over
 * the whole track) once, then at sample time subtracts the resolved floor and
 * rescales: out = max(0, (v - floor) / (1 - floor)).
 *
 * Because the browser already holds the entire decoded analysis, the adaptive
 * floor is exactly as precise as one computed server-side — no server change.
 *
 * Channel keys match the signal namespace: 'onset', 'harmonic', 'percussive',
 * 'volume', 'band.bass|mid|treble', 'stem.vocals|drums|bass|other'.
 */
export class SignalConditioner {
  #floors = new Map();   // channel -> adaptive floor (0..1)
  #config = { ...DEFAULT_CLEANUP };

  constructor(analysis) {
    if (analysis) this.#computeFloors(analysis);
  }

  /** Live config update; floors are track-derived so no recompute is needed. */
  setConfig(config) {
    this.#config = { ...DEFAULT_CLEANUP, ...(config ?? {}) };
  }

  get config() { return { ...this.#config }; }

  /** Resolved 0..1 floor for a channel under the current config. */
  floorFor(channel) {
    if (this.#config.mode === 'fixed') return clamp(this.#config.fixedFloor, 0, 0.999);
    const adaptive = this.#floors.get(channel) ?? 0;
    return clamp(adaptive * this.#config.strength, 0, 0.999);
  }

  /** Downward-expand a 0..1 value for `channel`. No-op when disabled/floor 0. */
  apply(channel, value) {
    if (!this.#config.enabled) return value;
    const floor = this.floorFor(channel);
    if (floor <= 0) return value;
    return clamp((value - floor) / (1 - floor), 0, 1);
  }

  /** Build the channel->array map from a decoded analysis and percentile each. */
  #computeFloors(a) {
    const channels = {
      onset: a.onset,
      harmonic: a.harmonic,
      percussive: a.percussive,
      volume: a.rms,
      'band.bass': a.bands?.bass,
      'band.mid': a.bands?.mid,
      'band.treble': a.bands?.treble,
    };
    if (a.stems) {
      channels['stem.vocals'] = a.stems.vocals;
      channels['stem.drums'] = a.stems.drums;
      channels['stem.bass'] = a.stems.bass;
      channels['stem.other'] = a.stems.other;
    }
    for (const [name, data] of Object.entries(channels)) {
      if (data && data.length) this.#floors.set(name, percentileU8(data, FLOOR_PCT));
    }
  }
}

/**
 * Percentile (0..1) of a uint8 array, over non-silent samples only, returned
 * on the 0..1 scale. O(n) via a 256-bucket histogram — no sorting/allocation.
 */
function percentileU8(data, pct) {
  const hist = new Uint32Array(256);
  const gate = SILENCE_EPS * 255;
  let count = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v > gate) { hist[v]++; count++; }
  }
  if (!count) return 0;
  const target = pct * count;
  let cum = 0;
  for (let b = 0; b < 256; b++) {
    cum += hist[b];
    if (cum >= target) return b / 255;
  }
  return 1;
}
