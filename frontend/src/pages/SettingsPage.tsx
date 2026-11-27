import { useEffect, useState } from "react";
import { api } from "../services/api";
import TopBar from "../components/TopBar";
import { initialsFor } from "../components/Sidebar";
import { useLibraryStore } from "../state/libraryStore";
import { usePlayerStore } from "../state/player";
import { useAuthStore } from "../state/authStore";
import { loadPref, savePref } from "../utils/device";
import {
  applyPalette,
  currentAccent,
  DEFAULT_ACCENT,
  DEFAULT_ACCENT_HOVER,
} from "../utils/theme";
import type { BillboardChart, BillboardPref, BillboardRegion } from "../types";

const BILLBOARD_KEY = "orca.billboard";

const PALETTES: {
  name: string;
  accent: string;
  hover: string;
  description: string;
}[] = [
  {
    name: "Dolphin Blue",
    accent: "#4d6bfe",
    hover: "#6e8bff",
    description: "The classic Orca look — deep-sea electric blue.",
  },
  {
    name: "Abyss Teal",
    accent: "#0fb9a9",
    hover: "#3fd6c8",
    description: "Cold bioluminescence from the ocean floor.",
  },
  {
    name: "Coral Reef",
    accent: "#ff5d5d",
    hover: "#ff8585",
    description: "Warm current of the reef, vivid and loud.",
  },
  {
    name: "Bioluminescent",
    accent: "#c15cff",
    hover: "#d686ff",
    description: "Midnight glow of plankton under moonlight.",
  },
  {
    name: "Golden Kelp",
    accent: "#f0a733",
    hover: "#ffc163",
    description: "Sunlit kelp forest in shallow water.",
  },
];

const CHARTS: { value: BillboardChart; label: string }[] = [
  { value: "hot100", label: "Hot 100" },
  { value: "viral", label: "Viral hits" },
  { value: "new", label: "New releases" },
];

const REGIONS: { value: BillboardRegion; label: string }[] = [
  { value: "global", label: "Global" },
  { value: "us", label: "United States" },
  { value: "uk", label: "United Kingdom" },
  { value: "vietnam", label: "Việt Nam" },
  { value: "korea", label: "Korea" },
  { value: "japan", label: "Japan" },
];

function readBillboardPref(): BillboardPref {
  const raw = loadPref(BILLBOARD_KEY, "");
  if (!raw) return { enabled: false, chart: "hot100", region: "global" };
  try {
    const parsed = JSON.parse(raw) as Partial<BillboardPref>;
    return {
      enabled: Boolean(parsed.enabled),
      chart: (parsed.chart as BillboardChart) ?? "hot100",
      region: (parsed.region as BillboardRegion) ?? "global",
    };
  } catch {
    return { enabled: false, chart: "hot100", region: "global" };
  }
}

export default function SettingsPage() {
  const [pref, setPref] = useState<BillboardPref>(readBillboardPref);
  const [version, setVersion] = useState("");
  const loadLibrary = useLibraryStore((s) => s.loadLibrary);
  const notify = usePlayerStore((s) => s.notify);
  const user = useAuthStore((s) => s.user);
  const openAuth = useAuthStore((s) => s.openAuth);
  const signOut = useAuthStore((s) => s.signOut);

  useEffect(() => {
    api
      .health()
      .then((h) => setVersion(h.version))
      .catch(() => setVersion(""));
  }, []);

  const updatePref = (next: BillboardPref) => {
    setPref(next);
    savePref(BILLBOARD_KEY, JSON.stringify(next));
  };

  const clearHistory = async () => {
    try {
      await api.clearHistory();
      await loadLibrary();
      notify("Listening history cleared");
    } catch {
      notify("Could not clear history right now");
    }
  };

  const handleSignOut = async () => {
    await signOut();
    notify("Signed out");
  };

  return (
    <div className="page">
      <TopBar title="Settings" />
      <div className="page__hero" />
      <div className="page__body">
        <h1 className="page__greeting">Settings</h1>

        <section className="settings__section">
          <h2 className="settings__heading">Account</h2>
          {user ? (
            <div className="settings__account">
              {user.avatar ? (
                <img className="settings__account-avatar" src={user.avatar} alt="" />
              ) : (
                <span className="settings__account-avatar settings__account-avatar--text">
                  {initialsFor(user.name)}
                </span>
              )}
              <div className="settings__account-info">
                <span className="settings__account-name">{user.name}</span>
                <span className="settings__account-email">{user.email}</span>
                <span className="settings__account-provider">
                  {user.provider === "google" ? "Signed in with Google" : "Email account"}
                </span>
              </div>
              <button className="settings__ghostbtn" onClick={() => void handleSignOut()}>
                Sign out
              </button>
            </div>
          ) : (
            <div className="settings__account settings__account--guest">
              <div className="settings__account-info">
                <span className="settings__account-name">Browsing as guest</span>
                <span className="settings__account-email">
                  Favorites and playlists stay on this device. Sign in to sync them.
                </span>
              </div>
              <button
                className="settings__primarybtn"
                onClick={() => openAuth("signin")}
              >
                Sign in
              </button>
            </div>
          )}
        </section>

        <section className="settings__section">
          <h2 className="settings__heading">Theme Palette</h2>
          <p className="settings__hint">
            Pick the accent glow Orca swims in — applied across the whole app instantly.
          </p>
          <div className="settings__palette">
            {PALETTES.map((p) => {
              const active = currentAccent() === p.accent.toLowerCase();
              return (
                <button
                  key={p.accent}
                  className={`settings__swatch${active ? " settings__swatch--active" : ""}`}
                  aria-pressed={active}
                  aria-label={`${p.name} accent`}
                  onClick={() => {
                    savePref("orca.accent", p.accent);
                    savePref("orca.accentHover", p.hover);
                    applyPalette(p.accent, p.hover);
                  }}
                >
                  <span
                    className="settings__swatch-dot"
                    style={{ background: p.accent }}
                    aria-hidden="true"
                  />
                  <span className="settings__swatch-name">{p.name}</span>
                  <span className="settings__swatch-desc">{p.description}</span>
                </button>
              );
            })}
          </div>
          {currentAccent() !== DEFAULT_ACCENT && (
            <button
              className="settings__ghostbtn settings__reset-accent"
              onClick={() => {
                savePref("orca.accent", DEFAULT_ACCENT);
                savePref("orca.accentHover", DEFAULT_ACCENT_HOVER);
                applyPalette(DEFAULT_ACCENT, DEFAULT_ACCENT_HOVER);
              }}
            >
              Reset to Dolphin Blue
            </button>
          )}
        </section>

        <section className="settings__section">
          <h2 className="settings__heading">Billboard</h2>
          <p className="settings__hint">
            Show a Billboard chart shelf on Home, fetched from YouTube Music charts.
          </p>
          <label className="settings__row">
            <span>Show Billboard shelf</span>
            <input
              type="checkbox"
              checked={pref.enabled}
              onChange={(e) => updatePref({ ...pref, enabled: e.target.checked })}
            />
          </label>
          <label className="settings__row">
            <span>Chart</span>
            <select
              value={pref.chart}
              onChange={(e) => updatePref({ ...pref, chart: e.target.value as BillboardChart })}
            >
              {CHARTS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="settings__row">
            <span>Region</span>
            <select
              value={pref.region}
              onChange={(e) => updatePref({ ...pref, region: e.target.value as BillboardRegion })}
            >
              {REGIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="settings__section">
          <h2 className="settings__heading">Data &amp; History</h2>
          <p className="settings__hint">
            Clearing history only removes recently played — favorites and playlists stay.
          </p>
          <div className="settings__actions">
            <button className="settings__danger" onClick={() => void clearHistory()}>
              Clear listening history
            </button>
          </div>
        </section>

        <section className="settings__section">
          <h2 className="settings__heading">Updates</h2>
          <p className="settings__hint">
            {version ? `Orca backend version ${version}.` : "Checking version…"}
          </p>
        </section>

        <section className="settings__section settings__section--about">
          <h2 className="settings__heading">About &amp; Credits</h2>
          <p className="settings__hint">
            Orca — a deep, floating ocean of music. Streaming runs on YouTube Music
            discovery, LRCLIB lyrics and the official YouTube player.
          </p>
          <div className="settings__credit-card">
            <span className="settings__credit-avatar" aria-hidden="true">
              NKN
            </span>
            <span className="settings__credit-info">
              <span className="settings__credit-name">Nguyễn Khôi Nguyên</span>
              <span className="settings__credit-role">Coding / Developer</span>
              <span className="settings__credit-sub">Creator of Orca</span>
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
