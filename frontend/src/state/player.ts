/*
 * player.ts
 * PlaybackCore for the web client — the direct translation of
 * Orca desktop playback core: queue + cursor + wanted-generation guard, radio expansion
 * behind the playing track, dead-track bookkeeping with a bounded skip
 * budget, previous-restarts-before-backstep, repeat modes, shuffle upcoming,
 * history reporting and MediaSession metadata.
 *
 * Primary playback is the official YouTube IFrame Player (see
 * services/audioEngine.ts): it streams from the listener's own browser, so
 * hosted deployments never touch a datacenter-blocked extraction path. If
 * that sink refuses a track, the store walks the legacy chain once per
 * track: backend resolve (the normal path when Orca runs locally) →
 * /api/stream/proxy relay → public Piped/Invidious mirrors fetched directly
 * from the browser.
 */
import { create } from "zustand";
import { api } from "../services/api";
import { audioEngine, type EngineEvent } from "../services/audioEngine";
import { resolveFromBrowser } from "../services/instances";
import { lookupSong, rememberSong } from "./trackCache";
import { getLyrics, putLyrics } from "./lyricsCache";
import { nativeMediaUpdate, nativeMediaStop } from "../services/nativeMedia";
import {
  DEFAULT_VOLUME,
  MAX_AUTO_SKIP,
  RADIO_DEPTH,
  REPEAT_MODES,
  SEEK_MS_BACKSTEP,
  type RepeatMode,
} from "./players";
import type { LyricLine, SongDto } from "../types";
import { resolveArtist } from "../utils/artist";

export const PLAYER_VOLUME_KEY = "orca.player.volume";
export const PLAYER_MUTED_KEY = "orca.player.muted";
export const PLAYER_REPEAT_KEY = "orca.player.repeat";
export const PLAYER_SHUFFLE_KEY = "orca.player.shuffle";
export const PLAYER_AUTOQUEUE_KEY = "orca.player.autoqueue";
export const PLAYER_NORMALIZE_KEY = "orca.player.normalize";

const MAX_QUEUE_SIZE = 200;
const NOTICE_MS = 2600;

/*
 * M6: iOS (Safari / PWA) suspends WebKit media when the tab leaves the
 * foreground - a platform constraint no web app can fully lift. Say it once,
 * on the first playback, so the behaviour is explained instead of mysterious.
 */
const IS_IOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const IOS_HINT_KEY = "orca.ios.background-hint";

function loadInt(key: string, fallback: number, min: number, max: number): number {
  const raw = localStorage.getItem(key);
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function loadBool(key: string, fallback = false): boolean {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === "1";
}

function loadRepeat(): RepeatMode {
  const raw = localStorage.getItem(PLAYER_REPEAT_KEY);
  return REPEAT_MODES.includes(raw as RepeatMode) ? (raw as RepeatMode) : "off";
}

/*
 * C5: the queue survives reloads. A debounced snapshot of the queue, cursor,
 * context and live position is written to localStorage; on boot the store
 * starts paused on the saved track and the first play/toggle resumes from the
 * saved position.
 */
export const PLAYER_SESSION_KEY = "orca.player.session";
/*
 * Deliberately below MAX_QUEUE_SIZE (200): the persisted snapshot is a
 * recovery convenience, not a full queue mirror — capping it keeps the
 * localStorage write small on huge radio queues. The live queue is always
 * the source of truth within a session.
 */
const SESSION_QUEUE_CAP = 80;
const SESSION_SAVE_DEBOUNCE_MS = 2000;

interface PersistedSession {
  queue: SongDto[];
  cursor: number;
  context: string;
  positionMs: number;
  savedAt: number;
}

function loadSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(PLAYER_SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PersistedSession;
    if (!Array.isArray(data.queue)) return null;
    const queue = data.queue
      .filter((s) => s && typeof s.videoId === "string" && s.videoId.length > 0)
      .slice(0, SESSION_QUEUE_CAP);
    if (queue.length === 0) return null;
    const cursor = Math.max(0, Math.min(Math.trunc(Number(data.cursor) || 0), queue.length - 1));
    return {
      queue,
      cursor,
      context: typeof data.context === "string" && data.context ? data.context : "manual",
      positionMs: Math.max(0, Math.trunc(Number(data.positionMs) || 0)),
      savedAt: Number(data.savedAt) || 0,
    };
  } catch {
    return null;
  }
}

const restoredSession = loadSession();
let restoredPositionMs = restoredSession?.positionMs ?? 0;

export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export type LyricsStatus = "idle" | "loading" | "ready" | "empty" | "error";

interface PlaybackState {
  queue: SongDto[];
  cursor: number;
  current: SongDto | null;
  context: string;
  playing: boolean;
  loading: boolean;
  notice: string;
  lastError: string;
  positionMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  normalizeVolume: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  autoQueue: boolean;
  playbackRate: number;
  lyricsOpen: boolean;
  lyricsStatus: LyricsStatus;
  lyricsVideoId: string | null;
  lyrics: LyricLine[];
  lyricsPlain: string | null;

  play(songs: SongDto[], startIndex?: number, context?: string): void;
  playSong(song: SongDto, context?: string): void;
  playAt(index: number): void;
  addToQueue(song: SongDto): void;
  removeFromQueue(index: number): void;
  /** Drag-and-drop: move an upcoming track from index `from` to `to` (absolute queue indices). */
  moveInQueue(from: number, to: number): void;
  clearQueue(): void;
  retryCurrent(): void;
  toggle(): void;
  next(force?: boolean): void;
  previous(): void;
  seek(ms: number): void;
  setVolume(percent: number): void;
  setMuted(muted: boolean): void;
  cycleRepeat(): void;
  setShuffle(shuffle: boolean): void;
  shuffleUpcoming(): void;
  setAutoQueue(enabled: boolean): void;
  setNormalizeVolume(enabled: boolean): void;
  setPlaybackRate(rate: number): void;
  toggleLyrics(): void;
  ensureLyrics(): Promise<void>;
  clearNotice(): void;
  notify(message: string): void;
  bindEngine(): void;
}

let noticeTimer: number | null = null;
let sessionSaveTimer: number | null = null;
let engineBound = false;
/*
 * Dead-track bookkeeping with a TTL (C2 fix): a track that failed is only
 * skipped for DEAD_TTL_MS, not forever. Transient failures (network blip,
 * bot-flag flake, expired signed URL) recover automatically, and a fresh
 * play() with a new context clears the ledger entirely.
 */
const DEAD_TTL_MS = 5 * 60 * 1000;
const deadTracks = new Map<string, number>();

function markDead(videoId: string): void {
  deadTracks.set(videoId, Date.now());
}

function isDead(videoId: string): boolean {
  const markedAt = deadTracks.get(videoId);
  if (markedAt === undefined) return false;
  if (Date.now() - markedAt > DEAD_TTL_MS) {
    deadTracks.delete(videoId);
    return false;
  }
  return true;
}
let loadedId: string | null = null;
let switching = false;
let errorStreak = 0;
let radioSeed: string | null = null;
let radioInFlight = false;
let advanceAfterRadio = false;
let historyReportedId: string | null = null;
const proxyTried = new Set<string>();
const browserTried = new Set<string>();
const backendTried = new Set<string>();

export const usePlayerStore = create<PlaybackState>((set, get) => {
  function announce(message: string): void {
    set({ notice: message });
    if (noticeTimer !== null) window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
      noticeTimer = null;
      set({ notice: "" });
    }, NOTICE_MS);
  }

  function maybeIosBackgroundHint(): void {
    if (!IS_IOS) return;
    try {
      if (localStorage.getItem(IOS_HINT_KEY) === "1") return;
      localStorage.setItem(IOS_HINT_KEY, "1");
    } catch {
      return; // private mode - skip rather than nag on every track
    }
    announce(
      "iOS tip - background audio may pause when you leave Orca; add it to your Home Screen for the best playback",
    );
  }

  function proxyStreamUrl(song: SongDto): string {
    return api.streamUrl(song.videoId, "proxy");
  }

  function persistSession(): void {
    if (sessionSaveTimer !== null) {
      window.clearTimeout(sessionSaveTimer);
      sessionSaveTimer = null;
    }
    try {
      const state = get();
      if (state.queue.length === 0 || !state.current) {
        localStorage.removeItem(PLAYER_SESSION_KEY);
        return;
      }
      const currentRow = state.queue[state.cursor];
      const session: PersistedSession = {
        queue: state.queue
          .slice(0, SESSION_QUEUE_CAP)
          .map((s) => ({ ...s, streamUrl: undefined })),
        cursor: Math.max(0, state.cursor),
        context: state.context,
        positionMs: currentRow && currentRow.videoId === state.current.videoId ? state.positionMs : 0,
        savedAt: Date.now(),
      };
      localStorage.setItem(PLAYER_SESSION_KEY, JSON.stringify(session));
    } catch {
      /* storage unavailable or full — session persistence is best-effort */
    }
  }

  function scheduleSessionSave(): void {
    if (sessionSaveTimer !== null) return;
    sessionSaveTimer = window.setTimeout(() => {
      sessionSaveTimer = null;
      persistSession();
    }, SESSION_SAVE_DEBOUNCE_MS);
  }

  function failTrack(song: SongDto, message: string, permanent: boolean): void {
    if (loadedId === song.videoId) switching = false;
    set({ loading: false, lastError: message });
    announce(message);
    markDead(song.videoId);
    if (permanent) return;
    errorStreak += 1;
    if (errorStreak <= MAX_AUTO_SKIP) {
      get().next(true);
    } else {
      errorStreak = 0;
    }
  }

  function tryProxyRetry(song: SongDto, atMs: number): boolean {
    if (proxyTried.has(song.videoId)) return false;
    proxyTried.add(song.videoId);
    announce("retrying through the Orca proxy");
    audioEngine.resumeAt(proxyStreamUrl(song), song.videoId, atMs);
    return true;
  }

  /*
   * Fallback chain after the YouTube IFrame sink refuses a track (embedding
   * disabled, player failure). First the Orca backend — the normal path for
   * a locally run instance — then the server proxy, then public mirrors
   * fetched from the browser itself.
   */
  async function openLegacy(song: SongDto, atMs: number): Promise<void> {
    try {
      const res = await api.resolveStream(song.videoId);
      if (loadedId !== song.videoId) return;
      if (res.url && !res.error) {
        switching = true;
        set({ loading: true, lastError: "" });
        audioEngine.resumeAt(res.url, song.videoId, atMs);
        return;
      }
    } catch {
      // backend unreachable or refused — continue down the chain
    }
    const back = Math.max(0, atMs - 1500);
    if (tryProxyRetry(song, back)) return;
    if (loadViaBrowser(song, back)) return;
    failTrack(song, "no playable stream — player, server and mirrors all refused", false);
  }

  function loadViaBrowser(song: SongDto, atMs: number): boolean {
    if (browserTried.has(song.videoId)) return false;
    browserTried.add(song.videoId);
    announce("asking public mirrors directly from the browser");
    void (async () => {
      const remote = await resolveFromBrowser(song.videoId);
      if (loadedId !== song.videoId) return;
      if (!remote) {
        failTrack(song, "no playable stream from the server or public mirrors", false);
        return;
      }
      switching = true;
      set({ loading: true, lastError: "" });
      audioEngine.resumeAt(remote.url, song.videoId, atMs);
    })();
    return true;
  }

  function reportHistory(song: SongDto, context: string): void {
    if (historyReportedId === song.videoId) return;
    historyReportedId = song.videoId;
    void api.nowPlaying(song, context).catch(() => undefined);
  }

  /*
   * Next-track warm-up: once the current track is actually playing, quietly
   * fetch the upcoming queue track's rich metadata (title/artist/art/album)
   * into the session cache. Deliberately delayed so it never competes with
   * stream startup, and skipped when the track is already known. The IFrame
   * sink itself loads the next video near-instantly via loadVideoById.
   */
  let prefetchTimer: number | null = null;
  function prefetchNextMetadata(): void {
    if (prefetchTimer !== null) window.clearTimeout(prefetchTimer);
    prefetchTimer = window.setTimeout(() => {
      prefetchTimer = null;
      const st = get();
      const upcoming = st.queue[st.cursor + 1];
      if (!upcoming) return;
      /* Warm the next track's rich metadata so its page opens instantly. */
      if (!lookupSong(upcoming.videoId)) {
        void api
          .track(upcoming.videoId)
          .then((d) => {
            if (d.song) rememberSong(d.song);
          })
          .catch(() => undefined);
      }
      /* And warm its lyrics so the panel is ready before the track starts. */
      if (!getLyrics(upcoming.videoId)) {
        void api
          .lyrics(upcoming)
          .then((res) => {
            const hasLines = res.parsed.length > 0;
            const hasPlain = !!(res.plain || res.synced);
            putLyrics(upcoming.videoId, {
              parsed: res.parsed,
              plain: res.plain ?? res.synced ?? null,
              synced: res.synced ?? null,
              status: hasLines || hasPlain ? "ready" : "empty",
            });
          })
          .catch(() => undefined);
      }
    }, 4000);
  }

  function updateMediaSession(song: SongDto): void {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: resolveArtist(song),
      album: "Orca",
      artwork: song.artworkUrl ? [{ src: song.artworkUrl, sizes: "640x640" }] : [],
    });
    navigator.mediaSession.playbackState = get().playing ? "playing" : "paused";
  }

  function wireMediaSession(): void {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.setActionHandler("play", () => get().toggle());
    navigator.mediaSession.setActionHandler("pause", () => get().toggle());
    navigator.mediaSession.setActionHandler("previoustrack", () => get().previous());
    navigator.mediaSession.setActionHandler("nexttrack", () => get().next(true));
    try {
      navigator.mediaSession.setActionHandler("seekto", (details) => {
        if (details.seekTime != null) audioEngine.seek(details.seekTime * 1000);
      });
      navigator.mediaSession.setActionHandler("seekbackward", (details) => {
        const back = (details.seekOffset ?? 10) * 1000;
        audioEngine.seek(Math.max(0, audioEngine.positionMs() - back));
      });
      navigator.mediaSession.setActionHandler("seekforward", (details) => {
        const forward = (details.seekOffset ?? 10) * 1000;
        audioEngine.seek(audioEngine.positionMs() + forward);
      });
    } catch {
      /* seek actions unsupported on this platform */
    }
  }

  function onEngineEvent(event: EngineEvent): void {
    switch (event.type) {
      case "progress": {
        set({ positionMs: event.positionMs, durationMs: event.durationMs });
        scheduleSessionSave();
        if (
          "mediaSession" in navigator &&
          event.durationMs > 0 &&
          typeof navigator.mediaSession.setPositionState === "function"
        ) {
          try {
            navigator.mediaSession.setPositionState({
              duration: event.durationMs / 1000,
              position: Math.min(event.positionMs, event.durationMs) / 1000,
              playbackRate: get().playbackRate,
            });
          } catch {
            /* position state not accepted */
          }
        }
        break;
      }
      case "playing": {
        const st = get();
        set({ playing: true, loading: false });
        if (st.current) reportHistory(st.current, st.context);
        maybeIosBackgroundHint();
        prefetchNextMetadata();
        nativeMediaUpdate(st.current, true);
        if ("mediaSession" in navigator) {
          navigator.mediaSession.playbackState = "playing";
        }
        break;
      }
      case "paused": {
        const st = get();
        set({ playing: false });
        persistSession();
        nativeMediaUpdate(st.current, false);
        if ("mediaSession" in navigator) {
          navigator.mediaSession.playbackState = "paused";
        }
        break;
      }
      case "opened":
        if (!switching) break;
        switching = false;
        errorStreak = 0;
        set({ loading: false });
        break;
      case "ended": {
        if (!event.sourceId || loadedId !== event.sourceId) break;
        get().next(false);
        break;
      }
      case "error": {
        const state = get();
        const song = event.sourceId
          ? state.queue[state.cursor] ?? null
          : state.current;
        if (!song || loadedId !== song.videoId) break;
        if (!backendTried.has(song.videoId)) {
          backendTried.add(song.videoId);
          announce("trying the Orca server");
          void openLegacy(song, Math.max(0, event.atMs - 1500));
          break;
        }
        if (tryProxyRetry(song, Math.max(0, event.atMs - 1500))) break;
        if (loadViaBrowser(song, Math.max(0, event.atMs - 1500))) break;
        failTrack(song, event.message, false);
        break;
      }
    }
  }

  function startLoad(song: SongDto, resumeAtMs: number): void {
    deadTracks.delete(song.videoId);
    proxyTried.delete(song.videoId);
    browserTried.delete(song.videoId);
    backendTried.delete(song.videoId);
    loadedId = song.videoId;
    switching = true;
    historyReportedId = null;
    /* Keep rich metadata reachable for /track/:id deep-links and lookups
       that fail later (trackCache backs TrackPage's fallback). */
    rememberSong(song);
    for (const t of get().queue) rememberSong(t);
    set({
      current: song,
      loading: true,
      positionMs: 0,
      durationMs: 0,
      lastError: "",
    });
    updateMediaSession(song);
    /* Native APK: keep the foreground media service in sync (wake lock +
       lock-screen notification follow the track even before playback). */
    nativeMediaUpdate(song, false);
    audioEngine.loadTrack(song.videoId, song.videoId, resumeAtMs);
    if (get().lyricsOpen) void get().ensureLyrics();
  }

  function expandRadio(seed: SongDto): void {
    if (!get().autoQueue) return;
    if (radioSeed === seed.videoId && get().queue.length > get().cursor + 1) return;
    if (radioInFlight) return;
    radioSeed = seed.videoId;
    radioInFlight = true;
    api
      .similar(seed.videoId)
      .then((allTracks) => {
        const tracks = allTracks.slice(0, RADIO_DEPTH);
        radioInFlight = false;
        const state = get();
        if (!state.autoQueue || state.queue.length === 0) return;
        const known = new Set(state.queue.map((t) => t.videoId));
        const fresh: SongDto[] = [];
        for (const track of tracks) {
          if (fresh.length + state.queue.length >= MAX_QUEUE_SIZE) break;
          if (known.has(track.videoId)) continue;
          known.add(track.videoId);
          fresh.push(track);
        }
        if (fresh.length === 0) {
          if (advanceAfterRadio) {
            advanceAfterRadio = false;
            announce("nothing more like this");
          }
          return;
        }
        set({ queue: [...state.queue, ...fresh] });
        scheduleSessionSave();
        if (advanceAfterRadio) {
          advanceAfterRadio = false;
          get().next(true);
        }
      })
      .catch(() => {
        radioInFlight = false;
        if (advanceAfterRadio) {
          advanceAfterRadio = false;
          announce("radio unavailable");
        }
      });
  }

  return {
    queue: restoredSession ? restoredSession.queue : [],
    cursor: restoredSession ? restoredSession.cursor : -1,
    current: restoredSession ? restoredSession.queue[restoredSession.cursor] ?? null : null,
    context: restoredSession ? restoredSession.context : "manual",
    playing: false,
    loading: false,
    notice: "",
    lastError: "",
    positionMs: 0,
    durationMs: 0,
    volume: loadInt(PLAYER_VOLUME_KEY, DEFAULT_VOLUME, 0, 100),
    muted: loadBool(PLAYER_MUTED_KEY),
    normalizeVolume: loadBool(PLAYER_NORMALIZE_KEY, false),
    repeat: loadRepeat(),
    shuffle: loadBool(PLAYER_SHUFFLE_KEY),
    autoQueue: loadBool(PLAYER_AUTOQUEUE_KEY, true),
    playbackRate: 1.0,
    lyricsOpen: false,
    lyricsStatus: "idle",
    lyricsVideoId: null,
    lyrics: [],
    lyricsPlain: null,

    bindEngine: () => {
      if (engineBound) return;
      engineBound = true;
      audioEngine.setVolume(get().volume, get().muted, get().normalizeVolume);
      audioEngine.subscribe(onEngineEvent);
      wireMediaSession();
      // Flush the queue snapshot when the tab is closed or hidden mid-play.
      // Named handlers (m3) so the registration is idempotent-and-auditable
      // rather than an anonymous listener nobody can ever remove.
      window.addEventListener("pagehide", persistSession);
      const onVisibilityChange = (): void => {
        if (document.visibilityState === "hidden") persistSession();
      };
      document.addEventListener("visibilitychange", onVisibilityChange);
    },

    play: (songs, startIndex = 0, context = "manual") => {
      const filtered = songs.filter((s) => !!s.videoId);
      if (filtered.length === 0) return;
      const index = Math.max(0, Math.min(startIndex, filtered.length - 1));
      const song = filtered[index];
      radioSeed = null;
      advanceAfterRadio = false;
      /* Fresh context = fresh chance for previously-failed tracks. */
      deadTracks.clear();
      set({
        queue: filtered,
        cursor: index,
        context,
      });
      startLoad(song, 0);
      scheduleSessionSave();
      if (filtered.length <= index + 1) expandRadio(song);
    },

    playSong: (song, context = "radio") => {
      const slot = get().queue.findIndex((t) => t.videoId === song.videoId);
      if (slot >= 0) {
        get().playAt(slot);
        return;
      }
      radioSeed = null;
      advanceAfterRadio = false;
      set({ queue: [song], cursor: 0, context });
      startLoad(song, 0);
      scheduleSessionSave();
      expandRadio(song);
    },

    playAt: (index) => {
      const { queue } = get();
      if (!Number.isInteger(index) || index < 0 || index >= queue.length) return;
      const song = queue[index];
      // Re-selecting the track that is already loaded must never restart it
      // (that would snap the position back to 0:00) — just resume if paused.
      if (loadedId === song.videoId && get().current?.videoId === song.videoId) {
        set({ cursor: index });
        if (!audioEngine.isPlaying()) audioEngine.playCurrent();
        return;
      }
      radioSeed = null;
      advanceAfterRadio = false;
      set({ cursor: index, context: get().context || "queue" });
      startLoad(song, 0);
      scheduleSessionSave();
      if (index + 1 >= queue.length) expandRadio(song);
    },

    addToQueue: (song) => {
      if (!song || !song.videoId) return;
      const { queue } = get();
      if (queue.some((t) => t.videoId === song.videoId)) {
        announce("Already in the queue");
        return;
      }
      if (queue.length >= MAX_QUEUE_SIZE) {
        announce("Queue is full");
        return;
      }
      set({ queue: [...queue, song] });
      scheduleSessionSave();
      announce(`Added to queue — ${song.title}`);
    },

    removeFromQueue: (index) => {
      const { queue, cursor } = get();
      if (index <= cursor || index >= queue.length) return; // played + current stay
      set({ queue: queue.filter((_, i) => i !== index) });
      scheduleSessionSave();
    },

    moveInQueue: (from, to) => {
      const { queue, cursor } = get();
      if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from === to ||
        from <= cursor ||
        to <= cursor ||
        from >= queue.length ||
        to >= queue.length
      ) {
        return; // played tracks and the current track stay put
      }
      const next = [...queue];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      set({ queue: next });
      scheduleSessionSave();
    },

    clearQueue: () => {
      const { queue, cursor } = get();
      // Keep the playing track; drop everything queued after it.
      set({ queue: queue.slice(0, cursor + 1) });
      scheduleSessionSave();
    },

    retryCurrent: () => {
      const song = get().current;
      if (!song) return;
      deadTracks.delete(song.videoId);
      startLoad(song, 0);
    },

    toggle: () => {
      const state = get();
      if (audioEngine.isPlaying()) {
        audioEngine.pause();
        return;
      }
      if (state.current && loadedId === state.current.videoId) {
        audioEngine.playCurrent();
        return;
      }
      if (state.current) {
        // First toggle after a reload resumes the persisted track/position.
        startLoad(state.current, restoredPositionMs);
        restoredPositionMs = 0;
        return;
      }
      if (state.queue.length > 0) {
        get().playAt(0);
      }
    },

    next: (force = false) => {
      const state = get();
      if (!force && state.repeat === "one" && state.current) {
        audioEngine.seek(0);
        audioEngine.playCurrent();
        return;
      }
      if (errorStreak > MAX_AUTO_SKIP) errorStreak = 0;
      const playableFrom = (from: number, to: number, step: number): number | null => {
        for (let i = from; step > 0 ? i < to : i > to; i += step) {
          if (i < 0 || i >= state.queue.length) break;
          if (!isDead(state.queue[i].videoId)) return i;
        }
        return null;
      };
      const ahead = playableFrom(state.cursor + 1, state.queue.length, 1);
      if (ahead !== null) {
        /* Shuffle picks a random track among the non-dead upcoming ones. */
        if (state.shuffle) {
          const candidates: number[] = [];
          for (let i = state.cursor + 1; i < state.queue.length; i += 1) {
            if (!isDead(state.queue[i].videoId)) candidates.push(i);
          }
          if (candidates.length > 0) {
            get().playAt(candidates[Math.floor(Math.random() * candidates.length)]);
            return;
          }
        }
        get().playAt(ahead);
        return;
      }
      if (state.repeat === "all" && state.queue.length > 0) {
        const wrap = playableFrom(0, state.queue.length, 1);
        if (wrap !== null) {
          get().playAt(wrap);
          return;
        }
      }
      if (state.queue.length === 0) return;
      if (!state.autoQueue) {
        announce("queue finished");
        /* Native APK: drop the wake lock + media notification. */
        nativeMediaStop();
        return;
      }
      if (radioInFlight) {
        advanceAfterRadio = true;
        return;
      }
      if (state.queue[state.queue.length - 1]?.videoId === state.current?.videoId) return;
      advanceAfterRadio = true;
      announce("finding more like this");
      expandRadio(state.queue[state.queue.length - 1]);
    },

    previous: () => {
      const state = get();
      const position = audioEngine.positionMs();
      if (position > SEEK_MS_BACKSTEP) {
        audioEngine.seek(0);
        return;
      }
      if (state.cursor > 0) {
        get().playAt(state.cursor - 1);
        return;
      }
      if (state.repeat === "all" && state.queue.length > 0) {
        get().playAt(state.queue.length - 1);
        return;
      }
      audioEngine.seek(0);
    },

    seek: (ms) => {
      audioEngine.seek(ms);
    },

    setVolume: (percent) => {
      const volume = Math.max(0, Math.min(100, Math.round(percent)));
      localStorage.setItem(PLAYER_VOLUME_KEY, String(volume));
      audioEngine.setVolume(volume, get().muted, get().normalizeVolume);
      set({ volume });
    },

    setMuted: (muted) => {
      localStorage.setItem(PLAYER_MUTED_KEY, muted ? "1" : "0");
      audioEngine.setVolume(get().volume, muted, get().normalizeVolume);
      set({ muted });
    },

    cycleRepeat: () => {
      const order = REPEAT_MODES;
      const nextIdx = (order.indexOf(get().repeat) + 1) % order.length;
      const repeat = order[nextIdx];
      localStorage.setItem(PLAYER_REPEAT_KEY, repeat);
      announce(repeat === "off" ? "repeat off" : `repeat ${repeat} on`);
      set({ repeat });
    },

    setShuffle: (shuffle) => {
      localStorage.setItem(PLAYER_SHUFFLE_KEY, shuffle ? "1" : "0");
      set({ shuffle });
    },

    shuffleUpcoming: () => {
      const state = get();
      if (state.cursor + 2 >= state.queue.length) {
        announce("no upcoming tracks to shuffle");
        return;
      }
      const upcoming = state.queue.slice(state.cursor + 1);
      for (let i = upcoming.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [upcoming[i], upcoming[j]] = [upcoming[j], upcoming[i]];
      }
      set({ queue: [...state.queue.slice(0, state.cursor + 1), ...upcoming] });
      scheduleSessionSave();
      announce("upcoming queue shuffled");
    },

    setAutoQueue: (enabled) => {
      localStorage.setItem(PLAYER_AUTOQUEUE_KEY, enabled ? "1" : "0");
      set({ autoQueue: enabled });
    },

    setNormalizeVolume: (enabled) => {
      localStorage.setItem(PLAYER_NORMALIZE_KEY, enabled ? "1" : "0");
      audioEngine.setVolume(get().volume, get().muted, enabled);
      set({ normalizeVolume: enabled });
    },

    setPlaybackRate: (rate) => {
      const bounded = Math.max(0.5, Math.min(2.5, rate));
      audioEngine.setRate(bounded);
      set({ playbackRate: bounded });
    },

    toggleLyrics: () => {
      const open = !get().lyricsOpen;
      set({ lyricsOpen: open });
      if (open) void get().ensureLyrics();
    },

    ensureLyrics: async () => {
      const song = get().current;
      if (!song) return;
      if (
        get().lyricsVideoId === song.videoId &&
        (get().lyricsStatus === "loading" || get().lyricsStatus === "ready")
      ) {
        return;
      }
      /* Two-tier cache hit: render instantly, no network round-trip. */
      const cached = getLyrics(song.videoId);
      if (cached) {
        set({
          lyricsStatus: cached.status,
          lyricsVideoId: song.videoId,
          lyrics: cached.parsed,
          lyricsPlain: cached.plain,
        });
        return;
      }
      set({
        lyricsStatus: "loading",
        lyricsVideoId: song.videoId,
        lyrics: [],
        lyricsPlain: null,
      });
      try {
        const res = await api.lyrics(song);
        const stillCurrent = get().current?.videoId === res.videoId;
        const hasLines = res.parsed.length > 0;
        const hasPlain = !!(res.plain || res.synced);
        putLyrics(res.videoId || song.videoId, {
          parsed: res.parsed,
          plain: res.plain ?? res.synced ?? null,
          synced: res.synced ?? null,
          status: hasLines || hasPlain ? "ready" : "empty",
        });
        if (!stillCurrent) return;
        set({
          lyrics: hasLines ? res.parsed : [],
          lyricsPlain: res.plain ?? res.synced ?? null,
          lyricsStatus: hasLines || hasPlain ? "ready" : "empty",
          lyricsVideoId: song.videoId,
        });
      } catch {
        if (get().current?.videoId === song.videoId) {
          set({ lyricsStatus: "error" });
        }
      }
    },

    clearNotice: () => {
      if (noticeTimer !== null) window.clearTimeout(noticeTimer);
      noticeTimer = null;
      set({ notice: "" });
    },

    notify: (message) => announce(message),
  };
});


/*
 * iOS only grants playback to calls traceable to a user gesture: pre-create
 * the YouTube player on the first tap so the first play request is not an
 * async bootstrap away from the gesture that started it.
 */
audioEngine.primeOnGesture();
