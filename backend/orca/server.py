"""
server.py
Orca backend: FastAPI wrapper around the unmodified core modules
(catalog / stream / cache / storage / lyrics / importer / exporter).

Endpoints run as sync functions so FastAPI executes them on its worker thread
pool — the core stays exactly as threaded and blocking as it has always been.

Launch:
    uvicorn orca.server:app --host 127.0.0.1 --port 8765
    or: python -m orca.server
"""

from __future__ import annotations

from contextlib import asynccontextmanager
import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests as http_client
from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import Scope

from . import __version__, doctor
from .catalog import CatalogSource
from .config import (
    APP_NAME,
    DEFAULT_CACHE_MAX_MB,
    SEARCH_DEBOUNCE_MS,
    STREAM_CACHE_TTL_S,
    SWITCH_TIMEOUT_MS,
)
from .exporter import AudioExporter
from .importer import is_playlist_url
from .lyrics import fetch_lrclib, parse_lrc
from .models import Song
from .schemas import (
    AddTracksRequest,
    BroadcastResponse,
    CreatePlaylistRequest,
    DoctorResponse,
    ExportRequest,
    ExportResponse,
    FavoriteStatusResponse,
    FavoritesResponse,
    HealthResponse,
    HistoryResponse,
    HomeResponse,
    HomeSection,
    ImportRequest,
    ImportResponse,
    LyricsResponse,
    NowPlayingRequest,
    PlaylistDetail,
    PlaylistSummary,
    RenamePlaylistRequest,
    ResolveProxyResponse,
    ResolveRequest,
    ResolveResponse,
    SongDto,
)
from .storage import OrcaStorage
from .stream import StreamResolver, ytdlp_age_days, ytdlp_version
from .ws import manager

log = logging.getLogger("orca.server")

DEFAULT_HOST = os.environ.get("ORCA_HOST", "127.0.0.1")
DEFAULT_PORT = int(os.environ.get("ORCA_PORT", "8765"))


def _friendly_stream_error(error: str) -> str:
    """Collapse raw yt-dlp dumps into one human-readable sentence.

    The web client shows this verbatim in the notice bar, so the bot-check
    text (three paragraphs of traceback in yt-dlp) must arrive as one line
    that also tells the user the cause instead of 'playback failed'.
    """
    text = (error or "").strip()
    if not text:
        return ""
    lowered = text.lower()
    if "not a bot" in lowered:
        return (
            "YouTube is bot-checking this server; "
            "set the ORCA_YT_COOKIE environment variable to fix it"
        )
    if "confirm your age" in lowered or "age-restricted" in lowered:
        return "YouTube restricts this track to signed-in accounts"
    if "video unavailable" in lowered or "video is unavailable" in lowered:
        return "YouTube reports this track as unavailable"
    if "private video" in lowered:
        return "this video is private"
    if "members-only" in lowered:
        return "this video is members-only"
    first = text.splitlines()[0].strip()
    return first[:240]


# --------------------------------------------------------------- singletons
_catalog: Optional[CatalogSource] = None
_resolver: Optional[StreamResolver] = None
_storage: Optional[OrcaStorage] = None
_exporter: Optional[AudioExporter] = None


class SPAStaticFiles(StaticFiles):
    """Static frontend with an index.html fallback so client routes (e.g.
    /playlist/3, /queue) deep-link correctly. API 404s never reach here: the
    mount is registered after every /api route.
    """

    async def get_response(self, path: str, scope: Scope):
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404 and not (
                path.startswith("api/") or path.startswith("ws")
            ):
                return await super().get_response("index.html", scope)
            raise
        if response.status_code == 404 and not (
            path.startswith("api/") or path.startswith("ws")
        ):
            return await super().get_response("index.html", scope)
        return response


def static_dir() -> Optional[Path]:
    """Where the built frontend lives; ORCA_STATIC_DIR wins, else repo layout."""
    override = os.environ.get("ORCA_STATIC_DIR")
    if override:
        candidate = Path(override)
        return candidate if (candidate / "index.html").is_file() else None
    default = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    return default if (default / "index.html").is_file() else None


def data_dir() -> Path:
    """Where orca.db and the audio cache live; override with ORCA_DATA_DIR."""
    override = os.environ.get("ORCA_DATA_DIR")
    base = Path(override) if override else doctor.log_dir()
    base.mkdir(parents=True, exist_ok=True)
    return base


def get_catalog() -> CatalogSource:
    global _catalog
    if _catalog is None:
        _catalog = CatalogSource()
    return _catalog


def get_resolver() -> StreamResolver:
    global _resolver
    if _resolver is None:
        _resolver = StreamResolver()
    return _resolver


def get_storage() -> OrcaStorage:
    global _storage
    if _storage is None:
        _storage = OrcaStorage(data_dir() / "orca.db")
    return _storage


def get_exporter() -> AudioExporter:
    global _exporter
    if _exporter is None:
        get_storage()
        _exporter = AudioExporter(base_dir=Path.home() / "Music" / "Orca")
    return _exporter


def _song_dto(song: Song) -> SongDto:
    return SongDto(
        videoId=song.video_id,
        title=song.title,
        artist=song.artist,
        duration=song.duration,
        artworkUrl=song.artwork_url,
        streamUrl=None,
        type=song.type,
    )


def _dtos(songs: List[Song]) -> List[SongDto]:
    return [_song_dto(s) for s in songs if s and s.video_id]


# --------------------------------------------------------------- app factory
deps = {
    "catalog": get_catalog,
    "resolver": get_resolver,
    "storage": get_storage,
    "exporter": get_exporter,
}


def create_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI):
        manager.capture_loop(asyncio.get_running_loop())
        log.info("Orca backend %s ready (%d ws clients)", __version__, manager.count)
        yield

    app = FastAPI(title=f"{APP_NAME} Backend", version=__version__, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ------------------------------------------------------------- health
    @app.get("/api/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        version = ytdlp_version()
        return HealthResponse(
            app=APP_NAME,
            version=__version__,
            ytdlp=version,
            ytDlpAgeDays=ytdlp_age_days(version),
        )

    @app.get("/api/doctor", response_model=DoctorResponse)
    def doctor_report() -> DoctorResponse:
        return DoctorResponse(lines=doctor.collect())

    # ------------------------------------------------------------- catalog
    @app.get("/api/search", response_model=List[SongDto])
    def search(
        q: str,
        filter: Optional[str] = None,
        limit: int = 20,
        catalog: CatalogSource = Depends(deps["catalog"]),
    ) -> List[SongDto]:
        query = (q or "").strip()
        if not query:
            return []
        tunes = filter.strip().lower() if filter and filter.strip() else None
        if tunes == "all":
            tunes = None
        try:
            songs = catalog.search(query, filter_type=tunes, limit=max(1, min(limit, 50)))
        except Exception as exc:  # noqa: BLE001
            log.error("search failed for %r: %s", query, exc)
            raise HTTPException(status_code=502, detail="catalog search failed") from exc
        return _dtos(songs)

    @app.get("/api/home", response_model=HomeResponse)
    def home(
        limit: int = 10,
        catalog: CatalogSource = Depends(deps["catalog"]),
    ) -> HomeResponse:
        sections: List[HomeSection] = []
        try:
            raw = catalog.home(limit=max(1, min(limit, 20)))
            for sec in raw or []:
                if not isinstance(sec, dict):
                    continue
                title = str(sec.get("title") or "Recommended")
                tracks = []
                for t in sec.get("tracks") or []:
                    if isinstance(t, Song):
                        tracks.append(_song_dto(t))
                    elif isinstance(t, dict):
                        tracks.append(
                            SongDto(
                                videoId=str(t.get("videoId") or t.get("video_id") or ""),
                                title=str(t.get("title") or ""),
                                artist=str(t.get("artist") or ""),
                                duration=str(t.get("duration") or ""),
                                artworkUrl=str(t.get("artworkUrl") or t.get("artwork_url") or ""),
                                type=str(t.get("type") or "song"),
                            )
                        )
                tracks = [t for t in tracks if t.video_id]
                if tracks:
                    sections.append(HomeSection(title=title, tracks=tracks))
        except Exception as exc:  # noqa: BLE001
            log.error("home failed: %s", exc)
        if not sections:
            try:
                trending = catalog.search("trending music", filter_type="songs", limit=20)
                if trending:
                    sections.append(HomeSection(title="Quick Picks", tracks=_dtos(trending)))
            except Exception as exc:  # noqa: BLE001
                log.error("home fallback failed: %s", exc)
        if not sections:
            raise HTTPException(status_code=502, detail="home feed unavailable")
        return HomeResponse(sections=sections)

    @app.get("/api/similar/{video_id}", response_model=List[SongDto])
    def similar(
        video_id: str,
        limit: int = 26,
        catalog: CatalogSource = Depends(deps["catalog"]),
    ) -> List[SongDto]:
        seed = (video_id or "").strip()
        if not seed:
            return []
        try:
            songs = catalog.similar(seed, limit=max(1, min(limit, 50)))
        except Exception as exc:  # noqa: BLE001
            log.error("similar failed for %r: %s", seed, exc)
            return []
        return _dtos(songs)

    @app.get("/api/artists/top", response_model=List[SongDto])
    def top_artists(catalog: CatalogSource = Depends(deps["catalog"])) -> List[SongDto]:
        try:
            songs = catalog.top_artists()
        except Exception as exc:  # noqa: BLE001
            log.error("top_artists failed: %s", exc)
            return []
        return _dtos(songs)

    @app.get("/api/artist/{browse_id}")
    def artist_details(
        browse_id: str,
        catalog: CatalogSource = Depends(deps["catalog"]),
    ) -> Dict[str, Any]:
        try:
            return catalog.artist_details(browse_id)
        except Exception as exc:  # noqa: BLE001
            log.error("artist_details failed for %r: %s", browse_id, exc)
            raise HTTPException(status_code=502, detail="artist lookup failed") from exc

    # ------------------------------------------------------------- lyrics
    @app.get("/api/lyrics/{video_id}", response_model=LyricsResponse)
    def lyrics(
        video_id: str,
        title: str = "",
        artist: str = "",
        duration: int = 0,
        catalog: CatalogSource = Depends(deps["catalog"]),
    ) -> LyricsResponse:
        vid = (video_id or "").strip()
        synced: Optional[str] = None
        plain: Optional[str] = None
        try:
            merged = catalog.lyrics(vid, title=title, artist=artist)
            if merged:
                synced = merged
        except Exception as exc:  # noqa: BLE001
            log.error("catalog lyrics failed for %r: %s", vid, exc)
        if not synced and not plain:
            try:
                synced, plain = fetch_lrclib(title or vid, artist, duration or None)
            except Exception as exc:  # noqa: BLE001
                log.error("lrclib fetch failed for %r: %s", vid, exc)
        parsed = []
        if synced:
            parsed = [{"timeMs": ms, "text": text} for ms, text in parse_lrc(synced)]
        return LyricsResponse(videoId=vid, synced=synced, plain=plain, parsed=parsed)

    # ------------------------------------------------------------- streaming
    @app.post("/api/resolve", response_model=ResolveResponse)
    def resolve(
        body: ResolveRequest,
        resolver: StreamResolver = Depends(deps["resolver"]),
    ) -> ResolveResponse:
        video_id = (body.video_id or "").strip()
        if not video_id:
            return ResolveResponse(url="", error="Empty videoId", permanent=True)
        try:
            url, err, permanent = resolver.resolve(video_id)
        except Exception as exc:  # noqa: BLE001
            log.error("resolve failed for %r", video_id)
            return ResolveResponse(
                url="", error=_friendly_stream_error(str(exc)), permanent=False
            )
        return ResolveResponse(
            url=url or "",
            error=_friendly_stream_error(err),
            permanent=permanent,
        )

    @app.get("/api/stream/{video_id}")
    def stream_redirect(
        video_id: str,
        resolver: StreamResolver = Depends(deps["resolver"]),
    ) -> RedirectResponse:
        """Signed-URL redirect for <audio src>. Signed URLs are never logged."""
        vid = (video_id or "").strip()
        if not vid:
            raise HTTPException(status_code=400, detail="Empty videoId")
        try:
            url, err, _ = resolver.resolve(vid)
        except Exception as exc:  # noqa: BLE001
            url, err = None, str(exc)
        if not url:
            raise HTTPException(status_code=502, detail=err or "stream unavailable")
        return RedirectResponse(url=url, status_code=302)

    @app.get("/api/stream/proxy/{video_id}")
    def stream_proxy(
        video_id: str,
        request: Request,
        resolver: StreamResolver = Depends(deps["resolver"]),
    ) -> StreamingResponse:
        """Byte pass-through for environments that cannot follow the redirect."""
        vid = (video_id or "").strip()
        if not vid:
            raise HTTPException(status_code=400, detail="Empty videoId")
        try:
            url, err, _ = resolver.resolve(vid)
        except Exception as exc:  # noqa: BLE001
            url, err = None, str(exc)
        if not url:
            raise HTTPException(status_code=502, detail=err or "stream unavailable")
        upstream_headers: Dict[str, str] = {}
        range_header = request.headers.get("range")
        if range_header:
            upstream_headers["Range"] = range_header
        try:
            upstream = http_client.get(url, headers=upstream_headers, stream=True, timeout=(10, 30))
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"upstream fetch failed: {exc}") from exc

        passthrough = {
            key: upstream.headers[key]
            for key in ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges")
            if key in upstream.headers
        }
        return StreamingResponse(
            upstream.iter_content(chunk_size=64 * 1024),
            status_code=upstream.status_code,
            media_type=upstream.headers.get("Content-Type", "audio/mp4"),
            headers=passthrough,
        )

    # ------------------------------------------------------------- library
    @app.get("/api/library/favorites", response_model=FavoritesResponse)
    def favorites(storage: OrcaStorage = Depends(deps["storage"])) -> FavoritesResponse:
        songs = storage.get_favorites()
        return FavoritesResponse(favorites=_dtos(songs), ids=[s.video_id for s in songs])

    @app.post("/api/library/favorites", response_model=BroadcastResponse)
    def add_favorite(
        song: SongDto,
        storage: OrcaStorage = Depends(deps["storage"]),
    ) -> BroadcastResponse:
        storage.add_favorite(
            Song(
                video_id=song.video_id,
                title=song.title,
                artist=song.artist,
                duration=song.duration,
                artwork_url=song.artwork_url,
                type=song.type,
            )
        )
        manager.broadcast_threadsafe(
            {"type": "favorites_changed", "payload": {"videoId": song.video_id}}
        )
        return BroadcastResponse(ok=True)

    @app.delete("/api/library/favorites/{video_id}", response_model=BroadcastResponse)
    def remove_favorite(
        video_id: str,
        storage: OrcaStorage = Depends(deps["storage"]),
    ) -> BroadcastResponse:
        storage.remove_favorite(video_id)
        manager.broadcast_threadsafe(
            {"type": "favorites_changed", "payload": {"videoId": video_id}}
        )
        return BroadcastResponse(ok=True)

    @app.get("/api/library/favorites/{video_id}/status", response_model=FavoriteStatusResponse)
    def favorite_status(
        video_id: str,
        storage: OrcaStorage = Depends(deps["storage"]),
    ) -> FavoriteStatusResponse:
        return FavoriteStatusResponse(videoId=video_id, isFavorite=storage.is_favorite(video_id))

    @app.get("/api/library/history", response_model=HistoryResponse)
    def history(
        limit: int = 50,
        storage: OrcaStorage = Depends(deps["storage"]),
    ) -> HistoryResponse:
        return HistoryResponse(history=_dtos(storage.get_history(limit=max(1, min(limit, 200)))))

    @app.delete("/api/library/history", response_model=BroadcastResponse)
    def clear_history(storage: OrcaStorage = Depends(deps["storage"])) -> BroadcastResponse:
        storage.clear_history()
        manager.broadcast_threadsafe({"type": "history_cleared", "payload": {}})
        return BroadcastResponse(ok=True)

    @app.post("/api/now-playing", response_model=BroadcastResponse)
    def now_playing(
        body: NowPlayingRequest,
        storage: OrcaStorage = Depends(deps["storage"]),
    ) -> BroadcastResponse:
        """Called by the client when a track actually starts; mirrors record_history."""
        song = Song(
            video_id=body.song.video_id,
            title=body.song.title,
            artist=body.song.artist,
            duration=body.song.duration,
            artwork_url=body.song.artwork_url,
            type=body.song.type,
        )
        try:
            storage.record_history(song)
        except Exception as exc:  # noqa: BLE001
            log.error("record_history failed: %s", exc)
            return BroadcastResponse(ok=False)
        manager.broadcast_threadsafe(
            {
                "type": "now_playing",
                "payload": {
                    "videoId": song.video_id,
                    "title": song.title,
                    "artist": song.artist,
                    "artworkUrl": song.artwork_url,
                    "context": body.context,
                },
            }
        )
        return BroadcastResponse(ok=True)

    # ------------------------------------------------------------- playlists
    @app.get("/api/library/playlists", response_model=List[PlaylistSummary])
    def playlists(storage: OrcaStorage = Depends(deps["storage"])) -> List[PlaylistSummary]:
        return [
            PlaylistSummary(
                id=row["id"],
                name=row["name"],
                sourceType=row.get("source_type", "custom"),
                sourceUrl=row.get("source_url", ""),
                createdAt=str(row.get("created_at", "")),
                trackCount=row.get("track_count", 0),
            )
            for row in storage.get_playlists()
        ]

    @app.post("/api/library/playlists", response_model=PlaylistSummary)
    def create_playlist(
        body: CreatePlaylistRequest,
        storage: OrcaStorage = Depends(deps["storage"]),
    ) -> PlaylistSummary:
        pid = storage.create_playlist(
            body.name, source_type=body.source_type, source_url=body.source_url
        )
        row = storage.get_playlist(pid) or {}
        manager.broadcast_threadsafe({"type": "playlists_changed", "payload": {"id": pid}})
        return PlaylistSummary(
            id=pid,
            name=body.name,
            sourceType=body.source_type,
            sourceUrl=body.source_url,
            createdAt=str(row.get("created_at", "")),
            trackCount=0,
        )

    @app.get("/api/library/playlists/{playlist_id}", response_model=PlaylistDetail)
    def playlist_detail(
        playlist_id: int,
        storage: OrcaStorage = Depends(deps["storage"]),
    ) -> PlaylistDetail:
        row = storage.get_playlist(playlist_id)
        if not row:
            raise HTTPException(status_code=404, detail="playlist not found")
        tracks = storage.get_playlist_tracks(playlist_id)
        return PlaylistDetail(
            id=row["id"],
            name=row["name"],
            sourceType=row.get("source_type", "custom"),
            sourceUrl=row.get("source_url", ""),
            createdAt=str(row.get("created_at", "")),
            trackCount=row.get("track_count", 0),
            tracks=_dtos(tracks),
        )

    @app.delete("/api/library/playlists/{playlist_id}", response_model=BroadcastResponse)
    def delete_playlist(
        playlist_id: int,
        storage: OrcaStorage = Depends(deps["storage"]),
    ) -> BroadcastResponse:
        if not storage.delete_playlist(playlist_id):
            raise HTTPException(status_code=404, detail="playlist not found")
        manager.broadcast_threadsafe(
            {"type": "playlists_changed", "payload": {"deleted": playlist_id}}
        )
        return BroadcastResponse(ok=True)

    @app.patch("/api/library/playlists/{playlist_id}", response_model=BroadcastResponse)
    def rename_playlist(
        playlist_id: int,
        body: RenamePlaylistRequest,
        storage: OrcaStorage = Depends(deps["storage"]),
    ) -> BroadcastResponse:
        if not storage.rename_playlist(playlist_id, body.name):
            raise HTTPException(status_code=404, detail="playlist not found")
        manager.broadcast_threadsafe(
            {"type": "playlists_changed", "payload": {"renamed": playlist_id}}
        )
        return BroadcastResponse(ok=True)

    @app.post("/api/library/playlists/{playlist_id}/tracks", response_model=BroadcastResponse)
    def add_tracks(
        playlist_id: int,
        body: AddTracksRequest,
        storage: OrcaStorage = Depends(deps["storage"]),
    ) -> BroadcastResponse:
        if not storage.get_playlist(playlist_id):
            raise HTTPException(status_code=404, detail="playlist not found")
        songs = [
            Song(
                video_id=s.video_id,
                title=s.title,
                artist=s.artist,
                duration=s.duration,
                artwork_url=s.artwork_url,
                type=s.type,
            )
            for s in body.songs
            if s.video_id
        ]
        if not songs:
            raise HTTPException(status_code=400, detail="no valid tracks in payload")
        storage.add_tracks_to_playlist(playlist_id, songs)
        manager.broadcast_threadsafe(
            {"type": "playlist_tracks_changed", "payload": {"id": playlist_id}}
        )
        return BroadcastResponse(ok=True)

    @app.delete(
        "/api/library/playlists/{playlist_id}/tracks/{video_id}", response_model=BroadcastResponse
    )
    def remove_track(
        playlist_id: int,
        video_id: str,
        storage: OrcaStorage = Depends(deps["storage"]),
    ) -> BroadcastResponse:
        storage.remove_track_from_playlist(playlist_id, video_id)
        manager.broadcast_threadsafe(
            {"type": "playlist_tracks_changed", "payload": {"id": playlist_id}}
        )
        return BroadcastResponse(ok=True)

    # ------------------------------------------------------------- import / export
    @app.post("/api/import", response_model=ImportResponse)
    def import_playlist_url(
        body: ImportRequest,
        storage: OrcaStorage = Depends(deps["storage"]),
        catalog: CatalogSource = Depends(deps["catalog"]),
    ) -> ImportResponse:
        url = (body.url or "").strip()
        if not url:
            return ImportResponse(ok=False, error="Empty url")
        if not is_playlist_url(url):
            return ImportResponse(ok=False, error="Not a recognized playlist URL")
        try:
            merged = catalog.import_playlist(url)
            name = str(merged.get("name") or "Imported Playlist")
            raw_tracks = merged.get("tracks") or []
            songs: List[Song] = []
            for t in raw_tracks:
                if isinstance(t, Song):
                    songs.append(t)
                elif isinstance(t, dict):
                    vid = str(t.get("video_id") or t.get("videoId") or "")
                    if vid:
                        songs.append(
                            Song(
                                video_id=vid,
                                title=str(t.get("title") or ""),
                                artist=str(t.get("artist") or ""),
                                duration=str(t.get("duration") or ""),
                                artwork_url=str(
                                    t.get("artwork_url") or t.get("artworkUrl") or ""
                                ),
                                type=str(t.get("type") or "song"),
                            )
                        )
            songs = [s for s in songs if s.video_id]
            if not songs:
                return ImportResponse(ok=False, error="No playable tracks found")
            pid = storage.create_playlist(name, source_type="import", source_url=url)
            storage.add_tracks_to_playlist(pid, songs)
            manager.broadcast_threadsafe(
                {"type": "playlists_changed", "payload": {"imported": name}}
            )
            return ImportResponse(ok=True, name=name, playlistId=pid, tracks=_dtos(songs))
        except Exception as exc:  # noqa: BLE001
            log.error("import failed")
            return ImportResponse(ok=False, error=str(exc))

    @app.post("/api/export", response_model=ExportResponse)
    def export_track(
        body: ExportRequest,
        exporter: AudioExporter = Depends(deps["exporter"]),
    ) -> ExportResponse:
        song = Song(
            video_id=body.song.video_id,
            title=body.song.title,
            artist=body.song.artist,
            duration=body.song.duration,
            artwork_url=body.song.artwork_url,
            type=body.song.type,
        )
        if not song.video_id:
            return ExportResponse(ok=False, error="Empty videoId")
        try:
            dest = Path(body.dest) if body.dest else None
            path = exporter.export_song(song, custom_dest=dest)
            return ExportResponse(ok=True, path=str(path))
        except Exception as exc:  # noqa: BLE001
            log.error("export failed for %r", song.video_id)
            return ExportResponse(ok=False, error=str(exc))

    # ------------------------------------------------------------- websocket
    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        await manager.connect(websocket)
        try:
            await websocket.send_json(
                {"type": "hello", "payload": {"app": APP_NAME, "version": __version__}}
            )
            while True:
                raw = await websocket.receive_text()
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if msg.get("type") == "ping":
                    await websocket.send_json({"type": "pong", "payload": {}})
        except WebSocketDisconnect:
            pass
        finally:
            await manager.disconnect(websocket)

    # Signed URLs must never leak through error payloads either.
    @app.exception_handler(HTTPException)
    async def _http_error(_: Request, exc: HTTPException) -> JSONResponse:
        detail = str(exc.detail)
        if "googlevideo.com" in detail:
            detail = "upstream refused"
        return JSONResponse(status_code=exc.status_code, content={"detail": detail})

    @app.get("/api/info/tunables")
    def tunables() -> Dict[str, Any]:
        """Design tunables the UI mirrors; single source of truth stays in orca.config."""
        return {
            "searchDebounceMs": SEARCH_DEBOUNCE_MS,
            "switchTimeoutMs": SWITCH_TIMEOUT_MS,
            "streamCacheTtlS": STREAM_CACHE_TTL_S,
            "defaultCacheMaxMb": DEFAULT_CACHE_MAX_MB,
        }

    assets = static_dir()
    if assets is not None:
        app.mount("/", SPAStaticFiles(directory=assets, html=True), name="spa")
        log.info("serving frontend from %s", assets)

    return app


app = create_app()


def main() -> None:
    """Console-style launcher: `python -m orca.server`."""
    import uvicorn

    uvicorn.run("orca.server:app", host=DEFAULT_HOST, port=DEFAULT_PORT, log_level="info")


if __name__ == "__main__":
    main()
