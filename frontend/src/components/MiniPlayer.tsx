import { HeartIcon, HeartOutlineIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon } from "./Icons";
import { formatTime, usePlayerStore } from "../state/player";
import { useLibraryStore } from "../state/libraryStore";

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
  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const previous = usePlayerStore((s) => s.previous);

  const saved = useLibraryStore((s) =>
    current ? s.savedIds.has(current.videoId) : false,
  );
  const toggleSaved = useLibraryStore((s) => s.toggleSaved);

  const duration = durationMs > 0 ? durationMs : 0;
  const percent = duration > 0 ? Math.min(100, (positionMs / duration) * 100) : 0;

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
          {current && (
            <button
              className={`miniplayer__like${saved ? " miniplayer__like--on" : ""}`}
              aria-label={saved ? "Remove from your library" : "Save to your library"}
              onClick={() => void toggleSaved(current)}
            >
              {saved ? <HeartIcon size={16} /> : <HeartOutlineIcon size={16} />}
            </button>
          )}
          <button
            className="miniplayer__close"
            aria-label="Close mini-player"
            title="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="miniplayer__progress" aria-hidden="true">
          <div className="miniplayer__progress-fill" style={{ width: `${percent}%` }} />
        </div>
        <div className="miniplayer__times">
          <span>{formatTime(positionMs)}</span>
          <span>{formatTime(duration)}</span>
        </div>

        <div className="miniplayer__controls">
          <button className="miniplayer__ctrl" aria-label="Previous" onClick={previous}>
            <PrevIcon size={18} />
          </button>
          <button
            className="miniplayer__play"
            aria-label={playing ? "Pause" : "Play"}
            onClick={toggle}
            disabled={loading && !current}
          >
            {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
          </button>
          <button className="miniplayer__ctrl" aria-label="Next" onClick={() => next(true)}>
            <NextIcon size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
