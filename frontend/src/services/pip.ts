/*
 * pip.ts
 * Desktop Picture-in-Picture via the Document Picture-in-Picture API
 * (Chrome/Edge/Opera on desktop, recent Android). The PiP window is a pure
 * control surface: the YouTube player element stays in the main document and
 * keeps streaming, so the floating window just mirrors playback state and
 * sends commands back through the same-origin portal. Where the API is
 * missing or refuses (iOS Safari, Firefox) the app falls back to an in-page
 * floating mini-player rendered by the same component.
 */

import miniplayerCss from "../styles/miniplayer.css?raw";

const W = window as unknown as {
  documentPictureInPicture?: {
    requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
    window: Window | null;
  };
};

export interface PipSession {
  window: Window;
  close: () => void;
}

export function canDocumentPip(): boolean {
  return typeof W.documentPictureInPicture?.requestWindow === "function";
}

let session: PipSession | null = null;
let closedByApp = false;

export function activePip(): PipSession | null {
  return session;
}

export async function openPipWindow(onClosed: () => void): Promise<Window | null> {
  if (!canDocumentPip()) return null;
  if (session) return session.window;

  let win: Window;
  try {
    win = await W.documentPictureInPicture!.requestWindow({
      width: 460,
      height: 200,
    });
  } catch {
    return null;
  }

  closedByApp = false;

  const style = win.document.createElement("style");
  style.textContent = `
    html, body {
      margin: 0;
      height: 100%;
      background: #05070c;
      overflow: hidden;
      font-family: Inter, "Noto Sans", -apple-system, "Segoe UI", sans-serif;
    }
  `;
  const skin = win.document.createElement("style");
  skin.textContent = miniplayerCss;
  win.document.head.append(style, skin);
  win.document.body.style.margin = "0";

  const cleanup = () => {
    if (session && session.window === win) session = null;
    if (!closedByApp) onClosed();
  };
  win.addEventListener("pagehide", cleanup);

  session = {
    window: win,
    close: () => {
      closedByApp = true;
      win.close();
      if (session && session.window === win) session = null;
      onClosed();
    },
  };
  return session.window;
}
