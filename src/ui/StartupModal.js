import { EventEmitter } from '../core/EventEmitter.js';
import { formatTime } from '../utils/format.js';

/**
 * Startup / library modal. Two paths: process new audio (own file input +
 * drag/drop) or open a previously-decoded track from the server library.
 * Emits intents only — App performs the loads and library calls.
 *
 * Events: 'processFile' (File), 'openLibrary' (id), 'deleteLibrary' (id),
 *         'renameLibrary' ({id, name}), 'close'
 */
export class StartupModal extends EventEmitter {
  #el = null;
  #input = null;
  #libGrid = null;
  #libPane = null;
  #busyEl = null;
  #isOpen = false;
  #dragDepth = 0;
  #domListeners = [];

  attach(container) {
    this.#el = document.createElement('div');
    this.#el.className = 'av-modal-backdrop';
    this.#el.innerHTML = `
      <div class="av-modal" role="dialog" aria-modal="true">
        <button class="av-modal-close" title="Close" aria-label="Close">✕</button>
        <h2 class="av-modal-title">Audio Visualizer</h2>
        <div class="av-modal-panes">
          <section class="av-modal-pane av-process-pane">
            <div class="av-process-drop">
              <div class="icon">🎵</div>
              <div class="av-process-title">Process new audio</div>
              <div class="av-process-hint">Drag &amp; drop a file, or click to browse</div>
            </div>
            <input type="file" accept="audio/*" hidden />
          </section>
          <section class="av-modal-pane av-library-pane">
            <div class="av-modal-pane-title">Open from library</div>
            <div class="av-lib-grid"></div>
          </section>
        </div>
        <div class="av-busy av-modal-busy"><div class="av-spinner"></div><div class="av-busy-text"></div></div>
      </div>
    `;
    container.appendChild(this.#el);

    this.#input = this.#el.querySelector('input[type="file"]');
    this.#libGrid = this.#el.querySelector('.av-lib-grid');
    this.#libPane = this.#el.querySelector('.av-library-pane');
    this.#busyEl = this.#el.querySelector('.av-modal-busy');
    const dropZone = this.#el.querySelector('.av-process-drop');

    const listen = (target, event, handler) => {
      target.addEventListener(event, handler);
      this.#domListeners.push([target, event, handler]);
    };

    listen(dropZone, 'click', () => this.#input.click());
    listen(this.#input, 'change', () => {
      const file = this.#input.files?.[0];
      if (file) this.emit('processFile', file);
      this.#input.value = '';
    });

    listen(dropZone, 'dragenter', (e) => {
      e.preventDefault();
      this.#dragDepth++;
      dropZone.classList.add('dragover');
    });
    listen(dropZone, 'dragover', (e) => e.preventDefault());
    listen(dropZone, 'dragleave', () => {
      if (--this.#dragDepth <= 0) {
        this.#dragDepth = 0;
        dropZone.classList.remove('dragover');
      }
    });
    listen(dropZone, 'drop', (e) => {
      e.preventDefault();
      this.#dragDepth = 0;
      dropZone.classList.remove('dragover');
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('audio/'));
      if (file) this.emit('processFile', file);
    });

    listen(this.#el.querySelector('.av-modal-close'), 'click', () => this.emit('close'));
    listen(this.#el, 'click', (e) => { if (e.target === this.#el) this.emit('close'); });
    listen(document, 'keydown', (e) => { if (e.key === 'Escape' && this.#isOpen) this.emit('close'); });
  }

  show() {
    this.#isOpen = true;
    this.#el.classList.add('open');
  }

  hide() {
    this.#isOpen = false;
    this.#el.classList.remove('open');
    this.setBusy(null);
  }

  get isOpen() { return this.#isOpen; }

  setServerOnline(online) {
    this.#libPane.style.display = online ? '' : 'none';
  }

  setBusy(text) {
    this.#busyEl.classList.toggle('visible', !!text);
    if (text) this.#busyEl.querySelector('.av-busy-text').textContent = text;
  }

  /** @param {Array} tracks library metadata from AnalysisClient.listLibrary() */
  setLibrary(tracks) {
    this.#libGrid.textContent = '';
    if (!tracks?.length) {
      const empty = document.createElement('div');
      empty.className = 'av-modal-empty';
      empty.textContent = 'No saved tracks yet — process one to get started.';
      this.#libGrid.appendChild(empty);
      return;
    }
    for (const t of tracks) {
      const card = document.createElement('div');
      card.className = 'av-lib-card';
      card.dataset.id = t.id;

      const badge = t.ml ? '✓ stems' : 'DSP';
      const date = (t.createdAt ?? '').slice(0, 10);
      card.innerHTML = `
        <div class="av-lib-main">
          <div class="av-lib-name" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</div>
          <div class="av-lib-meta">
            <span>${formatTime(t.durationSec)}</span>
            <span class="av-lib-badge ${t.ml ? 'ml' : ''}">${badge}</span>
            <span>${date}</span>
          </div>
        </div>
        <button class="av-lib-del" title="Delete" aria-label="Delete">🗑</button>
      `;

      const mainEl = card.querySelector('.av-lib-main');
      const onOpen = () => this.emit('openLibrary', t.id);
      mainEl.addEventListener('click', onOpen);
      this.#domListeners.push([mainEl, 'click', onOpen]);

      const delBtn = card.querySelector('.av-lib-del');
      const onDel = (e) => {
        e.stopPropagation();
        this.emit('deleteLibrary', t.id);
      };
      delBtn.addEventListener('click', onDel);
      this.#domListeners.push([delBtn, 'click', onDel]);

      this.#libGrid.appendChild(card);
    }
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

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
