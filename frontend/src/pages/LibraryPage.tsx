import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import TopBar from "../components/TopBar";
import { useLibraryStore } from "../state/libraryStore";
import { MusicTile } from "../components/Shared";
import PlaylistModal from "../components/PlaylistModal";
import { api } from "../services/api";
import type { SongDto } from "../types";
import { usePlayerStore } from "../state/player";
import { TrackRow } from "./TrackPage";
import { HeartIcon, PlusIcon, QueueIcon, ImportIcon, HistoryIcon } from "../components/Icons";

export default function LibraryPage() {
  const navigate = useNavigate();
  const playlists = useLibraryStore((s) => s.playlists);
  const savedTracks = useLibraryStore((s) => s.savedTracks);
  const play = usePlayerStore((s) => s.play);

  const [history, setHistory] = useState<SongDto[]>([]);
  const [modal, setModal] = useState<null | "create" | "import">(null);
  const playlistsRef = useRef<HTMLDivElement | null>(null);
  const savedRef = useRef<HTMLDivElement | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let live = true;
    api
      .history(30)
      .then((res) => {
        if (live) setHistory(res.history);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const tiles = [
    {
      label: "Favorites",
      hint: `${savedTracks.length} saved`,
      icon: HeartIcon,
      onClick: () => savedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    },
    {
      label: "Playlists",
      hint: `${playlists.length} lists`,
      icon: QueueIcon,
      onClick: () => playlistsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    },
    {
      label: "Recently played",
      hint: history.length > 0 ? "jump back in" : "nothing yet",
      icon: HistoryIcon,
      onClick: () => historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    },
    {
      label: "New playlist",
      hint: "create",
      icon: PlusIcon,
      onClick: () => setModal("create"),
    },
    {
      label: "Import",
      hint: "from a link",
      icon: ImportIcon,
      onClick: () => setModal("import"),
    },
  ];

  return (
    <div className="page">
      <TopBar title="Your Library" />
      <div className="page__hero" />
      <div className="page__body">
        <h1 className="page__greeting">Your Library</h1>

        <div className="libtiles">
          {tiles.map(({ label, hint, icon: Icon, onClick }) => (
            <button key={label} className="libtile" onClick={onClick}>
              <span className="libtile__icon">
                <Icon size={18} />
              </span>
              <span className="libtile__text">
                <span className="libtile__label">{label}</span>
                <span className="libtile__hint">{hint}</span>
              </span>
            </button>
          ))}
        </div>

        <h2 className="section__title" ref={playlistsRef}>
          Playlists
        </h2>
        {playlists.length === 0 ? (
          <p className="page__note">No playlists yet — create one from the tiles above.</p>
        ) : (
          <div className="page__grid">
            {playlists.map((p) => (
              <div
                key={p.id}
                className="card"
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/playlist/${p.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") navigate(`/playlist/${p.id}`);
                }}
              >
                <div className="card__art">
                  <MusicTile seed={p.name} size={160} />
                </div>
                <div className="card__meta">
                  <span className="card__title">{p.name}</span>
                  <span className="card__sub">
                    {p.trackCount} {p.trackCount === 1 ? "track" : "tracks"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        <h2 className="section__title" ref={savedRef}>
          Saved tracks
        </h2>
        {savedTracks.length === 0 ? (
          <p className="page__note">Nothing saved yet.</p>
        ) : (
          <div className="tracktable">
            {savedTracks.map((t, i) => (
              <TrackRow
                key={`${t.videoId}-${i}`}
                track={t}
                index={i}
                onPlay={() => play(savedTracks, i, "library:saved")}
              />
            ))}
          </div>
        )}

        <h2 className="section__title" ref={historyRef}>
          Recently played
        </h2>
        {history.length === 0 ? (
          <p className="page__note">Nothing played yet — your history will surface here.</p>
        ) : (
          <div className="tracktable">
            {history.map((t, i) => (
              <TrackRow
                key={`${t.videoId}-${i}`}
                track={t}
                index={i}
                onPlay={() => play(history, i, "library:history")}
              />
            ))}
          </div>
        )}
      </div>
      {modal !== null && <PlaylistModal mode={modal} onClose={() => setModal(null)} />}
    </div>
  );
}
