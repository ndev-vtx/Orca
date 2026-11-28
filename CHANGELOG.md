# Changelog

All notable changes to **Orca** are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/) and the project adheres to semantic versioning.

## [1.2.6]

### Added
- **Native audio sink for 100% reliable background playback (Android)**: the APK now hands resolved direct stream URLs to a **Media3/ExoPlayer instance living inside the foreground `MediaPlaybackService`** — audio is decoded in the service process and is immune to WebView suspension when the screen locks or the app is backgrounded. Position/duration/playing/buffering/ended/error events stream back to the web UI over an `orcaaudio` bridge channel and map onto the shared engine event surface (progress bar, seek, media controls all work).
- **Native-first with a 7s fuse**: if a direct stream cannot start quickly, the YouTube IFrame sink takes over instantly — playback never waits on the resolve ladder.
- **Battery-optimization exemption prompt**: first-launch flow now sends the user to `Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` so OEM power managers (Samsung/Xiaomi/Oppo/Vivo) don't kill the playback service.

### Fixed
- WebView keep-alive hardened: desktop Chrome user agent on the WebView (avoids mobile embed restrictions), explicit `onResume()` + `resumeTimers()` on every lifecycle transition, and command-only service relaunches now correctly promote to foreground (no more potential ANR on notification-button cold starts).

## [1.2.5]

### Fixed
- **`unknown artist` eliminated**: artist names now resolve from every available field (`artist`, `artists[]`, `author`, `channelTitle`, `subtitle`) with `" - Topic"`/`VEVO` suffix stripping and an `"Artist - Title"` title-split fallback; every render site (bottom bar, mobile mini-player, NOW PLAYING panel, track page, queue, playlist picker, PiP/tab title, MediaSession metadata) uses the shared resolver, and sparse backend responses can no longer overwrite an artist the player already knows.
- **Faster track loading on revisit/reload**: the track-metadata cache gained a localStorage tier (TTL 14 days, capacity 150) alongside the in-memory LRU, and sparse entries are merged so cached metadata always wins over placeholders — re-opened sessions start warm and track pages open instantly for anything played before.

## [1.2.4] — Previous release

### Added
- **Android APK packaging** (Capacitor 7): standalone `com.orca.music` app with Orca launcher icons, dark `#05070C` theme, first-launch Vietnamese/English background-audio permission dialog, and an **Auto Release** GitHub Actions pipeline publishing `Orca_Latest.apk` / `Orca_v1.2.4.apk`.
- **Android background playback**: dedicated `MediaPlaybackService` foreground service (`mediaPlayback` type, partial wake lock, `MediaSessionCompat` + media notification with prev / play-pause / next), WebView timer resume on lifecycle pauses, and a visibility-pin script so audio continues when the screen locks.
- **Android native media bridge**: `OrcaMediaPlugin` + `nativeMedia.ts` relay track metadata and commands between the player store and the foreground service.
- **Windows EXE packaging**: lightweight Electron wrapper (`desktop/`) around the live Orca web app — dark frame, Orca icon, tray with playback controls, hardware media keys, background playback when the window is closed. Released as `Orca_Latest.exe` / `Orca_v1.2.4.exe`.
- **Google sign-in on Android**: system-browser OAuth bridge page (`/auth/google?native=1`) returning via `com.orca.music://oauth-callback` (legacy `orca://auth` still accepted), with hard timeouts and a retry button so it never hangs on "Đang tải…".
- **Lyrics cache** (`lyricsCache.ts`): memory + `localStorage` caching with TTL and capacity, plus prefetching of the next queued track's lyrics and metadata.
- **Lyrics scroll fixes**: smooth within-container auto-scroll, no jump/snap on first load, auto-follow pauses on manual scroll with a "Sync" resume pill (in both the lyrics panel and the track page).

### Fixed
- Native APK API routing: all `/api/...` requests target the deployed backend instead of the local WebView origin (no more `Unexpected token '<'` JSON errors).
- Google sign-in inside the APK no longer reports "not configured" (optional `VITE_GOOGLE_CLIENT_ID` baked at build time; runtime client id from the backend remains the source of truth).
- Track pages never show "Unknown track" when the player already knows the song (player-state/queue/cache backfill).
- Desktop PiP corner layout: volume outermost-left, repeat beside it, hide (✕) button, controls usable when shrunk small.
- PiP window title syncs instantly with track changes (Chrome/Edge).

### Changed
- Version stamped `1.2.4` across backend, frontend and Settings.

## [1.2.3]

### Added
- Ambient cover-art gradients on track, album and playlist headers.
- Desktop keyboard shortcuts (Space play/pause, M mute, `/` focus search, Shift+Left/Right prev/next) and drag-and-drop reordering in playlists and the queue.
- Redesigned mobile mini-player with a top-edge scrubbable seek bar, sitting cleanly above the bottom navigation with safe-area spacing.
- Continue Listening / Recently Played shelf on Home and automatic radio-queue continuation so playback never stops abruptly.
- PWA offline caching of the app shell and artwork via the service worker.

### Fixed
- Desktop PiP auto-opens only when a track is playing and the tab is hidden; manual open when paused.
- Progress/seeking no longer resets to 0:00 when scrubbing or re-selecting a track.

## [1.2.2]

### Added
- Queue page with drag & drop, jump-to-track and clear-queue.
- Shuffle and repeat (off / all / one) states synced across the player bar, PiP and MediaSession.
- Track detail page: large cover, metadata, Add to Playlist, three-dot context menu, synced lyrics and Đề xuất (suggestions).
- Recently played history and user-scoped library with an `owner` column.

### Fixed
- Playlist creation, editing, deletion and persistence (Turso fully removed in favor of SQLite).
- "Add to Playlist" shows a friendly empty state + create option instead of erroring.
- Album navigation — album cards now open the album page (`/album/:browseId`) instead of trying to play a browse ID as a track.

## [1.2.1]

### Added
- Billboard shelf (Hot 100 / Viral / New; Global, US, UK, Vietnam, Korea, Japan) with a Settings toggle.
- Theme Palette with circular swatches, descriptions and full-app accent propagation.
- Junk/noise filtering of YouTube Music results (Shorts, sped-up/slowed edits, nightcore, montage spam) with stable spam demotion.
- Google OAuth + email/password authentication with HMAC session tokens.
- PWA manifest + service worker (Add to Home Screen).

## [1.2.0]

### Added
- Spotify-style three-pane desktop layout and dedicated mobile layout with device detection.
- Dual-sink playback engine: YouTube IFrame Player API primary, audio-element fallback chain (backend resolve → proxy → browser mirrors → bounded skip).
- Document Picture-in-Picture mini-player on desktop.
- Synced lyrics panel with LRCLIB.
- FastAPI backend serving the built frontend (single-project Vercel deploy).

## [1.1.0]

### Added
- Complete rebrand to Orca across backend, frontend and metadata, preserving ordinary English words that merely contain the old name's letters.
- Orca logo and dark `#05070C` + `#4D6BFE` design system.

## [1.0.0]

### Added
- Initial port of the original desktop music app core to a FastAPI + React web application: YouTube Music search, playback, queue, lyrics and basic library.
