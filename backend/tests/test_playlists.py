"""Tests for Orca's Playlists feature (storage and import flow)."""

import os
import tempfile
from unittest.mock import MagicMock, patch
import pytest
from orca.models import Song
from orca.storage import OrcaStorage
from orca.importer import parse_youtube_playlist, fetch_spotify_tracks
from orca.catalog import CatalogSource


@pytest.fixture
def temp_storage():
    with tempfile.TemporaryDirectory() as tmp_dir:
        db_path = os.path.join(tmp_dir, "test_playlists.db")
        storage = OrcaStorage(db_path=db_path)
        yield storage


def test_playlist_creation_and_retrieval(temp_storage):
    pl_id = temp_storage.create_playlist("Chill Vibes", source_type="custom")
    assert pl_id > 0

    pl = temp_storage.get_playlist(pl_id)
    assert pl is not None
    assert pl["name"] == "Chill Vibes"
    assert pl["source_type"] == "custom"
    assert pl["track_count"] == 0

    playlists = temp_storage.get_playlists()
    assert len(playlists) == 1
    assert playlists[0]["id"] == pl_id
    assert playlists[0]["name"] == "Chill Vibes"


def test_playlist_add_tracks_and_duplicates(temp_storage):
    pl_id = temp_storage.create_playlist("Workout", source_type="custom")

    song1 = Song("s1", "Song One", "Artist A", duration="3:15")
    song2 = Song("s2", "Song Two", "Artist B", duration="4:20")
    song3 = Song("s1", "Song One Duplicate", "Artist A", duration="3:15")

    temp_storage.add_tracks_to_playlist(pl_id, [song1, song2, song3])

    tracks = temp_storage.get_playlist_tracks(pl_id)
    assert len(tracks) == 2
    assert tracks[0].video_id == "s1"
    assert tracks[0].title == "Song One"
    assert tracks[1].video_id == "s2"

    pl = temp_storage.get_playlist(pl_id)
    assert pl["track_count"] == 2


def test_playlist_remove_track_and_recompact(temp_storage):
    pl_id = temp_storage.create_playlist("Favorites 2", source_type="custom")
    songs = [
        Song(f"v_{i}", f"Track {i}", "Artist", duration="3:00")
        for i in range(5)
    ]
    temp_storage.add_tracks_to_playlist(pl_id, songs)
    assert len(temp_storage.get_playlist_tracks(pl_id)) == 5

    # Remove track 2 (v_2)
    temp_storage.remove_track_from_playlist(pl_id, "v_2")
    remaining = temp_storage.get_playlist_tracks(pl_id)
    assert len(remaining) == 4
    vids = [s.video_id for s in remaining]
    assert "v_2" not in vids
    assert vids == ["v_0", "v_1", "v_3", "v_4"]


def test_playlist_rename_and_deletion_cascade(temp_storage):
    pl_id = temp_storage.create_playlist("Old Name", source_type="custom")
    songs = [Song("x1", "Track 1", "Artist")]
    temp_storage.add_tracks_to_playlist(pl_id, songs)

    # Rename
    renamed = temp_storage.rename_playlist(pl_id, "New Name")
    assert renamed is True
    pl = temp_storage.get_playlist(pl_id)
    assert pl["name"] == "New Name"

    # Delete
    deleted = temp_storage.delete_playlist(pl_id)
    assert deleted is True
    assert temp_storage.get_playlist(pl_id) is None
    assert len(temp_storage.get_playlists()) == 0
    assert len(temp_storage.get_playlist_tracks(pl_id)) == 0


def test_importer_title_extraction_youtube():
    mock_data = {
        "title": "Late Night Lo-Fi Beats",
        "entries": [
            {
                "id": "abc12345678",
                "title": "Midnight Rain",
                "uploader": "Chill Artist",
                "duration": 225,
                "thumbnails": [{"url": "http://thumb.jpg"}],
            }
        ],
    }
    with patch("yt_dlp.YoutubeDL") as mock_ydl_cls:
        instance = MagicMock()
        instance.extract_info.return_value = mock_data
        mock_ydl_cls.return_value.__enter__.return_value = instance

        title, songs = parse_youtube_playlist("https://youtube.com/playlist?list=PL123")
        assert title == "Late Night Lo-Fi Beats"
        assert len(songs) == 1
        assert songs[0].title == "Midnight Rain"
        assert songs[0].artist == "Chill Artist"
        assert songs[0].duration == "3:45"