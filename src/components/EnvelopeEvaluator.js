import { clamp, lerp } from '../utils/format.js';

/**
 * Evaluates an intensity automation entry at time t.
 *
 * Outside every region the value is `base` (the component's default
 * reactivity, ~0.3). Inside a region it ramps base→value over rampIn,
 * holds at value, then ramps value→base over rampOut. Overlapping regions
 * take the max, so painting a louder region over a quieter one always wins.
 *
 * Pure and DOM-free — unit-tested in .dev/envelope-direct.mjs.
 *
 * @param {{regions: Array<{start,end,value,rampIn,rampOut}>}|undefined} entry
 * @param {number} t  current time (seconds)
 * @param {number} base  default intensity 0..1
 * @returns {number} intensity 0..1
 */
export function evaluateEnvelope(entry, t, base) {
  const regions = entry?.regions;
  if (!regions || !regions.length) return base;

  let out = base;
  for (const r of regions) {
    if (t < r.start || t > r.end) continue;
    const rampIn = Math.max(0, r.rampIn || 0);
    const rampOut = Math.max(0, r.rampOut || 0);
    const inEnd = r.start + rampIn;
    const outStart = r.end - rampOut;

    let v;
    if (rampIn > 0 && t < inEnd) {
      v = lerp(base, r.value, (t - r.start) / rampIn);
    } else if (rampOut > 0 && t > outStart) {
      v = lerp(r.value, base, (t - outStart) / rampOut);
    } else {
      v = r.value;
    }
    if (v > out) out = v;
  }
  return clamp(out, 0, 1);
}
