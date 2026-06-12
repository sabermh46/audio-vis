import { VisualizerComponent } from './VisualizerComponent.js';

const MAX_RINGS = 10;

/**
 * Expanding rings spawned on each beat (default signal: drums). The bound
 * signal's intensity gates spawning and scales brightness, so painting a
 * full-intensity region makes the rings fire boldly only there.
 */
export class PulseRing extends VisualizerComponent {
  static get meta() {
    return {
      type: 'pulseRing',
      name: 'Pulse Ring',
      defaults: { x: 0.5, y: 0.5, size: 0.3, color: '#e056fd', baseIntensity: 0.3, sensitivity: 1 },
      defaultSignal: 'stem.drums',
      signals: VisualizerComponent.meta.signals,
    };
  }

  static renderIcon(ctx, w, h) {
    ctx.strokeStyle = '#e056fd';
    ctx.lineWidth = 2;
    for (const r of [0.18, 0.32, 0.46]) {
      ctx.globalAlpha = 1 - r;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w * r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  #rings = [];
  #cooldown = 0;

  render(ctx, frame, layout, { signal, intensity, beat, params, dt }) {
    this.#cooldown -= dt;
    // Spawn on a beat (or a strong signal swell) while reasonably intense.
    if ((beat || signal > 0.6) && intensity > 0.12 && this.#cooldown <= 0) {
      this.#rings.push({ r: layout.size * 0.15, alpha: 0.4 + signal * 0.6 });
      if (this.#rings.length > MAX_RINGS) this.#rings.shift();
      this.#cooldown = 0.08;
    }

    ctx.strokeStyle = params.color;
    ctx.shadowColor = params.color;
    for (const ring of this.#rings) {
      ring.r += dt * layout.size * 2.2;
      ring.alpha -= dt * 0.8;
      if (ring.alpha <= 0) continue;
      ctx.globalAlpha = ring.alpha;
      ctx.lineWidth = 1 + signal * 3;
      ctx.shadowBlur = 10 * ring.alpha;
      ctx.beginPath();
      ctx.arc(layout.x, layout.y, ring.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.#rings = this.#rings.filter((r) => r.alpha > 0);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  onDestroy() {
    this.#rings = [];
  }
}
