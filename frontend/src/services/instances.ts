/*
 * instances.ts
 * Client-side extraction fallback: when the Orca backend cannot resolve a
 * stream (datacenter IP refused by YouTube), the browser asks the same
 * public Piped / Invidious instances directly. The request comes from the
 * listener's own connection, which YouTube never bot-checks, and the
 * instances hand out playback URLs through their own proxies so any client
 * can play them.
 */

export interface RemoteStream {
  url: string;
  via: string;
}

const PIPED_APIS = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://api.piped.private.coffee",
  "https://pipedapi.ducks.party",
  "https://pipedapi.reallyaweso.me",
  "https://pipedapi.nosebs.ru",
  "https://pipedapi.phoenixthrush.com",
];

const INVIDIOUS = [
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://yt.chocolatemoo53.com",
  "https://invidious.tiekoetter.com",
  "https://yewtu.be",
];

function host(base: string): string {
  try {
    return new URL(base).hostname;
  } catch {
    return base;
  }
}

async function withTimeout(ms: number): Promise<AbortSignal> {
  return AbortSignal.timeout(ms);
}

/*
 * Audio elements are not bound by CORS, but our validation fetch is. A
 * failed validation fetch from a live instance is therefore inconclusive
 * (usually CORS, sometimes a dead proxy), so a healthy API response makes
 * the URL worth trying — the player's error path stays as the last judge.
 */
async function streamFetchable(url: string, instanceAlive: boolean): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { Range: "bytes=0-1023" },
      signal: await withTimeout(7000),
    });
    return res.ok || res.status === 206;
  } catch {
    return instanceAlive;
  }
}

function pickPipedAudio(streams: unknown[]): { url: string; mime: string } | null {
  const valid = streams.filter(
    (s): s is { url: string; mimeType?: string; bitrate?: number } =>
      typeof s === "object" && s !== null && typeof (s as { url?: unknown }).url === "string" &&
      (s as { url: string }).url !== "",
  );
  if (!valid.length) return null;
  const rank = (s: { mimeType?: string; bitrate?: number }): { quality: number; bitrate: number } => {
    const mime = (s.mimeType ?? "").split(";")[0].trim().toLowerCase();
    const quality = mime === "audio/mp4" ? 0 : mime === "audio/webm" ? 2 : 1;
    return { quality, bitrate: -(s.bitrate ?? 0) };
  };
  valid.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra.quality - rb.quality || ra.bitrate - rb.bitrate;
  });
  const best = valid[0];
  return { url: best.url, mime: (best.mimeType ?? "").split(";")[0].trim().toLowerCase() };
}

export async function resolveFromBrowser(videoId: string): Promise<RemoteStream | null> {
  for (const base of PIPED_APIS) {
    try {
      const res = await fetch(`${base}/streams/${videoId}`, { signal: await withTimeout(8000) });
      if (!res.ok) continue;
      const data = (await res.json()) as { audioStreams?: unknown[] };
      const best = pickPipedAudio(data.audioStreams ?? []);
      if (!best) continue;
      if (await streamFetchable(best.url, true)) {
        return { url: best.url, via: `piped (${host(base)})` };
      }
    } catch {
      // instance unreachable from this network — try the next one
    }
  }
  for (const base of INVIDIOUS) {
    const url = `${base}/latest_version?id=${videoId}&itag=140&local=true`;
    try {
      if (await streamFetchable(url, true)) {
        return { url, via: `invidious (${host(base)})` };
      }
    } catch {
      // next instance
    }
  }
  return null;
}
