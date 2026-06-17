import { Visualizer } from './Visualizer.js';

const HORIZON = 0.34;            // sky/water split as a fraction of height
const STARS = 170;
const STAR_TWIST = 2.4;
const STAR_ZMIN = 0.02;

function clamp01(v) { return Math.min(1, Math.max(0, v)); }
function smoothstep(e0, e1, x) { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); }

/**
 * A still night scene for "Ghorgari" — looking up across a river. From bottom
 * to top: a randomly curved near bank, the river (flowing left→right), the
 * barely-visible far bank with static tree silhouettes, and the night sky.
 *
 * A spiral starfield warp is baked INTO the sky layer (drawn before the far
 * bank + trees, clipped to the sky) so the trees occlude it — something a
 * separate overlay component can't do. The starfield is driven by keyframable
 * base params (see `static params`); standalone gallery use falls back to the
 * declared defaults.
 */
export class RiverNightVisualizer extends Visualizer {
  static get meta() {
    return {
      id: 'river-night',
      name: 'River Night',
      description: 'A moonlit river beneath a starfield sky, far bank and trees',
    };
  }

  static get params() {
    return [
      { key: 'starIntensity', label: 'Star intensity', min: 0, max: 1, default: 0.7 },
      { key: 'starDensity', label: 'Star density', min: 0, max: 1, default: 0.8 },
      { key: 'starHue', label: 'Star hue', min: 0, max: 360, default: 250 },
      { key: 'warpSpeed', label: 'Warp speed', min: 0, max: 2, default: 1 },
    ];
  }

  static renderPreview(ctx, width, height) {
    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, '#0a0f1e');
    g.addColorStop(0.5, '#16203a');
    g.addColorStop(1, '#05080f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(150,200,255,0.85)';
    for (let i = 0; i < 18; i++) {
      const d = i / 18;
      const a = i * 0.7 + d * STAR_TWIST * 2;
      const r = width * 0.18 * Math.pow(d, 1.6);
      ctx.beginPath();
      ctx.arc(width * 0.5 + Math.cos(a) * r, height * 0.18 + Math.sin(a) * r * 0.7, 0.6 + d * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(150,180,220,0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const y = height * (0.45 + i * 0.12);
      ctx.beginPath();
      for (let x = 0; x <= width; x += 6) ctx.lineTo(x, y + Math.sin(x * 0.08 + i) * 2);
      ctx.stroke();
    }
  }

  #time = 0;
  #ripples = [];   // flowing highlight lines on the water
  #glints = [];    // drifting specular dashes
  #trees = [];     // static far-bank tree silhouettes
  #bankPts = [];   // near-bank curve control points (normalized)
  #stars = null;   // baked spiral starfield particles (lazy)
  #spin = 0;
  #starHueDrift = 0;
  #beatEnv = 0;

  constructor() {
    super();
    const rnd = Math.random;
    // Horizontal moonlight ripple lines spread through the water band.
    this.#ripples = Array.from({ length: 9 }, (_, i) => ({
      y: 0.40 + (i / 9) * 0.46,             // normalized y within the water
      amp: 1.5 + rnd() * 3,                  // px (scaled by height later)
      k: 0.012 + rnd() * 0.02,               // spatial frequency
      speed: 0.5 + rnd() * 1.1,              // phase speed (rightward flow)
      phase: rnd() * Math.PI * 2,
      bright: 0.06 + rnd() * 0.12,
    }));
    // Drifting glints (specular sparkles travelling left→right).
    this.#glints = Array.from({ length: 40 }, () => ({
      x: rnd(), y: 0.42 + rnd() * 0.44, len: 6 + rnd() * 14,
      speed: 0.02 + rnd() * 0.05, a: 0.1 + rnd() * 0.25,
    }));
    // Static far-bank trees at the horizon.
    this.#trees = Array.from({ length: 14 }, () => ({
      x: rnd(), h: 0.02 + rnd() * 0.05, w: 0.01 + rnd() * 0.02,
    }));
    // Random smooth near-bank silhouette (a few control points).
    this.#bankPts = Array.from({ length: 7 }, (_, i) => ({
      x: i / 6, y: 0.86 + (Math.random() - 0.5) * 0.06,
    }));
  }

  render(ctx, frame, dt, { width, height }, params) {
    this.#time += dt;
    const shimmer = 0.6 + (frame.volume ?? 0) * 0.6; // faint life from the mix
    const horizonY = height * HORIZON;

    // --- Sky ---
    const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
    sky.addColorStop(0, '#070b18');
    sky.addColorStop(1, '#1b2740');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, horizonY + 1);

    // --- Baked starfield (sky layer, BEFORE the trees so they occlude it) ---
    this.#renderStars(ctx, frame, dt, width, height, horizonY, params ?? {});

    // --- Far bank + static trees (barely visible) ---
    ctx.fillStyle = '#0b1322';
    ctx.fillRect(0, horizonY - height * 0.015, width, height * 0.03);
    ctx.fillStyle = '#060a14';
    for (const t of this.#trees) {
      const x = t.x * width;
      const h = t.h * height;
      const w = t.w * width;
      ctx.beginPath();
      ctx.moveTo(x, horizonY);
      ctx.lineTo(x - w, horizonY);
      ctx.lineTo(x, horizonY - h);
      ctx.lineTo(x + w, horizonY);
      ctx.closePath();
      ctx.fill();
    }

    // --- River water (the only moving part) ---
    const waterTop = horizonY;
    const waterBottom = height * 0.9;
    const water = ctx.createLinearGradient(0, waterTop, 0, waterBottom);
    water.addColorStop(0, '#18263f');   // moonlit near the far bank
    water.addColorStop(0.5, '#0d1830');
    water.addColorStop(1, '#070d1c');   // darker toward the viewer
    ctx.fillStyle = water;
    ctx.fillRect(0, waterTop, width, waterBottom - waterTop);

    // Flowing ripple highlight lines — crests travel left→right. Perspective:
    // lines near the viewer (lower) are bolder, brighter and wavier; they thin
    // and fade toward the far bank (up) for a sense of depth.
    for (const r of this.#ripples) {
      const frac = (r.y - 0.40) / (0.86 - 0.40);        // 0 = far/top, 1 = near/bottom
      const y = waterTop + frac * (waterBottom - waterTop);
      const phase = r.phase - this.#time * r.speed;      // negative → pattern moves +x
      const amp = r.amp * (0.5 + frac * 1.2);            // bigger waves up close
      ctx.lineWidth = 0.4 + frac * 2.4;                  // bold at the bottom, thin at the top
      ctx.strokeStyle = `rgba(170,200,240,${(r.bright * shimmer * (0.45 + frac)).toFixed(3)})`;
      ctx.beginPath();
      for (let x = 0; x <= width; x += 10) {
        const yy = y + Math.sin(x * r.k + phase) * amp;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }

    // Drifting specular glints — also bolder/longer near the viewer.
    ctx.strokeStyle = 'rgba(210,225,255,0.5)';
    for (const gl of this.#glints) {
      const frac = (gl.y - 0.40) / (0.86 - 0.40);
      const x = ((gl.x + this.#time * gl.speed) % 1) * width;
      const y = waterTop + frac * (waterBottom - waterTop);
      ctx.lineWidth = 0.5 + frac * 1.5;
      ctx.globalAlpha = gl.a * shimmer * (0.4 + frac);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + gl.len * (0.6 + frac), y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // --- Near bank (random smooth curve), static silhouette ---
    ctx.fillStyle = '#04070e';
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(0, this.#bankPts[0].y * height);
    for (let i = 1; i < this.#bankPts.length; i++) {
      const p0 = this.#bankPts[i - 1];
      const p1 = this.#bankPts[i];
      const mx = ((p0.x + p1.x) / 2) * width;
      const my = ((p0.y + p1.y) / 2) * height;
      ctx.quadraticCurveTo(p0.x * width, p0.y * height, mx, my);
    }
    ctx.lineTo(width, this.#bankPts[this.#bankPts.length - 1].y * height);
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * Spiral starfield warp, clipped to the sky band (y < horizonY) so it never
   * spills onto the water; drawn before the trees so they occlude it. Driven
   * by the keyframable base params + live audio (volume/beat).
   */
  #renderStars(ctx, frame, dt, width, height, horizonY, p) {
    const intensity = p.starIntensity ?? 0.7;
    if (intensity <= 0.001) return;
    if (!this.#stars) {
      this.#stars = Array.from({ length: STARS }, () => ({
        z: Math.random(),
        angle: Math.random() * Math.PI * 2,
        speed: 0.6 + Math.random() * 0.9,
        hue: Math.random() * 60 - 30,
        size: 0.7 + Math.random() * 0.8,
      }));
    }
    const density = p.starDensity ?? 0.8;
    const baseHue = p.starHue ?? 250;
    const warpMul = p.warpSpeed ?? 1;
    const vol = frame.volume ?? 0;

    if (frame.beat) this.#beatEnv = 1;
    this.#beatEnv = Math.max(0, this.#beatEnv - dt * 2.6);
    const spinVel = 0.2 + vol * 1.4 + this.#beatEnv * 2.2;
    this.#spin += spinVel * dt;
    const warp = (0.12 + vol * 0.4 + this.#beatEnv * 0.7) * warpMul;
    this.#starHueDrift = (this.#starHueDrift + (8 + this.#beatEnv * 30) * dt) % 360;

    const cx = width * 0.5;
    const cy = horizonY * 0.5;
    const maxR = Math.min(width, horizonY) * 0.95;
    const count = Math.floor(this.#stars.length * density);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, horizonY);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    for (let n = 0; n < count; n++) {
      const s = this.#stars[n];
      s.z -= warp * s.speed * dt;
      if (s.z <= STAR_ZMIN) { s.z = 1; s.angle = Math.random() * Math.PI * 2; }
      const depth = 1 - s.z;
      const r = maxR * Math.pow(depth, 1.7);
      const ang = s.angle + this.#spin + depth * STAR_TWIST;
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r;
      const alpha = smoothstep(0, 0.1, depth) * (1 - smoothstep(0.82, 1, depth)) * intensity;
      if (alpha <= 0.01) continue;
      const size = (0.6 + depth * 2.6) * s.size * (1 + this.#beatEnv * 0.3);
      const hue = (baseHue + this.#starHueDrift + s.hue + depth * 60) % 360;
      const light = 60 + depth * 18;
      ctx.fillStyle = `hsla(${hue}, 90%, ${light}%, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }
}
