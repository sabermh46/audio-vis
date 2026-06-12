"""Persistent track library — framework-free, like analysis.py.

Each processed track lives in server/library/<trackId>/:
  audio.<ext>        original uploaded bytes (faithful playback, ~10x smaller than WAV)
  analysis.json.gz   the analyze() result (without trackId — id is path-derived)
  meta.json          listing metadata
  scenes.json        {schemaVersion, scenes: []} — reserved for the Phase 2 editor

trackId = sha256(original bytes)[:16] — dedup so a song is processed once. This is
deliberately NOT the analysis cache key (sha256 of the decoded WAV); the two hash
different inputs and are never compared.
"""
import gzip
import hashlib
import json
import os
import re
import shutil
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path

LIBRARY_DIR = Path(__file__).parent / "library"
SCHEMA_VERSION = 1
_TID_RE = re.compile(r"^[0-9a-f]{16}$")
_lock = threading.Lock()

_CTYPE_BY_EXT = {
    "mp3": "audio/mpeg",
    "m4a": "audio/mp4", "mp4": "audio/mp4", "aac": "audio/mp4",
    "ogg": "audio/ogg", "oga": "audio/ogg", "opus": "audio/ogg",
    "flac": "audio/flac",
    "wav": "audio/wav",
    "webm": "audio/webm",
}
_EXT_BY_CTYPE = {
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a", "audio/aac": "aac", "audio/x-m4a": "m4a",
    "audio/ogg": "ogg",
    "audio/flac": "flac", "audio/x-flac": "flac",
    "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
    "audio/webm": "webm",
}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ext_and_ctype(filename: str, content_type: str) -> tuple[str, str]:
    """Resolve (extension, content-type) from a filename + uploaded mime type."""
    ext = Path(filename or "").suffix.lstrip(".").lower()
    if ext in _CTYPE_BY_EXT:
        return ext, content_type if content_type in _EXT_BY_CTYPE else _CTYPE_BY_EXT[ext]
    if content_type in _EXT_BY_CTYPE:
        return _EXT_BY_CTYPE[content_type], content_type
    return "wav", "audio/wav"


def track_id(raw_original: bytes) -> str:
    return hashlib.sha256(raw_original).hexdigest()[:16]


def _valid(tid: str) -> bool:
    return bool(_TID_RE.match(tid))


def _dir(tid: str) -> Path:
    return LIBRARY_DIR / tid


def exists(tid: str) -> bool:
    return _valid(tid) and (_dir(tid) / "meta.json").exists()


# --- atomic writers (mkstemp + os.replace, like app.py _cache_write) ---

def _atomic_write_bytes(path: Path, data: bytes) -> None:
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _atomic_write_json(path: Path, obj: dict) -> None:
    _atomic_write_bytes(path, json.dumps(obj).encode("utf-8"))


def _atomic_write_json_gz(path: Path, obj: dict) -> None:
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as raw_f:
            with gzip.open(raw_f, "wt", encoding="utf-8") as f:
                json.dump(obj, f)
        os.replace(tmp, path)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _audio_file(tid: str) -> Path | None:
    d = _dir(tid)
    if not d.is_dir():
        return None
    for p in d.glob("audio.*"):
        return p
    return None


def save_track(*, tid: str, audio_bytes: bytes, ext: str, content_type: str,
               original_filename: str, analysis_result: dict, name: str | None = None) -> dict:
    """Idempotent: re-saving refreshes analysis + derived meta but preserves the
    existing id/createdAt/user-set name/scenes."""
    if not _valid(tid):
        raise ValueError(f"invalid trackId: {tid!r}")
    with _lock:
        d = _dir(tid)
        d.mkdir(parents=True, exist_ok=True)

        prior = read_meta(tid)
        created = prior["createdAt"] if prior else _now()
        final_name = (prior["name"] if prior else None) or name or Path(original_filename).stem

        # New audio bytes can change extension; drop stale audio.* first.
        for old in d.glob("audio.*"):
            if old.name != f"audio.{ext}":
                try:
                    old.unlink()
                except OSError:
                    pass
        _atomic_write_bytes(d / f"audio.{ext}", audio_bytes)
        _atomic_write_json_gz(d / "analysis.json.gz", analysis_result)

        if not (d / "scenes.json").exists():
            _atomic_write_json(d / "scenes.json", {"schemaVersion": SCHEMA_VERSION, "scenes": []})

        meta = {
            "id": tid,
            "name": final_name,
            "originalFilename": original_filename,
            "ext": ext,
            "contentType": content_type,
            "durationSec": round(float(analysis_result.get("duration", 0)), 3),
            "ml": bool(analysis_result.get("ml", False)),
            "mlModel": analysis_result.get("mlModel"),
            "tempo": analysis_result.get("tempo"),
            "sizeBytes": len(audio_bytes),
            "schemaVersion": SCHEMA_VERSION,
            "createdAt": created,
            "updatedAt": _now(),
        }
        _atomic_write_json(d / "meta.json", meta)
        return meta


def read_meta(tid: str) -> dict | None:
    if not _valid(tid):
        return None
    try:
        with open(_dir(tid) / "meta.json", "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def list_tracks() -> list[dict]:
    if not LIBRARY_DIR.is_dir():
        return []
    metas = [m for p in LIBRARY_DIR.iterdir() if p.is_dir() and (m := read_meta(p.name))]
    metas.sort(key=lambda m: m.get("createdAt", ""), reverse=True)
    return metas


def read_analysis_json(tid: str) -> dict | None:
    if not _valid(tid):
        return None
    try:
        with gzip.open(_dir(tid) / "analysis.json.gz", "rt", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def audio_path(tid: str) -> tuple[Path, str] | None:
    meta = read_meta(tid)
    p = _audio_file(tid)
    if not meta or not p:
        return None
    return p, meta.get("contentType", "audio/wav")


def delete_track(tid: str) -> bool:
    if not _valid(tid) or not _dir(tid).is_dir():
        return False
    with _lock:
        shutil.rmtree(_dir(tid), ignore_errors=True)
    return True


def rename_track(tid: str, name: str) -> dict | None:
    with _lock:
        meta = read_meta(tid)
        if not meta:
            return None
        meta["name"] = name
        meta["updatedAt"] = _now()
        _atomic_write_json(_dir(tid) / "meta.json", meta)
        return meta


def read_scenes(tid: str) -> dict | None:
    if not _valid(tid):
        return None
    try:
        with open(_dir(tid) / "scenes.json", "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def write_scenes(tid: str, envelope: dict) -> dict | None:
    """Validate and persist the Phase 2 scene envelope ({schemaVersion, scenes:[]})."""
    if not exists(tid):
        return None
    if not isinstance(envelope, dict) or not isinstance(envelope.get("scenes"), list):
        raise ValueError("scenes envelope must be {schemaVersion, scenes: [...]}")
    out = {"schemaVersion": int(envelope.get("schemaVersion", SCHEMA_VERSION)),
           "scenes": envelope["scenes"]}
    with _lock:
        _atomic_write_json(_dir(tid) / "scenes.json", out)
    return out
