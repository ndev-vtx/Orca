import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../services/api";
import { ambientGradient, useAmbientColor } from "../utils/ambient";
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
import { getLyrics, putLyrics } from "../state/lyricsCache";
import { useLibraryStore } from "../state/libraryStore";
import { useUiStore } from "../state/uiStore";
import { lookupSong, rememberSong } from "../state/trackCache";

/** Session + localStorage lyric cache so revisiting a track never re-fetches. */

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
  const queue = usePlayerStore((s) => s.queue);
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
  /* Auto-follow + user-scroll pause (same contract as LyricsPanel). */
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  const prevActiveRef = useRef(-1);

  /*
   * The player already knows this track (the bottom bar and the NOW PLAYING
   * panel show the real title/artist), so the page must too: prefer the live
   * player entry, then the queue, then the session cache of every song that
   * has played. This keeps /track/:id from degrading to "Unknown track" when
   * the backend lookup is bot-flagged or fails.
   */
  const storeSong: SongDto | null = useMemo(() => {
    if (!videoId) return null;
    if (current?.videoId === videoId) return current;
    return queue.find((t) => t.videoId === videoId) ?? lookupSong(videoId);
  }, [videoId, current, queue]);

  /*
   * The backend can be bot-flagged for a specific video (get_song returns no
   * videoDetails) and then ships song: null. The IFrame player does not care
   * about that flag, so synthesize a playable SongDto from the detail shell
   * instead of rendering nothing — the track page always opens.
   * The fallback object MUST be memoized: TrackPage re-renders twice a second
   * with live playback position, and a fresh object here would re-run the
   * lyrics effect (and re-fetch) on every render. When nothing needs
   * backfilling the original object is returned untouched so its identity
   * (and the lyrics effect) stays stable.
   */
  const song: SongDto | null = useMemo(() => {
    const fill = (base: SongDto, from: SongDto): SongDto => {
      const title = base.title && base.title !== "Unknown track" ? base.title : from.title || base.title;
      if (
        title === base.title &&
        (base.artist || !from.artist) &&
        (base.artworkUrl || !from.artworkUrl) &&
        (base.duration || !from.duration) &&
        (base.album || !from.album)
      ) {
        return base;
      }
      return {
        ...base,
        title,
        artist: base.artist || from.artist || "",
        artworkUrl: base.artworkUrl || from.artworkUrl || "",
        duration: base.duration || from.duration || "",
        album: base.album || from.album || "",
      };
    };
    if (detail?.song) return storeSong ? fill(detail.song, storeSong) : detail.song;
    if (!detail) return storeSong;
    const shell: SongDto = {
      videoId: detail.videoId || videoId || "",
      title: detail.title || "Unknown track",
      artist: detail.artist ?? "",
      duration: detail.duration ?? "",
      artworkUrl: detail.artworkUrl ?? "",
      album: detail.album ?? "",
      type: "song",
    };
    return storeSong ? fill(shell, storeSong) : shell;
  }, [detail, storeSong, videoId]);
  const isCurrent = Boolean(current && song && current.videoId === song.videoId);
  const saved = song ? savedIds.has(song.videoId) : false;

  /* Spotify-style header glow from the cover art. */
  const ambientSource = song?.artworkUrl || detail?.artworkUrl || null;
  const ambient = useAmbientColor(ambientSource);
  const heroStyle = useMemo(() => {
    const gradient = ambientGradient(ambient);
    return gradient ? { background: gradient } : undefined;
  }, [ambient]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setDetail(null);
    setSimilar([]);
    setError("");
    api
      .track(videoId ?? "")
      .then((d) => {
        if (live) {
          if (d.song) rememberSong(d.song);
          setDetail(d);
        }
      })
      .catch((err: unknown) => {
        if (!live) return;
        /* With the player/cache fallback the page can still render fully —
           only surface the error when there is truly nothing to show. */
        if (!lookupSong(videoId) && current?.videoId !== videoId) {
          setError(err instanceof Error ? err.message : "Track could not be loaded");
        }
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
    prevActiveRef.current = -1;
    followRef.current = true;
    setFollow(true);
    const cached = getLyrics(target);
    if (cached) {
      setLyrics(cached.parsed);
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
        putLyrics(target, {
          parsed: lines,
          plain,
          synced: res.synced ?? null,
          status: status === "ready" ? "ready" : "empty",
        });
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
    if (!followRef.current) return;
    const line = lineRefs.current[activeIdx];
    const body = lyricsBodyRef.current;
    if (!line || !body) return;
    /* First activation lands instantly (no visible top→bottom slide); later
       line changes glide smoothly — and never while the user is scrolling. */
    const firstActivation = prevActiveRef.current === -1;
    prevActiveRef.current = activeIdx;
    const target = Math.max(0, line.offsetTop - body.clientHeight / 2 + line.clientHeight / 2);
    body.scrollTo({ top: target, behavior: firstActivation ? "auto" : "smooth" });
  }, [activeIdx]);

  const pauseFollow = (): void => {
    if (!followRef.current) return;
    followRef.current = false;
    setFollow(false);
  };

  const resumeFollow = (): void => {
    followRef.current = true;
    setFollow(true);
    if (activeIdx >= 0) {
      const line = lineRefs.current[activeIdx];
      const body = lyricsBodyRef.current;
      if (line && body) {
        body.scrollTo({
          top: Math.max(0, line.offsetTop - body.clientHeight / 2 + line.clientHeight / 2),
          behavior: "smooth",
        });
      }
    }
  };

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
  if (song?.artist) meta.push(song.artist);
  const albumLine = song?.album || detail?.album;
  if (albumLine) meta.push(albumLine);
  if (detail?.year) meta.push(detail.year);
  const durationLine = song?.duration || detail?.duration;
  if (durationLine) meta.push(durationLine);

  return (
    <div className="page">
      <TopBar title={song?.title ?? detail?.title ?? "Track"} />
      <div className="page__hero" style={heroStyle} />
      <div className="page__body">
        {loading && !song && <p className="page__note">Opening the track…</p>}
        {error && (
          <>
            <p className="page__error">{error}</p>
            <button className="pill" onClick={() => navigate(-1)}>
              Go back
            </button>
          </>
        )}
        {song && (
          <>
            <div className="trackhead">
              {song.artworkUrl ? (
                <img className="trackhead__cover" src={song.artworkUrl} alt={song.title} />
              ) : (
                <MusicTile seed={song.title} size={220} />
              )}
              <div className="trackhead__meta">
                <p className="trackhead__badge">Bài hát</p>
                <h1 className="trackhead__title" title={song.title}>
                  {song.title}
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
                <div className="tracklyrics__head-actions">
                  {!follow && activeIdx >= 0 && (
                    <button className="lyrics__sync" onClick={resumeFollow} title="Re-sync lyrics to playback">
                      Sync
                    </button>
                  )}
                  <button className="pill" onClick={toggleLyrics} title="Open the full lyrics panel">
                    {lyricsOpen ? "Close panel" : "Open panel"}
                  </button>
                </div>
              </div>
              <div
                className="tracklyrics__body"
                ref={lyricsBodyRef}
                onWheel={pauseFollow}
                onTouchMove={pauseFollow}
                onPointerDown={(e) => {
                  if (e.pointerType === "mouse") pauseFollow();
                }}
              >
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
  const navigate = useNavigate();
  const currentId = usePlayerStore((s) => s.current?.videoId ?? null);
  const playing = usePlayerStore((s) => s.playing);
  const openMenu = useUiStore((s) => s.openMenu);
  const active = currentId === track.videoId;
  // Clicking a track opens that track's page AND starts its playback.
  const open = () => {
    navigate(`/track/${encodeURIComponent(track.videoId)}`);
    onPlay();
  };
  return (
    <div
      className={`tracktable__row${active ? " tracktable__row--active" : ""}`}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter") open();
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
          index + 1
        )}
      </span>
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
