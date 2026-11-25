export interface SongDto {
  videoId: string;
  title: string;
  artist: string;
  duration: string;
  artworkUrl: string;
  streamUrl?: string | null;
  type: string;
}

export interface HomeSection {
  title: string;
  tracks: SongDto[];
}

export interface PlaylistSummary {
  id: number;
  name: string;
  sourceType: string;
  sourceUrl: string;
  createdAt: string;
  trackCount: number;
}

export interface PlaylistDetail extends PlaylistSummary {
  tracks: SongDto[];
}

export interface FavoritesResponse {
  favorites: SongDto[];
  ids: string[];
}

export type LibraryFilter = "all" | "playlists" | "artists" | "albums";

export type SearchFilter =
  | "all"
  | "songs"
  | "videos"
  | "artists"
  | "albums"
  | "playlists";

export interface ArtistEntry {
  artist: string;
  artworkUrl: string;
  count: number;
}
