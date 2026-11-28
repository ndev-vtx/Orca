import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type AlbumResponse } from "../services/api";
import { ambientGradient, useAmbientColor } from "../utils/ambient";
import TopBar from "../components/TopBar";
import { PlayIcon } from "../components/Icons";
import { MusicTile } from "../components/Shared";
import { usePlayerStore } from "../state/player";
import { TrackRow } from "./TrackPage";

export default function AlbumPage() {
  const { browseId } = useParams();
  const [album, setAlbum] = useState<AlbumResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const play = usePlayerStore((s) => s.play);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setAlbum(null);
    setError("");
    api
      .album(browseId ?? "")
      .then((data) => {
        if (live) setAlbum(data);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : "Album could not be loaded");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [browseId]);

  const tracks = album?.tracks ?? [];

  /* Spotify-style header glow from the album cover. */
  const ambient = useAmbientColor(album?.cover ?? null);
  const heroStyle = useMemo(() => {
    const gradient = ambientGradient(ambient);
    return gradient ? { background: gradient } : undefined;
  }, [ambient]);

  return (
    <div className="page">
      <TopBar title={album?.title ?? "Album"} />
      <div className="page__hero" style={heroStyle} />
      <div className="page__body">
        {loading && <p className="page__note">Opening the album…</p>}
        {error && <p className="page__error">{error}</p>}
        {album && (
          <>
            <div className="albumhead">
              {album.cover ? (
                <img className="albumhead__cover" src={album.cover} alt={album.title} loading="lazy" />
              ) : (
                <MusicTile seed={album.title} size={160} />
              )}
              <div className="albumhead__meta">
                <p className="albumhead__kicker">Album</p>
                <h1 className="albumhead__title">{album.title}</h1>
                <p className="albumhead__sub">
                  {album.artist}
                  {album.year ? ` · ${album.year}` : ""} · {tracks.length}{" "}
                  {tracks.length === 1 ? "track" : "tracks"}
                </p>
                {tracks.length > 0 && (
                  <button className="albumhead__play" onClick={() => play(tracks, 0, `album:${album.browseId}`)}>
                    <PlayIcon size={16} />
                    Play album
                  </button>
                )}
              </div>
            </div>
            <div className="tracktable">
              {tracks.map((t, i) => (
                <TrackRow
                  key={`${t.videoId}-${i}`}
                  track={t}
                  index={i}
                  onPlay={() => play(tracks, i, `album:${album.browseId}`)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
