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

export interface LyricLine {
  timeMs: number;
  text: string;
}

export interface LyricsResponse {
  videoId: string;
  synced: string | null;
  plain: string | null;
  parsed: LyricLine[];
  error: string;
}

export interface ImportResult {
  ok: boolean;
  name?: string;
  playlistId?: number;
  error?: string;
}

export interface AlbumDetail {
  browseId: string;
  title: string;
  artist: string;
  year: string;
  cover: string;
  tracks: SongDto[];
}

export type BillboardChart = "hot100" | "viral" | "new";

export type BillboardRegion = "global" | "us" | "uk" | "vietnam" | "korea" | "japan";

export interface BillboardPref {
  enabled: boolean;
  chart: BillboardChart;
  region: BillboardRegion;
}

export interface UserDto {
  id: number;
  name: string;
  email: string;
  avatar: string;
  provider: string;
}

export interface AuthResponse {
  token: string;
  user: UserDto;
}

export interface AuthProviders {
  google: boolean;
  clientId: string;
}

export interface TrackCredits {
  channel: string;
  source: string;
}

export interface TrackDetail {
  videoId: string;
  title: string;
  artist: string;
  duration: string;
  artworkUrl: string;
  album: string;
  albumId: string;
  year: string;
  credits: TrackCredits;
  song: SongDto | null;
}
