/*
 * trackCache.ts
 * Session-scoped cache of every SongDto the player has touched. The bottom
 * bar, the NOW PLAYING panel and the queue always hold rich metadata, but a
 * /track/:id deep-link can arrive when the backend lookup is bot-flagged or
 * fails outright — without this cache the page would fall back to
 * "Unknown track / unknown artist" even though the player knows exactly what
 * is playing. Remembered songs backfill sparse metadata and recover failed
 * track lookups on both desktop and mobile.
 */

import type { SongDto } from "../types";

const CAP = 400;
const cache = new Map<string, SongDto>();

/** Remember a song (most-recent-first; evicts the oldest past the cap). */
export function rememberSong(song: SongDto | null | undefined): void {
  if (!song || !song.videoId) return;
  if (cache.has(song.videoId)) cache.delete(song.videoId);
  cache.set(song.videoId, song);
  if (cache.size > CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/** Look up a previously seen song by videoId. */
export function lookupSong(videoId: string | undefined | null): SongDto | null {
  if (!videoId) return null;
  return cache.get(videoId) ?? null;
}
