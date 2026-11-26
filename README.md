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

## Deploying to Vercel (or any serverless host)

The repo is Vercel-ready: `vercel.json` builds the frontend and runs the whole
FastAPI backend as a serverless function. Push and import the repo as a single
project — no extra setup on the Vercel side.

**YouTube blocks unsigned stream extraction from datacenter IPs** ("Sign in to
confirm you're not a bot"). Orca rotates yt-dlp player profiles to dodge it,
but the reliable fix is a signed-in session cookie:

1. Use a **throwaway** Google/YouTube account (automated use can get an
   account rate-limited or banned — never your main one).
2. Open a **private/incognito window**, log into YouTube as that account.
3. In the **same window and tab**, open `https://www.youtube.com/robots.txt`
   (keep it the only open private tab — this freezes cookie rotation).
4. Export `youtube.com` cookies from that tab with an extension such as
   "Get cookies.txt LOCALLY" (**Netscape format**), then **close the incognito
   window immediately** so YouTube never rotates the session.
5. Vercel → Project → Settings → Environment Variables → add `ORCA_YT_COOKIE`
   with the whole file as the value (multi-line fine, escaped `\n` also
   works), then redeploy.

Check `https://<your-app>.vercel.app/api/doctor` afterwards:

- `yt cookies : configured` — the env var was picked up
- `stream test : OK (signed url issued)` — extraction works end-to-end
- `stream test : FAILED: <reason>` — the verbatim YouTube/yt-dlp refusal to debug with

`ORCA_YTDLP_CLIENTS` (optional) overrides the player profiles, e.g.
`tv,web_safari;android_vr` (`;` separates profiles tried in order, `,` the
clients per profile). Cookie sessions automatically fetch the watch page
(only pageless extraction skips it).

### Zero-extra-server sourcing: public mirrors (default on)

Hosted deployments additionally resolve streams through public **Piped /
Invidious / Cobalt** instances before touching yt-dlp (see
`backend/orca/remote.py`). These instances resolve the track on their own
egress and proxy the bytes themselves, so the URL they hand out plays from
**any** client IP — no token server, no cookies required in many cases.
Every candidate URL is validated with a ranged GET before being returned.

If the server layer comes up empty, the **browser itself** asks the same
instances directly (`frontend/src/services/instances.ts`): the request
comes from the listener's own connection, which YouTube never bot-checks.

Optional environment overrides:

- `ORCA_REMOTE_SOURCES=off` — disable the mirror layer entirely
- `ORCA_PIPED_INSTANCES`, `ORCA_INVIDIOUS_INSTANCES`, `ORCA_COBALT_INSTANCES`
  — comma-separated instance base URLs (order = preference)

Public instances are community-run: performance varies and no instance is an
SLA. When a track sometimes fails to load, appending more instances via the
env vars is the whole maintenance story. The yt-dlp ladder (cookies,
`ORCA_YTDLP_CLIENTS`, optional `ORCA_POT_BASE_URL` PO-token provider) stays
as the fallback layer and is what works on residential connections such as a
locally run desktop container.

### Legacy PO-token provider details

Even with cookies, YouTube increasingly **gates audio-only formats behind
proof-of-origin (PO) tokens** on datacenter IPs — you'll see "Requested format
is not available" or `UNPLAYABLE` for every profile in `/api/resolve`'s
`trail`. The sanctioned fix is [bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider)
(maintainer-endorsed in yt-dlp #17497: use a PO token provider + the `mweb`
client). Orca already ships the yt-dlp plugin; it just needs a provider
server:

1. Import [FoxeiZ/bgutil-ytdlp-pot-vercal](https://github.com/FoxeiZ/bgutil-ytdlp-pot-vercal)
   into Vercel as its **own project** (it is the bgutil server packaged for
   Vercel; deploy with defaults).
2. Note its URL, e.g. `https://your-pot-provider.vercel.app`.
3. On the **Orca** project, add env var `ORCA_POT_BASE_URL` with that URL and
   redeploy.
4. Sanity-check the provider: `curl https://your-pot-provider.vercel.app/ping`
   should answer with a version. (The endpoint is unauthenticated — fine for a
   hobby deployment, but don't advertise the URL.)

Cookies + PO tokens together is the combination that works on serverless:
tokens prove the request's origin to YouTube's web clients, the cookie clears
the login requirement that tokens alone cannot bypass on flagged IPs.
Doctor now prints `yt pot provider : configured` when the wiring is picked up,
and the `stream test` exercises token minting end to end.

Note that serverless storage is ephemeral: favorites, history and playlists
reset when the instance recycles. Point `ORCA_DATA_DIR` at a persistent disk
host, or mount one, for durable library data.
