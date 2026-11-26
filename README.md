# Orca

<div align="center">
  <img src="frontend/public/orca-icon.svg" width="72" alt="Orca icon" />
  <h3><em>Deep, dark, and always in motion — an ocean of music.</em></h3>
</div>

Orca is a rebuilt music companion on top of the proven Ember music core: YouTube
Music catalog search, yt-dlp stream resolution with an LRU stream cache, SQLite
playlists / favorites / history, LRCLIB lyrics, and playlist import from
YouTube & Spotify links — now behind the Spotify-style Web/Desktop UI in deep
black with DeepSeek dolphin-blue accents (`#4D6BFE` / `#6E8BFF`).

## Layout

```
orca/
├── backend/        Python FastAPI + WebSocket API over the unmodified core
│   ├── orca/       catalog · stream · cache · storage · lyrics · importer · exporter
│   └── tests/      pytest suite (41 tests)
└── frontend/       React 18 + TypeScript + Vite Spotify-style shell
```

## Run the backend

```bash
cd backend
pip install -r requirements.txt
uvicorn orca.server:app --host 127.0.0.1 --port 8765
# diagnostics: python -c "from orca import doctor; print(*doctor.collect(), sep='\n')"
```

## Run the frontend

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173, /api and /ws proxied to :8765
npm run build        # typecheck + production bundle
```

## API surface (phase 1)

| Area | Endpoints |
|:---|:---|
| Catalog | `GET /api/search`, `GET /api/home`, `GET /api/similar/{id}`, `GET /api/artists/top`, `GET /api/artist/{browseId}` |
| Streaming | `POST /api/resolve`, `GET /api/stream/{id}` (302), `GET /api/stream/proxy/{id}` (bytes, Range-aware) |
| Lyrics | `GET /api/lyrics/{id}` |
| Library | favorites · history · `now-playing` · playlist CRUD |
| Import/Export | `POST /api/import`, `POST /api/export` |
| Live sync | `WS /ws` |

Signed `googlevideo` URLs are never logged and never leak through error payloads.

## Tests

```bash
cd backend && python -m pytest tests/
cd frontend && npm run build   # strict TypeScript
```

## Roadmap

- [x] Phase 1 — core rebrand + backend API
- [x] Phase 2 — Spotify-style UI shell (3-pane layout, sidebar, library, now-playing bar)
- [ ] Phase 3 — playback engine (PlaybackCore state machine ported to TypeScript)
- [ ] Phase 4 — queue & lyrics views, import/export UI, Electron shell

## Run the whole web app in Docker

```bash
docker compose up -d --build
# Orca on http://localhost:8765 — UI + API from one service
```

The image builds the React frontend (Node stage), installs the Python core,
and serves both from a single uvicorn process. `ORCA_DATA_DIR=/data` holds
`orca.db` (favorites, history, playlists) — mounted to `./orca-data` on the
host so data survives rebuilds.

No Docker? The backend serves a built frontend by itself:

```bash
cd frontend && npm run build
cd ../backend && pip install -r requirements.txt
uvicorn orca.server:app --host 0.0.0.0 --port 8765
# http://localhost:8765 serves the UI; /api and /ws as documented above
```

The static mount is opt-in: it activates when `frontend/dist` exists
(or set `ORCA_STATIC_DIR`), and never shadows `/api` or `/ws`.

## Deploying to Vercel (or any serverless host)

The repo is Vercel-ready: `vercel.json` builds the frontend and runs the whole
FastAPI backend as a serverless function. Push and import the repo as a single
project — no extra setup on the Vercel side.

**YouTube bot check on datacenter IPs:** YouTube refuses *unsigned* stream
extraction from cloud providers ("Sign in to confirm you're not a bot"). Orca
rotates yt-dlp player profiles to dodge it, and the reliable fix is a signed-in
session cookie:

1. Use a throwaway Google/YouTube account (the cookie will be attached to it).
2. In a browser logged in **only** as that account, install a cookies export
   extension (e.g. "Get cookies.txt LOCALLY"), open `youtube.com`, and export
   in **Netscape format**.
3. In Vercel → Project → Settings → Environment Variables, add
   `ORCA_YT_COOKIE` with the whole file content as the value (multi-line is
   fine; escaped `\n` sequences also work), then redeploy.

Verify with `GET /api/doctor` — the `yt cookies` line must say `configured`.

Note that serverless storage is ephemeral: favorites, history and playlists
reset when the instance recycles. Point `ORCA_DATA_DIR` at a persistent disk
host, or mount one, for durable library data.
