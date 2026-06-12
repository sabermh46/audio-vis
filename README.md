# Audio Visualizer

A browser audio visualizer — vanilla JavaScript front-end (OOP, ES modules, no build step) plus an optional Python analysis server. Drop in an audio file and watch it visualized with whole-track-normalized frequency data, beats, and harmonic/percussive separation.

## Run

**Front-end** — ES modules don't load from `file://`, so serve the folder with any static server:

```sh
python -m http.server 8123
```

Then open <http://localhost:8123>.

**Analysis server (recommended)** — gives far better visuals (see [Two analysis modes](#two-analysis-modes)):

```powershell
python -m venv server\.venv
server\.venv\Scripts\pip install -r server\requirements.txt
server\.venv\Scripts\python -m uvicorn app:app --app-dir server --port 8765
```

The app auto-detects the server. If it's not running, everything still works in realtime mode. (If `pip install` fails on a brand-new Python release — numba/llvmlite wheels lag — create the venv with Python 3.12/3.13.)

**ML stem separation** also requires the `ffmpeg` binary (`winget install Gyan.FFmpeg`, then copy `ffmpeg.exe` into `server\.venv\Scripts\` or restart your shell). Notes:

- First analysis downloads the Demucs model (~81 MB) into `server/.models/` and loads it (~1 min); after that, separation takes roughly the length of the song on CPU.
- Results are cached by content hash in `server/.cache/` — re-loading the same track is instant.
- If separation fails or the track is longer than 12 minutes, the server transparently returns the DSP-only analysis (`ml: false`).
- `POST /analyze?ml=0` skips ML entirely (used by fast tests).
- With `--reload` during development, watchfiles may choke on the venv; prefer running without it and restarting manually.
- Separation uses all **physical** CPU cores (PyTorch's default). Forcing all *logical* cores (hyperthreads) is measurably slower; override only if needed with `AUDIO_VIS_THREADS=<n>` before launching uvicorn. No CUDA/ROCm on Windows/AMD, so CPU is the only path.

## Track library

Processed tracks are saved under `server/library/<trackId>/` (`audio.<ext>` original file, `analysis.json.gz`, `meta.json`, `scenes.json`). On launch a modal offers **Process new audio** or **Open from library** (instant — no re-analysis). `trackId = sha256(original)[:16]` dedups, so a song is only ever processed once. The 🗂 button reopens the library mid-session. Endpoints: `GET /library`, `GET /library/{id}/audio` (HTTP Range for seeking), `GET /library/{id}/analysis`, `DELETE`, `PATCH` (rename), `GET`/`PUT /library/{id}/scenes`. Audio is served cross-origin, so `AudioEngine` sets `crossOrigin='anonymous'` to keep the analyser tap clean.

## Scene editor (per-song hybrids)

The ✏️ button opens a per-song editor: pick a **base visualizer**, drop reactive **elements** on top (Bouncing Star, Mirrored Bars, Pulse Ring, Orbit Dots), and bind each to a signal (`stem.*`, `band.*`, `onset`, `beat`, `volume`, …). Each element reacts at a low default intensity (~30%); on the **timeline strip** you drag to paint time-ranges where it surges toward 100% (with ramp in/out) — e.g. to spotlight a section the ML stems can't isolate. Drag an element on the stage to position it. Saves persist per track and reapply automatically when the song is reopened.

The render side is a `SceneCompositor` (a `Visualizer` subclass) that draws the base, then for each element resolves `signal × sensitivity × intensity` (intensity from `EnvelopeEvaluator` at the audio `currentTime`) and calls the element's `render`. Adding an element = one file in `src/components/` + one `register()` call.

### Scene storage (MySQL, with file fallback)

Scenes are stored in **MySQL** (e.g. XAMPP/phpMyAdmin). Create the database once in phpMyAdmin (default name `audio_vis`); the `scenes` table auto-creates. Configure via env vars before launching uvicorn (XAMPP defaults shown):

```
AUDIO_VIS_DB_HOST=127.0.0.1  AUDIO_VIS_DB_PORT=3306
AUDIO_VIS_DB_USER=root       AUDIO_VIS_DB_PASSWORD=
AUDIO_VIS_DB_NAME=audio_vis
```

If MySQL is unreachable (no driver, DB down, wrong creds), the server transparently falls back to the per-track `scenes.json` file store — the app and tests keep working. `GET /health` reports which is active via `scenesBackend: "mysql" | "file"`.

## Two analysis modes

Music has a ~1/f spectral tilt: on a shared dB scale, bass always reads near max and visuals become bass-dominated. The fix is normalization — and how good it can be depends on when analysis happens:

- **Precomputed (server on)**: on file drop the browser decodes the audio to mono WAV, uploads it, and FastAPI + librosa analyze the whole track: 64-band mel spectrogram, bass/mid/treble energies, onset strength, beat times + tempo, and harmonic-vs-percussive separation (HPSS). Every track is normalized against **its own whole-track 5th–95th percentiles**, so each band/bar moves through its full range. The browser then plays the file and reads the timeline by `currentTime` (lerped between 43 fps analysis frames).
- **+ ML stems**: the server additionally runs **Demucs v4 (htdemucs)** source separation into real instrument stems — `vocals / drums / bass / other` — exposed as per-stem energy timelines (`frame.stems`), and **beat tracking runs on the isolated drums stem** (vocals and synths can't confuse it). This is what frequency analysis fundamentally can't do: a kick drum and a bass guitar both live at 60–100 Hz; only separation tells them apart.
- **Realtime (fallback)**: the native AnalyserNode path with adaptive per-band/per-bar rolling-max normalization (instant attack, ~5 s decay). `frame.stems` falls back to DSP proxies. An amber "Realtime mode" badge shows when active.

## Features

- **Local file playback** — drag & drop or file picker (any browser-playable format); play/pause, seek, volume, time display
- **Logarithmic frequency binning** — 64 bars spaced by octave, matching human pitch perception
- **Band separation** — bass (20–250 Hz), mid/vocal (250 Hz–4 kHz), treble (4–20 kHz), each normalized to its own dynamics
- **Beats, tempo, onsets, harmonic/percussive split** — exact from the server, approximated in realtime mode
- **ML stem separation** — true vocals/drums/bass/other isolation (Demucs v4), drums-derived beat tracking, per-track caching
- **Track library** — every processed song is saved server-side (audio + analysis); a startup modal lets you process new audio or reopen a decoded track instantly
- **Visualizer templates** — a gallery (🎨) to switch visualizers live; ships with Frequency Bars, Waveform, and Stem Shapes
- Fullscreen, DPR-sharp canvas, dark UI

## Architecture

```
src/
├── main.js                  entry: new App().init(container)
├── App.js                   composition root — wires core ↔ UI, owns teardown
├── core/
│   ├── EventEmitter.js      on() returns an unsubscribe fn
│   ├── AudioEngine.js       AudioContext + <audio>; source → analyser → gain → destination
│   ├── FeatureExtractor.js  realtime AnalysisSource: log bars, bands, beat (zero-alloc frame)
│   ├── AnalysisClient.js    health/analyze/library calls + decode-to-WAV upload + response decoding
│   ├── PrecomputedAnalysisSource.js  server timeline lerped by audio currentTime
│   └── VisualizerHost.js    the only canvas + rAF loop; setSource(); DPR resize; fullscreen
├── visualizers/
│   ├── Visualizer.js        base class: onInit / render / onResize / onDestroy + static meta
│   ├── VisualizerRegistry.js plugin registry
│   ├── BarsVisualizer.js
│   └── WaveformVisualizer.js
└── ui/
    ├── DropZone.js           emits 'file'
    ├── TransportControls.js  emits intents: playToggle / seek / volume / …
    ├── TemplateGallery.js    cards from registry.list(); emits 'select'
    ├── StatusIndicator.js    busy spinner + analysis-mode badge (output-only)
    └── StartupModal.js       process-new / open-from-library modal (emits intents)

server/
├── app.py                    FastAPI: /health, /analyze, /library/* (CORS, gzip, sha256 cache, ?ml=)
├── analysis.py               pure librosa DSP + percentile normalization + stem tracks
├── stems.py                  Demucs v4 wrapper (lazy model load, temp-file IO)
├── library.py                persistent track store (audio + analysis + scenes, atomic writes)
└── requirements.txt
```

Both analysis sources implement the same duck-typed interface (`update(nowMs)`, `frame`, `numBars`), so visualizers are mode-agnostic — the frame contract is documented in [Visualizer.js](src/visualizers/Visualizer.js).

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
node .dev/make-test-wav.mjs   # generate the test signal (60Hz / 8kHz / 120BPM clicks)
node .dev/smoke.mjs           # UI shell, gallery, persistence
node .dev/playback.mjs        # playback, band separation, seek, teardown (realtime mode)
node .dev/shapes-check.mjs    # per-shape band isolation
node .dev/envelope-direct.mjs # intensity-envelope unit test (pure, no server/browser)
node .dev/scenes-endpoint.mjs # scene GET/PUT round-trip (server must be up; prints backend)
node .dev/editor-flow.mjs     # spawns uvicorn; add element -> paint region -> save -> reapply
node .dev/precomputed.mjs     # spawns uvicorn; full server-analysis path incl. ML stems
node .dev/fallback.mjs        # server down -> realtime fallback + badge
node .dev/analyze-endpoint.mjs           # endpoint schema, ML, cache (server must be up)
node .dev/library-endpoint.mjs           # library CRUD, audio Range, scenes (server must be up)
node .dev/library-flow.mjs               # spawns uvicorn; process -> reopen-from-library flow
server\.venv\Scripts\python .dev\analysis-direct.py   # unit check of analysis.py (DSP + ML)
server\.venv\Scripts\python .dev\stems-smoke.py       # separation sanity on test.wav
```
