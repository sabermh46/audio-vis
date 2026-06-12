import { EventEmitter } from '../core/EventEmitter.js';
import { formatTime } from '../utils/format.js';

const MAX_BEAT_TICKS = 400;

/**
 * Scene editor: place reactive elements on the stage, bind each to a signal,
 * set its default intensity, and drag-paint time-ranges on the timeline where
 * it surges toward full intensity. Emits intents only; App mediates and keeps
 * the SceneCompositor (the renderer) in sync. Holds a working copy of the
 * scene to drive its own panels between App pushes.
 *
 * Events: addComponent(type), removeComponent(id), updateComponent({id,patch}),
 *         setBase(id|null), seek(seconds), save, close
 */
export class SceneEditor extends EventEmitter {
  #el = null;
  #placeLayer = null;   // transparent overlay holding element handles
  #listEl = null;
  #inspectorEl = null;
  #tl = null;           // timeline track element
  #playhead = null;
  #regionsEl = null;
  #noteEl = null;
  #paletteEl = null;
  #baseSelect = null;

  #open = false;
  #scene = { base: null, components: [] };
  #selectedId = null;
  #selectedRegion = -1;
  #duration = 0;
  #beats = new Float64Array(0);
  #canSave = false;
  #components = [];     // palette meta
  #baseOptions = [];    // [{id,name}]
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
        <button class="av-editor-save">Save scene</button>
      </aside>
      <div class="av-editor-timeline">
        <div class="av-tl-track">
          <div class="av-tl-beats"></div>
          <div class="av-tl-regions"></div>
          <div class="av-tl-playhead"></div>
        </div>
        <div class="av-tl-hint">Select an element, then drag on the timeline to paint a full-intensity range</div>
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
    this.#regionsEl = this.#el.querySelector('.av-tl-regions');

    const listen = (t, e, h) => { t.addEventListener(e, h); this.#domListeners.push([t, e, h]); };
    listen(this.#el.querySelector('.av-editor-close'), 'click', () => this.emit('close'));
    listen(this.#el.querySelector('.av-editor-save'), 'click', () => this.emit('save'));
    listen(this.#baseSelect, 'change', () => {
      const v = this.#baseSelect.value;
      this.emit('setBase', v === '__none__' ? null : v);
    });
    listen(document, 'keydown', (e) => {
      if (!this.#open) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.#selectedRegion >= 0) {
        this.#deleteSelectedRegion();
      }
    });
    this.#wireTimeline(listen);
  }

  // ---- state pushed in by App ----

  setComponentList(list) { this.#components = list; this.#renderPalette(); }

  setBaseOptions(options) { this.#baseOptions = options; this.#renderBaseOptions(); }

  setEnabled(enabled) {
    this.#el.classList.toggle('av-editor-disabled', !enabled);
  }

  setTrack({ trackId, duration, beats, canSave }) {
    this.#duration = duration || 0;
    this.#beats = beats || new Float64Array(0);
    this.#canSave = !!canSave;
    this.#noteEl.textContent = canSave ? '' :
      'Save needs a processed track (analysis server). Edits preview live but won\'t persist.';
    this.#el.querySelector('.av-editor-save').disabled = !canSave;
    this.#renderBeats();
    this.#renderRegions();
  }

  setScene(scene) {
    this.#scene = scene ?? { base: null, components: [] };
    if (!this.#scene.components.find((c) => c.id === this.#selectedId)) {
      this.#selectedId = this.#scene.components[0]?.id ?? null;
    }
    this.#selectedRegion = -1;
    if (this.#baseSelect) this.#baseSelect.value = this.#scene.base ?? '__none__';
    this.#renderList();
    this.#renderInspector();
    this.#renderHandles();
    this.#renderRegions();
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
    this.#baseSelect.value = this.#scene.base ?? '__none__';
  }

  #renderList() {
    this.#listEl.textContent = '';
    if (!this.#scene.components.length) {
      this.#listEl.innerHTML = '<div class="av-editor-empty">No elements yet.</div>';
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
        this.#selectedId = c.id; this.#selectedRegion = -1;
        this.#renderList(); this.#renderInspector(); this.#renderHandles(); this.#renderRegions();
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
    const c = this.#selected();
    if (!c) { this.#inspectorEl.textContent = ''; return; }
    const meta = this.#components.find((m) => m.type === c.type);
    const sigOpts = (meta?.signals ?? []).map((s) =>
      `<option value="${s}"${s === c.bind.signal ? ' selected' : ''}>${s}</option>`).join('');
    const p = c.params;
    this.#inspectorEl.innerHTML = `
      <label class="av-editor-label">Signal</label>
      <select data-f="signal">${sigOpts}</select>
      <label class="av-editor-label">Default intensity <b>${Math.round(p.baseIntensity * 100)}%</b></label>
      <input type="range" data-f="baseIntensity" min="0" max="1" step="0.01" value="${p.baseIntensity}">
      <label class="av-editor-label">Sensitivity</label>
      <input type="range" data-f="sensitivity" min="0" max="2" step="0.05" value="${p.sensitivity ?? 1}">
      <label class="av-editor-label">Size</label>
      <input type="range" data-f="size" min="0.05" max="0.6" step="0.01" value="${p.size}">
      <label class="av-editor-label">Color</label>
      <input type="color" data-f="color" value="${p.color}">`;

    this.#inspectorEl.querySelector('[data-f="signal"]').addEventListener('change', (e) =>
      this.#patch({ bind: { signal: e.target.value } }));
    for (const f of ['baseIntensity', 'sensitivity', 'size', 'color']) {
      const input = this.#inspectorEl.querySelector(`[data-f="${f}"]`);
      const evt = f === 'color' ? 'change' : 'input';
      input.addEventListener(evt, (e) => {
        const v = f === 'color' ? e.target.value : +e.target.value;
        this.#patch({ params: { ...this.#selected().params, [f]: v } });
        if (f === 'baseIntensity') this.#renderInspector();
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
    const c = this.#selected();
    if (!c) return;
    const handle = document.createElement('div');
    handle.className = 'av-editor-handle';
    handle.style.left = `${c.params.x * 100}%`;
    handle.style.top = `${c.params.y * 100}%`;
    this.#placeLayer.appendChild(handle);

    const onMove = (e) => {
      const rect = this.#placeLayer.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
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

  // ---- timeline ----

  #secToPx(t) { return (t / (this.#duration || 1)) * this.#tl.clientWidth; }
  #pxToSec(px) { return (px / (this.#tl.clientWidth || 1)) * (this.#duration || 0); }

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

  #renderRegions() {
    this.#regionsEl.textContent = '';
    const c = this.#selected();
    const entry = c?.automation?.find((a) => a.param === 'intensity');
    const regions = entry?.regions ?? [];
    regions.forEach((r, idx) => {
      const div = document.createElement('div');
      div.className = 'av-tl-region' + (idx === this.#selectedRegion ? ' active' : '');
      div.style.left = `${(r.start / (this.#duration || 1)) * 100}%`;
      div.style.width = `${((r.end - r.start) / (this.#duration || 1)) * 100}%`;
      div.title = `${formatTime(r.start)}–${formatTime(r.end)} @ ${Math.round(r.value * 100)}%`;
      div.innerHTML = '<span class="av-tl-handle l"></span><span class="av-tl-handle r"></span>';
      div.addEventListener('pointerdown', (e) => this.#startRegionDrag(e, idx));
      this.#regionsEl.appendChild(div);
    });
  }

  #regionEntry() {
    const c = this.#selected();
    if (!c) return null;
    c.automation = c.automation ?? [];
    let entry = c.automation.find((a) => a.param === 'intensity');
    if (!entry) { entry = { param: 'intensity', regions: [] }; c.automation.push(entry); }
    return entry;
  }

  #commitRegions() {
    const c = this.#selected();
    if (c) this.emit('updateComponent', { id: c.id, patch: { automation: c.automation } });
  }

  #wireTimeline(listen) {
    // Drag on empty timeline → create a region (or seek on a plain click).
    listen(this.#tl, 'pointerdown', (e) => {
      if (e.target.closest('.av-tl-region')) return; // region handles its own drag
      const c = this.#selected();
      const rect = this.#tl.getBoundingClientRect();
      const startSec = this.#pxToSec(e.clientX - rect.left);
      if (!c) { this.emit('seek', startSec); return; }

      this.#dragging = false;
      const entry = this.#regionEntry();
      const region = { start: startSec, end: startSec, value: 1, rampIn: 0.3, rampOut: 0.3 };
      const onMove = (ev) => {
        this.#dragging = true;
        const sec = this.#pxToSec(ev.clientX - rect.left);
        region.start = Math.max(0, Math.min(startSec, sec));
        region.end = Math.min(this.#duration, Math.max(startSec, sec));
        // live preview without committing every move
        const preview = entry.regions.concat(region);
        this.#previewRegions(preview);
      };
      const onUp = (ev) => {
        this.#tl.removeEventListener('pointermove', onMove);
        this.#tl.releasePointerCapture?.(ev.pointerId);
        if (this.#dragging && region.end - region.start > 0.1) {
          entry.regions.push(region);
          this.#selectedRegion = entry.regions.length - 1;
          this.#commitRegions();
          this.#renderRegions();
          this.#renderRegionInspector();
        } else {
          this.emit('seek', startSec); // it was a click, not a drag
        }
        this.#dragging = false;
      };
      this.#tl.setPointerCapture?.(e.pointerId);
      this.#tl.addEventListener('pointermove', onMove);
      this.#tl.addEventListener('pointerup', onUp, { once: true });
    });
  }

  #previewRegions(regions) {
    this.#regionsEl.textContent = '';
    for (const r of regions) {
      const div = document.createElement('div');
      div.className = 'av-tl-region';
      div.style.left = `${(r.start / (this.#duration || 1)) * 100}%`;
      div.style.width = `${((r.end - r.start) / (this.#duration || 1)) * 100}%`;
      this.#regionsEl.appendChild(div);
    }
  }

  #startRegionDrag(e, idx) {
    e.stopPropagation();
    const entry = this.#regionEntry();
    const region = entry.regions[idx];
    if (!region) return;
    this.#selectedRegion = idx;
    this.#renderRegions();
    this.#renderRegionInspector();

    const rect = this.#tl.getBoundingClientRect();
    const edge = e.target.classList.contains('l') ? 'l'
      : e.target.classList.contains('r') ? 'r' : 'move';
    const grabSec = this.#pxToSec(e.clientX - rect.left);
    const orig = { ...region };

    const onMove = (ev) => {
      const sec = this.#pxToSec(ev.clientX - rect.left);
      const delta = sec - grabSec;
      if (edge === 'l') region.start = Math.max(0, Math.min(region.end - 0.1, sec));
      else if (edge === 'r') region.end = Math.min(this.#duration, Math.max(region.start + 0.1, sec));
      else {
        const len = orig.end - orig.start;
        region.start = Math.max(0, Math.min(this.#duration - len, orig.start + delta));
        region.end = region.start + len;
      }
      this.#renderRegions();
    };
    const onUp = (ev) => {
      this.#tl.removeEventListener('pointermove', onMove);
      this.#tl.releasePointerCapture?.(ev.pointerId);
      this.#commitRegions();
    };
    this.#tl.setPointerCapture?.(e.pointerId);
    this.#tl.addEventListener('pointermove', onMove);
    this.#tl.addEventListener('pointerup', onUp, { once: true });
  }

  #renderRegionInspector() {
    const entry = this.#selected()?.automation?.find((a) => a.param === 'intensity');
    const r = entry?.regions?.[this.#selectedRegion];
    let box = this.#el.querySelector('.av-tl-region-edit');
    if (!box) {
      box = document.createElement('div');
      box.className = 'av-tl-region-edit';
      this.#el.querySelector('.av-editor-timeline').appendChild(box);
    }
    if (!r) { box.innerHTML = ''; return; }
    box.innerHTML = `
      <span>Region ${formatTime(r.start)}–${formatTime(r.end)}</span>
      <label>intensity <b>${Math.round(r.value * 100)}%</b></label>
      <input type="range" data-r="value" min="0" max="1" step="0.01" value="${r.value}">
      <label>ramp</label>
      <input type="range" data-r="rampIn" min="0" max="3" step="0.1" value="${r.rampIn}">
      <button class="av-tl-region-del">Delete</button>`;
    box.querySelector('[data-r="value"]').addEventListener('input', (e) => {
      r.value = +e.target.value; this.#commitRegions(); this.#renderRegionInspector();
    });
    box.querySelector('[data-r="rampIn"]').addEventListener('input', (e) => {
      r.rampIn = +e.target.value; r.rampOut = +e.target.value; this.#commitRegions();
    });
    box.querySelector('.av-tl-region-del').addEventListener('click', () => this.#deleteSelectedRegion());
  }

  #deleteSelectedRegion() {
    const entry = this.#selected()?.automation?.find((a) => a.param === 'intensity');
    if (!entry || this.#selectedRegion < 0) return;
    entry.regions.splice(this.#selectedRegion, 1);
    this.#selectedRegion = -1;
    this.#commitRegions();
    this.#renderRegions();
    this.#renderRegionInspector();
  }

  destroy() {
    for (const [t, e, h] of this.#domListeners) if (h) t.removeEventListener(e, h);
    this.#domListeners = [];
    this.#el?.remove();
    this.removeAllListeners();
  }
}
