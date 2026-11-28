import { useRef, useState } from "react";
import TopBar from "../components/TopBar";
import { MusicTile } from "../components/Shared";
import { CloseIcon, PauseIcon, PlayIcon } from "../components/Icons";
import { usePlayerStore } from "../state/player";

export default function QueuePage() {
  const queue = usePlayerStore((s) => s.queue);
  const cursor = usePlayerStore((s) => s.cursor);
  const current = usePlayerStore((s) => s.current);
  const playing = usePlayerStore((s) => s.playing);
  const playAt = usePlayerStore((s) => s.playAt);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const moveInQueue = usePlayerStore((s) => s.moveInQueue);

  /* Drag-and-drop reorder of upcoming tracks (desktop). */
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const dropRow = (from: number, to: number) => {
    moveInQueue(from, to);
    dragFrom.current = null;
    setDragOver(null);
  };
  const dragProps = (absoluteIndex: number) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      dragFrom.current = absoluteIndex;
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("text/plain", String(absoluteIndex));
      } catch {
        /* some engines restrict setData during dragstart */
      }
    },
    onDragOver: (e: React.DragEvent) => {
      if (dragFrom.current === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragOver !== absoluteIndex) setDragOver(absoluteIndex);
    },
    onDragLeave: () => {
      if (dragOver === absoluteIndex) setDragOver(null);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (dragFrom.current !== null) dropRow(dragFrom.current, absoluteIndex);
    },
    onDragEnd: () => {
      dragFrom.current = null;
      setDragOver(null);
    },
    dropActive: dragOver === absoluteIndex && dragFrom.current !== null,
  });
  const shuffleUpcoming = usePlayerStore((s) => s.shuffleUpcoming);
  const autoQueue = usePlayerStore((s) => s.autoQueue);
  const setAutoQueue = usePlayerStore((s) => s.setAutoQueue);
  const clearQueue = usePlayerStore((s) => s.clearQueue);

  const currentIdx = current
    ? queue.findIndex((t) => t.videoId === current.videoId)
    : -1;

  return (
    <div className="page">
      <TopBar title="Queue" />
      <div className="page__hero" />
      <div className="page__body">
        <div className="page__header page__header--stack">
          <div>
            <p className="page__eyebrow">Now playing</p>
            <h1 className="page__name">{current ? current.title : "Nothing playing"}</h1>
            <p className="page__byline">
              {current ? current.artist || "Unknown artist" : "Pick a track to start the current"}
            </p>
          </div>
          <div className="page__actions">
            <button
              className="pill"
              onClick={shuffleUpcoming}
              disabled={cursor + 2 >= queue.length}
            >
              Shuffle upcoming
            </button>
            <button
              className={`pill${autoQueue ? " pill--active" : ""}`}
              onClick={() => setAutoQueue(!autoQueue)}
            >
              Auto radio {autoQueue ? "on" : "off"}
            </button>
            <button
              className="pill"
              onClick={clearQueue}
              disabled={cursor + 1 >= queue.length}
              title="Remove upcoming tracks from the queue"
            >
              Clear queue
            </button>
          </div>
        </div>

        {queue.length === 0 && (
          <p className="page__note">The queue is empty. Play something from Home or Search.</p>
        )}

        {currentIdx > 0 && (
          <>
            <h2 className="section__title">Played</h2>
            <div className="tracktable">
              {queue.slice(0, currentIdx).map((t, i) => (
                <QueueRow key={`done-${t.videoId}-${i}`} track={t} index={i} onPlay={playAt} />
              ))}
            </div>
          </>
        )}

        {currentIdx >= 0 && (
          <>
            <h2 className="section__title">Now playing</h2>
            <div className="tracktable">
              <QueueRow track={queue[currentIdx]} index={currentIdx} onPlay={playAt} showState={playing} />
            </div>
          </>
        )}

        {currentIdx >= 0 && currentIdx + 1 < queue.length && (
          <>
            <h2 className="section__title">Up next</h2>
            <div className="tracktable">
              {queue.slice(currentIdx + 1).map((t, i) => (
                <QueueRow
                  key={`next-${t.videoId}-${i}`}
                  track={t}
                  index={i + currentIdx + 1}
                  onPlay={playAt}
                  onRemove={() => removeFromQueue(i + currentIdx + 1)}
                  {...dragProps(i + currentIdx + 1)}
                />
              ))}
            </div>
          </>
        )}

        {currentIdx < 0 && queue.length > 0 && (
          <div className="tracktable">
            {queue.map((t, i) => (
              <QueueRow
                key={`all-${t.videoId}-${i}`}
                track={t}
                index={i}
                onPlay={playAt}
                {...dragProps(i)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function QueueRow({
  track,
  index,
  onPlay,
  onRemove,
  showState = false,
  draggable,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  dropActive,
}: {
  track: { videoId: string; title: string; artist: string; duration: string; artworkUrl: string };
  index: number;
  onPlay: (index: number) => void;
  onRemove?: () => void;
  showState?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  dropActive?: boolean;
}) {
  return (
    <div
      className={`tracktable__row${dropActive ? " tracktable__row--drop" : ""}`}
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={() => onPlay(index)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onPlay(index);
      }}
    >
      <span className="tracktable__num">{showState ? <PauseIcon size={13} /> : index + 1}</span>
      {track.artworkUrl ? (
        <img src={track.artworkUrl} alt="" loading="lazy" />
      ) : (
        <MusicTile seed={track.title} size={40} />
      )}
      <span className="tracktable__title">
        {track.title}
        <em>{track.artist}</em>
      </span>
      <span className="tracktable__dur">{track.duration}</span>
      <span className="tracktable__cue" aria-hidden="true">
        <PlayIcon size={13} />
      </span>
      {onRemove && (
        <button
          className="bar__ctrl tracktable__more"
          aria-label={`Remove ${track.title} from queue`}
          title="Remove from queue"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <CloseIcon size={13} />
        </button>
      )}
    </div>
  );
}
