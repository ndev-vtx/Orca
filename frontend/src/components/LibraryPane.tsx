import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  selectAlbumRows,
  selectArtistEntries,
  selectLibraryItems,
  selectPlaylistRows,
  useLibraryStore,
} from "../state/libraryStore";
import type { LibraryFilter } from "../types";
import { HeartIcon, PlusIcon, SearchIcon, TrashIcon } from "./Icons";
import { MusicTile } from "./Shared";

const FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "playlists", label: "Playlists" },
  { id: "artists", label: "Artists" },
  { id: "albums", label: "Albums" },
];

function FilterPill({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={`pill${active ? " pill--active" : ""}`} onClick={onClick}>
      {label}
    </button>
  );
}

export default function LibraryPane() {
  const store = useLibraryStore();
  const navigate = useNavigate();
  const {
    libraryFilter,
    setLibraryFilter,
    libraryQuery,
    setLibraryQuery,
    createPlaylist,
    deletePlaylist,
  } = store;

  const tracks = useMemo(() => selectLibraryItems(store), [store]);
  const artists = useMemo(() => selectArtistEntries(store), [store]);
  const albumRows = useMemo(() => selectAlbumRows(store), [store]);
  const playlists = useMemo(() => selectPlaylistRows(store), [store]);

  const showTracks = libraryFilter === "all" || libraryFilter === "albums";
  const showPlaylists = libraryFilter === "all" || libraryFilter === "playlists";
  const showArtists = libraryFilter === "all" || libraryFilter === "artists";

  const onCreate = async () => {
    const name = window.prompt("Playlist name");
    if (!name) return;
    await createPlaylist(name);
  };

  return (
    <div className="libpane">
      {!store.sidebarCollapsed && (
        <div className="libpane__filters" role="tablist" aria-label="Library filters">
          {FILTERS.map((f) => (
            <FilterPill
              key={f.id}
              active={libraryFilter === f.id}
              label={f.label}
              onClick={() => setLibraryFilter(f.id)}
            />
          ))}
        </div>
      )}

      <div className="libpane__search">
        <SearchIcon size={14} />
        <input
          type="search"
          placeholder={store.sidebarCollapsed ? "" : "Filter library"}
          value={libraryQuery}
          onChange={(e) => setLibraryQuery(e.target.value)}
          aria-label="Filter your library"
        />
      </div>

      <div className="libpane__list">
        {!store.backendOk && (
          <div className="libpane__empty">
            <p>Backend unreachable.</p>
            <p className="libpane__hint">
              Start it with <code>uvicorn orca.server:app --port 8765</code>
            </p>
          </div>
        )}

        {store.backendOk && showPlaylists && playlists.length > 0 && (
          <div className="libpane__section">
            {libraryFilter === "playlists" && !store.sidebarCollapsed && (
              <button className="libpane__add" onClick={onCreate} title="New playlist">
                <PlusIcon size={14} /> New playlist
              </button>
            )}
            {playlists.map((p) => (
              <button
                key={p.id}
                className="libpane__row"
                onClick={() => navigate(`/playlist/${p.id}`)}
                title={p.name}
              >
                <MusicTile seed={p.name} />
                {!store.sidebarCollapsed && (
                  <>
                    <span className="libpane__row-main">
                      <span className="libpane__row-title">{p.name}</span>
                      <span className="libpane__row-sub">
                        Playlist · {p.trackCount} {p.trackCount === 1 ? "track" : "tracks"}
                      </span>
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      className="libpane__row-action"
                      onClick={(e) => {
                        e.stopPropagation();
                        void deletePlaylist(p.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.stopPropagation();
                          void deletePlaylist(p.id);
                        }
                      }}
                      aria-label={`Delete playlist ${p.name}`}
                    >
                      <TrashIcon size={13} />
                    </span>
                  </>
                )}
              </button>
            ))}
          </div>
        )}

        {store.backendOk && showArtists && artists.length > 0 && (
          <div className="libpane__section">
            {artists.map((a) => (
              <button
                key={a.artist}
                className="libpane__row"
                onClick={() => navigate(`/search?q=${encodeURIComponent(a.artist)}`)}
                title={a.artist}
              >
                <span className="libpane__avatar">{a.artist.charAt(0).toUpperCase()}</span>
                {!store.sidebarCollapsed && (
                  <span className="libpane__row-main">
                    <span className="libpane__row-title">{a.artist}</span>
                    <span className="libpane__row-sub">Artist · {a.count} saved</span>
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {store.backendOk && showTracks && tracks.length > 0 && (
          <div className="libpane__section">
            {(libraryFilter === "albums" ? albumRows : tracks).map((t) => (
              <button
                key={t.videoId}
                className="libpane__row"
                onClick={() => navigate(`/search?q=${encodeURIComponent(t.artist)}`)}
                title={`${t.title} — ${t.artist}`}
              >
                {t.artworkUrl ? (
                  <img className="libpane__thumb" src={t.artworkUrl} alt="" loading="lazy" />
                ) : (
                  <span className="libpane__avatar">
                    <HeartIcon size={12} />
                  </span>
                )}
                {!store.sidebarCollapsed && (
                  <span className="libpane__row-main">
                    <span className="libpane__row-title">{t.title}</span>
                    <span className="libpane__row-sub">{t.artist || "unknown artist"}</span>
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {store.backendOk &&
          showTracks &&
          tracks.length === 0 &&
          (libraryFilter === "all" || libraryFilter === "albums") && (
            <div className="libpane__empty">
              <p>Nothing saved yet.</p>
              <p className="libpane__hint">Find something you like and tap the heart.</p>
            </div>
          )}
      </div>
    </div>
  );
}
