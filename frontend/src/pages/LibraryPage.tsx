import { useNavigate } from "react-router-dom";
import TopBar from "../components/TopBar";
import { useLibraryStore } from "../state/libraryStore";
import { MusicTile } from "../components/Shared";
import { usePlayerStore } from "../state/player";

export default function LibraryPage() {
  const navigate = useNavigate();
  const playlists = useLibraryStore((s) => s.playlists);
  const savedTracks = useLibraryStore((s) => s.savedTracks);
  const play = usePlayerStore((s) => s.play);
  const currentId = usePlayerStore((s) => s.current?.videoId ?? null);

  return (
    <div className="page">
      <TopBar title="Your Library" />
      <div className="page__hero" />
      <div className="page__body">
        <h1 className="page__greeting">Your Library</h1>
        <h2 className="section__title">Playlists</h2>
        {playlists.length === 0 ? (
          <p className="page__note">No playlists yet — create one from the sidebar.</p>
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
        <h2 className="section__title">Saved tracks</h2>
        {savedTracks.length === 0 ? (
          <p className="page__note">Nothing saved yet.</p>
        ) : (
          <div className="tracktable">
            {savedTracks.map((t, i) => (
              <div
                key={t.videoId}
                className={`tracktable__row${currentId === t.videoId ? " tracktable__row--active" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => play(savedTracks, i, "library:saved")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") play(savedTracks, i, "library:saved");
                }}
              >
                <span className="tracktable__num">{i + 1}</span>
                {t.artworkUrl && <img src={t.artworkUrl} alt="" loading="lazy" />}
                <span className="tracktable__title">
                  {t.title}
                  <em>{t.artist}</em>
                </span>
                <span className="tracktable__dur">{t.duration}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
