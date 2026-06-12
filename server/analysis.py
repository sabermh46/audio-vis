"""Pure DSP analysis — no web framework imports, unit-testable.

Produces a per-frame timeline of visualization features where every track
is normalized against its own whole-track percentiles. This is the core
fix for bass dominance: music has a ~1/f spectral tilt, so on a shared dB
scale bass is always near max; per-track percentile normalization gives
each band/bar its own dynamic range.
"""
import base64

import librosa
import numpy as np

SR = 44100
N_FFT = 2048
HOP = 1024
N_BARS = 64
F_MIN = 20
F_MAX = 20000

BANDS = {
    "bass": (20, 250),
    "mid": (250, 4000),
    "treble": (4000, 20000),
}

SILENCE_DB = -60.0  # tracks whose p95 is below this stay zero (no noise blow-up)
MIN_SPAN_DB = 6.0


def _normalize_db(track_db: np.ndarray) -> np.ndarray:
    """Percentile-normalize a dB track (any shape, last axis = time) to 0..1."""
    p5, p95 = np.percentile(track_db, [5, 95], axis=-1, keepdims=True)
    span = np.maximum(p95 - p5, MIN_SPAN_DB)
    norm = np.clip((track_db - p5) / span, 0.0, 1.0)
    return np.where(p95 < SILENCE_DB, 0.0, norm)


def _to_u8b64(norm: np.ndarray) -> str:
    """0..1 float array -> uint8 bytes -> base64 string."""
    q = np.round(norm * 255).astype(np.uint8)
    return base64.b64encode(q.tobytes()).decode("ascii")


def _band_bins(low_hz: float, high_hz: float, n_bins: int) -> slice:
    """STFT bin range for a frequency band (bin k = k * SR / N_FFT)."""
    lo = max(0, int(np.floor(low_hz * N_FFT / SR)))
    hi = min(n_bins - 1, int(np.ceil(high_hz * N_FFT / SR)))
    return slice(lo, max(lo, hi) + 1)


def _stem_tracks(stems: dict) -> dict:
    """Per-stem RMS energy timeline on the same fps grid, normalized."""
    tracks = {}
    for name, data in stems.items():
        rms = librosa.feature.rms(y=data, frame_length=N_FFT, hop_length=HOP)[0]
        tracks[name] = _normalize_db(librosa.amplitude_to_db(rms, ref=np.max(rms) or 1.0))
    return tracks


def analyze(y: np.ndarray, sr: int, stems: dict | None = None) -> dict:
    """Full feature timeline. `stems` (from stems.separate) is optional —
    when present the response gains per-stem tracks and beats/tempo are
    re-derived from the drums stem (far more accurate than the mix)."""
    if y.ndim > 1:
        y = np.mean(y, axis=1)
    if sr != SR:
        y = librosa.resample(y, orig_sr=sr, target_sr=SR)
        sr = SR

    duration = len(y) / sr
    fps = sr / HOP  # exact float — rounding drifts visuals vs audio over minutes

    # 64 log-spaced bars: mel spectrogram, each bar row normalized over time.
    s_mel = librosa.feature.melspectrogram(
        y=y, sr=sr, n_fft=N_FFT, hop_length=HOP,
        n_mels=N_BARS, fmin=F_MIN, fmax=F_MAX, power=2.0,
    )
    mel_db = librosa.power_to_db(s_mel, ref=np.max)
    bars = _normalize_db(mel_db)  # (64, N)

    # STFT power for band energies and HPSS.
    stft_mag = np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP))
    power = stft_mag ** 2
    n_bins = power.shape[0]

    def band_track(spec_power: np.ndarray, low: float, high: float) -> np.ndarray:
        mean_power = spec_power[_band_bins(low, high, n_bins)].mean(axis=0)
        return _normalize_db(librosa.power_to_db(mean_power, ref=np.max))

    bands = {name: band_track(power, lo, hi) for name, (lo, hi) in BANDS.items()}

    # Spectrogram-domain HPSS: harmonic ≈ sustained/melodic/vocal content,
    # percussive ≈ drums. No ISTFT round-trip needed for energy tracks.
    h_mag, p_mag = librosa.decompose.hpss(stft_mag)
    harmonic = band_track(h_mag ** 2, 250, 4000)  # vocal range of the harmonic part
    percussive = _normalize_db(
        librosa.power_to_db((p_mag ** 2).mean(axis=0), ref=np.max)
    )

    # Onset strength + beats + tempo. With a drums stem available, beat
    # tracking runs on it instead of the mix — vocals/synths can't confuse it.
    onset_env = librosa.onset.onset_strength(S=mel_db, sr=sr, hop_length=HOP)
    onset = np.clip(onset_env / max(np.percentile(onset_env, 95), 1e-6), 0.0, 1.0)

    beats_source = "mix"
    beat_env = onset_env
    drums_onset = None
    if stems and "drums" in stems:
        drums_env = librosa.onset.onset_strength(y=stems["drums"], sr=sr, hop_length=HOP)
        drums_onset = np.clip(
            drums_env / max(np.percentile(drums_env, 95), 1e-6), 0.0, 1.0
        )
        if drums_env.max() > 0:
            beat_env = drums_env
            beats_source = "drums"
    tempo, beat_times = librosa.beat.beat_track(
        onset_envelope=beat_env, sr=sr, hop_length=HOP, units="time"
    )
    tempo = float(np.atleast_1d(tempo)[0])

    rms = _normalize_db(
        librosa.amplitude_to_db(
            librosa.feature.rms(S=stft_mag, hop_length=HOP)[0], ref=np.max
        )
    )

    stem_tracks = _stem_tracks(stems) if stems else None

    # Onset env can run ±1 frame vs the spectrograms — trim everything.
    lengths = [bars.shape[1], *(b.shape[0] for b in bands.values()),
               harmonic.shape[0], percussive.shape[0], onset.shape[0], rms.shape[0]]
    if stem_tracks:
        lengths += [t.shape[0] for t in stem_tracks.values()]
    if drums_onset is not None:
        lengths.append(drums_onset.shape[0])
    n = min(lengths)

    result = {
        "version": 1,
        "duration": round(duration, 4),
        "fps": fps,
        "frames": int(n),
        "numBars": N_BARS,
        "encoding": "u8b64",
        "bars": _to_u8b64(bars[:, :n].T),  # frame-major: frame*64 + barIndex
        "bands": {name: _to_u8b64(track[:n]) for name, track in bands.items()},
        "harmonic": _to_u8b64(harmonic[:n]),
        "percussive": _to_u8b64(percussive[:n]),
        "onset": _to_u8b64(onset[:n]),
        "rms": _to_u8b64(rms[:n]),
        "beats": [round(float(t), 4) for t in beat_times if t <= duration],
        "beatsSource": beats_source,
        "tempo": round(tempo, 2),
        "ml": stem_tracks is not None,
    }
    if stem_tracks:
        result["mlModel"] = "htdemucs"
        result["stems"] = {name: _to_u8b64(t[:n]) for name, t in stem_tracks.items()}
        if drums_onset is not None:
            result["stemsOnset"] = {"drums": _to_u8b64(drums_onset[:n])}
    return result
