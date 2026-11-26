"""
doctor.py
Environment diagnostics for bug reports.

For a yt-dlp-backed player, "which yt-dlp version" is the first question in
every report, and "how old is it" is usually the answer. This prints both.
"""

from __future__ import annotations

import os
import platform
import shutil
import sys
from pathlib import Path
from typing import List

from .config import APP_NAME, STREAM_CACHE_TTL_S, YTDLP_MAX_AGE_DAYS
from .stream import (
    BASE_OPTIONS,
    StreamResolver,
    _client_profiles,
    _cookie_options,
    ytdlp_age_days,
    ytdlp_version,
)

LOG_FILENAME = "orca.log"

SELF_TEST_VIDEO_ID = "jNQXAC9IVRw"


def _stream_self_test() -> str:
    """Resolve one stable public video and report the verbatim outcome."""
    try:
        resolver = StreamResolver()
        url, err, _permanent = resolver.resolve(SELF_TEST_VIDEO_ID)
    except Exception as exc:  # noqa: BLE001
        return f"FAILED: resolver crashed: {exc}"
    if url:
        return "OK (signed url issued)"
    reason = err or "no url and no error message"
    return f"FAILED: {reason}"


def log_dir() -> Path:
    """Platform-appropriate data directory, falling back to the package cwd."""
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / APP_NAME.lower()


def log_path() -> str:
    """Where the rotating log lives, matching what the server configures."""
    return str(log_dir() / LOG_FILENAME)


def _backend_version() -> str:
    try:
        import fastapi

        return f"FastAPI {fastapi.__version__}"
    except Exception:  # noqa: BLE001
        return "FastAPI not importable"


def _ffmpeg_version() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        return "not found on PATH"
    return exe


def collect() -> List[str]:
    """Diagnostic lines, in the order a bug report needs them."""
    version = ytdlp_version()
    age = ytdlp_age_days(version)
    if age is None:
        age_line = "age unknown"
    else:
        age_line = f"{age} days old"
        if age > YTDLP_MAX_AGE_DAYS:
            age_line += (
                f"  <-- past the {YTDLP_MAX_AGE_DAYS}-day budget; "
                "run: python -m pip install -U yt-dlp"
            )

    return [
        f"{APP_NAME} doctor",
        f"python       : {sys.version.split()[0]} ({platform.machine()})",
        f"os           : {platform.system()} {platform.release()} ({platform.version()})",
        f"backend      : {_backend_version()}",
        f"yt-dlp       : {version} ({age_line})",
        f"audio format : {BASE_OPTIONS['format']}",
        f"stream cache : {STREAM_CACHE_TTL_S}s TTL",
        f"yt cookies    : {'configured' if _cookie_options() else 'not configured (ORCA_YT_COOKIE)'}",
        f"yt clients     : {';'.join(','.join(p) for p in _client_profiles())}",
        f"stream test    : {_stream_self_test()}",
        f"ffmpeg       : {_ffmpeg_version()}",
        f"log          : {log_path()}",
    ]


def main() -> int:
    """Print diagnostics and exit."""
    for line in collect():
        print(line)
    return 0
