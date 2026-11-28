/*
 * trackCache.ts
 * Two-tier cache (memory + localStorage) of every SongDto the player has
 * touched. The bottom bar, the NOW PLAYING panel and the queue always hold
 * rich metadata, but a /track/:id deep-link can arrive when the backend
 * lookup is bot-flagged or fails outright — without this cache the page
 * would fall back to "Unknown track / unknown artist" even though the player
 * knows exactly what is playing. Remembered songs backfill sparse metadata
 * and recover failed track lookups on both desktop and mobile, and the
 * localStorage tier survives reloads so re-opened sessions start warm.
 *
 * rememberSong never lets a sparse entry degrade a rich one: fields that are
 * missing or placeholder ("Unknown track", "unknown artist") are filled from
 * the previously remembered entry instead of overwriting it.
 */

import type { SongDto } from "../types";
import { isArtistMissing } from "../utils/artist";

const CAP = 400;
const STORAGE_PREFIX = "orca.tracks.v1.";
const STORAGE_CAP = 150;
const TTL_MS = 1000 * 60 * 60 * 24 * 14; // two weeks

const cache = new Map<string, SongDto>();

function isMissingTitle(title: string | null | undefined): boolean {
  return !title || title === "Unknown track" || title === "untitled";
}

/** A song whose display fields are all usable — worth persisting. */
function isRichEnough(song: SongDto): boolean {
  return Boolean(
    !isMissingTitle(song.title) && !isArtistMissing(song.artist) && song.artworkUrl,
  );
}

function readStorage(videoId: string): SongDto | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + videoId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SongDto & { at?: number };
    if (!parsed || typeof parsed.videoId !== "string") return null;
    if (typeof parsed.at === "number" && Date.now() - parsed.at > TTL_MS) {
      window.localStorage.removeItem(STORAGE_PREFIX + videoId);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStorage(song: SongDto): void {
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + song.videoId,
      JSON.stringify({ ...song, at: Date.now() }),
    );
    /* Keep the storage tier bounded: evict the oldest entries past the cap. */
    const keys: { key: string; at: number }[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      try {
        const raw = JSON.parse(window.localStorage.getItem(key) ?? "{}") as { at?: number };
        keys.push({ key, at: typeof raw.at === "number" ? raw.at : 0 });
      } catch {
        keys.push({ key, at: 0 });
      }
    }
    if (keys.length > STORAGE_CAP) {
      keys.sort((a, b) => a.at - b.at);
      for (const { key } of keys.slice(0, keys.length - STORAGE_CAP)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    /* quota exceeded / storage unavailable — memory tier still works */
  }
}

/**
 * Merge a fresh song into an existing remembered one: sparse/placeholder
 * fields are filled from the old entry, never the other way around.
 */
function mergeInto(existing: SongDto, incoming: SongDto): SongDto {
  const title = isMissingTitle(incoming.title)
    ? existing.title || incoming.title
    : incoming.title;
  const artist = isArtistMissing(incoming.artist)
    ? isArtistMissing(existing.artist)
      ? incoming.artist
      : existing.artist
    : incoming.artist;
  return {
    ...incoming,
    title,
    artist,
    artworkUrl: incoming.artworkUrl || existing.artworkUrl || "",
    duration: incoming.duration || existing.duration || "",
    album: incoming.album || existing.album || "",
    streamUrl: incoming.streamUrl ?? existing.streamUrl ?? null,
  };
}

/** Remember a song (most-recent-first; evicts the oldest past the cap). */
export function rememberSong(song: SongDto | null | undefined): void {
  if (!song || !song.videoId) return;
  const existing = cache.get(song.videoId);
  const stored = existing ?? readStorage(song.videoId);
  const value = stored ? mergeInto(stored, song) : song;
  if (cache.has(song.videoId)) cache.delete(song.videoId);
  cache.set(song.videoId, value);
  if (cache.size > CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  /* Only persist rich entries — placeholders would pollute the storage tier. */
  if (isRichEnough(value)) writeStorage(value);
}

/** Look up a previously seen song by videoId (memory first, then storage). */
export function lookupSong(videoId: string | undefined | null): SongDto | null {
  if (!videoId) return null;
  const hit = cache.get(videoId);
  if (hit) return hit;
  const stored = readStorage(videoId);
  if (stored) {
    cache.set(videoId, stored);
    return stored;
  }
  return null;
}

/** Drop a videoId from both tiers (e.g. a track confirmed dead). */
export function forgetSong(videoId: string): void {
  cache.delete(videoId);
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + videoId);
  } catch {
    /* storage unavailable */
  }
}
