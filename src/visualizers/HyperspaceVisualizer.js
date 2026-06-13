import { Visualizer } from './Visualizer.js';

const PARTICLES = 360;

// Motion tuning (all per-second where it matters). Forward speed reduced 20%.
const WARP_BASE = 0.144;    // baseline forward speed (depth units / s)
const WARP_VOL = 0.36;      // loudness adds forward speed
const WARP_KICK = 0.72;     // beat adds a forward surge
const SPIN_BASE = 0.25;     // baseline spiral rotation (rad / s)
const SPIN_BASS = 1.6;      // bass winds the spiral faster
const SPIN_KICK = 2.6;      // beat snaps the rotation forward
const TWIST = 2.4;          // how much a particle's angle advances as it flies out (spiral arc)
const HUE_RATE = 26;        // degrees / s continuous hue drift
const HUE_KICK = 40;        // beat jumps the hue
const Z_MIN = 0.02;         // depth at which a particle has passed the camera → respawn

// The dots are split into three equal groups, each driven by its own sound
// element, so the groups travel at different rates as the mix shifts.
const GROUPS = ['vocals', 'bass', 'treble'];
const GROUP_BASE = 0.7;     // baseline share of warp speed for a group
const GROUP_GAIN = 0.9;     // extra speed when that group's element is loud

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// 0 below edge0, 1 above edge1, smooth in between.
function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * A warp flight down a spiral tunnel: particles are born at the center and
 * accelerate outward along rotating spiral arms, so it feels like travelling
 * through space. Hue drifts continuously; bass winds the spiral tighter and
 * every beat snaps the rotation forward and surges the warp speed.
 */
export class HyperspaceVisualizer extends Visualizer {
  static get meta() {
    return {
      id: 'hyperspace',
      name: 'Hyperspace',
      description: 'Warp through a hue-shifting spiral starfield; rotation surges on the beat',
    };
  }

  static renderPreview(ctx, width, height) {
    const cx = width / 2;
    const cy = height / 2;
    ctx.fillStyle = '#05060c';
    ctx.fillRect(0, 0, width, height);
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, width * 0.4);
    glow.addColorStop(0, 'rgba(150,210,255,0.5)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 90; i++) {
      const d = (i / 90);
      const ang = i * 0.5 + d * TWIST * 2;
      const r = (width * 0.5) * Math.pow(d, 1.7);
      const hue = (i * 4) % 360;
      ctx.fillStyle = `hsla(${hue}, 90%, 62%, ${0.3 + d * 0.6})`;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, 0.8 + d * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  #particles = [];
  #spin = 0;       // accumulated rotation (radians)
  #hue = 0;        // global hue (degrees)
  #beatEnv = 0;    // decays after each beat, drives kicks/glow

  onInit() {
    // Distribute depths across the tunnel so the field is full immediately;
    // split the dots evenly across the three sound groups (i % 3).
    this.#particles = Array.from({ length: PARTICLES },
      (_, i) => this.#spawn(Math.random(), GROUPS[i % GROUPS.length]));
  }

  #spawn(z = 1, group = 'vocals') {
    return {
      z,
      group,                              // 'vocals' | 'bass' | 'treble' (preserved on respawn)
      angle: Math.random() * Math.PI * 2,
      speed: 0.6 + Math.random() * 0.9,   // per-particle warp multiplier
      hue: Math.random() * 60 - 30,       // per-particle hue offset
      size: 0.7 + Math.random() * 0.8,
    };
  }

  render(ctx, frame, dt, { width, height }) {
    const { bands, stems, volume, beat } = frame;
    const bass = bands.bass;

    // Each dot group follows its own element; the glow/spin use volume/bass.
    const energy = {
      vocals: stems?.vocals ?? bands.mid,
      bass: stems?.bass ?? bands.bass,
      treble: bands.treble,
    };

    if (beat) this.#beatEnv = 1;
    this.#beatEnv = Math.max(0, this.#beatEnv - dt * 2.6);

    // Rotation speed rises with bass and snaps forward on the beat — this is
    // what makes the spiral feel like it accelerates to the music.
    const spinVel = SPIN_BASE + bass * SPIN_BASS + this.#beatEnv * SPIN_KICK;
    this.#spin += spinVel * dt;

    const warp = WARP_BASE + volume * WARP_VOL + this.#beatEnv * WARP_KICK;
    this.#hue = (this.#hue + (HUE_RATE + this.#beatEnv * HUE_KICK) * dt) % 360;

    const cx = width / 2;
    const cy = height / 2;
    const maxR = Math.hypot(width, height) * 0.6; // overshoot edges so stars fly past
    const minDim = Math.min(width, height);

    // Trail fade instead of a hard clear — leaves motion streaks (warp feel).
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(4, 5, 11, 0.32)';
    ctx.fillRect(0, 0, width, height);

    // Central glow — the light we're flying toward; pulses with the beat.
    const glowR = minDim * (0.18 + volume * 0.22 + this.#beatEnv * 0.12);
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    glow.addColorStop(0, `hsla(${this.#hue}, 80%, 70%, ${0.35 + this.#beatEnv * 0.3})`);
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();

    // Additive particles for luminous overlap.
    ctx.globalCompositeOperation = 'lighter';

    for (const p of this.#particles) {
      // This particle's forward speed is gated by its own sound group, so the
      // three groups visibly travel at different rates as the mix shifts.
      const pWarp = warp * p.speed * (GROUP_BASE + energy[p.group] * GROUP_GAIN);
      p.z -= pWarp * dt;
      if (p.z <= Z_MIN) {
        Object.assign(p, this.#spawn(1, p.group)); // keep its group → counts stay even
        continue;
      }

      const depth = 1 - p.z;                 // 0 at center, →1 approaching camera
      const r = maxR * Math.pow(depth, 1.7); // perspective: slow near center, fast at edge
      // Angle advances with depth (spiral arc) plus the global rotation.
      const ang = p.angle + this.#spin + depth * TWIST;
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r;

      // Fade in from the center, fade out as it passes the edge.
      const alpha = smoothstep(0, 0.1, depth) * (1 - smoothstep(0.82, 1, depth));
      if (alpha <= 0.01) continue;

      const size = (0.8 + depth * 3.6) * p.size * (1 + this.#beatEnv * 0.3);
      const hue = (this.#hue + p.hue + depth * 70) % 360;
      const light = 50 + depth * 22;

      // Streak from where it was a moment ago → longer when warping faster.
      const depthPrev = clamp(1 - (p.z + pWarp * dt * 3.5), 0, 1);
      const rPrev = maxR * Math.pow(depthPrev, 1.7);
      const angPrev = p.angle + this.#spin + depthPrev * TWIST;
      ctx.strokeStyle = `hsla(${hue}, 92%, ${light}%, ${alpha * 0.5})`;
      ctx.lineWidth = size * 0.7;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angPrev) * rPrev, cy + Math.sin(angPrev) * rPrev);
      ctx.lineTo(x, y);
      ctx.stroke();

      ctx.fillStyle = `hsla(${hue}, 92%, ${light}%, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  onDestroy() {
    this.#particles = [];
  }
}
