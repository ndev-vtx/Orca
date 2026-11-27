import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../services/api";
import type { LyricLine, SongDto, TrackDetail } from "../types";
import TopBar from "../components/TopBar";
import { MusicTile } from "../components/Shared";
import {
  HeartIcon,
  HeartOutlineIcon,
  MoreIcon,
  PauseIcon,
  PlayIcon,
} from "../components/Icons";
import { usePlayerStore } from "../state/player";
import { useLibraryStore } from "../state/libraryStore";
import { useUiStore } from "../state/uiStore";

/** Session-scoped lyric cache so revisiting a track doesn't re-fetch. */
const lyricsCache = new Map<
  string,
  { lines: LyricLine[]; plain: string | null; status: "ready" | "empty" | "error" }
>();

/**
 * Rich track detail view: large cover, "Bài hát" badge, metadata, play /
 * add-to-playlist / save / menu actions, the lyrics section right below and
 * "Đề xuất" (suggestions from the song radio) underneath that.
 */
export default function TrackPage() {
  const { videoId } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<TrackDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const play = usePlayerStore((s) => s.play);
  const current = usePlayerStore((s) => s.current);
  const playing = usePlayerStore((s) => s.playing);
  const positionMs = usePlayerStore((s) => s.positionMs);
  const toggle = usePlayerStore((s) => s.toggle);
  const notify = usePlayerStore((s) => s.notify);
  const lyricsOpen = usePlayerStore((s) => s.lyricsOpen);
  const toggleLyrics = usePlayerStore((s) => s.toggleLyrics);
  const seek = usePlayerStore((s) => s.seek);

  const savedIds = useLibraryStore((s) => s.savedIds);
  const toggleSaved = useLibraryStore((s) => s.toggleSaved);
  const openMenu = useUiStore((s) => s.openMenu);
  const openPicker = useUiStore((s) => s.openPicker);

  const [similar, setSimilar] = useState<SongDto[]>([]);
  // Lyrics for THIS page's track — decoupled from the playing track that the
  // global lyrics panel follows, so browsing any /track/:id shows its own words.
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [lyricsPlain, setLyricsPlain] = useState<string | null>(null);
  const [lyricsStatus, setLyricsStatus] = useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const lyricsBodyRef = useRef<HTMLDivElement | null>(null);

  const song: SongDto | null = detail?.song ?? null;
  const isCurrent = Boolean(current && song && current.videoId === song.videoId);
  const saved = song ? savedIds.has(song.videoId) : false;

  useEffect(() => {
    let live = true;
    setLoading(true);
    setDetail(null);
    setSimilar([]);
    setError("");
    api
      .track(videoId ?? "")
      .then((d) => {
        if (live) setDetail(d);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : "Track could not be loaded");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    api
      .similar(videoId ?? "")
      .then((list) => {
        if (live) setSimilar(list.filter((t) => t.videoId !== videoId));
      })
      .catch(() => {
        /* suggestions are best-effort */
      });
    return () => {
      live = false;
    };
  }, [videoId]);

  // Lyrics follow the page's own track, not necessarily the playing one.
  // Results are cached per videoId for the session.
  useEffect(() => {
    const target = song?.videoId;
    if (!target) return;
    const cached = lyricsCache.get(target);
    if (cached) {
      setLyrics(cached.lines);
      setLyricsPlain(cached.plain);
      setLyricsStatus(cached.status);
      return;
    }
    let live = true;
    setLyrics([]);
    setLyricsPlain(null);
    setLyricsStatus("loading");
    api
      .lyrics(song)
      .then((res) => {
        if (!live) return;
        const lines = res.parsed ?? [];
        const plain = res.plain ?? res.synced ?? null;
        const status = lines.length > 0 || plain ? ("ready" as const) : ("empty" as const);
        lyricsCache.set(target, { lines, plain, status });
        setLyrics(lines);
        setLyricsPlain(plain);
        setLyricsStatus(status);
      })
      .catch(() => {
        if (live) setLyricsStatus("error");
      });
    return () => {
      live = false;
    };
  }, [song]);

  const activeIdx = useMemo(() => {
    if (!isCurrent || lyrics.length === 0) return -1;
    let idx = -1;
    for (let i = 0; i < lyrics.length; i += 1) {
      if (lyrics[i].timeMs <= positionMs) idx = i;
      else break;
    }
    return idx;
  }, [isCurrent, lyrics, positionMs]);

  useEffect(() => {
    if (activeIdx < 0) return;
    const line = lineRefs.current[activeIdx];
    const body = lyricsBodyRef.current;
    if (!line || !body) return;
    body.scrollTo({ top: line.offsetTop - body.clientHeight / 2 + line.clientHeight / 2 });
  }, [activeIdx]);

  const playSong = () => {
    if (!song) return;
    if (isCurrent) {
      toggle();
      return;
    }
    play([song], 0, "track");
  };

  const menuAnchor = (e: React.MouseEvent) => {
    if (!song) return;
    e.stopPropagation();
    openMenu(song, { x: e.clientX, y: e.clientY }, detail?.albumId ? { albumId: detail.albumId } : undefined);
  };

  const meta: string[] = [];
  if (detail?.artist) meta.push(detail.artist);
  if (detail?.album) meta.push(detail.album);
  if (detail?.year) meta.push(detail.year);
  if (detail?.duration) meta.push(detail.duration);

  return (
    <div className="page">
      <TopBar title={detail?.title ?? "Track"} />
      <div className="page__hero" />
      <div className="page__body">
        {loading && <p className="page__note">Opening the track…</p>}
        {error && (
          <>
            <p className="page__error">{error}</p>
            <button className="pill" onClick={() => navigate(-1)}>
              Go back
            </button>
          </>
        )}
        {detail && song && (
          <>
            <div className="trackhead">
              {detail.artworkUrl ? (
                <img className="trackhead__cover" src={detail.artworkUrl} alt={detail.title} />
              ) : (
                <MusicTile seed={detail.title} size={220} />
              )}
              <div className="trackhead__meta">
                <p className="trackhead__badge">Bài hát</p>
                <h1 className="trackhead__title" title={detail.title}>
                  {detail.title}
                </h1>
                <p className="trackhead__sub">{meta.join(" · ")}</p>
                <div className="trackhead__actions">
                  <button className="btn-play" aria-label={isCurrent && playing ? "Pause" : "Play"} onClick={playSong}>
                    {isCurrent && playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
                  </button>
                  <button
                    className="pill"
                    aria-label="Add to playlist"
                    title="Add to playlist"
                    onClick={() => openPicker(song)}
                  >
                    +
                  </button>
                  <button
                    className={`pill pill--icon${saved ? " pill--active" : ""}`}
                    aria-label={saved ? "Remove from Liked Songs" : "Save to Liked Songs"}
                    title={saved ? "Remove from Liked Songs" : "Save to Liked Songs"}
                    onClick={() => void toggleSaved(song)}
                  >
                    {saved ? <HeartIcon size={15} /> : <HeartOutlineIcon size={15} />}
                  </button>
                  <button
                    className="pill pill--icon"
                    aria-label="More options"
                    title="More options"
                    onClick={menuAnchor}
                  >
                    <MoreIcon size={15} />
                  </button>
                </div>
              </div>
            </div>

            <section className="tracklyrics">
              <div className="tracklyrics__head">
                <h2 className="section__title">Lời bài hát</h2>
                <button className="pill" onClick={toggleLyrics} title="Open the full lyrics panel">
                  {lyricsOpen ? "Close panel" : "Open panel"}
                </button>
              </div>
              <div className="tracklyrics__body" ref={lyricsBodyRef}>
                {lyricsStatus === "loading" && <p className="page__note">Reading the current…</p>}
                {lyricsStatus === "error" && <p className="page__note">Lyrics could not be loaded.</p>}
                {lyricsStatus === "empty" && (
                  <p className="page__note">No lyrics found for this track. Instrumental currents, perhaps.</p>
                )}
                {lyricsStatus === "ready" && lyrics.length === 0 && lyricsPlain && (
                  <div className="lyrics__plain">{lyricsPlain}</div>
                )}
                {lyricsStatus === "ready" && lyrics.length === 0 && !lyricsPlain && (
                  <p className="page__note">No lyrics available.</p>
                )}
                {lyrics.length > 0 &&
                  lyrics.map((line, i) => (
                    <button
                      key={`${line.timeMs}-${i}`}
                      ref={(el) => {
                        lineRefs.current[i] = el;
                      }}
                      className={`lyrics__line${i === activeIdx ? " lyrics__line--active" : ""}`}
                      onClick={() => {
                        if (!isCurrent) {
                          play([song], 0, "track");
                          notify("Playing from this line");
                          return;
                        }
                        seek(line.timeMs);
                      }}
                      title="Jump to this line"
                    >
                      {line.text}
                    </button>
                  ))}
              </div>
            </section>

            <section className="tracksimilar">
              <h2 className="section__title">Đề xuất</h2>
              <p className="page__byline">Tracks the radio puts next to this song.</p>
              {similar.length === 0 ? (
                <p className="page__note">No suggestions right now — try again later.</p>
              ) : (
                <div className="tracktable">
                  {similar.map((t, i) => (
                    <TrackRow key={`${t.videoId}-${i}`} track={t} index={i} onPlay={() => play(similar, i, `radio:${song.videoId}`)} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export function TrackRow({
  track,
  index,
  onPlay,
}: {
  track: SongDto;
  index: number;
  onPlay: () => void;
}) {
  const currentId = usePlayerStore((s) => s.current?.videoId ?? null);
  const openMenu = useUiStore((s) => s.openMenu);
  return (
    <div
      className={`tracktable__row${currentId === track.videoId ? " tracktable__row--active" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={(e) => {
        if (e.key === "Enter") onPlay();
      }}
    >
      <span className="tracktable__num">{index + 1}</span>
      {track.artworkUrl && <img src={track.artworkUrl} alt="" loading="lazy" />}
      <span className="tracktable__title">
        {track.title}
        <em>{track.artist}</em>
      </span>
      <span className="tracktable__dur">{track.duration}</span>
      <button
        className="bar__ctrl tracktable__more"
        aria-label="More options"
        onClick={(e) => {
          e.stopPropagation();
          openMenu(track, { x: e.clientX, y: e.clientY });
        }}
      >
        <MoreIcon size={15} />
      </button>
    </div>
  );
}
