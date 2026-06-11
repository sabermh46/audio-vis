/**
 * Decodes any browser-playable audio file (mp3/m4a/ogg/flac/wav/…) to a
 * 16-bit mono WAV Blob at the target sample rate. This is what we upload to
 * the analysis server, so it only ever needs to read plain WAV — no
 * server-side codec dependencies.
 */
export async function decodeFileToMonoWav(file, sampleRate = 44100) {
  const arrayBuffer = await file.arrayBuffer();

  // Decode on an OfflineAudioContext at the TARGET rate. decodeAudioData
  // resamples to its context's rate, so decoding on a default AudioContext
  // (OS rate, often 48k) and then offline-rendering at 44.1k would resample
  // TWICE — the double hop audibly smears high frequencies into broadband
  // artifacts that corrupt the analysis. This way there is at most one
  // resample, done by the decoder itself.
  const decodeCtx = new OfflineAudioContext(1, 1, sampleRate);
  const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);

  let samples;
  if (audioBuffer.numberOfChannels === 1) {
    samples = audioBuffer.getChannelData(0);
  } else {
    // Already at the target rate (decode guaranteed it) — only downmix left.
    const offline = new OfflineAudioContext(1, audioBuffer.length, sampleRate);
    const source = offline.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offline.destination);
    source.start();
    samples = (await offline.startRendering()).getChannelData(0);
  }

  return encodeWav(samples, sampleRate);
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);  // PCM
  view.setUint16(22, 1, true);  // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
