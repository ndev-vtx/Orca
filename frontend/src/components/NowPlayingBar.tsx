import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  LyricsIcon,
  MuteIcon,
  NextIcon,
  PauseIcon,
  PipIcon,
  PlayIcon,
  PlusIcon,
  PrevIcon,
  QueueIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  VolumeIcon,
} from "./Icons";
import { MusicTile } from "./Shared";
import { formatTime, usePlayerStore } from "../state/player";
import { useUiStore } from "../state/uiStore";
import { activePip, canDocumentPip, openPipWindow } from "../services/pip";
import { useIsMobile } from "../utils/device";
import MiniPlayer from "./MiniPlayer";
import { resolveArtist } from "../utils/artist";

type SliderKind = "seek" | "volume";

function percentFromEvent(el: HTMLElement, e: React.PointerEvent): number {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0) return 0;
  const ratio = (e.clientX - rect.left) / rect.width;
  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
}

export default function NowPlayingBar() {
  const navigate = useNavigate();
  const dragging = useRef<SliderKind | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const volumeRef = useRef<HTMLDivElement | null>(null);
  // While the user is scrubbing, the bar shows the dragged timestamp instead
  // of the (stale) engine position, so the handle never snaps back to 0:00
  // mid-drag. The exact timestamp is committed on release.
  const [dragSeek, setDragSeek] = useState<number | null>(null);
  const lastSeekSent = useRef(0);

  const current = usePlayerStore((s) => s.current);
  const playing = usePlayerStore((s) => s.playing);
  const loading = usePlayerStore((s) => s.loading);
  const notice = usePlayerStore((s) => s.notice);
  const positionMs = usePlayerStore((s) => s.positionMs);
  const durationMs = usePlayerStore((s) => s.durationMs);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const previous = usePlayerStore((s) => s.previous);
  const seek = usePlayerStore((s) => s.seek);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const setMuted = usePlayerStore((s) => s.setMuted);
  const setShuffle = usePlayerStore((s) => s.setShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const lyricsOpen = usePlayerStore((s) => s.lyricsOpen);
  const toggleLyrics = usePlayerStore((s) => s.toggleLyrics);
  const notify = usePlayerStore((s) => s.notify);
  const lastError = usePlayerStore((s) => s.lastError);
  const retryCurrent = usePlayerStore((s) => s.retryCurrent);
  const isMobile = useIsMobile();

  const [pipWin, setPipWin] = useState<Window | null>(null);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const pipOpen = pipWin !== null || fallbackOpen;

  useEffect(() => {
    const title = current
      ? `${current.title} · ${resolveArtist(current) || "Unknown artist"}`
      : "Orca";
    document.title = title;
    /*
     * A Document PiP window copies the opener's title at requestWindow time
     * and never follows later changes — its title bar (with the ✕ close
     * button) would forever show the track that was playing when it opened.
     * Keep it in sync with the live track.
     */
    if (pipWin) pipWin.document.title = title;
  }, [current, pipWin]);

  const openPicker = useUiStore((s) => s.openPicker);

  const duration = durationMs > 0 ? durationMs : 0;
  const shownPosition = dragSeek ?? positionMs;
  const seekPercent = duration > 0 ? Math.min(100, (shownPosition / duration) * 100) : 0;
  const volumeShown = muted ? 0 : volume;

  const setPercent = (kind: SliderKind, percent: number) => {
    if (kind === "volume") {
      setVolume(percent);
      if (percent > 0 && muted) setMuted(false);
    }
  };

  const seekMsFromEvent = (el: HTMLElement, e: React.PointerEvent): number | null => {
    if (duration <= 0) return null;
    const percent = percentFromEvent(el, e);
    return Math.round((percent / 100) * duration);
  };

  const onPointerDown = (kind: SliderKind, ref: React.RefObject<HTMLElement | null>) => (
    e: React.PointerEvent,
  ) => {
    if (!ref.current) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragging.current = kind;
    if (kind === "seek") {
      const ms = seekMsFromEvent(ref.current, e);
      if (ms === null) {
        dragging.current = null;
        return;
      }
      setDragSeek(ms);
      seek(ms);
      return;
    }
    setPercent(kind, percentFromEvent(ref.current, e));
  };

  const onPointerMove = (ref: React.RefObject<HTMLElement | null>) => (e: React.PointerEvent) => {
    if (!dragging.current || !ref.current) return;
    if (dragging.current === "volume") {
      setPercent("volume", percentFromEvent(ref.current, e));
      return;
    }
    const ms = seekMsFromEvent(ref.current, e);
    if (ms === null) return;
    setDragSeek(ms);
    // Throttle live scrubbing; dragging then releasing lands exactly on the
    // released timestamp (committed in onPointerUp).
    const now = Date.now();
    if (now - lastSeekSent.current > 140) {
      lastSeekSent.current = now;
      seek(ms);
    }
  };

  const onPointerUp = () => {
    if (dragging.current === "seek" && dragSeek !== null) seek(dragSeek);
    dragging.current = null;
    setDragSeek(null);
  };

  const onToggleMute = () => {
    setMuted(!muted);
  };

  const togglePip = async () => {
    if (fallbackOpen) {
      setFallbackOpen(false);
      return;
    }
    const open = activePip();
    if (open) {
      open.close();
      return;
    }
    if (!current) {
      notify("Play something first");
      return;
    }
    if (canDocumentPip()) {
      const win = await openPipWindow(() => setPipWin(null));
      if (win) {
        setPipWin(win);
      } else {
        notify("Picture-in-Picture could not be opened");
      }
      return;
    }
    setFallbackOpen(true);
  };

  // Keep the handler in a ref so the listener is registered exactly once per
  // open-state change instead of on every render (M9).
  const togglePipRef = useRef(togglePip);
  togglePipRef.current = togglePip;

  // Desktop: auto-open the mini-player when the user switches tabs while
  // music is playing (never while paused — manual button only then).
  useEffect(() => {
    if (isMobile) return;
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      const st = usePlayerStore.getState();
      if (!st.playing || pipOpen) return;
      if (!canDocumentPip()) return; // graceful: browsers that block auto-open just keep playing in-tab
      void togglePipRef.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [pipOpen, isMobile]);

  return (
    <footer className="bar" aria-label="Now playing">
      {notice && (
        <div className="bar__notice" role="status">
          <span>{loading && playing === false ? `loading — ${notice}` : notice}</span>
          {lastError && !loading && current && (
            <button
              className="bar__notice-retry"
              onClick={() => retryCurrent()}
              title="Retry this track"
            >
              Retry
            </button>
          )}
        </div>
      )}
      <div className="bar__left">
        <div className={`bar__cover${playing ? " bar__cover--live" : ""}`}>
          {current?.artworkUrl ? (
            <img src={current.artworkUrl} alt={current.title} loading="lazy" />
          ) : (
            <MusicTile seed={current?.title ?? "orca-ambient"} size={52} />
          )}
        </div>
        <div
          className="bar__meta"
          role="button"
          tabIndex={0}
          onClick={() => navigate(current ? `/search?q=${encodeURIComponent(current.artist || current.title)}` : "/library")}
          onKeyDown={(e) => {
            if (e.key === "Enter") navigate("/library");
          }}
        >
          <span className="bar__title">
            {current ? current.title : "Nothing playing"}
          </span>
          <span className="bar__sub">
            {current ? resolveArtist(current) || "Unknown artist" : "Orca"}
          </span>
        </div>
        {current && (
          <button
            className="bar__heart"
            aria-label="Add to playlist"
            title="Add to playlist"
            onClick={() => openPicker(current)}
          >
            <PlusIcon size={16} />
          </button>
        )}
      </div>

      <div className="bar__center">
        <div className="bar__controls">
          <button
            className={`bar__ctrl bar__ctrl--extra${shuffle ? " bar__ctrl--on" : ""}`}
            aria-label="Shuffle"
            aria-pressed={shuffle}
            title={shuffle ? "Shuffle on" : "Shuffle off"}
            onClick={() => setShuffle(!shuffle)}
          >
            <ShuffleIcon size={16} />
          </button>
          <button className="bar__ctrl" aria-label="Previous" title="Previous" onClick={previous}>
            <PrevIcon size={18} />
          </button>
          <button
            className="bar__play"
            aria-label={loading ? "Loading" : playing ? "Pause" : "Play"}
            title={playing ? "Pause" : "Play"}
            onClick={toggle}
            disabled={loading && !current}
          >
            {loading ? <span className="bar__spinner" aria-hidden="true" /> : playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
          </button>
          <button className="bar__ctrl" aria-label="Next" title="Next" onClick={() => next(true)}>
            <NextIcon size={18} />
          </button>
          <button
            className={`bar__ctrl bar__ctrl--extra${repeat !== "off" ? " bar__ctrl--on" : ""}`}
            aria-label={`Repeat: ${repeat}`}
            title={`Repeat: ${repeat}`}
            onClick={cycleRepeat}
          >
            {repeat === "one" ? <RepeatOneIcon size={16} /> : <RepeatIcon size={16} />}
          </button>
        </div>
        <div className="bar__seek">
          <span className="bar__time">{formatTime(shownPosition)}</span>
          <div
            ref={trackRef}
            className={`bar__track${dragging.current === "seek" ? " bar__track--drag" : ""}`}
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(seekPercent)}
            aria-valuetext={`${formatTime(shownPosition)} of ${formatTime(duration)}`}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") seek(shownPosition + 5000);
              if (e.key === "ArrowLeft") seek(Math.max(0, shownPosition - 5000));
            }}
            onPointerDown={onPointerDown("seek", trackRef)}
            onPointerMove={onPointerMove(trackRef)}
            onPointerUp={onPointerUp}
          >
            <div className="bar__track-fill" style={{ width: `${seekPercent}%` }} />
            <div className="bar__thumb" style={{ left: `${seekPercent}%` }} />
          </div>
          <span className="bar__time">{formatTime(duration)}</span>
        </div>
      </div>

      <div className="bar__right">
        <button
          className={`bar__ctrl${lyricsOpen ? " bar__ctrl--on" : ""}`}
          aria-label="Lyrics"
          aria-pressed={lyricsOpen}
          title={lyricsOpen ? "Hide lyrics" : "Show lyrics"}
          onClick={toggleLyrics}
          disabled={!current}
        >
          <LyricsIcon size={16} />
        </button>
        {!isMobile && (
          <button
            className={`bar__ctrl${pipOpen ? " bar__ctrl--on" : ""}`}
            aria-label="Picture-in-Picture"
            aria-pressed={pipOpen}
            title={pipOpen ? "Exit picture-in-picture" : "Picture-in-Picture"}
            onClick={() => void togglePip()}
          >
            <PipIcon size={16} />
          </button>
        )}
        <button
          className="bar__ctrl"
          aria-label="Queue"
          title="Queue"
          onClick={() => navigate("/queue")}
        >
          <QueueIcon size={16} />
        </button>
        <button
          className="bar__ctrl"
          aria-label={muted ? "Unmute" : "Mute"}
          title={muted ? "Unmute" : "Mute"}
          onClick={onToggleMute}
        >
          {volumeShown === 0 ? <MuteIcon size={16} /> : <VolumeIcon size={16} />}
        </button>
        <div
          ref={volumeRef}
          className="bar__volume"
          role="slider"
          aria-label="Volume"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={volumeShown}
          aria-valuetext={`${volumeShown}%`}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setVolume(Math.min(100, volume + 5));
            if (e.key === "ArrowLeft") setVolume(Math.max(0, volume - 5));
          }}
          onPointerDown={onPointerDown("volume", volumeRef)}
          onPointerMove={onPointerMove(volumeRef)}
          onPointerUp={onPointerUp}
        >
          <div className="bar__volume-fill" style={{ width: `${volumeShown}%` }} />
          <div className="bar__thumb" style={{ left: `${volumeShown}%` }} />
        </div>
      </div>
      {pipWin &&
        createPortal(
          <MiniPlayer variant="pip" onClose={() => activePip()?.close()} />,
          pipWin.document.body,
        )}
      {fallbackOpen && <MiniPlayer variant="overlay" onClose={() => setFallbackOpen(false)} />}
    </footer>
  );
}
