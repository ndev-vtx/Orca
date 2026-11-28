import type {
  ArtistDetail,
  AuthProviders,
  AuthResponse,
  FavoritesResponse,
  HomeSection,
  ImportResult,
  LyricsResponse,
  PlaylistDetail,
  PlaylistSummary,
  SearchFilter,
  SongDto,
  TrackDetail,
  UserDto,
} from "../types";
import { Capacitor } from "@capacitor/core";

/*
 * API base resolution:
 * 1. VITE_API_BASE wins when set at build time (self-hosted deployments).
 * 2. Inside the Capacitor Android APK the WebView origin is a local
 *    https://localhost asset host — relative /api/... paths would return the
 *    bundled index.html ("Unexpected token '<', "<!doctype "... is not valid
 *    JSON"), so every request targets the live deployment instead.
 * 3. Plain browser deployments use relative paths (same-origin, no CORS).
 */
const NATIVE_API_BASE = "https://orca-d.vercel.app";

function resolveApiBase(): string {
  const envBase = (import.meta.env.VITE_API_BASE as string | undefined)?.trim();
  if (envBase) return envBase.replace(/\/+$/, "");
  try {
    if (Capacitor.isNativePlatform()) return NATIVE_API_BASE;
  } catch {
    /* not running inside Capacitor */
  }
  return "";
}

const BASE = resolveApiBase();

/*
 * Per-browser guest id: every signed-out visitor gets a private library
 * scope server-side instead of sharing one 'anon' bucket. Random, persisted
 * in localStorage, sent on every request; ignored while signed in.
 */
const GUEST_ID_KEY = "orca.guest.id";

function guestId(): string {
  try {
    let id = localStorage.getItem(GUEST_ID_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `g${Date.now()}${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(GUEST_ID_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const guest = guestId();
  if (guest) headers.set("X-Orca-Guest", guest);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers });
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

function patch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function put<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface ResolveStreamResult {
  url: string;
  error: string;
  permanent: boolean;
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
  album: (browseId: string) =>
    request<AlbumResponse>(`/api/album/${encodeURIComponent(browseId)}`),

  artist: (browseId: string) =>
    request<ArtistDetail>(`/api/artist/${encodeURIComponent(browseId)}`),

  billboard: (chart: string, region: string) =>
    request<SongDto[]>(`/api/billboard?chart=${encodeURIComponent(chart)}&region=${encodeURIComponent(region)}`),

  clearHistory: () => del<Record<string, never>>("/api/library/history"),

  lyrics: (song: SongDto) => {
    const params = new URLSearchParams({
      title: song.title,
      artist: song.artist,
    });
    return request<LyricsResponse>(`/api/lyrics/${encodeURIComponent(song.videoId)}?${params.toString()}`);
  },

  favorites: () => request<FavoritesResponse>("/api/library/favorites"),

  addFavorite: (song: SongDto) =>
    post<Record<string, never>>("/api/library/favorites", song),

  removeFavorite: (videoId: string) =>
    del<Record<string, never>>(`/api/library/favorites/${encodeURIComponent(videoId)}`),

  history: (limit = 50) =>
    request<{ history: SongDto[] }>(`/api/library/history?limit=${limit}`),

  track: (videoId: string) =>
    request<TrackDetail>(`/api/track/${encodeURIComponent(videoId)}`),

  playlists: () => request<PlaylistSummary[]>("/api/library/playlists"),

  playlist: (id: number) => request<PlaylistDetail>(`/api/library/playlists/${id}`),

  createPlaylist: (name: string) =>
    post<PlaylistSummary>("/api/library/playlists", {
      name,
      sourceType: "custom",
    }),

  deletePlaylist: (id: number) =>
    del<Record<string, never>>(`/api/library/playlists/${id}`),

  renamePlaylist: (id: number, name: string) =>
    patch<Record<string, never>>(`/api/library/playlists/${id}`, { name }),

  addToPlaylist: (id: number, songs: SongDto[]) =>
    post<{ ok: boolean; added?: number }>(`/api/library/playlists/${id}/tracks`, { songs }),

  removeFromPlaylist: (id: number, videoId: string) =>
    del<Record<string, never>>(
      `/api/library/playlists/${id}/tracks/${encodeURIComponent(videoId)}`,
    ),

  reorderPlaylistTracks: (id: number, order: string[]) =>
    put<{ ok: boolean }>(`/api/library/playlists/${id}/tracks/order`, { order }),

  importPlaylistUrl: (url: string) =>
    post<ImportResult>(
      "/api/import",
      { url },
    ),

  nowPlaying: (song: SongDto, context: string) =>
    post<{ ok: boolean }>("/api/now-playing", {
      song: {
        videoId: song.videoId,
        title: song.title,
        artist: song.artist,
        duration: song.duration,
        artworkUrl: song.artworkUrl,
        type: song.type,
      },
      context,
    }),

  resolveStream: (videoId: string) =>
    post<ResolveStreamResult>("/api/resolve", { video_id: videoId }),

  streamUrl: (videoId: string, mode: "redirect" | "proxy" = "redirect") =>
    mode === "proxy"
      ? `${BASE}/api/stream/proxy/${encodeURIComponent(videoId)}`
      : `${BASE}/api/stream/${encodeURIComponent(videoId)}`,
};

export interface AlbumResponse {
  browseId: string;
  title: string;
  artist: string;
  year: string;
  cover: string;
  tracks: SongDto[];
}


/* ------------------------------------------------------------------ auth */

export const AUTH_TOKEN_KEY = "orca.auth.token";

export function storedToken(): string {
  return localStorage.getItem(AUTH_TOKEN_KEY) ?? "";
}

function withAuth(init?: RequestInit): RequestInit {
  const token = storedToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

export interface AuthApi {
  providers(): Promise<AuthProviders>;
  signup(name: string, email: string, password: string, confirm: string, agreed: boolean): Promise<AuthResponse>;
  login(email: string, password: string): Promise<AuthResponse>;
  google(credential: string): Promise<AuthResponse>;
  me(): Promise<UserDto | null>;
  logout(): Promise<void>;
}

export const authApi: AuthApi = {
  providers: () => request<AuthProviders>("/api/auth/providers"),
  signup: (name, email, password, confirm, agreed) =>
    post<AuthResponse>("/api/auth/signup", { name, email, password, confirmPassword: confirm, agreed }),
  login: (email, password) => post<AuthResponse>("/api/auth/login", { email, password }),
  google: (credential) => post<AuthResponse>("/api/auth/google", { credential }),
  me: async () => {
    if (!storedToken()) return null;
    try {
      const res = await request<{ user: UserDto }>("/api/auth/me", withAuth());
      return res.user;
    } catch {
      return null;
    }
  },
  logout: async () => {
    try {
      await request("/api/auth/logout", withAuth({ method: "POST" }));
    } catch {
      /* token already dead server-side */
    }
    localStorage.removeItem(AUTH_TOKEN_KEY);
  },
};
