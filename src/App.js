import { AudioEngine } from './core/AudioEngine.js';
import { FeatureExtractor } from './core/FeatureExtractor.js';
import { VisualizerHost } from './core/VisualizerHost.js';
import { VisualizerRegistry } from './visualizers/VisualizerRegistry.js';
import { AuroraConfluenceVisualizer } from './visualizers/AuroraConfluenceVisualizer.js';
import { QuadOrbitVisualizer } from './visualizers/QuadOrbitVisualizer.js';
import { NebulaGardenVisualizer } from './visualizers/NebulaGardenVisualizer.js';
import { CelestialOrreryVisualizer } from './visualizers/CelestialOrreryVisualizer.js';
import { BarsVisualizer } from './visualizers/BarsVisualizer.js';
import { WaveformVisualizer } from './visualizers/WaveformVisualizer.js';
import { ShapesVisualizer } from './visualizers/ShapesVisualizer.js';
import { HyperspaceVisualizer } from './visualizers/HyperspaceVisualizer.js';
import { RiverNightVisualizer } from './visualizers/RiverNightVisualizer.js';
import { SceneCompositor } from './visualizers/SceneCompositor.js';
import { ComponentRegistry } from './components/ComponentRegistry.js';
import { BouncingStar } from './components/BouncingStar.js';
import { MirroredBars } from './components/MirroredBars.js';
import { PulseRing } from './components/PulseRing.js';
import { OrbitDots } from './components/OrbitDots.js';
import { StaticMoon } from './components/StaticMoon.js';
import { CloudGroup } from './components/CloudGroup.js';
import { Starfield } from './components/Starfield.js';
import { AnalysisClient } from './core/AnalysisClient.js';
import { PrecomputedAnalysisSource } from './core/PrecomputedAnalysisSource.js';
import { DropZone } from './ui/DropZone.js';
import { TransportControls } from './ui/TransportControls.js';
import { TemplateGallery } from './ui/TemplateGallery.js';
import { StatusIndicator } from './ui/StatusIndicator.js';
import { StartupModal } from './ui/StartupModal.js';
import { SceneEditor } from './ui/SceneEditor.js';
import { VideoExporter } from './components/VideoExporter.js';
import { ExportOverlay } from './ui/ExportOverlay.js';


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
  componentRegistry = null;
  analysisClient = null;
  precomputedSource = null;
  compositor = null;
  mode = null; // 'precomputed' | 'realtime' | null

  #dropZone = null;
  #transport = null;
  #gallery = null;
  #status = null;
  #modal = null;
  #editor = null;
  #exportOverlay = null;
  #activeExporter = null;
  #editorOpen = false;
  #hasSavedScene = false;
  #root = null;
  #idleEl = null;
  #unsubscribers = [];
  #analysisAbort = null;
  #loadSeq = 0;
  #libraryCache = [];

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
    this.analysisClient = new AnalysisClient();

    this.registry = new VisualizerRegistry();
    this.registry.register(HyperspaceVisualizer);
    this.registry.register(AuroraConfluenceVisualizer);
    this.registry.register(QuadOrbitVisualizer);
    this.registry.register(NebulaGardenVisualizer);
    this.registry.register(BarsVisualizer);
    this.registry.register(WaveformVisualizer);
    this.registry.register(ShapesVisualizer);
    this.registry.register(CelestialOrreryVisualizer);
    this.registry.register(RiverNightVisualizer);

    this.componentRegistry = new ComponentRegistry();
    this.componentRegistry.register(BouncingStar);
    this.componentRegistry.register(MirroredBars);
    this.componentRegistry.register(PulseRing);
    this.componentRegistry.register(OrbitDots);
    this.componentRegistry.register(StaticMoon);
    this.componentRegistry.register(CloudGroup);
    this.componentRegistry.register(Starfield);

    // --- UI ---
    this.#dropZone = new DropZone();
    this.#dropZone.attach(stage);
    this.#transport = new TransportControls();
    this.#transport.attach(this.#root);
    this.#gallery = new TemplateGallery(this.registry);
    this.#gallery.attach(stage);
    this.#status = new StatusIndicator();
    this.#status.attach(stage);
    this.#modal = new StartupModal();
    this.#modal.attach(this.#root);
    this.#editor = new SceneEditor();
    this.#editor.attach(stage);
    this.#exportOverlay = new ExportOverlay();
    this.#exportOverlay.attach(stage, () => this.#cancelExport());
    this.#editor.setComponentList(this.componentRegistry.list());
    this.#editor.setBaseOptions(this.registry.list().map((m) => ({ id: m.id, name: m.name })));
    this.#editor.setEnabled(false);

    this.#wire();
    this.#selectVisualizer(this.#restoreVisualizerId());
    this.audioEngine.setVolume(this.#transport.volume);
    this.#showStartup();
  }

  async #showStartup() {
    this.#modal.show();
    const health = await this.analysisClient.getHealth();
    this.#modal.setServerOnline(health.ok);
    if (health.ok) await this.#refreshLibrary();
  }

  async #refreshLibrary() {
    try {
      this.#libraryCache = await this.analysisClient.listLibrary();
      this.#modal.setLibrary(this.#libraryCache);
    } catch {
      this.#modal.setServerOnline(false);
    }
  }

  #wire() {
    const sub = (unsubscribe) => this.#unsubscribers.push(unsubscribe);

    // Startup / library modal intents
    sub(this.#modal.on('processFile', (file) => this.#loadFile(file)));
    sub(this.#modal.on('openLibrary', (id) => this.#loadFromLibrary(id)));
    sub(this.#modal.on('deleteLibrary', async (id) => {
      try { await this.analysisClient.deleteLibraryEntry(id); } catch { /* ignore */ }
      await this.#refreshLibrary();
    }));
    sub(this.#modal.on('renameLibrary', async ({ id, name }) => {
      try { await this.analysisClient.renameLibraryEntry(id, name); } catch { /* ignore */ }
      await this.#refreshLibrary();
    }));
    sub(this.#modal.on('close', () => {
      if (this.audioEngine.hasTrack) this.#modal.hide();
    }));

    // UI intents -> core
    sub(this.#dropZone.on('file', (file) => this.#loadFile(file)));
    sub(this.#transport.on('openFile', () => this.#dropZone.openPicker()));
    sub(this.#transport.on('openLibrary', () => { this.#refreshLibrary(); this.#modal.show(); }));
    sub(this.#transport.on('toggleEditor', () => this.#toggleEditor()));

    // Scene editor intents -> compositor + persistence
    sub(this.#editor.on('addComponent', (type) => this.#addComponent(type)));
    sub(this.#editor.on('removeComponent', (id) => {
      this.compositor?.removeComponent(id);
      this.#editor.setScene(this.compositor?.getScene() ?? this.#blankScene());
    }));
    sub(this.#editor.on('updateComponent', ({ id, patch }) => this.compositor?.updateComponent(id, patch)));
    sub(this.#editor.on('updateBase', (patch) => this.compositor?.updateBase(patch)));
    sub(this.#editor.on('setBase', (id) => {
      this.#ensureCompositor();
      this.compositor.setBaseVisualizer(id ? this.registry.create(id) : null, id); // resets base params/automation
      this.#pushBaseParams();
      this.#editor.setScene(this.compositor.getScene());
    }));
    sub(this.#editor.on('seek', (seconds) => this.audioEngine.seek(seconds)));
    sub(this.#editor.on('save', () => this.#saveScene()));
    sub(this.#editor.on('loadSaved', () => this.#loadSavedScene()));
    sub(this.#editor.on('clearScene', () => this.#clearScene()));
    sub(this.#editor.on('close', () => this.#toggleEditor(false)));
    sub(this.#transport.on('playToggle', () => this.audioEngine.toggle()));
    sub(this.#transport.on('seek', (seconds) => this.audioEngine.seek(seconds)));
    sub(this.#transport.on('volume', (value) => this.audioEngine.setVolume(value)));
    sub(this.#transport.on('export', () => this.#startExport()));
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
      this.#editor.setEnabled(true);
      this.#syncExportBtn(); // mode is already set by the time trackloaded fires
      this.host.start();
      this.#applySceneForTrack();
      this.audioEngine.play().catch(() => {/* user can press play manually */});
    }));
    sub(this.audioEngine.on('play', () => this.#transport.setPlaying(true)));
    sub(this.audioEngine.on('pause', () => this.#transport.setPlaying(false)));
    sub(this.audioEngine.on('ended', () => this.#transport.setPlaying(false)));
    sub(this.audioEngine.on('error', ({ message }) => {
      this.#idleEl.classList.remove('hidden');
      this.#idleEl.querySelector('.hint').textContent = message;
      this.#dropZone.setClickThrough(false);
      // A library audio URL that 404s (e.g. server went offline) lands here —
      // reopen the modal so the user can pick again.
      this.#modal.setServerOnline(false);
      this.#modal.show();
    }));

    // Per-frame: drive the 60fps time display from the render loop
    // (the media element's timeupdate event only fires ~4x per second).
    sub(this.host.on('tick', () => {
      this.#transport.setTime(this.audioEngine.currentTime, this.audioEngine.duration);
      if (this.#editorOpen) this.#editor.setTime(this.audioEngine.currentTime);
    }));
  }

  /**
   * Analysis-first load: try the Python server for whole-track-normalized
   * data; on any failure fall back to the realtime extractor. Playback
   * starts only after the analysis question is settled (loadFile is last —
   * its trackloaded handler auto-plays).
   */
  async #loadFile(file) {
    const seq = ++this.#loadSeq;
    this.#analysisAbort?.abort();
    this.#analysisAbort = new AbortController();
    this.#status.setMode(null);
    this.#status.setBusy('Checking analysis server…');

    let usePrecomputed = false;
    let mlUsed = false;
    const health = await this.analysisClient.getHealth();
    if (health.ok) {
      try {
        const analyzingText =
          health.ml === 'cold'
            ? 'Separating stems — first run loads the model, this can take a few minutes…'
            : health.ml === 'ready'
              ? 'Separating stems… (about the length of the song, cached afterwards)'
              : 'Analyzing audio…';
        const phaseText = {
          decoding: 'Decoding audio…',
          uploading: 'Uploading…',
          analyzing: analyzingText,
        };
        const analysis = await this.analysisClient.analyze(file, {
          onPhase: (phase) => this.#status.setBusy(phaseText[phase]),
          signal: this.#analysisAbort.signal,
        });
        if (seq !== this.#loadSeq) return; // superseded by a newer file drop
        this.lastAnalysis = analysis; // exposed for tests/debugging
        this.precomputedSource = new PrecomputedAnalysisSource(analysis, {
          getTime: () => this.audioEngine.currentTime,
          analyser: this.audioEngine.analyser,
        });
        this.host.setSource(this.precomputedSource);
        usePrecomputed = true;
        mlUsed = analysis.ml;
      } catch (e) {
        if (seq !== this.#loadSeq) return;
        // Don't let silent fallback mask real bugs (CORS, server errors).
        console.warn('[audio-vis] analysis failed, falling back to realtime:', e);
      }
    }
    if (seq !== this.#loadSeq) return;

    if (!usePrecomputed) {
      this.precomputedSource = null;
      this.host.setSource(this.extractor);
    }
    this.mode = usePrecomputed ? 'precomputed' : 'realtime';
    this.#status.setMode(this.mode, { ml: mlUsed });
    this.#status.setBusy(null);
    this.#modal.hide();
    this.audioEngine.loadFile(file);
    // A processed track is now in the server library — refresh the list.
    if (usePrecomputed) this.#refreshLibrary();
  }

  /**
   * Instant load of a previously-processed track from the library — no
   * re-analysis. On fetch failure stay in the modal and flag the server
   * offline (the audio URL would 404 too).
   */
  async #loadFromLibrary(id) {
    const seq = ++this.#loadSeq;
    this.#analysisAbort?.abort();
    this.#status.setMode(null);
    this.#status.setBusy('Loading from library…');

    let analysis;
    try {
      analysis = await this.analysisClient.getLibraryAnalysis(id);
    } catch {
      this.#status.setBusy(null);
      this.#modal.setServerOnline(false);
      return;
    }
    if (seq !== this.#loadSeq) return;

    this.lastAnalysis = analysis;
    this.precomputedSource = new PrecomputedAnalysisSource(analysis, {
      getTime: () => this.audioEngine.currentTime,
      analyser: this.audioEngine.analyser,
    });
    this.host.setSource(this.precomputedSource);
    this.mode = 'precomputed';
    this.#status.setMode('precomputed', { ml: analysis.ml });
    this.#status.setBusy(null);
    this.#modal.hide();

    const meta = this.#libraryCache.find((t) => t.id === id);
    this.audioEngine.loadUrl(this.analysisClient.libraryAudioUrl(id), { name: meta?.name ?? '' });
  }

  #selectVisualizer(id) {
    if (!this.registry.has(id)) id = DEFAULT_VISUALIZER;
    // Picking from the gallery outside the editor drops any active hybrid,
    // so the gallery behaves exactly as before this feature.
    if (this.compositor && !this.#editorOpen) this.compositor = null;
    this.host.setVisualizer(this.registry.create(id));
    this.#gallery.setActive(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* private mode */ }
  }

  /** Base visualizer id currently in effect (compositor's base, else stored). */
  #currentBaseId() {
    if (this.compositor) return this.compositor.getScene().base?.id ?? DEFAULT_VISUALIZER;
    return this.#restoreVisualizerId();
  }

  /** Push the current base visualizer's keyframable descriptors to the editor. */
  #pushBaseParams() {
    const id = this.#currentBaseId();
    this.#editor.setBaseParams(this.registry.getClass(id)?.params ?? []);
  }

  #blankScene(baseId) {
    const id = baseId ?? this.#currentBaseId();
    return {
      id: `scene-${Math.floor(this.audioEngine.currentTime * 1000) % 1e6}-${this.#loadSeq}`,
      name: 'Scene',
      base: { id, params: {}, automation: {} },
      canvas: { bg: '#05060c', blendMode: 'source-over', fadeTrails: 0 },
      components: [],
    };
  }

  /** Build a compositor wrapping the current base (used when entering edit). */
  #ensureCompositor() {
    if (this.compositor) return;
    const baseId = this.#currentBaseId();
    this.compositor = new SceneCompositor({
      baseVisualizer: this.registry.create(baseId),
      scene: this.#blankScene(baseId),
      getTime: () => this.audioEngine.currentTime,
      getDuration: () => this.audioEngine.duration,
      componentRegistry: this.componentRegistry,
    });
    this.host.setVisualizer(this.compositor);
  }

  /** On track load: reapply a saved hybrid scene if one exists for this track. */
  async #applySceneForTrack() {
    const trackId = this.lastAnalysis?.trackId;
    if (!trackId || this.mode !== 'precomputed') { this.#clearCompositor(); return; }
    let envelope = null;
    try { envelope = await this.analysisClient.getScenes(trackId); } catch { /* offline */ }
    const scene = envelope?.scenes?.[0];
    const baseAuto = (scene && typeof scene.base === 'object') ? scene.base.automation : null;
    this.#hasSavedScene = !!(scene && (scene.components?.length || (baseAuto && Object.keys(baseAuto).length)));
    if (this.#hasSavedScene) {
      const baseId = (typeof scene.base === 'object' ? scene.base?.id : scene.base) ?? this.#currentBaseId();
      this.compositor = new SceneCompositor({
        baseVisualizer: baseId ? this.registry.create(baseId) : null,
        scene,
        getTime: () => this.audioEngine.currentTime,
        getDuration: () => this.audioEngine.duration,
        componentRegistry: this.componentRegistry,
      });
      this.host.setVisualizer(this.compositor);
    } else {
      this.#clearCompositor();
    }
    this.#syncExportBtn();
    if (this.#editorOpen) {
      this.#pushBaseParams();
      this.#editor.setScene(this.compositor?.getScene() ?? this.#blankScene());
      this.#pushEditorTrack();
    }
  }

  #pushEditorTrack() {
    const trackId = this.lastAnalysis?.trackId ?? null;
    this.#editor.setTrack({
      trackId,
      duration: this.audioEngine.duration,
      beats: this.lastAnalysis?.beats ?? new Float64Array(0),
      canSave: !!trackId && this.mode === 'precomputed',
      hasSaved: this.#hasSavedScene,
    });
  }

  /** Explicit "Load saved" — re-fetch the persisted scene and reapply it. */
  async #loadSavedScene() {
    await this.#applySceneForTrack();
    if (this.#editorOpen) {
      this.#ensureCompositor();
      this.#pushBaseParams();
      this.#editor.setScene(this.compositor.getScene());
      this.#pushEditorTrack();
    }
  }

  /** Empty the components (keeps the base layer + its keyframes). Save to persist. */
  #clearScene() {
    this.#ensureCompositor();
    const scene = this.compositor.getScene();
    scene.components = [];
    this.compositor.setScene(scene);
    this.#pushBaseParams();
    this.#editor.setScene(this.compositor.getScene());
  }

  #clearCompositor() {
    if (!this.compositor) return;
    this.compositor = null;
    this.host.setVisualizer(this.registry.create(this.#restoreVisualizerId()));
    this.#syncExportBtn();
  }

  #syncExportBtn() {
    const canExport = this.mode === 'precomputed' && !this.#editorOpen;
    this.#transport.setExportEnabled(canExport);
  }

  #toggleEditor(force) {
    if (!this.audioEngine.hasTrack) return;
    this.#editorOpen = this.#editor.toggle(force);
    this.#transport.setEditorOpen(this.#editorOpen);
    this.#syncExportBtn();
    if (this.#editorOpen) {
      this.#ensureCompositor();
      this.compositor.setMode('edit'); // live keyframe eval while authoring
      this.#editor.setEnabled(true);
      this.#pushBaseParams();
      this.#pushEditorTrack();
      this.#editor.setScene(this.compositor.getScene());
    } else {
      if (this.#canSaveScene()) this.#saveScene(); // autosave on close
      // Back to optimized playback: precomputed automation tables.
      this.compositor?.setMode('play');
    }
  }

  #canSaveScene() {
    return !!this.lastAnalysis?.trackId && this.mode === 'precomputed' && !!this.compositor;
  }

  #addComponent(type) {
    if (!this.compositor) this.#ensureCompositor();
    const meta = this.componentRegistry.getClass(type)?.meta;
    if (!meta) return;
    const component = {
      id: `cmp-${this.#loadSeq}-${this.compositor.getScene().components.length}-${type}`,
      type,
      enabled: true,
      z: this.compositor.getScene().components.length,
      bind: { signal: meta.defaultSignal },
      params: { ...meta.defaults },
      automation: {},
    };
    this.compositor.addComponent(component);
    this.#editor.setScene(this.compositor.getScene());
  }

  async #saveScene() {
    const trackId = this.lastAnalysis?.trackId;
    if (!trackId || this.mode !== 'precomputed' || !this.compositor) return;
    const scene = this.compositor.getScene();
    // Preserve the base OBJECT (params + automation); just resync its id.
    if (scene.base && typeof scene.base === 'object') scene.base.id = this.#currentBaseId();
    else scene.base = { id: this.#currentBaseId(), params: {}, automation: {} };
    try {
      await this.analysisClient.saveScene(trackId, { schemaVersion: 2, scenes: [scene] });
      this.#hasSavedScene = scene.components.length > 0 || Object.keys(scene.base.automation ?? {}).length > 0;
      this.#editor?.flashSaved();
      if (this.#editorOpen) this.#pushEditorTrack();
    } catch (e) {
      console.warn('[audio-vis] scene save failed', e);
    }
  }

  async #startExport() {
    if (this.mode !== 'precomputed' || this.#editorOpen || !this.lastAnalysis) return;
    if (this.#activeExporter) { this.#cancelExport(); return; }

    this.compositor?.setMode('play'); // ensure precomputed tables are compiled (if a scene is active)
    this.host.stop();                 // freeze live render — exporter drives the host independently

    this.audioEngine.pause(); // stop playback while export runs (faster + no audio leakage)

    const exporter = new VideoExporter({
      host: this.host,
      compositor: this.compositor ?? null,
      analysis: this.lastAnalysis,
      getDuration: () => this.audioEngine.duration,
      getAudioBuffer: () => this.audioEngine.decodeAudioBuffer(),
      filename: this.#exportFilename(),
    });
    this.#activeExporter = exporter;
    this.#exportOverlay.show();
    this.#transport.setExporting(true);

    exporter.on('status', (text) => this.#exportOverlay.setStatus(text));
    exporter.on('progress', (frac, fi, total) => this.#exportOverlay.setProgress(frac, fi, total));
    exporter.on('error', (msg) => {
      console.error('[export]', msg);
      this.#activeExporter = null;
      this.#transport.setExporting(false);
      this.host.start(); // resume live render even on error
      this.#exportOverlay.setStatus(`Error: ${msg}`);
      setTimeout(() => this.#exportOverlay.hide(), 4000);
    });
    exporter.on('done', (blob) => this.#finishExport(blob));
    exporter.on('aborted', () => this.#finishExport(null));

    await exporter.start();
  }

  #finishExport(blob) {
    this.#activeExporter = null;
    this.#exportOverlay.hide();
    this.#transport.setExporting(false);
    this.host.start(); // resume live render
    if (blob) this.#downloadBlob(blob, this.#exportFilename());
  }

  #cancelExport() {
    this.#activeExporter?.abort();
  }

  #exportFilename() {
    const base = this.audioEngine.trackName.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_\-. ]/gi, '_');
    return `${base || 'export'}-1440p.mp4`;
  }

  async #downloadBlob(blob, filename) {
    // Try the native Save-As picker first (Chrome/Edge).
    if (typeof showSaveFilePicker === 'function') {
      try {
        const handle = await showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (e) {
        if (e.name === 'AbortError') return; // user cancelled picker
        // fall through to <a> download on any other error
      }
    }
    // Fallback: silent download to the browser's default downloads folder.
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  #restoreVisualizerId() {
    try { return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_VISUALIZER; }
    catch { return DEFAULT_VISUALIZER; }
  }

  destroy() {
    this.#analysisAbort?.abort();
    this.#activeExporter?.abort();
    for (const unsubscribe of this.#unsubscribers) unsubscribe();
    this.#unsubscribers = [];
    this.host.destroy();
    this.#status.destroy();
    this.#gallery.destroy();
    this.#transport.destroy();
    this.#dropZone.destroy();
    this.#modal.destroy();
    this.#editor.destroy();
    this.audioEngine.destroy();
    this.#exportOverlay.destroy();
    this.#root?.remove();
  }
}
