/*
 * Orca desktop wrapper — main process.
 *
 * A lightweight Electron shell around the live Orca web app
 * (https://orca-d.vercel.app). Provides:
 *   - Orca branding (dark #05070C frame, Orca icon, no menu bar)
 *   - Always-dark theme (nativeTheme forced dark)
 *   - Background playback: closing the window hides it to the tray and the
 *     audio keeps playing; quitting happens from the tray or Ctrl+Q/Cmd+Q.
 *   - Hardware media keys (play/pause, previous, next) relayed into the web
 *     app's existing `orcamedia` command channel.
 *   - External links open in the real browser, never inside the app window.
 */

const { app, BrowserWindow, shell, Tray, Menu, globalShortcut, nativeTheme, nativeImage } = require("electron");
const path = require("path");

const APP_URL = "https://orca-d.vercel.app";
const ICON_PATH = path.join(__dirname, "icon.png");

/** @type {BrowserWindow | null} */
let win = null;
/** @type {Tray | null} */
let tray = null;
let quitting = false;

/* Media-key actions are relayed into the web app through the same
 * `orcamedia` CustomEvent channel the Android APK uses. */
function relayToApp(action) {
  if (!win || win.isDestroyed()) return;
  win.webContents
    .executeJavaScript(
      `window.dispatchEvent(new CustomEvent("orcamedia", { detail: JSON.stringify({ action: ${JSON.stringify(action)} }) }));`,
    )
    .catch(() => {});
}

function togglePlayPause() {
  relayToApp("playpause");
}

function sendTrayAction(action) {
  relayToApp(action);
}

function createTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(ICON_PATH));
    tray.setToolTip("Orca — đang phát nhạc");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Mở Orca", click: () => showWindow() },
        { type: "separator" },
        { label: "Phát / Tạm dừng", click: () => togglePlayPause() },
        { label: "Bài trước", click: () => sendTrayAction("prev") },
        { label: "Bài tiếp theo", click: () => sendTrayAction("next") },
        { type: "separator" },
        { label: "Thoát Orca", click: () => app.quit() },
      ]),
    );
    tray.on("click", () => showWindow());
  } catch {
    /* Tray is a nicety, never fatal. */
  }
}

function showWindow() {
  if (!win) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 420,
    minHeight: 320,
    backgroundColor: "#05070C",
    show: false,
    autoHideMenuBar: true,
    icon: ICON_PATH,
    title: "Orca",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  /* Keep the frame and title bar dark in line with Orca's identity. */
  nativeTheme.themeSource = "dark";

  win.once("ready-to-show", () => win && win.show());

  /* Keep the Orca title synced with the active track (web app sets
   * document.title per track — mirror it onto the window). */
  win.webContents.on("page-title-updated", (event, title) => {
    event.preventDefault();
    if (win && !win.isDestroyed()) win.setTitle(title.startsWith("Orca") ? title : `Orca — ${title}`);
  });

  /* External links (OAuth flows, docs, release pages) open in the real
   * browser instead of navigating the app window away. */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://orca-d.vercel.app") || url.startsWith("http://localhost")) {
      return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true } };
    }
    void shell.openExternal(url);
    return { action: "deny" };
  });

  /* Keep main-view navigation pinned to the app origin. */
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("https://orca-d.vercel.app") && !url.startsWith("http://localhost")) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  /* Background playback: closing the window hides it (audio keeps playing).
   * A real quit only happens via the tray / app.quit(). */
  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      if (win && !win.isDestroyed()) win.hide();
    }
  });

  win.on("closed", () => {
    win = null;
  });

  void win.loadURL(APP_URL);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());

  app.whenReady().then(() => {
    nativeTheme.themeSource = "dark";
    createWindow();
    createTray();

    /* Hardware media keys → web app command channel. */
    try {
      globalShortcut.register("MediaPlayPause", togglePlayPause);
      globalShortcut.register("MediaPreviousTrack", () => sendTrayAction("prev"));
      globalShortcut.register("MediaNextTrack", () => sendTrayAction("next"));
    } catch {
      /* Media keys are best-effort. */
    }

    app.on("activate", () => showWindow());
  });

  app.on("before-quit", () => {
    quitting = true;
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });

  /* Keep running in the background (tray) while the window is hidden. */
  app.on("window-all-closed", () => {
    if (quitting) app.quit();
  });
}
