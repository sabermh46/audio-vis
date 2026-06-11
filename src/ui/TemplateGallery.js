import { EventEmitter } from '../core/EventEmitter.js';

const PREVIEW_W = 180;
const PREVIEW_H = 84;

/**
 * Visualizer template section: a slide-up panel of cards, one per
 * registered visualizer. Previews are drawn once via each class's static
 * renderPreview hook. Emits 'select' (id) — App performs the actual swap.
 */
export class TemplateGallery extends EventEmitter {
  #registry;
  #el = null;
  #grid = null;
  #isOpen = false;
  #activeId = null;
  #domListeners = [];

  constructor(registry) {
    super();
    this.#registry = registry;
  }

  attach(container) {
    this.#el = document.createElement('div');
    this.#el.className = 'av-gallery';
    this.#el.innerHTML = `
      <div class="av-gallery-title">Visualizer templates</div>
      <div class="av-gallery-grid"></div>
    `;
    this.#grid = this.#el.querySelector('.av-gallery-grid');
    container.appendChild(this.#el);
    this.#buildCards();
  }

  #buildCards() {
    this.#grid.textContent = '';
    const dpr = window.devicePixelRatio || 1;

    for (const meta of this.#registry.list()) {
      const card = document.createElement('button');
      card.className = 'av-card';
      card.dataset.id = meta.id;

      const VisualizerClass = this.#registry.getClass(meta.id);
      if (VisualizerClass.renderPreview !== Object.getPrototypeOf(VisualizerClass).renderPreview) {
        const canvas = document.createElement('canvas');
        canvas.width = PREVIEW_W * dpr;
        canvas.height = PREVIEW_H * dpr;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        VisualizerClass.renderPreview(ctx, PREVIEW_W, PREVIEW_H);
        card.appendChild(canvas);
      }

      const body = document.createElement('div');
      body.className = 'av-card-body';
      const name = document.createElement('div');
      name.className = 'av-card-name';
      name.textContent = meta.name;
      const desc = document.createElement('div');
      desc.className = 'av-card-desc';
      desc.textContent = meta.description ?? '';
      body.append(name, desc);
      card.appendChild(body);

      const handler = () => this.emit('select', meta.id);
      card.addEventListener('click', handler);
      this.#domListeners.push([card, 'click', handler]);
      this.#grid.appendChild(card);
    }
  }

  setActive(id) {
    this.#activeId = id;
    for (const card of this.#grid.children) {
      card.classList.toggle('active', card.dataset.id === id);
    }
  }

  get isOpen() { return this.#isOpen; }

  toggle(force) {
    this.#isOpen = force ?? !this.#isOpen;
    this.#el.classList.toggle('open', this.#isOpen);
    return this.#isOpen;
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
