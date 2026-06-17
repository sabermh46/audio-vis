import { clamp, lerp } from '../utils/format.js';

/**
 * Single source of truth for animatable parameter ranges. The editor's
 * value↔pixel mapping and any clamping read from here. `color: true` marks
 * a param whose values are hex strings (interpolated in RGB), not numbers.
 */
export const PARAM_RANGES = {
  intensity:   { min: 0,    max: 1,   color: false },
  sensitivity: { min: 0,    max: 2,   color: false },
  size:        { min: 0.05, max: 0.6, color: false },
  opacity:     { min: 0,    max: 1,   color: false },
  color:       { min: 0,    max: 1,   color: true },
};

/**
 * Linear keyframe sampling. Keyframes must be sorted ascending by `t`.
 * - no/empty keyframes → fallback
 * - t <= first.t → first.v ; t >= last.t → last.v (clamp at the ends)
 * - else linear interpolation between the bracketing pair
 */
export function evaluateKeyframes(keyframes, t, fallback) {
  if (!keyframes || !keyframes.length) return fallback;
  if (t <= keyframes[0].t) return keyframes[0].v;
  const last = keyframes[keyframes.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      return span > 0 ? lerp(a.v, b.v, (t - a.t) / span) : b.v;
    }
  }
  return last.v; // unreachable when sorted
}

/** hex (#rgb or #rrggbb, '#' optional) → {r,g,b} 0..255. */
export function hexToRgb(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16) || 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }) {
  const c = (x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Same bracketing as evaluateKeyframes but lerps in RGB; returns a hex string. */
export function evaluateColorKeyframes(keyframes, t, fallbackHex) {
  if (!keyframes || !keyframes.length) return fallbackHex;
  if (t <= keyframes[0].t) return keyframes[0].v;
  const last = keyframes[keyframes.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      const f = span > 0 ? (t - a.t) / span : 0;
      const ca = hexToRgb(a.v);
      const cb = hexToRgb(b.v);
      return rgbToHex({ r: lerp(ca.r, cb.r, f), g: lerp(ca.g, cb.g, f), b: lerp(ca.b, cb.b, f) });
    }
  }
  return last.v;
}

/**
 * Single entry point used by the compositor: evaluate `param`'s keyframes at
 * time `t`, dispatching color vs numeric. `fallback` is a hex string for the
 * color param, a number otherwise.
 */
export function paramAt(automation, param, t, fallback) {
  const kfs = automation?.[param];
  if (PARAM_RANGES[param]?.color) return evaluateColorKeyframes(kfs, t, fallback);
  return evaluateKeyframes(kfs, t, fallback);
}

/**
 * Evaluate a descriptor's param at time t, dispatching color vs numeric on
 * `descriptor.color` (NOT the global PARAM_RANGES) — so arbitrary keys like a
 * 0..360 `starHue` evaluate as numbers, not colors.
 */
export function paramAtDesc(automation, descriptor, t, fallback) {
  const kfs = automation?.[descriptor.key];
  if (descriptor.color) return evaluateColorKeyframes(kfs, t, fallback);
  return evaluateKeyframes(kfs, t, fallback);
}

/**
 * Descriptor-driven precompute (the play-mode "dynamic programming" step).
 * For each descriptor: a param WITH keyframes → a dense array (Float32Array
 * for numeric, hex string[] for color); WITHOUT → tables[key]=null + a static
 * fallback. Works for any param set (components or a visualizer's own params).
 *
 * @param {object} automation  keyframe object { key: [{t,v}] }
 * @param {object} params      static values (fallback source)
 * @param {Array<{key,color?,default?}>} descriptors
 * @param {object} [fallbacks] explicit per-key fallbacks (else params[key] ?? default)
 * @returns {{ tables: Record<string, Float32Array|string[]|null>, static: Record<string, any> }}
 */
export function compileParams(automation, params, descriptors, fps, frameCount, fallbacks) {
  const a = automation ?? {};
  const p = params ?? {};
  const n = Math.max(1, frameCount | 0);
  const tables = {};
  const stat = {};
  for (const d of descriptors) {
    const fb = fallbacks?.[d.key] ?? p[d.key] ?? d.default;
    stat[d.key] = fb;
    const kfs = a[d.key];
    if (!kfs?.length) { tables[d.key] = null; continue; }
    if (d.color) {
      const arr = new Array(n);
      for (let i = 0; i < n; i++) arr[i] = evaluateColorKeyframes(kfs, i / fps, fb);
      tables[d.key] = arr;
    } else {
      const arr = new Float32Array(n);
      for (let i = 0; i < n; i++) arr[i] = evaluateKeyframes(kfs, i / fps, fb);
      tables[d.key] = arr;
    }
  }
  return { tables, static: stat };
}

// Fixed descriptors for a scene component's animatable params. `fallback`
// names the static params key (intensity falls back to params.baseIntensity).
const COMPONENT_DESCRIPTORS = [
  { key: 'intensity', color: false, fallback: 'baseIntensity', default: 0.3 },
  { key: 'sensitivity', color: false, fallback: 'sensitivity', default: 1 },
  { key: 'size', color: false, fallback: 'size', default: 0.25 },
  { key: 'opacity', color: false, fallback: 'opacity', default: 1 },
  { key: 'color', color: true, fallback: 'color', default: '#ffffff' },
];

/**
 * Component compile — same signature and return shape as before
 * ({intensity,sensitivity,size,opacity,color, static}), now delegating to the
 * descriptor-driven compileParams so there is a single code path.
 */
export function compileComponent(component, fps, frameCount, fallbacks) {
  const p = component.params ?? {};
  const fb = fallbacks ?? Object.fromEntries(
    COMPONENT_DESCRIPTORS.map((d) => [d.key, p[d.fallback] ?? d.default]),
  );
  const { tables, static: stat } = compileParams(
    component.automation, p, COMPONENT_DESCRIPTORS, fps, frameCount, fb,
  );
  return {
    intensity: tables.intensity, sensitivity: tables.sensitivity, size: tables.size,
    opacity: tables.opacity, color: tables.color, static: stat,
  };
}
