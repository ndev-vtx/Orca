/*
 * PlaylistPage.tsx
 * Spotify-standard playlist view: collage cover, editable title, total
 * duration, Play + Shuffle, in-playlist filter + sort, album / date-added
 * columns, equalizer indicator on the playing row, an armed delete button,
 * and a "Find something" CTA when the playlist is empty.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../services/api";
import type { PlaylistDetail, PlaylistTrackDto } from "../types";
import TopBar from "../components/TopBar";
import {
  PlayIcon,
  PauseIcon,
  MoreIcon,
  TrashIcon,
  ShuffleIcon,
  SearchIcon,
} from "../components/Icons";
import { MusicTile } from "../components/Shared";
import { useLibraryStore } from "../state/libraryStore";
import { usePlayerStore } from "../state/player";
import { useUiStore } from "../state/uiStore";

type SortKey = "custom" | "title" | "artist" | "album" | "recent";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "custom", label: "Custom order" },
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
  { key: "album", label: "Album" },
  { key: "recent", label: "Recently added" },
];

function durationSeconds(raw: string): number {
  const parts = (raw || "").split(":").map((p) => Number.parseInt(p, 10));
  if (parts.some((p) => Number.isNaN(p)) || parts.length < 2) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function formatTotal(seconds: number): string {
  if (seconds <= 0) return "0 min";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} hr ${m} min` : `${Math.max(1, m)} min`;
}

function formatDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/* First up to four unique artworks for the header collage. */
function collageArts(tracks: PlaylistTrackDto[]): string[] {
  const arts: string[] = [];
  for (const t of tracks) {
    if (t.artworkUrl && !arts.includes(t.artworkUrl)) arts.push(t.artworkUrl);
    if (arts.length === 4) break;
  }
  return arts;
}

export default function PlaylistPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const playlistId = Number(id);
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("custom");
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const deleteTimer = useRef<number | null>(null);
  const savedIds = useLibraryStore((s) => s.savedIds);
  const deletePlaylist = useLibraryStore((s) => s.deletePlaylist);
  const renamePlaylist = useLibraryStore((s) => s.renamePlaylist);
  const playlistVersion = useLibraryStore((s) => s.playlistVersion);
  const openMenu = useUiStore((s) => s.openMenu);
  const play = usePlayerStore((s) => s.play);
  const setShuffle = usePlayerStore((s) => s.setShuffle);
  const currentId = usePlayerStore((s) => s.current?.videoId ?? null);
  const playing = usePlayerStore((s) => s.playing);

  useEffect(() => {
    if (!Number.isFinite(playlistId)) return;
    let live = true;
    api
      .playlist(playlistId)
      .then((d) => {
        if (live) setDetail(d);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : "Playlist unavailable");
      });
    return () => {
      live = false;
    };
  }, [playlistId, playlistVersion]);

  /* Disarm the delete button when clicking elsewhere / unmounting. */
  useEffect(() => {
    if (!deleteArmed) return;
    const disarm = () => setDeleteArmed(false);
    window.addEventListener("click", disarm);
    return () => {
      window.removeEventListener("click", disarm);
      if (deleteTimer.current !== null) window.clearTimeout(deleteTimer.current);
    };
  }, [deleteArmed]);

  const displayTracks = useMemo<PlaylistTrackDto[]>(() => {
    const tracks = detail?.tracks ?? [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? tracks.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.artist.toLowerCase().includes(q) ||
            (t.album ?? "").toLowerCase().includes(q),
        )
      : tracks;
    if (sortKey === "custom") return filtered;
    const sorted = [...filtered];
    switch (sortKey) {
      case "title":
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "artist":
        sorted.sort((a, b) => a.artist.localeCompare(b.artist));
        break;
      case "album":
        sorted.sort((a, b) => (a.album ?? "").localeCompare(b.album ?? ""));
        break;
      case "recent":
        sorted.sort((a, b) => Date.parse(b.addedAt ?? "") - Date.parse(a.addedAt ?? ""));
        break;
    }
    return sorted;
  }, [detail, query, sortKey]);

  const savedCount = detail ? detail.tracks.filter((t) => savedIds.has(t.videoId)).length : 0;
  const totalSeconds = detail
    ? detail.tracks.reduce((acc, t) => acc + durationSeconds(t.duration), 0)
    : 0;
  const arts = detail ? collageArts(detail.tracks) : [];
  const isPlayingHere = !!(
    detail &&
    playing &&
    detail.tracks.some((t) => t.videoId === currentId)
  );

  const playAll = () => {
    if (!detail || detail.tracks.length === 0) return;
    play(detail.tracks, 0, `playlist:${detail.name}`);
  };

  const playShuffled = () => {
    if (!detail || detail.tracks.length === 0) return;
    setShuffle(true);
    play(
      detail.tracks,
      Math.floor(Math.random() * detail.tracks.length),
      `playlist:${detail.name}`,
    );
  };

  const playRow = (index: number) => {
    if (!detail) return;
    play(displayTracks, index, `playlist:${detail.name}`);
  };

  const startRename = () => {
    if (!detail) return;
    setDraftName(detail.name);
    setRenaming(true);
  };

  const commitRename = async () => {
    const name = draftName.trim();
    setRenaming(false);
    if (!detail || !name || name === detail.name) return;
    try {
      await renamePlaylist(playlistId, name);
      setDetail({ ...detail, name });
    } catch {
      setDetail({ ...detail });
    }
  };

  const removePlaylist = async () => {
    if (deleteTimer.current !== null) window.clearTimeout(deleteTimer.current);
    if (!deleteArmed) {
      setDeleteArmed(true);
      deleteTimer.current = window.setTimeout(() => setDeleteArmed(false), 3000);
      return;
    }
    setDeleteArmed(false);
    await deletePlaylist(playlistId);
    navigate("/library");
  };

  return (
    <div className="page">
      <TopBar title={detail?.name ?? "Playlist"} />
      <div className="page__hero page__hero--tall plhead__hero" />
      <div className="page__body">
        <div className="page__header">
          {arts.length >= 4 ? (
            <div className="plhead__collage" aria-hidden="true">
              {arts.map((art) => (
                <img key={art} src={art} alt="" loading="lazy" />
              ))}
            </div>
          ) : (
            <MusicTile seed={detail?.name ?? "playlist"} size={140} />
          )}
          <div>
            <p className="page__eyebrow">Playlist</p>
            {renaming ? (
              <input
                className="plhead__rename"
                value={draftName}
                autoFocus
                maxLength={200}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => void commitRename()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commitRename();
                  if (e.key === "Escape") setRenaming(false);
                }}
                aria-label="Playlist name"
              />
            ) : (
              <h1
                className="page__name plhead__name"
                role="button"
                tabIndex={0}
                title="Rename playlist"
                onClick={startRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") startRename();
                }}
              >
                {detail?.name ?? (error ? "Not found" : "Loading…")}
              </h1>
            )}
            <p className="page__byline">
              {detail
                ? `${detail.trackCount} tracks · ${formatTotal(totalSeconds)} · saved ${savedCount} · Orca`
                : ""}
            </p>
            {!error && detail && (
              <div className="page__actions">
                <button
                  className="btn-play"
                  aria-label={`Play ${detail.name}`}
                  onClick={playAll}
                  disabled={detail.tracks.length === 0}
                >
                  {isPlayingHere ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
                </button>
                <button
                  className="bar__ctrl"
                  aria-label="Shuffle playlist"
                  title="Shuffle play"
                  onClick={playShuffled}
                  disabled={detail.tracks.length === 0}
                >
                  <ShuffleIcon size={16} />
                </button>
                <button
                  className="bar__ctrl"
                  aria-label="Rename playlist"
                  title="Rename"
                  onClick={startRename}
                >
                  <span className="plhead__editglyph" aria-hidden="true">✎</span>
                </button>
                <button
                  className={`bar__ctrl${deleteArmed ? " plhead__delete--armed" : ""}`}
                  aria-label={deleteArmed ? "Tap again to delete playlist" : "Delete playlist"}
                  title={deleteArmed ? "Tap again to delete" : "Delete playlist"}
                  onClick={(e) => {
                    e.stopPropagation();
                    void removePlaylist();
                  }}
                >
                  <TrashIcon size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
        {error && <p className="page__error">{error}</p>}
        {detail && (
          <>
            {detail.tracks.length > 0 && (
              <div className="pltoolbar">
                <label className="pltoolbar__search">
                  <SearchIcon size={14} />
                  <input
                    value={query}
                    placeholder="Search in playlist"
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search in playlist"
                  />
                </label>
                <select
                  className="pltoolbar__sort"
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  aria-label="Sort playlist"
                >
                  {SORTS.map((s) => (
                    <option key={s.key} value={s.key}>
                      Sort: {s.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={`tracktable${detail.tracks.length > 0 ? " tracktable--full" : ""}`}>
              {detail.tracks.length === 0 && (
                <div className="plempty">
                  <p className="page__note">This playlist is empty.</p>
                  <button className="plempty__cta" onClick={() => navigate("/search")}>
                    Find something for this playlist
                  </button>
                </div>
              )}
              {displayTracks.length === 0 && detail.tracks.length > 0 && (
                <p className="page__note">No tracks match “{query.trim()}”.</p>
              )}
              {displayTracks.map((t, i) => {
                const active = currentId === t.videoId;
                return (
                  <div
                    key={`${t.videoId}-${i}`}
                    className={`tracktable__row${active ? " tracktable__row--active" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => playRow(i)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") playRow(i);
                    }}
                  >
                    <span className="tracktable__num">
                      {active && playing ? (
                        <span className="eqbars" aria-label="Now playing">
                          <i />
                          <i />
                          <i />
                        </span>
                      ) : (
                        i + 1
                      )}
                    </span>
                    {t.artworkUrl && <img src={t.artworkUrl} alt="" loading="lazy" />}
                    <span className="tracktable__title">
                      {t.title}
                      <em>{t.artist}</em>
                    </span>
                    <span className="tracktable__album">{t.album || "—"}</span>
                    <span className="tracktable__added">{formatDate(t.addedAt ?? "")}</span>
                    <span className="tracktable__dur">{t.duration}</span>
                    <button
                      className="bar__ctrl tracktable__more"
                      aria-label={`More options for ${t.title}`}
                      title="More options"
                      onClick={(e) => {
                        e.stopPropagation();
                        openMenu(t, { x: e.clientX, y: e.clientY }, { playlistId });
                      }}
                    >
                      <MoreIcon size={15} />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
