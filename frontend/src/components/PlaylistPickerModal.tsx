import { useEffect, useState } from "react";
import { useLibraryStore } from "../state/libraryStore";
import { usePlayerStore } from "../state/player";
import { useUiStore } from "../state/uiStore";
import { CloseIcon } from "./Icons";

/**
 * "Add to playlist" picker: choose one of the user's playlists or create a
 * new one inline. With no playlists yet it explains that plainly and offers
 * the create field instead of failing.
 */
export default function PlaylistPickerModal() {
  const song = useUiStore((s) => s.pickerFor);
  const closePicker = useUiStore((s) => s.closePicker);
  const playlists = useLibraryStore((s) => s.playlists);
  const refreshPlaylists = useLibraryStore((s) => s.refreshPlaylists);
  const addTracksToPlaylist = useLibraryStore((s) => s.addTracksToPlaylist);
  const createPlaylist = useLibraryStore((s) => s.createPlaylist);
  const notify = usePlayerStore((s) => s.notify);

  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (song) void refreshPlaylists();
  }, [song, refreshPlaylists]);

  useEffect(() => {
    if (!song) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePicker();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [song, closePicker]);

  if (!song) return null;

  const add = async (id: number, name: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const added = await addTracksToPlaylist(id, [song]);
      notify(added > 0 ? `Added to ${name}` : `Already in ${name}`);
      setBusy(false);
      closePicker();
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Could not add to the playlist.");
    }
  };

  const createAndAdd = async () => {
    const name = newName.trim();
    if (!name) {
      setError("Give the playlist a name first.");
      return;
    }
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const created = await createPlaylist(name);
      await addTracksToPlaylist(created.id, [song]);
      notify(`Added to ${name}`);
      setBusy(false);
      closePicker();
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Could not create the playlist.");
    }
  };

  const hasPlaylists = playlists.length > 0;

  return (
    <div
      className="modal-overlay picker-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) closePicker();
      }}
    >
      <div className="modal picker" role="dialog" aria-modal="true" aria-label="Add to playlist">
        <header className="modal__head">
          <h2 className="modal__title">Add to playlist</h2>
          <button className="modal__close" onClick={closePicker} aria-label="Close">
            <CloseIcon size={15} />
          </button>
        </header>

        <p className="picker__track" title={song.title}>
          {song.title} <span>· {song.artist || "Unknown artist"}</span>
        </p>

        {!hasPlaylists && !creating && (
          <div className="picker__empty">
            <p className="picker__empty-title">You don't have any playlists yet.</p>
            <p className="picker__empty-sub">
              Create your first playlist to start collecting tracks like this one.
            </p>
            <button
              className="picker__create-btn"
              onClick={() => {
                setCreating(true);
                setNewName("");
              }}
            >
              Create a playlist
            </button>
          </div>
        )}

        {(creating || hasPlaylists) && creating && (
          <div className="picker__new">
            <input
              className="modal__input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New playlist name"
              maxLength={80}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void createAndAdd();
              }}
            />
            <div className="picker__new-actions">
              {hasPlaylists && (
                <button
                  className="modal__btn modal__btn--ghost"
                  onClick={() => {
                    setCreating(false);
                    setError("");
                  }}
                >
                  Back
                </button>
              )}
              <button
                className="modal__btn modal__btn--primary"
                disabled={busy}
                onClick={() => void createAndAdd()}
              >
                {busy ? "Creating…" : "Create & add"}
              </button>
            </div>
          </div>
        )}

        {hasPlaylists && !creating && (
          <div className="picker__list">
            {playlists.map((pl) => (
              <button
                key={pl.id}
                className="picker__row"
                disabled={busy}
                onClick={() => void add(pl.id, pl.name)}
              >
                <span className="picker__row-name">{pl.name}</span>
                <span className="picker__row-count">
                  {pl.trackCount} {pl.trackCount === 1 ? "track" : "tracks"}
                </span>
              </button>
            ))}
            <button className="picker__new-btn" onClick={() => setCreating(true)}>
              + New playlist
            </button>
          </div>
        )}

        {error && <p className="modal__error">{error}</p>}
      </div>
    </div>
  );
}
