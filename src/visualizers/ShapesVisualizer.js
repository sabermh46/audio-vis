import { Visualizer } from './Visualizer.js';

const SHAPES = [
  { stem: 'bass', label: 'BASS', color: [108, 92, 231], x: 0.2, path: 'oval' },
  { stem: 'vocals', label: 'VOCALS', color: [240, 130, 170], x: 0.4, path: 'diamond' },
  { stem: 'drums', label: 'DRUMS', color: [0, 206, 201], x: 0.6, path: 'triangle' },
  { stem: 'other', label: 'OTHER', color: [142, 125, 240], x: 0.8, path: 'ring' },
];

const MAX_RIPPLES = 8;

/**
 * One shape per instrument stem, each scaling with its own energy:
 * oval = bass, diamond = vocals, triangle = drums, ring = other
 * (guitars/synths/keys). With ML analysis these are true separated stems;
 * in realtime mode they fall back to DSP proxies. Beats spawn ripple rings
 * from the drums triangle (beats are drums-derived in ML mode).
 */
export class ShapesVisualizer extends Visualizer {
  static get meta() {
    return {
      id: 'shapes',
      name: 'Stem Shapes',
      description: 'Four shapes pulse with bass, vocals, drums and the rest',
    };
  }

  static renderPreview(ctx, width, height) {
    const y = height * 0.46;
    ctx.fillStyle = 'rgba(108, 92, 231, 0.9)';
    ctx.beginPath();
    ctx.ellipse(width * 0.2, y, 17, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(240, 130, 170, 0.9)';
    ctx.save();
    ctx.translate(width * 0.4, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-9, -9, 18, 18);
    ctx.restore();

    ctx.fillStyle = 'rgba(0, 206, 201, 0.9)';
    ctx.beginPath();
    ctx.moveTo(width * 0.6, y - 12);
    ctx.lineTo(width * 0.6 + 11, y + 8);
    ctx.lineTo(width * 0.6 - 11, y + 8);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(142, 125, 240, 0.9)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(width * 0.8, y, 10, 0, Math.PI * 2);
    ctx.stroke();
  }

  #ripples = [];
  #spin = 0;

  render(ctx, frame, dt, { width, height }) {
    const { stems, beat } = frame;

    ctx.clearRect(0, 0, width, height);

    const centerY = height * 0.48;
    const baseR = Math.min(width / 10, height / 5) * 0.55;

    // The vocals diamond slowly spins, faster when vocals are loud.
    this.#spin += dt * (0.3 + stems.vocals * 2.5);

    // Beat ripples expand from the drums triangle (beats come from the
    // drums stem in ML mode).
    if (beat) {
      this.#ripples.push({ r: baseR * (1 + stems.drums), alpha: 0.55 });
      if (this.#ripples.length > MAX_RIPPLES) this.#ripples.shift();
    }
    const drumsX = SHAPES.find((s) => s.stem === 'drums').x * width;
    for (const ripple of this.#ripples) {
      ripple.r += dt * baseR * 4;
      ripple.alpha -= dt * 0.9;
      if (ripple.alpha <= 0) continue;
      ctx.strokeStyle = `rgba(0, 206, 201, ${ripple.alpha.toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(drumsX, centerY, ripple.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.#ripples = this.#ripples.filter((r) => r.alpha > 0);

    for (const shape of SHAPES) {
      const energy = stems[shape.stem];
      const x = shape.x * width;
      const [r, g, b] = shape.color;
      const scale = 1 + energy * 1.6;

      // Resting-size outline so the pulse always has a visible reference.
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.22)`;
      ctx.lineWidth = 1.5;
      this.#tracePath(ctx, shape.path, x, centerY, baseR);
      ctx.stroke();

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${(0.35 + energy * 0.65).toFixed(3)})`;
      ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.8)`;
      ctx.shadowBlur = 10 + energy * 45;
      this.#tracePath(ctx, shape.path, x, centerY, baseR * scale);
      ctx.fill(shape.path === 'ring' ? 'evenodd' : 'nonzero');
      ctx.shadowBlur = 0;

      ctx.fillStyle = `rgba(232, 235, 244, ${(0.25 + energy * 0.5).toFixed(3)})`;
      ctx.font = '11px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.letterSpacing = '3px';
      ctx.fillText(shape.label, x, centerY + baseR * 2.7 + 16);
    }
  }

  /** Begins and traces the named shape path, sized by radius. */
  #tracePath(ctx, path, x, y, radius) {
    ctx.beginPath();
    if (path === 'oval') {
      ctx.ellipse(x, y, radius * 1.35, radius, 0, 0, Math.PI * 2);
    } else if (path === 'diamond') {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(this.#spin);
      const s = radius * 0.9;
      ctx.moveTo(0, -s);
      ctx.lineTo(s, 0);
      ctx.lineTo(0, s);
      ctx.lineTo(-s, 0);
      ctx.closePath();
      ctx.restore();
    } else if (path === 'triangle') {
      const s = radius * 1.1;
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s * 0.87, y + s * 0.5);
      ctx.lineTo(x - s * 0.87, y + s * 0.5);
      ctx.closePath();
    } else {
      // Ring: outer + inner circle, filled with the even-odd rule.
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.moveTo(x + radius * 0.55, y);
      ctx.arc(x, y, radius * 0.55, 0, Math.PI * 2);
    }
  }

  onDestroy() {
    this.#ripples = [];
  }
}
