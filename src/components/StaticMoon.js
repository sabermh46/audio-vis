import { VisualizerComponent } from './VisualizerComponent.js';

/**
 * A moon that hangs nearly still — drifting very slowly within a tiny area —
 * while its glow scales up and down with the bound signal. The disc is steady;
 * only the halo breathes.
 */
export class StaticMoon extends VisualizerComponent {
  static get meta() {
    return {
      type: 'moon',
      name: 'Moon',
      defaults: { x: 0.72, y: 0.22, size: 0.07, color: '#fdf4cf', baseIntensity: 0.4, sensitivity: 1, opacity: 1 },
      defaultSignal: 'volume',
      signals: VisualizerComponent.meta.signals,
    };
  }

  static renderIcon(ctx, w, h) {
    const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w * 0.4);
    g.addColorStop(0, '#fdf4cf');
    g.addColorStop(1, 'rgba(253,244,207,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fdf4cf';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }

  #t = 0;

  render(ctx, frame, layout, { signal, params, dt, opacity = 1 }) {
    this.#t += dt;
    // Very slow, very small shake within a small area.
    const a = layout.size * 0.06;
    const cx = layout.x + Math.sin(this.#t * 0.5) * a;
    const cy = layout.y + Math.cos(this.#t * 0.37) * a;
    const rd = layout.size;

    // Glow halo: scales up/down with the signal (additive for bloom).
    const rg = rd * (1.6 + signal * 2.6);
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(cx, cy, rd * 0.5, cx, cy, rg);
    glow.addColorStop(0, this.#rgba(params.color, (0.35 + signal * 0.5) * opacity));
    glow.addColorStop(1, this.#rgba(params.color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, rg, 0, Math.PI * 2);
    ctx.fill();

    // The moon disc itself — steady.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = opacity;
    ctx.fillStyle = params.color;
    ctx.beginPath();
    ctx.arc(cx, cy, rd, 0, Math.PI * 2);
    ctx.fill();
    // A faint darker maria shading for a touch of depth.
    ctx.globalAlpha = opacity * 0.12;
    ctx.fillStyle = '#9a916b';
    ctx.beginPath();
    ctx.arc(cx - rd * 0.25, cy - rd * 0.2, rd * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  #rgba(hex, a) {
    const h = String(hex).replace('#', '');
    const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16) || 0;
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
}
