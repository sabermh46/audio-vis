import { AudioEngine } from './core/AudioEngine.js';
import { FeatureExtractor } from './core/FeatureExtractor.js';
import { VisualizerHost } from './core/VisualizerHost.js';
import { VisualizerRegistry } from './visualizers/VisualizerRegistry.js';
import { BarsVisualizer } from './visualizers/BarsVisualizer.js';
import { WaveformVisualizer } from './visualizers/WaveformVisualizer.js';
import { DropZone } from './ui/DropZone.js';
import { TransportControls } from './ui/TransportControls.js';
import { TemplateGallery } from './ui/TemplateGallery.js';

const STORAGE_KEY = 'audio-vis:visualizer';
const DEFAULT_VISUALIZER = 'bars';

/**
 * Composition root. Instantiates core + UI, mediates all events between
 * them (UI emits intents, core emits state), and owns full teardown.
 * A future React wrapper calls exactly this: new App().init(node) /
 * app.destroy() inside useEffect.
 */
export class App {
  audioEngine = null;
  extractor = null;
  host = null;
  registry = null;

  #dropZone = null;
  #transport = null;
  #gallery = null;
  #root = null;
  #idleEl = null;
  #unsubscribers = [];

  init(container) {
    this.#root = document.createElement('div');
    this.#root.className = 'av-app';
    this.#root.innerHTML = `
      <div class="av-stage">
        <div class="av-idle">
          <div class="icon">🎵</div>
          <div class="hint">Drop an audio file here, or click to browse</div>
        </div>
      </div>
    `;
    container.appendChild(this.#root);
    const stage = this.#root.querySelector('.av-stage');
    this.#idleEl = this.#root.querySelector('.av-idle');

    // --- Core ---
    this.audioEngine = new AudioEngine();
    this.audioEngine.init();
    this.extractor = new FeatureExtractor(this.audioEngine.analyser, { numBars: 64 });
    this.host = new VisualizerHost(this.extractor);
    this.host.attach(stage);

    this.registry = new VisualizerRegistry();
    this.registry.register(BarsVisualizer);
    this.registry.register(WaveformVisualizer);

    // --- UI ---
    this.#dropZone = new DropZone();
    this.#dropZone.attach(stage);
    this.#transport = new TransportControls();
    this.#transport.attach(this.#root);
    this.#gallery = new TemplateGallery(this.registry);
    this.#gallery.attach(stage);

    this.#wire();
    this.#selectVisualizer(this.#restoreVisualizerId());
    this.audioEngine.setVolume(this.#transport.volume);
  }

  #wire() {
    const sub = (unsubscribe) => this.#unsubscribers.push(unsubscribe);

    // UI intents -> core
    sub(this.#dropZone.on('file', (file) => this.#loadFile(file)));
    sub(this.#transport.on('openFile', () => this.#dropZone.openPicker()));
    sub(this.#transport.on('playToggle', () => this.audioEngine.toggle()));
    sub(this.#transport.on('seek', (seconds) => this.audioEngine.seek(seconds)));
    sub(this.#transport.on('volume', (value) => this.audioEngine.setVolume(value)));
    sub(this.#transport.on('toggleFullscreen', () => this.host.toggleFullscreen()));
    sub(this.#transport.on('toggleGallery', () => {
      this.#transport.setGalleryOpen(this.#gallery.toggle());
    }));
    sub(this.#gallery.on('select', (id) => {
      this.#selectVisualizer(id);
      this.#transport.setGalleryOpen(this.#gallery.toggle(false));
    }));

    // Core state -> UI
    sub(this.audioEngine.on('trackloaded', ({ name, duration }) => {
      this.#transport.setTrack(name, duration);
      this.#idleEl.classList.add('hidden');
      this.#dropZone.setClickThrough(true);
      this.host.start();
      this.audioEngine.play().catch(() => {/* user can press play manually */});
    }));
    sub(this.audioEngine.on('play', () => this.#transport.setPlaying(true)));
    sub(this.audioEngine.on('pause', () => this.#transport.setPlaying(false)));
    sub(this.audioEngine.on('ended', () => this.#transport.setPlaying(false)));
    sub(this.audioEngine.on('error', ({ message }) => {
      this.#idleEl.classList.remove('hidden');
      this.#idleEl.querySelector('.hint').textContent = message;
      this.#dropZone.setClickThrough(false);
    }));

    // Per-frame: drive the 60fps time display from the render loop
    // (the media element's timeupdate event only fires ~4x per second).
    sub(this.host.on('tick', () => {
      this.#transport.setTime(this.audioEngine.currentTime, this.audioEngine.duration);
    }));
  }

  #loadFile(file) {
    this.audioEngine.loadFile(file);
  }

  #selectVisualizer(id) {
    if (!this.registry.has(id)) id = DEFAULT_VISUALIZER;
    this.host.setVisualizer(this.registry.create(id));
    this.#gallery.setActive(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* private mode */ }
  }

  #restoreVisualizerId() {
    try { return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_VISUALIZER; }
    catch { return DEFAULT_VISUALIZER; }
  }

  destroy() {
    for (const unsubscribe of this.#unsubscribers) unsubscribe();
    this.#unsubscribers = [];
    this.host.destroy();
    this.#gallery.destroy();
    this.#transport.destroy();
    this.#dropZone.destroy();
    this.audioEngine.destroy();
    this.#root?.remove();
  }
}
