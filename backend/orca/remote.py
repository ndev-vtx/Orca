"""
remote.py
Zero-extra-server stream sourcing for hosted deployments (Vercel, Render, ...).

YouTube refuses signed stream URLs to datacenter IPs (bot checks, PO-token
gated audio). Instead of running a PO-token server, Orca asks public Piped,
Invidious and Cobalt instances first: they resolve the track on their own
egress and hand out playback URLs through their own proxies, so the URL is
NOT locked to our IP — the browser plays it directly.

Every candidate URL is validated with a small ranged GET before it is
returned; dead instances are skipped and every decision is logged into the
shared DEBUG_TAIL so /api/resolve's trail and /api/doctor explain the choice.

Environment:
    ORCA_REMOTE_SOURCES      "off" disables this layer entirely (default on)
    ORCA_PIPED_INSTANCES     comma-separated base URLs (no trailing slash)
    ORCA_INVIDIOUS_INSTANCES comma-separated base URLs
    ORCA_COBALT_INSTANCES    comma-separated base URLs

Note: these public instances are community-run reliability, not an SLA; the
yt-dlp ladder stays as the fallback and remains what works on residential
connections (local desktop use needs none of this).
"""

from __future__ import annotations

import logging
import os
import time
from urllib.parse import urlparse
from typing import Any, Dict, List, Optional, Tuple

import requests

log = logging.getLogger(__name__)

PIPES_DEFAULT = ",".join(
    (
        "https://pipedapi.kavin.rocks",
        "https://pipedapi.adminforge.de",
        "https://api.piped.private.coffee",
        "https://pipedapi.ducks.party",
        "https://pipedapi.reallyaweso.me",
        "https://pipedapi.nosebs.ru",
        "https://pipedapi.phoenixthrush.com",
    )
)
INVIDIOUS_DEFAULT = ",".join(
    (
        "https://inv.nadeko.net",
        "https://invidious.nerdvpn.de",
        "https://yt.chocolatemoo53.com",
        "https://invidious.tiekoetter.com",
        "https://yewtu.be",
    )
)
COBALT_DEFAULT = ",".join(
    (
        "https://cobalt-api.kwiatekmiki.com",
        "https://api.cobalt.tools",
    )
)

REQUEST_TIMEOUT_S = 7
PROBE_TIMEOUT_S = 8
REMOTE_BUDGET_S = 24.0

_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0 Safari/537.36"
)

_session: Optional[requests.Session] = None


def _http() -> requests.Session:
    global _session
    if _session is None:
        _session = requests.Session()
        _session.headers.update({"User-Agent": _USER_AGENT})
    return _session


def enabled() -> bool:
    return os.environ.get("ORCA_REMOTE_SOURCES", "on").strip().lower() not in {
        "off",
        "false",
        "0",
        "no",
    }


def _instances(env_name: str, default_csv: str) -> List[str]:
    raw = os.environ.get(env_name, "").strip()
    csv = raw or default_csv
    return [u.strip().rstrip("/") for u in csv.split(",") if u.strip()]


def _tail(message: str) -> None:
    from .stream import DEBUG_TAIL

    DEBUG_TAIL.append(message)


def _host(base: str) -> str:
    return urlparse(base).hostname or base


def _probe_ok(url: str, timeout: float = PROBE_TIMEOUT_S) -> bool:
    """True when a ranged GET returns bytes that look like a media stream."""
    try:
        resp = _http().get(
            url,
            headers={"Range": "bytes=0-2047"},
            timeout=timeout,
            allow_redirects=True,
        )
    except requests.RequestException as exc:
        _tail(f"[orca] remote: stream probe failed ({exc.__class__.__name__})")
        return False
    if resp.status_code not in (200, 206):
        _tail(f"[orca] remote: stream probe got HTTP {resp.status_code}")
        return False
    ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    if ctype.startswith(("audio/", "video/")) or ctype in (
        "application/octet-stream",
        "binary/octet-stream",
    ):
        return True
    _tail(f"[orca] remote: stream probe got content-type {ctype or 'none'}")
    return False


def _pick_piped_audio(streams: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Highest-bitratecodec stream, monolithic audio/mp4 preferred.

    Mirrors stream._pick_url's WMF constraint: m4a/AAC first, Opus/WebM last.
    """

    def rank(item: Dict[str, Any]) -> Tuple[int, float]:
        mime = str(item.get("mimeType") or "").split(";")[0].strip().lower()
        quality = 0 if mime == "audio/mp4" else (2 if mime == "audio/webm" else 1)
        try:
            bitrate = float(item.get("bitrate") or 0)
        except (TypeError, ValueError):
            bitrate = 0.0
        return (quality, -bitrate)

    valid = [s for s in streams if isinstance(s, dict) and s.get("url")]
    if not valid:
        return None
    return sorted(valid, key=rank)[0]


def _fetch_json(url: str, timeout: float = REQUEST_TIMEOUT_S) -> Optional[Any]:
    resp = _http().get(url, timeout=timeout)
    if resp.status_code != 200:
        _tail(f"[orca] remote {_host(url)}: HTTP {resp.status_code}")
        return None
    try:
        return resp.json()
    except ValueError:
        _tail(f"[orca] remote {_host(url)}: non-JSON body")
        return None


def _via_piped(video_id: str, instances: List[str], deadline: float) -> Optional[str]:
    for base in instances:
        if time.monotonic() > deadline:
            return None
        data = _fetch_json(f"{base}/streams/{video_id}")
        if not isinstance(data, dict):
            continue
        if data.get("error"):
            _tail(f"[orca] remote piped {_host(base)}: {str(data['error'])[:120]}")
            continue
        best = _pick_piped_audio(data.get("audioStreams") or [])
        if not best:
            _tail(f"[orca] remote piped {_host(base)}: no audio streams listed")
            continue
        url = str(best["url"])
        if _probe_ok(url):
            _tail(
                f"[orca] remote: OK via piped {_host(base)} "
                f"mime={str(best.get('mimeType', '')).split(';')[0]} "
                f"bitrate={best.get('bitrate')}"
            )
            return url
    return None


def _via_invidious(video_id: str, instances: List[str], deadline: float) -> Optional[str]:
    local = f"{video_id}?local=true&fields=adaptiveFormats"
    for base in instances:
        if time.monotonic() > deadline:
            return None
        data = _fetch_json(f"{base}/api/v1/videos/{local}")
        if not isinstance(data, dict):
            continue
        formats = data.get("adaptiveFormats") or []
        audio = [f for f in formats if isinstance(f, dict) and str(f.get("type", "")).startswith("audio/")]
        if not audio:
            _tail(f"[orca] remote invidious {_host(base)}: no audio formats listed")
            continue
        # Only proxied URLs are useful: direct googlevideo links are IP-locked
        # to the instance instead of to us — same failure in a different place.
        def proxied(fmt: Dict[str, Any]) -> bool:
            return not urlparse(str(fmt.get("url", ""))).hostname or (
                "googlevideo.com" not in str(urlparse(str(fmt.get("url", ""))).hostname)
            )

        ranked = [f for f in audio if proxied(f)]
        for fmt in ranked:
            url = str(fmt.get("url", ""))
            if url and _probe_ok(url):
                _tail(f"[orca] remote: OK via invidious {_host(base)} type={fmt.get('type', '')[:40]}")
                return url
        if not ranked:
            _tail(f"[orca] remote invidious {_host(base)}: only IP-locked googlevideo URLs")
    return None


def _via_cobalt(video_id: str, instances: List[str], deadline: float) -> Optional[str]:
    payload = {
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "downloadMode": "audio",
        "audioFormat": "mp4",
    }
    for base in instances:
        if time.monotonic() > deadline:
            return None
        try:
            resp = _http().post(
                f"{base}/",
                json=payload,
                timeout=REQUEST_TIMEOUT_S,
                headers={"Accept": "application/json"},
            )
        except requests.RequestException as exc:
            _tail(f"[orca] remote cobalt {_host(base)}: {exc.__class__.__name__}")
            continue
        if resp.status_code != 200:
            _tail(f"[orca] remote cobalt {_host(base)}: HTTP {resp.status_code}")
            continue
        data = resp.json() if resp.headers.get("Content-Type", "").startswith("application/json") else {}
        status = str(data.get("status") or "")
        url = str(data.get("url") or "")
        if status in ("tunnel", "redirect") and url:
            if _probe_ok(url):
                _tail(f"[orca] remote: OK via cobalt {_host(base)} status={status}")
                return url
        else:
            _tail(f"[orca] remote cobalt {_host(base)}: {str(data.get('error') or data.get('text') or status or 'empty response')[:120]}")
    return None


def fetch_remote_stream(video_id: str) -> Tuple[Optional[str], str]:
    """Best playable URL from the public-instance ladder, or (None, reason)."""
    if not video_id:
        return None, "no track id"
    if not enabled():
        return None, "disabled"
    deadline = time.monotonic() + REMOTE_BUDGET_S
    for name, fetcher, env_name, default_csv in (
        ("piped", _via_piped, "ORCA_PIPED_INSTANCES", PIPES_DEFAULT),
        ("invidious", _via_invidious, "ORCA_INVIDIOUS_INSTANCES", INVIDIOUS_DEFAULT),
        ("cobalt", _via_cobalt, "ORCA_COBALT_INSTANCES", COBALT_DEFAULT),
    ):
        url = fetcher(video_id, _instances(env_name, default_csv), deadline)
        if url:
            return url, name
        if time.monotonic() > deadline:
            _tail("[orca] remote: instance ladder ran out of its time budget")
            break
    _tail(f"[orca] remote: no public instance could serve {video_id}")
    return None, "no public instance could serve this track"
