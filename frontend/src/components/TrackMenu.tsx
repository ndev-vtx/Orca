import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { usePlayerStore } from "../state/player";
import { useLibraryStore } from "../state/libraryStore";
import { useUiStore } from "../state/uiStore";
import { resolveArtist } from "../utils/artist";

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
  const playSong = usePlayerStore((s) => s.playSong);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const removeFromPlaylistApi = useLibraryStore((s) => s.removeFromPlaylist);
  const notify = usePlayerStore((s) => s.notify);
  const ref = useRef<HTMLDivElement | null>(null);

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
  const { song, anchor } = menu;
  const { playlistId, albumId } = menu.options ?? {};
  const saved = savedIds.has(song.videoId);

  const clampLeft = (value: number, size: number) =>
    Math.min(Math.max(8, value), window.innerWidth - size - 8);
  const clampTop = (value: number, height: number) =>
    Math.min(Math.max(8, value), Math.max(8, window.innerHeight - height - 8));

  const act = (fn: () => void) => () => {
    closeMenu();
    fn();
  };

  const share = async () => {
    const url = `${window.location.origin}/track/${encodeURIComponent(song.videoId)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${song.title} · ${resolveArtist(song) || song.title}`, url });
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
    { label: "Go to artist", hint: resolveArtist(song) || undefined, run: act(() => goSearch(resolveArtist(song) || song.title)) },
    ...(albumId
      ? [{ label: "Go to album", run: act(() => navigate(`/album/${encodeURIComponent(albumId)}`)) }]
      : []),
    { label: "View credits", run: act(openTrack) },
    { label: "Share", run: () => void share() },
  ];

  if (playlistId !== undefined) {
    items.unshift({
      label: "Remove from this playlist",
      danger: true,
      run: () =>
        void removeFromPlaylistApi(playlistId, song.videoId)
          .then(() => notify("Removed from playlist"))
          .catch(() => notify("Could not remove the track")),
    });
  }

  // Estimate the rendered height so a menu opened near the bottom edge stays
  // inside the viewport instead of clipping off-screen.
  const estimatedHeight = 60 + items.length * 38;

  return createPortal(
    <div
      className="ctxmenu"
      ref={ref}
      role="menu"
      style={{
        left: clampLeft(anchor.x, 236),
        top: clampTop(anchor.y, estimatedHeight),
      }}
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
