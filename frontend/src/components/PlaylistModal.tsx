import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { useLibraryStore } from "../state/libraryStore";
import { CloseIcon } from "./Icons";

type ModalMode = "create" | "import";

interface PlaylistModalProps {
  mode: ModalMode;
  onClose: () => void;
}

export default function PlaylistModal({ mode, onClose }: PlaylistModalProps) {
  const navigate = useNavigate();
  const refreshPlaylists = useLibraryStore((s) => s.refreshPlaylists);
  const createPlaylist = useLibraryStore((s) => s.createPlaylist);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement | null>(null);
  const urlRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    (mode === "create" ? nameRef.current : urlRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  const submit = async () => {
    if (busy) return;
    setError("");
    if (mode === "create") {
      const trimmed = name.trim();
      if (!trimmed) {
        setError("Give the playlist a name.");
        return;
      }
      setBusy(true);
      try {
        const created = await createPlaylist(trimmed);
        setBusy(false);
        onClose();
        navigate(`/playlist/${created.id}`);
      } catch (err) {
        setBusy(false);
        setError(err instanceof Error ? err.message : "Could not create the playlist.");
      }
      return;
    }
    const link = url.trim();
    if (!link) {
      setError("Paste a YouTube or Spotify playlist link.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.importPlaylistUrl(link);
      if (!res.ok) {
        setBusy(false);
        setError(res.error ?? "That link could not be imported.");
        return;
      }
      await refreshPlaylists();
      setBusy(false);
      onClose();
      if (typeof res.playlistId === "number") {
        navigate(`/playlist/${res.playlistId}`);
      }
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Import failed.");
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={mode === "create" ? "New playlist" : "Import playlist"}>
        <header className="modal__head">
          <h2 className="modal__title">
            {mode === "create" ? "New playlist" : "Import from link"}
          </h2>
          <button className="modal__close" onClick={onClose} aria-label="Close">
            <CloseIcon size={15} />
          </button>
        </header>

        {mode === "create" ? (
          <form
            className="modal__form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label className="modal__label" htmlFor="playlist-name">
              Playlist name
            </label>
            <input
              id="playlist-name"
              ref={nameRef}
              className="modal__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Deep Focus Currents"
              maxLength={80}
            />
            {error && <p className="modal__error">{error}</p>}
            <div className="modal__actions">
              <button type="button" className="modal__btn modal__btn--ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="modal__btn modal__btn--primary" disabled={busy}>
                {busy ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        ) : (
          <form
            className="modal__form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label className="modal__label" htmlFor="playlist-url">
              Playlist link
            </label>
            <input
              id="playlist-url"
              ref={urlRef}
              className="modal__input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="YouTube or Spotify playlist URL"
              inputMode="url"
            />
            <p className="modal__hint">
              Orca pulls the playlist in and saves it to your library.
            </p>
            {error && <p className="modal__error">{error}</p>}
            <div className="modal__actions">
              <button type="button" className="modal__btn modal__btn--ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="modal__btn modal__btn--primary" disabled={busy}>
                {busy ? "Importing…" : "Import"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
