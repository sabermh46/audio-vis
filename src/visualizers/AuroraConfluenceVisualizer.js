import { Visualizer } from './Visualizer.js';

const MAX_PARTICLES = 26;
const MAX_TRAIL = 96;
const ORBITERS = 6;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Six-layer aurora bloom: core pulse, orbit ring, halo, spectral ribbons,
 * radial sparks, drifting particles, and a flowing waveform band. Each layer
 * keys off a different audio feature so the composition feels alive rather
 * than just amplified.
 */
export class AuroraConfluenceVisualizer extends Visualizer {
  static get meta() {
    return {
      id: 'aurora',
      name: 'Aurora Confluence',
      description: 'Six reactive layers that bloom, orbit and ripple with the audio',
    };
  }

  static renderPreview(ctx, width, height) {
    const centerX = width / 2;
    const centerY = height / 2;

    const halo = ctx.createRadialGradient(centerX, centerY, 8, centerX, centerY, 52);
    halo.addColorStop(0, 'rgba(255, 255, 255, 0.14)');
    halo.addColorStop(0.35, 'rgba(108, 92, 231, 0.22)');
    halo.addColorStop(1, 'rgba(0, 206, 201, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 54, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0, 206, 201, 0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 34, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(232, 235, 244, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 44, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(108, 92, 231, 0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      const x = t * width;
      const y = centerY + Math.sin(t * Math.PI * 6) * 8;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(0, 206, 201, 0.9)';
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const x = centerX + Math.cos(angle) * 60;
      const y = centerY + Math.sin(angle) * 60;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(240, 130, 170, 0.45)';
    for (let i = 0; i < 4; i++) {
      const x = 20 + i * 42;
      const y = 18 + (i % 2) * 14;
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  #particles = [];
  #trail = [];
  #orbiters = [];
  #phase = 0;
  #beatPulse = 0;

  onInit() {
    this.#particles = [];
    this.#trail = [];
    this.#orbiters = Array.from({ length: ORBITERS }, (_, index) => ({
      angle: (index / ORBITERS) * Math.PI * 2,
      radius: 0.28 + index * 0.045,
      speed: 0.35 + index * 0.08,
      wobble: 0.6 + index * 0.12,
    }));
  }

  render(ctx, frame, dt, { width, height }) {
    const { bars, bands, waveform, beat, volume, onset, harmonic, percussive, stems } = frame;
    const centerX = width / 2;
    const centerY = height / 2;
    const minDim = Math.min(width, height);
    const bass = bands.bass;
    const mid = bands.mid;
    const treble = bands.treble;
    const glow = clamp(volume * 1.1 + harmonic * 0.35, 0, 1);

    this.#phase += dt * (0.35 + mid * 1.8 + percussive * 0.9);
    this.#beatPulse = Math.max(0, this.#beatPulse - dt * 1.6);
    if (beat) this.#beatPulse = 1;

    ctx.clearRect(0, 0, width, height);

    const bg = ctx.createRadialGradient(centerX, centerY, minDim * 0.05, centerX, centerY, minDim * 0.8);
    bg.addColorStop(0, `rgba(${Math.round(32 + bass * 45)}, ${Math.round(26 + mid * 24)}, ${Math.round(50 + treble * 24)}, 0.92)`);
    bg.addColorStop(0.45, 'rgba(13, 16, 24, 0.88)');
    bg.addColorStop(1, 'rgba(7, 9, 14, 0.98)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const spine = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, minDim * 0.33);
    spine.addColorStop(0, `rgba(255, 255, 255, ${0.16 + glow * 0.1})`);
    spine.addColorStop(0.28, `rgba(108, 92, 231, ${0.2 + bass * 0.14})`);
    spine.addColorStop(0.63, `rgba(0, 206, 201, ${0.14 + treble * 0.12})`);
    spine.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = spine;
    ctx.beginPath();
    ctx.arc(centerX, centerY, minDim * 0.34, 0, Math.PI * 2);
    ctx.fill();

    const orbRadius = minDim * (0.075 + bass * 0.04 + this.#beatPulse * 0.02);
    const orbGlow = ctx.createRadialGradient(centerX, centerY, orbRadius * 0.15, centerX, centerY, orbRadius * 2.8);
    orbGlow.addColorStop(0, `rgba(255, 255, 255, ${0.65 + glow * 0.15})`);
    orbGlow.addColorStop(0.3, `rgba(240, 130, 170, ${0.32 + harmonic * 0.2})`);
    orbGlow.addColorStop(0.68, `rgba(108, 92, 231, ${0.28 + bass * 0.24})`);
    orbGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = orbGlow;
    ctx.beginPath();
    ctx.arc(centerX, centerY, orbRadius * 2.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(255, 255, 255, ${0.5 + glow * 0.25})`;
    ctx.beginPath();
    ctx.arc(centerX, centerY, orbRadius * (0.48 + glow * 0.1), 0, Math.PI * 2);
    ctx.fill();

    const ringOuter = minDim * (0.2 + bass * 0.08 + this.#beatPulse * 0.05);
    const ringInner = minDim * (0.13 + mid * 0.04);
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(this.#phase * 0.2);
    ctx.strokeStyle = `rgba(232, 235, 244, ${0.38 + glow * 0.18})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([10 + bass * 14, 16]);
    ctx.lineDashOffset = -this.#phase * 40;
    ctx.beginPath();
    ctx.arc(0, 0, ringOuter, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(0, 206, 201, ${0.18 + treble * 0.38})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, ringInner, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.setLineDash([]);

    const ribbonAmp = minDim * (0.04 + percussive * 0.05 + bass * 0.02);
    const ribbonY = centerY + Math.sin(this.#phase * 1.4) * minDim * 0.02;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 206, 201, 0.6)';
    ctx.shadowBlur = 16 + glow * 24;
    ctx.lineWidth = 2 + mid * 3;
    const ribbonGrad = ctx.createLinearGradient(0, ribbonY - ribbonAmp, width, ribbonY + ribbonAmp);
    ribbonGrad.addColorStop(0, 'rgba(108, 92, 231, 0.14)');
    ribbonGrad.addColorStop(0.5, `rgba(0, 206, 201, ${0.55 + treble * 0.2})`);
    ribbonGrad.addColorStop(1, 'rgba(240, 130, 170, 0.12)');
    ctx.strokeStyle = ribbonGrad;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 8) {
      const t = x / width;
      const sample = waveform[Math.min(waveform.length - 1, Math.floor(t * (waveform.length - 1)))] / 128 - 1;
      const wave = Math.sin(t * Math.PI * 10 + this.#phase * 2.2) * ribbonAmp;
      const y = ribbonY + sample * ribbonAmp * 1.2 + wave;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    const spikeCount = Math.min(24, bars.length);
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(-this.#phase * 0.12);
    for (let i = 0; i < spikeCount; i++) {
      const barIndex = Math.floor((i / spikeCount) * bars.length);
      const v = bars[barIndex];
      const length = ringOuter * (0.72 + v * 1.9);
      const angle = (i / spikeCount) * Math.PI * 2;
      const pulse = 1 + this.#beatPulse * 0.3 * (0.6 + v);
      const x = Math.cos(angle) * ringOuter * 0.78;
      const y = Math.sin(angle) * ringOuter * 0.78;
      const alpha = 0.08 + v * 0.42 + onset * 0.12;
      ctx.strokeStyle = `rgba(${Math.round(108 + treble * 80)}, ${Math.round(92 + mid * 120)}, ${Math.round(231 - bass * 50)}, ${alpha.toFixed(3)})`;
      ctx.lineWidth = 1 + v * 2.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(Math.cos(angle) * length * pulse, Math.sin(angle) * length * pulse);
      ctx.stroke();
    }
    ctx.restore();

    if (this.#trail.length >= MAX_TRAIL) this.#trail.shift();
    this.#trail.push({
      x: centerX + Math.sin(this.#phase * 1.9) * ringOuter * (0.55 + stems.vocals * 0.25),
      y: centerY + Math.cos(this.#phase * 1.2) * ringOuter * (0.45 + stems.drums * 0.3),
      size: 1.3 + harmonic * 2.8,
      alpha: 0.25 + glow * 0.35,
    });
    ctx.save();
    ctx.shadowColor = 'rgba(240, 130, 170, 0.7)';
    ctx.shadowBlur = 10;
    for (let i = 0; i < this.#trail.length; i++) {
      const point = this.#trail[i];
      const alpha = (point.alpha * i) / this.#trail.length;
      ctx.fillStyle = `rgba(240, 130, 170, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(point.x, point.y, point.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (this.#particles.length < MAX_PARTICLES && (beat || onset > 0.2 || Math.random() < 0.08)) {
      const angle = Math.random() * Math.PI * 2;
      const radius = ringOuter * (0.9 + Math.random() * 0.6);
      this.#particles.push({
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
        vx: Math.cos(angle + Math.PI / 2) * (0.22 + treble * 0.25),
        vy: Math.sin(angle + Math.PI / 2) * (0.22 + treble * 0.25),
        life: 0.9 + Math.random() * 0.9,
        size: 1 + Math.random() * 2.5,
      });
    }
    for (const particle of this.#particles) {
      particle.x += particle.vx * dt * (26 + mid * 18);
      particle.y += particle.vy * dt * (26 + mid * 18);
      particle.life -= dt * (0.45 + percussive * 0.2);
    }
    this.#particles = this.#particles.filter((particle) => particle.life > 0);

    ctx.save();
    ctx.shadowColor = 'rgba(0, 206, 201, 0.75)';
    ctx.shadowBlur = 12;
    for (let i = 0; i < this.#particles.length; i++) {
      const particle = this.#particles[i];
      const alpha = clamp(particle.life, 0, 1);
      ctx.fillStyle = `rgba(0, 206, 201, ${(alpha * 0.8).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const swirl = ctx.createLinearGradient(centerX - ringOuter, centerY - ringOuter, centerX + ringOuter, centerY + ringOuter);
    swirl.addColorStop(0, `rgba(108, 92, 231, ${0.15 + bass * 0.18})`);
    swirl.addColorStop(0.52, `rgba(240, 130, 170, ${0.08 + harmonic * 0.14})`);
    swirl.addColorStop(1, `rgba(0, 206, 201, ${0.15 + treble * 0.18})`);
    ctx.strokeStyle = swirl;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const t = i / 64;
      const angle = t * Math.PI * 2 + this.#phase * 0.8;
      const wobble = Math.sin(t * Math.PI * 8 + this.#phase * 2.6) * ringOuter * 0.045;
      const radius = ringOuter * (0.92 + Math.sin(t * Math.PI * 4 + this.#phase) * 0.04) + wobble;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius * 0.88;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(232, 235, 244, ${0.42 + glow * 0.2})`;
    ctx.font = '12px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('AURORA CONFLUENCE', centerX, height - Math.max(18, height * 0.08));
    ctx.restore();
  }

  onDestroy() {
    this.#particles = [];
    this.#trail = [];
    this.#orbiters = [];
  }
}