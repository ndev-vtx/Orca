import { create } from "zustand";
import type { SongDto } from "../types";

export interface MenuAnchor {
  x: number;
  y: number;
}

/** Optional context for the three-dot menu. */
export interface MenuOptions {
  /** Set when the menu is opened from inside a playlist page. */
  playlistId?: number;
  /** Set when the track's album browse id is known (enables "Go to album"). */
  albumId?: string;
}

/**
 * Global UI state for track context menus and the "Add to playlist" picker,
 * so any card, row, button or panel can open them with one call.
 */
interface UiState {
  /** Track whose three-dot menu is open, plus click position and context. */
  menu: { song: SongDto; anchor: MenuAnchor; options?: MenuOptions } | null;
  /** Track being added to a playlist via the picker. */
  pickerFor: SongDto | null;

  openMenu: (song: SongDto, anchor: MenuAnchor, options?: MenuOptions) => void;
  closeMenu: () => void;
  openPicker: (song: SongDto) => void;
  closePicker: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  menu: null,
  pickerFor: null,

  openMenu: (song, anchor, options) => set({ menu: { song, anchor, options } }),
  closeMenu: () => set({ menu: null }),
  openPicker: (song) => set({ pickerFor: song, menu: null }),
  closePicker: () => set({ pickerFor: null }),
}));
