import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import type { HomeSection, SongDto } from "../types";
import TopBar from "../components/TopBar";
import SectionRow from "../components/SectionRow";
import { usePlayerStore } from "../state/player";
import { loadPref } from "../utils/device";
import { PlayIcon } from "../components/Icons";

const MOODS = [
  { label: "Energize", query: "high energy workout hits" },
  { label: "Workout", query: "workout motivation mix" },
  { label: "Relax", query: "relaxing ambient chill" },
  { label: "Focus", query: "deep focus instrumental" },
  { label: "Party", query: "party anthems mix" },
];

interface BillboardPref {
  enabled: boolean;
  chart: string;
  region: string;
}

function readBillboardPref(): BillboardPref {
  const raw = loadPref("orca.billboard", "");
  if (!raw) return { enabled: false, chart: "hot100", region: "global" };
  try {
    const parsed = JSON.parse(raw) as Partial<BillboardPref>;
    return {
      enabled: Boolean(parsed.enabled),
      chart: parsed.chart ?? "hot100",
      region: parsed.region ?? "global",
    };
  } catch {
    return { enabled: false, chart: "hot100", region: "global" };
  }
}

const CHART_LABEL: Record<string, string> = {
  hot100: "Hot 100",
  viral: "Viral hits",
  new: "New releases",
};

const REGION_LABEL: Record<string, string> = {
  global: "Global",
  us: "United States",
  uk: "United Kingdom",
  vietnam: "Việt Nam",
  korea: "Korea",
  japan: "Japan",
};

export default function HomePage() {
  const [sections, setSections] = useState<HomeSection[]>([]);
  const [billboard, setBillboard] = useState<SongDto[]>([]);
  const [recent, setRecent] = useState<SongDto[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const billboardPref = useMemo(readBillboardPref, []);

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

  useEffect(() => {
    if (!billboardPref.enabled) return;
    let live = true;
    api
      .billboard(billboardPref.chart, billboardPref.region)
      .then((songs) => {
        if (live) setBillboard(songs);
      })
      .catch(() => {
        if (live) setBillboard([]);
      });
    return () => {
      live = false;
    };
  }, [billboardPref]);

  /* Continue listening — the user's own history (best-effort). */
  useEffect(() => {
    let live = true;
    api
      .history(14)
      .then((res) => {
        if (live) setRecent(res.history.slice(0, 14));
      })
      .catch(() => {
        /* history is best-effort — the shelf simply stays hidden */
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
        <div className="chips" role="list">
          {MOODS.map((m) => (
            <button
              key={m.label}
              role="listitem"
              className="chip"
              onClick={() => navigate(`/search?q=${encodeURIComponent(m.query)}`)}
            >
              {m.label}
            </button>
          ))}
        </div>
        {loading && (
          <>
            <div className="page__quickgrid" aria-hidden="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="skeleton skeleton--quick" />
              ))}
            </div>
            {[0, 1].map((row) => (
              <section key={row} className="section">
                <div className="skeleton skeleton--card" style={{ width: 180, height: 18 }} />
                <div className="section__row">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="skeleton skeleton--card" style={{ width: 180 }} />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
        {error && <p className="page__error">{error}</p>}
        {!loading && !error && sections.length === 0 && (
          <p className="page__note">The ocean is quiet right now. Try Search.</p>
        )}
        {heroTracks.length > 0 && (
          <section className="section">
            <div className="section__head">
              <h2 className="section__title">Quick Picks</h2>
            </div>
            <div className="page__quickgrid">
              {heroTracks.map((t, i) => (
                <button
                  key={`${t.videoId}-${i}`}
                  className="quickcard"
                  onClick={() => {
                    navigate(`/track/${encodeURIComponent(t.videoId)}`);
                    play(heroTracks, i, "home");
                  }}
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
          </section>
        )}
        {recent.length > 0 && (
          <SectionRow title="Continue listening" tracks={recent} context="home:recent" />
        )}
        {billboard.length > 0 && (
          <SectionRow
            title={`Billboard ${CHART_LABEL[billboardPref.chart] ?? "chart"} · ${
              REGION_LABEL[billboardPref.region] ?? ""
            }`}
            tracks={billboard}
            context="home:billboard"
          />
        )}
        {sections.map((s) => (
          <SectionRow key={s.title} title={s.title} tracks={s.tracks} context={`home:${s.title}`} />
        ))}
      </div>
    </div>
  );
}
