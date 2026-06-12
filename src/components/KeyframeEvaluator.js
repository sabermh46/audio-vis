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
