/**
 * Full-stage overlay shown during video export.
 * Shows: status line, frame counter, progress bar, Cancel button.
 */
export class ExportOverlay {
  #el = null;
  #statusEl = null;
  #frameEl = null;
  #barEl = null;
  #onCancel = null;

  attach(container, onCancel) {
    this.#onCancel = onCancel;
    this.#el = document.createElement('div');
    this.#el.className = 'av-export-overlay hidden';
    this.#el.innerHTML = `
      <div class="av-export-box">
        <div class="av-export-title">Exporting 2560×1440 MP4</div>
        <div class="av-export-status" data-el="status">Preparing…</div>
        <div class="av-export-frames" data-el="frames">Frame 0 / 0</div>
        <div class="av-export-track">
          <div class="av-export-fill" data-el="bar"></div>
        </div>
        <button class="av-export-cancel">Cancel</button>
      </div>
    `;
    container.appendChild(this.#el);
    this.#statusEl = this.#el.querySelector('[data-el="status"]');
    this.#frameEl = this.#el.querySelector('[data-el="frames"]');
    this.#barEl = this.#el.querySelector('[data-el="bar"]');
    this.#el.querySelector('.av-export-cancel').addEventListener('click', () => this.#onCancel?.());
  }

  show() { this.#el?.classList.remove('hidden'); }
  hide() { this.#el?.classList.add('hidden'); }

  setStatus(text) {
    if (this.#statusEl) this.#statusEl.textContent = text;
  }

  /** @param {number} frac 0..1  @param {number} fi frame index  @param {number} total */
  setProgress(frac, fi, total) {
    const pct = Math.min(100, Math.round(frac * 100));
    this.#barEl.style.width = `${pct}%`;
    this.#frameEl.textContent = `Frame ${fi.toLocaleString()} / ${total.toLocaleString()} (${pct}%)`;
  }

  destroy() {
    this.#el?.remove();
    this.#el = null;
  }
}
