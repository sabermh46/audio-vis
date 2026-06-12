import { SIGNALS } from './SignalResolver.js';

/**
 * Base class for scene elements — small reactive shapes composited on top of
 * a base visualizer by SceneCompositor. Components are dumb renderers: the
 * compositor resolves the bound signal and intensity envelope and hands the
 * final 0..1 drive in via `resolved`. They never own a canvas or rAF loop,
 * and (like BarsVisualizer) lazily initialise per-instance smoothing state on
 * first render rather than in an onInit hook.
 */
export class VisualizerComponent {
  static get meta() {
    return {
      type: 'base',
      name: 'Component',
      defaults: { x: 0.5, y: 0.5, size: 0.25, color: '#6c5ce7', baseIntensity: 0.3, sensitivity: 1, opacity: 1 },
      defaultSignal: 'volume',
      signals: SIGNALS,
    };
  }

  /** Optional: draw a small glyph for the editor palette. */
  static renderIcon(ctx, width, height) {} // eslint-disable-line no-unused-vars

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} frame  the analysis frame (for raw spectrum access, e.g. bars)
   * @param {{x,y,size,width,height}} layout  CSS-px center, size, and stage dims
   * @param {{signal,raw,intensity,beat,params,dt}} resolved
   *   signal = clamp(raw * sensitivity * intensity) — the final 0..1 drive
   */
  render(ctx, frame, layout, resolved) {}

  onResize(width, height) {}

  onDestroy() {}
}
