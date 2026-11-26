"""
stream.py
Resolves a track id (or a pasted link) into a direct HTTPS audio stream.
Two sourcing layers, in order: public Piped/Invidious/Cobalt mirrors (see
remote.py — their URLs play from any client IP, which is what hosted
deployments need) and yt-dlp itself with the player-profile ladder. Nothing
is ever written to disk — we only read the resolved URL.
"""

from __future__ import annotations

import datetime
import html
import logging
import os
import tempfile
import threading
import time
from pathlib import Path
from collections import deque
from typing import Any, Deque, Dict, List, Optional, Tuple
import re

import yt_dlp

try:
    from .cache import AudioDiskCache
    from .config import STREAM_CACHE_TTL_S, YTDLP_MAX_AGE_DAYS
    from .models import Song
except ImportError:
    from cache import AudioDiskCache
    from config import STREAM_CACHE_TTL_S, YTDLP_MAX_AGE_DAYS
    from models import Song

log = logging.getLogger(__name__)

# Conditions yt-dlp cannot recover from by trying again: the extractor needs an
# authenticated session, so a retry returns the same refusal seconds later.
PERMANENT_FAILURE_MARKERS = (
    "sign in to confirm your age",
    "sign in to confirm you're not a bot",
    "sign in to confirm you’re not a bot",
    "this video is age-restricted",
    "video unavailable",
    "video is unavailable",
    "video isn't available anymore",
    "private video",
    "members-only",
)


def _is_permanent_failure(exc: BaseException) -> bool:
    """True when the extractor error will not resolve on a retry."""
    text = str(exc).lower()
    return any(marker in text for marker in PERMANENT_FAILURE_MARKERS)


# --------------------------------------------------------------- yt-dlp guard
_YTDLP_FRESHNESS_CHECKED = False


def ytdlp_version() -> str:
    """Version string reported by the installed yt-dlp build."""
    try:
        from yt_dlp.version import __version__ as version
    except Exception:  # noqa: BLE001 - the version module has moved between releases
        return str(getattr(yt_dlp, "__version__", "unknown"))
    return str(version)


def ytdlp_age_days(version: Optional[str] = None) -> Optional[int]:
    """Days since the installed yt-dlp release, or None when it is not dated.

    yt-dlp versions are calendar releases (2026.9.15), which is the only reason
    an "is this build stale" check is possible at all.
    """
    raw = version or ytdlp_version()
    parts = raw.split(".")
    if len(parts) < 3:
        return None
    try:
        released = datetime.date(int(parts[0]), int(parts[1]), int(parts[2]))
    except (TypeError, ValueError):
        return None
    return (datetime.date.today() - released).days


def check_ytdlp_freshness(max_age_days: int = YTDLP_MAX_AGE_DAYS) -> Optional[int]:
    """Log once when the installed yt-dlp is old enough to be the bug report.

    An extractor that lags YouTube by a month is the single most likely cause of
    "it stopped working", so this is worth saying out loud in the log.
    """
    global _YTDLP_FRESHNESS_CHECKED
    if _YTDLP_FRESHNESS_CHECKED:
        return None
    _YTDLP_FRESHNESS_CHECKED = True

    age = ytdlp_age_days()
    if age is None:
        log.debug("yt-dlp %s is not date-versioned — skipping freshness check", ytdlp_version())
        return None
    if age > max_age_days:
        log.warning(
            "yt-dlp %s is %d days old (budget %d). Extractor changes land "
            "continuously; run: python -m pip install -U yt-dlp",
            ytdlp_version(),
            age,
            max_age_days,
        )
    else:
        log.info("yt-dlp %s is %d days old", ytdlp_version(), age)
    return age


# ------------------------------------------------------------- resolved streams
class StreamCache:
    """Short-TTL map of video_id -> direct audio URL.

    Replaying a track used to re-run yt-dlp with three attempts and exponential
    backoff — seconds of dead air for a track the user already heard. Signed
    URLs expire, so entries live for STREAM_CACHE_TTL_S and are dropped early
    when the backend rejects one.
    """

    def __init__(self, ttl_seconds: int = STREAM_CACHE_TTL_S) -> None:
        self.ttl = int(ttl_seconds)
        self._entries: Dict[str, tuple] = {}
        self._lock = threading.Lock()

    def get(self, video_id: str) -> Optional[str]:
        """Cached URL for a track, or None when missing or expired."""
        if not video_id:
            return None
        now = time.monotonic()
        with self._lock:
            entry = self._entries.get(video_id)
            if entry is None:
                return None
            stamped, url = entry
            if now - stamped > self.ttl:
                del self._entries[video_id]
                return None
            return url

    def put(self, video_id: str, url: str) -> None:
        """Remember a freshly resolved URL. Never logged — it is signed."""
        if not video_id or not url:
            return
        with self._lock:
            self._entries[video_id] = (time.monotonic(), url)

    def invalidate(self, video_id: str) -> None:
        """Drop one entry — used when the backend rejects an expired signature."""
        with self._lock:
            self._entries.pop(video_id, None)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)


FORMAT_STANDARD = "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio/best"
FORMAT_STUDIO = "bestaudio[acodec=flac]/bestaudio[format_id=251]/bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best"

# Client profiles tried in order when YouTube refuses the previous one. The
# bot check is IP-reputation based (datacenter hosts like Vercel get flagged);
# some player clients are still served without a PO token, so rotating them
# gives hosted deployments a fighting chance before the user configures a
# session cookie, which bypasses the check outright.
WATCH_URL = "https://www.youtube.com/watch?v={0}"
MUSIC_URL = "https://music.youtube.com/watch?v={0}"

# Each entry: (player clients, watch-url template). The web_music client on
# music.youtube.com still serves formats for authenticated sessions that the
# www clients refuse on datacenter hosting (yt-dlp #17389), so it is part of
# the ladder rather than an exotic fallback.
CLIENT_PROFILES: Tuple[Tuple[Tuple[str, ...], str], ...] = (
    (("android", "ios"), WATCH_URL),
    (("web_music",), MUSIC_URL),
    (("web_safari",), WATCH_URL),
    (("mweb",), WATCH_URL),
    (("web",), WATCH_URL),
    (("tv",), WATCH_URL),
    (("android",), MUSIC_URL),
    (("android_vr",), WATCH_URL),
)


def _is_bot_check(exc_text: str) -> bool:
    return "not a bot" in exc_text.lower()


def _client_profiles() -> Tuple[Tuple[Tuple[str, ...], str], ...]:
    """Profiles from ORCA_YTDLP_CLIENTS (';' separates profiles, ',' clients).

    A profile containing a client with 'music' in its name is routed through
    music.youtube.com; everything else uses the regular watch page.
    """
    raw = os.environ.get("ORCA_YTDLP_CLIENTS", "").strip()
    if not raw:
        return CLIENT_PROFILES
    profiles = []
    for part in raw.split(";"):
        clients = tuple(c.strip() for c in part.split(",") if c.strip())
        if not clients:
            continue
        template = MUSIC_URL if any("music" in c for c in clients) else WATCH_URL
        profiles.append((clients, template))
    return tuple(profiles) or CLIENT_PROFILES


def _pot_options() -> Dict[str, Any]:
    """bgutil PO-token provider wiring from ORCA_POT_BASE_URL.

    Orca's datacenter hosts (Vercel et al.) get their audio-only formats
    PO-token-gated by YouTube; the bgutil provider (itself deployed as a
    Vercel function) mints the proof-of-origin tokens yt-dlp's web clients
    need. See https://github.com/Brainicism/bgutil-ytdlp-pot-provider.
    """
    base = os.environ.get("ORCA_POT_BASE_URL", "").strip().rstrip("/")
    if not base:
        return {}
    return {"extractor_args": {"youtubepot-bgutilhttp": {"base_url": [base]}}}


def _cookie_options() -> Dict[str, Any]:
    """yt-dlp cookie options from ORCA_YT_COOKIE (file or inline content).

    Inline content may carry real newlines or escaped \\n sequences; it is
    materialized into a temp file because yt-dlp requires a cookiefile path.
    A signed-in session clears the 'sign in to confirm you're not a bot' gate
    that otherwise blocks datacenter deployments (Vercel/Render/Railway).
    """
    inline = os.environ.get("ORCA_YT_COOKIE", "").strip()
    if inline:
        if "\\n" in inline and "\n" not in inline:
            inline = inline.replace("\\n", "\n")
        if not inline.startswith("#"):
            inline = "# Netscape HTTP Cookie File\n" + inline
        fd, path = tempfile.mkstemp(prefix="orca-yt-cookie-", suffix=".txt")
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(inline)
        return {"cookiefile": path}
    file_path = os.environ.get("ORCA_YT_COOKIE_FILE", "").strip()
    if file_path and Path(file_path).is_file():
        return {"cookiefile": file_path}
    return {}


# Ring buffer of yt-dlp's own verdicts (bot checks, dropped formats, client
# fallbacks) so /api/doctor can show WHY extraction failed on a remote host.
# Only warnings, errors and key decisions are kept; signed-URLs are scrubbed.
DEBUG_TAIL: Deque[str] = deque(maxlen=500)
_DEBUG_URL = re.compile(r"(googlevideo\.com/videoplayback\?)[^\s\"']*")


def _scrub(line: str) -> str:
    return _DEBUG_URL.sub(r"\1<signed-url withheld>", line)


class _CapturingLogger:
    """Trims yt-dlp to the decisions that matter and keeps a short tail."""

    def debug(self, message: str) -> None:
        if self._interesting(message):
            DEBUG_TAIL.append(_scrub(message[:400]))

    def info(self, message: str) -> None:
        self.debug(message)

    def warning(self, message: str) -> None:
        DEBUG_TAIL.append(_scrub(message[:400]))

    def error(self, message: str) -> None:
        for line in message.splitlines():
            DEBUG_TAIL.append(_scrub(line[:400]))

    _NOISE = (
        "[debug] params:",
        "[debug] optional libraries:",
        "[debug] plugin directories:",
        "[debug] home ",
        "[debug] portable ",
        "[debug] request headers",
        "[debug] urlopen",
        "file locked",
        "contains escaped characters",
    )

    @classmethod
    def _interesting(cls, message: str) -> bool:
        if message.startswith(cls._NOISE):
            return False
        lowered = message.lower()
        return any(
            word in lowered
            for word in (
                "player response",
                "skipping",
                "bot",
                "playability",
                "unavailable",
                "unplayable",
                "not available",
                "po token",
                "formats",
                "age",
                "visito",
                "signature",
            )
        )


def _debug_options() -> Dict[str, Any]:
    return {"logger": _CapturingLogger()}


BASE_OPTIONS: Dict[str, Any] = {
    "format": FORMAT_STANDARD,
    "quiet": True,
    "no_warnings": True,
    # Every yt-dlp verdict is captured by the capturing logger (never the
    # console) so a failing remote deployment can explain itself via doctor.
    "verbose": True,
    "noplaylist": True,
    "skip_download": True,
    # NOTE: internal retries removed — our _probe() already does 3-attempt
    # exponential backoff; keeping both multiplies total attempts (4×3 = 12).
    "retries": 0,
    "socket_timeout": 15,
    "extractor_retries": 0,
    "extractor_args": {
        "youtube": {
            "player_client": ["android", "ios"],
            "player_skip": ["webpage", "configs", "js"],
        }
    },
}


class StreamResolver:
    """Thin yt-dlp wrapper with retry backoff. Every call is synchronous — jobs run it off-thread."""

    def __init__(
        self,
        overrides: Optional[Dict[str, Any]] = None,
        cache: Optional[StreamCache] = None,
        disk_cache: Optional[AudioDiskCache] = None,
    ) -> None:
        self.options = {
            **BASE_OPTIONS,
            **_cookie_options(),
            **_pot_options(),
            **_debug_options(),
        }
        if overrides:
            self.options.update(overrides)
        self.cache = cache if cache is not None else StreamCache()
        self.disk_cache = disk_cache
        self.cookie_configured = "cookiefile" in self.options
        # Authenticated sessions are more stable when the watch page is
        # fetched, so only fully-skip it for anonymous extraction.
        self.player_skip = (
            ["configs", "js"] if self.cookie_configured else ["webpage", "configs", "js"]
        )
        check_ytdlp_freshness()

    def set_quality_mode(self, mode: str) -> None:
        """Toggle between 'studio' (Opus 48kHz / FLAC priority) and 'standard' (AAC / M4A)."""
        if mode == "studio":
            self.options["format"] = FORMAT_STUDIO
        else:
            self.options["format"] = FORMAT_STANDARD
        log.info("Stream resolver audio quality set to %s (%s)", mode, self.options["format"])

    @staticmethod
    def _extract_once(target: str, options: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        with yt_dlp.YoutubeDL(options) as ydl:
            data = ydl.extract_info(target, download=False)
        return data if isinstance(data, dict) else None

    def _probe(self, video_id: str, max_attempts: int = 2) -> Dict[str, Any]:
        """Extract info from yt-dlp, cycling player profiles on bot checks."""
        last_exc: Optional[Exception] = None
        for profile, url_template in _client_profiles():
            target = url_template.format(video_id)
            options = dict(self.options)
            # Merge, don't clobber: provider/extractor args set elsewhere
            # (PO-token base_url) must survive every per-profile override.
            args = {k: dict(v) for k, v in (self.options.get("extractor_args") or {}).items()}
            args["youtube"] = {
                "player_client": list(profile),
                "player_skip": list(self.player_skip),
            }
            options["extractor_args"] = args
            for attempt in range(1, max_attempts + 1):
                try:
                    data = self._extract_once(target, options)
                    if data is not None:
                        data["_orca_profile"] = "/".join(profile) + (
                            " @music" if "music." in url_template else ""
                        )
                        return data
                    raise RuntimeError("unexpected response structure from extractor")
                except Exception as exc:
                    selector_blocked = "requested format is not available" in str(exc).lower()
                    if selector_blocked:
                        # The client served formats the strict audio selector
                        # cannot match (audio-only itags gated away, e.g. SABR
                        # enforcement) — retry permissively to see what remains.
                        DEBUG_TAIL.append(
                            _scrub(f"[orca] profile {'/'.join(profile)}: strict "
                                   "selector matched nothing; retrying with bestaudio*/b*")
                        )
                        wide = {**options, "format": "bestaudio*/b*"}
                        try:
                            data = self._extract_once(target, wide)
                            if data is not None:
                                data["_orca_profile"] = "/".join(profile) + (
                                    " @music" if "music." in url_template else ""
                                )
                                data["_orca_wide_selector"] = True
                                return data
                        except Exception as wide_exc:
                            exc = wide_exc
                    last_exc = exc
                    DEBUG_TAIL.append(
                        _scrub(f"[orca] profile {'/'.join(profile)}: "
                               f"{type(exc).__name__}: {str(exc).splitlines()[0][:200]}")
                    )
                    if _is_permanent_failure(exc):
                        if _is_bot_check(str(exc)):
                            log.warning(
                                "stream probe %r bot-checked on client %s; trying the next profile",
                                target, "/".join(profile),
                            )
                            break
                        log.warning("stream probe %r blocked permanently: %s", target, exc)
                        raise
                    if attempt < max_attempts:
                        sleep_sec = 0.5 * (2 ** (attempt - 1))
                        log.warning(
                            "stream probe %r attempt %d/%d failed: %s. Retrying in %.1fs...",
                            target,
                            attempt,
                            max_attempts,
                            exc,
                            sleep_sec,
                        )
                        time.sleep(sleep_sec)
                    else:
                        log.error("stream probe %r failed after %d attempts: %s", target, max_attempts, exc)
        if last_exc is not None:
            raise last_exc
        return {}

    def resolve(self, video_id: str) -> Tuple[Optional[str], str, bool]:
        """Resolve a track, reporting why it failed and whether a retry can help.

        stream_url() collapses every failure into None, which is why the player
        could not tell an age-gated track (never retry, skip and remember) from
        a 403 on an expired signed URL (re-resolve, it will work). Returns
        (url, message, permanent).
        """
        if not video_id:
            return None, "no track id", True

        # 1. Instant disk cache lookup (0ms load)
        if self.disk_cache and self.disk_cache.has(video_id):
            local_path = self.disk_cache.get_path(video_id)
            if local_path and local_path.is_file():
                log.info("Audio disk cache hit for %s (0ms load)", video_id)
                return local_path.as_uri(), "", False

        # 2. In-memory URL cache lookup
        cached = self.cache.get(video_id)
        if cached is not None:
            log.debug("stream cache hit for %s", video_id)
            return cached, "", False

        # 3. Public mirror ladder — datacenter-proof, browser-playable URLs
        try:
            from .remote import enabled as remote_enabled
            from .remote import fetch_remote_stream

            if remote_enabled():
                remote_url, remote_via = fetch_remote_stream(video_id)
                if remote_url:
                    log.info("stream resolved for %s via public mirror (%s)", video_id, remote_via)
                    self.cache.put(video_id, remote_url)
                    return remote_url, "", False
        except Exception as exc:  # noqa: BLE001 - mirrors must never break the fallback
            DEBUG_TAIL.append(f"[orca] remote layer crashed: {exc.__class__.__name__}: {str(exc)[:160]}")

        try:
            info = self._probe(video_id)
        except Exception as exc:
            log.error("stream resolve failed for %s: %s", video_id, exc)
            return None, str(exc), _is_permanent_failure(exc)

        url = self._pick_url(info)
        has_audio = info.get("acodec", "none") != "none" or bool(info.get("audio_channels"))
        if info.get("_orca_wide_selector") and not has_audio:
            DEBUG_TAIL.append(
                _scrub(f"[orca] resolve {video_id}: served formats have NO audio track "
                       f"(vcodec={info.get('vcodec')}) — audio streams are gated on this host")
            )
            return None, "the server can reach this track but YouTube is gating its audio streams", False
        if not url:
            return None, "no playable audio stream was returned", False
        DEBUG_TAIL.append(
            _scrub(
                f"[orca] resolve {video_id}: OK via {info.get('_orca_profile', 'default')} "
                f"format={info.get('format_id')} ext={info.get('ext')} "
                f"acodec={info.get('acodec')} abr={info.get('abr')}"
            )
        )
        self.cache.put(video_id, url)
        return url, "", False

    def stream_url(self, video_id: str) -> Optional[str]:
        """Direct audio URL for a track id, or None when nothing playable exists."""
        return self.resolve(video_id)[0]

    @staticmethod
    def _pick_url(info: Dict[str, Any]) -> Optional[str]:
        """Best playable audio URL from an extractor response, M4A first.

        Filters out segmented DASH/HLS protocols that Windows Media Foundation
        cannot demux over plain HTTP, and prioritizes clean monolithic AAC/M4A.
        """
        # Unwrap container if wrapped in playlist or entries structure
        if info.get("_type") == "playlist" or "entries" in info:
            entries = info.get("entries")
            if isinstance(entries, list):
                first = next((e for e in entries if isinstance(e, dict)), None)
                if first:
                    info = first

        raw_formats: List[Dict[str, Any]] = info.get("formats") or []
        formats: List[Dict[str, Any]] = []
        for fmt in raw_formats:
            acodec = str(fmt.get("acodec") or "").lower()
            url = fmt.get("url")
            protocol = str(fmt.get("protocol") or "").lower()
            # Reject missing URLs, audio-less streams, and fragmented DASH/HLS protocols
            if not url or acodec in ("", "none") or "dash" in protocol or "frag" in protocol or "m3u8" in protocol:
                continue
            formats.append(fmt)

        # Fall back to the top-level entry only when the format list is empty.
        direct = info.get("url")
        if not formats:
            return direct if isinstance(direct, str) and direct else None

        def _rank(fmt: Dict[str, Any]) -> tuple:
            ext = str(fmt.get("ext") or "").lower()
            acodec = str(fmt.get("acodec") or "").lower()
            vcodec = str(fmt.get("vcodec") or "none").lower()
            is_audio_only = vcodec in ("none", "")
            is_mp4 = ext == "m4a" or acodec.startswith("mp4a")
            # WebM/Opus last resort only — WMF cuts playback on those.
            is_webm = ext == "webm" or acodec.startswith("opus")
            abr = float(fmt.get("abr") or 0)
            filesize = float(fmt.get("filesize") or fmt.get("filesize_approx") or 0)
            return (
                0 if is_audio_only else 1,
                0 if is_mp4 else (2 if is_webm else 1),
                -abr,
                filesize if is_audio_only else -filesize,
            )

        formats.sort(key=_rank)
        return formats[0].get("url")

    def describe(self, url: str) -> Optional[Song]:
        """Turn a pasted link into a Song so it can enter the normal queue."""
        if not url or not url.strip():
            return None
        try:
            info = self._probe(url.strip())
        except Exception as exc:
            log.error("describe failed for %r: %s", url, exc)
            return None

        if info.get("_type") == "playlist" or "entries" in info:
            entries = info.get("entries")
            if isinstance(entries, list):
                first = next((e for e in entries if isinstance(e, dict)), None)
                if first:
                    info = first

        video_id = info.get("id")
        if not video_id:
            return None

        raw_title = str(info.get("title") or "untitled")
        raw_artist = str(info.get("uploader") or info.get("channel") or "youtube")
        return Song(
            video_id=str(video_id),
            title=html.unescape(raw_title),
            artist=html.unescape(raw_artist),
            duration=str(info.get("duration_string") or ""),
            artwork_url=str(info.get("thumbnail") or ""),
        )