"""
test_catalog_filter.py
Junk/low-quality filtering for YouTube Music feeds.
"""

from orca.catalog import Song, _clean_songs, _duration_seconds, _is_junk


def song(title: str, duration: str = "3:45") -> Song:
    return Song(video_id="v" + str(abs(hash(title)) % 10**8), title=title, artist="A", duration=duration)


def test_shorts_are_dropped():
    assert _is_junk(song("Shorts Featured Section VN", "0:45"))
    assert _is_junk(song("funny clip", "1:10"))


def test_normal_tracks_survive():
    assert not _is_junk(song("Midnight City", "4:03"))
    assert not _is_junk(song("Remember The Time", "3:59"))


def test_spam_titles_are_demoted_not_dropped():
    clean = song("Blinding Lights")
    spam = song("Blinding Lights (sped up)")
    out = _clean_songs([spam, clean])
    assert out[0].title == "Blinding Lights"


def test_duration_seconds_parses_both_shapes():
    assert _duration_seconds("3:05") == 185
    assert _duration_seconds("1:02:30") == 3750
    assert _duration_seconds("") == 0


def test_clean_songs_keeps_order_for_clean_titles():
    a, b = song("A", "3:00"), song("B", "4:00")
    assert _clean_songs([a, b]) == [a, b]
