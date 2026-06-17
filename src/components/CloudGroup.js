import { VisualizerComponent } from './VisualizerComponent.js';

const CLOUDS = 6;
const DRIFT_BASE = 0.025;  // normalized widths / second at rest
const DRIFT_GAIN = 0.13;   // extra drift speed from the bound signal

/**
 * A group of flat cartoon clouds (lumpy top, flat bottom) drifting steadily
 * left→right across the sky. The drift speed is driven by the bound signal —
 * louder → faster — so the clouds carry the motion of the chosen sound. Only
 * the clouds move.
 */
export class CloudGroup extends VisualizerComponent {
  static get meta() {
    return {
      type: 'clouds',
      name: 'Cloud Group',
      defaults: { x: 0.5, y: 0.2, size: 0.16, color: '#ffffff', baseIntensity: 0.5, sensitivity: 1, opacity: 0.92 },
      defaultSignal: 'volume',
      signals: VisualizerComponent.meta.signals,
    };
  }

  static renderIcon(ctx, w, h) {
    ctx.fillStyle = '#ffffff';
    CloudGroup.#path(ctx, w / 2, h * 0.6, w * 0.7, h * 0.5,
      [{ ox: -0.32, r: 0.5 }, { ox: -0.05, r: 0.95 }, { ox: 0.28, r: 0.6 }]);
    ctx.fill();
  }

  #clouds = null;

  #spawn(x) {
    const rnd = Math.random;
    const n = 4 + Math.floor(rnd() * 3);
    const bumps = Array.from({ length: n }, (_, i) => ({
      ox: (i / (n - 1) - 0.5) * 0.9,
      r: 0.5 + rnd() * 0.5,
    }));
    // Make the tallest bump sit near the middle for a natural cloud profile.
    bumps[Math.floor(n / 2)].r = 0.95 + rnd() * 0.2;
    return {
      x: x ?? Math.random() * 1.2 - 0.1,  // world x in ~[-0.1, 1.1]
      yb: (Math.random() - 0.5) * 1.2,    // vertical offset within the band
      scale: 0.55 + Math.random() * 0.9,  // size variety (big + small clouds)
      bumps,
    };
  }

  render(ctx, frame, layout, { signal, params, dt, opacity = 1 }) {
    if (!this.#clouds) {
      this.#clouds = Array.from({ length: CLOUDS }, () => this.#spawn());
    }

    const speed = DRIFT_BASE + signal * DRIFT_GAIN; // sound-driven left→right drift
    const alpha = opacity;

    for (const c of this.#clouds) {
      c.x += speed * dt;
      if (c.x > 1.15) Object.assign(c, this.#spawn(-0.15)); // wrap off-right → re-enter left

      const W = layout.size * c.scale * 2.4;
      const H = layout.size * c.scale;
      const cx = c.x * layout.width;
      const cy = layout.y + c.yb * layout.size;
      const baseY = cy + H * 0.35;

      // Build the whole cloud as ONE path and fill once → uniform alpha, no
      // internal seams from overlapping sub-shapes.
      ctx.fillStyle = this.#rgba(params.color, alpha);
      CloudGroup.#path(ctx, cx, baseY, W, H, c.bumps);
      ctx.fill();
    }
  }

  /** Adds a flat-bottomed, lumpy-topped cloud to the current path (no fill). */
  static #path(ctx, cx, baseY, W, H, bumps) {
    const slabH = H * 0.5;
    const left = cx - W / 2;
    const right = cx + W / 2;
    ctx.beginPath();
    // Flat slab with rounded ends.
    ctx.moveTo(left + slabH / 2, baseY);
    ctx.lineTo(right - slabH / 2, baseY);
    ctx.arc(right - slabH / 2, baseY - slabH / 2, slabH / 2, Math.PI / 2, -Math.PI / 2, true);
    ctx.lineTo(left + slabH / 2, baseY - slabH);
    ctx.arc(left + slabH / 2, baseY - slabH / 2, slabH / 2, -Math.PI / 2, Math.PI / 2, true);
    // Lumpy top bumps (each a separate subpath; flat bottoms at baseY).
    for (const b of bumps) {
      const br = b.r * H * 0.62;
      const bx = cx + b.ox * W;
      const by = baseY - br;
      ctx.moveTo(bx + br, by);
      ctx.arc(bx, by, br, 0, Math.PI * 2);
    }
  }

  #rgba(hex, a) {
    const h = String(hex).replace('#', '');
    const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16) || 0;
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  onDestroy() { this.#clouds = null; }
}
