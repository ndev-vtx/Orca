from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from orca import server as srv
from orca.models import Song


class FakeCatalog:
    def search(self, query, filter_type=None, limit=20):
        f = filter_type
        return [
            Song(video_id=f"q{i}", title=f"{query} {i}", artist="A", duration="3:00",
                 artwork_url=f"art{i}", type=f or "song")
            for i in range(min(3, limit))
        ]

    def home(self, limit=10):
        return [
            {"title": "Mix", "tracks": [
                {"videoId": "h1", "title": "Home One", "artist": "H", "duration": "2:00",
                 "artworkUrl": "a1", "type": "song"},
                {"videoId": "", "title": "broken", "artist": "H"},
            ]}
        ][: max(0, limit)]

    def similar(self, seed_id, limit=26):
        return [Song(video_id=f"s{i}", title=f"Sim {i}", artist="S") for i in range(min(2, limit))]

    def top_artists(self, country="IN"):
        return [Song(video_id="t1", title="Top Artist", artist="", type="artist")]

    def lyrics(self, video_id, title="", artist=""):
        return None

    def import_playlist(self, identifier):
        return {"name": "My Mix", "tracks": [
            {"video_id": "i1", "title": "One", "artist": "X"},
            {"video_id": "i2", "title": "Two", "artist": "X"},
        ]}


class FakeResolver:
    def __init__(self):
        self.calls = []

    def resolve(self, video_id):
        self.calls.append(video_id)
        if video_id == "boom":
            return None, "video unavailable", True
        return f"https://example.test/audio/{video_id}", "", False


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ORCA_DATA_DIR", str(tmp_path / "data"))
    srv._storage = None
    srv._catalog = None
    srv._resolver = None
    srv._exporter = None
    app = srv.create_app()
    fake_cat = FakeCatalog()
    fake_res = FakeResolver()
    app.dependency_overrides[srv.deps["catalog"]] = lambda: fake_cat
    app.dependency_overrides[srv.deps["resolver"]] = lambda: fake_res
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_health_reports_orca_branding(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["app"] == "Orca"
    assert body["status"] == "ok"


def test_search_returns_song_dtos(client):
    r = client.get("/api/search", params={"q": "lofi", "filter": "songs"})
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 3
    assert body[0]["videoId"] == "q0"
    assert body[0]["title"] == "lofi 0"


def test_home_drops_broken_tracks(client):
    r = client.get("/api/home")
    assert r.status_code == 200
    sections = r.json()["sections"]
    assert sections[0]["title"] == "Mix"
    assert [t["videoId"] for t in sections[0]["tracks"]] == ["h1"]


def test_similar_and_top_artists(client):
    assert [t["videoId"] for t in client.get("/api/similar/abc").json()] == ["s0", "s1"]
    artists = client.get("/api/artists/top").json()
    assert artists[0]["type"] == "artist"


def test_resolve_returns_signed_url_shape_only(client):
    r = client.post("/api/resolve", json={"videoId": "abc123"})
    assert r.status_code == 200
    body = r.json()
    assert body["url"].endswith("/abc123")
    assert body["error"] == ""
    assert body["permanent"] is False


def test_resolve_reports_error_without_url(client):
    body = client.post("/api/resolve", json={"videoId": "boom"}).json()
    assert body["url"] == ""
    assert body["error"] == "YouTube reports this track as unavailable"
    assert body["permanent"] is True


def test_resolve_error_carries_extraction_trail(client):
    import orca.stream as stream_mod

    stream_mod.DEBUG_TAIL.append("[orca] profile web_music: failed (Requested format is not available)")
    body = client.post("/api/resolve", json={"videoId": "boom"}).json()
    assert any("[orca] profile web_music" in line for line in body["trail"])


def test_stream_redirect_follows_resolver(client):
    r = client.get("/api/stream/abc123", follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"].startswith("https://example.test/audio/")


def test_stream_redirect_error_is_sanitized(client):
    r = client.get("/api/stream/boom", follow_redirects=False)
    assert r.status_code == 502


def test_googlevideo_detail_never_leaks(tmp_path, monkeypatch):
    monkeypatch.setenv("ORCA_DATA_DIR", str(tmp_path / "data"))
    srv._storage = None

    class LeakResolver(FakeResolver):
        def resolve(self, video_id):
            raise RuntimeError("https://rr3---sn.googlevideo.com/videoplayback?signed")

    app = srv.create_app()
    app.dependency_overrides[srv.deps["resolver"]] = lambda: LeakResolver()
    c = TestClient(app)
    r = c.get("/api/stream/xyz", follow_redirects=False)
    assert "googlevideo" not in r.text
    assert r.json()["detail"] == "upstream refused"


def test_favorites_roundtrip(client):
    assert client.get("/api/library/favorites").json()["ids"] == []
    song = {"videoId": "fav1", "title": "Keep", "artist": "Me", "duration": "1:00",
            "artworkUrl": "u", "type": "song"}
    assert client.post("/api/library/favorites", json=song).json()["ok"] is True
    assert client.get("/api/library/favorites").json()["ids"] == ["fav1"]
    status = client.get("/api/library/favorites/fav1/status").json()
    assert status == {"videoId": "fav1", "isFavorite": True}
    client.delete("/api/library/favorites/fav1")
    assert client.get("/api/library/favorites").json()["ids"] == []


def test_now_playing_records_history(client):
    song = {"videoId": "p1", "title": "Played", "artist": "Me", "duration": "2:00",
            "artworkUrl": "u", "type": "song"}
    assert client.post("/api/now-playing", json={"song": song, "context": "radio"}).json()["ok"]
    history = client.get("/api/library/history").json()["history"]
    assert history[0]["videoId"] == "p1"
    client.delete("/api/library/history")
    assert client.get("/api/library/history").json()["history"] == []


def test_playlist_crud_flow(client):
    created = client.post(
        "/api/library/playlists", json={"name": "Road Trip", "sourceType": "custom"}
    ).json()
    pid = created["id"]
    songs = {"songs": [{"videoId": "t1", "title": "One", "artist": "X", "type": "song"}]}
    assert client.post(f"/api/library/playlists/{pid}/tracks", json=songs).json()["ok"]
    detail = client.get(f"/api/library/playlists/{pid}").json()
    assert detail["trackCount"] == 1
    assert detail["tracks"][0]["videoId"] == "t1"
    assert client.patch(f"/api/library/playlists/{pid}", json={"name": "Highway"}).json()["ok"]
    assert client.get(f"/api/library/playlists/{pid}").json()["name"] == "Highway"
    assert client.delete(f"/api/library/playlists/{pid}/tracks/t1").json()["ok"]
    assert client.get(f"/api/library/playlists/{pid}").json()["trackCount"] == 0
    assert client.delete(f"/api/library/playlists/{pid}").json()["ok"]
    assert client.get("/api/library/playlists/999").status_code == 404


def test_import_creates_playlist(client):
    body = client.post("/api/import", json={"url": "https://open.spotify.com/playlist/abc"})
    assert body.status_code == 200
    data = body.json()
    assert data["ok"] is True
    assert data["name"] == "My Mix"
    assert data["playlistId"] is not None
    listing = client.get("/api/library/playlists").json()
    assert listing[0]["sourceType"] == "import"


def test_import_rejects_non_playlist_url(client):
    data = client.post("/api/import", json={"url": "hello world"}).json()
    assert data["ok"] is False
    assert "Not a recognized" in data["error"]


def test_tunables_expose_shared_constants(client):
    body = client.get("/api/info/tunables").json()
    assert body["searchDebounceMs"] == 350
    assert body["defaultCacheMaxMb"] == 500


def test_storage_singleton_uses_orca_db_filename(client, tmp_path):
    client.get("/api/library/favorites")
    assert (tmp_path / "data" / "orca.db").exists()


def test_ws_hello_and_pong(client):
    with client.websocket_connect("/ws") as ws:
        hello = ws.receive_json()
        assert hello["type"] == "hello"
        assert hello["payload"]["app"] == "Orca"
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"


def test_track_detail_never_returns_null_song(client):
    """
    A bot-flagged get_song payload (no videoDetails) must still produce a
    usable song so the track page opens instead of rendering an error.
    """
    from orca.catalog import CatalogSource

    class BotFlaggedApi:
        def get_song(self, video_id):
            return {"playabilityStatus": {"status": "LOGIN_REQUIRED"}}

    broken = CatalogSource.__new__(CatalogSource)
    broken.api = BotFlaggedApi()
    client.app.dependency_overrides[srv.deps["catalog"]] = lambda: broken
    try:
        r = client.get("/api/track/kJQP7kiw5Fk")
        assert r.status_code == 200
        body = r.json()
        assert body["song"] is not None
        assert body["song"]["videoId"] == "kJQP7kiw5Fk"
        assert body["song"]["artworkUrl"] == "https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg"
    finally:
        client.app.dependency_overrides.pop(srv.deps["catalog"], None)


def test_track_detail_survives_catalog_exception(client):
    """Even a hard catalog failure returns a minimal playable detail (no 404)."""
    from orca.catalog import CatalogSource

    class ExplodingApi:
        def get_song(self, video_id):
            raise RuntimeError("network down")

    broken = CatalogSource.__new__(CatalogSource)
    broken.api = ExplodingApi()
    client.app.dependency_overrides[srv.deps["catalog"]] = lambda: broken
    try:
        r = client.get("/api/track/abc123XYZ_-")
        assert r.status_code == 200
        body = r.json()
        assert body["song"]["videoId"] == "abc123XYZ_-"
        assert body["title"] == "Unknown track"
    finally:
        client.app.dependency_overrides.pop(srv.deps["catalog"], None)
