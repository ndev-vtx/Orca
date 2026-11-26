import { useEffect, useState } from "react";
import { api } from "../services/api";
import TopBar from "../components/TopBar";
import { useLibraryStore } from "../state/libraryStore";
import { usePlayerStore } from "../state/player";
import { loadPref, savePref } from "../utils/device";
import type { BillboardChart, BillboardPref, BillboardRegion } from "../types";

const BILLBOARD_KEY = "orca.billboard";

const PALETTES: { name: string; accent: string; hover: string }[] = [
  { name: "Dolphin Blue", accent: "#4d6bfe", hover: "#6e8bff" },
  { name: "Abyss Teal", accent: "#0fb9a9", hover: "#3fd6c8" },
  { name: "Coral Reef", accent: "#ff5d5d", hover: "#ff8585" },
  { name: "Bioluminescent", accent: "#c15cff", hover: "#d686ff" },
  { name: "Golden Kelp", accent: "#f0a733", hover: "#ffc163" },
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

  useEffect(() => {
    api
      .health()
      .then((h) => setVersion(h.version))
      .catch(() => setVersion(""));
  }, []);

  const applyPalette = (accent: string, hover: string) => {
    document.documentElement.style.setProperty("--orca-accent", accent);
    document.documentElement.style.setProperty("--orca-accent-hover", hover);
    document.documentElement.style.setProperty(
      "--orca-accent-glow",
      `${accent}59`,
    );
  };

  useEffect(() => {
    const accent = loadPref("orca.accent", "#4d6bfe");
    const hover = loadPref("orca.accentHover", "#6e8bff");
    applyPalette(accent, hover);
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

  return (
    <div className="page">
      <TopBar title="Settings" />
      <div className="page__hero" />
      <div className="page__body">
        <h1 className="page__greeting">Settings</h1>

        <section className="settings__section">
          <h2 className="settings__heading">Theme Palette</h2>
          <p className="settings__hint">Pick the accent glow Orca swims in.</p>
          <div className="settings__palette">
            {PALETTES.map((p) => (
              <button
                key={p.accent}
                className="settings__swatch"
                style={{ background: p.accent }}
                title={p.name}
                aria-label={`${p.name} accent`}
                onClick={() => {
                  savePref("orca.accent", p.accent);
                  savePref("orca.accentHover", p.hover);
                  applyPalette(p.accent, p.hover);
                }}
              />
            ))}
          </div>
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
            discovery, LRCLIB lyrics and the official YouTube player, with no accounts
            and no API keys.
          </p>
          <p className="settings__credit">
            Created by <strong>Nguyễn Khôi Nguyên</strong>
          </p>
        </section>
      </div>
    </div>
  );
}
