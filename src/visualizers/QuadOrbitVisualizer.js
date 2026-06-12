import { Visualizer } from './Visualizer.js';

const STEMS = [
  { key: 'bass', label: 'BASS', color: [108, 92, 231] },
  { key: 'vocals', label: 'VOCALS', color: [240, 130, 170] },
  { key: 'drums', label: 'DRUMS', color: [0, 206, 201] },
  { key: 'other', label: 'OTHER', color: [142, 125, 240] },
];

const BARS_PER_ARM = 12;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function rgba([r, g, b], alpha) {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Four stem-reactive orbiting bar arms with a rotating core.
 * Each arm maps to one separated stem and spins at a different pace,
 * so the motion feels layered instead of just scaling in place.
 */
export class QuadOrbitVisualizer extends Visualizer {
  static get meta() {
    return {
      id: 'quad-orbit',
      name: 'Quad Orbit Bars',
      description: 'Four rotating bar arms driven by bass, vocals, drums and other',
    };
  }

  static renderPreview(ctx, width, height) {
    const centerX = width / 2;
    const centerY = height / 2;
    const outer = Math.min(width, height) * 0.34;

    ctx.clearRect(0, 0, width, height);
    const bg = ctx.createRadialGradient(centerX, centerY, 8, centerX, centerY, outer * 1.7);
    bg.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
    bg.addColorStop(0.45, 'rgba(108, 92, 231, 0.16)');
    bg.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(232, 235, 244, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, outer, 0, Math.PI * 2);
    ctx.stroke();

    for (let i = 0; i < STEMS.length; i++) {
      const armAngle = (i / STEMS.length) * Math.PI * 2 - Math.PI / 2;
      const [r, g, b] = STEMS[i].color;
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(armAngle);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.75)`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(outer * 0.16, 0);
      ctx.lineTo(outer * 0.9, 0);
      ctx.stroke();

      for (let j = 0; j < 6; j++) {
        const t = j / 5;
        const x = outer * (0.28 + t * 0.6);
        const h = 4 + (1 - t) * 8;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.25 + (1 - t) * 0.35})`;
        ctx.fillRect(x, -h / 2, 4, h);
      }
      ctx.restore();
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, outer * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }

  #phase = 0;
  #armPhase = [0, 0, 0, 0];

  onInit() {
    this.#phase = 0;
    this.#armPhase = [0, 0, 0, 0];
  }

  render(ctx, frame, dt, { width, height }) {
    const { stems, beat, volume, onset, percussive, harmonic } = frame;
    const centerX = width / 2;
    const centerY = height / 2;
    const minDim = Math.min(width, height);
    const outer = minDim * 0.33;
    const core = minDim * (0.07 + volume * 0.02 + (beat ? 0.015 : 0));

    this.#phase += dt * (0.45 + volume * 0.55 + harmonic * 0.25);
    for (let i = 0; i < this.#armPhase.length; i++) {
      const spin = 0.2 + i * 0.08 + stems[STEMS[i].key] * 0.6 + percussive * 0.15;
      this.#armPhase[i] += dt * spin;
    }

    ctx.clearRect(0, 0, width, height);

    const bg = ctx.createRadialGradient(centerX, centerY, minDim * 0.04, centerX, centerY, minDim * 0.82);
    bg.addColorStop(0, 'rgba(14, 17, 27, 0.96)');
    bg.addColorStop(0.5, 'rgba(11, 13, 20, 0.94)');
    bg.addColorStop(1, 'rgba(6, 8, 12, 1)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const pulse = 1 + Math.max(0, beat ? 0.22 : onset * 0.08) + volume * 0.08;
    const ringGlow = ctx.createRadialGradient(centerX, centerY, core * 0.3, centerX, centerY, outer * 1.1);
    ringGlow.addColorStop(0, `rgba(255, 255, 255, ${0.3 + volume * 0.2})`);
    ringGlow.addColorStop(0.24, 'rgba(108, 92, 231, 0.16)');
    ringGlow.addColorStop(0.6, 'rgba(0, 206, 201, 0.1)');
    ringGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = ringGlow;
    ctx.beginPath();
    ctx.arc(centerX, centerY, outer * 1.05, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(232, 235, 244, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, outer, 0, Math.PI * 2);
    ctx.stroke();

    for (let i = 0; i < STEMS.length; i++) {
      const stem = STEMS[i];
      const energy = stems[stem.key];
      const [r, g, b] = stem.color;
      const baseAngle = (i / STEMS.length) * Math.PI * 2 - Math.PI / 2;
      const armAngle = baseAngle + this.#armPhase[i];
      const armLength = outer * (0.92 + energy * 0.18);
      const armWidth = 2 + energy * 2.5;
      const start = outer * 0.18;

      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(armAngle);

      ctx.shadowColor = rgba(stem.color, 0.65);
      ctx.shadowBlur = 16 + energy * 26;

      ctx.strokeStyle = rgba(stem.color, 0.24 + energy * 0.3);
      ctx.lineWidth = armWidth;
      ctx.beginPath();
      ctx.moveTo(start, 0);
      ctx.lineTo(armLength, 0);
      ctx.stroke();

      const barArea = armLength - start;
      const barSpacing = barArea / BARS_PER_ARM;
      for (let j = 0; j < BARS_PER_ARM; j++) {
        const t = j / (BARS_PER_ARM - 1);
        const barEnergy = clamp(energy * (0.45 + (1 - t) * 0.75) + volume * 0.08 + onset * 0.12, 0.05, 1);
        const barH = outer * (0.05 + barEnergy * 0.28 + (1 - t) * 0.04);
        const x = start + j * barSpacing;
        const wobble = Math.sin(this.#phase * 2 + j * 0.45 + i) * outer * 0.01;

        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.18 + barEnergy * 0.75})`;
        ctx.fillRect(x + wobble, -barH / 2, barSpacing * 0.46, barH);
      }

      ctx.restore();
    }

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(-this.#phase * 0.35);
    ctx.strokeStyle = 'rgba(232, 235, 244, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, outer * 0.46, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0, 206, 201, 0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-core * pulse, 0);
    ctx.lineTo(core * pulse, 0);
    ctx.moveTo(0, -core * pulse);
    ctx.lineTo(0, core * pulse);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.beginPath();
    ctx.arc(0, 0, core * pulse * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(232, 235, 244, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, outer * (0.2 * i), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.fillStyle = 'rgba(232, 235, 244, 0.45)';
    ctx.font = '12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('QUAD ORBIT BARS', centerX, height - Math.max(18, height * 0.08));
    ctx.restore();
  }

  onDestroy() {
    this.#armPhase = [0, 0, 0, 0];
  }
}