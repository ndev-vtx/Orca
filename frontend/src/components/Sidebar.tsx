import { NavLink, useNavigate } from "react-router-dom";
import OrcaLogo from "./OrcaLogo";
import LibraryPane from "./LibraryPane";
import { HomeIcon, SearchIcon, LibraryIcon, SettingsIcon } from "./Icons";
import { useLibraryStore } from "../state/libraryStore";
import { useAuthStore } from "../state/authStore";

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export default function Sidebar() {
  const collapsed = useLibraryStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useLibraryStore((s) => s.toggleSidebar);
  const user = useAuthStore((s) => s.user);
  const openAuth = useAuthStore((s) => s.openAuth);
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
      <div className="sidebar__stack sidebar__stack--profile">
        {collapsed ? (
          <button
            className="sidebar__profile sidebar__profile--compact"
            onClick={() => navigate("/settings")}
            title={user ? user.name : "Sign in"}
            aria-label={user ? "Account settings" : "Sign in"}
          >
            {user ? (
              <span className="sidebar__avatar">{initialsFor(user.name)}</span>
            ) : (
              <SettingsIcon size={18} />
            )}
          </button>
        ) : user ? (
          <button className="sidebar__profile" onClick={() => navigate("/settings")}>
            <span className="sidebar__avatar">{initialsFor(user.name)}</span>
            <span className="sidebar__profile-text">
              <span className="sidebar__profile-name">{user.name}</span>
              <span className="sidebar__profile-sub">{user.email}</span>
            </span>
          </button>
        ) : (
          <button
            className="sidebar__profile sidebar__profile--signin"
            onClick={() => openAuth("signin")}
          >
            <span className="sidebar__avatar sidebar__avatar--ghost">
              <SettingsIcon size={16} />
            </span>
            <span className="sidebar__profile-text">
              <span className="sidebar__profile-name">Sign in</span>
              <span className="sidebar__profile-sub">Sync your library</span>
            </span>
          </button>
        )}
      </div>
    </aside>
  );
}
