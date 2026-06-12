"""ML stem separation wrapper (Demucs v4 htdemucs via audio-separator).

Lazy-loads the model on first use so /health stays instant, and serializes
separation jobs with a lock (htdemucs uses several GB of RAM per job).
All file IO is temp-file based — audio-separator's API is file-in/file-out.
"""
import logging
import os
import shutil
import sys
import tempfile
import threading
import uuid
from pathlib import Path

import numpy as np
import soundfile as sf

# audio-separator shells out to `ffmpeg` via PATH. We keep ffmpeg.exe in the
# venv's Scripts dir, but that dir is only on PATH when the venv is
# *activated* — running .venv\Scripts\python directly skips it. Prepend it.
if shutil.which("ffmpeg") is None:
    _scripts = Path(sys.prefix) / ("Scripts" if os.name == "nt" else "bin")
    if (_scripts / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")).exists():
        os.environ["PATH"] = f"{_scripts}{os.pathsep}{os.environ.get('PATH', '')}"

MODEL_FILENAME = "htdemucs.yaml"
MODEL_NAME = "htdemucs"
_MODEL_DIR = Path(__file__).parent / ".models"  # default is /tmp — never on Windows
_OUTPUT_DIR = Path(tempfile.gettempdir()) / "audio-vis-stems"

_lock = threading.Lock()
_separator = None
_import_error = None

try:
    from audio_separator.separator import Separator
except Exception as e:  # pragma: no cover - import-time environment issue
    Separator = None
    _import_error = e


def availability() -> str:
    """'ready' (model loaded) | 'cold' (loadable, not yet loaded) | 'unavailable'."""
    if Separator is None:
        return "unavailable"
    return "ready" if _separator is not None else "cold"


def _get_separator():
    global _separator
    if _separator is None:
        _MODEL_DIR.mkdir(exist_ok=True)
        _OUTPUT_DIR.mkdir(exist_ok=True)
        sep = Separator(
            log_level=logging.WARNING,
            model_file_dir=str(_MODEL_DIR),
            output_dir=str(_OUTPUT_DIR),
            output_format="WAV",
            use_soundfile=True,
            demucs_params={"shifts": 1, "segment_size": "Default"},
        )
        sep.load_model(model_filename=MODEL_FILENAME)  # downloads ~81MB on first run
        _separator = sep
    return _separator


def separate(y: np.ndarray, sr: int) -> dict:
    """Splits a mono float32 track into 4 mono float32 stems at the same sr.

    Returns {'vocals','drums','bass','other'} -> np.ndarray. Raises on any
    failure — the caller decides how to degrade.
    """
    with _lock:
        separator = _get_separator()

        job = uuid.uuid4().hex[:12]
        fd, in_path = tempfile.mkstemp(suffix=".wav", prefix=f"stems-{job}-")
        os.close(fd)  # Windows: the separator must be able to reopen the file
        out_names = {stem: f"stems-{job}-{stem.lower()}" for stem in
                     ("Vocals", "Drums", "Bass", "Other")}
        out_paths = [_OUTPUT_DIR / f"{name}.wav" for name in out_names.values()]
        try:
            sf.write(in_path, y, sr, subtype="PCM_16")
            separator.separate(in_path, custom_output_names=out_names)

            stems = {}
            for stem, name in out_names.items():
                data, stem_sr = sf.read(_OUTPUT_DIR / f"{name}.wav", dtype="float32")
                if data.ndim > 1:
                    data = data.mean(axis=1)
                if stem_sr != sr:  # htdemucs outputs 44.1k; guard anyway
                    import librosa
                    data = librosa.resample(data, orig_sr=stem_sr, target_sr=sr)
                stems[stem.lower()] = data
            return stems
        finally:
            for p in [Path(in_path), *out_paths]:
                try:
                    p.unlink(missing_ok=True)
                except OSError:
                    pass
