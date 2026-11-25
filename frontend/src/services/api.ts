import type {
  FavoritesResponse,
  HomeSection,
  PlaylistDetail,
  PlaylistSummary,
  SearchFilter,
  SongDto,
} from "../types";

const BASE = import.meta.env.VITE_API_BASE ?? "";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new ApiError("Orca backend unreachable", 0);
  }
  if (!res.ok) {
    let detail = `request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body && typeof body.detail === "string") detail = body.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail, res.status);
  }
  return (await res.json()) as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

export interface SearchParams {
  query: string;
  filter?: SearchFilter;
  limit?: number;
}

export const api = {
  health: () =>
    request<{ status: string; app: string; version: string }>("/api/health"),

  home: (limit = 12) =>
    request<{ sections: HomeSection[] }>(`/api/home?limit=${limit}`),

  search: ({ query, filter, limit = 30 }: SearchParams) => {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (filter && filter !== "all") params.set("filter", filter);
    return request<SongDto[]>(`/api/search?${params.toString()}`);
  },

  similar: (videoId: string) =>
    request<SongDto[]>(`/api/similar/${encodeURIComponent(videoId)}`),

  lyrics: (song: SongDto) => {
    const params = new URLSearchParams({
      title: song.title,
      artist: song.artist,
    });
    return request<{
      videoId: string;
      synced: string | null;
      plain: string | null;
      parsed: { timeMs: number; text: string }[];
    }>(`/api/lyrics/${encodeURIComponent(song.videoId)}?${params.toString()}`);
  },

  favorites: () => request<FavoritesResponse>("/api/library/favorites"),

  addFavorite: (song: SongDto) =>
    post<Record<string, never>>("/api/library/favorites", song),

  removeFavorite: (videoId: string) =>
    del<Record<string, never>>(`/api/library/favorites/${encodeURIComponent(videoId)}`),

  history: (limit = 50) =>
    request<{ history: SongDto[] }>(`/api/library/history?limit=${limit}`),

  playlists: () => request<PlaylistSummary[]>("/api/library/playlists"),

  playlist: (id: number) => request<PlaylistDetail>(`/api/library/playlists/${id}`),

  createPlaylist: (name: string) =>
    post<PlaylistSummary>("/api/library/playlists", {
      name,
      sourceType: "custom",
    }),

  deletePlaylist: (id: number) =>
    del<Record<string, never>>(`/api/library/playlists/${id}`),

  addToPlaylist: (id: number, songs: SongDto[]) =>
    post<Record<string, never>>(`/api/library/playlists/${id}/tracks`, { songs }),

  removeFromPlaylist: (id: number, videoId: string) =>
    del<Record<string, never>>(
      `/api/library/playlists/${id}/tracks/${encodeURIComponent(videoId)}`,
    ),

  importPlaylistUrl: (url: string) =>
    post<{ ok: boolean; name?: string; playlistId?: number; error?: string }>(
      "/api/import",
      { url },
    ),

  streamUrl: (videoId: string, mode: "redirect" | "proxy" = "redirect") =>
    mode === "proxy"
      ? `${BASE}/api/stream/proxy/${encodeURIComponent(videoId)}`
      : `${BASE}/api/stream/${encodeURIComponent(videoId)}`,
};
