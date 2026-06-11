import { EventEmitter } from './EventEmitter.js';

/**
 * The render layer: owns the only canvas and the only rAF loop.
 * Each tick it polls the FeatureExtractor and hands the frame to the
 * active visualizer. Handles DPR-aware resizing and fullscreen.
 *
 * Events: 'tick' (per frame — App uses it to refresh the time display)
 */
export class VisualizerHost extends EventEmitter {
  #extractor;
  #container = null;
  #canvas = null;
  #ctx = null;
  #visualizer = null;
  #resizeObserver = null;
  #rafId = 0;
  #running = false;
  #lastTime = 0;
  #width = 0;
  #height = 0;

  constructor(extractor) {
    super();
    this.#extractor = extractor;
  }

  attach(container) {
    this.#container = container;
    this.#canvas = document.createElement('canvas');
    container.appendChild(this.#canvas);
    this.#ctx = this.#canvas.getContext('2d');

    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(container);
    this.#resize();
  }

  setVisualizer(visualizer) {
    this.#visualizer?.onDestroy();
    this.#visualizer = visualizer;
    this.#clear();
    visualizer?.onInit(this.#ctx, this.#width, this.#height);
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    this.#lastTime = performance.now();
    this.#rafId = requestAnimationFrame(this.#tick);
  }

  stop() {
    this.#running = false;
    cancelAnimationFrame(this.#rafId);
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else this.#container.requestFullscreen();
  }

  #tick = (now) => {
    if (!this.#running) return;
    const dt = Math.min((now - this.#lastTime) / 1000, 0.1);
    this.#lastTime = now;

    this.#extractor.update(now);
    if (this.#visualizer) {
      this.#visualizer.render(this.#ctx, this.#extractor.frame, dt, {
        width: this.#width,
        height: this.#height,
      });
    }
    this.emit('tick');
    this.#rafId = requestAnimationFrame(this.#tick);
  };

  #resize() {
    const rect = this.#container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.#width = rect.width;
    this.#height = rect.height;
    this.#canvas.width = Math.round(rect.width * dpr);
    this.#canvas.height = Math.round(rect.height * dpr);
    // Visualizers draw in CSS pixels; the transform maps to device pixels.
    this.#ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.#visualizer?.onResize(this.#width, this.#height);
  }

  #clear() {
    this.#ctx.clearRect(0, 0, this.#width, this.#height);
  }

  destroy() {
    this.stop();
    this.#resizeObserver?.disconnect();
    this.#visualizer?.onDestroy();
    this.#visualizer = null;
    this.#canvas?.remove();
    this.removeAllListeners();
  }
}
