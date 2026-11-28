import { useEffect } from "react";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import Sidebar from "./components/Sidebar";
import NowPlayingBar from "./components/NowPlayingBar";
import LyricsPanel from "./components/LyricsPanel";
import MobileNav from "./components/MobileNav";
import HomePage from "./pages/HomePage";
import SearchPage from "./pages/SearchPage";
import LibraryPage from "./pages/LibraryPage";
import PlaylistPage from "./pages/PlaylistPage";
import AlbumPage from "./pages/AlbumPage";
import QueuePage from "./pages/QueuePage";
import SettingsPage from "./pages/SettingsPage";
import NotFoundPage from "./pages/NotFoundPage";
import TrackPage from "./pages/TrackPage";
import AuthBridgePage from "./pages/AuthBridgePage";
import AuthModal from "./components/AuthModal";
import TrackMenu from "./components/TrackMenu";
import PlaylistPickerModal from "./components/PlaylistPickerModal";
import NowPlayingPanel from "./components/NowPlayingPanel";
import NativePermissionGate from "./components/NativePermissionGate";
import { usePlayerStore } from "./state/player";
import { useLibraryStore } from "./state/libraryStore";
import { useAuthStore } from "./state/authStore";
import { useIsMobile } from "./utils/device";
import { applySavedTheme } from "./utils/theme";
import { useKeyboardShortcuts } from "./utils/shortcuts";
import { prewarmYouTubeApi } from "./services/audioEngine";
import { onNativeMediaCommand } from "./services/nativeMedia";
import "./styles/theme.css";
import "./styles/layout.css";
import "./styles/sidebar.css";
import "./styles/cards.css";
import "./styles/bar.css";
import "./styles/pages.css";
import "./styles/lyrics.css";
import "./styles/mobile.css";
import "./styles/miniplayer.css";
import "./styles/track.css";

export default function App() {
  const loadLibrary = useLibraryStore((s) => s.loadLibrary);
  const bindEngine = usePlayerStore((s) => s.bindEngine);
  const bootstrapAuth = useAuthStore((s) => s.bootstrap);
  const signInWithToken = useAuthStore((s) => s.signInWithToken);
  const isMobile = useIsMobile();
  useKeyboardShortcuts();

  /*
   * Android APK: relay lock-screen / notification media commands (from the
   * native MediaPlaybackService's MediaSessionCompat) into the player store.
   */
  useEffect(() => {
    return onNativeMediaCommand((action) => {
      const st = usePlayerStore.getState();
      if (action === "playpause") st.toggle();
      else if (action === "next") st.next(true);
      else if (action === "prev") st.previous();
    });
  }, []);

  useEffect(() => {
    // Saved accent must be applied at boot, not only when Settings mounts.
    applySavedTheme();
    void loadLibrary();
    bindEngine();
    void bootstrapAuth();
    // Start fetching the YouTube IFrame API right away so the first play
    // never waits on the script download; the player element itself is
    // still created inside the first user gesture (primeOnGesture).
    prewarmYouTubeApi();
  }, [loadLibrary, bindEngine, bootstrapAuth]);

  /*
   * Android APK: Google sign-in happens in the system browser (Google blocks
   * OAuth inside WebViews) and returns via a deep link. Two URL shapes are
   * supported: orca://auth?token=... (legacy) and the canonical app-id scheme
   * com.orca.music://oauth-callback?token=... Capture both warm returns
   * (appUrlOpen) and cold starts (getLaunchUrl) and complete the session.
   */
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const complete = (url: string): void => {
      try {
        const parsed = new URL(url);
        const isLegacy = parsed.protocol === "orca:" && parsed.host === "auth";
        const isCanonical =
          parsed.protocol === "com.orca.music:" && parsed.host === "oauth-callback";
        if (!isLegacy && !isCanonical) return;
        const token = parsed.searchParams.get("token");
        if (token) void signInWithToken(token);
      } catch {
        /* malformed deep link */
      }
    };
    let handle: { remove: () => Promise<void> } | null = null;
    void CapApp.addListener("appUrlOpen", ({ url }) => complete(url)).then((h) => {
      handle = h;
    });
    void CapApp.getLaunchUrl().then((launch) => {
      if (launch?.url) complete(launch.url);
    });
    return () => {
      void handle?.remove();
    };
  }, [signInWithToken]);

  return (
    <BrowserRouter>
      <RouterBridge />
      <div className={`orca-app${isMobile ? " orca-app--mobile" : ""}`}>
        <div className="orca-app__panes">
          {!isMobile && <Sidebar />}
          <main className="orca-main">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/playlist/:id" element={<PlaylistPage />} />
              <Route path="/album/:browseId" element={<AlbumPage />} />
              <Route path="/track/:videoId" element={<TrackPage />} />
              <Route path="/queue" element={<QueuePage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/auth/google" element={<AuthBridgePage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </main>
          {!isMobile && <NowPlayingPanel />}
        </div>
        <NowPlayingBar />
        <LyricsPanel />
        {isMobile && <MobileNav />}
        <AuthModal />
        <TrackMenu />
        <PlaylistPickerModal />
        <NativePermissionGate />
      </div>
    </BrowserRouter>
  );
}

/*
 * Exposes the router's navigate to non-React callers that live outside the
 * router context (keyboard shortcuts: "/" jumps to Search).
 */
function RouterBridge(): null {
  const navigate = useNavigate();
  useEffect(() => {
    (window as unknown as { __orcaNavigate?: (path: string) => void }).__orcaNavigate = navigate;
    return () => {
      delete (window as unknown as { __orcaNavigate?: (path: string) => void }).__orcaNavigate;
    };
  }, [navigate]);
  return null;
}
