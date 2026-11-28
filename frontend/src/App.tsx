import { useEffect } from "react";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router-dom";
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
import AuthModal from "./components/AuthModal";
import TrackMenu from "./components/TrackMenu";
import PlaylistPickerModal from "./components/PlaylistPickerModal";
import NowPlayingPanel from "./components/NowPlayingPanel";
import { usePlayerStore } from "./state/player";
import { useLibraryStore } from "./state/libraryStore";
import { useAuthStore } from "./state/authStore";
import { useIsMobile } from "./utils/device";
import { applySavedTheme } from "./utils/theme";
import { useKeyboardShortcuts } from "./utils/shortcuts";
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
  const isMobile = useIsMobile();
  useKeyboardShortcuts();

  useEffect(() => {
    // Saved accent must be applied at boot, not only when Settings mounts.
    applySavedTheme();
    void loadLibrary();
    bindEngine();
    void bootstrapAuth();
  }, [loadLibrary, bindEngine, bootstrapAuth]);

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
