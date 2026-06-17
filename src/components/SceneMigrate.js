/**
 * Migrates legacy region-based automation to the keyframe model, in place.
 *
 * Legacy: automation = [{ param:'intensity', regions:[{start,end,value,rampIn,rampOut}] }]
 * New:    automation = { intensity:[{t,v}], sensitivity:[...], ... }
 *
 * Idempotent: keyed on Array.isArray (legacy is an array, new is an object),
 * so an already-migrated scene passes through untouched. Runs client-side at
 * the SceneCompositor chokepoint, so old MySQL rows upgrade transparently on
 * load and re-save in the new shape.
 */
export function migrateScene(scene) {
  if (!scene) return scene;
  scene.base = migrateBase(scene.base);
  for (const c of scene.components ?? []) {
    c.automation = migrateAutomation(c.automation, c.params?.baseIntensity ?? 0.3);
  }
  return scene;
}

/**
 * Normalises `scene.base` to the object form { id, params, automation }.
 * Idempotent: a bare id string or null (the legacy shape) is wrapped; an
 * object is left as-is with params/automation defaulted. Base automation is
 * born in the keyframe-object shape, so a stray array is coerced to {}.
 */
export function migrateBase(base) {
  if (base && typeof base === 'object' && !Array.isArray(base)) {
    return {
      id: base.id ?? null,
      params: base.params && typeof base.params === 'object' ? base.params : {},
      automation: base.automation && !Array.isArray(base.automation) && typeof base.automation === 'object'
        ? base.automation : {},
    };
  }
  return { id: typeof base === 'string' ? base : null, params: {}, automation: {} };
}

export function migrateAutomation(automation, base) {
  if (automation && !Array.isArray(automation)) return automation; // already new shape
  if (!Array.isArray(automation) || !automation.length) return {};

  const out = {};
  const intensity = automation.find((a) => a.param === 'intensity');
  if (intensity?.regions?.length) {
    const kfs = [];
    for (const r of intensity.regions) {
      const rampIn = Math.max(0, r.rampIn || 0);
      const rampOut = Math.max(0, r.rampOut || 0);
      kfs.push({ t: r.start, v: base });
      kfs.push({ t: r.start + rampIn, v: r.value });
      kfs.push({ t: r.end - rampOut, v: r.value });
      kfs.push({ t: r.end, v: base });
    }
    out.intensity = normalizeKeyframes(kfs);
  }
  return out;
}

/** Sort keyframes by t and drop near-duplicate times (later one wins). */
export function normalizeKeyframes(kfs, eps = 1e-3) {
  const sorted = [...kfs].filter((k) => Number.isFinite(k.t)).sort((a, b) => a.t - b.t);
  const out = [];
  for (const k of sorted) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.t - k.t) <= eps) out[out.length - 1] = k;
    else out.push(k);
  }
  return out;
}
