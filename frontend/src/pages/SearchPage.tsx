import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../services/api";
import type { SearchFilter, SongDto } from "../types";
import TopBar from "../components/TopBar";
import MediaCard from "../components/MediaCard";
import { SearchIcon } from "../components/Icons";
import { SEARCH_DEBOUNCE_MS } from "../state/players";

const FILTERS: { id: SearchFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "songs", label: "Songs" },
  { id: "videos", label: "Videos" },
  { id: "artists", label: "Artists" },
  { id: "albums", label: "Albums" },
  { id: "playlists", label: "Playlists" },
];

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const [draft, setDraft] = useState(query);
  const [filter, setFilter] = useState<SearchFilter>("all");
  const [results, setResults] = useState<SongDto[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setDraft(query);
  }, [query]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setError("");
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      api
        .search({ query: trimmed, filter })
        .then((items) => {
          if (live) {
            setResults(items);
            setError("");
          }
        })
        .catch((err: unknown) => {
          if (live) setError(err instanceof Error ? err.message : "Search failed");
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query, filter]);

  return (
    <div className="page">
      <TopBar title="Search" />
      <div className="page__hero" />
      <div className="page__body">
        <div className="searchbar">
          <SearchIcon size={18} />
          <input
            autoFocus
            placeholder="Songs, artists, albums, or paste a link"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setParams(e.target.value ? { q: e.target.value } : {}, { replace: true });
            }}
            aria-label="Search"
          />
        </div>
        <div className="page__pills">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={`pill${filter === f.id ? " pill--active" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {loading && <p className="page__note">Drilling through the depths…</p>}
        {error && <p className="page__error">{error}</p>}
        {!loading && !error && query.trim() && results.length === 0 && (
          <p className="page__note">No results for “{query}”.</p>
        )}
        <div className="page__grid">
          {results.map((t) => (
            <MediaCard key={`${filter}-${t.videoId}`} song={t} roundArt={t.type === "artist"} />
          ))}
        </div>
        {!query.trim() && (
          <div className="page__empty">
            <h2>Dive in</h2>
            <p>Search YouTube Music, or paste a YouTube / Spotify playlist link — Orca pulls it all in.</p>
          </div>
        )}
      </div>
    </div>
  );
}
