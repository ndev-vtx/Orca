/*
 * artist.ts
 * Single source of truth for artist-name resolution. Track payloads come from
 * many shapes (ytmusicapi search items, watch/videoDetails payloads, queue
 * entries, history rows) and artists hide in several fields. Every render
 * site (bottom bar, mini-player, NOW PLAYING panel, track page, queue, PiP
 * title, MediaSession) goes through resolveArtist so an artist is shown
 * whenever it is knowable — and never shows a bare placeholder when the
 * information exists somewhere in the object.
 */

export interface ArtistSource {
  artist?: string | null;
  artists?: unknown;
  author?: string | null;
  channelTitle?: string | null;
  channel?: string | null;
  subtitle?: string | null;
  title?: string | null;
}

const PLACEHOLDER_RE = /^(unknown\s+artist|unknown|various\s+artists|n\/a|-)$/i;

/** Drop VEVO/topic-channel suffixes and whitespace noise from a raw name. */
export function normalizeArtistName(name: string | null | undefined): string {
  if (!name) return "";
  let out = String(name).trim();
  out = out.replace(/\s*-\s*Topic\s*$/i, "");
  out = out.replace(/\s*-\s*VEVO\s*$/i, "");
  out = out.replace(/\s*VEVO\s*$/i, "");
  return out.trim();
}

function joinArtistList(raw: unknown): string {
  if (!raw) return "";
  if (typeof raw === "string") return normalizeArtistName(raw);
  const list = Array.isArray(raw) ? raw : [raw];
  const names: string[] = [];
  for (const entry of list) {
    if (typeof entry === "string" && entry.trim()) {
      names.push(normalizeArtistName(entry));
    } else if (entry && typeof entry === "object") {
      const name = (entry as { name?: unknown }).name;
      if (typeof name === "string" && name.trim()) names.push(normalizeArtistName(name));
    }
  }
  return names.filter(Boolean).join(", ");
}

/**
 * Parse "Artist - Title" out of a bare video title when no separate artist
 * metadata exists. Only splits when the title actually contains " - " and the
 * left side plausibly is a name (not a lyric line, URL, or tag blob).
 */
export function artistFromTitle(title: string | null | undefined): string {
  if (!title) return "";
  const idx = title.indexOf(" - ");
  if (idx <= 0 || idx > 60) return "";
  const left = title.slice(0, idx).trim();
  const right = title.slice(idx + 3).trim();
  if (!left || !right) return "";
  /* Reject obvious non-name left sides. */
  if (/^(https?:\/\/|www\.)/i.test(left)) return "";
  if (/[[(](?:official|lyrics?|audio|video|mv|hd|4k)/i.test(left)) return "";
  return left;
}

/**
 * Resolve the best artist name from any track-shaped object. Returns ""
 * when truly nothing is known — callers decide their own fallback label.
 */
export function resolveArtist(src: ArtistSource | null | undefined): string {
  if (!src) return "";
  const direct = normalizeArtistName(src.artist);
  if (direct && !PLACEHOLDER_RE.test(direct)) return direct;

  const fromList = joinArtistList(src.artists);
  if (fromList && !PLACEHOLDER_RE.test(fromList)) return fromList;

  for (const key of ["author", "channelTitle", "channel", "subtitle"] as const) {
    const alt = normalizeArtistName(src[key]);
    if (alt && !PLACEHOLDER_RE.test(alt)) return alt;
  }

  /* Last resort: "Artist - Title" baked into the video title. */
  const fromTitle = artistFromTitle(src.title);
  if (fromTitle) return fromTitle;

  /* Keep the placeholder strings themselves so callers fall back cleanly. */
  return direct || fromList || "";
}

/** True when the artist field is missing or a placeholder. */
export function isArtistMissing(artist: string | null | undefined): boolean {
  const v = normalizeArtistName(artist);
  return !v || PLACEHOLDER_RE.test(v);
}
