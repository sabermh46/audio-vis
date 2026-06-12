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
    return (await this.getHealth(timeoutMs)).ok;
  }

  /** @returns {{ok: boolean, ml: 'ready'|'cold'|'unavailable'|null}} */
  async getHealth(timeoutMs = 1200) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.#baseUrl}/health`, { signal: controller.signal });
      if (!res.ok) return { ok: false, ml: null };
      const body = await res.json();
      return { ok: true, ml: body.ml ?? null };
    } catch {
      return { ok: false, ml: null };
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
    // The original file is stored in the library for faithful, compact
    // playback (the WAV stays the analysis input).
    form.append('original', file, file.name);

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

  /** @returns {Promise<Array>} library track metadata, newest first */
  async listLibrary() {
    const res = await fetch(`${this.#baseUrl}/library`);
    if (!res.ok) throw new AnalysisError(`Library list failed: HTTP ${res.status}`, 'library');
    return (await res.json()).tracks;
  }

  /** Fetches a previously-processed analysis — no re-analysis. */
  async getLibraryAnalysis(id) {
    const res = await fetch(`${this.#baseUrl}/library/${id}/analysis`);
    if (!res.ok) throw new AnalysisError(`Library analysis failed: HTTP ${res.status}`, 'library');
    const decoded = this.#decode(await res.json());
    decoded.trackId = id;
    return decoded;
  }

  /** Direct URL for a library track's audio (used as an <audio> src). */
  libraryAudioUrl(id) {
    return `${this.#baseUrl}/library/${id}/audio`;
  }

  async deleteLibraryEntry(id) {
    const res = await fetch(`${this.#baseUrl}/library/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new AnalysisError(`Delete failed: HTTP ${res.status}`, 'library');
  }

  /** Per-song scene envelope ({schemaVersion, scenes:[]}); null if none saved. */
  async getScenes(trackId) {
    const res = await fetch(`${this.#baseUrl}/library/${trackId}/scenes`);
    if (res.status === 404) return null;
    if (!res.ok) throw new AnalysisError(`Scenes fetch failed: HTTP ${res.status}`, 'scenes');
    return res.json();
  }

  async saveScene(trackId, envelope) {
    const res = await fetch(`${this.#baseUrl}/library/${trackId}/scenes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    if (!res.ok) throw new AnalysisError(`Scenes save failed: HTTP ${res.status}`, 'scenes');
    return res.json();
  }

  async renameLibraryEntry(id, name) {
    const res = await fetch(`${this.#baseUrl}/library/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new AnalysisError(`Rename failed: HTTP ${res.status}`, 'library');
    return res.json();
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
    const decoded = {
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
      beatsSource: json.beatsSource ?? 'mix',
      tempo: json.tempo,
      trackId: json.trackId ?? null,
      ml: json.ml === true,
      mlModel: json.mlModel ?? null,
      stems: null,
      stemsOnset: null,
    };
    if (json.stems) {
      decoded.stems = {
        vocals: b64ToU8(json.stems.vocals),
        drums: b64ToU8(json.stems.drums),
        bass: b64ToU8(json.stems.bass),
        other: b64ToU8(json.stems.other),
      };
      if (json.stemsOnset?.drums) {
        decoded.stemsOnset = { drums: b64ToU8(json.stemsOnset.drums) };
      }
    }
    return decoded;
  }
}
