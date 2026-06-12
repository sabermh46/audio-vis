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
from fastapi import Body, FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse

import library
import scenes_store
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
    allow_methods=["GET", "POST", "DELETE", "PUT", "PATCH"],
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
    library.LIBRARY_DIR.mkdir(exist_ok=True)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "version": 1,
        "ml": stems_module.availability(),
        "scenesBackend": scenes_store.backend(),
    }


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
def analyze_upload(file: UploadFile, original: UploadFile | None = None,
                   ml: bool = True) -> JSONResponse:
    # Sync `def` on purpose: Starlette runs it in a thread pool, keeping the
    # event loop free during the (potentially minutes-long) DSP+ML run.
    # `file` is the decoded WAV (analysis input); `original` is the source file
    # the browser had (stored in the library for faithful, compact playback).
    raw = file.file.read()
    orig_bytes = original.file.read() if original is not None else raw
    orig_name = (original.filename if original is not None else file.filename) or "track.wav"
    orig_ctype = (original.content_type if original is not None else file.content_type) or ""

    cache_path = _cache_path(raw, ml)
    result = _cache_read(cache_path)
    if result is None:
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

    # Persist into the user-facing library (idempotent; best-effort).
    tid = None
    try:
        tid = library.track_id(orig_bytes)
        ext, ctype = library._ext_and_ctype(orig_name, orig_ctype)
        library.save_track(tid=tid, audio_bytes=orig_bytes, ext=ext, content_type=ctype,
                           original_filename=orig_name, analysis_result=result)
    except Exception:
        logger.exception("Library save failed")
        tid = None

    payload = dict(result)  # shallow copy — never mutate the cached dict
    payload["trackId"] = tid
    return JSONResponse(payload)


@app.get("/library")
def library_list() -> dict:
    return {"tracks": library.list_tracks()}


def _require_track(tid: str) -> None:
    if not library.exists(tid):
        raise HTTPException(404, detail="Unknown track.")


@app.get("/library/{tid}/audio")
def library_audio(tid: str):
    found = library.audio_path(tid)
    if not found:
        raise HTTPException(404, detail="Unknown track.")
    path, ctype = found
    # FileResponse implements HTTP Range automatically (Accept-Ranges, 206,
    # Content-Range) — required for <audio> seeking.
    return FileResponse(path, media_type=ctype)


@app.get("/library/{tid}/analysis")
def library_analysis(tid: str) -> JSONResponse:
    data = library.read_analysis_json(tid)
    if data is None:
        raise HTTPException(404, detail="Unknown track.")
    return JSONResponse(data)


@app.delete("/library/{tid}")
def library_delete(tid: str) -> dict:
    if not library.delete_track(tid):
        raise HTTPException(404, detail="Unknown track.")
    return {"deleted": tid}


@app.patch("/library/{tid}")
def library_rename(tid: str, name: str = Body(..., embed=True)) -> dict:
    if not name or not name.strip():
        raise HTTPException(422, detail="Name must not be empty.")
    meta = library.rename_track(tid, name.strip())
    if meta is None:
        raise HTTPException(404, detail="Unknown track.")
    return meta


@app.get("/library/{tid}/scenes")
def library_get_scenes(tid: str) -> dict:
    _require_track(tid)
    return scenes_store.get_scenes(tid) or {"schemaVersion": 2, "scenes": []}


@app.put("/library/{tid}/scenes")
def library_put_scenes(tid: str, envelope: dict = Body(...)) -> dict:
    _require_track(tid)
    if not isinstance(envelope, dict) or not isinstance(envelope.get("scenes"), list):
        raise HTTPException(422, detail="scenes envelope must be {schemaVersion, scenes: [...]}")
    out = {"schemaVersion": int(envelope.get("schemaVersion", 2)), "scenes": envelope["scenes"]}
    return scenes_store.set_scenes(tid, out)
