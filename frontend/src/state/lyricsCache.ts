/*
 * lyricsCache.ts
 * Two-tier lyrics cache (memory + localStorage) so lyric loads are instant on
 * revisit and warm for upcoming queue tracks. Entries are keyed by videoId,
 * carry the parsed/synced/plain payload, and expire after two weeks.
 */

import type { LyricLine } from "../types";

export interface CachedLyrics {
  parsed: LyricLine[];
  plain: string | null;
  synced: string | null;
  status: "ready" | "empty";
  at: number;
}

const PREFIX = "orca.lyrics.v1.";
const CAP = 60;
const TTL_MS = 1000 * 60 * 60 * 24 * 14; // two weeks

const MEM = new Map<string, CachedLyrics>();

function readLocalStorage(videoId: string): CachedLyrics | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + videoId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedLyrics;
    if (!parsed || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > TTL_MS) {
      window.localStorage.removeItem(PREFIX + videoId);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function getLyrics(videoId: string | null | undefined): CachedLyrics | null {
  if (!videoId) return null;
  const hit = MEM.get(videoId) ?? readLocalStorage(videoId);
  if (hit) MEM.set(videoId, hit);
  return hit;
}

export function putLyrics(
  videoId: string,
  payload: {
    parsed: LyricLine[];
    plain: string | null;
    synced: string | null;
    status: "ready" | "empty";
  },
): void {
  const entry: CachedLyrics = { ...payload, at: Date.now() };
  MEM.set(videoId, entry);
  try {
    window.localStorage.setItem(PREFIX + videoId, JSON.stringify(entry));
    /* Keep the localStorage tier bounded: evict the oldest entries past CAP. */
    const keys: { key: string; at: number }[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(PREFIX)) continue;
      try {
        const raw = JSON.parse(window.localStorage.getItem(key) ?? "{}") as CachedLyrics;
        keys.push({ key, at: typeof raw.at === "number" ? raw.at : 0 });
      } catch {
        keys.push({ key, at: 0 });
      }
    }
    if (keys.length > CAP) {
      keys.sort((a, b) => a.at - b.at);
      for (const { key } of keys.slice(0, keys.length - CAP)) {
        window.localStorage.removeItem(key);
        for (const vid of MEM.keys()) {
          if (PREFIX + vid === key) MEM.delete(vid);
        }
      }
    }
  } catch {
    /* quota exceeded / storage unavailable — memory tier still works */
  }
}
