/*
 * nativeAudio.ts
 * Web-side control surface for the NATIVE audio sink (Media3/ExoPlayer living
 * inside MediaPlaybackService, the Android foreground service). When a direct
 * stream URL is available, audio is played natively in the service process —
 * immune to WebView suspension when the screen locks or the app is
 * backgrounded. Position/duration/state flow back as "orcaaudio" window
 * events (relayed by OrcaMediaPlugin); the engine maps them onto the shared
 * EngineEvent surface. All calls are inert no-ops outside the Capacitor APK.
 */

import { Capacitor } from "@capacitor/core";

export type NativeAudioState =
  | "playing"
  | "paused"
  | "ended"
  | "buffering"
  | "progress"
  | "error";

export interface NativeAudioEvent {
  state: NativeAudioState;
  positionMs: number;
  durationMs: number;
  message?: string;
}

interface OrcaMediaNativePlugin {
  nativeLoad?: (opts: { url: string; resumeMs: number; title?: string; artist?: string }) => Promise<void>;
  nativePlay?: () => Promise<void>;
  nativePause?: () => Promise<void>;
  nativeSeek?: (opts: { positionMs: number }) => Promise<void>;
  nativeStop?: () => Promise<void>;
  nativeVolume?: (opts: { volume: number }) => Promise<void>;
}

function plugin(): OrcaMediaNativePlugin | null {
  try {
    if (!Capacitor.isNativePlatform()) return null;
    const plugins = (Capacitor as unknown as {
      Plugins?: Record<string, OrcaMediaNativePlugin>;
    }).Plugins;
    return plugins?.OrcaMedia ?? null;
  } catch {
    return null;
  }
}

/** True when the APK's native ExoPlayer bridge is present. */
export function isNativeAudioAvailable(): boolean {
  const p = plugin();
  return Boolean(p?.nativeLoad);
}

export function nativeAudioLoad(url: string, resumeMs: number): void {
  const p = plugin();
  if (!p?.nativeLoad) return;
  void p.nativeLoad({ url, resumeMs }).catch(() => undefined);
}

export function nativeAudioPlay(): void {
  const p = plugin();
  if (!p?.nativePlay) return;
  void p.nativePlay().catch(() => undefined);
}

export function nativeAudioPause(): void {
  const p = plugin();
  if (!p?.nativePause) return;
  void p.nativePause().catch(() => undefined);
}

export function nativeAudioSeek(positionMs: number): void {
  const p = plugin();
  if (!p?.nativeSeek) return;
  void p.nativeSeek({ positionMs }).catch(() => undefined);
}

export function nativeAudioStop(): void {
  const p = plugin();
  if (!p?.nativeStop) return;
  void p.nativeStop().catch(() => undefined);
}

export function nativeAudioVolume(volume: number): void {
  const p = plugin();
  if (!p?.nativeVolume) return;
  void p.nativeVolume({ volume }).catch(() => undefined);
}

/**
 * Subscribe to native player state events (window "orcaaudio" CustomEvents
 * dispatched by OrcaMediaPlugin; detail may be a JSON string or object).
 */
export function onNativeAudioEvent(
  handler: (event: NativeAudioEvent) => void,
): () => void {
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent).detail;
    try {
      const parsed =
        typeof detail === "string"
          ? (JSON.parse(detail) as Partial<NativeAudioEvent>)
          : detail;
      if (
        parsed &&
        typeof parsed.state === "string" &&
        /* "progress" ticks (500ms position updates from the service's
         * progressTick runnable) MUST be forwarded — without them the APK's
         * seek bar, playback position and synced lyrics never advance. */
        ["playing", "paused", "ended", "buffering", "progress", "error"].includes(parsed.state)
      ) {
        handler({
          state: parsed.state as NativeAudioState,
          positionMs: typeof parsed.positionMs === "number" ? parsed.positionMs : 0,
          durationMs: typeof parsed.durationMs === "number" ? parsed.durationMs : 0,
          message: typeof parsed.message === "string" ? parsed.message : undefined,
        });
      }
    } catch {
      /* malformed event payload */
    }
  };
  window.addEventListener("orcaaudio", listener);
  return () => window.removeEventListener("orcaaudio", listener);
}
