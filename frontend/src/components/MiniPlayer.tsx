/*
 * MiniPlayer.tsx
 * Spotify-desktop-style floating mini-player. Rendered through a React portal
 * inside the Document PiP window (variant "pip") or as an in-page overlay when
 * the browser has no PiP support (variant "overlay"). Square cover art, title
 * + artist, scrubbing progress with times, and Previous / Play-Pause / Next,
 * Repeat, Volume (+mute) — no favorite/heart button by design. Every control
 * stays reachable when the window is resized down to a corner.
 */
import { useRef, useState } from "react";
import {
  MuteIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  RepeatIcon,
  RepeatOneIcon,
  VolumeIcon,
} from "./Icons";
import { formatTime, usePlayerStore } from "../state/player";

interface MiniPlayerProps {
  variant: "pip" | "overlay";
  onClose: () => void;
}

export default function MiniPlayer({ variant, onClose }: MiniPlayerProps) {
  const current = usePlayerStore((s) => s.current);
  const playing = usePlayerStore((s) => s.playing);
  const loading = usePlayerStore((s) => s.loading);
  const positionMs = usePlayerStore((s) => s.positionMs);
  const durationMs = usePlayerStore((s) => s.durationMs);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const repeat = usePlayerStore((s) => s.repeat);
  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const previous = usePlayerStore((s) => s.previous);
  const seek = usePlayerStore((s) => s.seek);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const setMuted = usePlayerStore((s) => s.setMuted);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);

  // Same scrubbing contract as the main bar: show the dragged timestamp while
  // dragging, commit the exact released timestamp.
  const dragging = useRef(false);
  const [dragSeek, setDragSeek] = useState<number | null>(null);
  const lastSeekSent = useRef(0);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const duration = durationMs > 0 ? durationMs : 0;
  const shownPosition = dragSeek ?? positionMs;
  const percent = duration > 0 ? Math.min(100, (shownPosition / duration) * 100) : 0;
  const volumeShown = muted ? 0 : volume;

  const seekMsFromEvent = (el: HTMLElement, e: React.PointerEvent): number | null => {
    if (duration <= 0) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return null;
    const ratio = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
    return Math.round((ratio / 100) * duration);
  };

  const onSeekDown = (e: React.PointerEvent) => {
    if (!trackRef.current) return;
    const ms = seekMsFromEvent(trackRef.current, e);
    if (ms === null) return;
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragSeek(ms);
    seek(ms);
  };

  const onSeekMove = (e: React.PointerEvent) => {
    if (!dragging.current || !trackRef.current) return;
    const ms = seekMsFromEvent(trackRef.current, e);
    if (ms === null) return;
    setDragSeek(ms);
    const now = Date.now();
    if (now - lastSeekSent.current > 140) {
      lastSeekSent.current = now;
      seek(ms);
    }
  };

  const onSeekUp = () => {
    if (dragging.current && dragSeek !== null) seek(dragSeek);
    dragging.current = false;
    setDragSeek(null);
  };

  return (
    <div className={`miniplayer miniplayer--${variant}`}>
      <div className="miniplayer__art">
        {current?.artworkUrl ? (
          <img src={current.artworkUrl} alt={current.title} />
        ) : (
          <div className="miniplayer__art-fallback" aria-hidden="true">
            {(current?.title ?? "O").charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      <div className="miniplayer__body">
        <div className="miniplayer__top">
          <div className="miniplayer__titles">
            <span className="miniplayer__title">
              {current ? current.title : "Nothing playing"}
            </span>
            <span className="miniplayer__artist">
              {current ? current.artist || "Unknown artist" : "Orca"}
            </span>
          </div>
          <button
            className="miniplayer__close"
            aria-label="Close mini-player"
            title="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div
          ref={trackRef}
          className={`miniplayer__progress${dragging ? " miniplayer__progress--drag" : ""}`}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          aria-valuetext={`${formatTime(shownPosition)} of ${formatTime(duration)}`}
          tabIndex={0}
          onPointerDown={onSeekDown}
          onPointerMove={onSeekMove}
          onPointerUp={onSeekUp}
        >
          <div className="miniplayer__progress-fill" style={{ width: `${percent}%` }} />
        </div>
        <div className="miniplayer__times">
          <span>{formatTime(shownPosition)}</span>
          <span>{formatTime(duration)}</span>
        </div>

        <div className="miniplayer__controls">
          <button className="miniplayer__ctrl" aria-label="Previous" title="Previous" onClick={previous}>
            <PrevIcon size={18} />
          </button>
          <button
            className="miniplayer__play"
            aria-label={loading ? "Loading" : playing ? "Pause" : "Play"}
            title={playing ? "Pause" : "Play"}
            onClick={toggle}
            disabled={loading && !current}
          >
            {loading ? (
              <span className="bar__spinner" aria-hidden="true" />
            ) : playing ? (
              <PauseIcon size={18} />
            ) : (
              <PlayIcon size={18} />
            )}
          </button>
          <button
            className="miniplayer__ctrl"
            aria-label="Next"
            title="Next"
            onClick={() => next(true)}
          >
            <NextIcon size={18} />
          </button>
          <button
            className={`miniplayer__ctrl miniplayer__ctrl--extra${
              repeat !== "off" ? " miniplayer__ctrl--on" : ""
            }`}
            aria-label={`Repeat: ${repeat}`}
            title={`Repeat: ${repeat}`}
            onClick={cycleRepeat}
          >
            {repeat === "one" ? <RepeatOneIcon size={16} /> : <RepeatIcon size={16} />}
          </button>
          <button
            className="miniplayer__ctrl miniplayer__ctrl--extra"
            aria-label={muted ? "Unmute" : "Mute"}
            title={muted ? "Unmute" : "Mute"}
            onClick={() => setMuted(!muted)}
          >
            {volumeShown === 0 ? <MuteIcon size={16} /> : <VolumeIcon size={16} />}
          </button>
          <div
            className="miniplayer__volume"
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
            onPointerDown={(e) => {
              if (!e.currentTarget) return;
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              const rect = e.currentTarget.getBoundingClientRect();
              if (rect.width === 0) return;
              const pct = Math.min(100, Math.max(0, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
              setVolume(pct);
              if (pct > 0 && muted) setMuted(false);
            }}
          >
            <div className="miniplayer__volume-fill" style={{ width: `${volumeShown}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
