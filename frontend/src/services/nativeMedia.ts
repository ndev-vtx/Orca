/*
 * nativeMedia.ts
 * Web-side bridge to the Android foreground MediaPlaybackService. The player
 * store pushes track + play state to the native layer (start/update/stop) so
 * a partial wake lock, an active MediaSessionCompat and a media-style
 * notification keep WebView audio decoding when the screen locks or the app
 * is backgrounded; notification/lock-screen commands come back as
 * "orcamedia" window events which this module translates into player actions.
 * All calls are inert no-ops outside the Capacitor APK.
 */

import { Capacitor } from "@capacitor/core";
import type { SongDto } from "../types";

interface OrcaMediaPlugin {
  start?: (opts: { title: string; artist: string; playing: boolean }) => Promise<void>;
  update?: (opts: { title: string; artist: string; playing: boolean }) => Promise<void>;
  stop?: () => Promise<void>;
}

function plugin(): OrcaMediaPlugin | null {
  try {
    if (!Capacitor.isNativePlatform()) return null;
    const plugins = (Capacitor as unknown as {
      Plugins?: Record<string, OrcaMediaPlugin>;
    }).Plugins;
    return plugins?.OrcaMedia ?? null;
  } catch {
    return null;
  }
}

export function isNativeApp(): boolean {
  return plugin() !== null;
}

/** Create/refresh the native media notification for the playing track. */
export function nativeMediaUpdate(song: SongDto | null, playing: boolean): void {
  const p = plugin();
  if (!p) return;
  const opts = {
    title: song?.title ?? "Orca",
    artist: song?.artist ?? "",
    playing,
  };
  void (p.start ?? p.update)?.(opts).catch(() => undefined);
}

/** Remove the native notification + wake lock (playback fully stopped). */
export function nativeMediaStop(): void {
  const p = plugin();
  if (!p?.stop) return;
  void p.stop().catch(() => undefined);
}

export type NativeMediaAction = "playpause" | "next" | "prev";

/**
 * Subscribe to commands arriving from the native media session /
 * notification (dispatched as window CustomEvents by OrcaMediaPlugin).
 */
export function onNativeMediaCommand(
  handler: (action: NativeMediaAction) => void,
): () => void {
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent).detail;
    try {
      const action =
        typeof detail === "string"
          ? (JSON.parse(detail) as { action?: string }).action
          : detail?.action;
      if (action === "playpause" || action === "next" || action === "prev") {
        handler(action);
      }
    } catch {
      /* malformed event payload */
    }
  };
  window.addEventListener("orcamedia", listener);
  return () => window.removeEventListener("orcamedia", listener);
}
