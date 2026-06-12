"""FastAPI server: POST an audio file (WAV), get the analysis timeline JSON.

Run from the project root:
    server\\.venv\\Scripts\\python -m uvicorn app:app --app-dir server --port 8765
"""
import io

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from analysis import SR, analyze

MAX_DURATION_S = 20 * 60

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
    # First librosa beat-track call triggers numba JIT (1-3s); pay it now
    # so the first real request doesn't.
    analyze(np.zeros(SR, dtype=np.float32), SR)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": 1}


@app.post("/analyze")
def analyze_upload(file: UploadFile) -> dict:
    # Sync `def` on purpose: Starlette runs it in a thread pool, keeping the
    # event loop free during the multi-second DSP run.
    try:
        y, sr = sf.read(io.BytesIO(file.file.read()), dtype="float32")
    except Exception:
        raise HTTPException(415, detail="Unreadable audio. Upload WAV/FLAC/OGG.")

    if len(y) / sr > MAX_DURATION_S:
        raise HTTPException(413, detail=f"Track longer than {MAX_DURATION_S // 60} minutes.")
    if len(y) < sr // 10:
        raise HTTPException(415, detail="Audio too short to analyze.")

    return analyze(y, sr)
