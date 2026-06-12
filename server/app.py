"""FastAPI server: POST an audio file (WAV), get the analysis timeline JSON.

Run from the project root:
    server\\.venv\\Scripts\\python -m uvicorn app:app --app-dir server --port 8765

Dev tip: with --reload, exclude the work dirs or every analysis restarts the
server mid-job:  --reload --reload-exclude .cache --reload-exclude .models
"""
import gzip
import hashlib
import io
import json
import logging
import os
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

import stems as stems_module
from analysis import SR, analyze

logger = logging.getLogger("uvicorn.error")

MAX_DURATION_S = 20 * 60
MAX_ML_DURATION_S = 12 * 60  # htdemucs RAM/time guard: longer tracks get DSP-only
CACHE_DIR = Path(__file__).parent / ".cache"

app = FastAPI(title="audio-vis analysis server")

app.add_middleware(
    CORSMiddleware,
    # Local dev server: allow any localhost origin regardless of port or
    # host spelling (localhost vs 127.0.0.1 are DIFFERENT origins to CORS,
    # and dev servers vary: 8123, 5500 Live Server, 5173 Vite, ...).
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.on_event("startup")
def warm_up() -> None:
    # First librosa beat-track call triggers numba JIT (several seconds);
    # pay it now so the first real request doesn't. The ML model is NOT
    # loaded here — it lazy-loads on the first ml request.
    analyze(np.zeros(SR, dtype=np.float32), SR)
    CACHE_DIR.mkdir(exist_ok=True)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": 1, "ml": stems_module.availability()}


def _cache_path(raw: bytes, ml: bool) -> Path:
    digest = hashlib.sha256(raw).hexdigest()[:32]
    return CACHE_DIR / f"{digest}.{'ml' if ml else 'dsp'}.json.gz"


def _cache_read(path: Path) -> dict | None:
    try:
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _cache_write(path: Path, result: dict) -> None:
    # Atomic: write to a temp file in the same dir, then rename.
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as raw_f:
            with gzip.open(raw_f, "wt", encoding="utf-8") as f:
                json.dump(result, f)
        os.replace(tmp, path)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass


@app.post("/analyze")
def analyze_upload(file: UploadFile, ml: bool = True) -> JSONResponse:
    # Sync `def` on purpose: Starlette runs it in a thread pool, keeping the
    # event loop free during the (potentially minutes-long) DSP+ML run.
    raw = file.file.read()

    cache_path = _cache_path(raw, ml)
    cached = _cache_read(cache_path)
    if cached is not None:
        return JSONResponse(cached)

    try:
        y, sr = sf.read(io.BytesIO(raw), dtype="float32")
    except Exception:
        raise HTTPException(415, detail="Unreadable audio. Upload WAV/FLAC/OGG.")

    duration = len(y) / sr
    if duration > MAX_DURATION_S:
        raise HTTPException(413, detail=f"Track longer than {MAX_DURATION_S // 60} minutes.")
    if len(y) < sr // 10:
        raise HTTPException(415, detail="Audio too short to analyze.")

    stems = None
    if ml and duration <= MAX_ML_DURATION_S and stems_module.availability() != "unavailable":
        try:
            mono = y.mean(axis=1) if y.ndim > 1 else y
            stems = stems_module.separate(mono.astype(np.float32), sr)
        except Exception:
            # Graceful degradation: DSP-only result with ml:false.
            logger.exception("Stem separation failed; returning DSP-only analysis")

    result = analyze(y, sr, stems=stems)
    # A degraded ml request (stems failed) is cached as dsp so ML retries
    # on the next upload instead of pinning the failure forever.
    _cache_write(_cache_path(raw, result["ml"]), result)
    return JSONResponse(result)
