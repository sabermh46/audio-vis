"""Per-track scene persistence with a MySQL primary and a file fallback.

Scenes (placed elements + their timeline automation) are stored in MySQL
(phpMyAdmin / XAMPP). If MySQL is unreachable — no driver, DB down, wrong
credentials — every call silently falls back to the file store in library.py,
so the app and the headless tests keep working without a database. A DB
failure must NEVER propagate to the HTTP handler.

The `audio_vis` database must exist (create it once in phpMyAdmin); the
`scenes` table is created automatically. Configure via env vars:
  AUDIO_VIS_DB_HOST (127.0.0.1) / _PORT (3306) / _USER (root) /
  _PASSWORD ('') / _NAME (audio_vis)
"""
import json
import logging
import os
import threading

import library

logger = logging.getLogger("audio-vis.scenes")

try:
    import pymysql
    import pymysql.cursors
except Exception:  # pragma: no cover - optional dependency
    pymysql = None

_CFG = {
    "host": os.environ.get("AUDIO_VIS_DB_HOST", "127.0.0.1"),
    "port": int(os.environ.get("AUDIO_VIS_DB_PORT", "3306")),
    "user": os.environ.get("AUDIO_VIS_DB_USER", "root"),
    "password": os.environ.get("AUDIO_VIS_DB_PASSWORD", ""),
    "database": os.environ.get("AUDIO_VIS_DB_NAME", "audio_vis"),
}

_lock = threading.Lock()
_conn = None
_backend = None  # 'mysql' | 'file' — resolved once


def _connect():
    if pymysql is None:
        return None
    try:
        conn = pymysql.connect(
            host=_CFG["host"], port=_CFG["port"], user=_CFG["user"],
            password=_CFG["password"], database=_CFG["database"],
            connect_timeout=2, autocommit=True,
            cursorclass=pymysql.cursors.DictCursor,
        )
        with conn.cursor() as cur:
            cur.execute(
                "CREATE TABLE IF NOT EXISTS scenes ("
                "track_id VARCHAR(16) PRIMARY KEY, "
                "data LONGTEXT NOT NULL, "
                "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP "
                "ON UPDATE CURRENT_TIMESTAMP)"
            )
        return conn
    except Exception as e:
        logger.warning("MySQL unavailable, using file store for scenes: %s", e)
        return None


def _ensure():
    global _conn, _backend
    if _backend is not None:
        return
    with _lock:
        if _backend is not None:
            return
        _conn = _connect()
        _backend = "mysql" if _conn is not None else "file"


def backend() -> str:
    _ensure()
    return _backend


def get_scenes(tid: str) -> dict | None:
    _ensure()
    if _backend == "mysql":
        try:
            with _lock, _conn.cursor() as cur:
                cur.execute("SELECT data FROM scenes WHERE track_id=%s", (tid,))
                row = cur.fetchone()
            return json.loads(row["data"]) if row else None
        except Exception:
            logger.exception("MySQL get_scenes failed; falling back to file")
    return library.read_scenes(tid)


def set_scenes(tid: str, envelope: dict) -> dict:
    _ensure()
    if _backend == "mysql":
        try:
            with _lock, _conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO scenes (track_id, data) VALUES (%s, %s) "
                    "ON DUPLICATE KEY UPDATE data=VALUES(data)",
                    (tid, json.dumps(envelope)),
                )
            return envelope
        except Exception:
            logger.exception("MySQL set_scenes failed; falling back to file")
    return library.write_scenes(tid, envelope)
