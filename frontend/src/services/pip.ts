/*
 * pip.ts
 * Picture-in-Picture via the Document Picture-in-Picture API (Chrome/Edge/
 * Opera on desktop and recent Android). The hidden YouTube player element is
 * moved into the PiP window so the video keeps playing there; on close it
 * moves back to the app. Where the API is missing (iOS Safari, Firefox) the
 * button falls back to a clear notice instead of a silent no-op.
 *
 * Media Session controls (lock screen / notification) stay functional
 * regardless — they are wired in the player store.
 */

export interface PipHandle {
  window: Window;
  close: () => void;
}

const W = window as unknown as {
  documentPictureInPicture?: {
    requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
    window: Window | null;
  };
};

export function canDocumentPip(): boolean {
  return typeof W.documentPictureInPicture?.requestWindow === "function";
}

let handle: PipHandle | null = null;

export function activePip(): PipHandle | null {
  return handle;
}

export async function openPip(
  hostElement: HTMLElement,
  onClosed: () => void,
): Promise<PipHandle | null> {
  if (!canDocumentPip()) return null;
  if (handle) return handle;

  const pipWin = await W.documentPictureInPicture!.requestWindow({
    width: 420,
    height: 260,
  });

  const style = pipWin.document.createElement("style");
  style.textContent = `
    html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
    #orca-pip-host { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
    #orca-pip-host iframe { width: 100%; height: 100%; border: 0; }
    #orca-pip-title {
      position: fixed; top: 8px; left: 12px; right: 12px; margin: 0;
      font: 500 12px/1.4 -apple-system, "Segoe UI", sans-serif;
      color: #b3b3b3; pointer-events: none; text-shadow: 0 1px 2px #000;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
  `;
  pipWin.document.head.appendChild(style);

  const title = pipWin.document.createElement("p");
  title.id = "orca-pip-title";
  title.textContent = "Orca — Now Playing";

  const container = pipWin.document.createElement("div");
  container.id = "orca-pip-host";

  pipWin.document.body.append(title, container);
  container.appendChild(hostElement);

  const cleanup = () => {
    handle = null;
    onClosed();
  };
  pipWin.addEventListener("pagehide", cleanup);

  handle = { window: pipWin, close: cleanup };
  return handle;
}

export function setPipTitle(title: string, artist: string): void {
  if (!handle) return;
  const el = handle.window.document.getElementById("orca-pip-title");
  if (el) el.textContent = `${title} — ${artist}`;
}
