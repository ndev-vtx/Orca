import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MusicTile } from "./Shared";
import { MoreIcon } from "./Icons";
import { usePlayerStore } from "../state/player";
import { useUiStore } from "../state/uiStore";
import { useIsMobile } from "../utils/device";
import { resolveArtist } from "../utils/artist";

/**
 * Desktop right-side "Now Playing" panel — deliberately clean: artwork, track
 * title and artist, add-to-playlist + menu actions. No credits/metadata block
 * (removed per design review: the panel keeps only track identity + lyrics
 * entry point). Hidden on mobile, where the full-height TrackPage takes over.
 */
export default function NowPlayingPanel() {
  const current = usePlayerStore((s) => s.current);
  const playing = usePlayerStore((s) => s.playing);
  const openMenu = useUiStore((s) => s.openMenu);
  const openPicker = useUiStore((s) => s.openPicker);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(true);

  if (isMobile || !current) return null;

  return (
    <aside className={`np-panel${open ? "" : " np-panel--closed"}`} aria-label="Now playing">
      <div className="np-panel__head">
        <span className="np-panel__kicker">{playing ? "Now playing" : "Paused"}</span>
        <button
          className="np-panel__fold"
          aria-label={open ? "Collapse panel" : "Expand panel"}
          title={open ? "Collapse panel" : "Expand panel"}
          onClick={() => setOpen(!open)}
        >
          {open ? "›" : "‹"}
        </button>
      </div>
      {open && (
        <>
          <button className="np-panel__art" onClick={() => navigate(`/track/${current.videoId}`)}>
            {current.artworkUrl ? (
              <img src={current.artworkUrl} alt={current.title} loading="lazy" />
            ) : (
              <MusicTile seed={current.title} size={200} />
            )}
          </button>
          <div className="np-panel__info">
            <span className="np-panel__title" title={current.title}>
              {current.title}
            </span>
            <span className="np-panel__artist" title={current.artist}>
              {resolveArtist(current) || "Unknown artist"}
            </span>
          </div>
          <div className="np-panel__actions">
            <button className="pill" onClick={() => openPicker(current)} title="Add to playlist">
              Add to playlist
            </button>
            <button
              className="pill pill--icon"
              aria-label="More options"
              title="More options"
              onClick={(e) => openMenu(current, { x: e.clientX, y: e.clientY })}
            >
              <MoreIcon size={15} />
            </button>
          </div>
          <button
            className="pill np-panel__link"
            onClick={() => navigate(`/track/${current.videoId}`)}
          >
            View track & lyrics
          </button>
        </>
      )}
    </aside>
  );
}
