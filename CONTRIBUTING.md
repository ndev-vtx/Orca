# Contributing to Orca

Thank you for your interest in improving Orca! 🐋

## Project overview

Orca is a Spotify-style music app:

- **`frontend/`** — React 18 + TypeScript (strict) + Vite 5 + zustand. The player engine lives in `src/services/audioEngine.ts` and `src/state/player.ts`.
- **`backend/`** — FastAPI app (`backend/orca/`): catalog discovery (ytmusicapi), stream resolution (yt-dlp + mirror ladder), lyrics (LRCLIB), SQLite storage, authentication.
- **`android/`** — Capacitor 7 wrapper producing the Android APK (foreground media service for background playback).
- **`desktop/`** — lightweight Electron wrapper producing the Windows EXE.
- **`.github/workflows/release.yml`** — the Auto Release pipeline (APK + EXE on every push to `main`).

## Getting started

```bash
git clone https://github.com/ndev-vtx/Orca.git
cd Orca

cd frontend && npm install && npm run dev
# in another terminal
cd backend && pip install -r requirements.txt
uvicorn orca.server:create_app --factory --port 8000
```

## Before you open a pull request

1. **Type-check & build the frontend:** `cd frontend && npx tsc -b && npm run build`
2. **Run backend tests:** `cd backend && python3 -m pytest -q`
3. **Keep the design language:** deep-black surfaces (`#05070C` / `#000000` / `#121212`) with the DeepSeek electric-blue accent (`#4D6BFE`, hover `#6E8BFF`). Use the CSS custom properties from `frontend/src/styles/theme.css` instead of hard-coded colors.
4. **Keep changes focused** — one logical change per pull request, with a clear description of what and why.
5. **Respect the rebranding rule:** never reintroduce the old app name; ordinary English words containing the same letters (e.g. "remember", "members-only") are fine.

## Reporting bugs

Open a GitHub issue and include:

- What you did and what you expected to happen
- What actually happened (screenshots help a lot)
- Platform (Windows / macOS / Linux, desktop or mobile browser, Android APK version)

## Feature requests

Open an issue with the `enhancement` label describing the problem you're trying to solve, not just the solution you have in mind.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
