import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import type { HomeSection } from "../types";
import TopBar from "../components/TopBar";
import SectionRow from "../components/SectionRow";
import { usePlayerStore } from "../state/player";
import { PlayIcon } from "../components/Icons";

export default function HomePage() {
  const [sections, setSections] = useState<HomeSection[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    api
      .home()
      .then((res) => {
        if (live) {
          setSections(res.sections);
          setError("");
        }
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : "Something went wrong");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 5) return "Late night currents";
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  const heroTracks = sections[0]?.tracks.slice(0, 8) ?? [];
  const play = usePlayerStore((s) => s.play);

  return (
    <div className="page">
      <TopBar title="Orca" />
      <div className="page__hero" />
      <div className="page__body">
        <h1 className="page__greeting">{greeting}</h1>
        {loading && <p className="page__note">Summoning the currents…</p>}
        {error && <p className="page__error">{error}</p>}
        {!loading && !error && sections.length === 0 && (
          <p className="page__note">The ocean is quiet right now. Try Search.</p>
        )}
        {heroTracks.length > 0 && (
          <div className="page__quickgrid">
            {heroTracks.map((t, i) => (
              <button
                key={t.videoId}
                className="quickcard"
                onClick={() => play(heroTracks, i, "home")}
                title={`Play ${t.title} — ${t.artist}`}
              >
                {t.artworkUrl ? (
                  <img src={t.artworkUrl} alt="" loading="lazy" />
                ) : (
                  <span className="quickcard__fallback">{t.title.charAt(0).toUpperCase()}</span>
                )}
                <span className="quickcard__title">{t.title}</span>
                <span className="quickcard__play" aria-hidden="true">
                  <PlayIcon size={16} />
                </span>
              </button>
            ))}
          </div>
        )}
        {sections.map((s) => (
          <SectionRow key={s.title} title={s.title} tracks={s.tracks} context={`home:${s.title}`} />
        ))}
      </div>
    </div>
  );
}
