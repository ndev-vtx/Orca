/*
 * Frontend mirror of orca.config tunables.
 * Phase 3 (playback engine) will import the deeper constants from here;
 * keep the numbers identical to backend/orca/config.py.
 */
export const SEARCH_DEBOUNCE_MS = 350;
export const SWITCH_TIMEOUT_MS = 28000;
export const SEEK_MS_BACKSTEP = 3500;
export const DEFAULT_VOLUME = 78;
export const MAX_AUTO_SKIP = 5;
export const REPEAT_MODES = ["off", "all", "one"] as const;
export type RepeatMode = (typeof REPEAT_MODES)[number];
