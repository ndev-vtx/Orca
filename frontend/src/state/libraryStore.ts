import { create } from "zustand";
import { api } from "../services/api";
import type { ArtistEntry, LibraryFilter, PlaylistSummary, SongDto } from "../types";

export const LIBRARY_FILTER_KEY = "orca.library.filter";
export const SIDEBAR_COLLAPSED_KEY = "orca.ui.sidebar.collapsed";

interface LibraryState {
  backendOk: boolean;
  backendError: string;
  playlists: PlaylistSummary[];
  playlistSummaries: PlaylistSummary[];
  /** Bumped whenever any playlist's contents change, so open playlist pages re-fetch. */
  playlistVersion: number;
  savedTracks: SongDto[];
  savedIds: Set<string>;
  libraryFilter: LibraryFilter;
  libraryQuery: string;
  sidebarCollapsed: boolean;

  setLibraryFilter: (filter: LibraryFilter) => void;
  setLibraryQuery: (query: string) => void;
  toggleSidebar: () => void;
  loadLibrary: () => Promise<void>;
  refreshPlaylists: () => Promise<void>;
  toggleSaved: (song: SongDto) => Promise<void>;
  createPlaylist: (name: string) => Promise<PlaylistSummary>;
  deletePlaylist: (id: number) => Promise<void>;
  removeFromPlaylist: (id: number, videoId: string) => Promise<void>;
  /** Resolves with the number of tracks that actually landed (duplicates skipped). */
  addTracksToPlaylist: (id: number, songs: SongDto[]) => Promise<number>;
}

function loadFilter(): LibraryFilter {
  const raw = localStorage.getItem(LIBRARY_FILTER_KEY);
  return raw === "playlists" || raw === "artists" || raw === "albums" ? raw : "all";
}

function loadCollapsed(): boolean {
  return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  backendOk: false,
  backendError: "",
  playlists: [],
  playlistSummaries: [],
  playlistVersion: 0,
  savedTracks: [],
  savedIds: new Set(),
  libraryFilter: loadFilter(),
  libraryQuery: "",
  sidebarCollapsed: loadCollapsed(),

  setLibraryFilter: (filter) => {
    localStorage.setItem(LIBRARY_FILTER_KEY, filter);
    set({ libraryFilter: filter });
  },

  setLibraryQuery: (query) => set({ libraryQuery: query }),

  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
    set({ sidebarCollapsed: next });
  },

  refreshPlaylists: async () => {
    try {
      const playlists = await api.playlists();
      set({ playlists, backendOk: true, backendError: "" });
    } catch (err) {
      set({
        backendOk: false,
        backendError: err instanceof Error ? err.message : "backend unreachable",
      });
    }
  },

  loadLibrary: async () => {
    try {
      const [fav, playlists] = await Promise.all([api.favorites(), api.playlists()]);
      set({
        savedTracks: fav.favorites,
        savedIds: new Set(fav.ids),
        playlists,
        backendOk: true,
        backendError: "",
      });
    } catch (err) {
      set({
        backendOk: false,
        backendError: err instanceof Error ? err.message : "backend unreachable",
      });
    }
  },

  toggleSaved: async (song) => {
    const { savedIds, savedTracks } = get();
    if (savedIds.has(song.videoId)) {
      const nextIds = new Set(savedIds);
      nextIds.delete(song.videoId);
      set({
        savedIds: nextIds,
        savedTracks: savedTracks.filter((t) => t.videoId !== song.videoId),
      });
      try {
        await api.removeFavorite(song.videoId);
      } catch {
        set({
          savedIds: new Set(get().savedIds).add(song.videoId),
          savedTracks: [song, ...get().savedTracks],
        });
      }
      return;
    }
    set({
      savedIds: new Set(savedIds).add(song.videoId),
      savedTracks: [song, ...savedTracks],
    });
    try {
      await api.addFavorite(song);
    } catch {
      const revert = new Set(get().savedIds);
      revert.delete(song.videoId);
      set({
        savedIds: revert,
        savedTracks: get().savedTracks.filter((t) => t.videoId !== song.videoId),
      });
    }
  },

  createPlaylist: async (name) => {
    const created = await api.createPlaylist(name);
    await get().refreshPlaylists();
    return created;
  },

  deletePlaylist: async (id) => {
    await api.deletePlaylist(id);
    await get().refreshPlaylists();
  },

  removeFromPlaylist: async (id, videoId) => {
    await api.removeFromPlaylist(id, videoId);
    await get().refreshPlaylists();
    set({ playlistVersion: get().playlistVersion + 1 });
  },

  addTracksToPlaylist: async (id, songs) => {
    const res = await api.addToPlaylist(id, songs);
    await get().refreshPlaylists();
    set({ playlistVersion: get().playlistVersion + 1 });
    return res?.added ?? 0;
  },
}));

export function selectLibraryItems(state: LibraryState): SongDto[] {
  const query = state.libraryQuery.trim().toLowerCase();
  const base = state.savedTracks;
  if (!query) return base;
  return base.filter(
    (t) => t.title.toLowerCase().includes(query) || t.artist.toLowerCase().includes(query),
  );
}

export function selectArtistEntries(state: LibraryState): ArtistEntry[] {
  const byArtist = new Map<string, ArtistEntry>();
  for (const track of state.savedTracks) {
    const name = track.artist || "unknown artist";
    const entry = byArtist.get(name) ?? { artist: name, artworkUrl: track.artworkUrl, count: 0 };
    if (!entry.artworkUrl) entry.artworkUrl = track.artworkUrl;
    entry.count += 1;
    byArtist.set(name, entry);
  }
  const query = state.libraryQuery.trim().toLowerCase();
  const entries = [...byArtist.values()].sort((a, b) => b.count - a.count);
  if (!query) return entries;
  return entries.filter((e) => e.artist.toLowerCase().includes(query));
}

export function selectPlaylistRows(state: LibraryState): PlaylistSummary[] {
  const query = state.libraryQuery.trim().toLowerCase();
  if (!query) return state.playlists;
  return state.playlists.filter((p) => p.name.toLowerCase().includes(query));
}

export function selectAlbumRows(state: LibraryState): SongDto[] {
  const query = state.libraryQuery.trim().toLowerCase();
  const base = state.savedTracks.filter((t) => t.type === "album" || t.type === "single");
  if (!query) return base;
  return base.filter(
    (t) => t.title.toLowerCase().includes(query) || t.artist.toLowerCase().includes(query),
  );
}
