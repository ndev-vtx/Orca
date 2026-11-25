import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../services/api";
import type { PlaylistDetail } from "../types";
import TopBar from "../components/TopBar";
import { PlayIcon, PauseIcon, HeartIcon, HeartOutlineIcon, TrashIcon } from "../components/Icons";
import { MusicTile } from "../components/Shared";
import { useLibraryStore } from "../state/libraryStore";
import { usePlayerStore } from "../state/player";

export default function PlaylistPage() {
  const { id } = useParams();
  const playlistId = Number(id);
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [error, setError] = useState("");
  const savedIds = useLibraryStore((s) => s.savedIds);
  const toggleSaved = useLibraryStore((s) => s.toggleSaved);
  const deletePlaylist = useLibraryStore((s) => s.deletePlaylist);
  const play = usePlayerStore((s) => s.play);
  const currentId = usePlayerStore((s) => s.current?.videoId ?? null);
  const playing = usePlayerStore((s) => s.playing);

  const playAll = () => {
    if (!detail || detail.tracks.length === 0) return;
    play(detail.tracks, 0, `playlist:${detail.name}`);
  };

  const playRow = (index: number) => {
    if (!detail) return;
    play(detail.tracks, index, `playlist:${detail.name}`);
  };

  useEffect(() => {
    if (!Number.isFinite(playlistId)) return;
    let live = true;
    api
      .playlist(playlistId)
      .then((d) => {
        if (live) setDetail(d);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : "Playlist unavailable");
      });
    return () => {
      live = false;
    };
  }, [playlistId]);

  const savedCount = detail ? detail.tracks.filter((t) => savedIds.has(t.videoId)).length : 0;

  return (
    <div className="page">
      <TopBar title={detail?.name ?? "Playlist"} />
      <div className="page__hero page__hero--tall" />
      <div className="page__body">
        <div className="page__header">
          {<MusicTile seed={detail?.name ?? "playlist"} size={140} />}
          <div>
            <p className="page__eyebrow">Playlist</p>
            <h1 className="page__name">{detail?.name ?? (error ? "Not found" : "Loading…")}</h1>
            <p className="page__byline">
              {detail ? `${detail.trackCount} tracks · saved ${savedCount} · Orca` : ""}
            </p>
            {!error && detail && (
              <div className="page__actions">
                <button
                  className="btn-play"
                  aria-label={`Play ${detail.name}`}
                  onClick={playAll}
                  disabled={detail.tracks.length === 0}
                >
                  {playing && detail.tracks.some((t) => t.videoId === currentId) ? (
                    <PauseIcon size={16} />
                  ) : (
                    <PlayIcon size={16} />
                  )}
                </button>
                <button className="bar__ctrl" aria-label="Delete playlist" title="Delete playlist" onClick={() => void deletePlaylist(playlistId)}>
                  <TrashIcon size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
        {error && <p className="page__error">{error}</p>}
        {detail && (
          <div className="tracktable">
            {detail.tracks.length === 0 && <p className="page__note">This playlist is empty.</p>}
            {detail.tracks.map((t, i) => {
              const saved = savedIds.has(t.videoId);
              return (
                <div
                  key={t.videoId}
                  className={`tracktable__row${currentId === t.videoId ? " tracktable__row--active" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => playRow(i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") playRow(i);
                  }}
                >
                  <span className="tracktable__num">{currentId === t.videoId && playing ? <PauseIcon size={13} /> : i + 1}</span>
                  {t.artworkUrl && <img src={t.artworkUrl} alt="" loading="lazy" />}
                  <span className="tracktable__title">
                    {t.title}
                    <em>{t.artist}</em>
                  </span>
                  <span className="tracktable__dur">{t.duration}</span>
                  <button
                    className={`bar__heart${saved ? " bar__heart--on" : ""}`}
                    aria-label={saved ? "Remove from library" : "Save to library"}
                    onClick={() => void toggleSaved(t)}
                  >
                    {saved ? <HeartIcon size={15} /> : <HeartOutlineIcon size={15} />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
