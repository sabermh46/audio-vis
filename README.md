# Audio Visualizer

A browser audio visualizer in pure vanilla JavaScript — OOP, ES modules, zero dependencies, no build step. Drop in an audio file and watch it analyzed live with the native Web Audio API.

## Run

ES modules don't load from `file://`, so serve the folder with any static server:

```sh
python -m http.server 8000
# or: npx serve
```

Then open <http://localhost:8000>.

## Features

- **Local file playback** — drag & drop or file picker; play/pause, seek, volume, time display
- **Native audio analysis** (no third-party packages): FFT via `AnalyserNode`
  - **Logarithmic frequency binning** — 64 bars spaced by octave, matching human pitch perception
  - **Band separation** — bass (20–250 Hz), mid/vocal (250 Hz–4 kHz), treble (4–20 kHz) energies, raw + smoothed
  - **Beat detection** — bass-energy flux against a rolling average with a refractory period
- **Visualizer templates** — a gallery (🎨) to switch visualizers live; ships with Frequency Bars and Waveform
- Fullscreen, DPR-sharp canvas, dark UI

## Architecture

```
src/
├── main.js                  entry: new App().init(container)
├── App.js                   composition root — wires core ↔ UI, owns teardown
├── core/
│   ├── EventEmitter.js      on() returns an unsubscribe fn
│   ├── AudioEngine.js       AudioContext + <audio>; source → analyser → gain → destination
│   ├── FeatureExtractor.js  per-frame: log bars, band energies, beat (zero-alloc frame object)
│   └── VisualizerHost.js    the only canvas + rAF loop; DPR resize; fullscreen
├── visualizers/
│   ├── Visualizer.js        base class: onInit / render / onResize / onDestroy + static meta
│   ├── VisualizerRegistry.js plugin registry
│   ├── BarsVisualizer.js
│   └── WaveformVisualizer.js
└── ui/
    ├── DropZone.js           emits 'file'
    ├── TransportControls.js  emits intents: playToggle / seek / volume / …
    └── TemplateGallery.js    cards from registry.list(); emits 'select'
```

Design rules:

- **UI emits intents, core emits state, `App` mediates** — UI components never touch `AudioEngine` directly.
- **One persistent `<audio>` element + one `MediaElementAudioSourceNode`** (the API allows only one per element); new files just swap `src` via object URLs.
- **Zero allocation in the render loop** — the analysis frame object and arrays are preallocated and reused.

### Adding a visualizer

1. Create a class in `src/visualizers/` extending `Visualizer`; implement `static get meta()`, `render()`, and optionally `static renderPreview()` for its gallery card.
2. Register it in `App.js`: `this.registry.register(MyVisualizer)`.

It appears in the template gallery automatically.

### React integration (future)

The core is framework-agnostic; a wrapper is ~5 lines:

```jsx
function VisualizerView() {
  const ref = useRef(null);
  useEffect(() => {
    const app = new App();
    app.init(ref.current);
    return () => app.destroy();
  }, []);
  return <div ref={ref} style={{ height: '100%' }} />;
}
```

Subscribe to engine state with `useSyncExternalStore` — `engine.on(event, fn)` already returns the unsubscribe function React expects. Only the `ui/` layer would be rewritten as JSX; `core/` and `visualizers/` import unchanged.

## Dev tests

Headless browser checks live in `.dev/` (requires `playwright-core` installed in `%TEMP%/av-driver` and Edge or Chrome):

```sh
node .dev/smoke.mjs       # UI shell, gallery, persistence
node .dev/make-test-wav.mjs && node .dev/playback.mjs   # playback, band separation, seek, teardown
```
