import { VisualizerComponent } from './VisualizerComponent.js';

const DOTS = 7;

/**
 * Dots orbiting the anchor (default: the "other" stem — guitars/synths).
 * Orbit radius, angular speed and dot size all grow with the signal.
 */
export class OrbitDots extends VisualizerComponent {
  static get meta() {
    return {
      type: 'orbitDots',
      name: 'Orbit Dots',
      defaults: { x: 0.5, y: 0.5, size: 0.22, color: '#feca57', baseIntensity: 0.3, sensitivity: 1, opacity: 1 },
      defaultSignal: 'stem.other',
      signals: VisualizerComponent.meta.signals,
    };
  }

  static renderIcon(ctx, w, h) {
    ctx.strokeStyle = 'rgba(254,202,87,0.4)';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#feca57';
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(w / 2 + Math.cos(a) * w * 0.3, h / 2 + Math.sin(a) * w * 0.3, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  #angle = 0;

  render(ctx, frame, layout, { signal, params, dt, opacity = 1 }) {
    this.#angle += dt * (0.5 + signal * 4);
    const radius = layout.size * (0.5 + signal * 0.6);
    const dotR = layout.size * (0.06 + signal * 0.1);

    ctx.fillStyle = params.color;
    ctx.shadowColor = params.color;
    ctx.shadowBlur = 8 + signal * 24;
    ctx.globalAlpha = (0.4 + signal * 0.6) * opacity;

    for (let i = 0; i < DOTS; i++) {
      const a = this.#angle + (i / DOTS) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(layout.x + Math.cos(a) * radius, layout.y + Math.sin(a) * radius, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
}
