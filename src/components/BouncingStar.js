import { VisualizerComponent } from './VisualizerComponent.js';

const POINTS = 5;

/**
 * A big star that scales and bounces with its signal (default: bass).
 * Spring-smoothed so it overshoots and settles rather than snapping.
 */
export class BouncingStar extends VisualizerComponent {
  static get meta() {
    return {
      type: 'bouncingStar',
      name: 'Bouncing Star',
      defaults: { x: 0.5, y: 0.6, size: 0.18, color: '#6c5ce7', baseIntensity: 0.3, sensitivity: 1 },
      defaultSignal: 'stem.bass',
      signals: VisualizerComponent.meta.signals,
    };
  }

  static renderIcon(ctx, w, h) {
    drawStar(ctx, w / 2, h / 2, w * 0.32, w * 0.14, 0);
    ctx.fillStyle = '#6c5ce7';
    ctx.fill();
  }

  #scale = 0;   // smoothed
  #vel = 0;     // spring velocity
  #spin = 0;

  render(ctx, frame, layout, { signal, params, dt }) {
    // Spring toward the signal for a bouncy feel.
    const target = signal;
    const k = 90;   // stiffness
    const d = 12;   // damping
    this.#vel += (k * (target - this.#scale) - d * this.#vel) * dt;
    this.#scale += this.#vel * dt;
    this.#spin += dt * (0.2 + signal * 1.5);

    const outer = layout.size * (0.55 + this.#scale * 0.7);
    const inner = outer * 0.44;

    ctx.translate(layout.x, layout.y);
    ctx.rotate(this.#spin);
    ctx.shadowColor = params.color;
    ctx.shadowBlur = 12 + signal * 40;
    ctx.fillStyle = params.color;
    ctx.globalAlpha = 0.35 + signal * 0.65;
    drawStar(ctx, 0, 0, outer, inner, 0);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
}

function drawStar(ctx, cx, cy, outer, inner, rot) {
  ctx.beginPath();
  for (let i = 0; i < POINTS * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rot + (i / (POINTS * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}
