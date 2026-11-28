# Orca

<p align="center">
  <img src="frontend/public/orca-icon.svg" alt="Orca" width="96" />
</p>

**Orca** is a Spotify-style streaming music app for the browser, Android and Windows. Search and play millions of tracks through YouTube Music discovery, read time-synced lyrics, build playlists, and keep listening with lock-screen / mini-player controls — all in a deep-black interface with an electric-blue accent.

- Web app: **https://orca-d.vercel.app**
- Downloads (Android `.apk` / Windows `.exe`): **https://github.com/ndev-vtx/Orca/releases**
- Developer: **Nguyễn Khôi Nguyên** (see [CREDITS.md](CREDITS.md))

---

## Features

- **Desktop & Mobile UI** — a fixed three-pane Spotify-style layout on desktop and a dedicated touch layout (bottom navigation, mini-player, full-screen sheets) on phones. Device detection combines viewport, pointer and user-agent signals so each platform gets the layout it deserves.
- **Synced lyrics** — time-synced LRC lyrics fetched from LRCLIB, auto-scrolling with playback, pausing cleanly when you scroll manually (with a **Sync** pill to re-follow), cached in memory + `localStorage` and prefetched for the next queued track.
- **Desktop Spotify-style PiP** — a floating mini-player (cover art, title, artist, progress, prev / play / next, volume, repeat) via the Document Picture-in-Picture API. Auto-opens when a track is playing and you switch tabs; manual-only while paused; stays usable even shrunk into a corner. Mobile uses native `MediaSession` lock-screen controls instead.
- **Playlists** — create, rename, delete, add/remove tracks, reorder by drag & drop, in-playlist search and sorting, "Add to Playlist" from anywhere with a clean empty state.
- **Theme Palette** — pick an accent color in Settings and the whole app updates (buttons, active states, highlights, player controls) while the dark surfaces stay dark.
- **Android `.apk` & Windows `.exe`** — packaged automatically by GitHub Actions on every push to `main`. The Android build runs as a real app with a foreground media service (music keeps playing when the screen locks), and the Windows build is a lightweight Electron wrapper around the live app with tray + media-key support.

## Roadmap

- Server-side database (Postgres) to replace the ephemeral per-deployment SQLite storage.
- True offline playback with downloadable audio in the PWA.
- Native iOS packaging alongside the Android APK.
- Collaborative playlists and shared queues.
- Equalizer / audio normalization controls.
- Optional self-hosted extraction worker for deployments that want server-side stream resolution.

## Local development

Requirements: **Node.js 20+** and **Python 3.11+**.

```bash
# Frontend
cd frontend
npm install
npm run dev          # Vite dev server on http://localhost:5173

# Backend API (in a second terminal)
cd backend
pip install -r requirements.txt
uvicorn orca.server:create_app --factory --port 8000
```

Point the frontend at the backend with `VITE_API_BASE=http://localhost:8000` (or rely on the Vercel-style rewrite locally). Data is stored in SQLite under `ORCA_DATA_DIR` (default `./data`).

## Build & package

```bash
# Web production build
cd frontend && npm run build

# Android APK (requires Java 21 + Android SDK)
npm install && npx cap sync android
cd android && ./gradlew assembleDebug

# Windows desktop wrapper
cd desktop && npm install && npm run dist
```

Pushes to `main` trigger the **Auto Release** workflow, which builds and publishes `Orca_Latest.apk` / `Orca_v<version>.apk` and `Orca_Latest.exe` / `Orca_v<version>.exe` to [Releases](https://github.com/ndev-vtx/Orca/releases).

## Tech stack

FastAPI · yt-dlp · ytmusicapi · LRCLIB · SQLite · React 18 · TypeScript (strict) · Vite 5 · zustand 4 · Capacitor 7 · Electron. See [CREDITS.md](CREDITS.md) for the full credits.

## License

[MIT](LICENSE) — © Nguyễn Khôi Nguyên
