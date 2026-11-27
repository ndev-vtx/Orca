import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { usePlayerStore } from "../state/player";
import { useLibraryStore } from "../state/libraryStore";
import { useUiStore } from "../state/uiStore";

/**
 * Three-dot context menu for tracks — Spotify-style actions. Rendered in a
 * portal with fixed positioning at the click point; closes on outside click,
 * Escape or scroll.
 */
export default function TrackMenu() {
  const menu = useUiStore((s) => s.menu);
  const closeMenu = useUiStore((s) => s.closeMenu);
  const openPicker = useUiStore((s) => s.openPicker);
  const navigate = useNavigate();
  const toggleSaved = useLibraryStore((s) => s.toggleSaved);
  const savedIds = useLibraryStore((s) => s.savedIds);
  const refreshPlaylists = useLibraryStore((s) => s.refreshPlaylists);
  const playSong = usePlayerStore((s) => s.playSong);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const removeFromPlaylistApi = useLibraryStore((s) => s.removeFromPlaylist);
  const notify = usePlayerStore((s) => s.notify);
  const ref = useRef<HTMLDivElement | null>(null);
  void refreshPlaylists; // refreshed inside the store actions

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu, closeMenu]);

  if (!menu) return null;
  const { song, anchor, playlistId } = menu;
  const saved = savedIds.has(song.videoId);

  const clamp = (value: number, size: number) =>
    Math.min(value, window.innerWidth - size - 8);

  const act = (fn: () => void) => () => {
    closeMenu();
    fn();
  };

  const share = async () => {
    const url = `https://music.youtube.com/watch?v=${encodeURIComponent(song.videoId)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${song.title} · ${song.artist}`, url });
      } else {
        await navigator.clipboard.writeText(url);
        notify("Link copied to clipboard");
      }
    } catch {
      /* user dismissed the share sheet */
    }
  };

  const goSearch = (q: string) => navigate(`/search?q=${encodeURIComponent(q)}`);
  const openTrack = () => navigate(`/track/${encodeURIComponent(song.videoId)}`);

  const items: { label: string; hint?: string; danger?: boolean; run: () => void }[] = [
    { label: "Add to playlist", run: () => openPicker(song) },
    {
      label: saved ? "Remove from Liked Songs" : "Add to Liked Songs",
      run: () => void toggleSaved(song).then(() => notify(saved ? "Removed from Liked Songs" : "Added to Liked Songs")),
    },
    { label: "Add to queue", run: () => addToQueue(song) },
    {
      label: "Go to song radio",
      run: () => {
        playSong(song, "radio");
        notify("Radio — playing tracks like this one");
      },
    },
    { label: "Go to artist", hint: song.artist || undefined, run: act(() => goSearch(song.artist || song.title)) },
    { label: "View credits", run: act(openTrack) },
    { label: "Share", run: () => void share() },
  ];

  if (playlistId !== undefined) {
    items.unshift({
      label: "Remove from this playlist",
      danger: true,
      run: () =>
        void removeFromPlaylistApi(playlistId, song.videoId).then(() =>
          notify("Removed from playlist"),
        ),
    });
  }

  return createPortal(
    <div
      className="ctxmenu"
      ref={ref}
      role="menu"
      style={{ left: clamp(anchor.x, 230), top: anchor.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <p className="ctxmenu__title" title={song.title}>
        {song.title}
      </p>
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          className={`ctxmenu__item${item.danger ? " ctxmenu__item--danger" : ""}`}
          onClick={() => {
            closeMenu();
            item.run();
          }}
        >
          {item.label}
          {item.hint && <span className="ctxmenu__hint">{item.hint}</span>}
        </button>
      ))}
    </div>,
    document.body,
  );
}
