import { loadPref } from "./device";

export const ACCENT_KEY = "orca.accent";
export const ACCENT_HOVER_KEY = "orca.accentHover";

export const DEFAULT_ACCENT = "#4d6bfe";
export const DEFAULT_ACCENT_HOVER = "#6e8bff";

/**
 * Apply an accent palette to the whole document. Setting the custom
 * properties on the root element is enough because every accent consumer
 * (buttons, active states, borders, sliders, progress, glows) reads the
 * CSS variables — surfaces stay dark by design.
 */
export function applyPalette(accent: string, hover: string) {
  const root = document.documentElement;
  root.style.setProperty("--orca-accent", accent);
  root.style.setProperty("--orca-accent-hover", hover);
  root.style.setProperty("--orca-accent-glow", `${accent}59`);
}

/** Re-apply the saved palette (or the default) — call once at app boot. */
export function applySavedTheme() {
  applyPalette(
    loadPref(ACCENT_KEY, DEFAULT_ACCENT),
    loadPref(ACCENT_HOVER_KEY, DEFAULT_ACCENT_HOVER),
  );
}

/** The accent currently in effect, for active-state comparisons in UI. */
export function currentAccent(): string {
  return loadPref(ACCENT_KEY, DEFAULT_ACCENT).toLowerCase();
}
