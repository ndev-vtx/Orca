import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import type { TrackDetail } from "../types";
import { MusicTile } from "./Shared";
import { usePlayerStore } from "../state/player";
import { useUiStore } from "../state/uiStore";
import { useIsMobile } from "../utils/device";

/**
 * Desktop right-side "Now Playing / Credits" panel — artwork, track info and
 * the credit line (channel / source) for the current track. Hidden on mobile,
 * where the full-height TrackPage takes over that role.
 */
export default function NowPlayingPanel() {
  const current = usePlayerStore((s) => s.current);
  const playing = usePlayerStore((s) => s.playing);
  const openMenu = useUiStore((s) => s.openMenu);
  const openPicker = useUiStore((s) => s.openPicker);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [detail, setDetail] = useState<TrackDetail | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    setDetail(null);
    if (!current) return;
    let live = true;
    api
      .track(current.videoId)
      .then((d) => {
        if (live) setDetail(d);
      })
      .catch(() => {
        /* credits are best-effort */
      });
    return () => {
      live = false;
    };
  }, [current]);

  if (isMobile || !current) return null;

  const channel = detail?.credits?.channel ?? current.artist ?? "";

  return (
    <aside className={`np-panel${open ? "" : " np-panel--closed"}`} aria-label="Now playing details">
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
              {current.artist || "Unknown artist"}
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
              onClick={(e) =>
                openMenu(current, { x: e.clientX, y: e.clientY })
              }
            >
              ⋯
            </button>
          </div>
          <div className="np-panel__credits">
            <p className="np-panel__credits-title">Credits</p>
            <p className="np-panel__credits-line">
              <strong>{channel || "Unknown channel"}</strong>
              {detail?.credits?.source ? ` · ${detail.credits.source}` : ""}
            </p>
            {detail?.album && <p className="np-panel__credits-line">Album · {detail.album}</p>}
            {detail?.year && <p className="np-panel__credits-line">Released · {detail.year}</p>}
            <button
              className="pill np-panel__link"
              onClick={() => navigate(`/track/${current.videoId}`)}
            >
              View track & lyrics
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
