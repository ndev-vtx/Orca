import { useNavigate } from "react-router-dom";
import type { SongDto } from "../types";
import { useLibraryStore } from "../state/libraryStore";
import { PlayIcon, HeartIcon, HeartOutlineIcon } from "./Icons";

interface MediaCardProps {
  song: SongDto;
  roundArt?: boolean;
  subtitle?: string;
}

export default function MediaCard({ song, roundArt = false, subtitle }: MediaCardProps) {
  const navigate = useNavigate();
  const saved = useLibraryStore((s) => s.savedIds.has(song.videoId));
  const toggleSaved = useLibraryStore((s) => s.toggleSaved);

  return (
    <div
      className="card"
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/search?q=${encodeURIComponent(song.artist || song.title)}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          navigate(`/search?q=${encodeURIComponent(song.artist || song.title)}`);
        }
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
          className="card__play"
          aria-label={`Play ${song.title}`}
          onClick={(e) => {
            e.stopPropagation();
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
          }}
        >
          <PlayIcon size={18} />
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
