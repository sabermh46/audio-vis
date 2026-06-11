import { Visualizer } from './Visualizer.js';

const SHAPES = [
  { band: 'bass', label: 'BASS', color: [108, 92, 231], x: 0.25 },
  { band: 'mid', label: 'VOCAL', color: [142, 125, 240], x: 0.5 },
  { band: 'treble', label: 'TREBLE', color: [0, 206, 201], x: 0.75 },
];

const MAX_RIPPLES = 8;

/**
 * One shape per frequency band, each scaling with its own energy:
 * an oval for bass, a diamond for the mid/vocal range, a triangle for
 * treble. Beats spawn expanding ripple rings from the bass oval.
 */
export class ShapesVisualizer extends Visualizer {
  static get meta() {
    return {
      id: 'shapes',
      name: 'Band Shapes',
      description: 'Oval, diamond and triangle pulse with bass, vocals and treble',
    };
  }

  static renderPreview(ctx, width, height) {
    const y = height * 0.46;
    ctx.fillStyle = 'rgba(108, 92, 231, 0.9)';
    ctx.beginPath();
    ctx.ellipse(width * 0.25, y, 22, 15, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(142, 125, 240, 0.9)';
    ctx.save();
    ctx.translate(width * 0.5, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-11, -11, 22, 22);
    ctx.restore();

    ctx.fillStyle = 'rgba(0, 206, 201, 0.9)';
    ctx.beginPath();
    ctx.moveTo(width * 0.75, y - 14);
    ctx.lineTo(width * 0.75 + 13, y + 10);
    ctx.lineTo(width * 0.75 - 13, y + 10);
    ctx.closePath();
    ctx.fill();
  }

  #ripples = [];
  #spin = 0;

  render(ctx, frame, dt, { width, height }) {
    const { bands, beat } = frame;

    ctx.clearRect(0, 0, width, height);

    const centerY = height * 0.48;
    const baseR = Math.min(width / 8, height / 5) * 0.55;

    // The diamond slowly spins, faster when vocals are loud.
    this.#spin += dt * (0.3 + bands.mid * 2.5);

    if (beat) {
      this.#ripples.push({ r: baseR * (1 + bands.bass), alpha: 0.55 });
      if (this.#ripples.length > MAX_RIPPLES) this.#ripples.shift();
    }

    // Beat ripples expand outward from the bass oval.
    const bassX = SHAPES[0].x * width;
    for (const ripple of this.#ripples) {
      ripple.r += dt * baseR * 4;
      ripple.alpha -= dt * 0.9;
      if (ripple.alpha <= 0) continue;
      ctx.strokeStyle = `rgba(108, 92, 231, ${ripple.alpha.toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(bassX, centerY, ripple.r * 1.25, ripple.r, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.#ripples = this.#ripples.filter((r) => r.alpha > 0);

    for (const shape of SHAPES) {
      const energy = bands[shape.band];
      const x = shape.x * width;
      const [r, g, b] = shape.color;
      const scale = 1 + energy * 1.6;

      // Resting-size outline so the pulse always has a visible reference.
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.22)`;
      ctx.lineWidth = 1.5;
      this.#tracePath(ctx, shape.band, x, centerY, baseR);
      ctx.stroke();

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${(0.35 + energy * 0.65).toFixed(3)})`;
      ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.8)`;
      ctx.shadowBlur = 10 + energy * 45;
      this.#tracePath(ctx, shape.band, x, centerY, baseR * scale);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.fillStyle = `rgba(232, 235, 244, ${(0.25 + energy * 0.5).toFixed(3)})`;
      ctx.font = '11px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.letterSpacing = '3px';
      ctx.fillText(shape.label, x, centerY + baseR * 2.7 + 16);
    }
  }

  /** Begins and traces the band's shape path, sized by radius. */
  #tracePath(ctx, band, x, y, radius) {
    ctx.beginPath();
    if (band === 'bass') {
      ctx.ellipse(x, y, radius * 1.35, radius, 0, 0, Math.PI * 2);
    } else if (band === 'mid') {
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
    } else {
      const s = radius * 1.1;
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s * 0.87, y + s * 0.5);
      ctx.lineTo(x - s * 0.87, y + s * 0.5);
      ctx.closePath();
    }
  }

  onDestroy() {
    this.#ripples = [];
  }
}
