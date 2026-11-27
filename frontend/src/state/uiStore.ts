import { create } from "zustand";
import type { SongDto } from "../types";

export interface MenuAnchor {
  x: number;
  y: number;
}

/**
 * Global UI state for track context menus and the "Add to playlist" picker,
 * so any card, row, button or panel can open them with one call.
 */
interface UiState {
  /** Track whose three-dot menu is open, plus click position. */
  menu: { song: SongDto; anchor: MenuAnchor; playlistId?: number } | null;
  /** Track being added to a playlist via the picker. */
  pickerFor: SongDto | null;

  openMenu: (song: SongDto, anchor: MenuAnchor, playlistId?: number) => void;
  closeMenu: () => void;
  openPicker: (song: SongDto) => void;
  closePicker: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  menu: null,
  pickerFor: null,

  openMenu: (song, anchor, playlistId) => set({ menu: { song, anchor, playlistId } }),
  closeMenu: () => set({ menu: null }),
  openPicker: (song) => set({ pickerFor: song, menu: null }),
  closePicker: () => set({ pickerFor: null }),
}));
