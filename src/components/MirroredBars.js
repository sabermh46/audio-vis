import { VisualizerComponent } from './VisualizerComponent.js';

const BARS = 16;

/**
 * A symmetric bar cluster mirrored around its center (default: vocals).
 * Bar heights come from a slice of the spectrum scaled by the resolved
 * signal, so it shows spectral shape AND reacts to the bound stem/band.
 */
export class MirroredBars extends VisualizerComponent {
  static get meta() {
    return {
      type: 'mirroredBars',
      name: 'Mirrored Bars',
      defaults: { x: 0.5, y: 0.5, size: 0.4, color: '#00cec9', baseIntensity: 0.3, sensitivity: 1, opacity: 1 },
      defaultSignal: 'stem.vocals',
      signals: VisualizerComponent.meta.signals,
    };
  }

  static renderIcon(ctx, w, h) {
    ctx.fillStyle = '#00cec9';
    const n = 5;
    const bw = w / (n * 2 + 1);
    for (let i = 0; i < n; i++) {
      const bh = h * (0.2 + 0.6 * Math.abs(Math.sin(i + 1)));
      ctx.fillRect(w / 2 + i * bw, (h - bh) / 2, bw * 0.8, bh);
      ctx.fillRect(w / 2 - (i + 1) * bw, (h - bh) / 2, bw * 0.8, bh);
    }
  }

  #heights = new Float32Array(BARS);

  render(ctx, frame, layout, { signal, raw, params, opacity = 1 }) {
    const span = layout.size * 2;        // total width
    const gap = span / BARS * 0.3;
    const bw = (span / BARS) - gap;
    const maxH = layout.size * 0.9;
    const bars = frame.bars;
    const drive = Math.max(signal, raw * 0.3); // stay alive even at low intensity

    ctx.fillStyle = params.color;
    ctx.shadowColor = params.color;
    ctx.shadowBlur = 6 + signal * 18;
    ctx.globalAlpha = (0.4 + signal * 0.6) * opacity;

    for (let i = 0; i < BARS; i++) {
      // Sample the spectrum (skip the very lowest bins for visual interest).
      const specIdx = Math.floor((i / BARS) * (bars.length - 4)) + 2;
      const target = (bars[specIdx] ?? 0) * drive;
      this.#heights[i] += (target - this.#heights[i]) * 0.4;
      const bh = Math.max(2, this.#heights[i] * maxH);

      const xR = layout.x + i * (bw + gap) + gap / 2;
      const xL = layout.x - (i + 1) * (bw + gap) + gap / 2;
      ctx.fillRect(xR, layout.y - bh, bw, bh);          // right, up
      ctx.fillRect(xR, layout.y, bw, bh);               // right, down (mirror)
      ctx.fillRect(xL, layout.y - bh, bw, bh);          // left, up
      ctx.fillRect(xL, layout.y, bw, bh);               // left, down
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
}
