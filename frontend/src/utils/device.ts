/*
 * device.ts
 * Device/environment detection combining viewport, pointer, touch and
 * user-agent signals. No single signal is reliable on its own (iPads report
 * as desktop Safari, foldables switch viewport), so the hook votes across
 * all of them and re-evaluates on resize/orientation change.
 */

import { useEffect, useState } from "react";

export function isTouchCapable(): boolean {
  return (
    typeof window !== "undefined" &&
    (navigator.maxTouchPoints > 0 ||
      "ontouchstart" in window ||
      (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches))
  );
}

export function isMobileUserAgent(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent);
}

/*
 * A phone-class layout: narrow viewport on a touch device (touch alone is
 * not enough — touch-screen laptops must keep the desktop layout).
 */
export function isMobileLayout(): boolean {
  if (typeof window === "undefined") return false;
  const narrow = window.innerWidth <= 768;
  return narrow && (isTouchCapable() || isMobileUserAgent());
}

export function isMobileDevice(): boolean {
  return isMobileLayout() || (isMobileUserAgent() && isTouchCapable());
}

const QUERY = "(max-width: 768px) and (pointer: coarse), (max-width: 520px)";

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(isMobileDevice);

  useEffect(() => {
    const mq = matchMedia(QUERY);
    const update = () => setMobile(isMobileDevice());
    mq.addEventListener("change", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      mq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return mobile;
}

/* Persisted lightweight preferences (theme palette, billboard settings). */

export function loadPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}
