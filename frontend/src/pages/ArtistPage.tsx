/*
 * ArtistPage.tsx
 * Artist detail view for /artist/:browseId: round portrait hero with the
 * Spotify-style ambient glow, name + description, popular tracks (the
 * artist's top songs, playable as a set), and Albums / Singles card grids.
 * Reached from artist cards in Search results (MediaCard artist branch) —
 * channel browse ids (UC…) must never be treated as playable video ids.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../services/api";
import type { ArtistDetail } from "../types";
import TopBar from "../components/TopBar";
import MediaCard from "../components/MediaCard";
import { PauseIcon, PlayIcon, ShuffleIcon } from "../components/Icons";
import { MusicTile } from "../components/Shared";
import { TrackRow } from "./TrackPage";
import { usePlayerStore } from "../state/player";
import { ambientGradient, useAmbientColor } from "../utils/ambient";

export default function ArtistPage() {
  const { browseId } = useParams();
  const [detail, setDetail] = useState<ArtistDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const play = usePlayerStore((s) => s.play);
  const setShuffle = usePlayerStore((s) => s.setShuffle);
  const toggle = usePlayerStore((s) => s.toggle);
  const currentId = usePlayerStore((s) => s.current?.videoId ?? null);
  const playing = usePlayerStore((s) => s.playing);

  useEffect(() => {
    if (!browseId) return;
    let live = true;
    setLoading(true);
    setDetail(null);
    setError("");
    api
      .artist(browseId)
      .then((d) => {
        if (live) setDetail(d);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : "Artist could not be loaded");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [browseId]);

  const image = detail?.image || "";
  const ambient = useAmbientColor(image || null);
  const heroStyle = useMemo(() => {
    const gradient = ambientGradient(ambient);
    return gradient ? { background: gradient } : undefined;
  }, [ambient]);

  const songs = detail?.songs ?? [];
  const isCurrentArtistPlaying = playing && songs.some((t) => t.videoId === currentId);

  const playAll = (shuffle = false) => {
    if (songs.length === 0) return;
    setShuffle(shuffle);
    if (shuffle) {
      const start = Math.floor(Math.random() * songs.length);
      play(songs, start, `artist:${detail?.browseId ?? browseId}`);
    } else {
      play(songs, 0, `artist:${detail?.browseId ?? browseId}`);
    }
  };

  return (
    <div className="page">
      <TopBar title={detail?.name ?? "Artist"} />
      <div className="page__hero" style={heroStyle} />
      <div className="page__body">
        {loading && !detail && <p className="page__note">Opening the artist…</p>}
        {error && !detail && (
          <>
            <p className="page__error">{error}</p>
            <p className="page__note">
              Search for the artist by name instead — their music is still reachable.
            </p>
          </>
        )}
        {detail && (
          <>
            <div className="artisthead">
              {image ? (
                <img className="artisthead__photo" src={image} alt={detail.name} />
              ) : (
                <MusicTile seed={detail.name} size={180} />
              )}
              <div className="artisthead__meta">
                <p className="trackhead__badge">Artist</p>
                <h1 className="artisthead__name" title={detail.name}>
                  {detail.name}
                </h1>
                {detail.description && (
                  <p className="artisthead__desc">{detail.description}</p>
                )}
                <div className="trackhead__actions">
                  <button
                    className="btn-play"
                    aria-label={isCurrentArtistPlaying ? "Pause" : "Play"}
                    onClick={() => (isCurrentArtistPlaying ? toggle() : playAll(false))}
                  >
                    {isCurrentArtistPlaying ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
                  </button>
                  <button
                    className="pill"
                    onClick={() => playAll(true)}
                    title="Shuffle this artist's tracks"
                  >
                    <ShuffleIcon size={15} /> Shuffle
                  </button>
                </div>
              </div>
            </div>

            <section className="artistsection">
              <h2 className="section__title">Popular</h2>
              {songs.length === 0 ? (
                <p className="page__note">No tracks listed for this artist right now.</p>
              ) : (
                <div className="tracktable">
                  {songs.slice(0, 10).map((t, i) => (
                    <TrackRow
                      key={t.videoId}
                      track={t}
                      index={i}
                      onPlay={() => play(songs, i, `artist:${detail.browseId}`)}
                    />
                  ))}
                </div>
              )}
            </section>

            {detail.albums.length > 0 && (
              <section className="artistsection">
                <h2 className="section__title">Albums</h2>
                <div className="page__grid">
                  {detail.albums.map((a) => (
                    <MediaCard key={a.videoId} song={a} />
                  ))}
                </div>
              </section>
            )}

            {detail.singles.length > 0 && (
              <section className="artistsection">
                <h2 className="section__title">Singles</h2>
                <div className="page__grid">
                  {detail.singles.map((a) => (
                    <MediaCard key={a.videoId} song={a} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
