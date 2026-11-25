import TopBar from "../components/TopBar";
import { MusicTile } from "../components/Shared";
import { PauseIcon, PlayIcon } from "../components/Icons";
import { usePlayerStore } from "../state/player";

export default function QueuePage() {
  const queue = usePlayerStore((s) => s.queue);
  const cursor = usePlayerStore((s) => s.cursor);
  const current = usePlayerStore((s) => s.current);
  const playing = usePlayerStore((s) => s.playing);
  const playAt = usePlayerStore((s) => s.playAt);
  const shuffleUpcoming = usePlayerStore((s) => s.shuffleUpcoming);
  const autoQueue = usePlayerStore((s) => s.autoQueue);
  const setAutoQueue = usePlayerStore((s) => s.setAutoQueue);

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
                <QueueRow key={`next-${t.videoId}-${i}`} track={t} index={i + currentIdx + 1} onPlay={playAt} />
              ))}
            </div>
          </>
        )}

        {currentIdx < 0 && queue.length > 0 && (
          <div className="tracktable">
            {queue.map((t, i) => (
              <QueueRow key={`all-${t.videoId}-${i}`} track={t} index={i} onPlay={playAt} />
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
  showState = false,
}: {
  track: { videoId: string; title: string; artist: string; duration: string; artworkUrl: string };
  index: number;
  onPlay: (index: number) => void;
  showState?: boolean;
}) {
  return (
    <div
      className="tracktable__row"
      role="button"
      tabIndex={0}
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
    </div>
  );
}
