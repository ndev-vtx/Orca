import { NavLink, useNavigate } from "react-router-dom";
import OrcaLogo from "./OrcaLogo";
import LibraryPane from "./LibraryPane";
import { HomeIcon, SearchIcon, LibraryIcon } from "./Icons";
import { useLibraryStore } from "../state/libraryStore";

export default function Sidebar() {
  const collapsed = useLibraryStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useLibraryStore((s) => s.toggleSidebar);
  const navigate = useNavigate();

  return (
    <aside className={`sidebar${collapsed ? " sidebar--collapsed" : ""}`}>
      <div className="sidebar__stack sidebar__stack--brand">
        <OrcaLogo collapsed={collapsed} />
        <button
          className="sidebar__collapse"
          onClick={toggleSidebar}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand" : "Collapse"}
        >
          <LibraryIcon size={18} />
        </button>
      </div>

      <nav className="sidebar__stack" aria-label="Main">
        <NavLink
          to="/"
          end
          className={({ isActive }) => `sidebar__nav${isActive ? " is-active" : ""}`}
          title="Home"
        >
          <HomeIcon size={20} />
          {!collapsed && <span>Home</span>}
        </NavLink>
        <NavLink
          to="/search"
          className={({ isActive }) => `sidebar__nav${isActive ? " is-active" : ""}`}
          title="Search"
        >
          <SearchIcon size={20} />
          {!collapsed && <span>Search</span>}
        </NavLink>
        {!collapsed && (
          <button className="sidebar__nav sidebar__nav--ghost" onClick={() => navigate("/library")}>
            <LibraryIcon size={20} />
            <span>Your Library</span>
          </button>
        )}
      </nav>

      <LibraryPane />
    </aside>
  );
}
