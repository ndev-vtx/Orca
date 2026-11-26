/*
 * player.ts
 * PlaybackCore for the web client — the direct translation of
 * Orca desktop playback core: queue + cursor + wanted-generation guard, radio expansion
 * behind the playing track, dead-track bookkeeping with a bounded skip
 * budget, previous-restarts-before-backstep, repeat modes, shuffle upcoming,
 * history reporting and MediaSession metadata.
 *
 * Stream resolution is delegated to the Orca FastAPI backend and now goes
 * resolve-first: startLoad asks POST /api/resolve for the signed URL (or the
 * real failure reason + whether it is permanent) before touching the media
 * element. If the browser cannot play the direct signed URL — it is bound to
 * the server's egress IP, so on hosts like Vercel the browser gets a 403 —
 * the store retries a single time per track through /api/stream/proxy, which
 * relays the bytes and works from any client address.
 */
import { create } from "zustand";
import { api, ApiError } from "../services/api";
import { audioEngine, type EngineEvent } from "../services/audioEngine";
import {
  DEFAULT_VOLUME,
  MAX_AUTO_SKIP,
  RADIO_DEPTH,
  REPEAT_MODES,
  SEEK_MS_BACKSTEP,
  type RepeatMode,
} from "./players";
import type { LyricLine, SongDto } from "../types";

export const PLAYER_VOLUME_KEY = "orca.player.volume";
export const PLAYER_MUTED_KEY = "orca.player.muted";
export const PLAYER_REPEAT_KEY = "orca.player.repeat";
export const PLAYER_SHUFFLE_KEY = "orca.player.shuffle";
export const PLAYER_AUTOQUEUE_KEY = "orca.player.autoqueue";
export const PLAYER_NORMALIZE_KEY = "orca.player.normalize";

const MAX_QUEUE_SIZE = 200;
const NOTICE_MS = 2600;

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
  bindEngine(): void;
}

let noticeTimer: number | null = null;
let engineBound = false;
const deadTracks = new Set<string>();
let loadedId: string | null = null;
let switching = false;
let errorStreak = 0;
let radioSeed: string | null = null;
let radioInFlight = false;
let advanceAfterRadio = false;
let historyReportedId: string | null = null;
const proxyTried = new Set<string>();

export const usePlayerStore = create<PlaybackState>((set, get) => {
  function announce(message: string): void {
    set({ notice: message });
    if (noticeTimer !== null) window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
      noticeTimer = null;
      set({ notice: "" });
    }, NOTICE_MS);
  }

  function proxyStreamUrl(song: SongDto): string {
    return api.streamUrl(song.videoId, "proxy");
  }

  function failTrack(song: SongDto, message: string, permanent: boolean): void {
    if (loadedId === song.videoId) switching = false;
    set({ loading: false, lastError: message });
    announce(message);
    deadTracks.add(song.videoId);
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

  function reportHistory(song: SongDto, context: string): void {
    if (historyReportedId === song.videoId) return;
    historyReportedId = song.videoId;
    void api.nowPlaying(song, context).catch(() => undefined);
  }

  function updateMediaSession(song: SongDto): void {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist,
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
  }

  function onEngineEvent(event: EngineEvent): void {
    const state = get();
    switch (event.type) {
      case "progress":
        set({ positionMs: event.positionMs, durationMs: event.durationMs });
        break;
      case "playing":
        set({ playing: true, loading: false });
        if (state.current) reportHistory(state.current, state.context);
        if ("mediaSession" in navigator) {
          navigator.mediaSession.playbackState = "playing";
        }
        break;
      case "paused":
        set({ playing: false });
        if ("mediaSession" in navigator) {
          navigator.mediaSession.playbackState = "paused";
        }
        break;
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
        if (tryProxyRetry(song, Math.max(0, event.atMs - 1500))) break;
        failTrack(song, event.message, false);
        break;
      }
    }
  }

  async function openStream(song: SongDto, resumeAtMs: number): Promise<void> {
    let res;
    try {
      res = await api.resolveStream(song.videoId);
    } catch (exc) {
      if (loadedId !== song.videoId) return;
      failTrack(
        song,
        exc instanceof ApiError ? exc.message : "could not reach the Orca backend",
        false,
      );
      return;
    }
    if (loadedId !== song.videoId) return;
    if (res.error || !res.url) {
      failTrack(song, res.error || "the server returned no audio stream", res.permanent);
      return;
    }
    switching = true;
    audioEngine.load(res.url, song.videoId, resumeAtMs);
  }

  function startLoad(song: SongDto, resumeAtMs: number): void {
    deadTracks.delete(song.videoId);
    proxyTried.delete(song.videoId);
    loadedId = song.videoId;
    switching = true;
    historyReportedId = null;
    set({
      current: song,
      loading: true,
      positionMs: 0,
      durationMs: 0,
      lastError: "",
    });
    updateMediaSession(song);
    void openStream(song, resumeAtMs);
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
    queue: [],
    cursor: -1,
    current: null,
    context: "manual",
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
    },

    play: (songs, startIndex = 0, context = "manual") => {
      const filtered = songs.filter((s) => !!s.videoId);
      if (filtered.length === 0) return;
      const index = Math.max(0, Math.min(startIndex, filtered.length - 1));
      const song = filtered[index];
      radioSeed = null;
      advanceAfterRadio = false;
      set({
        queue: filtered,
        cursor: index,
        context,
      });
      startLoad(song, 0);
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
      expandRadio(song);
    },

    playAt: (index) => {
      const { queue } = get();
      if (!Number.isInteger(index) || index < 0 || index >= queue.length) return;
      const song = queue[index];
      radioSeed = null;
      advanceAfterRadio = false;
      set({ cursor: index, context: get().context || "queue" });
      startLoad(song, 0);
      if (index + 1 >= queue.length) expandRadio(song);
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
        startLoad(state.current, 0);
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
          if (!deadTracks.has(state.queue[i].videoId)) return i;
        }
        return null;
      };
      const ahead = playableFrom(state.cursor + 1, state.queue.length, 1);
      if (ahead !== null) {
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
      set({
        lyricsStatus: "loading",
        lyricsVideoId: song.videoId,
        lyrics: [],
        lyricsPlain: null,
      });
      try {
        const res = await api.lyrics(song);
        const stillCurrent = get().current?.videoId === res.videoId;
        if (!stillCurrent) return;
        const hasLines = res.parsed.length > 0;
        const hasPlain = !!(res.plain || res.synced);
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
      if (noticeTimer !== null) {
        window.clearTimeout(noticeTimer);
        noticeTimer = null;
      }
      set({ notice: "" });
    },
  };
});

