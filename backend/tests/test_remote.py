"""
test_remote.py
Public-mirror stream sourcing: instance-list parsing, audio pick ranking,
ladder orchestration and the resolve() integration point.
"""

import pytest

import orca.remote as remote


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in (
        "ORCA_REMOTE_SOURCES",
        "ORCA_PIPED_INSTANCES",
        "ORCA_INVIDIOUS_INSTANCES",
        "ORCA_COBALT_INSTANCES",
    ):
        monkeypatch.delenv(name, raising=False)


def test_enabled_by_default_and_off_switch(monkeypatch):
    assert remote.enabled() is True
    monkeypatch.setenv("ORCA_REMOTE_SOURCES", "off")
    assert remote.enabled() is False


def test_instance_lists_default_and_env_override(monkeypatch):
    assert remote._instances("ORCA_PIPED_INSTANCES", remote.PIPES_DEFAULT)[0] == "https://pipedapi.kavin.rocks"
    monkeypatch.setenv("ORCA_PIPED_INSTANCES", "https://a.example , https://b.example/")
    assert remote._instances("ORCA_PIPED_INSTANCES", remote.PIPES_DEFAULT) == [
        "https://a.example",
        "https://b.example",
    ]


def test_pick_piped_audio_prefers_mp4_then_bitrate():
    best = remote._pick_piped_audio(
        [
            {"url": "https://x/opus", "mimeType": "audio/webm; codecs=opus", "bitrate": 160000},
            {"url": "https://x/low", "mimeType": "audio/mp4; codecs=mp4a.40.2", "bitrate": 48000},
            {"url": "https://x/best", "mimeType": "audio/mp4; codecs=mp4a.40.2", "bitrate": 128000},
            {"url": "", "mimeType": "audio/mp4", "bitrate": 999},
        ]
    )
    assert best["url"] == "https://x/best"


def test_pick_piped_audio_empty_when_no_urls():
    assert remote._pick_piped_audio([{"mimeType": "audio/mp4"}]) is None


def test_fetch_remote_stream_walks_ladder_in_order(monkeypatch):
    calls = []

    def piped(vid, instances, deadline):
        calls.append("piped")
        return None

    def invidious(vid, instances, deadline):
        calls.append("invidious")
        return "https://proxy.example/videoplayback"

    def cobalt(vid, instances, deadline):
        calls.append("cobalt")
        return None

    monkeypatch.setattr(remote, "_via_piped", piped)
    monkeypatch.setattr(remote, "_via_invidious", invidious)
    monkeypatch.setattr(remote, "_via_cobalt", cobalt)

    url, via = remote.fetch_remote_stream("abc123")
    assert url == "https://proxy.example/videoplayback"
    assert via == "invidious"
    assert calls == ["piped", "invidious"]


def test_fetch_remote_stream_reports_total_failure(monkeypatch):
    for name in ("_via_piped", "_via_invidious", "_via_cobalt"):
        monkeypatch.setattr(remote, name, lambda vid, inst, deadline: None)
    url, via = remote.fetch_remote_stream("abc123")
    assert url is None
    assert via == "no public instance could serve this track"


def test_resolve_uses_remote_layer_before_ytdlp(monkeypatch):
    from orca.stream import StreamResolver

    resolver = StreamResolver()
    called = {}

    def fake_fetch(video_id):
        called["video_id"] = video_id
        return "https://pipedproxy.example/stream.m4a", "piped"

    monkeypatch.setattr("orca.remote.fetch_remote_stream", fake_fetch)
    monkeypatch.setattr("orca.remote.enabled", lambda: True)

    def explode(self, *_a, **_k):
        raise AssertionError("yt-dlp ladder must not run when a mirror serves audio")

    monkeypatch.setattr(StreamResolver, "_probe", explode)

    url, err, permanent = resolver.resolve("xyz789")
    assert called == {"video_id": "xyz789"}
    assert url == "https://pipedproxy.example/stream.m4a"
    assert err == ""
    assert permanent is False


def test_resolve_falls_through_to_ytdlp_when_mirrors_fail(monkeypatch):
    from orca.stream import StreamResolver

    monkeypatch.setattr("orca.remote.fetch_remote_stream", lambda vid: (None, "reason"))
    monkeypatch.setattr("orca.remote.enabled", lambda: True)
    monkeypatch.setattr(
        StreamResolver, "_probe", lambda self, vid, max_attempts=2: {"url": "https://yt.example/audio", "acodec": "mp4a"}
    )

    resolver = StreamResolver()
    url, err, _ = resolver.resolve("xyz789")
    assert url == "https://yt.example/audio"
    assert err == ""
