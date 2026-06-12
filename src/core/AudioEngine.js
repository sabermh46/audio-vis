import { EventEmitter } from './EventEmitter.js';
import { clamp } from '../utils/format.js';

/**
 * Owns all Web Audio + media playback state. Knows nothing about the DOM UI
 * or canvas — it only emits events and exposes a playback API.
 *
 * Graph: MediaElementSource -> Analyser -> Gain -> destination.
 * The analyser sits before the gain so visuals stay alive at low volume.
 *
 * Events: 'trackloaded' {name, duration}, 'play', 'pause', 'ended', 'error' {message}
 */
export class AudioEngine extends EventEmitter {
  #context = null;
  #audio = null;
  #source = null;
  #analyser = null;
  #gain = null;
  #objectUrl = null;
  #hasSrc = false;
  #trackName = '';
  #mediaListeners = [];

  init() {
    this.#context = new (window.AudioContext || window.webkitAudioContext)();

    // One persistent element + one source node for the engine's lifetime:
    // createMediaElementSource throws if called twice on the same element,
    // so new files only ever swap `src`.
    this.#audio = new Audio();
    this.#audio.preload = 'metadata';

    this.#source = this.#context.createMediaElementSource(this.#audio);
    this.#analyser = this.#context.createAnalyser();
    this.#analyser.fftSize = 4096;
    this.#analyser.smoothingTimeConstant = 0.65;
    this.#analyser.minDecibels = -90;
    this.#analyser.maxDecibels = -25;
    this.#gain = this.#context.createGain();

    this.#source.connect(this.#analyser);
    this.#analyser.connect(this.#gain);
    this.#gain.connect(this.#context.destination);

    const listen = (event, handler) => {
      this.#audio.addEventListener(event, handler);
      this.#mediaListeners.push([event, handler]);
    };
    listen('loadedmetadata', () => {
      this.emit('trackloaded', { name: this.#trackName, duration: this.#audio.duration });
    });
    listen('play', () => this.emit('play'));
    listen('pause', () => this.emit('pause'));
    listen('ended', () => this.emit('ended'));
    listen('error', () => {
      this.emit('error', { message: `Could not load "${this.#trackName}". Unsupported or corrupt file.` });
    });
  }

  loadFile(file) {
    if (this.#objectUrl) URL.revokeObjectURL(this.#objectUrl);
    this.#objectUrl = URL.createObjectURL(file);
    this.#trackName = file.name;
    this.#audio.crossOrigin = null; // same-origin object URL
    this.#audio.src = this.#objectUrl;
    this.#hasSrc = true;
  }

  /**
   * Loads audio from a URL (e.g. a library track served by the analysis
   * server). crossOrigin is required so the MediaElementSource analyser tap
   * stays CORS-clean — without it the source taints and frame.waveform goes
   * flat (audio still plays).
   */
  loadUrl(url, { name = '' } = {}) {
    if (this.#objectUrl) {
      URL.revokeObjectURL(this.#objectUrl);
      this.#objectUrl = null;
    }
    this.#trackName = name;
    this.#audio.crossOrigin = 'anonymous';
    this.#audio.src = url;
    this.#hasSrc = true;
  }

  async play() {
    // Autoplay policy: the context starts suspended until a user gesture.
    if (this.#context.state === 'suspended') await this.#context.resume();
    await this.#audio.play();
  }

  pause() {
    this.#audio.pause();
  }

  async toggle() {
    if (this.isPlaying) this.pause();
    else await this.play();
  }

  seek(seconds) {
    if (Number.isFinite(this.duration)) {
      this.#audio.currentTime = clamp(seconds, 0, this.duration);
    }
  }

  setVolume(value) {
    // setTargetAtTime avoids zipper noise on rapid slider moves.
    this.#gain.gain.setTargetAtTime(clamp(value, 0, 1), this.#context.currentTime, 0.015);
  }

  get currentTime() { return this.#audio?.currentTime ?? 0; }
  get duration() { return this.#audio?.duration ?? 0; }
  get isPlaying() { return !!this.#audio && !this.#audio.paused && !this.#audio.ended; }
  get hasTrack() { return this.#hasSrc; }
  get trackName() { return this.#trackName; }
  get analyser() { return this.#analyser; }

  destroy() {
    this.pause();
    for (const [event, handler] of this.#mediaListeners) {
      this.#audio.removeEventListener(event, handler);
    }
    this.#mediaListeners = [];
    this.#audio.removeAttribute('src');
    if (this.#objectUrl) URL.revokeObjectURL(this.#objectUrl);
    this.#objectUrl = null;
    this.#source?.disconnect();
    this.#analyser?.disconnect();
    this.#gain?.disconnect();
    this.#context?.close();
    this.removeAllListeners();
  }
}
