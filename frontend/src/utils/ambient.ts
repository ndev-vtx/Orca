/*
 * ambient.ts
 * Spotify-style "header glow": extract the dominant vibrant color from a
 * cover artwork and expose it as a gradient that blends into Orca's dark
 * surfaces. Extraction runs on a tiny off-screen canvas (CORS-safe: ytimg
 * sends permissive CORS headers; anything else fails soft to null).
 */

import { useEffect, useState } from "react";

const cache = new Map<string, string>();

/**
 * Pull the dominant *vibrant* color out of an image. Downsamples to 24x24,
 * buckets pixels by hue, and averages the bucket weighted by saturation so
 * grey/dark washes lose to a genuinely colorful accent. Returns
 * "r, g, b" (for rgba() composition) or null when nothing vibrant exists.
 */
export async function extractAmbientColor(url: string): Promise<string | null> {
  if (!url) return null;
  const cached = cache.get(url);
  if (cached !== undefined) return cached;

  try {
    const img = await loadImage(url);
    const size = 24;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    // Hue-bucketed accumulators (12 buckets of 30°).
    const count = new Array(12).fill(0);
    const rSum = new Array(12).fill(0);
    const gSum = new Array(12).fill(0);
    const bSum = new Array(12).fill(0);
    let anyR = 0;
    let anyG = 0;
    let anyB = 0;
    let anyN = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a < 128) continue;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max < 28 || max > 250) continue; // near-black / blown-out
      const sat = max === 0 ? 0 : (max - min) / max;
      anyR += r; anyG += g; anyB += b; anyN += 1;
      if (sat < 0.22) continue; // greys never win a hue bucket
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      if (lum < 0.12 || lum > 0.92) continue;
      let hue = 0;
      const d = max - min;
      if (d === 0) hue = 0;
      else if (max === r) hue = ((g - b) / d) % 6;
      else if (max === g) hue = (b - r) / d + 2;
      else hue = (r - g) / d + 4;
      if (hue < 0) hue += 6;
      const bucket = Math.min(11, Math.floor((hue / 6) * 12));
      const weight = sat * sat; // strongly saturated pixels dominate
      count[bucket] += weight;
      rSum[bucket] += r * weight;
      gSum[bucket] += g * weight;
      bSum[bucket] += b * weight;
    }

    let bucket = -1;
    let best = 0;
    for (let i = 0; i < 12; i += 1) {
      if (count[i] > best) {
        best = count[i];
        bucket = i;
      }
    }

    let rgb: [number, number, number];
    if (bucket >= 0 && best > 0) {
      rgb = [rSum[bucket] / best, gSum[bucket] / best, bSum[bucket] / best];
    } else if (anyN > 0) {
      rgb = [anyR / anyN, anyG / anyN, anyB / anyN];
    } else {
      cache.set(url, "");
      return null;
    }

    // Clamp brightness so the glow stays subtle on the dark theme.
    rgb = rgb.map((c) => Math.min(235, Math.max(40, c))) as [number, number, number];
    const result = `${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}`;
    cache.set(url, result);
    return result;
  } catch {
    cache.set(url, "");
    return null;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = url;
  });
}

/** Turn an "r, g, b" string into the page-header gradient, or null for the default. */
export function ambientGradient(rgb: string | null): string | null {
  if (!rgb) return null;
  return (
    `radial-gradient(120% 150% at 20% -20%, rgba(${rgb}, 0.50), transparent 62%), ` +
    `radial-gradient(90% 120% at 85% -30%, rgba(${rgb}, 0.22), transparent 58%), ` +
    `linear-gradient(180deg, rgba(${rgb}, 0.30), var(--orca-surface) 92%)`
  );
}

/**
 * Hook: dominant color of an artwork URL, "" while resolving / unsupported,
 * null when the artwork produced nothing (caller keeps the default theme).
 */
export function useAmbientColor(url: string | null | undefined): string | null {
  const [rgb, setRgb] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRgb(null);
    if (!url) return;
    void extractAmbientColor(url).then((result) => {
      if (live) setRgb(result);
    });
    return () => {
      live = false;
    };
  }, [url]);

  return rgb;
}
