import { EventEmitter } from '../core/EventEmitter.js';
import { formatTime } from '../utils/format.js';

/**
 * Playback control bar. Emits user intents only — never touches AudioEngine.
 * App pushes display state back in via setTime/setPlaying/setTrackName.
 *
 * Events: 'playToggle', 'seek' (seconds), 'volume' (0..1),
 *         'openFile', 'toggleGallery', 'toggleFullscreen'
 */
export class TransportControls extends EventEmitter {
  #el = null;
  #playBtn = null;
  #seekSlider = null;
  #volumeSlider = null;
  #timeEl = null;
  #nameEl = null;
  #galleryBtn = null;
  #duration = 0;
  #isSeeking = false;
  #domListeners = [];

  attach(container) {
    this.#el = document.createElement('div');
    this.#el.className = 'av-transport';
    this.#el.innerHTML = `
      <button class="av-btn-icon" data-action="library" title="Track library">🗂</button>
      <button class="av-btn-icon" data-action="openFile" title="Open audio file">📂</button>
      <button class="av-btn av-btn-play" data-action="play" title="Play / pause" disabled>▶</button>
      <span class="av-track-name" data-el="name">No track loaded</span>
      <input class="av-slider av-seek" data-el="seek" type="range" min="0" max="1000" value="0" disabled />
      <span class="av-time" data-el="time">0:00 / 0:00</span>
      <div class="av-volume-wrap">
        <span class="av-volume-icon">🔊</span>
        <input class="av-slider av-volume" data-el="volume" type="range" min="0" max="100" value="80" />
      </div>
      <button class="av-btn-icon" data-action="editor" title="Scene editor">✏️</button>
      <button class="av-btn-icon" data-action="gallery" title="Visualizer templates">🎨</button>
      <button class="av-btn-icon" data-action="fullscreen" title="Fullscreen">⛶</button>
    `;
    container.appendChild(this.#el);

    this.#playBtn = this.#el.querySelector('[data-action="play"]');
    this.#seekSlider = this.#el.querySelector('[data-el="seek"]');
    this.#volumeSlider = this.#el.querySelector('[data-el="volume"]');
    this.#timeEl = this.#el.querySelector('[data-el="time"]');
    this.#nameEl = this.#el.querySelector('[data-el="name"]');
    this.#galleryBtn = this.#el.querySelector('[data-action="gallery"]');

    const listen = (target, event, handler) => {
      target.addEventListener(event, handler);
      this.#domListeners.push([target, event, handler]);
    };

    listen(this.#el.querySelector('[data-action="library"]'), 'click', () => this.emit('openLibrary'));
    listen(this.#el.querySelector('[data-action="openFile"]'), 'click', () => this.emit('openFile'));
    listen(this.#playBtn, 'click', () => this.emit('playToggle'));
    listen(this.#galleryBtn, 'click', () => this.emit('toggleGallery'));
    listen(this.#el.querySelector('[data-action="editor"]'), 'click', () => this.emit('toggleEditor'));
    listen(this.#el.querySelector('[data-action="fullscreen"]'), 'click', () => this.emit('toggleFullscreen'));

    // While dragging, programmatic setTime() is suppressed so the thumb
    // doesn't fight the user; the seek fires on release.
    listen(this.#seekSlider, 'pointerdown', () => { this.#isSeeking = true; });
    listen(this.#seekSlider, 'input', () => {
      this.#paintSliderFill(this.#seekSlider);
      this.#timeEl.textContent =
        `${formatTime(this.#sliderToSeconds())} / ${formatTime(this.#duration)}`;
    });
    listen(this.#seekSlider, 'change', () => {
      this.#isSeeking = false;
      this.emit('seek', this.#sliderToSeconds());
    });

    listen(this.#volumeSlider, 'input', () => {
      this.#paintSliderFill(this.#volumeSlider);
      this.emit('volume', this.#volumeSlider.value / 100);
    });

    this.#paintSliderFill(this.#seekSlider);
    this.#paintSliderFill(this.#volumeSlider);
  }

  #sliderToSeconds() {
    return (this.#seekSlider.value / 1000) * this.#duration;
  }

  #paintSliderFill(slider) {
    const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
    slider.style.setProperty('--fill', `${pct}%`);
  }

  get volume() { return this.#volumeSlider.value / 100; }

  setTrack(name, duration) {
    this.#duration = duration;
    this.#nameEl.textContent = name;
    this.#playBtn.disabled = false;
    this.#seekSlider.disabled = false;
  }

  setTime(current, duration) {
    this.#duration = duration || this.#duration;
    if (this.#isSeeking) return;
    this.#timeEl.textContent = `${formatTime(current)} / ${formatTime(this.#duration)}`;
    this.#seekSlider.value = this.#duration ? Math.round((current / this.#duration) * 1000) : 0;
    this.#paintSliderFill(this.#seekSlider);
  }

  setPlaying(isPlaying) {
    this.#playBtn.textContent = isPlaying ? '⏸' : '▶';
  }

  setGalleryOpen(isOpen) {
    this.#galleryBtn.classList.toggle('active', isOpen);
  }

  setEditorOpen(isOpen) {
    this.#el.querySelector('[data-action="editor"]').classList.toggle('active', isOpen);
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
