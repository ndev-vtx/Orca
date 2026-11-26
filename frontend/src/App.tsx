import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
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
import { usePlayerStore } from "./state/player";
import { useLibraryStore } from "./state/libraryStore";
import { useIsMobile } from "./utils/device";
import "./styles/theme.css";
import "./styles/layout.css";
import "./styles/sidebar.css";
import "./styles/cards.css";
import "./styles/bar.css";
import "./styles/pages.css";
import "./styles/lyrics.css";
import "./styles/mobile.css";
import "./styles/miniplayer.css";

export default function App() {
  const loadLibrary = useLibraryStore((s) => s.loadLibrary);
  const bindEngine = usePlayerStore((s) => s.bindEngine);
  const isMobile = useIsMobile();

  useEffect(() => {
    void loadLibrary();
    bindEngine();
  }, [loadLibrary, bindEngine]);

  return (
    <BrowserRouter>
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
              <Route path="/queue" element={<QueuePage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </main>
        </div>
        <NowPlayingBar />
        <LyricsPanel />
        {isMobile && <MobileNav />}
      </div>
    </BrowserRouter>
  );
}
