import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import NowPlayingBar from "./components/NowPlayingBar";
import HomePage from "./pages/HomePage";
import SearchPage from "./pages/SearchPage";
import LibraryPage from "./pages/LibraryPage";
import PlaylistPage from "./pages/PlaylistPage";
import NotFoundPage from "./pages/NotFoundPage";
import { useLibraryStore } from "./state/libraryStore";
import "./styles/theme.css";
import "./styles/layout.css";
import "./styles/sidebar.css";
import "./styles/cards.css";
import "./styles/bar.css";
import "./styles/pages.css";

export default function App() {
  const loadLibrary = useLibraryStore((s) => s.loadLibrary);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  return (
    <BrowserRouter>
      <div className="orca-app">
        <div className="orca-app__panes">
          <Sidebar />
          <main className="orca-main">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/playlist/:id" element={<PlaylistPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </main>
        </div>
        <NowPlayingBar />
      </div>
    </BrowserRouter>
  );
}
