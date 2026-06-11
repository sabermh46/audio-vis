import { Visualizer } from './Visualizer.js';

/**
 * Time-domain oscilloscope: the raw waveform as a glowing line, with
 * stroke color and glow driven by band energies.
 */
export class WaveformVisualizer extends Visualizer {
  static get meta() {
    return {
      id: 'waveform',
      name: 'Waveform',
      description: 'Oscilloscope line that glows with the music',
    };
  }

  static renderPreview(ctx, width, height) {
    ctx.strokeStyle = '#00cec9';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(0, 206, 201, 0.6)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    for (let x = 0; x <= width; x++) {
      const t = x / width;
      const y =
        height / 2 +
        Math.sin(t * Math.PI * 6) * height * 0.22 * Math.sin(t * Math.PI) +
        Math.sin(t * Math.PI * 23) * height * 0.06;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  render(ctx, frame, dt, { width, height }) {
    const { waveform, bands } = frame;

    ctx.clearRect(0, 0, width, height);

    const midY = height / 2;
    const amp = height * 0.38;
    const step = waveform.length / width;

    // Color drifts from purple (bass-heavy) toward teal (treble-heavy).
    const trebleBias = Math.min(1, bands.treble * 2);
    const r = Math.round(108 + (0 - 108) * trebleBias);
    const g = Math.round(92 + (206 - 92) * trebleBias);
    const b = Math.round(231 + (201 - 231) * trebleBias);

    ctx.lineWidth = 2 + bands.bass * 3;
    ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.7)`;
    ctx.shadowBlur = 8 + bands.bass * 24;
    ctx.lineJoin = 'round';

    ctx.beginPath();
    for (let x = 0; x < width; x++) {
      const sample = waveform[Math.floor(x * step)] / 128 - 1; // -1..1
      const y = midY + sample * amp;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Faint center line for the idle/quiet state.
    ctx.strokeStyle = 'rgba(138, 145, 165, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();
  }
}
