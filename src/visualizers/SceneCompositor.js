import { Visualizer } from './Visualizer.js';
import { resolveSignal } from '../components/SignalResolver.js';
import { paramAt } from '../components/KeyframeEvaluator.js';
import { migrateScene } from '../components/SceneMigrate.js';
import { clamp } from '../utils/format.js';

/**
 * A Visualizer that composes reactive elements on top of an optional base
 * visualizer. Plugs into VisualizerHost.setVisualizer with no host change.
 * Constructed directly by App (not via the registry) because it needs
 * injected context — notably getTime(), since host.render() passes no time
 * and the intensity automation is evaluated against the audio currentTime
 * (the same pattern PrecomputedAnalysisSource uses).
 *
 * Provides a live mutation API (add/remove/update/setScene/setBase) so the
 * editor can change the composition without rebuilding the compositor.
 */
export class SceneCompositor extends Visualizer {
  static get meta() {
    return { id: 'scene-compositor', name: 'Scene', description: 'Composed hybrid scene' };
  }

  #registry;
  #getTime;
  #base = null;          // base Visualizer instance or null
  #scene;                // { base, canvas, components: [...] }
  #instances = new Map(); // component.id -> VisualizerComponent instance
  #ctx = null;
  #w = 0;
  #h = 0;

  constructor({ baseVisualizer = null, scene, getTime, componentRegistry }) {
    super();
    this.#base = baseVisualizer;
    this.#scene = migrateScene(scene ?? { base: null, canvas: { bg: '#05060c' }, components: [] });
    this.#getTime = getTime ?? (() => 0);
    this.#registry = componentRegistry;
  }

  onInit(ctx, width, height) {
    this.#ctx = ctx;
    this.#w = width;
    this.#h = height;
    this.#base?.onInit(ctx, width, height);
    this.#rebuildInstances();
  }

  onResize(width, height) {
    this.#w = width;
    this.#h = height;
    this.#base?.onResize(width, height);
    for (const inst of this.#instances.values()) inst.onResize(width, height);
  }

  render(ctx, frame, dt, { width, height }) {
    this.#w = width;
    this.#h = height;
    const t = this.#getTime();

    if (this.#base) {
      this.#base.render(ctx, frame, dt, { width, height }); // base clears itself
    } else {
      ctx.fillStyle = this.#scene.canvas?.bg ?? '#05060c';
      ctx.fillRect(0, 0, width, height);
    }

    const components = this.#scene.components
      .filter((c) => c.enabled !== false)
      .sort((a, b) => (a.z ?? 0) - (b.z ?? 0));

    for (const c of components) {
      const inst = this.#instances.get(c.id);
      if (!inst) continue;
      const p = c.params ?? {};
      const a = c.automation;

      // Each animatable param: keyframed value at time t, else the static default.
      const intensity = paramAt(a, 'intensity', t, p.baseIntensity ?? 0.3);
      const sensitivity = paramAt(a, 'sensitivity', t, p.sensitivity ?? 1);
      const size = paramAt(a, 'size', t, p.size ?? 0.25);
      const opacity = paramAt(a, 'opacity', t, p.opacity ?? 1);
      const color = paramAt(a, 'color', t, p.color ?? '#ffffff');

      const raw = resolveSignal(c.bind?.signal, frame);
      const signal = clamp(raw * sensitivity * intensity, 0, 1);
      const layout = {
        x: (p.x ?? 0.5) * width,
        y: (p.y ?? 0.5) * height,
        size: size * Math.min(width, height),
        width,
        height,
      };
      // Animated color/size flow through params (elements read params.color,
      // size via layout); opacity is out-of-band so elements multiply, not
      // overwrite, their own alpha.
      ctx.save();
      inst.render(ctx, frame, layout, {
        signal, raw, intensity, beat: frame.beat, dt, opacity,
        params: { ...p, color, size, sensitivity },
      });
      ctx.restore();
    }
  }

  onDestroy() {
    this.#base?.onDestroy();
    for (const inst of this.#instances.values()) inst.onDestroy();
    this.#instances.clear();
  }

  // ---- live mutation API (used by the editor) ----

  getScene() {
    // Deep-ish clone so external mutation can't corrupt the live scene.
    return JSON.parse(JSON.stringify(this.#scene));
  }

  setScene(scene) {
    this.#scene = migrateScene(scene ?? { base: null, canvas: { bg: '#05060c' }, components: [] });
    this.#rebuildInstances();
  }

  setBaseVisualizer(baseVisualizer) {
    this.#base?.onDestroy();
    this.#base = baseVisualizer;
    if (baseVisualizer && this.#ctx) baseVisualizer.onInit(this.#ctx, this.#w, this.#h);
  }

  addComponent(component) {
    this.#scene.components.push(component);
    this.#instances.set(component.id, this.#registry.create(component.type));
  }

  removeComponent(id) {
    this.#scene.components = this.#scene.components.filter((c) => c.id !== id);
    this.#instances.get(id)?.onDestroy();
    this.#instances.delete(id);
  }

  updateComponent(id, patch) {
    const c = this.#scene.components.find((x) => x.id === id);
    if (!c) return;
    const typeChanged = patch.type && patch.type !== c.type;
    Object.assign(c, patch);
    if (typeChanged) {
      this.#instances.get(id)?.onDestroy();
      this.#instances.set(id, this.#registry.create(c.type));
    }
  }

  #rebuildInstances() {
    for (const inst of this.#instances.values()) inst.onDestroy();
    this.#instances.clear();
    for (const c of this.#scene.components) {
      if (this.#registry.has(c.type)) this.#instances.set(c.id, this.#registry.create(c.type));
    }
  }
}
