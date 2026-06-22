import { EventEmitter } from '../core/EventEmitter.js';
import { clamp } from '../utils/format.js';
import { normalizeKeyframes } from '../components/SceneMigrate.js';

const MAX_BEAT_TICKS = 400;
const PAD = 6;                 // vertical padding so dots aren't clipped

// A scene component's animatable params as keyframe-lane descriptors.
// `fallback` is the static params key the empty-curve reads (intensity →
// params.baseIntensity); everything else mirrors that key.
const COMPONENT_PARAMS = [
  { key: 'intensity', label: 'Intensity', min: 0, max: 1, color: false, fallback: 'baseIntensity', default: 0.3 },
  { key: 'sensitivity', label: 'Sensitivity', min: 0, max: 2, color: false, fallback: 'sensitivity', default: 1 },
  { key: 'size', label: 'Size', min: 0.05, max: 0.6, color: false, fallback: 'size', default: 0.25 },
  { key: 'opacity', label: 'Opacity', min: 0, max: 1, color: false, fallback: 'opacity', default: 1 },
  { key: 'color', label: 'Color', min: 0, max: 1, color: true, fallback: 'color', default: '#ffffff' },
];
const BASE_ID = '__base__';

/**
 * Scene editor: place reactive elements on the stage, bind each to a signal,
 * set static defaults, and author per-parameter KEYFRAMES on a value-graph
 * timeline (pick a param → click to add dots, drag in time/value; a polyline
 * shows the curve). Emits intents only; App mediates and keeps the
 * SceneCompositor (the renderer) in sync. Holds a working copy of the scene.
 *
 * Events: addComponent(type), removeComponent(id), updateComponent({id,patch}),
 *         setBase(id|null), seek(seconds), save, loadSaved, clearScene, close
 */
export class SceneEditor extends EventEmitter {
  #el = null;
  #placeLayer = null;
  #listEl = null;
  #inspectorEl = null;
  #tl = null;            // timeline track element
  #playhead = null;
  #dotsEl = null;
  #curveEl = null;       // <polyline>
  #kfEditEl = null;
  #paramBarEl = null;
  #noteEl = null;
  #paletteEl = null;
  #baseSelect = null;
  #statusEl = null;
  #loadBtn = null;

  #open = false;
  #scene = { base: null, components: [] };
  #selectedId = null;
  #baseParams = [];      // base visualizer's keyframable descriptors (from App)
  #activeParam = 'intensity';
  #selectedKf = -1;
  #duration = 0;
  #beats = new Float64Array(0);
  #canSave = false;
  #components = [];
  #baseOptions = [];
  #domListeners = [];
  #dragging = false;

  attach(stage) {
    this.#el = document.createElement('div');
    this.#el.className = 'av-editor';
    this.#el.innerHTML = `
      <div class="av-editor-place"></div>
      <aside class="av-editor-panel">
        <div class="av-editor-head">
          <span>Scene editor</span>
          <button class="av-editor-close" title="Close">✕</button>
        </div>
        <div class="av-editor-section">
          <label class="av-editor-label">Base visualizer</label>
          <select class="av-editor-base"></select>
        </div>
        <div class="av-editor-section">
          <label class="av-editor-label">Add element</label>
          <div class="av-editor-palette"></div>
        </div>
        <div class="av-editor-section">
          <label class="av-editor-label">Elements</label>
          <div class="av-editor-list"></div>
        </div>
        <div class="av-editor-inspector"></div>
        <div class="av-editor-note"></div>
        <div class="av-editor-scenestatus"></div>
        <div class="av-editor-scenebar">
          <button class="av-editor-load" title="Reload the saved scene, discarding unsaved edits">Load saved</button>
          <button class="av-editor-clear" title="Remove all elements (save to persist)">Clear</button>
        </div>
        <button class="av-editor-save">Save scene</button>
      </aside>
      <div class="av-editor-timeline">
        <div class="av-tl-params"></div>
        <div class="av-tl-track">
          <div class="av-tl-beats"></div>
          <svg class="av-tl-curve"><polyline points=""></polyline></svg>
          <div class="av-tl-dots"></div>
          <div class="av-tl-playhead"></div>
        </div>
        <div class="av-tl-hint">Pick a parameter, then click the graph to add a keyframe; drag dots to move; Del removes the selected one.</div>
        <div class="av-tl-kf-edit"></div>
      </div>
    `;
    stage.appendChild(this.#el);

    this.#placeLayer = this.#el.querySelector('.av-editor-place');
    this.#listEl = this.#el.querySelector('.av-editor-list');
    this.#inspectorEl = this.#el.querySelector('.av-editor-inspector');
    this.#paletteEl = this.#el.querySelector('.av-editor-palette');
    this.#baseSelect = this.#el.querySelector('.av-editor-base');
    this.#noteEl = this.#el.querySelector('.av-editor-note');
    this.#tl = this.#el.querySelector('.av-tl-track');
    this.#playhead = this.#el.querySelector('.av-tl-playhead');
    this.#dotsEl = this.#el.querySelector('.av-tl-dots');
    this.#curveEl = this.#el.querySelector('.av-tl-curve polyline');
    this.#kfEditEl = this.#el.querySelector('.av-tl-kf-edit');
    this.#paramBarEl = this.#el.querySelector('.av-tl-params');
    this.#statusEl = this.#el.querySelector('.av-editor-scenestatus');
    this.#loadBtn = this.#el.querySelector('.av-editor-load');

    const listen = (t, e, h) => { t.addEventListener(e, h); this.#domListeners.push([t, e, h]); };
    listen(this.#el.querySelector('.av-editor-close'), 'click', () => this.emit('close'));
    listen(this.#el.querySelector('.av-editor-save'), 'click', () => this.emit('save'));
    listen(this.#loadBtn, 'click', () => this.emit('loadSaved'));
    listen(this.#el.querySelector('.av-editor-clear'), 'click', () => this.emit('clearScene'));
    listen(this.#baseSelect, 'change', () => {
      const v = this.#baseSelect.value;
      this.emit('setBase', v === '__none__' ? null : v);
    });
    listen(this.#paramBarEl, 'click', (e) => {
      const btn = e.target.closest('.av-tl-param');
      if (!btn) return;
      this.#activeParam = btn.dataset.param;
      this.#selectedKf = -1;
      for (const b of this.#paramBarEl.children) b.classList.toggle('active', b === btn);
      this.#renderLane();
    });
    listen(document, 'keydown', (e) => {
      if (!this.#open) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.#selectedKf >= 0) this.#deleteSelectedKf();
    });
    this.#wireTimeline(listen);
  }

  // ---- state pushed in by App ----

  setComponentList(list) { this.#components = list; this.#renderPalette(); }

  setBaseOptions(options) { this.#baseOptions = options; this.#renderBaseOptions(); }

  /** Keyframable descriptors of the current base visualizer (App pushes these). */
  setBaseParams(descriptors) {
    this.#baseParams = descriptors ?? [];
    if (this.#selectedId === BASE_ID && !this.#baseParams.length) {
      this.#selectedId = this.#scene.components[0]?.id ?? null;
    }
    this.#renderList();
    this.#renderParamBar();
    this.#renderInspector();
    this.#renderLane();
  }

  setEnabled(enabled) { this.#el.classList.toggle('av-editor-disabled', !enabled); }

  setTrack({ trackId, duration, beats, canSave, hasSaved }) {
    this.#duration = duration || 0;
    this.#beats = beats || new Float64Array(0);
    this.#canSave = !!canSave;
    this.#noteEl.textContent = canSave ? '' :
      'Save needs a processed track (analysis server). Edits preview live but won\'t persist.';
    this.#el.querySelector('.av-editor-save').disabled = !canSave;
    this.#statusEl.textContent = hasSaved
      ? 'A saved scene is loaded for this track.'
      : 'No saved scene yet for this track.';
    this.#loadBtn.disabled = !hasSaved;
    this.#renderBeats();
    this.#renderLane();
  }

  setScene(scene) {
    this.#scene = scene ?? { base: { id: null, params: {}, automation: {} }, components: [] };
    const keepBase = this.#selectedId === BASE_ID && this.#baseParams.length;
    if (!keepBase && !this.#scene.components.find((c) => c.id === this.#selectedId)) {
      this.#selectedId = this.#scene.components[0]?.id ?? null;
    }
    this.#selectedKf = -1;
    if (this.#baseSelect) this.#baseSelect.value = this.#scene.base?.id ?? '__none__';
    this.#renderList();
    this.#renderParamBar();
    this.#renderInspector();
    this.#renderHandles();
    this.#renderLane();
  }

  setTime(seconds) {
    if (!this.#open || !this.#duration) return;
    this.#playhead.style.left = `${(seconds / this.#duration) * 100}%`;
  }

  toggle(force) {
    this.#open = force ?? !this.#open;
    this.#el.classList.toggle('open', this.#open);
    return this.#open;
  }

  get isOpen() { return this.#open; }

  flashSaved() {
    const btn = this.#el.querySelector('.av-editor-save');
    const original = btn.textContent;
    btn.textContent = 'Saved ✓';
    setTimeout(() => { btn.textContent = original; }, 1400);
  }

  // ---- panel rendering ----

  #renderPalette() {
    this.#paletteEl.textContent = '';
    for (const meta of this.#components) {
      const btn = document.createElement('button');
      btn.className = 'av-editor-add';
      btn.textContent = `+ ${meta.name}`;
      btn.addEventListener('click', () => this.emit('addComponent', meta.type));
      this.#domListeners.push([btn, 'click', null]);
      this.#paletteEl.appendChild(btn);
    }
  }

  #renderBaseOptions() {
    this.#baseSelect.innerHTML =
      `<option value="__none__">None (blank)</option>` +
      this.#baseOptions.map((o) => `<option value="${o.id}">${o.name}</option>`).join('');
    this.#baseSelect.value = this.#scene.base?.id ?? '__none__';
  }

  /** Build the timeline param buttons from the active target's descriptors. */
  #renderParamBar() {
    // Signal selectors are discrete (not keyframable) → no lane button.
    const descs = (this.#target()?.descriptors ?? []).filter((d) => !d.signal);
    if (descs.length && !descs.find((d) => d.key === this.#activeParam)) {
      this.#activeParam = descs[0].key;
    }
    this.#paramBarEl.innerHTML = descs.map((d) =>
      `<button class="av-tl-param${d.key === this.#activeParam ? ' active' : ''}" data-param="${d.key}">${d.label}</button>`).join('');
  }

  /**
   * The current keyframe target — a scene component or the base layer — as a
   * uniform view so the inspector + lane machinery works for both.
   */
  #target() {
    if (this.#selectedId === BASE_ID) {
      if (!this.#baseParams.length) return null;
      const base = this.#scene.base ?? (this.#scene.base = { id: null, params: {}, automation: {} });
      base.params = base.params ?? {};
      base.automation = base.automation ?? {};
      const find = (k) => this.#baseParams.find((d) => d.key === k);
      return {
        isBase: true,
        descriptors: this.#baseParams,
        params: base.params,
        automation: base.automation,
        fallbackFor: (k) => base.params[k] ?? find(k)?.default ?? 0,
        rangeFor: (k) => { const d = find(k) ?? { min: 0, max: 1 }; return { min: d.min, max: d.max, color: !!d.color }; },
        commit: (automation) => this.emit('updateBase', { automation }),
      };
    }
    const c = this.#scene.components.find((x) => x.id === this.#selectedId);
    if (!c) return null;
    c.automation = c.automation ?? {};
    const find = (k) => COMPONENT_PARAMS.find((d) => d.key === k);
    return {
      isBase: false,
      comp: c,
      descriptors: COMPONENT_PARAMS,
      params: c.params,
      automation: c.automation,
      fallbackFor: (k) => { const d = find(k); return c.params[d?.fallback] ?? d?.default ?? 0; },
      rangeFor: (k) => { const d = find(k) ?? { min: 0, max: 1 }; return { min: d.min, max: d.max, color: !!d.color }; },
      commit: (automation) => this.emit('updateComponent', { id: c.id, patch: { automation } }),
    };
  }

  #renderList() {
    this.#listEl.textContent = '';
    // Base layer as a selectable row (only when the base declares params).
    if (this.#baseParams.length) {
      const name = this.#baseOptions.find((o) => o.id === this.#scene.base?.id)?.name ?? 'Base';
      const row = document.createElement('div');
      row.className = 'av-editor-item av-editor-item-base' + (this.#selectedId === BASE_ID ? ' active' : '');
      row.innerHTML = `<span class="av-editor-item-name">▣ ${name}</span><span class="av-editor-item-sig">base</span>`;
      row.querySelector('.av-editor-item-name').addEventListener('click', () => {
        this.#selectedId = BASE_ID; this.#selectedKf = -1;
        this.#renderList(); this.#renderParamBar(); this.#renderInspector(); this.#renderHandles(); this.#renderLane();
      });
      this.#listEl.appendChild(row);
    }
    if (!this.#scene.components.length) {
      if (!this.#baseParams.length) this.#listEl.innerHTML = '<div class="av-editor-empty">No elements yet.</div>';
      return;
    }
    for (const c of this.#scene.components) {
      const row = document.createElement('div');
      row.className = 'av-editor-item' + (c.id === this.#selectedId ? ' active' : '');
      row.innerHTML = `
        <span class="av-editor-item-name">${c.type}</span>
        <span class="av-editor-item-sig">${c.bind?.signal ?? ''}</span>
        <button class="av-editor-item-del" title="Remove">🗑</button>`;
      row.querySelector('.av-editor-item-name').addEventListener('click', () => {
        this.#selectedId = c.id; this.#selectedKf = -1;
        this.#renderList(); this.#renderParamBar(); this.#renderInspector(); this.#renderHandles(); this.#renderLane();
      });
      row.querySelector('.av-editor-item-del').addEventListener('click', (e) => {
        e.stopPropagation();
        this.emit('removeComponent', c.id);
      });
      this.#listEl.appendChild(row);
    }
  }

  #selected() { return this.#scene.components.find((c) => c.id === this.#selectedId) ?? null; }

  #renderInspector() {
    if (this.#selectedId === BASE_ID) { this.#renderBaseInspector(); return; }
    const c = this.#selected();
    if (!c) { this.#inspectorEl.textContent = ''; return; }
    const meta = this.#components.find((m) => m.type === c.type);
    const sigOpts = (meta?.signals ?? []).map((s) =>
      `<option value="${s}"${s === c.bind.signal ? ' selected' : ''}>${s}</option>`).join('');
    const p = c.params;
    this.#inspectorEl.innerHTML = `
      <label class="av-editor-label">Signal</label>
      <select data-f="signal">${sigOpts}</select>
      <label class="av-editor-label">Default intensity <b>${Math.round((p.baseIntensity ?? 0.3) * 100)}%</b></label>
      <input type="range" data-f="baseIntensity" min="0" max="1" step="0.01" value="${p.baseIntensity ?? 0.3}">
      <label class="av-editor-label">Sensitivity</label>
      <input type="range" data-f="sensitivity" min="0" max="2" step="0.05" value="${p.sensitivity ?? 1}">
      <label class="av-editor-label">Size</label>
      <input type="range" data-f="size" min="0.05" max="0.6" step="0.01" value="${p.size}">
      <label class="av-editor-label">Opacity</label>
      <input type="range" data-f="opacity" min="0" max="1" step="0.01" value="${p.opacity ?? 1}">
      <label class="av-editor-label">Color</label>
      <input type="color" data-f="color" value="${p.color}">
      <div class="av-editor-hint">Sliders set the value used when a parameter has no keyframes.</div>`;

    this.#inspectorEl.querySelector('[data-f="signal"]').addEventListener('change', (e) =>
      this.#patch({ bind: { signal: e.target.value } }));
    for (const f of ['baseIntensity', 'sensitivity', 'size', 'opacity', 'color']) {
      const input = this.#inspectorEl.querySelector(`[data-f="${f}"]`);
      const evt = f === 'color' ? 'change' : 'input';
      input.addEventListener(evt, (e) => {
        const v = f === 'color' ? e.target.value : +e.target.value;
        this.#patch({ params: { ...this.#selected().params, [f]: v } });
        if (f === 'baseIntensity') this.#renderInspector();
        // The empty-state curve tracks the static fallback — redraw it.
        if (!this.#kfs(false)?.length) this.#renderLane();
      });
    }
  }

  /** Inspector for the base layer: one slider/color per declared param. */
  #renderBaseInspector() {
    const base = this.#scene.base ?? { params: {} };
    base.params = base.params ?? {};
    const fields = this.#baseParams.map((d) => {
      const v = base.params[d.key] ?? d.default;
      if (d.signal) {
        const opts = (d.options ?? []).map((s) =>
          `<option value="${s}"${s === v ? ' selected' : ''}>${s}</option>`).join('');
        return `<label class="av-editor-label">${d.label}</label><select data-bk="${d.key}">${opts}</select>`;
      }
      if (d.color) {
        return `<label class="av-editor-label">${d.label}</label><input type="color" data-bk="${d.key}" value="${v}">`;
      }
      const step = (d.max - d.min) <= 2 ? 0.01 : 1;
      return `<label class="av-editor-label">${d.label} <b>${typeof v === 'number' ? v.toFixed(2) : v}</b></label>` +
        `<input type="range" data-bk="${d.key}" min="${d.min}" max="${d.max}" step="${step}" value="${v}">`;
    }).join('');
    this.#inspectorEl.innerHTML = fields +
      `<div class="av-editor-hint">Base layer. Sliders set the value used when a parameter has no keyframes.</div>`;
    for (const d of this.#baseParams) {
      const input = this.#inspectorEl.querySelector(`[data-bk="${d.key}"]`);
      const evt = (d.color || d.signal) ? 'change' : 'input';
      input.addEventListener(evt, (e) => {
        const val = (d.color || d.signal) ? e.target.value : +e.target.value;
        base.params[d.key] = val;
        this.emit('updateBase', { params: { [d.key]: val } });
        if (!d.color && !d.signal) { const b = input.previousElementSibling?.querySelector('b'); if (b) b.textContent = val.toFixed(2); }
        if (!d.signal && !this.#kfs(false)?.length) this.#renderLane();
      });
    }
  }

  /** Apply a patch to the selected component locally + emit for the compositor. */
  #patch(patch) {
    const c = this.#selected();
    if (!c) return;
    if (patch.params) c.params = patch.params;
    if (patch.bind) c.bind = { ...c.bind, ...patch.bind };
    if (patch.automation) c.automation = patch.automation;
    this.emit('updateComponent', { id: c.id, patch });
    if (patch.bind) this.#renderList();
  }

  // ---- placement handles (drag on the stage) ----

  #renderHandles() {
    this.#placeLayer.textContent = '';
    if (this.#selectedId === BASE_ID) return; // base layer has no stage position
    const c = this.#selected();
    if (!c) return;
    const handle = document.createElement('div');
    handle.className = 'av-editor-handle';
    handle.style.left = `${c.params.x * 100}%`;
    handle.style.top = `${c.params.y * 100}%`;
    this.#placeLayer.appendChild(handle);

    const onMove = (e) => {
      const rect = this.#placeLayer.getBoundingClientRect();
      const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((e.clientY - rect.top) / rect.height, 0, 1);
      handle.style.left = `${x * 100}%`;
      handle.style.top = `${y * 100}%`;
      this.#patch({ params: { ...this.#selected().params, x, y } });
    };
    const onUp = (e) => {
      handle.releasePointerCapture?.(e.pointerId);
      handle.removeEventListener('pointermove', onMove);
    };
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture?.(e.pointerId);
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp, { once: true });
    });
  }

  // ---- timeline / keyframe lane ----

  #secToPx(t) { return (t / (this.#duration || 1)) * this.#tl.clientWidth; }
  #pxToSec(px) { return (px / (this.#tl.clientWidth || 1)) * (this.#duration || 0); }

  #range() { return this.#target()?.rangeFor(this.#activeParam) ?? { min: 0, max: 1, color: false }; }

  #valToPy(v) {
    const { min, max } = this.#range();
    const H = this.#tl.clientHeight || 54;
    const f = (v - min) / (max - min || 1);
    return PAD + (1 - f) * (H - 2 * PAD);
  }

  #pyToVal(py) {
    const { min, max } = this.#range();
    const H = this.#tl.clientHeight || 54;
    const f = 1 - (py - PAD) / (H - 2 * PAD || 1);
    return clamp(min + f * (max - min), min, max);
  }

  /** Active param's keyframe array (live ref). `create` adds the key if absent. */
  #kfs(create = true) {
    const tgt = this.#target();
    if (!tgt) return null;
    if (!create) return tgt.automation[this.#activeParam];
    tgt.automation[this.#activeParam] = tgt.automation[this.#activeParam] ?? [];
    return tgt.automation[this.#activeParam];
  }

  /** Sort+dedupe the active param; prune if empty; commit via the target. */
  #commitKfs() {
    const tgt = this.#target();
    if (!tgt) return;
    tgt.automation[this.#activeParam] = normalizeKeyframes(tgt.automation[this.#activeParam] ?? []);
    if (!tgt.automation[this.#activeParam].length) delete tgt.automation[this.#activeParam];
    tgt.commit(tgt.automation);
  }

  #renderBeats() {
    const beatsEl = this.#el.querySelector('.av-tl-beats');
    beatsEl.textContent = '';
    const n = this.#beats.length;
    if (!n || !this.#duration) return;
    const stride = Math.max(1, Math.ceil(n / MAX_BEAT_TICKS));
    for (let i = 0; i < n; i += stride) {
      const tick = document.createElement('div');
      tick.className = 'av-tl-beat';
      tick.style.left = `${(this.#beats[i] / this.#duration) * 100}%`;
      beatsEl.appendChild(tick);
    }
  }

  #renderLane() {
    this.#renderDots();
    this.#renderCurve();
    this.#renderKfEdit();
  }

  #renderDots() {
    this.#dotsEl.textContent = '';
    const kfs = this.#kfs(false);
    if (!kfs) return;
    const isColor = this.#range().color;
    const midY = (this.#tl.clientHeight || 54) / 2;
    kfs.forEach((k, idx) => {
      const dot = document.createElement('div');
      dot.className = 'av-tl-dot' + (idx === this.#selectedKf ? ' active' : '');
      dot.style.left = `${(k.t / (this.#duration || 1)) * 100}%`;
      dot.style.top = `${isColor ? midY : this.#valToPy(k.v)}px`;
      if (isColor) dot.style.background = k.v;
      dot.addEventListener('pointerdown', (e) => this.#startDotDrag(e, idx));
      this.#dotsEl.appendChild(dot);
    });
  }

  #renderCurve() {
    const kfs = this.#kfs(false);
    if (this.#range().color) { this.#curveEl.setAttribute('points', ''); return; }
    if (kfs && kfs.length) {
      this.#curveEl.setAttribute('points',
        kfs.map((k) => `${this.#secToPx(k.t)},${this.#valToPy(k.v)}`).join(' '));
    } else {
      // Empty state: a flat line at the static fallback value.
      const tgt = this.#target();
      const fb = tgt ? tgt.fallbackFor(this.#activeParam) : 0;
      const y = this.#valToPy(typeof fb === 'number' ? fb : 0);
      const w = this.#tl.clientWidth;
      this.#curveEl.setAttribute('points', `0,${y} ${w},${y}`);
    }
  }

  #wireTimeline(listen) {
    listen(this.#tl, 'pointerdown', (e) => {
      if (e.target.closest('.av-tl-dot')) return; // dot handles its own drag
      const tgt = this.#target();
      const rect = this.#tl.getBoundingClientRect();
      const sec = this.#pxToSec(e.clientX - rect.left);
      if (!tgt) { this.emit('seek', sec); return; }

      this.#dragging = false;
      const downY = e.clientY - rect.top;
      const onMove = () => { this.#dragging = true; };
      const onUp = (ev) => {
        this.#tl.removeEventListener('pointermove', onMove);
        this.#tl.releasePointerCapture?.(ev.pointerId);
        if (this.#dragging) { this.#dragging = false; return; }
        // A click → add a keyframe.
        const range = this.#range();
        const t = clamp(sec, 0, this.#duration);
        const v = range.color ? (tgt.fallbackFor(this.#activeParam) ?? '#ffffff') : this.#pyToVal(downY);
        this.#kfs().push({ t, v });
        this.#commitKfs();
        const arr = this.#kfs(false) ?? [];
        this.#selectedKf = arr.findIndex((k) => Math.abs(k.t - t) < 1e-3);
        this.#renderLane();
      };
      this.#tl.setPointerCapture?.(e.pointerId);
      this.#tl.addEventListener('pointermove', onMove);
      this.#tl.addEventListener('pointerup', onUp, { once: true });
    });
  }

  #startDotDrag(e, idx) {
    e.stopPropagation();
    this.#selectedKf = idx;
    this.#renderLane();
    const rect = this.#tl.getBoundingClientRect();
    const kfs = this.#kfs();
    const ref = kfs[idx]; // live ref; mutate during drag, sort once on up
    if (!ref) return;
    const isColor = this.#range().color;
    let moved = false;

    const onMove = (ev) => {
      moved = true;
      ref.t = clamp(this.#pxToSec(ev.clientX - rect.left), 0, this.#duration);
      if (!isColor) ref.v = this.#pyToVal(ev.clientY - rect.top);
      this.#renderDots();
      this.#renderCurve();
    };
    const onUp = (ev) => {
      this.#tl.removeEventListener('pointermove', onMove);
      this.#tl.releasePointerCapture?.(ev.pointerId);
      this.#commitKfs();
      const arr = this.#kfs(false) ?? [];
      this.#selectedKf = arr.indexOf(ref); // re-find after sort, by identity
      this.#renderLane();
      void moved;
    };
    this.#tl.setPointerCapture?.(e.pointerId);
    this.#tl.addEventListener('pointermove', onMove);
    this.#tl.addEventListener('pointerup', onUp, { once: true });
  }

  #renderKfEdit() {
    const kfs = this.#kfs(false);
    const k = kfs?.[this.#selectedKf];
    if (!k) { this.#kfEditEl.innerHTML = ''; return; }
    const range = this.#range();
    if (range.color) {
      this.#kfEditEl.innerHTML = `
        <span>Keyframe @ ${k.t.toFixed(2)}s</span>
        <input type="color" data-k="v" value="${k.v}">
        <button class="av-tl-kf-del">Delete</button>`;
      this.#kfEditEl.querySelector('[data-k="v"]').addEventListener('input', (e) => {
        k.v = e.target.value; this.#commitKfs(); this.#renderDots();
      });
    } else {
      this.#kfEditEl.innerHTML = `
        <span>Keyframe @ ${k.t.toFixed(2)}s = <b>${k.v.toFixed(2)}</b></span>
        <input type="range" data-k="v" min="${range.min}" max="${range.max}" step="0.01" value="${k.v}">
        <button class="av-tl-kf-del">Delete</button>`;
      this.#kfEditEl.querySelector('[data-k="v"]').addEventListener('input', (e) => {
        k.v = +e.target.value; this.#commitKfs(); this.#renderDots(); this.#renderCurve();
        this.#kfEditEl.querySelector('b').textContent = k.v.toFixed(2);
      });
    }
    this.#kfEditEl.querySelector('.av-tl-kf-del').addEventListener('click', () => this.#deleteSelectedKf());
  }

  #deleteSelectedKf() {
    const kfs = this.#kfs(false);
    if (!kfs || this.#selectedKf < 0) return;
    kfs.splice(this.#selectedKf, 1);
    this.#selectedKf = -1;
    this.#commitKfs();
    this.#renderLane();
  }

  destroy() {
    for (const [t, e, h] of this.#domListeners) if (h) t.removeEventListener(e, h);
    this.#domListeners = [];
    this.#el?.remove();
    this.removeAllListeners();
  }
}
