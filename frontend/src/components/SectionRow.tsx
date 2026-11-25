import type { SongDto } from "../types";
import { usePlayerStore } from "../state/player";
import MediaCard from "./MediaCard";

interface SectionRowProps {
  title: string;
  tracks: SongDto[];
  roundArt?: boolean;
  context?: string;
}

export default function SectionRow({
  title,
  tracks,
  roundArt = false,
  context = "home",
}: SectionRowProps) {
  const play = usePlayerStore((s) => s.play);

  if (tracks.length === 0) return null;
  return (
    <section className="section">
      <div className="section__head">
        <h2 className="section__title">{title}</h2>
        <button
          className="section__playall"
          onClick={() => play(tracks, 0, context)}
          disabled={tracks.length === 0}
        >
          Play all
        </button>
      </div>
      <div className="section__row">
        {tracks.map((t, i) => (
          <MediaCard
            key={`${title}-${t.videoId}`}
            song={t}
            roundArt={roundArt}
            queue={tracks}
            index={i}
            context={context}
          />
        ))}
      </div>
    </section>
  );
}
