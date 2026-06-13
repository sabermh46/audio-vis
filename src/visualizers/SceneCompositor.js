import { Visualizer } from './Visualizer.js';
import { resolveSignal } from '../components/SignalResolver.js';
import { paramAt, compileComponent } from '../components/KeyframeEvaluator.js';
import { migrateScene } from '../components/SceneMigrate.js';
import { clamp } from '../utils/format.js';

const PLAY_FPS = 60; // resolution of the precomputed play-mode automation tables

/**
 * A Visualizer that composes reactive elements on top of an optional base
 * visualizer. Plugs into VisualizerHost.setVisualizer with no host change.
 * Constructed directly by App (it needs injected getTime/getDuration, since
 * host.render() passes no time — the PrecomputedAnalysisSource pattern).
 *
 * Two modes (the audio-reactive `signal` is always live; only the automation
 * scalars differ):
 *  - 'edit': keyframes evaluated live every frame, so authoring shows instantly.
 *  - 'play': the deterministic automation timeline is precomputed once into
 *    per-frame lookup tables, so playback is an O(1) index — no keyframe scans,
 *    no hex parsing, no per-frame allocation.
 *
 * Per-frame allocation is eliminated in BOTH modes: the enabled+sorted render
 * order and per-component scratch objects are cached and only rebuilt on
 * structural/edit changes, never per frame.
 *
 * Live mutation API (add/remove/update/setScene/setBase) keeps the editor in sync.
 */
export class SceneCompositor extends Visualizer {
  static get meta() {
    return { id: 'scene-compositor', name: 'Scene', description: 'Composed hybrid scene' };
  }

  #registry;
  #getTime;
  #getDuration;
  #base = null;
  #scene;
  #instances = new Map();   // component.id -> VisualizerComponent instance
  #order = [];              // cached render states (enabled, z-sorted), reused per frame
  #mode = 'play';
  #compiled = null;         // Map id -> compiled tables; null = needs (re)compile
  #frameCount = 0;
  #ctx = null;
  #w = 0;
  #h = 0;

  constructor({ baseVisualizer = null, scene, getTime, getDuration, componentRegistry }) {
    super();
    this.#base = baseVisualizer;
    this.#scene = migrateScene(scene ?? { base: null, canvas: { bg: '#05060c' }, components: [] });
    this.#getTime = getTime ?? (() => 0);
    this.#getDuration = getDuration ?? (() => 0);
    this.#registry = componentRegistry;
  }

  setMode(mode) {
    this.#mode = mode === 'edit' ? 'edit' : 'play';
    if (this.#mode === 'play') this.#compiled = null; // recompile lazily on next frame
    return this.#mode;
  }

  getMode() { return this.#mode; }

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

    // Play mode reads precomputed tables; compile lazily once the duration is
    // known (falls back to live eval for the frame or two before that).
    const play = this.#mode === 'play';
    if (play && !this.#compiled) this.#compile();
    const usingTables = play && this.#compiled;
    const idx = usingTables ? clamp(Math.round(t * PLAY_FPS), 0, this.#frameCount - 1) : 0;
    const minDim = Math.min(width, height);

    for (const s of this.#order) {
      const comp = s.comp;
      const p = comp.params ?? {};

      let intensity, sensitivity, size, opacity, color;
      if (usingTables) {
        const tb = this.#compiled.get(comp.id);
        intensity = tb.intensity ? tb.intensity[idx] : tb.static.intensity;
        sensitivity = tb.sensitivity ? tb.sensitivity[idx] : tb.static.sensitivity;
        size = tb.size ? tb.size[idx] : tb.static.size;
        opacity = tb.opacity ? tb.opacity[idx] : tb.static.opacity;
        color = tb.color ? tb.color[idx] : tb.static.color;
      } else {
        const a = comp.automation;
        intensity = paramAt(a, 'intensity', t, p.baseIntensity ?? 0.3);
        sensitivity = paramAt(a, 'sensitivity', t, p.sensitivity ?? 1);
        size = paramAt(a, 'size', t, p.size ?? 0.25);
        opacity = paramAt(a, 'opacity', t, p.opacity ?? 1);
        color = paramAt(a, 'color', t, p.color ?? '#ffffff');
      }

      const raw = resolveSignal(comp.bind?.signal, frame);
      const signal = clamp(raw * sensitivity * intensity, 0, 1);

      const L = s.layout;
      L.x = (p.x ?? 0.5) * width;
      L.y = (p.y ?? 0.5) * height;
      L.size = size * minDim;
      L.width = width;
      L.height = height;

      const R = s.resolved;
      R.signal = signal;
      R.raw = raw;
      R.intensity = intensity;
      R.beat = frame.beat;
      R.dt = dt;
      R.opacity = opacity;
      s.sp.color = color; // R.params === s.sp; elements read params.color

      ctx.save();
      s.inst.render(ctx, frame, L, R);
      ctx.restore();
    }
  }

  onDestroy() {
    this.#base?.onDestroy();
    for (const inst of this.#instances.values()) inst.onDestroy();
    this.#instances.clear();
    this.#order = [];
  }

  // ---- live mutation API (used by the editor) ----

  getScene() {
    return JSON.parse(JSON.stringify(this.#scene)); // deep clone so callers can't corrupt the live scene
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
    this.#rebuildOrder();
  }

  removeComponent(id) {
    this.#scene.components = this.#scene.components.filter((c) => c.id !== id);
    this.#instances.get(id)?.onDestroy();
    this.#instances.delete(id);
    this.#rebuildOrder();
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
    this.#rebuildOrder(); // re-sort + invalidate compiled tables
  }

  #rebuildInstances() {
    for (const inst of this.#instances.values()) inst.onDestroy();
    this.#instances.clear();
    for (const c of this.#scene.components) {
      if (this.#registry.has(c.type)) this.#instances.set(c.id, this.#registry.create(c.type));
    }
    this.#rebuildOrder();
  }

  /** Cache the enabled, z-sorted render states + scratch objects; invalidate tables. */
  #rebuildOrder() {
    this.#order = this.#scene.components
      .filter((c) => c.enabled !== false && this.#instances.has(c.id))
      .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
      .map((comp) => {
        const sp = { ...comp.params };
        return {
          comp,
          inst: this.#instances.get(comp.id),
          layout: { x: 0, y: 0, size: 0, width: 0, height: 0 },
          resolved: { signal: 0, raw: 0, intensity: 0, beat: false, dt: 0, opacity: 1, params: sp },
          sp,
        };
      });
    this.#compiled = null; // automation/order may have changed → recompile in play mode
  }

  /** Precompute play-mode automation tables for every component. */
  #compile() {
    const dur = this.#getDuration();
    if (!(dur > 0)) return false;
    this.#frameCount = Math.ceil(dur * PLAY_FPS) + 1;
    this.#compiled = new Map();
    for (const s of this.#order) {
      this.#compiled.set(s.comp.id, compileComponent(s.comp, PLAY_FPS, this.#frameCount));
    }
    return true;
  }
}
