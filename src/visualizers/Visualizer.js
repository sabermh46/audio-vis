/**
 * Abstract base class for visualizers. Subclasses draw into a 2D context
 * provided by VisualizerHost — they never own a canvas or a rAF loop.
 *
 * Subclasses must override `static get meta()` with { id, name, description }
 * and `render()`. `renderPreview` is an optional static hook used by the
 * template gallery to draw a stylized still preview (no audio available).
 */
export class Visualizer {
  static get meta() {
    return { id: 'base', name: 'Visualizer', description: '' };
  }

  /** Optional: draw a static preview for the gallery card. */
  static renderPreview(ctx, width, height) {} // eslint-disable-line no-unused-vars

  /** One-time setup after being attached to the host. */
  onInit(ctx, width, height) {}

  /**
   * Called every animation frame.
   * @param {CanvasRenderingContext2D} ctx - draw in CSS pixels (DPR pre-applied)
   * @param {object} frame - AnalysisSource frame:
   *   bars: Float32Array       0..1 log-spaced spectrum, per-bar normalized
   *   bands: {bass,mid,treble} 0..1 normalized + smoothed
   *   bandsRaw: {...}          normalized, unsmoothed
   *   waveform: Uint8Array     live time-domain samples (128 = silence)
   *   beat: boolean            true on the frame a beat fires
   *   volume: number           0..1 overall loudness (not normalized)
   *   onset: number            0..1 percussive-onset strength
   *   harmonic: number         0..1 melodic/vocal energy (≈ bands.mid in realtime mode)
   *   percussive: number       0..1 drum energy (= onset in realtime mode)
   *   tempo: number            BPM from offline analysis; 0 in realtime mode
   *   stems: {vocals,drums,bass,other}  0..1 per-instrument energy — true ML
   *     stem separation when the server analyzed with ML, DSP proxies otherwise
   * @param {number} dt - seconds since last frame
   * @param {{width: number, height: number}} size - CSS pixel dimensions
   */
  render(ctx, frame, dt, size) {}

  /** Called when the canvas resizes; dimensions are CSS pixels. */
  onResize(width, height) {}

  /** Release any internal resources. */
  onDestroy() {}
}
