"""
schemas.py
Wire shapes for the Orca backend API. Deliberately mirrors the field names the
legacy desktop panel already serialized (`videoId`, `title`, `artist`, ...) so
the web and any future clients speak one contract.
"""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class SongDto(BaseModel):
    """One playable track, exactly `Song.to_dict()` plus camelCase aliases."""

    video_id: str = Field(alias="videoId")
    title: str
    artist: str = ""
    duration: str = ""
    artwork_url: str = Field(default="", alias="artworkUrl")
    stream_url: Optional[str] = Field(default=None, alias="streamUrl")
    type: str = "song"

    model_config = {"populate_by_name": True}


class ResolveRequest(BaseModel):
    video_id: str = Field(alias="videoId", min_length=1)
    model_config = {"populate_by_name": True}


class ResolveResponse(BaseModel):
    url: str
    format: str = "audio/mp4"
    error: str = ""
    permanent: bool = False
    trail: List[str] = []


class ResolveProxyResponse(BaseModel):
    proxy_url: str = Field(alias="proxyUrl")
    format: str = "audio/mp4"
    error: str = ""
    model_config = {"populate_by_name": True}


class NowPlayingRequest(BaseModel):
    """Client event fired once when a track actually starts playing."""

    song: SongDto
    context: str = "manual"


class BroadcastResponse(BaseModel):
    ok: bool = True


class PlaylistSummary(BaseModel):
    id: int
    name: str
    source_type: str = Field(alias="sourceType")
    source_url: str = Field(default="", alias="sourceUrl")
    created_at: str = Field(default="", alias="createdAt")
    track_count: int = Field(default=0, alias="trackCount")
    model_config = {"populate_by_name": True}


class PlaylistDetail(PlaylistSummary):
    tracks: List[SongDto] = []


class CreatePlaylistRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    source_type: str = Field(default="custom", alias="sourceType")
    source_url: str = Field(default="", alias="sourceUrl")
    model_config = {"populate_by_name": True}


class RenamePlaylistRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class AddTracksRequest(BaseModel):
    songs: List[SongDto]


class FavoriteStatusResponse(BaseModel):
    video_id: str = Field(alias="videoId")
    is_favorite: bool = Field(alias="isFavorite")
    model_config = {"populate_by_name": True}


class FavoritesResponse(BaseModel):
    favorites: List[SongDto]
    ids: List[str]


class HistoryResponse(BaseModel):
    history: List[SongDto]


class ImportRequest(BaseModel):
    url: str = Field(min_length=1)


class ImportResponse(BaseModel):
    ok: bool
    name: str = ""
    playlist_id: Optional[int] = Field(default=None, alias="playlistId")
    tracks: List[SongDto] = []
    error: str = ""
    model_config = {"populate_by_name": True}


class ExportRequest(BaseModel):
    song: SongDto
    dest: Optional[str] = None


class ExportResponse(BaseModel):
    ok: bool
    path: str = ""
    error: str = ""


class HomeSection(BaseModel):
    title: str
    tracks: List[SongDto]


class HomeResponse(BaseModel):
    sections: List[HomeSection]


class LyricsResponse(BaseModel):
    video_id: str = Field(alias="videoId")
    synced: Optional[str] = None
    plain: Optional[str] = None
    parsed: List[dict] = []
    error: str = ""
    model_config = {"populate_by_name": True}


class HealthResponse(BaseModel):
    status: str = "ok"
    app: str
    version: str
    ytdlp: str
    ytldp_age_days: Optional[int] = Field(default=None, alias="ytDlpAgeDays")
    model_config = {"populate_by_name": True}


class DoctorResponse(BaseModel):
    lines: List[str]
