"""
test_catalog_filter.py
Junk/low-quality filtering for YouTube Music feeds.
"""

from orca.catalog import Song, _clean_songs, _duration_seconds, _is_junk


def song(title: str, duration: str = "3:45") -> Song:
    return Song(video_id="v" + str(abs(hash(title)) % 10**8), title=title, artist="A", duration=duration)


def test_shorts_are_dropped():
    assert _is_junk(song("Shorts Featured Section VN", "0:45"))
    # "clip" is no longer a title-drop term (M2); this dies on duration alone.
    assert _is_junk(song("funny clip", "1:10"))


def test_normal_tracks_survive():
    assert not _is_junk(song("Midnight City", "4:03"))
    assert not _is_junk(song("Remember The Time", "3:59"))


def test_clip_in_title_is_not_a_drop_term():
    """M2: legitimate songs can carry the word — the <90s duration rule
    already catches actual short clips."""
    assert not _is_junk(song("Paper Clips", "3:10"))
    assert not _is_junk(song("Clip My Wings", "4:00"))


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


def test_reaction_and_status_clips_are_dropped():
    assert _is_junk(song("Song X REACTION !!!!", "12:00"))
    assert _is_junk(song("Romantic status video 2026", "0:59"))
    assert _is_junk(song("WhatsApp status song", "1:30"))


def test_remix_titles_are_demoted_not_dropped():
    clean = song("Levitating")
    remix = song("Levitating (remix)")
    out = _clean_songs([remix, clean])
    assert out[0].title == "Levitating"
    assert len(out) == 2


def test_remember_and_members_only_untouched():
    assert not _is_junk(song("Members Only", "3:21"))
    assert not _is_junk(song("I Remember You", "3:10"))


def test_podcast_episodes_are_dropped():
    from orca.catalog import CatalogSource

    episode = CatalogSource._build(
        {"videoId": "pod1", "title": "All I want for Christmas is you! - December 22nd", "resultType": "episode"}
    )
    assert episode is None
    home_podcast = CatalogSource._build(
        {"videoId": "pod2", "title": "Music talk #12", "category": "Episodes for you"}
    )
    assert home_podcast is None


def test_allcaps_spam_artist_is_demoted_not_dropped():
    from orca.catalog import _spam_penalty

    clean = Song(video_id="a", title="All I Want for Christmas Is You", artist="Mariah Carey", duration="4:02")
    spam = Song(video_id="b", title="All I Want for Christmas Is You", artist="BBY WOW", duration="3:55")
    assert _spam_penalty(spam) >= 3
    assert _spam_penalty(clean) == 0
    out = _clean_songs([spam, clean])
    assert out[0].artist == "Mariah Carey"
    # Demoted but still present.
    assert any(s.artist == "BBY WOW" for s in out)


def test_short_allcaps_artists_not_penalized():
    from orca.catalog import _spam_penalty

    assert _spam_penalty(Song(video_id="c", title="Dynamite", artist="BTS", duration="3:19")) == 0


def test_video_results_rank_below_catalog_songs():
    clean = Song(video_id="d", title="All I Want for Christmas Is You", artist="Mariah Carey", duration="4:02", type="song")
    ugc = Song(video_id="e", title="All I Want for Christmas Is You", artist="Mariah Carey", duration="4:57", type="video")
    out = _clean_songs([ugc, clean])
    assert out[0].type == "song"
    assert any(s.type == "video" for s in out)


def test_podcast_interview_vlog_titles_are_junk():
    assert _is_junk(song("Podcast episode 42 - interview with a producer", "55:12"))
    assert _is_junk(song("My Thailand vlog day 3", "12:04"))
    assert not _is_junk(song("Podcast", "3:45") if False else song("A Real Song", "3:45"))


def test_speed_up_and_daycore_demoted():
    assert _clean_songs([song("Song (speed up)"), song("Song")])[0].title == "Song"
    assert _clean_songs([song("Song daycore"), song("Song")])[0].title == "Song"


def test_album_tracks_get_album_cover():
    import unittest.mock as mock
    from orca.catalog import CatalogSource

    source = CatalogSource.__new__(CatalogSource)
    source.api = mock.Mock()
    source.api.get_album.return_value = {
        "title": "Ocean",
        "artists": [{"name": "Kai"}],
        "year": "2025",
        "thumbnails": [{"width": 64, "url": "small.jpg"}, {"width": 640, "url": "big.jpg"}],
        "tracks": [
            {"videoId": "t1", "title": "Wave One", "duration": "3:10"},
            {"videoId": "t2", "title": "Wave Two", "duration": "3:20"},
        ],
    }
    result = source.album("MPREb123")
    assert result["cover"] == "big.jpg"
    assert all(t.artwork_url == "big.jpg" for t in result["tracks"])
    assert [t.title for t in result["tracks"]] == ["Wave One", "Wave Two"]
