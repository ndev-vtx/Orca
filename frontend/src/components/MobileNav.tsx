import { NavLink } from "react-router-dom";
import { HomeIcon, SearchIcon, LibraryIcon, SettingsIcon } from "./Icons";

const TABS = [
  { to: "/", label: "Home", icon: HomeIcon, end: true },
  { to: "/search", label: "Search", icon: SearchIcon, end: false },
  { to: "/library", label: "Library", icon: LibraryIcon, end: false },
  { to: "/settings", label: "Settings", icon: SettingsIcon, end: false },
];

export default function MobileNav() {
  return (
    <nav className="mobilenav" aria-label="Mobile navigation">
      {TABS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => `mobilenav__tab${isActive ? " mobilenav__tab--on" : ""}`}
        >
          <Icon size={22} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
