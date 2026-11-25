from __future__ import annotations

from unittest.mock import MagicMock, patch

from orca.lyrics import clean_title, fetch_lrclib, find_active_index, parse_lrc


LRC = (
    "[00:01.00]first line\n"
    "[00:03.50]second line\n"
    "[01:02.25]third line\n"
)


def test_clean_title_strips_noise():
    assert clean_title("Song (Official Video)") == "Song"
    assert clean_title("Song [Lyrics]") == "Song"


def test_parse_lrc_timestamps_are_milliseconds():
    lines = parse_lrc(LRC)
    assert lines[0] == (1000, "first line")
    assert lines[1] == (3500, "second line")
    assert lines[2] == (62250, "third line")


def test_find_active_index_walks_forward_and_backward():
    lines = parse_lrc(LRC)
    assert find_active_index(lines, 0) == -1
    assert find_active_index(lines, 1000) == 0
    assert find_active_index(lines, 3600) == 1
    assert find_active_index(lines, 100000) == 2


def test_fetch_lrclib_returns_both_forms():
    resp = MagicMock()
    resp.status_code = 200
    resp.json.return_value = {
        "syncedLyrics": LRC,
        "plainLyrics": "first line\nsecond line",
    }
    with patch("orca.lyrics.requests.get", return_value=resp) as get:
        synced, plain = fetch_lrclib("Song (Official Video)", "Artist", 180)
    assert synced == LRC.rstrip("\n")
    assert plain == "first line\nsecond line"
    params = get.call_args.kwargs["params"]
    assert params["track_name"] == "Song"
    assert params["duration"] == 180


def test_fetch_lrclib_failure_is_none_not_crash():
    resp = MagicMock()
    resp.status_code = 503
    with patch("orca.lyrics.requests.get", return_value=resp):
        assert fetch_lrclib("X", "Y") == (None, None)
