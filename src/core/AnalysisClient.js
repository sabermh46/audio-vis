import { decodeFileToMonoWav } from '../utils/wav.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8765'; // 127.0.0.1: avoids Windows ::1 stalls

export class AnalysisError extends Error {
  constructor(message, phase) {
    super(message);
    this.name = 'AnalysisError';
    this.phase = phase;
  }
}

/**
 * Client for the Python analysis server. Decodes the file to mono WAV in
 * the browser (so the server never needs codecs), uploads it, and decodes
 * the base64 uint8 tracks of the response into typed arrays.
 *
 * Throws AnalysisError on any failure — the caller (App) decides whether
 * to fall back; this class never falls back silently.
 */
export class AnalysisClient {
  #baseUrl;

  constructor({ baseUrl = DEFAULT_BASE_URL } = {}) {
    this.#baseUrl = baseUrl;
  }

  /** Quick health probe; false on any failure (server down, CORS, timeout). */
  async isAvailable(timeoutMs = 1200) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.#baseUrl}/health`, { signal: controller.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * @param {File} file
   * @param {{onPhase?: (phase: 'decoding'|'uploading'|'analyzing') => void, signal?: AbortSignal}} opts
   */
  async analyze(file, { onPhase, signal } = {}) {
    onPhase?.('decoding');
    let wavBlob;
    try {
      wavBlob = await decodeFileToMonoWav(file, 44100);
    } catch (e) {
      throw new AnalysisError(`Could not decode audio: ${e.message ?? e}`, 'decoding');
    }
    if (signal?.aborted) throw new AnalysisError('Aborted', 'decoding');

    onPhase?.('uploading');
    const form = new FormData();
    form.append('file', wavBlob, 'upload.wav');

    let response;
    try {
      // The server analyzes synchronously, so this single request covers
      // both the upload and analysis phases.
      onPhase?.('analyzing');
      response = await fetch(`${this.#baseUrl}/analyze`, {
        method: 'POST',
        body: form,
        signal,
      });
    } catch (e) {
      throw new AnalysisError(`Analysis request failed: ${e.message ?? e}`, 'analyzing');
    }
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try { detail = (await response.json()).detail ?? detail; } catch { /* keep status */ }
      throw new AnalysisError(detail, 'analyzing');
    }

    return this.#decode(await response.json());
  }

  #decode(json) {
    if (json.version !== 1 || json.encoding !== 'u8b64') {
      throw new AnalysisError(`Unsupported response (version ${json.version})`, 'analyzing');
    }
    const b64ToU8 = (b64) => {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    };
    return {
      duration: json.duration,
      fps: json.fps,
      frames: json.frames,
      numBars: json.numBars,
      bars: b64ToU8(json.bars), // frame-major: frame * numBars + barIndex
      bands: {
        bass: b64ToU8(json.bands.bass),
        mid: b64ToU8(json.bands.mid),
        treble: b64ToU8(json.bands.treble),
      },
      harmonic: b64ToU8(json.harmonic),
      percussive: b64ToU8(json.percussive),
      onset: b64ToU8(json.onset),
      rms: b64ToU8(json.rms),
      beats: Float64Array.from(json.beats),
      tempo: json.tempo,
    };
  }
}
