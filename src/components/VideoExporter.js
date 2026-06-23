import { EventEmitter } from '../core/EventEmitter.js';
import { PrecomputedAnalysisSource } from '../core/PrecomputedAnalysisSource.js';
import { SignalConditioner } from '../core/SignalConditioner.js';

const EXPORT_W = 2560;
const EXPORT_H = 1440;
const FPS = 60;
const VIDEO_BATCH = 20;        // frames between browser yields during render loop
const VIDEO_BPS = 12_000_000;  // 12 Mbps H.264
const AUDIO_BPS = 256_000;     // 256 kbps AAC
const AUDIO_CHUNK = 4096;      // PCM frames per AudioData submit
const MAX_ENCODE_QUEUE = 8;    // backpressure: max queued operations per encoder
const FLUSH_POLL_MS = 50;      // polling interval while waiting for encoder flush

/**
 * Renders the scene at 2560×1440 / 60 fps (H.264 + AAC) into an in-memory MP4.
 * Both encoders are flushed via polling so Cancel stays responsive at all times.
 *
 * Events:
 *   'status'   (string)               — phase label
 *   'progress' (frac 0..1, fi, total) — frame counter
 *   'done'     (Blob)                 — finished MP4 blob
 *   'aborted'  ()                     — cancelled cleanly
 *   'error'    (message string)       — fatal; export abandoned
 */
export class VideoExporter extends EventEmitter {
  #host;
  #compositor;
  #analysis;
  #cleanupConfig;
  #getDuration;
  #getAudioBuffer;
  #filename;
  #aborted = false;

  constructor({ host, compositor = null, analysis, cleanupConfig = null, getDuration, getAudioBuffer = null, filename }) {
    super();
    this.#host = host;
    this.#compositor = compositor;
    this.#analysis = analysis;
    this.#cleanupConfig = cleanupConfig;
    this.#getDuration = getDuration;
    this.#getAudioBuffer = getAudioBuffer;
    this.#filename = filename;
  }

  abort() { this.#aborted = true; }

  /** Poll until a flush() Promise settles or the export is aborted. */
  async #pollFlush(flushPromise) {
    let done = false;
    flushPromise.then(() => { done = true; }).catch(() => { done = true; });
    while (!done && !this.#aborted) {
      await new Promise((r) => setTimeout(r, FLUSH_POLL_MS));
    }
  }

  async start() {
    this.#aborted = false;

    // ── H.264 support check ───────────────────────────────────────────────────
    if (typeof VideoEncoder === 'undefined') {
      this.emit('error', 'VideoEncoder not available — use Chrome or Edge 94+.');
      return;
    }
    const h264ok = await VideoEncoder.isConfigSupported({
      codec: 'avc1.640034', width: EXPORT_W, height: EXPORT_H, framerate: FPS,
    }).then((r) => r.supported).catch(() => false);
    if (!h264ok) {
      this.emit('error', 'H.264 not supported — update GPU drivers or use Chrome/Edge.');
      return;
    }

    // ── Decode audio + select codec ───────────────────────────────────────────
    // Tries AAC first (best player compat), falls back to Opus (universally
    // supported in WebCodecs). Opus requires 48 kHz, so resample if needed.
    let encodeBuffer = null;   // final PCM buffer fed to encoder
    let audioCodec = null;     // WebCodecs codec string
    let audioMuxCodec = null;  // mp4-muxer codec string
    let encodeRate = 0;
    let encodeCh = 0;

    if (this.#getAudioBuffer && typeof AudioEncoder !== 'undefined') {
      try {
        this.emit('status', 'Decoding audio…');
        encodeBuffer = await this.#getAudioBuffer();
      } catch (e) {
        console.warn('[VideoExporter] audio decode failed, video-only:', e);
      }

      if (encodeBuffer) {
        encodeRate = encodeBuffer.sampleRate;
        encodeCh = encodeBuffer.numberOfChannels;

        // Try AAC
        const aacOk = await AudioEncoder.isConfigSupported({
          codec: 'mp4a.40.2', sampleRate: encodeRate,
          numberOfChannels: encodeCh, bitrate: AUDIO_BPS,
        }).then((r) => r.supported).catch(() => false);

        if (aacOk) {
          audioCodec = 'mp4a.40.2';
          audioMuxCodec = 'aac';
        } else {
          // Fallback: Opus requires 48000 Hz per spec
          encodeCh = Math.min(encodeCh, 2);
          const opusOk = await AudioEncoder.isConfigSupported({
            codec: 'opus', sampleRate: 48000,
            numberOfChannels: encodeCh, bitrate: AUDIO_BPS,
          }).then((r) => r.supported).catch(() => false);

          if (opusOk) {
            audioCodec = 'opus';
            audioMuxCodec = 'opus';
            // Resample to 48000 Hz if needed
            if (encodeBuffer.sampleRate !== 48000) {
              this.emit('status', 'Resampling audio…');
              const offCtx = new OfflineAudioContext(
                encodeCh,
                Math.ceil(encodeBuffer.duration * 48000),
                48000,
              );
              const src = offCtx.createBufferSource();
              src.buffer = encodeBuffer;
              src.connect(offCtx.destination);
              src.start();
              encodeBuffer = await offCtx.startRendering();
            }
            encodeRate = 48000;
          } else {
            console.warn('[VideoExporter] no audio codec available, video-only.');
            encodeBuffer = null;
          }
        }
      }
    }

    const hasAudio = !!(encodeBuffer && audioCodec);

    // ── Muxer ─────────────────────────────────────────────────────────────────
    const { Muxer, ArrayBufferTarget } = await import('../lib/mp4-muxer.mjs');
    const target = new ArrayBufferTarget();
    const muxerCfg = {
      target,
      video: { codec: 'avc', width: EXPORT_W, height: EXPORT_H },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    };
    if (hasAudio) {
      muxerCfg.audio = { codec: audioMuxCodec, sampleRate: encodeRate, numberOfChannels: encodeCh };
    }
    const muxer = new Muxer(muxerCfg);

    // ── Video encoder ─────────────────────────────────────────────────────────
    let encoderError = null;
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => { if (!this.#aborted) muxer.addVideoChunk(chunk, meta); },
      error: (e) => { encoderError = e.message; },
    });
    videoEncoder.configure({
      codec: 'avc1.640034',
      width: EXPORT_W,
      height: EXPORT_H,
      bitrate: VIDEO_BPS,
      framerate: FPS,
      hardwareAcceleration: 'prefer-hardware',
    });

    // ── Audio encoder (optional) ──────────────────────────────────────────────
    let audioEncoder = null;
    if (hasAudio) {
      audioEncoder = new AudioEncoder({
        output: (chunk, meta) => {
          if (!this.#aborted) {
            try { muxer.addAudioChunk(chunk, meta); }
            catch (e) { console.warn('[VideoExporter] addAudioChunk:', e); }
          }
        },
        error: (e) => { console.warn('[VideoExporter] AudioEncoder error:', e); },
      });
      audioEncoder.configure({
        codec: audioCodec,
        sampleRate: encodeRate,
        numberOfChannels: encodeCh,
        bitrate: AUDIO_BPS,
      });
    }

    // ── Fake-clock analysis source ────────────────────────────────────────────
    // Rebuild the conditioner from the same analysis so exported motion matches
    // the live preview's signal cleanup.
    let conditioner = null;
    if (this.#cleanupConfig) {
      conditioner = new SignalConditioner(this.#analysis);
      conditioner.setConfig(this.#cleanupConfig);
    }
    let exportTime = 0;
    const analysisSource = new PrecomputedAnalysisSource(this.#analysis, {
      getTime: () => exportTime,
      analyser: null,
      conditioner,
    });
    this.#compositor?.setTimeOverride(() => exportTime);

    // ── Off-screen canvas ─────────────────────────────────────────────────────
    const canvas = document.createElement('canvas');
    canvas.width = EXPORT_W;
    canvas.height = EXPORT_H;
    const ctx = canvas.getContext('2d');

    const duration = this.#getDuration();
    const totalFrames = Math.ceil(duration * FPS);

    // ════════════════════════════════════════════════════════════════════════
    // Phase 1: Render + encode video frames
    // ════════════════════════════════════════════════════════════════════════
    this.emit('status', 'Rendering…');
    for (let fi = 0; fi < totalFrames; fi++) {
      if (this.#aborted || encoderError) break;

      // Backpressure — keeps the encoder queue small so flush() is near-instant.
      while (videoEncoder.encodeQueueSize > MAX_ENCODE_QUEUE && !this.#aborted) {
        await new Promise((r) => setTimeout(r, 0));
      }
      if (this.#aborted) break;

      exportTime = fi / FPS;
      analysisSource.update();
      this.#host.renderTo(ctx, analysisSource.frame, 1 / FPS, EXPORT_W, EXPORT_H);

      const vf = new VideoFrame(canvas, {
        timestamp: Math.round(fi * 1_000_000 / FPS),
        duration: Math.round(1_000_000 / FPS),
      });
      videoEncoder.encode(vf, { keyFrame: fi % (FPS * 2) === 0 });
      vf.close();

      this.emit('progress', fi / totalFrames, fi, totalFrames);

      if (fi % VIDEO_BATCH === VIDEO_BATCH - 1) {
        await new Promise((r) => setTimeout(r, 0)); // yield — keeps Cancel alive
      }
    }

    this.#compositor?.clearTimeOverride();

    if (this.#aborted || encoderError) {
      videoEncoder.close();
      audioEncoder?.close();
      if (encoderError) this.emit('error', `VideoEncoder: ${encoderError}`);
      else this.emit('aborted');
      return;
    }

    // ── Flush video encoder (polling — Cancel stays alive) ────────────────────
    await this.#pollFlush(videoEncoder.flush());
    videoEncoder.close();
    if (this.#aborted) { audioEncoder?.close(); this.emit('aborted'); return; }

    // ════════════════════════════════════════════════════════════════════════
    // Phase 2: Encode audio
    // ════════════════════════════════════════════════════════════════════════
    if (audioEncoder && encodeBuffer) {
      this.emit('status', 'Encoding audio…');
      const sr = encodeRate;
      const numCh = encodeCh;

      for (let i = 0; i < encodeBuffer.length && !this.#aborted; i += AUDIO_CHUNK) {
        // Backpressure
        while (audioEncoder.encodeQueueSize > MAX_ENCODE_QUEUE && !this.#aborted) {
          await new Promise((r) => setTimeout(r, 0));
        }
        if (this.#aborted) break;

        const n = Math.min(AUDIO_CHUNK, encodeBuffer.length - i);
        const data = new Float32Array(n * numCh);
        for (let c = 0; c < numCh; c++) {
          data.set(encodeBuffer.getChannelData(c).subarray(i, i + n), c * n);
        }
        try {
          const ad = new AudioData({
            format: 'f32-planar',
            sampleRate: sr,
            numberOfFrames: n,
            numberOfChannels: numCh,
            timestamp: Math.round(i / sr * 1_000_000),
            data,
          });
          audioEncoder.encode(ad);
          ad.close();
        } catch (e) {
          console.warn('[VideoExporter] AudioData error:', e);
          break;
        }

        // Yield every 16 chunks to keep Cancel responsive
        if ((i / AUDIO_CHUNK + 1) % 16 === 0) {
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      if (!this.#aborted) {
        await this.#pollFlush(audioEncoder.flush());
      }
      audioEncoder.close();
      if (this.#aborted) { this.emit('aborted'); return; }
    }

    // ════════════════════════════════════════════════════════════════════════
    // Phase 3: Finalize and download
    // ════════════════════════════════════════════════════════════════════════
    this.emit('status', 'Finalizing…');
    this.emit('progress', 1, totalFrames, totalFrames);

    muxer.finalize();

    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    this.emit('done', blob);
  }
}
