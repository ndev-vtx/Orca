"""Tests for artist-name resolution (_artist_line and helpers)."""

from orca.catalog import _artist_from_title, _artist_line, _clean_artist_name


def test_topic_suffix_stripped():
    assert _clean_artist_name("Ngot - Topic") == "Ngot"
    assert _clean_artist_name("ArtistVEVO") == "Artist"


def test_artists_list_joined():
    item = {"artists": [{"name": "A"}, {"name": "B - Topic"}]}
    assert _artist_line(item) == "A, B"


def test_placeholder_collapses_to_unknown():
    assert _artist_line({}) == "unknown artist"
    assert _artist_line({"artist": "Unknown artist"}) == "unknown artist"


def test_author_and_subtitle_fallbacks():
    assert _artist_line({"author": "Someone - Topic"}) == "Someone"
    assert _artist_line({"subtitle": "Other"}) == "Other"


def test_artist_parsed_from_title():
    assert _artist_line({"title": "S\u00e1ng M\u00e2y - Ng\u00f4 Lan H\u01b0\u01a1ng"}) == "S\u00e1ng M\u00e2y"
    assert _artist_from_title("Just a plain title") == ""
    assert _artist_from_title("https://x.com - thing") == ""
    assert _artist_from_title("Very long left side that exceeds the sixty character limit for names obviously - Title") == ""
