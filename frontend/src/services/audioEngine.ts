/*
 * audioEngine.ts
 * Single <audio> element wrapped in a small state machine. This is the web
 * translation of the Orca desktop player plumbing:
 *
 *   - a switch watchdog so a source that never opens fails after
 *     SWITCH_TIMEOUT_MS instead of spinning forever,
 *   - signed-URL (403/410) recovery with a single re-resolve per track,
 *   - stall recovery: a "waiting" stream that does not recover reloads the
 *     source at the preserved position,
 *   - volume applied through the normalize factor, mirroring PlaybackCore.
 *
 * The engine knows nothing about queues or stores; it emits typed events and
 * the player store decides what happens next.
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

export class AudioEngine {
  private el: HTMLAudioElement;
  private listeners: ((event: EngineEvent) => void)[] = [];
  private watchdog: number | null = null;
  private stallTimer: number | null = null;
  private sourceId: string | null = null;
  private sourceUrl: string | null = null;
  private savedPositionMs = 0;
  private generation = 0;
  private playingReported = false;

  constructor() {
    this.el = new Audio();
    this.el.preload = "auto";
    this.wire();
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

  private wire(): void {
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

  get generationNow(): number {
    return this.generation;
  }

  setVolume(percent: number, muted: boolean, normalize: boolean): void {
    const factor = normalize ? 0.88 : 1.0;
    const effective = ((muted ? 0 : percent) / 100.0) * factor;
    this.el.volume = Math.max(0, Math.min(1, effective));
  }

  setRate(rate: number): void {
    this.el.playbackRate = Math.max(0.5, Math.min(2.5, rate));
  }

  load(url: string, sourceId: string, resumeAtMs: number): void {
    this.evictWatchdog();
    this.clearStallTimer();
    this.generation += 1;
    this.playingReported = false;
    this.sourceUrl = url;
    this.sourceId = sourceId;
    this.savedPositionMs = resumeAtMs;
    this.el.src = url;
    this.el.load();
    this.armWatchdog();
    void this.el.play().catch(() => undefined);
  }

  resumeAt(url: string, sourceId: string, resumeAtMs: number): void {
    this.evictWatchdog();
    this.clearStallTimer();
    this.generation += 1;
    this.playingReported = false;
    this.sourceUrl = url;
    this.sourceId = sourceId;
    this.savedPositionMs = resumeAtMs;
    this.el.src = url;
    this.el.load();
    this.armWatchdog();
    void this.el
      .play()
      .then(() => {
        if (resumeAtMs > RESUME_POSITION_MS) {
          this.el.currentTime = resumeAtMs / 1000;
        }
      })
      .catch(() => undefined);
  }

  playCurrent(): void {
    void this.el.play().catch(() => undefined);
  }

  pause(): void {
    this.el.pause();
  }

  stop(): void {
    this.evictWatchdog();
    this.clearStallTimer();
    this.el.pause();
    this.evictSource();
  }

  private evictSource(): void {
    this.sourceId = null;
    this.sourceUrl = null;
    this.el.removeAttribute("src");
    this.el.load();
  }

  seek(positionMs: number): void {
    const duration = this.el.duration * 1000 || 0;
    const target = Math.max(0, duration ? Math.min(positionMs, duration - 250) : positionMs);
    this.el.currentTime = target / 1000;
    this.emit({ type: "progress", positionMs: target, durationMs: duration });
  }

  positionMs(): number {
    return this.el.currentTime * 1000;
  }

  isPlaying(): boolean {
    return !this.el.paused;
  }
}

export const audioEngine = new AudioEngine();
