import { VisualizerComponent } from './VisualizerComponent.js';

const PARTICLES = 170;
const TWIST = 2.4;
const Z_MIN = 0.02;

// Sky/river clip line as a fraction of canvas height (0 = top, 1 = bottom).
// Stars only draw ABOVE this — raise it to let stars reach lower, lower it to
// keep them higher in the sky. 0.34 matches RiverNight's far-bank horizon.
// This is the single knob to tune the clipping threshold.
const SKY_HORIZON = 0.34;

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function smoothstep(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }

/**
 * The Hyperspace spiral-warp effect packaged as a placeable element: particles
 * are born at the element's center and accelerate outward along rotating
 * spiral arms within its radius (layout.size). The bound signal drives the
 * warp + spin speed and every beat snaps the rotation forward; hue cycles.
 */
export class Starfield extends VisualizerComponent {
  static get meta() {
    return {
      type: 'starfield',
      name: 'Starfield Warp',
      // Defaults suit a sky placement: centered high, clipped to the sky band
      // via `horizon` (fraction of height) so stars never spill over the river.
      defaults: { x: 0.5, y: 0.18, size: 0.55, color: '#6c5ce7', baseIntensity: 0.5, sensitivity: 1, opacity: 1, horizon: SKY_HORIZON },
      defaultSignal: 'volume',
      signals: VisualizerComponent.meta.signals,
    };
  }

  static renderIcon(ctx, w, h) {
    ctx.fillStyle = '#6c5ce7';
    for (let i = 0; i < 40; i++) {
      const d = i / 40;
      const ang = i * 0.5 + d * TWIST * 2;
      const r = (w * 0.45) * Math.pow(d, 1.7);
      ctx.globalAlpha = 0.3 + d * 0.6;
      ctx.beginPath();
      ctx.arc(w / 2 + Math.cos(ang) * r, h / 2 + Math.sin(ang) * r, 0.6 + d * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  #particles = null;
  #spin = 0;
  #hue = 0;
  #beatEnv = 0;

  #spawn(z = 1) {
    return {
      z,
      angle: Math.random() * Math.PI * 2,
      speed: 0.6 + Math.random() * 0.9,
      hue: Math.random() * 60 - 30,
      size: 0.7 + Math.random() * 0.8,
    };
  }

  render(ctx, frame, layout, { signal, beat, dt, opacity = 1, params }) {
    if (!this.#particles) {
      this.#particles = Array.from({ length: PARTICLES }, () => this.#spawn(Math.random()));
    }
    if (beat) this.#beatEnv = 1;
    this.#beatEnv = Math.max(0, this.#beatEnv - dt * 2.6);

    const spinVel = 0.2 + signal * 1.4 + this.#beatEnv * 2.2;
    this.#spin += spinVel * dt;
    const warp = 0.12 + signal * 0.4 + this.#beatEnv * 0.7;
    this.#hue = (this.#hue + (24 + this.#beatEnv * 40) * dt) % 360;

    const cx = layout.x;
    const cy = layout.y;
    const maxR = layout.size;

    // Confine the stars to the sky: clip to the band above `horizon` so they
    // never draw over the river below. (The compositor's save/restore around
    // this component undoes the clip afterwards.)
    const horizon = (params?.horizon ?? SKY_HORIZON) * layout.height;
    ctx.beginPath();
    ctx.rect(0, 0, layout.width, horizon);
    ctx.clip();

    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.#particles) {
      p.z -= warp * p.speed * dt;
      if (p.z <= Z_MIN) { Object.assign(p, this.#spawn(1)); continue; }

      const depth = 1 - p.z;
      const r = maxR * Math.pow(depth, 1.7);
      const ang = p.angle + this.#spin + depth * TWIST;
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r;

      const alpha = smoothstep(0, 0.1, depth) * (1 - smoothstep(0.82, 1, depth)) * opacity;
      if (alpha <= 0.01) continue;

      const size = (0.6 + depth * 3) * p.size * (1 + this.#beatEnv * 0.3);
      const hue = (this.#hue + p.hue + depth * 70) % 360;
      const light = 50 + depth * 22;

      const depthPrev = clamp(1 - (p.z + warp * p.speed * dt * 3.5), 0, 1);
      const rPrev = maxR * Math.pow(depthPrev, 1.7);
      const angPrev = p.angle + this.#spin + depthPrev * TWIST;
      ctx.strokeStyle = `hsla(${hue}, 92%, ${light}%, ${(alpha * 0.5).toFixed(3)})`;
      ctx.lineWidth = size * 0.7;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angPrev) * rPrev, cy + Math.sin(angPrev) * rPrev);
      ctx.lineTo(x, y);
      ctx.stroke();

      ctx.fillStyle = `hsla(${hue}, 92%, ${light}%, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  onDestroy() { this.#particles = null; }
}
