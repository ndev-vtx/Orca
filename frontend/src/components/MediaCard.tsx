import type { SongDto } from "../types";
import { useLibraryStore } from "../state/libraryStore";
import { usePlayerStore } from "../state/player";
import { PlayIcon, PauseIcon, HeartIcon, HeartOutlineIcon } from "./Icons";

interface MediaCardProps {
  song: SongDto;
  roundArt?: boolean;
  subtitle?: string;
  queue?: SongDto[];
  index?: number;
  context?: string;
}

export default function MediaCard({
  song,
  roundArt = false,
  subtitle,
  queue,
  index = 0,
  context = "manual",
}: MediaCardProps) {
  const saved = useLibraryStore((s) => s.savedIds.has(song.videoId));
  const toggleSaved = useLibraryStore((s) => s.toggleSaved);
  const currentId = usePlayerStore((s) => s.current?.videoId ?? null);
  const playing = usePlayerStore((s) => s.playing);
  const play = usePlayerStore((s) => s.play);
  const playSong = usePlayerStore((s) => s.playSong);
  const isCurrent = currentId === song.videoId;

  const start = () => {
    if (queue && queue.length > 0) {
      play(queue, index, context);
    } else {
      playSong(song, context);
    }
  };

  return (
    <div
      className={`card${isCurrent ? " card--active" : ""}`}
      role="button"
      tabIndex={0}
      onClick={start}
      onKeyDown={(e) => {
        if (e.key === "Enter") start();
      }}
      title={`${song.title} — ${song.artist}`}
    >
      <div className={`card__art${roundArt ? " card__art--round" : ""}`}>
        {song.artworkUrl ? (
          <img src={song.artworkUrl} alt={song.title} loading="lazy" />
        ) : (
          <div className="card__art-fallback" aria-hidden="true">
            {song.title.charAt(0).toUpperCase()}
          </div>
        )}
        <span
          role="button"
          tabIndex={0}
          className={`card__play${isCurrent && playing ? " card__play--on" : ""}`}
          aria-label={`Play ${song.title}`}
          onClick={(e) => {
            e.stopPropagation();
            start();
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
          }}
        >
          {isCurrent && playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
        </span>
        <span
          role="button"
          tabIndex={0}
          className={`card__heart${saved ? " card__heart--on" : ""}`}
          aria-label={saved ? `Remove ${song.title} from library` : `Save ${song.title} to library`}
          onClick={(e) => {
            e.stopPropagation();
            void toggleSaved(song);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
          }}
        >
          {saved ? <HeartIcon size={15} /> : <HeartOutlineIcon size={15} />}
        </span>
      </div>
      <div className="card__meta">
        <span className="card__title">{song.title}</span>
        <span className="card__sub">{subtitle ?? song.artist ?? ""}</span>
      </div>
    </div>
  );
}
