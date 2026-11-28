from __future__ import annotations

import html
import logging
import re
import time
from typing import Any, Callable, Dict, List, Optional, TypeVar

from ytmusicapi import YTMusic

try:
    from .models import Song
except ImportError:
    from models import Song

log = logging.getLogger(__name__)

T = TypeVar("T")

_VALID_FILTERS = {
    "albums", "artists", "playlists", "community_playlists",
    "featured_playlists", "songs", "videos", "profiles",
    "podcasts", "episodes",
}
_FILTER_ALIASES = {
    "song": "songs", "track": "songs", "tracks": "songs",
    "video": "videos", "album": "albums", "artist": "artists",
    "playlist": "playlists",
}

# YouTube Music feeds are noisy: Shorts sections (e.g. "Shorts Featured
# Section VN"), sub-minute clips, reaction/status-video filler, sped-up /
# slowed / nightcore spam and montage or remix compilations bury real music.
# Junk items are dropped outright; spam-pattern titles are demoted below
# clean results (demoted, never dropped, so genuine remixes stay reachable).
_JUNK_TITLE_RE = re.compile(
    r"\bshorts?\b|\bclips?\b|\btiktok\b|\bmeme\b|\breactions?\b"
    r"|status\s*(?:video|song|whatsapp)s?\b"
    r"|\bvlog\b|\bpodcasts?\b|\binterviews?\b",
    re.IGNORECASE,
)
_SPAM_TITLE_RE = re.compile(
    r"sped\s*up|speed\s*up|slowed(?:\s*down)?|nightcore|daycore|8d\s*audio|montage"
    r"|\breverb\b|bass\s*boosted|\blyrics?\b.*\bvideo\b"
    r"|\bmashups?\b|cover\s+version\b|\bremix(?:es)?\b",
    re.IGNORECASE,
)
_MIN_TRACK_SECONDS = 90

# Podcast episodes and profile cards are not music: they slip through with
# "unknown artist" and render as playable songs. Dropped outright.
_NON_MUSIC_TYPES = {"episode", "podcast", "profile", "ebook"}

# Cover/spam channels love shouting their name in caps ("BBY WOW"), while
# real releases on the YT Music catalog keep normal capitalization. Demote
# (never drop) so legitimate all-caps acts stay findable.
_ALLCAPS_ARTIST_MIN = 10


def _is_allcaps_spam_artist(artist: str) -> bool:
    text = (artist or "").strip()
    if not text:
        return False
    upper = text.upper()
    if text != upper:
        return False
    letters = [c for c in text if c.isalpha()]
    if len(letters) < 4 or any(not c.isalpha() and c.isalnum() for c in text):
        return False
    # Multi-word shouty names are almost always spam; very long single-word
    # ones (>= 10 letters, e.g. not BTS/ITZY) too. Official suffixes exempt.
    joined = text.replace(" ", "").replace(".", "")
    if "VEVO" in text or text.endswith(" - TOPIC"):
        return False
    return " " in text or len(joined) >= _ALLCAPS_ARTIST_MIN


def _duration_seconds(duration: str) -> int:
    parts = [p for p in str(duration or "").strip().split(":") if p.strip().isdigit()]
    if not parts:
        return 0
    seconds = 0
    for part in parts:
        seconds = seconds * 60 + int(part)
    return seconds


def _is_junk(song: Song) -> bool:
    if _JUNK_TITLE_RE.search(song.title):
        return True
    seconds = _duration_seconds(song.duration)
    return 0 < seconds < _MIN_TRACK_SECONDS


def _spam_penalty(song: Song) -> int:
    penalty = 1 if _SPAM_TITLE_RE.search(song.title) else 0
    if _is_allcaps_spam_artist(song.artist):
        penalty += 3
    # Official YT Music catalog entries outrank UGC video uploads with the
    # same title (covers, re-uploads, sped-up copies) — demote videos, keep
    # them reachable.
    if song.type == "video":
        penalty += 1
    return penalty


def _clean_songs(songs: List[Song]) -> List[Song]:
    """Drop Shorts/clip junk, demote spam-pattern titles, keep stable order."""
    kept = [s for s in songs if not _is_junk(s)]
    return sorted(kept, key=_spam_penalty)


def _with_retry(
    operation: Callable[..., T],
    *args: Any,
    max_attempts: int = 3,
    base_delay: float = 0.6,
    operation_name: str = "request",
    **kwargs: Any,
) -> T:
    """Execute a network-bound callable with exponential backoff."""
    last_exc: Optional[Exception] = None
    for attempt in range(1, max_attempts + 1):
        try:
            return operation(*args, **kwargs)
        except Exception as exc:
            last_exc = exc
            if attempt < max_attempts:
                sleep_time = base_delay * (2 ** (attempt - 1))
                log.warning(
                    "%s attempt %d/%d failed: %s. Retrying in %.1fs...",
                    operation_name,
                    attempt,
                    max_attempts,
                    exc,
                    sleep_time,
                )
                time.sleep(sleep_time)
            else:
                log.error("%s failed permanently after %d attempts: %s", operation_name, max_attempts, exc)
    if last_exc is not None:
        raise last_exc
    raise RuntimeError(f"{operation_name} failed without exception")


_PLACEHOLDER_ARTIST_RE = re.compile(
    r"^(unknown\s*artist|unknown|various\s*artists|n/a|-)$", re.IGNORECASE
)


def _clean_artist_name(name: str) -> str:
    """Normalize one raw artist name: unescape entities, strip VEVO/topic
    channel suffixes ("Artist - Topic", "ArtistVEVO") and whitespace."""
    out = html.unescape(str(name)).strip()
    out = re.sub(r"\s*-\s*Topic\s*$", "", out, flags=re.IGNORECASE).strip()
    out = re.sub(r"\s*-\s*VEVO\s*$", "", out, flags=re.IGNORECASE).strip()
    out = re.sub(r"VEVO\s*$", "", out, flags=re.IGNORECASE).strip()
    return out


def _artist_from_title(title: str) -> str:
    """Parse "Artist - Title" from a bare video title when no separate artist
    metadata exists. Only splits when the left side plausibly is a name."""
    idx = title.find(" - ")
    if idx <= 0 or idx > 60:
        return ""
    left = title[:idx].strip()
    right = title[idx + 3:].strip()
    if not left or not right:
        return ""
    if left.lower().startswith(("http://", "https://", "www.")):
        return ""
    if re.search(r"[\[\(](official|lyrics?|audio|video|mv|hd|4k)\b", left, re.IGNORECASE):
        return ""
    return left


def _artist_line(item: Dict[str, Any]) -> str:
    """Extract and normalize artist name(s) from a search or watch item.
    Tries, in order: artist string, artists/author/subtitle lists, then an
    "Artist - Title" split from the video title itself. " - Topic" suffixes
    are stripped; placeholder names collapse to "unknown artist"."""
    if isinstance(item.get("artist"), str) and item["artist"].strip():
        cleaned = _clean_artist_name(item["artist"])
        if cleaned and not _PLACEHOLDER_ARTIST_RE.match(cleaned):
            return cleaned
    raw = item.get("artists") or item.get("author") or item.get("subtitle") or item.get("artist") or []
    if isinstance(raw, dict):
        raw = [raw]
    if isinstance(raw, list):
        names = []
        for entry in raw:
            if isinstance(entry, dict) and entry.get("name"):
                names.append(_clean_artist_name(entry["name"]))
            elif isinstance(entry, str) and entry.strip():
                names.append(_clean_artist_name(entry))
        names = [n for n in names if n and not _PLACEHOLDER_ARTIST_RE.match(n)]
        if names:
            return ", ".join(names)
    if isinstance(raw, str) and raw.strip():
        cleaned = _clean_artist_name(raw)
        if cleaned and not _PLACEHOLDER_ARTIST_RE.match(cleaned):
            return cleaned
    # Last resort: "Artist - Title" baked into the video title.
    details = item.get("videoDetails")
    title = item.get("title")
    if title is None and isinstance(details, dict):
        title = details.get("title")
    if isinstance(title, str) and title.strip():
        parsed = _artist_from_title(html.unescape(title).strip())
        if parsed:
            return parsed
    return "unknown artist"


def _artwork_url(item: Dict[str, Any]) -> str:
    """Pick highest resolution thumbnail available."""
    raw = item.get("thumbnails") or item.get("thumbnail") or []
    if isinstance(raw, dict):
        raw = [raw]
    if isinstance(raw, list) and raw:
        # Choose highest width/height or last element
        valid = [entry for entry in raw if isinstance(entry, dict) and entry.get("url")]
        if valid:
            def _area(x: Dict[str, Any]) -> int:
                try:
                    if not isinstance(x, dict): return 0
                    return int(x.get("width") or 0) * int(x.get("height") or 0)
                except (ValueError, TypeError):
                    return 0
            valid.sort(key=_area)
            return valid[-1].get("url") or ""
    return ""


class CatalogSource:
    """Wraps the guest (no-login) YouTube Music client with resilient retries."""

    def __init__(self) -> None:
        self.api = YTMusic()
        log.info("catalogue client ready")

    # ------------------------------------------------------------------ reads
    def search(self, query: str, filter_type: Optional[str] = None, limit: int = 20) -> List[Song]:
        """Free-text song search with exponential backoff.

        Raises on persistent transport failure so the UI can notify the user.
        """
        query = (query or "").strip()
        if not query:
            return []

        f = filter_type.strip().lower() if isinstance(filter_type, str) else ""
        f = _FILTER_ALIASES.get(f, f)
        filter_type = f if f in _VALID_FILTERS else None

        def _do_search() -> List[Dict[str, Any]]:
            return self.api.search(query, filter=filter_type, limit=limit)

        raw_results = _with_retry(
            _do_search,
            max_attempts=3,
            base_delay=0.5,
            operation_name=f"search({query!r})",
        )

        found: List[Song] = []
        for item in raw_results:
            song = self._build(item, duration_key="duration")
            if song is not None:
                found.append(song)

        found = _clean_songs(found)
        log.info("search %r -> %d track(s)", query, len(found))
        return found

    def album(self, browse_id: str) -> Dict[str, Any]:
        """Album detail: title, artist, cover and its tracklist."""
        browse_id = (browse_id or "").strip()
        if not browse_id:
            return {}

        def _do_album() -> Dict[str, Any]:
            return self.api.get_album(browse_id)

        data: Any = None
        try:
            data = _with_retry(
                _do_album,
                max_attempts=2,
                base_delay=0.6,
                operation_name=f"album({browse_id})",
            )
        except Exception as exc:
            log.warning("album lookup failed for %s: %s", browse_id, exc)
        if not isinstance(data, dict) or not data.get("tracks"):
            """
            Playlist browse ids (VL…) are not albums — get_album rejects them.
            Metadata comes from get_playlist, but its track rows frequently
            carry videoId: null (unavailable entries on this client), so the
            playable rows are pulled from the watch-playlist endpoint (which
            wants the id without the VL prefix) and used as the tracklist.
            """
            pdata: Any = None
            try:
                pdata = _with_retry(
                    lambda: self.api.get_playlist(browse_id),
                    max_attempts=2,
                    base_delay=0.6,
                    operation_name=f"playlist-browse({browse_id})",
                )
            except Exception as exc:
                log.warning("playlist-browse failed for %s: %s", browse_id, exc)

            base_id = browse_id[2:] if browse_id.startswith("VL") else browse_id
            wdata: Any = None
            try:
                wdata = _with_retry(
                    lambda: self.api.get_watch_playlist(playlistId=base_id, limit=50),
                    max_attempts=2,
                    base_delay=0.6,
                    operation_name=f"playlist-watch({base_id})",
                )
            except Exception as exc:
                log.warning("playlist-watch failed for %s: %s", base_id, exc)

            watch_tracks = wdata.get("tracks") or [] if isinstance(wdata, dict) else []
            playable = [t for t in watch_tracks if isinstance(t, dict) and t.get("videoId")]
            if isinstance(pdata, dict) and (playable or pdata.get("tracks")):
                author = pdata.get("author")
                if isinstance(author, dict):
                    pdata["artists"] = [{"name": author.get("name") or ""}]
                elif isinstance(author, str) and author:
                    pdata["artists"] = [{"name": author}]
                if playable:
                    pdata["tracks"] = playable
                data = pdata
        if not isinstance(data, dict):
            return {}

        thumbnails = data.get("thumbnails") or []
        cover = ""
        if thumbnails:
            try:
                cover = sorted(thumbnails, key=lambda t: t.get("width", 0))[-1]["url"]
            except (IndexError, KeyError, TypeError):
                cover = ""

        tracks: List[Song] = []
        for raw in data.get("tracks") or []:
            if not isinstance(raw, dict):
                continue
            item = {**raw, "resultType": "song"}
            song = self._build(item, duration_key="duration")
            if song is not None:
                # Album tracklists carry no per-track thumbnails: show the
                # album cover on every row so the tracklist has artwork.
                if not song.artwork_url and cover:
                    song.artwork_url = cover
                tracks.append(song)

        artist = _artist_line({"artists": data.get("artists") or []})
        return {
            "browseId": browse_id,
            "title": html.unescape(str(data.get("title") or "Unknown album")),
            "artist": artist,
            "year": str(data.get("year") or ""),
            "cover": cover,
            "tracks": tracks,
        }

    def track(self, video_id: str) -> Dict[str, Any]:
        """Single-track metadata + credits for the track detail view."""
        video_id = (video_id or "").strip()
        if not video_id:
            return {}

        def _fallback() -> Dict[str, Any]:
            """
            Minimal, still-playable detail for a track whose metadata could
            not be fetched at all (bot flag, network failure, unexpected
            payload). The IFrame player streams it fine — the page must open
            instead of erroring.
            """
            return {
                "videoId": video_id,
                "title": "Unknown track",
                "artist": "Unknown artist",
                "duration": "",
                "artworkUrl": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
                "album": "",
                "albumId": "",
                "year": "",
                "credits": {"channel": "", "source": "YouTube Music"},
                "song": Song(
                    video_id=video_id,
                    title="Unknown track",
                    artist="Unknown artist",
                    artwork_url=f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
                ),
            }

        def _do_track() -> Dict[str, Any]:
            return self.api.get_song(video_id)

        try:
            data = _with_retry(
                _do_track,
                max_attempts=2,
                base_delay=0.5,
                operation_name=f"track({video_id})",
            )
        except Exception as exc:
            log.warning("track lookup failed for %s: %s", video_id, exc)
            return _fallback()
        if not isinstance(data, dict):
            return _fallback()

        details = data.get("videoDetails") if isinstance(data.get("videoDetails"), dict) else data
        title = html.unescape(str(details.get("title") or "")).strip()
        author = _artist_line(details)
        seconds = 0
        try:
            seconds = int(details.get("lengthSeconds") or details.get("duration_seconds") or 0)
        except (TypeError, ValueError):
            seconds = 0
        duration = f"{seconds // 60}:{seconds % 60:02d}" if seconds > 0 else ""
        item = {**details, "resultType": "song", "artist": author}
        song = self._build(item, duration_key="duration")
        if song is not None and duration:
            song.duration = duration
        if song is None:
            """
            YouTube bot-flagged this lookup (playabilityStatus LOGIN_REQUIRED,
            no videoDetails) or _build rejected the payload — still hand back
            a usable track so the track page opens and plays instead of
            rendering an error. Playback itself goes through the IFrame
            player, which is unaffected by the bot flag.
            """
            song = Song(
                video_id=video_id,
                title=title or "Unknown track",
                artist=author or "Unknown artist",
                duration=duration,
                artwork_url=_artwork_url(details)
                or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
            )

        album = details.get("album")
        album_name = ""
        album_id = ""
        if isinstance(album, dict):
            album_name = str(album.get("name") or "")
            album_id = str(album.get("id") or album.get("browseId") or "")
        year = str(details.get("year") or details.get("publishDate") or "")[:4]
        channel = str(details.get("author") or details.get("channelId") or "")

        return {
            "videoId": video_id,
            "title": title or (song.title if song else "Unknown track"),
            "artist": author,
            "duration": duration,
            "artworkUrl": song.artwork_url if song else _artwork_url(details),
            "album": album_name,
            "albumId": album_id,
            "year": year,
            "credits": {"channel": channel, "source": "YouTube Music"},
            # Raw Song object — the server layer converts it to a DTO.
            "song": song,
        }

    def similar(self, seed_id: str, limit: int = 26) -> List[Song]:
        """Tracks the recommendation graph puts next to `seed_id`. Best effort."""
        related: List[Song] = []
        seen = {seed_id}

        def _do_watch() -> Dict[str, Any]:
            return self.api.get_watch_playlist(videoId=seed_id, limit=limit)

        try:
            watch = _with_retry(
                _do_watch,
                max_attempts=2,
                base_delay=0.6,
                operation_name=f"radio({seed_id})",
            )
        except Exception as exc:  # noqa: BLE001 - network surface
            log.warning("radio lookup failed for %s after retries: %s", seed_id, exc)
            return related

        for item in watch.get("tracks") or []:
            song = self._build(item, duration_key="length")
            if song is None or song.video_id in seen:
                continue
            seen.add(song.video_id)
            related.append(song)

        related = _clean_songs(related)
        log.debug("radio for %s -> %d track(s)", seed_id, len(related))
        return related

    def lyrics(self, video_id: str, title: str = "", artist: str = "") -> Optional[str]:
        """Fetch lyrics text, preferring LRCLIB timed .lrc, fallback to YouTube Music for plain text."""
        video_id = (video_id or "").strip()
        title = (title or "").strip()
        artist = (artist or "").strip()
        
        # 1. Try LRCLIB for pristine timestamped lyrics
        if title and artist:
            try:
                import urllib.request, urllib.parse, json
                url = f"https://lrclib.net/api/search?track_name={urllib.parse.quote(title)}&artist_name={urllib.parse.quote(artist)}"
                req = urllib.request.Request(url, headers={'User-Agent': 'OrcaMusic/1.0'})
                with urllib.request.urlopen(req, timeout=5) as response:
                    data = json.loads(response.read().decode())
                    if isinstance(data, list) and len(data) > 0:
                        for entry in data:
                            if entry.get("syncedLyrics"):
                                return str(entry["syncedLyrics"])
                        # If no synced LRC exists, keep fallback
                        for entry in data:
                            if entry.get("plainLyrics"):
                                return str(entry["plainLyrics"])
            except Exception as exc:
                log.warning("lrclib fetch failed for %s - %s: %s", title, artist, exc)
                
        # 2. Fallback to YouTube Music
        if not video_id:
            return None

        def _do_lyrics() -> Optional[str]:
            watch = self.api.get_watch_playlist(videoId=video_id)
            lyrics_id = watch.get("lyrics")
            if not lyrics_id:
                return None
            data = self.api.get_lyrics(lyrics_id)
            if not data or not isinstance(data, dict):
                return None
            return str(data.get("lyrics", "")).strip() or None

        try:
            return _with_retry(
                _do_lyrics,
                max_attempts=2,
                base_delay=0.5,
                operation_name=f"lyrics({video_id})",
            )
        except Exception as exc: 
            log.warning("lyrics lookup failed for %s: %s", video_id, exc)
            return None

    def home(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Fetch the dynamic YTMusic home feed and filter for playable tracks."""
        def _do_home() -> List[Dict[str, Any]]:
            return self.api.get_home(limit=limit)

        try:
            raw = _with_retry(
                _do_home,
                max_attempts=2,
                base_delay=0.6,
                operation_name="get_home",
            )
        except Exception as exc:
            log.warning("home fetch failed: %s", exc)
            return []
            
        sections = []
        for shelf in raw:
            if not isinstance(shelf, dict): 
                continue
            title = shelf.get("title") or "Recommended for you"
            contents = shelf.get("contents") or []
            valid_tracks = []
            for item in contents:
                vid = item.get("videoId") or item.get("browseId") or item.get("playlistId")
                if vid:
                    song = self._build(item)
                    if song:
                        valid_tracks.append(song)
            if valid_tracks:
                sections.append({
                    "title": html.unescape(title) if isinstance(title, str) else str(title),
                    "tracks": _clean_songs(valid_tracks)
                })
        return sections

    def billboard(self, chart: str = "hot100", region: str = "global", limit: int = 25) -> List[Song]:
        """Chart-style track lists via YouTube Music search.

        Billboard's own site has no public API, so charts are sourced from
        curated YouTube Music queries (weekly-updated chart roundups). Junk
        cleaning applies like every other catalog surface.
        """
        queries = {
            ("hot100", "global"): "billboard hot 100 top songs this week",
            ("hot100", "us"): "billboard hot 100 this week usa",
            ("hot100", "uk"): "uk top 40 charts this week",
            ("hot100", "vietnam"): "nhac tre hot viet nam moi nhat",
            ("hot100", "korea"): "kpop top hits this week",
            ("hot100", "japan"): "jpop top hits this week",
            ("viral", "global"): "viral hits top tracks this week",
            ("viral", "vietnam"): "nhac hot trend viet nam",
            ("viral", "us"): "viral hits usa this week",
            ("new", "global"): "brand new music this week new releases",
            ("new", "vietnam"): "nhac tre moi nhat trong tuan",
            ("new", "us"): "new music this week new releases",
        }
        query = queries.get((chart, region)) or queries.get((chart, "global")) or queries.get(("hot100", "global"), "top hits this week")
        return self.search(query, limit=limit)  # search() already junk-cleans

    def top_artists(self, country: str = "IN") -> List[Song]:
        try:
            charts = _with_retry(lambda: self.api.get_charts(country=country), max_attempts=2, base_delay=0.5, operation_name="charts")
            artists_data = charts.get("artists") or []
            raw_artists = artists_data.get("items", []) if isinstance(artists_data, dict) else artists_data
            found = []
            for item in raw_artists:
                item["resultType"] = "artist"
                song = self._build(item)
                if song:
                    found.append(song)
            return found
        except Exception as exc:
            log.warning("top_artists failed: %s", exc)
            return []

    def artist_details(self, browse_id: str) -> Dict[str, Any]:
        try:
            data = _with_retry(lambda: self.api.get_artist(browse_id), max_attempts=2, base_delay=0.5, operation_name=f"artist({browse_id})")
            
            songs = []
            if "songs" in data and "results" in data["songs"]:
                for r in data["songs"]["results"]:
                    r["resultType"] = "song"
                    song = self._build(r)
                    if song: songs.append(song)
            
            albums = []
            if "albums" in data and "results" in data["albums"]:
                for r in data["albums"]["results"]:
                    r["resultType"] = "album"
                    pl = self._build(r)
                    if pl: albums.append(pl)
                    
            singles = []
            if "singles" in data and "results" in data["singles"]:
                for r in data["singles"]["results"]:
                    r["resultType"] = "album"
                    pl = self._build(r)
                    if pl: singles.append(pl)
            
            image_url = ""
            thumbnails = data.get("thumbnails", [])
            if thumbnails:
                image_url = sorted(thumbnails, key=lambda x: x.get("width", 0))[-1]["url"]

            return {
                "name": data.get("name", "Unknown Artist"),
                "description": data.get("description", ""),
                "image": image_url,
                "songs": songs,
                "albums": albums,
                "singles": singles
            }
        except Exception as exc:
            log.warning("artist_details failed: %s", exc)
            return {}

    def import_playlist(self, identifier: str) -> Dict[str, Any]:
        """Fetch playlist tracks by URL or ID."""
        identifier = identifier.strip()
        if not identifier:
            return {"title": "Unknown", "tracks": []}
            
        import urllib.parse
        if "spotify.com" in identifier:
            return self._import_spotify_playlist(identifier)
            
        if "list=" in identifier:
            try:
                parsed = urllib.parse.urlparse(identifier)
                qs = urllib.parse.parse_qs(parsed.query)
                identifier = qs.get("list", [identifier])[0]
            except Exception:
                pass
                
        def _do_get() -> Dict[str, Any]:
            return self.api.get_playlist(playlistId=identifier, limit=300)
            
        try:
            data = _with_retry(_do_get, max_attempts=2, base_delay=0.6, operation_name=f"playlist({identifier})")
        except Exception as exc:
            log.warning("playlist import failed: %s", exc)
            return {"title": "Failed to Import", "tracks": []}
            
        title = data.get("title", "Imported Playlist")
        tracks = []
        for item in data.get("tracks", []):
            song = self._build(item)
            if song:
                tracks.append(song)
                
        return {"title": title, "tracks": tracks}

    def _import_spotify_playlist(self, url: str) -> Dict[str, Any]:
        """Scrape Spotify embed API for playlist tracks and match them to YT."""
        import requests, re, json
        import concurrent.futures
        
        try:
            # Transform normal url to embed url
            if "/playlist/" in url and "/embed/" not in url:
                url = url.replace("/playlist/", "/embed/playlist/")
            elif "/album/" in url and "/embed/" not in url:
                url = url.replace("/album/", "/embed/album/")
            
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
            r = requests.get(url, headers=headers, timeout=10)
            
            match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', r.text)
            if not match:
                log.warning("Could not find NEXT_DATA in Spotify embed")
                return {"title": "Failed to Parse Spotify", "tracks": []}
                
            data = json.loads(match.group(1))
            entity = data.get("props", {}).get("pageProps", {}).get("state", {}).get("data", {}).get("entity", {})
            title = entity.get("name", "Spotify Import")
            track_list = entity.get("trackList", [])
            
            if not track_list:
                return {"title": title, "tracks": []}
                
            # Limit to 100 tracks to avoid crazy ytmusic rate limiting / waiting forever
            track_list = track_list[:100]
            
            def _resolve_track(trk):
                t_name = trk.get("title", "")
                t_artist = trk.get("subtitle", "")
                if not t_name: return None
                query = f"{t_name} {t_artist}".strip()
                # Search ytmusic
                try:
                    res = self.api.search(query, filter="songs", limit=1)
                    if res:
                        return self._build(res[0])
                except Exception:
                    pass
                return None
                
            tracks = []
            with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
                for yt_song in executor.map(_resolve_track, track_list):
                    if yt_song:
                        tracks.append(yt_song)
                        
            return {"title": title, "tracks": tracks}
        except Exception as exc:
            log.warning("Spotify playlist import failed: %s", exc)
            return {"title": "Spotify Import Failed", "tracks": []}

    # ----------------------------------------------------------------- parsing
    @staticmethod
    def _build(item: Dict[str, Any], duration_key: str = "duration") -> Optional[Song]:
        """Map raw dictionary to a validated Song dataclass."""
        if not isinstance(item, dict):
            return None
            
        result_type = str(item.get("resultType") or "song").strip().lower()
        if result_type in _NON_MUSIC_TYPES:
            return None
        category = str(item.get("category", "")).lower()
        if "episode" in category or "podcast" in category or "short" in category:
            return None
        if "artist" in category or "profiles" in category:
            result_type = "artist"
        elif "playlist" in category or "albums" in category:
            result_type = "playlist"
            
        video_id = item.get("videoId")
        browse_id = item.get("browseId")
        
        if not browse_id and result_type == "artist":
            artists = item.get("artists")
            if isinstance(artists, list) and len(artists) > 0 and isinstance(artists[0], dict):
                browse_id = artists[0].get("id")

        if not video_id:
            if browse_id:
                video_id = browse_id
                if not item.get("resultType"):
                    if "artist" in category or "profiles" in category: result_type = "artist"
                    elif "playlist" in category or "albums" in category: result_type = "playlist"
            else:
                return None
                
        raw_dur = item.get(duration_key)
        if raw_dur is None:
            raw_dur = item.get("duration") or item.get("length") or ""
            
        try:
            if isinstance(raw_dur, (int, float)) or (isinstance(raw_dur, str) and raw_dur.isdigit()):
                numeric_dur = int(raw_dur)
                minutes = numeric_dur // 60
                seconds = numeric_dur % 60
                duration = f"{minutes}:{seconds:02d}"
            else:
                duration = str(raw_dur).strip()
        except (ValueError, TypeError):
            duration = str(raw_dur).strip()

        if result_type == "artist":
            raw_title = _artist_line(item)
            if not raw_title or raw_title == "unknown artist":
                raw_title = str(item.get("artist") or item.get("title") or item.get("author") or "unknown artist")
        else:
            raw_title = str(item.get("title") or "untitled").strip()
            
        album_item = item.get("album")
        album_name = ""
        if isinstance(album_item, dict):
            album_name = str(album_item.get("name") or "").strip()
        elif isinstance(album_item, str):
            album_name = album_item.strip()

        return Song(
            video_id=str(video_id).strip(),
            title=html.unescape(raw_title),
            artist=_artist_line(item),
            duration=duration,
            artwork_url=_artwork_url(item),
            album=album_name,
            type=result_type,
        )