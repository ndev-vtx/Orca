import type { SongDto } from "../types";
import MediaCard from "./MediaCard";

interface SectionRowProps {
  title: string;
  tracks: SongDto[];
  roundArt?: boolean;
}

export default function SectionRow({ title, tracks, roundArt = false }: SectionRowProps) {
  if (tracks.length === 0) return null;
  return (
    <section className="section">
      <h2 className="section__title">{title}</h2>
      <div className="section__row">
        {tracks.map((t) => (
          <MediaCard key={`${title}-${t.videoId}`} song={t} roundArt={roundArt} />
        ))}
      </div>
    </section>
  );
}
