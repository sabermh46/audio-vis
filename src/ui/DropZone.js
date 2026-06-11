import { EventEmitter } from '../core/EventEmitter.js';

/**
 * Drag & drop target covering the stage, plus a hidden file picker
 * (click anywhere on the stage when no track is loaded, or the 📂 button).
 *
 * Events: 'file' (File)
 */
export class DropZone extends EventEmitter {
  #el = null;
  #input = null;
  #dragDepth = 0;
  #domListeners = [];

  attach(container) {
    this.#el = document.createElement('div');
    this.#el.className = 'av-dropzone';
    this.#el.innerHTML = '<div class="av-dropzone-overlay">Drop your audio file</div>';

    this.#input = document.createElement('input');
    this.#input.type = 'file';
    this.#input.accept = 'audio/*';
    this.#input.hidden = true;
    this.#el.appendChild(this.#input);

    container.appendChild(this.#el);

    const listen = (target, event, handler) => {
      target.addEventListener(event, handler);
      this.#domListeners.push([target, event, handler]);
    };

    listen(this.#el, 'dragenter', (e) => {
      e.preventDefault();
      this.#dragDepth++;
      this.#el.classList.add('dragover');
    });
    listen(this.#el, 'dragover', (e) => e.preventDefault());
    listen(this.#el, 'dragleave', () => {
      if (--this.#dragDepth <= 0) {
        this.#dragDepth = 0;
        this.#el.classList.remove('dragover');
      }
    });
    listen(this.#el, 'drop', (e) => {
      e.preventDefault();
      this.#dragDepth = 0;
      this.#el.classList.remove('dragover');
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('audio/'));
      if (file) this.emit('file', file);
    });
    listen(this.#el, 'click', () => this.openPicker());
    listen(this.#input, 'change', () => {
      const file = this.#input.files?.[0];
      if (file) this.emit('file', file);
      this.#input.value = '';
    });
  }

  openPicker() {
    this.#input.click();
  }

  /** Once a track is playing, stop swallowing clicks on the stage. */
  setClickThrough(enabled) {
    this.#el.style.pointerEvents = enabled ? 'none' : 'auto';
  }

  destroy() {
    for (const [target, event, handler] of this.#domListeners) {
      target.removeEventListener(event, handler);
    }
    this.#domListeners = [];
    this.#el?.remove();
    this.removeAllListeners();
  }
}
