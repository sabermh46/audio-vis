import { Visualizer } from './Visualizer.js';

const PEAK_FALL_SPEED = 0.35;   // peak caps fall this fraction of height per second
const PEAK_HOLD_S = 0.4;

/**
 * Classic spectrum analyzer: logarithmically-spaced frequency bars with
 * gradient coloring, peak-hold caps, and a subtle beat glow.
 */
export class BarsVisualizer extends Visualizer {
  static get meta() {
    return {
      id: 'bars',
      name: 'Frequency Bars',
      description: 'Log-spaced spectrum bars with peak caps',
    };
  }

  static renderPreview(ctx, width, height) {
    const n = 24;
    const gap = 2;
    const barW = (width - gap * (n + 1)) / n;
    const grad = ctx.createLinearGradient(0, height, 0, 0);
    grad.addColorStop(0, '#6c5ce7');
    grad.addColorStop(1, '#00cec9');
    ctx.fillStyle = grad;
    for (let i = 0; i < n; i++) {
      // Deterministic pseudo-random heights shaped like a music spectrum.
      const t = i / n;
      const h = height * (0.15 + 0.75 * Math.abs(Math.sin(i * 2.7 + 1)) * (1 - t * 0.55));
      ctx.fillRect(gap + i * (barW + gap), height - h, barW, h);
    }
  }

  #peaks = null;
  #peakTimers = null;
  #beatGlow = 0;

  onInit(ctx, width, height) {
    this.#peaks = null; // lazily sized to frame.bars length on first render
  }

  render(ctx, frame, dt, { width, height }) {
    const { bars, beat } = frame;
    const n = bars.length;

    if (!this.#peaks || this.#peaks.length !== n) {
      this.#peaks = new Float32Array(n);
      this.#peakTimers = new Float32Array(n);
    }

    ctx.clearRect(0, 0, width, height);

    if (beat) this.#beatGlow = 1;
    this.#beatGlow = Math.max(0, this.#beatGlow - dt * 3);

    const padX = Math.max(12, width * 0.03);
    const baseY = height - Math.max(16, height * 0.06);
    const usableW = width - padX * 2;
    const gap = Math.max(1, usableW / n * 0.25);
    const barW = (usableW - gap * (n - 1)) / n;
    const maxH = baseY - height * 0.08;

    const grad = ctx.createLinearGradient(0, baseY, 0, baseY - maxH);
    grad.addColorStop(0, '#6c5ce7');
    grad.addColorStop(0.6, '#8e7df0');
    grad.addColorStop(1, '#00cec9');

    // Beat glow: brief shadow bloom on every bar.
    ctx.shadowColor = 'rgba(108, 92, 231, 0.8)';
    ctx.shadowBlur = this.#beatGlow * 18;

    ctx.fillStyle = grad;
    for (let i = 0; i < n; i++) {
      const v = bars[i];
      const h = Math.max(2, v * maxH);
      const x = padX + i * (barW + gap);
      ctx.fillRect(x, baseY - h, barW, h);

      // Peak caps: hold briefly, then fall.
      if (v >= this.#peaks[i]) {
        this.#peaks[i] = v;
        this.#peakTimers[i] = PEAK_HOLD_S;
      } else if (this.#peakTimers[i] > 0) {
        this.#peakTimers[i] -= dt;
      } else {
        this.#peaks[i] = Math.max(v, this.#peaks[i] - PEAK_FALL_SPEED * dt);
      }
    }

    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(232, 235, 244, 0.85)';
    for (let i = 0; i < n; i++) {
      if (this.#peaks[i] <= 0.01) continue;
      const x = padX + i * (barW + gap);
      const y = baseY - this.#peaks[i] * maxH;
      ctx.fillRect(x, y - 3, barW, 2);
    }
  }

  onDestroy() {
    this.#peaks = null;
    this.#peakTimers = null;
  }
}
