import type { SongDto } from "../types";
import { useNavigate } from "react-router-dom";
import { useUiStore } from "../state/uiStore";
import { usePlayerStore } from "../state/player";
import { PlayIcon, PauseIcon, MoreIcon, PlusIcon } from "./Icons";

interface MediaCardProps {
  song: SongDto;
  roundArt?: boolean;
  subtitle?: string;
  queue?: SongDto[];
  index?: number;
  context?: string;
}

/*
 * Album AND playlist results arrive with a browse id (MPRE… albums, VL…
 * playlists) in the videoId field — the id is a browse target, not a playable
 * video, so the card opens the album/playlist page instead of trying to play.
 */
export function isAlbumEntry(song: SongDto): boolean {
  const kind = (song.type ?? "").toLowerCase();
  if (kind === "album" || kind === "albums") return true;
  if (kind === "playlist") return song.videoId.startsWith("MPRE") || song.videoId.startsWith("VL");
  return false;
}

export default function MediaCard({
  song,
  roundArt = false,
  subtitle,
  queue,
  index = 0,
  context = "manual",
}: MediaCardProps) {
  const navigate = useNavigate();
  const openMenu = useUiStore((s) => s.openMenu);
  const openPicker = useUiStore((s) => s.openPicker);
  const currentId = usePlayerStore((s) => s.current?.videoId ?? null);
  const playing = usePlayerStore((s) => s.playing);
  const play = usePlayerStore((s) => s.play);
  const playSong = usePlayerStore((s) => s.playSong);
  const isCurrent = currentId === song.videoId;
  const isAlbum = isAlbumEntry(song);

  const start = () => {
    if (queue && queue.length > 0) {
      play(queue, index, context);
    } else {
      playSong(song, context);
    }
  };

  const open = () => {
    if (isAlbum) {
      navigate(`/album/${encodeURIComponent(song.videoId)}`);
      return;
    }
    navigate(`/track/${encodeURIComponent(song.videoId)}`);
    start();
  };

  return (
    <div
      className={`card${isCurrent ? " card--active" : ""}`}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter") open();
      }}
      title={isAlbum ? `Open ${song.title}` : `${song.title} — ${song.artist}`}
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
          aria-label={isAlbum ? `Open ${song.title}` : `Play ${song.title}`}
          onClick={(e) => {
            e.stopPropagation();
            open();
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
          }}
        >
          {isAlbum ? (
            <PlayIcon size={18} />
          ) : isCurrent && playing ? (
            <PauseIcon size={18} />
          ) : (
            <PlayIcon size={18} />
          )}
        </span>
        {!isAlbum && (
          <span
            role="button"
            tabIndex={0}
            className="card__heart"
            aria-label={`Add ${song.title} to playlist`}
            title="Add to playlist"
            onClick={(e) => {
              e.stopPropagation();
              openPicker(song);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
            }}
          >
            <PlusIcon size={15} />
          </span>
        )}
        {!isAlbum && (
          <span
            role="button"
            tabIndex={0}
            className="card__more"
            aria-label={`More options for ${song.title}`}
            title="More options"
            onClick={(e) => {
              e.stopPropagation();
              openMenu(song, { x: e.clientX, y: e.clientY });
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
            }}
          >
            <MoreIcon size={15} />
          </span>
        )}
      </div>
      <div className="card__meta">
        <span className="card__title">{song.title}</span>
        <span className="card__sub">{subtitle ?? song.artist ?? ""}</span>
      </div>
    </div>
  );
}
