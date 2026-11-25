import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  HeartIcon,
  HeartOutlineIcon,
  MuteIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  QueueIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  VolumeIcon,
} from "./Icons";
import { MusicTile } from "./Shared";
import { formatTime, usePlayerStore } from "../state/player";
import { useLibraryStore } from "../state/libraryStore";

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

  const saved = useLibraryStore((s) =>
    current ? s.savedIds.has(current.videoId) : false,
  );
  const toggleSaved = useLibraryStore((s) => s.toggleSaved);

  const duration = durationMs > 0 ? durationMs : 0;
  const seekPercent = duration > 0 ? Math.min(100, (positionMs / duration) * 100) : 0;
  const volumeShown = muted ? 0 : volume;

  const setPercent = (kind: SliderKind, percent: number) => {
    if (kind === "seek") {
      if (duration > 0) seek(Math.round((percent / 100) * duration));
    } else {
      setVolume(percent);
      if (percent > 0 && muted) setMuted(false);
    }
  };

  const onPointerDown = (kind: SliderKind, ref: React.RefObject<HTMLElement | null>) => (
    e: React.PointerEvent,
  ) => {
    if (!ref.current) return;
    if (kind === "seek" && duration === 0) return;
    dragging.current = kind;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setPercent(kind, percentFromEvent(ref.current, e));
  };

  const onPointerMove = (ref: React.RefObject<HTMLElement | null>) => (e: React.PointerEvent) => {
    if (!dragging.current || !ref.current) return;
    setPercent(dragging.current, percentFromEvent(ref.current, e));
  };

  const onPointerUp = () => {
    dragging.current = null;
  };

  const onToggleMute = () => {
    setMuted(!muted);
  };

  return (
    <footer className="bar" aria-label="Now playing">
      {notice && (
        <div className="bar__notice" role="status">
          {loading && playing === false ? `loading — ${notice}` : notice}
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
            {current ? current.artist || "Unknown artist" : "Orca"}
          </span>
        </div>
        {current && (
          <button
            className={`bar__heart${saved ? " bar__heart--on" : ""}`}
            aria-label={saved ? "Remove from your library" : "Save to your library"}
            title={saved ? "Remove from your library" : "Save to your library"}
            onClick={() => void toggleSaved(current)}
          >
            {saved ? <HeartIcon size={16} /> : <HeartOutlineIcon size={16} />}
          </button>
        )}
      </div>

      <div className="bar__center">
        <div className="bar__controls">
          <button
            className={`bar__ctrl${shuffle ? " bar__ctrl--on" : ""}`}
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
            className={`bar__ctrl${repeat !== "off" ? " bar__ctrl--on" : ""}`}
            aria-label={`Repeat: ${repeat}`}
            title={`Repeat: ${repeat}`}
            onClick={cycleRepeat}
          >
            {repeat === "one" ? <RepeatOneIcon size={16} /> : <RepeatIcon size={16} />}
          </button>
        </div>
        <div className="bar__seek">
          <span className="bar__time">{formatTime(positionMs)}</span>
          <div
            ref={trackRef}
            className={`bar__track${dragging.current === "seek" ? " bar__track--drag" : ""}`}
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(seekPercent)}
            aria-valuetext={`${formatTime(positionMs)} of ${formatTime(duration)}`}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") seek(positionMs + 5000);
              if (e.key === "ArrowLeft") seek(positionMs - 5000);
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
    </footer>
  );
}
