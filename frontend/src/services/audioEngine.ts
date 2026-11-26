/*
 * audioEngine.ts
 * Playback sinks for the web client. Primary sink is the official
 * YouTube IFrame Player: it runs YouTube's own player inside the listener's
 * browser, so streaming happens from a residential IP and datacenter-host
 * bot checks, PO-token gates and IP-locked signed URLs are all bypassed —
 * no cookies, no token server, no public mirrors.
 *
 * The original <audio> sink is kept as the fallback for URLs resolved
 * elsewhere (the Orca backend in local setups, the proxy relay, browser-side
 * public mirrors). This is the web translation of the Orca desktop player
 * plumbing:
 *
 *   - a switch watchdog so a source that never opens fails after
 *     SWITCH_TIMEOUT_MS instead of spinning forever,
 *   - stall recovery on the <audio> sink: a "waiting" stream that does not
 *     recover reloads the source at the preserved position,
 *   - volume applied through the normalize factor, mirroring PlaybackCore.
 *
 * Both sinks emit the same typed events and share one control surface; the
 * engine knows nothing about queues or stores, the player store decides.
 */
import {
  SEEK_MS_BACKSTEP,
  SWITCH_TIMEOUT_MS,
} from "../state/players";

export const STALL_RECOVER_MS = 9000;
export const RESUME_POSITION_MS = 3000;

export type EngineEvent =
  | { type: "progress"; positionMs: number; durationMs: number }
  | { type: "playing" }
  | { type: "paused" }
  | { type: "opened" }
  | { type: "ended"; sourceId: string | null }
  | { type: "error"; sourceId: string | null; message: string; signedUrlDead: boolean; atMs: number };

const SIGNED_URL_403 = /403|forbidden|denied/i;
const SIGNED_URL_410 = /410|gone|expired/i;

function isSignedUrlDeath(message: string): boolean {
  return SIGNED_URL_403.test(message) || SIGNED_URL_410.test(message);
}

/* ---- minimal typings for the YouTube IFrame Player API (no npm dep) ---- */

interface YtPlayer {
  loadVideoById(videoId: string): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  setPlaybackRate(rate: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
}

interface YtPlayerEvent {
  target: YtPlayer;
  data: number;
}

interface YtPlayerConfig {
  videoId?: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (event: YtPlayerEvent) => void;
    onStateChange?: (event: YtPlayerEvent) => void;
    onError?: (event: YtPlayerEvent) => void;
  };
}

interface YtNamespace {
  Player: new (element: HTMLElement | string, config: YtPlayerConfig) => YtPlayer;
  PlayerState: {
    UNSTARTED: number;
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
}

declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const YT_STATE_PLAYING = 1;
const YT_STATE_PAUSED = 2;
const YT_STATE_ENDED = 0;

function ytErrorMessage(code: number): string {
  switch (code) {
    case 2:
      return "the track id was rejected by YouTube's player";
    case 5:
      return "YouTube's player could not play this track";
    case 100:
      return "YouTube reports this track as removed or private";
    case 101:
    case 150:
      return "the uploader disabled embedded playback for this track";
    default:
      return `YouTube's player failed (code ${code})`;
  }
}

let ytApiPromise: Promise<YtNamespace> | null = null;

function loadYouTubeIframeApi(): Promise<YtNamespace> {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (previous) previous();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube player API loaded without Player"));
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("could not load the YouTube player API"));
    document.head.appendChild(script);
  });
  return ytApiPromise;
}

export class AudioEngine {
  private el: HTMLAudioElement;
  private listeners: ((event: EngineEvent) => void)[] = [];
  private watchdog: number | null = null;
  private stallTimer: number | null = null;
  private progressTimer: number | null = null;

  private sourceId: string | null = null;
  private sourceUrl: string | null = null;
  private savedPositionMs = 0;
  private generation = 0;
  private playingReported = false;

  private sink: "yt" | "audio" = "yt";

  private yt: YtPlayer | null = null;
  private ytReady = false;
  private ytVolume = 100;
  private ytMuted = false;
  private ytRate = 1.0;
  private ytOpened = false;

  constructor() {
    this.el = new Audio();
    this.el.preload = "auto";
    this.wireAudio();
  }

  subscribe(listener: (event: EngineEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(event: EngineEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  /* --------------------------------------------------- <audio> sink ---- */

  private wireAudio(): void {
    this.el.addEventListener("timeupdate", () => {
      this.emit({
        type: "progress",
        positionMs: this.el.currentTime * 1000,
        durationMs: this.el.duration * 1000 || 0,
      });
    });
    this.el.addEventListener("durationchange", () => {
      this.emit({
        type: "progress",
        positionMs: this.el.currentTime * 1000,
        durationMs: this.el.duration * 1000 || 0,
      });
    });
    this.el.addEventListener("play", () => this.emit({ type: "playing" }));
    this.el.addEventListener("pause", () => this.emit({ type: "paused" }));
    this.el.addEventListener("ended", () => {
      const sourceId = this.sourceId;
      this.evictSource();
      this.emit({ type: "ended", sourceId });
    });
    this.el.addEventListener("canplay", () => {
      this.evictWatchdog();
      this.emit({ type: "opened" });
    });
    this.el.addEventListener("playing", () => {
      this.playingReported = true;
      this.evictWatchdog();
      this.clearStallTimer();
    });
    this.el.addEventListener("waiting", () => this.armStallTimer());
    this.el.addEventListener("suspend", () => this.clearStallTimer());
    this.el.addEventListener("error", () => this.reportAudioError());
  }

  private reportAudioError(): void {
    if (!this.sourceUrl) return;
    const mediaErr = this.el.error;
    let message = "playback failed";
    if (mediaErr) {
      switch (mediaErr.code) {
        case MediaError.MEDIA_ERR_NETWORK:
          message = "network interrupted the stream";
          break;
        case MediaError.MEDIA_ERR_DECODE:
          message = "the stream could not be decoded";
          break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
          message = "stream format not supported";
          break;
        case MediaError.MEDIA_ERR_ABORTED:
          message = "playback aborted";
          break;
        default:
          message = "playback failed";
      }
    }
    const atMs = this.el.currentTime * 1000;
    const dead = isSignedUrlDeath(message) || (mediaErr?.code === MediaError.MEDIA_ERR_NETWORK && atMs > 0);
    this.emit({
      type: "error",
      sourceId: this.sourceId,
      message,
      signedUrlDead: dead,
      atMs,
    });
  }

  private armStallTimer(): void {
    if (this.stallTimer !== null) return;
    this.stallTimer = window.setTimeout(() => {
      this.stallTimer = null;
      if (this.el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return;
      if (!this.playingReported || this.el.paused) return;
      const atMs = this.el.currentTime * 1000;
      if (atMs < SEEK_MS_BACKSTEP && this.savedPositionMs === 0) return;
      this.el.load();
      if (atMs > RESUME_POSITION_MS || this.savedPositionMs > RESUME_POSITION_MS) {
        this.el.currentTime = (this.savedPositionMs || atMs) / 1000;
      }
      void this.el.play().catch(() => undefined);
      this.armWatchdog();
    }, STALL_RECOVER_MS);
  }

  private clearStallTimer(): void {
    if (this.stallTimer !== null) {
      window.clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
  }

  private evictSource(): void {
    this.sourceId = null;
    this.sourceUrl = null;
    this.el.removeAttribute("src");
    this.el.load();
  }

  /* ------------------------------------------------ shared plumbing ---- */

  private armWatchdog(): void {
    this.evictWatchdog();
    this.watchdog = window.setTimeout(() => {
      this.evictWatchdog();
      this.emit({
        type: "error",
        sourceId: this.sourceId,
        message: "that track wouldn't open",
        signedUrlDead: false,
        atMs: 0,
      });
    }, SWITCH_TIMEOUT_MS);
  }

  private evictWatchdog(): void {
    if (this.watchdog !== null) {
      window.clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  private armProgressTimer(): void {
    this.evictProgressTimer();
    this.progressTimer = window.setInterval(() => {
      if (this.sink !== "yt" || !this.yt || !this.ytReady || this.sourceId === null) return;
      this.emit({
        type: "progress",
        positionMs: this.yt.getCurrentTime() * 1000,
        durationMs: this.yt.getDuration() * 1000 || 0,
      });
    }, 500);
  }

  private evictProgressTimer(): void {
    if (this.progressTimer !== null) {
      window.clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  get generationNow(): number {
    return this.generation;
  }

  setVolume(percent: number, muted: boolean, normalize: boolean): void {
    const factor = normalize ? 0.88 : 1.0;
    const effective = Math.max(0, Math.min(100, (muted ? 0 : percent) * factor));
    this.ytVolume = effective;
    this.ytMuted = muted;
    this.el.volume = Math.max(0, Math.min(1, effective / 100.0));
    if (this.yt && this.ytReady) {
      this.yt.setVolume(effective);
      if (muted) this.yt.mute();
      else this.yt.unMute();
    }
  }

  setRate(rate: number): void {
    const bounded = Math.max(0.5, Math.min(2.5, rate));
    this.ytRate = bounded;
    this.el.playbackRate = bounded;
    if (this.yt && this.ytReady) this.yt.setPlaybackRate(bounded);
  }

  /* ----------------------------------------------------- YT sink ------- */

  private ensureYtPlayer(): Promise<YtPlayer> {
    return loadYouTubeIframeApi().then(
      (YT) =>
        new Promise<YtPlayer>((resolve) => {
          if (this.yt && this.ytReady) {
            resolve(this.yt);
            return;
          }
          const host = document.createElement("div");
          host.style.position = "fixed";
          host.style.left = "-9999px";
          host.style.top = "0";
          host.style.width = "320px";
          host.style.height = "180px";
          host.style.opacity = "0";
          host.style.pointerEvents = "none";
          document.body.appendChild(host);
          const player = new YT.Player(host, {
            playerVars: {
              autoplay: 1,
              controls: 0,
              disablekb: 1,
              playsinline: 1,
              rel: 0,
              fs: 0,
              iv_load_policy: 3,
              origin: window.location.origin,
            },
            events: {
              onReady: () => {
                this.yt = player;
                this.ytReady = true;
                player.setVolume(this.ytVolume);
                if (this.ytMuted) player.mute();
                else player.unMute();
                player.setPlaybackRate(this.ytRate);
                resolve(player);
              },
              onStateChange: (event) => this.onYtState(event.data),
              onError: (event) => {
                if (this.sourceId === null) return;
                this.evictWatchdog();
                this.emit({
                  type: "error",
                  sourceId: this.sourceId,
                  message: ytErrorMessage(event.data),
                  signedUrlDead: false,
                  atMs: this.yt && this.ytReady ? this.yt.getCurrentTime() * 1000 : 0,
                });
              },
            },
          });
        }),
    );
  }

  private onYtState(state: number): void {
    if (this.sink !== "yt") return;
    if (state === YT_STATE_PLAYING) {
      this.playingReported = true;
      this.evictWatchdog();
      if (!this.ytOpened) {
        this.ytOpened = true;
        this.emit({ type: "opened" });
      }
      this.emit({ type: "playing" });
      return;
    }
    if (state === YT_STATE_PAUSED) {
      this.emit({ type: "paused" });
      return;
    }
    if (state === YT_STATE_ENDED) {
      const sourceId = this.sourceId;
      this.sourceId = null;
      this.emit({ type: "ended", sourceId });
    }
  }

  loadTrack(videoId: string, sourceId: string, resumeAtMs: number): void {
    this.sink = "yt";
    this.el.pause();
    this.el.removeAttribute("src");
    this.el.load();
    this.clearStallTimer();
    this.evictWatchdog();
    this.generation += 1;
    this.playingReported = false;
    this.ytOpened = false;
    this.sourceId = sourceId;
    this.sourceUrl = null;
    this.savedPositionMs = resumeAtMs;
    this.armWatchdog();
    this.armProgressTimer();
    this.ensureYtPlayer()
      .then((player) => {
        if (this.sink !== "yt" || this.sourceId !== sourceId) return;
        player.loadVideoById(videoId);
        if (resumeAtMs > RESUME_POSITION_MS) {
          player.seekTo(resumeAtMs / 1000, true);
        }
      })
      .catch(() => {
        if (this.sink !== "yt" || this.sourceId !== sourceId) return;
        this.evictWatchdog();
        this.emit({
          type: "error",
          sourceId: this.sourceId,
          message: "the YouTube player could not be loaded in this browser",
          signedUrlDead: false,
          atMs: 0,
        });
      });
  }

  /* ---------------------------------------------- URL (audio) sink ----- */

  load(url: string, sourceId: string, resumeAtMs: number): void {
    this.sink = "audio";
    this.ytOpened = false;
    this.sourceId = sourceId;
    this.sourceUrl = url;
    this.savedPositionMs = resumeAtMs;
    this.generation += 1;
    this.playingReported = false;
    this.evictWatchdog();
    this.clearStallTimer();
    if (this.yt && this.ytReady) this.yt.stopVideo();
    this.el.src = url;
    this.el.load();
    this.armWatchdog();
    void this.el.play().catch(() => undefined);
  }

  resumeAt(url: string, sourceId: string, resumeAtMs: number): void {
    this.load(url, sourceId, resumeAtMs);
    void this.el
      .play()
      .then(() => {
        if (resumeAtMs > RESUME_POSITION_MS) {
          this.el.currentTime = resumeAtMs / 1000;
        }
      })
      .catch(() => undefined);
  }

  /* ---------------------------------------------- shared controls ------ */

  playCurrent(): void {
    if (this.sink === "yt") {
      if (this.yt && this.ytReady) this.yt.playVideo();
      return;
    }
    void this.el.play().catch(() => undefined);
  }

  pause(): void {
    if (this.sink === "yt") {
      if (this.yt && this.ytReady) this.yt.pauseVideo();
      return;
    }
    this.el.pause();
  }

  stop(): void {
    this.evictWatchdog();
    this.clearStallTimer();
    this.evictProgressTimer();
    if (this.yt && this.ytReady) this.yt.stopVideo();
    this.el.pause();
    this.el.removeAttribute("src");
    this.el.load();
    this.sourceId = null;
    this.sourceUrl = null;
  }

  seek(positionMs: number): void {
    if (this.sink === "yt") {
      if (!this.yt || !this.ytReady) return;
      const duration = this.yt.getDuration() * 1000 || 0;
      const target = Math.max(0, duration ? Math.min(positionMs, duration - 250) : positionMs);
      this.yt.seekTo(target / 1000, true);
      this.emit({ type: "progress", positionMs: target, durationMs: duration });
      return;
    }
    const duration = this.el.duration * 1000 || 0;
    const target = Math.max(0, duration ? Math.min(positionMs, duration - 250) : positionMs);
    this.el.currentTime = target / 1000;
    this.emit({ type: "progress", positionMs: target, durationMs: duration });
  }

  positionMs(): number {
    if (this.sink === "yt") {
      if (!this.yt || !this.ytReady) return 0;
      return this.yt.getCurrentTime() * 1000;
    }
    return this.el.currentTime * 1000;
  }

  isPlaying(): boolean {
    if (this.sink === "yt") {
      if (!this.yt || !this.ytReady) return false;
      return this.yt.getPlayerState() === YT_STATE_PLAYING;
    }
    return !this.el.paused;
  }
}

export const audioEngine = new AudioEngine();
